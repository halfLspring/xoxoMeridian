import type { Prisma } from "@prisma/client";

import type { ChatMessage } from "@/components/chat/types";
import { readAnswerReferences } from "@/lib/answer-references";
import { prisma } from "@/lib/prisma";

// metadata 仅在服务端校验来源投影；toolResults 和完整 Trace 不随消息 DTO 发送。
const chatMessageSelect = {
  id: true,
  roomId: true,
  senderId: true,
  senderAgentId: true,
  senderType: true,
  content: true,
  metadata: true,
  targetType: true,
  targetId: true,
  status: true,
  createdAt: true,
  sender: { select: { id: true, displayName: true, avatarLabel: true } },
  senderAgent: { select: { id: true, displayName: true, slug: true } },
  finalTask: {
    select: {
      id: true,
      status: true,
      toolCalls: {
        orderBy: [{ startedAt: "asc" }, { id: "asc" }],
        select: { id: true, toolName: true, status: true, durationMs: true, error: true },
      },
      llmCalls: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, provider: true, model: true, status: true, totalTokens: true },
      },
    },
  },
  sourceTask: { select: { id: true, status: true } },
} satisfies Prisma.MessageSelect;

export async function getChatMessages(roomId: string) {
  const recent = await prisma.message.findMany({
    where: { roomId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 80,
    select: chatMessageSelect,
  });

  return recent.reverse().map(({ metadata, ...message }) => ({
    ...message,
    ...(message.senderType === "agent" ? { references: readAnswerReferences(metadata, message.content) } : {}),
    createdAt: message.createdAt.toISOString(),
  })) satisfies ChatMessage[];
}
