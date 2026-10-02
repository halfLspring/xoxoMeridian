import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseAnswerResponse } from "@/agent/answer-evidence";
import { runAgentTask } from "@/agent/agent-runtime";
import { ExecutionTracer } from "@/agent/execution-tracer";
import { AgentTaskLeaseLostError } from "@/agent/task-claim";
import type { LLMAnswerRequest } from "@/agent/types";
import { readAnswerReferences } from "@/lib/answer-references";
import { getChatMessages } from "@/lib/chat-messages";
import { prisma } from "@/lib/prisma";
import { createTestRoom, createTestUser, resetTestDatabase } from "@/tests/integration/support/database";

const model = vi.hoisted(() => ({ plan: vi.fn(), synthesize: vi.fn(), supported: true }));
vi.mock("@/agent/llm-provider", () => ({ createLLMProvider: () => ({
  name: "references-test", model: "isolated-model", plan: model.plan,
  ...(model.supported ? { synthesize: model.synthesize } : {}),
}) }));
const sourceUrl = "https://weather.example.test/forecast";
let sequence = 0;
beforeEach(async () => {
  await resetTestDatabase();
  model.supported = true;
  sequence += 1;
  vi.stubEnv("WEATHER_PROVIDER", "qweather");
  vi.stubEnv("WEATHER_API_KEY", "isolated-weather");
  vi.stubEnv("QWEATHER_API_HOST", `references-${sequence}.invalid`);
  vi.stubEnv("QWEATHER_GEOAPI_HOST", `references-${sequence}.invalid`);
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const url = new URL(input);
    if (!url.hostname.endsWith(".invalid")) throw new Error("禁止测试访问真实供应商");
    if (url.pathname.endsWith("/city/lookup")) return Response.json({ code: "200", location: [{ id: "isolated-city", name: "重庆", adm1: "重庆", country: "中国", tz: "Asia/Shanghai" }] });
    if (url.pathname.endsWith("/weather/now")) return Response.json({ code: "200", updateTime: "2026-10-02T19:00+08:00", fxLink: sourceUrl, now: { obsTime: "2026-10-02T19:00+08:00", temp: "20", text: "小雨" } });
    if (url.pathname.endsWith("/weather/3d")) return Response.json({ code: "200", updateTime: "2026-10-02T19:00+08:00", fxLink: sourceUrl, daily: [{ fxDate: "2026-10-02", tempMax: "23", tempMin: "18", textDay: "小雨", textNight: "小雨" }] });
    throw new Error(`未预期的测试路径：${url.pathname}`);
  }));
  model.plan.mockReset().mockResolvedValue({
    intent: "weather_and_memo", confidence: 1, requiredTools: ["memo.create", "weather.get"], taskSteps: [],
    finalResponsePlan: "按实际结果回复", finalResponseText: "执行前草稿",
    toolInputs: { "memo.create": { title: "出门", content: "带伞" }, "weather.get": { city: "重庆", startDate: "2026-10-02", endDate: "2026-10-02" } },
  });
  model.synthesize.mockReset().mockImplementation(async (request: LLMAnswerRequest) => parseAnswerResponse(JSON.stringify({ blocks: [
    { text: "已保存出门备忘：带伞。", sourceIds: [] },
    { text: "10月2日重庆小雨，18～23℃。", sourceIds: ["s1"] },
  ] }), request));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
afterAll(() => prisma.$disconnect());

async function fixture(maxTurns = 3) {
  const user = await createTestUser();
  const room = await createTestRoom();
  await prisma.roomParticipant.create({ data: { roomId: room.id, userId: user.id } });
  const agent = await prisma.agent.create({ data: { slug: "references", displayName: "助手", description: "合成验证" } });
  const task = await prisma.agentTask.create({ data: {
    roomId: room.id, agentId: agent.id, requestedById: user.id, input: { normalizedContent: "记下带伞并查重庆今天的天气" },
    createdAt: new Date("2026-10-02T11:00:00Z"), maxTurns,
  } });
  return { room, task };
}
async function saved(taskId: string) {
  return prisma.agentTask.findUniqueOrThrow({ where: { id: taskId }, include: { finalMessage: true, steps: true } });
}
function referencesOf(message: { content: string; metadata: unknown } | null) {
  expect(message).not.toBeNull();
  const references = readAnswerReferences(message!.metadata, message!.content);
  expect(references?.sources[0].url).toBe(sourceUrl);
  expect(message!.content).not.toContain(sourceUrl);
  expect(message!.content.slice(references!.citations[0].start, references!.citations[0].end)).toContain("小雨");
  return references;
}

describe("来源关联与持久任务恢复", () => {
  it("保存来源、投影最小DTO，并在Final失权后复用综合和写入", async () => {
    const { room, task } = await fixture();
    const publish = vi.spyOn(ExecutionTracer.prototype, "completeWithMessage").mockImplementationOnce(async () => {
      const current = await prisma.agentTask.update({ where: { id: task.id }, data: { leaseExpiresAt: new Date(0) } });
      throw new AgentTaskLeaseLostError(task.id, current.attemptId!);
    });
    await runAgentTask(task.id, { workerId: "first" });
    const interrupted = await saved(task.id);
    expect(interrupted.finalMessage).toBeNull();
    expect(interrupted.steps.find((step) => step.stepKey === "synthesis")?.output).toMatchObject({ references: { version: 1 } });
    publish.mockRestore();
    await runAgentTask(task.id, { workerId: "recovered" });
    const final = await saved(task.id);
    expect(final.status).toBe("completed");
    const references = referencesOf(final.finalMessage);
    const messages = await getChatMessages(room.id);
    expect(messages[0].references).toEqual(references);
    expect(messages[0]).not.toHaveProperty("metadata");
    expect(model.plan).toHaveBeenCalledTimes(1);
    expect(model.synthesize).toHaveBeenCalledTimes(1);
    await runAgentTask(task.id, { workerId: "duplicate" });
    expect(await prisma.memo.count({ where: { roomId: room.id } })).toBe(1);
    expect(await prisma.message.count({ where: { roomId: room.id } })).toBe(1);
  });

  it.each(["provider_failure", "unsupported", "invalid_source", "budget"])("%s 降级仍分离正文和来源，写入只执行一次", async (mode) => {
    const { room, task } = await fixture(mode === "budget" ? 1 : 3);
    if (mode === "provider_failure") model.synthesize.mockRejectedValue(new Error("503"));
    if (mode === "unsupported") model.supported = false;
    if (mode === "invalid_source") model.synthesize.mockResolvedValue({ text: "不实回答", references: {
      version: 1, sources: [{ id: "s99", title: "虚构", url: "https://invented.test/", dates: [] }], citations: [{ start: 0, end: 4, sourceIds: ["s99"] }],
    } });
    await runAgentTask(task.id);
    const final = await saved(task.id);
    expect(final.status).toBe(mode === "budget" ? "limit_exceeded" : "completed");
    referencesOf(final.finalMessage);
    expect(final.finalMessage?.content).toContain("备忘录已保存");
    expect(final.finalMessage?.content).not.toMatch(/执行前草稿|不实回答|s99|503/);
    if (mode === "budget" || mode === "unsupported") expect(model.synthesize).not.toHaveBeenCalled();
    await runAgentTask(task.id);
    expect(await prisma.memo.count({ where: { roomId: room.id } })).toBe(1);
    expect(await prisma.message.count({ where: { roomId: room.id } })).toBe(1);
  });
});
