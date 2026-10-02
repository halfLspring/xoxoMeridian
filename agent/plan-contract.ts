import { z } from "zod";

import type { ToolRegistry } from "@/agent/tool-registry";
import type { AgentPlan } from "@/agent/types";

const agentPlanSchema = z.object({
  intent: z.string().min(1),
  confidence: z.number().min(0).max(1),
  requiredTools: z.array(z.string().min(1)),
  taskSteps: z.array(z.string()),
  finalResponsePlan: z.string(),
  finalResponseText: z.string(),
  toolInputs: z.record(z.string(), z.unknown())
});

type PlanSource = "planner" | "persisted" | "repaired";
type ContractIssue = {
  code: "invalid_json" | "invalid_structure" | "unknown_tool" | "tool_not_allowed"
    | "duplicate_tool" | "missing_tool_input" | "unexpected_tool_input"
    | "empty_tool_calls" | "invalid_tool_input";
  path: string;
  schemaCode?: string;
};

const MAX_ISSUES = 8;

export class AgentPlanValidationError extends Error {
  readonly category = "validation";
  readonly issues: ContractIssue[];
  /**
   * 解析失败时模型的原始返回，仅供失败日志排查。
   * 刻意用不可枚举属性承载（见 attachRawResponse）：不进入 JSON.stringify(error)，
   * 避免任意工具名/输入值随错误对象的序列化泄漏——这正是本契约的边界不变量。
   */
  declare rawResponse?: unknown;

  constructor(readonly source: PlanSource, issues: ContractIssue[]) {
    const boundedIssues = issues.slice(0, MAX_ISSUES);
    super(`Agent plan validation failed (${source}): ${boundedIssues
      .map((issue) => `${issue.code} at ${issue.path}`)
      .join("; ")}`.slice(0, 512));
    this.name = "AgentPlanValidationError";
    this.issues = boundedIssues;
  }
}

export function parseAgentPlan(
  value: unknown,
  registry: ToolRegistry,
  allowedToolNames: readonly string[],
  source: PlanSource
): AgentPlan {
  const parsed = agentPlanSchema.safeParse(value);
  if (!parsed.success) {
    throw new AgentPlanValidationError(source, parsed.error.issues.slice(0, MAX_ISSUES).map((issue) => ({
      code: "invalid_structure",
      // 只记录固定顶层字段；任意输入 key、值和 Zod 错误正文不进入摘要。
      path: typeof issue.path[0] === "string" && issue.path[0] in agentPlanSchema.shape
        ? issue.path[0] : "plan",
      schemaCode: issue.code
    })));
  }

  const plan = parsed.data;
  const tools = new Map(registry.list().map((tool) => [tool.name, tool]));
  const allowed = new Set(allowedToolNames);
  const required = new Set<string>();
  const issues: ContractIssue[] = [];
  const addIssue = (issue: ContractIssue) => {
    if (issues.length < MAX_ISSUES) issues.push(issue);
  };

  for (const [index, name] of plan.requiredTools.entries()) {
    const path = `requiredTools.${index}`;
    if (required.has(name)) addIssue({ code: "duplicate_tool", path });
    required.add(name);
    const tool = tools.get(name);
    if (!tool) {
      addIssue({ code: "unknown_tool", path });
      continue;
    }
    if (!allowed.has(name)) addIssue({ code: "tool_not_allowed", path });
    if (!Object.hasOwn(plan.toolInputs, name)) {
      addIssue({ code: "missing_tool_input", path });
      continue;
    }
    const input = plan.toolInputs[name];
    const calls = Array.isArray(input) ? input : [input];
    if (calls.length === 0) addIssue({ code: "empty_tool_calls", path });
    for (const [callIndex, call] of calls.entries()) {
      const result = tool.inputSchema.safeParse(call);
      if (!result.success) {
        addIssue({
          code: "invalid_tool_input",
          path: `${path}.calls.${callIndex}`,
          schemaCode: result.error.issues[0]?.code
        });
      }
    }
  }
  for (const name of Object.keys(plan.toolInputs)) {
    if (!required.has(name)) addIssue({ code: "unexpected_tool_input", path: "toolInputs" });
  }
  if (issues.length > 0) throw new AgentPlanValidationError(source, issues);
  return plan;
}

export function parsePlannerResponse(
  content: string,
  registry: ToolRegistry,
  allowedToolNames: readonly string[]
): AgentPlan {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    const error = new AgentPlanValidationError("planner", [{ code: "invalid_json", path: "plan" }]);
    attachRawResponse(error, { content });
    throw error;
  }
  const value = typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? raw as Record<string, unknown> : {};
  try {
    return parseAgentPlan({
      intent: value.intent,
      confidence: value.confidence,
      requiredTools: value.required_tools,
      taskSteps: value.task_steps,
      finalResponsePlan: value.final_response_plan,
      finalResponseText: value.final_response_text,
      // tool_inputs 可省略：无工具对话时模型常直接省略该字段（或给 null），
      // 归一为 {} 避免结构校验把可省略字段误判为失败；数组/字符串等非法形态仍照常拦截。
      toolInputs: value.tool_inputs ?? {}
    }, registry, allowedToolNames, "planner");
  } catch (error) {
    if (error instanceof AgentPlanValidationError) attachRawResponse(error, raw);
    throw error;
  }
}

/**
 * 把模型原始返回挂到错误上，但设为不可枚举：调用方可读 error.rawResponse 写调试日志，
 * 而 JSON.stringify(error) / 展开 / 逐属性拷贝都不会带出原始内容，守住"错误对象不泄漏输入"的边界。
 */
function attachRawResponse(error: AgentPlanValidationError, rawResponse: unknown): void {
  Object.defineProperty(error, "rawResponse", {
    value: rawResponse,
    enumerable: false,
    writable: true,
    configurable: true
  });
}
