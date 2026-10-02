import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({ userId: "" }));

vi.mock("@/lib/auth", () => ({
  requireCurrentUser: async () => ({ id: authState.userId }),
  requirePageUser: async () => ({ id: authState.userId, displayName: "Viewer", avatarLabel: "V" }),
  USER_COOKIE: "xoxo_session",
  verifySession: () => undefined,
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

import { GET as getTrace } from "@/app/api/agent/tasks/[taskId]/trace/route";
import { GET as getMessages } from "@/app/api/rooms/[roomId]/messages/route";
import { GET as getStream } from "@/app/api/rooms/[roomId]/stream/route";
import ChatRoomPage from "@/app/chat/[roomId]/page";
import type { ChatMessage, RoomSnapshot } from "@/components/chat/types";
import { prisma } from "@/lib/prisma";
import { createTestRoom, createTestUser, resetTestDatabase } from "@/tests/integration/support/database";

beforeEach(async () => {
  await resetTestDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function seedConversation(count = 100) {
  const user = await createTestUser({ displayName: "Viewer", avatarLabel: "V" });
  authState.userId = user.id;
  const room = await createTestRoom();
  await prisma.roomParticipant.create({ data: { roomId: room.id, userId: user.id } });
  const rows = Array.from({ length: count }, (_, index) => ({
    id: `message-${String(index).padStart(3, "0")}`,
    roomId: room.id,
    senderId: user.id,
    senderType: "human" as const,
    content: `消息 ${index}`,
    // 80 条窗口的边界落在同一时间的七条记录中；反向插入排除物理顺序巧合。
    createdAt: new Date(Date.UTC(2026, 8, 1, 0, 0, Math.floor(index / 7))),
  }));
  await prisma.message.createMany({ data: [...rows].reverse() });
  const otherRoom = await createTestRoom();
  await prisma.message.create({
    data: {
      roomId: otherRoom.id,
      senderType: "system",
      content: "其他房间的消息",
      createdAt: new Date("2027-01-01T00:00:00Z"),
    },
  });
  return { room, user, rows };
}

async function readEntrypoints(roomId: string) {
  const params = Promise.resolve({ roomId });
  const response = await getMessages(new Request(`http://localhost/api/rooms/${roomId}/messages`), { params });
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  const http = (await response.json()).messages as ChatMessage[];
  const page = await ChatRoomPage({ params });
  const initial = (page.props.initialSnapshot as RoomSnapshot).messages;
  const abort = new AbortController();
  const stream = await getStream(
    new Request(`http://localhost/api/rooms/${roomId}/stream`, { signal: abort.signal }),
    { params },
  );
  const reader = stream.body!.getReader();
  try {
    const chunk = await reader.read();
    const event = new TextDecoder().decode(chunk.value);
    expect(event).toMatch(/^event: snapshot\ndata: /);
    const snapshot = JSON.parse(event.split("\ndata: ")[1]) as RoomSnapshot;
    return { http, initial, sse: snapshot.messages };
  } finally {
    abort.abort();
    await reader.cancel();
  }
}

describe("聊天消息读取窗口与摘要", () => {
  it("GET、页面初始 snapshot 与 SSE 都按时间和 ID 稳定返回最新 80 条", async () => {
    const { room, rows } = await seedConversation();
    const expectedIds = rows.slice(-80).map((row) => row.id);
    // 重复读取验证同时间记录不会因入口或查询轮次改变顺序。
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const entrypoints = await readEntrypoints(room.id);
      for (const [name, messages] of Object.entries(entrypoints)) {
        expect.soft(messages.map((message) => message.id), name).toEqual(expectedIds);
      }
      expect.soft(entrypoints.initial).toEqual(entrypoints.http);
      expect.soft(entrypoints.sse).toEqual(entrypoints.http);
    }
  });

  it("三个消息入口只提供展示字段，完整 Tool/LLM 载荷仍由已授权 Trace 返回", async () => {
    const { room, user, rows } = await seedConversation();
    const agent = await prisma.agent.create({
      data: { slug: "summary-agent", displayName: "摘要助手", description: "摘要回归" },
    });
    const finalMessage = rows[99];
    const sourceMessage = rows[98];
    await prisma.message.update({
      where: { id: finalMessage.id },
      data: {
        senderType: "agent",
        senderId: null,
        senderAgentId: agent.id,
        metadata: { toolResults: [{ output: "private-message-tool-result" }], answerReferences: {
          version: 1, sources: [{ id: "s1", title: "来源", url: "https://public.example.test/", dates: [] }],
          citations: [{ start: 0, end: finalMessage.content.length, sourceIds: ["s1"] }],
        } },
      },
    });
    const task = await prisma.agentTask.create({
      data: {
        roomId: room.id,
        agentId: agent.id,
        requestedById: user.id,
        sourceMessageId: sourceMessage.id,
        finalMessageId: finalMessage.id,
        status: "completed",
        input: { prompt: "private-task-prompt" },
        plan: { prompt: "private-task-plan" },
        result: { output: "private-task-result" },
        toolCalls: {
          create: {
            id: "summary-tool",
            toolName: "memo.list",
            status: "completed",
            durationMs: 12,
            input: { prompt: "private-tool-input" },
            output: { content: "private-tool-output" },
          },
        },
        llmCalls: {
          create: {
            id: "summary-llm",
            provider: "mock",
            model: "test-model",
            status: "completed",
            totalTokens: 42,
            inputSummary: "private-llm-prompt",
            requestPayload: { prompt: "private-llm-request" },
            responsePayload: { output: "private-llm-response" },
          },
        },
      },
    });

    const entrypoints = await readEntrypoints(room.id);
    for (const [name, messages] of Object.entries(entrypoints)) {
      const final = messages.find((message) => message.id === finalMessage.id);
      expect.soft(final, name).toEqual({
        id: finalMessage.id,
        roomId: room.id,
        senderId: null,
        senderAgentId: agent.id,
        senderType: "agent",
        content: finalMessage.content,
        references: {
          version: 1, sources: [{ id: "s1", title: "来源", url: "https://public.example.test/", dates: [] }],
          citations: [{ start: 0, end: finalMessage.content.length, sourceIds: ["s1"] }],
        },
        targetType: "all",
        targetId: null,
        status: "sent",
        createdAt: finalMessage.createdAt.toISOString(),
        sender: null,
        senderAgent: { id: agent.id, displayName: "摘要助手", slug: "summary-agent" },
        finalTask: {
          id: task.id,
          status: "completed",
          toolCalls: [{ id: "summary-tool", toolName: "memo.list", status: "completed", durationMs: 12, error: null }],
          llmCalls: [{ id: "summary-llm", provider: "mock", model: "test-model", status: "completed", totalTokens: 42 }],
        },
        sourceTask: null,
      });
      expect.soft(messages.find((message) => message.id === sourceMessage.id)?.sourceTask, name)
        .toEqual({ id: task.id, status: "completed" });
      expect.soft(JSON.stringify(messages), name).not.toContain("private-");
    }
    expect.soft(entrypoints.initial).toEqual(entrypoints.http);
    expect.soft(entrypoints.sse).toEqual(entrypoints.http);

    const traceRequest = new Request(`http://localhost/api/agent/tasks/${task.id}/trace`);
    const traceParams = { params: Promise.resolve({ taskId: task.id }) };
    const trace = await getTrace(traceRequest, traceParams);
    expect(trace.status).toBe(200);
    expect(trace.headers.get("Cache-Control")).toContain("private, no-store");
    expect(trace.headers.get("CDN-Cache-Control")).toBe("no-store");
    expect(trace.headers.get("Vary")).toContain("Cookie");
    const serializedTrace = await trace.text();
    for (const value of ["private-task-prompt", "private-tool-input", "private-tool-output", "private-llm-request", "private-llm-response"]) {
      expect(serializedTrace).toContain(value);
    }

    const outsider = await createTestUser();
    authState.userId = outsider.id;
    const forbiddenTrace = await getTrace(traceRequest, traceParams);
    expect(forbiddenTrace.status).toBe(403);
    expect(forbiddenTrace.headers.get("Cache-Control")).toContain("private, no-store");
    expect(forbiddenTrace.headers.get("CDN-Cache-Control")).toBe("no-store");
    expect(forbiddenTrace.headers.get("Vary")).toContain("Cookie");
    const params = Promise.resolve({ roomId: room.id });
    expect((await getMessages(new Request("http://localhost/messages"), { params })).status).toBe(403);
    expect((await getStream(new Request("http://localhost/stream"), { params })).status).toBe(403);
    await expect(ChatRoomPage({ params })).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT;replace;/chat;") });
  });

  it("空房间与不足 80 条的房间保持完整、升序且入口一致", async () => {
    const { room } = await seedConversation(0);
    expect(await readEntrypoints(room.id)).toEqual({ http: [], initial: [], sse: [] });
    await prisma.message.createMany({
      data: ["system-b", "system-a"].map((id) => ({
        id,
        roomId: room.id,
        senderType: "system",
        content: id,
        createdAt: new Date("2026-09-01T00:00:00Z"),
      })),
    });
    const entrypoints = await readEntrypoints(room.id);
    for (const messages of Object.values(entrypoints)) {
      expect(messages.map((message) => message.id)).toEqual(["system-a", "system-b"]);
      expect(messages.every((message) => message.sender === null && message.finalTask === null)).toBe(true);
    }
    expect(entrypoints.initial).toEqual(entrypoints.http);
    expect(entrypoints.sse).toEqual(entrypoints.http);
  });
});
