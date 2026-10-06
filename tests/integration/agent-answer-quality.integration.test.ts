import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runAgentTask } from "@/agent/agent-runtime";
import { ExecutionTracer } from "@/agent/execution-tracer";
import { AgentTaskLeaseLostError, claimAgentTask } from "@/agent/task-claim";
import type { AgentPlan, LLMAnswerRequest } from "@/agent/types";
import { prisma } from "@/lib/prisma";
import { queryBlogFeed } from "@/lib/blog-work/feed";
import { createTestRoom, createTestUser, resetTestDatabase } from "@/tests/integration/support/database";

// 仅替换模型边界；计划、工具、预算、lease、checkpoint 与最终消息使用真实 PostgreSQL。
const model = vi.hoisted(() => ({ plan: vi.fn(), synthesize: vi.fn() }));
vi.mock("@/agent/llm-provider", () => ({
  createLLMProvider: () => ({ name: "answer-test", model: "answer-model", ...model })
}));

const usage = { promptTokens: 100, completionTokens: 20, totalTokens: 120 };
const prompt = "记下出发清单和返程清单，再列出两份备忘内容。";
const plan: AgentPlan = {
  intent: "save_and_read_memos", confidence: 1,
  requiredTools: ["memo.create", "memo.list"],
  taskSteps: ["分别保存两份清单", "查询保存后的全部备忘"],
  finalResponsePlan: "按实际保存与查询结果答复",
  finalResponseText: "执行前的草稿不能代表已经完成。",
  toolInputs: {
    "memo.create": [
      { title: "出发清单", content: "带雨伞" },
      { title: "返程清单", content: "确认航班" }
    ],
    "memo.list": {}
  }
};

beforeEach(async () => {
  await resetTestDatabase();
  model.plan.mockReset().mockResolvedValue({ ...plan, usage });
  model.synthesize.mockReset().mockImplementation(async (request: LLMAnswerRequest) => {
    expect(request.prompt).toBe(prompt);
    expect(request.referenceTime).toBe("2026-09-22T10:00:00.000Z");
    expect(request.toolResults.map((result) => result.toolName)).toEqual([
      "memo.create", "memo.create", "memo.list"
    ]);
    const outputs = request.toolResults.map((result) => result.output);
    expect(outputs[0]).toMatchObject({ title: "出发清单", content: "带雨伞" });
    expect(outputs[1]).toMatchObject({ title: "返程清单", content: "确认航班" });
    expect(JSON.stringify(outputs[2])).toContain("出发清单");
    expect(JSON.stringify(outputs[2])).toContain("返程清单");
    return { text: "已保存两份备忘：出发清单：带雨伞；返程清单：确认航班。", usage };
  });
});

afterEach(() => vi.restoreAllMocks());
afterAll(async () => prisma.$disconnect());

async function fixture(maxTurns = 4) {
  const room = await createTestRoom();
  const user = await createTestUser();
  await prisma.roomParticipant.create({ data: { roomId: room.id, userId: user.id } });
  const agent = await prisma.agent.create({ data: {
    slug: `answer-quality-${room.id}`, displayName: "测试助手", description: "验证工具结果综合"
  } });
  const task = await prisma.agentTask.create({ data: {
    roomId: room.id, agentId: agent.id, requestedById: user.id,
    input: { normalizedContent: prompt, trigger: "mention" },
    createdAt: new Date("2026-09-22T10:00:00Z"), maxTurns,
    maxTokens: 100_000, maxCostMicros: 1_000_000,
    inputCostMicrosPerMillionTokens: 1_000_000, outputCostMicrosPerMillionTokens: 2_000_000
  } });
  return { room, task };
}

function readTask(taskId: string) {
  return prisma.agentTask.findUniqueOrThrow({
    where: { id: taskId },
    include: { finalMessage: true, toolCalls: true, llmCalls: true, steps: true, eventLogs: true, timelinePost: true }
  });
}

describe("工具查询结果综合的持久化与恢复", () => {
  it("保留同名工具的全部结果，按实际查询生成消息并累计两次模型预算", async () => {
    const { task, room } = await fixture(2);
    expect(await queryBlogFeed(task.requestedById!)).toEqual({ entries: [], nextCursor: null });
    await runAgentTask(task.id, { workerId: "answer-worker" });
    const saved = await readTask(task.id);

    expect(saved).toMatchObject({
      status: "completed", turnsUsed: 2, toolCallsUsed: 3, tokensUsed: 240, costUsedMicros: 280,
      finalMessage: { content: "已保存两份备忘：出发清单：带雨伞；返程清单：确认航班。" }
    });
    expect(saved.llmCalls).toHaveLength(2);
    expect(saved.llmCalls.every((call) => call.status === "completed")).toBe(true);
    expect(saved.toolCalls).toHaveLength(3);
    expect(saved.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ stepKey: "synthesis", status: "completed", attemptCount: 1 }),
      expect.objectContaining({ stepKey: "final", status: "completed" })
    ]));
    expect(saved.finalMessage?.content).not.toContain(plan.finalResponseText);
    expect(await prisma.memo.count({ where: { roomId: room.id } })).toBe(2);
    expect(saved.timelinePost).toMatchObject({ type: "agent_log", agentTaskId: task.id, roomId: room.id });
    expect(saved.timelinePost?.metadata).toMatchObject({ taskId: task.id });
    expect(saved.toolCalls.every(call => call.input !== null && call.output !== null && call.status === "completed")).toBe(true);
    expect(saved.llmCalls.every(call => call.requestPayload !== null && call.responsePayload !== null)).toBe(true);
    expect(saved.eventLogs).toEqual(expect.arrayContaining([expect.objectContaining({ type: "agent.task.completed" })]));
    const snapshot = async () => {
      const record = await readTask(task.id);
      // 全字段比对前固定关系顺序，数据库未承诺数组的默认读取顺序。
      for (const rows of [record.steps, record.toolCalls, record.llmCalls, record.eventLogs]) rows.sort((a, b) => a.id.localeCompare(b.id));
      return record;
    };
    const beforeHome = await snapshot();
    expect(await queryBlogFeed(task.requestedById!, { q: "memo.create", limit: 1 })).toEqual({ entries: [], nextCursor: null });
    expect(await queryBlogFeed(task.requestedById!)).toEqual({ entries: [], nextCursor: null });
    expect(await snapshot()).toEqual(beforeHome);
    await runAgentTask(task.id, { workerId: "answer-duplicate-worker" });
    expect(model.plan).toHaveBeenCalledTimes(1);
    expect(model.synthesize).toHaveBeenCalledTimes(1);
    expect(await prisma.message.count({ where: { roomId: room.id } })).toBe(1);
  });

  it("综合完成后在 Final 失权，恢复复用综合与工具结果而不重复副作用和消息", async () => {
    const { task, room } = await fixture(2);
    const publish = vi.spyOn(ExecutionTracer.prototype, "completeWithMessage");
    publish.mockImplementationOnce(async () => {
      const current = await prisma.agentTask.update({
        where: { id: task.id }, data: { leaseExpiresAt: new Date(0) }
      });
      throw new AgentTaskLeaseLostError(task.id, current.attemptId!);
    });
    await runAgentTask(task.id, { workerId: "before-final-worker" });
    const interrupted = await readTask(task.id);
    expect(interrupted.finalMessage).toBeNull();
    expect(interrupted.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ stepKey: "synthesis", status: "completed" })
    ]));
    publish.mockRestore();
    model.plan.mockRejectedValue(new Error("恢复不应再次规划"));
    model.synthesize.mockRejectedValue(new Error("完成的综合不应再次调用模型"));

    await runAgentTask(task.id, { workerId: "after-final-worker" });
    const recovered = await readTask(task.id);
    expect(recovered).toMatchObject({ status: "completed", attemptCount: 2, turnsUsed: 2, toolCallsUsed: 3 });
    expect(recovered.finalMessage?.content).toContain("出发清单：带雨伞；返程清单：确认航班");
    expect(recovered.llmCalls).toHaveLength(2);
    expect(recovered.toolCalls).toHaveLength(3);
    expect(model.synthesize).toHaveBeenCalledTimes(1);
    expect(await prisma.memo.count({ where: { roomId: room.id } })).toBe(2);
    expect(await prisma.message.count({ where: { roomId: room.id } })).toBe(1);
  });

  it("综合预算不足时写入明确终态，不把规划草稿作为成功答复", async () => {
    const { task, room } = await fixture(1);
    await runAgentTask(task.id, { workerId: "limited-answer-worker" });
    const saved = await readTask(task.id);
    expect(saved).toMatchObject({ status: "limit_exceeded", limitReason: "max_turns", turnsUsed: 1 });
    expect(saved.llmCalls).toHaveLength(1);
    expect(model.synthesize).not.toHaveBeenCalled();
    expect(saved.finalMessage?.content).not.toContain(plan.finalResponseText);
    expect(saved.finalMessage?.content).toMatch(/预算|上限|限制/);
    expect(saved.finalMessage?.content).toContain("出发清单");
    expect(saved.finalMessage?.content).toContain("返程清单");
    expect(await prisma.memo.count({ where: { roomId: room.id } })).toBe(2);
    await runAgentTask(task.id, { workerId: "limited-answer-retry" });
    expect(await prisma.message.count({ where: { roomId: room.id } })).toBe(1);
  });

  it("综合供应商返回 503 错误后，保留真实工具结果并持久化诚实的降级答复", async () => {
    const { task, room } = await fixture();
    // HTTP 状态到异常的映射由 Provider 边界测试覆盖；这里验证该异常在真实任务中的终态。
    model.synthesize.mockRejectedValueOnce(new Error("LLM synthesis request failed with 503."));
    await runAgentTask(task.id, { workerId: "unavailable-answer-worker" });
    const saved = await readTask(task.id);
    expect(saved).toMatchObject({ status: "completed", turnsUsed: 2, toolCallsUsed: 3 });
    expect(saved.llmCalls.map((call) => call.status).sort()).toEqual(["completed", "failed"]);
    expect(saved.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ stepKey: "synthesis", status: "completed", output: expect.objectContaining({ mode: "fallback" }) })
    ]));
    expect(saved.finalMessage?.content).toMatch(/暂时未能.*综合分析/);
    expect(saved.finalMessage?.content).toContain("出发清单");
    expect(saved.finalMessage?.content).toContain("返程清单");
    expect(saved.finalMessage?.content).not.toContain(plan.finalResponseText);
    expect(saved.finalMessage?.content).not.toContain("503");
    expect(await prisma.memo.count({ where: { roomId: room.id } })).toBe(2);
    await runAgentTask(task.id, { workerId: "unavailable-answer-retry" });
    expect(model.synthesize).toHaveBeenCalledTimes(1);
    expect(await prisma.message.count({ where: { roomId: room.id } })).toBe(1);
  });

  it("综合期间 lease 被接管，旧 worker 的模型结果不能写成最终消息", async () => {
    const { task, room } = await fixture();
    model.synthesize.mockImplementationOnce(async () => {
      await prisma.agentTask.update({ where: { id: task.id }, data: { leaseExpiresAt: new Date(0) } });
      const replacement = await claimAgentTask(task.id, { workerId: "replacement-worker", leaseDurationMs: 60_000 });
      expect(replacement.claimed).toBe(true);
      return { text: "旧 worker 不应发布的回复", usage };
    });
    await runAgentTask(task.id, { workerId: "stale-answer-worker" });
    const saved = await readTask(task.id);
    expect(saved).toMatchObject({ status: "running", workerId: "replacement-worker", finalMessageId: null });
    expect(saved.steps.find((step) => step.stepKey === "synthesis")?.status).not.toBe("completed");
    expect(await prisma.message.count({ where: { roomId: room.id } })).toBe(0);
    expect(await prisma.memo.count({ where: { roomId: room.id } })).toBe(2);
  });
});
