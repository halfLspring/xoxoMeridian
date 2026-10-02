import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 只替换 Next 请求容器；Cookie 签名、Session 查询、授权和全部领域写入均使用真实实现及 PostgreSQL。
const requestContext = vi.hoisted(() => ({ cookieValue: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => name === "xoxo_session" && requestContext.cookieValue
      ? { name, value: requestContext.cookieValue }
      : undefined,
    set: vi.fn()
  }),
  headers: async () => new Headers({ host: "localhost" })
}));

import { runAgentTask } from "@/agent/agent-runtime";
import { buildAgentContext } from "@/agent/context-builder";
import { clearAllTimers, drainSchedulerTasks, schedulerTick } from "@/agent/scheduler-tick";
import { DELETE as clearConversation, GET as getConversation } from "@/app/api/agent/conversation/route";
import { POST as sendConversation } from "@/app/api/agent/conversation/messages/route";
import { POST as dispatchTask } from "@/app/api/agent/dispatch/route";
import { GET as getAgentStatus } from "@/app/api/agent/status/route";
import { GET as getTask } from "@/app/api/agent/tasks/[taskId]/route";
import { GET as getApprovals, POST as decideApproval } from "@/app/api/agent/tasks/[taskId]/approvals/route";
import { POST as runTask } from "@/app/api/agent/tasks/[taskId]/run/route";
import { GET as getTrace } from "@/app/api/agent/tasks/[taskId]/trace/route";
import { DELETE as deleteRoom } from "@/app/api/rooms/[roomId]/route";
import { GET as getRoomMessages, POST as sendRoomMessage } from "@/app/api/rooms/[roomId]/messages/route";
import { GET as getRoomStream } from "@/app/api/rooms/[roomId]/stream/route";
import { POST as createSharedRoom } from "@/app/api/rooms/route";
import { assertRoomAccess, getDefaultRoomForUser } from "@/lib/access";
import { getAgentConversationSnapshot, sendAgentConversationMessage } from "@/lib/agent-conversation";
import { projectAgentTaskTimeline, recoverPendingTimelineProjections } from "@/lib/agent-posts";
import { createSessionCookie, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { deleteRoomPreservingUserMembership } from "@/lib/room-lifecycle";
import { listRoomsForUser } from "@/lib/room-list";
import { getStudyRoomForUser } from "@/lib/study";
import { createTestRoom, createTestUser, resetTestDatabase } from "@/tests/integration/support/database";

beforeEach(async () => {
  requestContext.cookieValue = undefined;
  clearAllTimers();
  await resetTestDatabase();
});

afterEach(async () => {
  clearAllTimers();
  await drainSchedulerTasks(5_000);
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function fixture() {
  const alice = await createTestUser({ displayName: "私聊 A", avatarLabel: "A" });
  const bob = await createTestUser({ displayName: "私聊 B", avatarLabel: "B" });
  const agent = await prisma.agent.create({
    data: { slug: "life-assistant", displayName: "小助手", description: "私聊验证" }
  });
  return { alice, bob, agent };
}

async function authenticate(userId: string) {
  requestContext.cookieValue = undefined;
  const session = await createSessionCookie(userId);
  requestContext.cookieValue = session.cookie.value;
  return session;
}

function request(path: string, viewerId: string, body?: unknown) {
  return new Request(`http://localhost${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", "X-Agent-Viewer-Id": viewerId },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}

function taskParams(taskId: string) {
  return { params: Promise.resolve({ taskId }) };
}

function roomParams(roomId: string) {
  return { params: Promise.resolve({ roomId }) };
}

function send(userId: string, content = "私聊正文", clientMessageId = randomUUID()) {
  return sendAgentConversationMessage({ userId, content, clientMessageId });
}

function expectPrivateCache(response: Response) {
  expect(response.headers.get("Cache-Control")).toContain("private");
  expect(response.headers.get("Cache-Control")).toContain("no-store");
  expect(response.headers.get("CDN-Cache-Control")).toBe("no-store");
  expect(response.headers.get("Vary")).toContain("Cookie");
}

async function businessCounts() {
  const [rooms, messages, tasks, events, approvals] = await Promise.all([
    prisma.room.count(), prisma.message.count(), prisma.agentTask.count(),
    prisma.eventLog.count(), prisma.agentToolApproval.count()
  ]);
  return { rooms, messages, tasks, events, approvals };
}

describe("Agent 专属对话的事务与快照", () => {
  it("读取不存在的会话不建房，两个用户分别拥有唯一私聊", async () => {
    const { alice, bob } = await fixture();
    expect(await getAgentConversationSnapshot(alice)).toMatchObject({
      currentUser: { id: alice.id }, roomId: null, messages: [], tasks: [], pendingApprovals: []
    });
    expect(await prisma.room.count()).toBe(0);
    const [a, b] = await Promise.all([send(alice.id, "仅 A 可见"), send(bob.id, "仅 B 可见")]);
    expect(a.roomId).not.toBe(b.roomId);
    expect(await prisma.room.findMany({ orderBy: { privateOwnerId: "asc" } })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: a.roomId, kind: "agent_private", privateOwnerId: alice.id, maxHumanUsers: 1 }),
        expect.objectContaining({ id: b.roomId, kind: "agent_private", privateOwnerId: bob.id, maxHumanUsers: 1 })
      ])
    );
    const snapshot = await getAgentConversationSnapshot(alice);
    expect(snapshot.messages).toEqual([expect.objectContaining({ role: "user", content: "仅 A 可见" })]);
    expect(JSON.stringify(snapshot)).not.toContain("仅 B 可见");
    expect(JSON.stringify(snapshot)).not.toContain(alice.passwordHash);
    expect(JSON.stringify(snapshot)).not.toContain(alice.email);
    expect(JSON.stringify(snapshot)).not.toContain(bob.id);
  });

  it("私聊来源仅对所有者投影，共享API不能读取，也不泄漏完整metadata", async () => {
    const { alice, bob, agent } = await fixture();
    const accepted = await send(alice.id);
    const content = "私聊展览十点开放。";
    const references = {
      version: 1, sources: [{ id: "s1", title: "仅A的来源", url: "https://private-source.example.test/", dates: [] }],
      citations: [{ start: 0, end: content.length, sourceIds: ["s1"] }],
    };
    await prisma.message.create({ data: {
      roomId: accepted.roomId, senderType: "agent", senderAgentId: agent.id, content,
      metadata: { answerReferences: references, toolResults: [{ output: "never-project-this" }] },
    } });
    await authenticate(alice.id);
    const own = await getConversation(request("/api/agent/conversation", alice.id));
    expect(own.status).toBe(200);
    const snapshot = await own.json();
    expect(snapshot.messages.at(-1).references).toEqual(references);
    expect(JSON.stringify(snapshot)).not.toContain("never-project-this");
    expect((await getRoomMessages(request(`/api/rooms/${accepted.roomId}/messages`, alice.id), roomParams(accepted.roomId))).status).toBe(403);
    await authenticate(bob.id);
    const other = await getConversation(request("/api/agent/conversation", bob.id));
    expect(JSON.stringify(await other.json())).not.toContain("private-source");
    expect((await getRoomMessages(request(`/api/rooms/${accepted.roomId}/messages`, bob.id), roomParams(accepted.roomId))).status).toBe(403);
  });

  it("并发首次发送及同键重试只创建一个房间、一条消息和一个任务，私聊原文不被触发解析改变", async () => {
    const { alice } = await fixture();
    const content = "  /agent @agent 请保留\n\n    const answer = 42;\n末行  ";
    const key = randomUUID();
    const results = await Promise.all(Array.from({ length: 6 }, () => send(alice.id, content, key)));
    expect(new Set(results.map((result) => result.roomId)).size).toBe(1);
    expect(new Set(results.map((result) => result.message.id)).size).toBe(1);
    expect(new Set(results.map((result) => result.task.id)).size).toBe(1);
    expect(results.filter((result) => !result.replayed)).toHaveLength(1);
    expect(await businessCounts()).toEqual({ rooms: 1, messages: 1, tasks: 1, events: 1, approvals: 0 });
    expect(await prisma.roomParticipant.count()).toBe(1);
    expect(await prisma.agentTask.findUniqueOrThrow({ where: { id: results[0].task.id } })).toMatchObject({
      requestedById: alice.id,
      sourceMessageId: results[0].message.id,
      input: { normalizedContent: content.trim() }
    });
    expect(results[0].message.content).toBe(content.trim());
    for (const privateField of ["input", "plan", "result", "workerId", "maxTokens", "requestedById"]) {
      expect(results[0].task).not.toHaveProperty(privateField);
    }
    await Promise.all([send(alice.id, "第二条"), send(alice.id, "第三条")]);
    expect(await businessCounts()).toEqual({ rooms: 1, messages: 3, tasks: 3, events: 3, approvals: 0 });
  });

  it("同键异文返回 409，Agent 禁用后仍可读回已接受结果，新发送零写入", async () => {
    const { alice, agent } = await fixture();
    const key = randomUUID();
    const accepted = await send(alice.id, "已接受正文", key);
    await expect(send(alice.id, "换了一段正文", key)).rejects.toMatchObject({ status: 409 });
    await prisma.agent.update({ where: { id: agent.id }, data: { enabled: false } });
    expect(await send(alice.id, "已接受正文", key)).toMatchObject({
      message: { id: accepted.message.id }, task: { id: accepted.task.id }, replayed: true
    });
    const before = await businessCounts();
    await expect(send(alice.id, "不可被接受的新正文")).rejects.toMatchObject({ status: 503 });
    expect(await businessCounts()).toEqual(before);
  });

  it("任务事件写入失败回滚首次建房、消息及任务，随后同键可成功重试", async () => {
    const { alice } = await fixture();
    const key = randomUUID();
    await prisma.$executeRawUnsafe(`CREATE FUNCTION fail_private_created_event() RETURNS trigger AS $$
      BEGIN IF NEW.type = 'agent.task.created' THEN RAISE EXCEPTION 'private task event failure'; END IF;
      RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER fail_private_created_event_trigger BEFORE INSERT ON "EventLog"
      FOR EACH ROW EXECUTE FUNCTION fail_private_created_event()`);
    try {
      await expect(send(alice.id, "原子发送", key)).rejects.toThrow();
      expect(await businessCounts()).toEqual({ rooms: 0, messages: 0, tasks: 0, events: 0, approvals: 0 });
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS fail_private_created_event_trigger ON "EventLog"');
      await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS fail_private_created_event()");
    }
    await send(alice.id, "原子发送", key);
    expect(await businessCounts()).toEqual({ rooms: 1, messages: 1, tasks: 1, events: 1, approvals: 0 });
  });

  it("只返回最后 80 条合法角色消息且同时间按 ID 稳定排序，不泄漏原始任务错误", async () => {
    const { alice, agent } = await fixture();
    const accepted = await send(alice.id);
    await prisma.message.createMany({
      data: Array.from({ length: 90 }, (_, index) => ({
        id: `private-history-${String(index).padStart(3, "0")}`,
        roomId: accepted.roomId, senderId: alice.id, senderType: "human" as const,
        content: `历史 ${index}`, createdAt: new Date("2030-01-01T00:00:00Z")
      }))
    });
    await prisma.message.create({ data: {
      roomId: accepted.roomId, senderType: "system", content: "INTERNAL_SYSTEM_MARKER",
      createdAt: new Date("2030-01-01T00:00:02Z")
    } });
    const finalMessage = await prisma.message.create({ data: {
      roomId: accepted.roomId, senderType: "agent", senderAgentId: agent.id,
      content: "任务暂时未完成", createdAt: new Date("2030-01-01T00:00:01Z")
    } });
    await prisma.agentTask.update({ where: { id: accepted.task.id }, data: {
      status: "failed", error: "INTERNAL_PRIVATE_DATABASE_PASSWORD", finalMessageId: finalMessage.id
    } });
    const snapshot = await getAgentConversationSnapshot(alice);
    expect(snapshot.messages).toHaveLength(80);
    expect(snapshot.messages[0].id).toBe("private-history-011");
    expect(snapshot.messages.at(-1)).toMatchObject({ id: finalMessage.id, role: "agent", taskId: accepted.task.id });
    const ids = snapshot.messages.slice(0, -1).map((message) => message.id);
    expect(ids).toEqual([...ids].sort());
    expect(JSON.stringify(snapshot)).not.toContain("INTERNAL_PRIVATE_DATABASE_PASSWORD");
    expect(JSON.stringify(snapshot)).not.toContain("INTERNAL_SYSTEM_MARKER");
  });
});

describe("真实 Session 与私聊接口隔离", () => {
  it("清空只删除本人私聊消息、任务追踪和上下文，保留独立生活数据并允许重新对话", async () => {
    const { alice, bob, agent } = await fixture();
    const own = await send(alice.id, "需要删除的私聊");
    const other = await send(bob.id, "其他用户的私聊");
    const shared = await createTestRoom();
    await prisma.message.create({ data: { roomId: shared.id, senderId: alice.id, senderType: "human", content: "共享消息" } });
    await prisma.agentStep.create({ data: { taskId: own.task.id, stepKey: "plan", kind: "plan", status: "completed" } });
    await prisma.toolCall.create({ data: { taskId: own.task.id, stepKey: "tool:1", toolName: "memo.list", status: "completed" } });
    await prisma.lLMCall.create({ data: { taskId: own.task.id, provider: "mock", model: "mock", inputSummary: "私聊", status: "completed" } });
    await prisma.agentToolApproval.create({ data: { taskId: own.task.id, stepKey: "tool:2", toolName: "memo.delete", risk: "high", input: {} } });
    await prisma.messageSummary.create({ data: { roomId: own.roomId, summary: "旧对话摘要" } });
    await prisma.memory.create({ data: { roomId: own.roomId, userId: alice.id, ownerKey: `user:${alice.id}`, key: "person.preference", value: "旧记忆" } });
    const memo = await prisma.memo.create({ data: { roomId: own.roomId, title: "独立备忘录", content: "保留" } });
    const job = await prisma.scheduledJob.create({ data: {
      roomId: own.roomId, agentId: agent.id, cron: "0 12 * * *", timezone: "UTC",
      nextRunAt: new Date("2035-01-01"), payload: { prompt: "保留计划" },
    } });
    await authenticate(alice.id);
    const response = await clearConversation(new Request("http://localhost/api/agent/conversation", {
      method: "DELETE", headers: { "X-Agent-Viewer-Id": alice.id },
    }));
    expect(response.status).toBe(200);
    expectPrivateCache(response);
    expect(await response.json()).toMatchObject({ currentUserId: alice.id, roomId: own.roomId });
    expect(await getAgentConversationSnapshot(alice)).toMatchObject({ messages: [], tasks: [], pendingApprovals: [] });
    expect(await prisma.message.count({ where: { roomId: own.roomId } })).toBe(0);
    expect(await prisma.agentTask.count({ where: { roomId: own.roomId } })).toBe(0);
    expect(await prisma.eventLog.count({ where: { roomId: own.roomId } })).toBe(0);
    expect(await prisma.agentStep.count({ where: { taskId: own.task.id } })).toBe(0);
    expect(await prisma.toolCall.count({ where: { taskId: own.task.id } })).toBe(0);
    expect(await prisma.lLMCall.count({ where: { taskId: own.task.id } })).toBe(0);
    expect(await prisma.agentToolApproval.count({ where: { taskId: own.task.id } })).toBe(0);
    expect(await prisma.messageSummary.count({ where: { roomId: own.roomId } })).toBe(0);
    expect(await prisma.memory.count({ where: { roomId: own.roomId } })).toBe(0);
    expect(await prisma.memo.findUnique({ where: { id: memo.id } })).not.toBeNull();
    expect(await prisma.scheduledJob.findUnique({ where: { id: job.id } })).not.toBeNull();
    expect(await prisma.message.count({ where: { roomId: other.roomId } })).toBe(1);
    expect(await prisma.agentTask.count({ where: { roomId: other.roomId } })).toBe(1);
    expect(await prisma.message.count({ where: { roomId: shared.id } })).toBe(1);
    const next = await send(alice.id, "新的私聊");
    expect(next.roomId).toBe(own.roomId);
    expect((await getAgentConversationSnapshot(alice)).messages.map((message) => message.content)).toEqual(["新的私聊"]);
  });

  it("清空拒绝身份不符或正在执行的任务，并保持数据库原样", async () => {
    const { alice, bob } = await fixture();
    const own = await send(alice.id, "不能误删的消息");
    await authenticate(bob.id);
    const wrongViewer = await clearConversation(new Request("http://localhost/api/agent/conversation", {
      method: "DELETE", headers: { "X-Agent-Viewer-Id": alice.id },
    }));
    expect(wrongViewer.status).toBe(401);
    expectPrivateCache(wrongViewer);
    expect(await prisma.message.count({ where: { roomId: own.roomId } })).toBe(1);
    await authenticate(alice.id);
    await prisma.agentTask.update({ where: { id: own.task.id }, data: { status: "running" } });
    const active = await clearConversation(new Request("http://localhost/api/agent/conversation", {
      method: "DELETE", headers: { "X-Agent-Viewer-Id": alice.id },
    }));
    expect(active.status).toBe(409);
    expectPrivateCache(active);
    expect(await prisma.message.count({ where: { roomId: own.roomId } })).toBe(1);
    expect(await prisma.agentTask.findUnique({ where: { id: own.task.id } })).not.toBeNull();
  });

  it("Cookie B 携带旧 A 身份时读取、发送与 B 任务审批均拒绝，零写入且 B 会话继续有效", async () => {
    const { alice, bob } = await fixture();
    const accepted = await send(bob.id, "B 已有任务");
    await prisma.agentTask.update({ where: { id: accepted.task.id }, data: { status: "waiting_approval" } });
    const approval = await prisma.agentToolApproval.create({ data: {
      taskId: accepted.task.id, stepKey: "tool:1", toolName: "memo.delete", risk: "high", input: { memoId: "memo-b" }
    } });
    const session = await authenticate(bob.id);
    const before = await businessCounts();
    const routes = [
      () => getConversation(request("/api/agent/conversation", alice.id)),
      () => sendConversation(request("/api/agent/conversation/messages", alice.id, { content: "A 旧草稿", clientMessageId: randomUUID() })),
      () => decideApproval(request(`/api/agent/tasks/${accepted.task.id}/approvals`, alice.id,
        { approvalId: approval.id, decision: "approve" }), taskParams(accepted.task.id))
    ];
    for (const invoke of routes) {
      const response = await invoke();
      expect(response.status).toBe(401);
      expectPrivateCache(response);
    }
    expect(await businessCounts()).toEqual(before);
    expect(await prisma.agentToolApproval.findUniqueOrThrow({ where: { id: approval.id } })).toMatchObject({ status: "pending", decidedById: null });
    expect(await prisma.agentTask.findUniqueOrThrow({ where: { id: accepted.task.id } })).toMatchObject({ status: "waiting_approval" });
    expect(await prisma.session.findUnique({ where: { id: session.sessionId } })).not.toBeNull();
    expect(await getCurrentUser()).toMatchObject({ id: bob.id });
    expect(await prisma.message.count({ where: { content: "A 旧草稿" } })).toBe(0);
    const success = await getConversation(request("/api/agent/conversation", bob.id));
    expect(success.status).toBe(200);
    expectPrivateCache(success);
  });

  it("B 猜到 A 的私聊房间和任务 ID 仍不能读取、执行、审批、追踪或从共享入口写入", async () => {
    const { alice, bob } = await fixture();
    const accepted = await send(alice.id, "A 保密正文");
    const approval = await prisma.agentToolApproval.create({ data: {
      taskId: accepted.task.id, stepKey: "tool:1", toolName: "memo.delete", risk: "high", input: { memoId: "memo-a" }
    } });
    await authenticate(bob.id);
    const before = await businessCounts();
    const taskPath = `/api/agent/tasks/${accepted.task.id}`;
    for (const invoke of [
      () => getTask(request(taskPath, bob.id), taskParams(accepted.task.id)),
      () => getTrace(request(`${taskPath}/trace`, bob.id), taskParams(accepted.task.id)),
      () => getApprovals(request(`${taskPath}/approvals`, bob.id), taskParams(accepted.task.id)),
      () => runTask(request(`${taskPath}/run`, bob.id, {}), taskParams(accepted.task.id)),
      () => decideApproval(request(`${taskPath}/approvals`, bob.id, { approvalId: approval.id, decision: "approve" }), taskParams(accepted.task.id))
    ]) {
      const response = await invoke();
      expect(response.status).toBe(403);
      expectPrivateCache(response);
      expect(await response.text()).not.toContain("A 保密正文");
    }
    await expect(assertRoomAccess(accepted.roomId, bob.id)).rejects.toMatchObject({ status: 403 });
    expect(await businessCounts()).toEqual(before);

    // 所有者也不能借双人 Chat API 访问私聊，避免同一数据出现两套写入协议。
    await authenticate(alice.id);
    const roomPath = `/api/rooms/${accepted.roomId}`;
    for (const invoke of [
      () => getRoomMessages(request(`${roomPath}/messages`, alice.id), roomParams(accepted.roomId)),
      () => sendRoomMessage(request(`${roomPath}/messages`, alice.id, { content: "旁路正文" }), roomParams(accepted.roomId)),
      () => getRoomStream(request(`${roomPath}/stream`, alice.id), roomParams(accepted.roomId)),
      () => deleteRoom(new Request(`http://localhost${roomPath}`, { method: "DELETE" }), roomParams(accepted.roomId)),
      () => dispatchTask(request("/api/agent/dispatch", alice.id, { roomId: accepted.roomId, content: "旁路正文" }))
    ]) {
      expect((await invoke()).status).toBe(403);
    }
    expect(await businessCounts()).toEqual(before);
  });

  it("读取和发送强制身份头，真实 owner 可发送、查询及批准自己的任务", async () => {
    const { alice } = await fixture();
    await authenticate(alice.id);
    const missing = await getConversation(new Request("http://localhost/api/agent/conversation"));
    expect(missing.status).toBe(400);
    expectPrivateCache(missing);
    const response = await sendConversation(request("/api/agent/conversation/messages", alice.id, {
      content: "真实接口发送", clientMessageId: randomUUID()
    }));
    expect(response.status).toBe(201);
    expectPrivateCache(response);
    const accepted = await response.json() as { roomId: string; task: { id: string } };
    await prisma.agentTask.update({ where: { id: accepted.task.id }, data: { status: "waiting_approval" } });
    const approval = await prisma.agentToolApproval.create({ data: {
      taskId: accepted.task.id, stepKey: "tool:1", toolName: "memo.delete", risk: "high", input: { memoId: "own-memo" }
    } });
    const snapshot = await getAgentConversationSnapshot(alice);
    expect(snapshot.pendingApprovals).toEqual([expect.objectContaining({ id: approval.id, taskId: accepted.task.id })]);
    const decision = await decideApproval(request(`/api/agent/tasks/${accepted.task.id}/approvals`, alice.id,
      { approvalId: approval.id, decision: "approve" }), taskParams(accepted.task.id));
    expect(decision.status).toBe(200);
    expectPrivateCache(decision);
    expect(await prisma.agentToolApproval.findUniqueOrThrow({ where: { id: approval.id } })).toMatchObject({ status: "approved", decidedById: alice.id });
    expect(await prisma.agentTask.findUniqueOrThrow({ where: { id: accepted.task.id } })).toMatchObject({ status: "pending" });
  });
});

describe("共享入口、Context、Scheduler 与投影的用途边界", () => {
  it("私聊比剩余共享房更早时 Chat / Study 仍选共享房，私聊不能解除最后共享房删除限制", async () => {
    const { alice, bob } = await fixture();
    const accepted = await send(alice.id);
    const first = await createTestRoom();
    const remaining = await createTestRoom();
    await prisma.roomParticipant.updateMany({ where: { roomId: accepted.roomId }, data: { joinedAt: new Date("2020-01-01") } });
    await prisma.roomParticipant.createMany({ data: [
      { roomId: first.id, userId: alice.id, role: "owner", joinedAt: new Date("2019-01-01") },
      { roomId: remaining.id, userId: alice.id, role: "owner", joinedAt: new Date("2021-01-01") },
      { roomId: remaining.id, userId: bob.id, role: "member", joinedAt: new Date("2021-01-01") }
    ] });
    expect(await deleteRoomPreservingUserMembership(first.id, alice.id)).toEqual({ status: "deleted" });
    expect((await getDefaultRoomForUser(alice)).id).toBe(remaining.id);
    expect((await getStudyRoomForUser(alice.id)).id).toBe(remaining.id);
    expect((await listRoomsForUser(alice.id)).map((room) => room.id)).toEqual([remaining.id]);
    expect(await deleteRoomPreservingUserMembership(remaining.id, alice.id)).toEqual({ status: "last-room" });
    await authenticate(alice.id);
    const status = await getAgentStatus();
    expect(await status.json()).toMatchObject({ runningTasks: 0, recentTasks: [], pendingApprovals: [] });
    const created = await createSharedRoom(request("/api/rooms", alice.id, { name: "共享新会话" }));
    expect(created.status).toBe(201);
    const payload = await created.json() as { room: { id: string } };
    const members = await prisma.roomParticipant.findMany({ where: { roomId: payload.room.id } });
    expect(members.map((member) => member.userId).sort()).toEqual([alice.id, bob.id].sort());
    expect(await prisma.room.findUniqueOrThrow({ where: { id: payload.room.id } })).toMatchObject({ kind: "shared", privateOwnerId: null });
  });

  it("非空的 A/B 私聊和共享数据在 Context 中严格隔离，异常私聊成员集合拒绝使用", async () => {
    const { alice, bob, agent } = await fixture();
    const a = await send(alice.id, "A_PRIVATE_MESSAGE");
    const b = await send(bob.id, "B_PRIVATE_MESSAGE");
    const shared = await createTestRoom();
    await prisma.roomParticipant.createMany({ data: [
      { roomId: shared.id, userId: alice.id }, { roomId: shared.id, userId: bob.id }
    ] });
    await prisma.userProfile.createMany({ data: [
      { userId: alice.id, city: "A_PRIVATE_CITY", country: "A", timezone: "Asia/Shanghai", profileNote: "A_PROFILE_NOTE" },
      { userId: bob.id, city: "B_PRIVATE_CITY", country: "B", timezone: "Europe/London", profileNote: "B_PROFILE_NOTE" }
    ] });
    for (const [roomId, ownerId, marker] of [
      [a.roomId, alice.id, "A_PRIVATE"], [b.roomId, bob.id, "B_PRIVATE"], [shared.id, alice.id, "SHARED_ONLY"]
    ]) {
      await seedScope(roomId, ownerId, agent.id, marker);
    }
    const context = await buildAgentContext(a.roomId, alice.id);
    expect(context.roomContext).toMatchObject({
      requestedById: alice.id, self: { userId: alice.id, profileNote: "A_PROFILE_NOTE" }, partner: null,
      participants: [expect.objectContaining({ userId: alice.id })],
      semanticMemory: { aboutMe: [{ key: "me.preference", value: "A_PRIVATE_PERSONAL_MEMORY" }], aboutHer: [] }
    });
    const serialized = JSON.stringify(context);
    for (const suffix of ["MESSAGE", "MEMO", "PERSONAL_MEMORY", "SHARED_MEMORY", "GLOBAL_SUMMARY", "RANGE_SUMMARY", "SCHEDULE"]) {
      expect(serialized).toContain(`A_PRIVATE_${suffix}`);
    }
    expect(serialized).not.toContain("B_PRIVATE");
    expect(serialized).not.toContain("B_PROFILE_NOTE");
    expect(serialized).not.toContain("SHARED_ONLY");
    await expect(buildAgentContext(a.roomId, bob.id)).rejects.toBeDefined();
    await prisma.roomParticipant.create({ data: { roomId: a.roomId, userId: bob.id } });
    await expect(buildAgentContext(a.roomId, alice.id)).rejects.toBeDefined();
    await expect(getAgentConversationSnapshot(alice)).rejects.toMatchObject({ status: 403 });
    await expect(assertRoomAccess(a.roomId, bob.id)).rejects.toMatchObject({ status: 403 });
  });

  it("Scheduler 空请求者沿真实 Runtime 恢复私聊 owner，并让 memory.recall 读取本人的 me.*", async () => {
    const { alice, agent } = await fixture();
    const accepted = await send(alice.id);
    await prisma.memory.create({ data: {
      roomId: accepted.roomId, userId: alice.id, ownerKey: `user:${alice.id}`,
      key: "person.preference", value: "SCHEDULE_OWNER_MEMORY"
    } });
    const now = new Date();
    const job = await prisma.scheduledJob.create({ data: {
      roomId: accepted.roomId, agentId: agent.id, cron: "*/5 * * * *", timezone: "UTC",
      payload: { prompt: "回顾我的个人偏好" }, nextRunAt: new Date(now.getTime() - 1000)
    } });
    expect((await schedulerTick(now)).jobs.fired).toBe(1);
    const scheduled = await prisma.agentTask.findFirstOrThrow({ where: { input: { path: ["jobId"], equals: job.id } } });
    expect(scheduled.requestedById).toBeNull();
    expect((await buildAgentContext(accepted.roomId, scheduled.requestedById)).roomContext).toMatchObject({ requestedById: alice.id, partner: null });
    // 固定测试计划替代外部模型；保留完整 Runtime / Registry / lease / 工具读库过程。
    await prisma.agentTask.update({ where: { id: scheduled.id }, data: { plan: {
      intent: "recall_owner", confidence: 1, requiredTools: ["memory.recall"], taskSteps: ["读取个人记忆"],
      finalResponsePlan: "报告记忆", finalResponseText: "已经读到你的个人偏好。", toolInputs: { "memory.recall": { prefix: "me." } }
    } } });
    await runAgentTask(scheduled.id, { workerId: "private-scheduler-test", leaseDurationMs: 60_000, heartbeatIntervalMs: 30_000 });
    const result = await prisma.agentTask.findUniqueOrThrow({ where: { id: scheduled.id }, include: { steps: true, toolCalls: true } });
    expect(result.status).toBe("completed");
    expect(result.steps.find((step) => step.stepKey === "plan")?.input).toMatchObject({ requestedById: alice.id });
    expect(result.toolCalls).toEqual([expect.objectContaining({ toolName: "memory.recall", status: "completed",
      output: expect.objectContaining({ memories: [expect.objectContaining({ key: "me.preference", value: "SCHEDULE_OWNER_MEMORY" })] })
    })]);
    expect(await prisma.post.count({ where: { roomId: accepted.roomId } })).toBe(0);
  });

  it("有 ToolCall 的私聊完成任务不投影，shared 正对照生成一条，重复投影和恢复稳定收敛", async () => {
    const { alice, agent } = await fixture();
    const accepted = await send(alice.id);
    const shared = await createTestRoom();
    const sharedTask = await prisma.agentTask.create({ data: {
      roomId: shared.id, agentId: agent.id, input: {}, status: "completed", completedAt: new Date(), result: { summary: "共享完成" }
    } });
    await prisma.agentTask.update({ where: { id: accepted.task.id }, data: { status: "completed", completedAt: new Date(), result: { summary: "私聊完成" } } });
    for (const taskId of [accepted.task.id, sharedTask.id]) {
      await prisma.toolCall.create({ data: { taskId, stepKey: "tool:1", toolName: "memo.create", status: "completed" } });
    }
    expect(await recoverPendingTimelineProjections()).toBe(2);
    const privateTask = await prisma.agentTask.findUniqueOrThrow({ where: { id: accepted.task.id } });
    expect(privateTask.timelineProjectedAt).toBeInstanceOf(Date);
    expect(await prisma.post.count({ where: { roomId: accepted.roomId } })).toBe(0);
    expect(await prisma.post.findMany()).toEqual([expect.objectContaining({ roomId: shared.id, agentTaskId: sharedTask.id })]);
    await Promise.all([projectAgentTaskTimeline(accepted.task.id), projectAgentTaskTimeline(sharedTask.id)]);
    expect(await recoverPendingTimelineProjections()).toBe(0);
    expect(await prisma.post.count()).toBe(1);
    expect((await prisma.agentTask.findUniqueOrThrow({ where: { id: accepted.task.id } })).timelineProjectedAt).toEqual(privateTask.timelineProjectedAt);
  });
});

async function seedScope(roomId: string, ownerId: string, agentId: string, marker: string) {
  await prisma.message.create({ data: { roomId, senderId: ownerId, senderType: "human", content: `${marker}_MESSAGE` } });
  await prisma.memo.create({ data: { roomId, title: `${marker}_MEMO`, content: `${marker}_MEMO`, pinned: true } });
  await prisma.memory.createMany({ data: [
    { roomId, userId: ownerId, ownerKey: `user:${ownerId}`, key: "person.preference", value: `${marker}_PERSONAL_MEMORY` },
    { roomId, ownerKey: "scope:shared", key: "shared.preference", value: `${marker}_SHARED_MEMORY` }
  ] });
  await prisma.messageSummary.createMany({ data: [
    { roomId, type: "global", summary: `${marker}_GLOBAL_SUMMARY` },
    { roomId, type: "range", summary: `${marker}_RANGE_SUMMARY` }
  ] });
  await prisma.scheduledJob.create({ data: {
    roomId, agentId, cron: "0 12 * * *", timezone: "UTC", nextRunAt: new Date("2035-01-01"),
    payload: { prompt: `${marker}_SCHEDULE`, description: `${marker}_SCHEDULE` }
  } });
}
