import type { Prisma } from "@prisma/client";

import { renderEvidenceFallback } from "@/agent/answer-evidence";
import { buildAgentContext } from "@/agent/context-builder";
import {
  beginAgentStep,
  completeAgentStep,
  executeDurableToolStep,
  AgentStepConflictError,
  readStepOutput
} from "@/agent/durable-step";
import { runPostTaskHooks } from "@/agent/post-task";
import { ExecutionTracer } from "@/agent/execution-tracer";
import { createLLMProvider } from "@/agent/llm-provider";
import { AgentPlanValidationError, parseAgentPlan } from "@/agent/plan-contract";
import { buildClarifyPlan, repairPlan } from "@/agent/plan-repair";
import { formatIssuesForLLM, validatePlan } from "@/agent/plan-validator";
import {
  AgentRuntimeBudget,
  AgentRuntimeBudgetExceededError,
  getBudgetLimitMessage,
  openAgentRuntimeBudget
} from "@/agent/runtime-budget";
import {
  SCHEDULER_BLOCKED_TOOLS,
  TRIGGER_SCHEDULED_JOB,
} from "@/agent/scheduler-tick";
import {
  AgentTaskLeaseLostError,
  claimAgentTask,
  getRuntimeWorkerId,
  startAgentTaskHeartbeat
} from "@/agent/task-claim";
import { ToolApprovalRequiredError } from "@/agent/tool-approval";
import { createToolRegistry, type ToolRegistry } from "@/agent/tool-registry";
import type {
  AgentPlan,
  AgentTaskLeaseOwnership,
  LLMAnswerRequest,
  LLMAnswerResult,
  LLMPlanRequest,
  LLMPlanResult,
  LLMProvider,
  ToolResult
} from "@/agent/types";
import { appendChatLog } from "@/lib/chat-log-file";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";

export type RunAgentTaskOptions = {
  workerId?: string;
  leaseDurationMs?: number;
  heartbeatIntervalMs?: number;
};

export async function runAgentTask(
  taskId: string,
  options: RunAgentTaskOptions = {}
) {
  const leaseDurationMs = options.leaseDurationMs ?? env.AGENT_TASK_LEASE_MS;
  const workerId = options.workerId ?? getRuntimeWorkerId();
  const claim = await claimAgentTask(taskId, { workerId, leaseDurationMs });
  const task = await prisma.agentTask.findUnique({
    where: { id: taskId },
    include: {
      agent: true,
      sourceMessage: true,
      requestedBy: true,
      steps: { where: { stepKey: "plan" }, select: { status: true, output: true } }
    }
  });

  if (!task) {
    throw new Error(`Agent task not found: ${taskId}`);
  }

  if (!claim.claimed) {
    return task;
  }

  const lease: AgentTaskLeaseOwnership = {
    attemptId: claim.attemptId,
    workerId: claim.workerId,
    leaseDurationMs: claim.leaseDurationMs
  };
  const heartbeat = startAgentTaskHeartbeat({
    taskId: task.id,
    ownership: lease,
    intervalMs: options.heartbeatIntervalMs ?? env.AGENT_TASK_HEARTBEAT_MS
  });
  const tracer = new ExecutionTracer(prisma, task.id, task.roomId, lease);
  let budget: AgentRuntimeBudget | null = null;
  let completedEvidence: LLMAnswerRequest | null = null;

  try {
    await tracer.markRunning(claim.claimedAt);
    budget = await openAgentRuntimeBudget({
      taskId: task.id,
      roomId: task.roomId,
      lease
    });
    const runtimeBudget = budget;
    runtimeBudget.assertWithinDeadline();
    const runtimeContext = await buildAgentContext(
      task.roomId,
      task.requestedById
    );
    await heartbeat.assertActive();
    runtimeBudget.assertWithinDeadline();
    await tracer.event("agent.context.built", {
      recentMessageCount: runtimeContext.recentMessages.length,
      memoCount: runtimeContext.memos.length
    });

    const registry = createToolRegistry();
    const prompt = getTaskPrompt(task.input);
    const referenceTime = task.createdAt.toISOString();
    const trigger = getTaskTrigger(task.input);
    const allTools = registry.list().map((tool) => ({
      name: tool.name,
      description: tool.description,
      schema: tool.schema
    }));
    // When a task is invoked by the scheduler (a fired scheduled job),
    // the agent must EXECUTE the action, not re-schedule it. Strip the writeable
    // scheduling tools from what the LLM sees so it physically cannot recurse.
    const availableTools = filterToolsForTrigger(allTools, trigger);
    const availableToolNames = availableTools.map((t) => t.name);

    // 先重验权威 checkpoint，确保 Registry/trigger 漂移也有明确的 validation 原因。
    // 完成的旧 Step 保持原样；失效计划不能被新规划或部分执行掩盖。
    const persistedStep = task.steps?.[0];
    let plan = persistedStep?.status === "completed"
      ? parseAgentPlan(persistedStep.output, registry, availableToolNames, "persisted")
      : readPersistedAgentPlan(task.plan, registry, availableToolNames);
    const planCheckpoint = await beginAgentStep({
      taskId: task.id,
      roomId: task.roomId,
      lease,
      stepKey: "plan",
      kind: "plan",
      stepInput: {
        prompt,
        requestedById: runtimeContext.roomContext.requestedById,
        availableTools: availableToolNames
      }
    });
    if (planCheckpoint.step.status === "completed") {
      plan = parseAgentPlan(planCheckpoint.step.output, registry, availableToolNames, "persisted");
    }
    if (plan) {
      await tracer.event("agent.plan.resumed", {
        intent: plan.intent,
        requiredTools: plan.requiredTools
      });
      if (planCheckpoint.step.status !== "completed") {
        await completeAgentStep({
          taskId: task.id,
          roomId: task.roomId,
          lease,
          stepKey: "plan",
          output: plan,
          taskData: { plan: plan as Prisma.InputJsonObject }
        });
      }
    } else {
      const provider = createLLMProvider(registry);
      await tracer.event("agent.llm.started", {
        provider: provider.name,
        model: provider.model,
        availableTools: availableToolNames
      });
      const planRequest: LLMPlanRequest = {
        prompt,
        referenceTime,
        roomContext: runtimeContext.roomContext,
        availableTools,
        agentSystemPrompt: task.agent.systemPrompt
      };
      const planResult = await runBudgetedModelCall({
        budget: runtimeBudget,
        provider,
        call: (request: LLMPlanRequest) => provider.plan(request),
        request: planRequest,
        inputSummary: prompt.slice(0, 240),
        requestPayload: {
          prompt,
          referenceTime,
          roomContext: runtimeContext.roomContext,
          availableTools: availableToolNames
        },
        roomId: task.roomId,
        taskId: task.id,
        assertLease: heartbeat.assertActive
      });
      plan = parseAgentPlan(planResult, registry, availableToolNames, "planner");
      await tracer.event("agent.llm.completed", {
        intent: plan.intent,
        requiredTools: plan.requiredTools
      });

      // --- Plan consistency check -------------------------------------------
      // The LLM sometimes produces a final_response_text that does not match its
      // tool_inputs (e.g. promising "今晚只发一次" while only calling schedule.cancel).
      // We validate the plan; on issues we retry once with structured feedback,
      // and if the retry still fails we fall back to a safe "ask user to confirm"
      // reply rather than executing a mismatched plan.
      let planIssues = validatePlan(plan, prompt);
      if (planIssues.length > 0) {
        await tracer.event("agent.plan.validation.failed", {
          attempt: 1,
          issueCodes: planIssues.map((i) => i.code),
          issues: planIssues
        });

        try {
          const retryRequest: LLMPlanRequest = {
            prompt,
            referenceTime,
            roomContext: runtimeContext.roomContext,
            availableTools,
            agentSystemPrompt: task.agent.systemPrompt,
            validationFeedback: {
              previousPlan: plan,
              issues: formatIssuesForLLM(planIssues)
            }
          };
          const retryResult = await runBudgetedModelCall({
            budget: runtimeBudget,
            provider,
            call: (request: LLMPlanRequest) => provider.plan(request),
            request: retryRequest,
            inputSummary: `[retry] ${prompt.slice(0, 230)}`,
            requestPayload: {
              prompt,
              referenceTime,
              roomContext: runtimeContext.roomContext,
              availableTools: availableToolNames,
              validationFeedback: {
                previousPlan: plan,
                issues: planIssues
              }
            },
            roomId: task.roomId,
            taskId: task.id,
            assertLease: heartbeat.assertActive
          });
          plan = parseAgentPlan(retryResult, registry, availableToolNames, "planner");
          await tracer.event("agent.plan.validation.retry.completed", {
            intent: plan.intent,
            requiredTools: plan.requiredTools
          });
        } catch (error) {
          if (error instanceof AgentRuntimeBudgetExceededError
            || error instanceof AgentTaskLeaseLostError
            || error instanceof AgentPlanValidationError) throw error;
          const message = error instanceof Error ? error.message : "LLM retry failed";
          await tracer.event("agent.plan.validation.retry.failed", { error: message });
        }

        planIssues = validatePlan(plan, prompt);
        if (planIssues.length > 0) {
          const repairedFromCodes = planIssues.map((i) => i.code);
          const { repaired, remainingIssues } = repairPlan(plan, prompt, planIssues);
          plan = parseAgentPlan(repaired, registry, availableToolNames, "repaired");
          await tracer.event("agent.plan.validation.repaired", {
            repairedFromCodes,
            remainingCodes: remainingIssues.map((i) => i.code),
            remainingIssues
          });

          if (remainingIssues.length > 0) {
            await tracer.event("agent.plan.validation.fallback", {
              issueCodes: remainingIssues.map((i) => i.code),
              issues: remainingIssues,
              discardedPlan: plan
            });
            plan = buildClarifyPlan(remainingIssues, prompt);
          }
        }
      }
      // ------------------------------------------------------------------------

      await completeAgentStep({
        taskId: task.id,
        roomId: task.roomId,
        lease,
        stepKey: "plan",
        output: plan,
        taskData: { plan: plan as Prisma.InputJsonObject }
      });
    }

    const toolResults: ToolResult[] = [];
    let stepIndex = 0;
    for (const toolName of plan.requiredTools) {
      const args = plan.toolInputs[toolName];
      const argList = Array.isArray(args) ? args : [args];
      for (const arg of argList) {
        await heartbeat.assertActive();
        stepIndex += 1;
        const output = await executeDurableToolStep({
          registry,
          toolName,
          toolInput: arg,
          stepKey: `tool:${stepIndex}`,
          context: {
            prisma,
            taskId: task.id,
            roomId: task.roomId,
            agentId: task.agentId,
            requestedById: runtimeContext.roomContext.requestedById,
            runtimeContext,
            referenceTime,
            tracer,
            lease,
            signal: runtimeBudget.signal,
            reserveToolCall: (reservation) => runtimeBudget.reserveToolCall(reservation)
          }
        });
        toolResults.push({ ...output, input: arg, stepKey: `tool:${stepIndex}` });
      }
    }

    const answerRequest: LLMAnswerRequest = {
      prompt,
      referenceTime,
      roomContext: runtimeContext.roomContext,
      agentSystemPrompt: task.agent.systemPrompt,
      plan,
      toolResults
    };
    completedEvidence = answerRequest;
    await heartbeat.assertActive();
    await runtimeBudget.assertCanFinalize();
    let content = plan.finalResponseText.trim()
      || "我已经把你的请求记下了，可以再补充一些细节让我更准确地帮到你。";
    if (toolResults.length > 0) {
      const needsSynthesis = plan.requiredTools.some((name) => (
        registry.list().find((tool) => tool.name === name)?.effect !== "database-write"
      ));
      if (needsSynthesis) {
        // plan 表示模型计算步骤；用独立 key 区分执行前规划和执行后综合，
        // 复用既有枚举与恢复协议，避免只为内部阶段新增数据库迁移。
        const checkpoint = await beginAgentStep({
          taskId: task.id,
          roomId: task.roomId,
          lease,
          stepKey: "synthesis",
          kind: "plan",
          stepInput: { prompt, referenceTime, toolResults }
        });
        let answer: { text: string; mode: "model" | "fallback" };
        if (checkpoint.step.status === "completed") {
          answer = readStepOutput(checkpoint.step.output, isPersistedAnswer, "synthesis");
          await tracer.event("agent.synthesis.resumed", { mode: answer.mode });
        } else {
          const provider = createLLMProvider(registry);
          answer = {
            text: renderEvidenceFallback(answerRequest, "暂时无法综合查询结果"),
            mode: "fallback"
          };
          if (provider.synthesize) {
            await tracer.event("agent.synthesis.started", {
              provider: provider.name,
              model: provider.model,
              resultCount: toolResults.length
            });
            try {
              const synthesized = await runBudgetedModelCall({
                budget: runtimeBudget,
                provider,
                call: (request: LLMAnswerRequest) => provider.synthesize!(request),
                request: answerRequest,
                inputSummary: `[synthesis] ${prompt.slice(0, 220)}`,
                requestPayload: { phase: "synthesis", prompt, referenceTime, toolResults },
                roomId: task.roomId,
                taskId: task.id,
                assertLease: heartbeat.assertActive
              });
              if (!synthesized.text?.trim()) throw new Error("Empty synthesized answer.");
              answer = { text: synthesized.text.trim(), mode: "model" };
            } catch (error) {
              if (error instanceof AgentRuntimeBudgetExceededError
                || error instanceof AgentTaskLeaseLostError) throw error;
              await heartbeat.assertActive();
              runtimeBudget.assertWithinDeadline();
              await tracer.event("agent.synthesis.fallback", { reason: "provider_failed" });
            }
          } else {
            await tracer.event("agent.synthesis.fallback", { reason: "provider_unsupported" });
          }
          await heartbeat.assertActive();
          await runtimeBudget.assertCanFinalize();
          await completeAgentStep({
            taskId: task.id,
            roomId: task.roomId,
            lease,
            stepKey: "synthesis",
            output: answer
          });
          await tracer.event("agent.synthesis.completed", { mode: answer.mode });
        }
        content = answer.text;
      } else {
        // 纯写操作逐项确认实际结果，不把执行前的成功承诺当成事实。
        content = renderEvidenceFallback(answerRequest);
      }
    }
    await heartbeat.assertActive();
    await runtimeBudget.assertCanFinalize();
    const result = { plan, toolResults };
    const finalCheckpoint = await beginAgentStep({
      taskId: task.id,
      roomId: task.roomId,
      lease,
      stepKey: "final",
      kind: "final",
      stepInput: {
        intent: plan.intent,
        toolStepCount: stepIndex,
        content
      }
    });
    if (finalCheckpoint.step.status === "completed") {
      throw new AgentStepConflictError(
        "Final step is completed while its AgentTask is still claimable."
      );
    }
    const finalMessage = await tracer.completeWithMessage(
      {
        roomId: task.roomId,
        senderType: "agent",
        senderAgentId: task.agentId,
        content,
        targetType: "all",
        metadata: {
          taskId: task.id,
          intent: plan.intent,
          confidence: plan.confidence,
          toolResults
        } as Prisma.InputJsonObject
      },
      result
    );

    await appendChatLog(task.roomId, {
      kind: "message.agent",
      messageId: finalMessage.id,
      senderAgentId: task.agentId,
      taskId: task.id,
      status: "completed",
      content,
      createdAt: finalMessage.createdAt
    });

    runPostTaskHooks(task.roomId);

    return prisma.agentTask.findUniqueOrThrow({
      where: { id: task.id },
      include: {
        steps: true,
        toolCalls: true,
        llmCalls: true,
        finalMessage: true,
        eventLogs: true
      }
    });
  } catch (error) {
    if (error instanceof AgentRuntimeBudgetExceededError) {
      let finalMessage;
      try {
        const content = getBudgetLimitMessage(error.reason)
          + (completedEvidence?.toolResults.length
            ? `\n\n${renderEvidenceFallback(completedEvidence, "综合预算不足")}`
            : "");
        finalMessage = await tracer.limitExceededWithMessage(
          {
            roomId: task.roomId,
            senderType: "agent",
            senderAgentId: task.agentId,
            content,
            targetType: "all",
            status: "failed",
            metadata: {
              taskId: task.id,
              limitReason: error.reason,
              details: error.details
            } as Prisma.InputJsonObject
          },
          error.reason,
          error.details
        );
      } catch (failureError) {
        if (failureError instanceof AgentTaskLeaseLostError) {
          return findAgentTaskWithTrace(task.id);
        }
        throw failureError;
      }
      await appendChatLog(task.roomId, {
        kind: "message.agent",
        messageId: finalMessage.id,
        senderAgentId: task.agentId,
        taskId: task.id,
        status: "failed",
        content: finalMessage.content,
        createdAt: finalMessage.createdAt
      });
      return findAgentTaskWithTrace(task.id);
    }
    if (error instanceof ToolApprovalRequiredError) {
      return prisma.agentTask.findUniqueOrThrow({
        where: { id: task.id },
        include: {
          toolCalls: true,
          steps: true,
          llmCalls: true,
          finalMessage: true,
          eventLogs: true,
          toolApprovals: true
        }
      });
    }
    if (error instanceof AgentTaskLeaseLostError) {
      return prisma.agentTask.findUniqueOrThrow({
        where: { id: task.id },
        include: {
          toolCalls: true,
          steps: true,
          llmCalls: true,
          finalMessage: true,
          eventLogs: true,
          toolApprovals: true
        }
      });
    }
    const message = error instanceof Error ? error.message : "Agent task failed";
    const validationError = error instanceof AgentPlanValidationError ? error : null;
    let finalMessage;
    try {
      if (validationError) {
        await heartbeat.assertActive();
        await tracer.event("agent.plan.validation.failed", {
          source: validationError.source,
          errorCategory: validationError.category,
          issueCodes: validationError.issues.map((issue) => issue.code),
          issues: validationError.issues
        });
      }
      finalMessage = await tracer.failWithMessage(
        {
        roomId: task.roomId,
        senderType: "agent",
        senderAgentId: task.agentId,
        content: validationError
          ? "我无法确认这次任务的操作和参数，任务未完成。请把要做的事说得更具体一些后重试。"
          : "我刚才处理这个任务时遇到了问题，已经把错误记录下来了。你可以稍后重试，或者把任务说得更具体一点。",
        targetType: "all",
        status: "failed",
        metadata: {
          taskId: task.id,
          error: message,
          ...(validationError ? { errorCategory: "validation" } : {})
        }
        },
        message,
        validationError ? "validation" : "runtime"
      );
    } catch (failureError) {
      if (failureError instanceof AgentTaskLeaseLostError) {
        return prisma.agentTask.findUniqueOrThrow({
          where: { id: task.id },
          include: {
            toolCalls: true,
            steps: true,
            llmCalls: true,
            finalMessage: true,
            eventLogs: true,
            toolApprovals: true
          }
        });
      }
      throw failureError;
    }
    await appendChatLog(task.roomId, {
      kind: "message.agent",
      messageId: finalMessage.id,
      senderAgentId: task.agentId,
      taskId: task.id,
      status: "failed",
      content: finalMessage.content,
      createdAt: finalMessage.createdAt
    });
    return prisma.agentTask.findUniqueOrThrow({
      where: { id: task.id },
      include: {
        steps: true,
        toolCalls: true,
        llmCalls: true,
        finalMessage: true,
        eventLogs: true
      }
    });
  } finally {
    budget?.dispose();
    await heartbeat.stop();
  }
}

async function runBudgetedModelCall<
  Request extends LLMPlanRequest | LLMAnswerRequest,
  Result extends LLMPlanResult | LLMAnswerResult
>(input: {
  budget: AgentRuntimeBudget;
  provider: LLMProvider;
  request: Request;
  call: (request: Request) => Promise<Result>;
  inputSummary: string;
  requestPayload: unknown;
  roomId: string;
  taskId: string;
  assertLease: () => Promise<void>;
}): Promise<Result> {
  const reservation = await input.budget.reserveModelTurn({
    provider: input.provider.name,
    model: input.provider.model,
    inputSummary: input.inputSummary,
    request: input.request,
    requestPayload: input.requestPayload
  });
  const startedAt = Date.now();
  let result: Result | null = null;
  let completedLogAttempted = false;
  try {
    result = await input.call({
      ...input.request,
      maxCompletionTokens: reservation.maxCompletionTokens,
      signal: input.budget.signal
    });
    await input.assertLease();
    await input.budget.completeModelTurn(
      reservation,
      result,
      Date.now() - startedAt
    );
    completedLogAttempted = true;
    await appendCompletedLLMLog(input, result, startedAt);
    return result;
  } catch (error) {
    if (!(error instanceof AgentTaskLeaseLostError)) {
      try {
        await input.budget.failModelTurn(
          reservation,
          error,
          Date.now() - startedAt
        );
      } catch (traceError) {
        if (traceError instanceof AgentTaskLeaseLostError) throw traceError;
        console.error("[agent-runtime] failed to persist budgeted LLM failure", traceError);
      }
    }
    if (result) {
      if (!completedLogAttempted) {
        completedLogAttempted = true;
        await appendCompletedLLMLog(input, result, startedAt);
      }
    } else {
      const message = error instanceof Error ? error.message : "LLM call failed";
      await appendChatLog(input.roomId, {
        kind: "llm.call",
        taskId: input.taskId,
        provider: input.provider.name,
        model: input.provider.model,
        status: "failed",
        durationMs: Date.now() - startedAt,
        requestPayload: input.requestPayload,
        // 解析/校验失败时 result 为 null，把模型原始返回一并落盘，
        // 否则失败日志缺少现场（例如 tool_inputs 结构不符无法复现）。
        responsePayload: error instanceof AgentPlanValidationError ? error.rawResponse : undefined,
        error: message
      });
    }
    throw error;
  }
}

async function appendCompletedLLMLog(
  input: {
    provider: LLMProvider;
    requestPayload: unknown;
    roomId: string;
    taskId: string;
  },
  result: LLMPlanResult | LLMAnswerResult,
  startedAt: number
) {
  await appendChatLog(input.roomId, {
    kind: "llm.call",
    taskId: input.taskId,
    provider: input.provider.name,
    model: input.provider.model,
    status: "completed",
    durationMs: Date.now() - startedAt,
    requestPayload: input.requestPayload,
    responsePayload: result.rawResponse ?? result,
    tokens: {
      prompt: result.usage?.promptTokens,
      completion: result.usage?.completionTokens,
      total: result.usage?.totalTokens
    }
  });
}

function findAgentTaskWithTrace(taskId: string) {
  return prisma.agentTask.findUniqueOrThrow({
    where: { id: taskId },
    include: {
      steps: true,
      toolCalls: true,
      llmCalls: true,
      finalMessage: true,
      eventLogs: true,
      toolApprovals: true
    }
  });
}

export function readPersistedAgentPlan(
  value: unknown,
  registry: ToolRegistry = createToolRegistry(),
  allowedToolNames = registry.list().map((tool) => tool.name)
): AgentPlan | null {
  if (value === null || value === undefined) return null;
  return parseAgentPlan(value, registry, allowedToolNames, "persisted");
}

function getTaskPrompt(input: unknown) {
  if (typeof input === "object" && input !== null && "normalizedContent" in input) {
    const value = (input as { normalizedContent?: unknown }).normalizedContent;
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return JSON.stringify(input);
}

function getTaskTrigger(input: unknown): string | undefined {
  if (typeof input === "object" && input !== null && "trigger" in input) {
    const value = (input as { trigger?: unknown }).trigger;
    if (typeof value === "string") return value;
  }
  return undefined;
}

const SCHEDULER_TRIGGERS = new Set<string>([TRIGGER_SCHEDULED_JOB]);
const SCHEDULER_BLOCKED_TOOL_SET = new Set<string>(SCHEDULER_BLOCKED_TOOLS);

function isTriggeredByScheduler(trigger: string | undefined): boolean {
  return trigger !== undefined && SCHEDULER_TRIGGERS.has(trigger);
}

export function filterToolsForTrigger<T extends { name: string }>(
  tools: T[],
  trigger: string | undefined
): T[] {
  if (!isTriggeredByScheduler(trigger)) return tools;
  return tools.filter((t) => !SCHEDULER_BLOCKED_TOOL_SET.has(t.name));
}

function isPersistedAnswer(value: unknown): value is { text: string; mode: "model" | "fallback" } {
  if (typeof value !== "object" || value === null) return false;
  const answer = value as { text?: unknown; mode?: unknown };
  return typeof answer.text === "string" && answer.text.trim().length > 0
    && (answer.mode === "model" || answer.mode === "fallback");
}
