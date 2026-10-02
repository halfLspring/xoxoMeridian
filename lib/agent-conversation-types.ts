import type { AnswerReferences } from "@/lib/answer-references";

export type AgentConversationMessage = {
  id: string;
  clientMessageId: string | null;
  role: "user" | "agent";
  content: string;
  references?: AnswerReferences;
  createdAt: string;
  taskId: string | null;
};

export type AgentConversationTask = {
  id: string;
  status: "pending" | "running" | "waiting_approval" | "completed" | "failed" | "cancelled" | "limit_exceeded";
  sourceMessageId: string | null;
  finalMessageId: string | null;
  createdAt: string;
  updatedAt: string;
  error: string | null;
};

export type AgentConversationApproval = {
  id: string;
  taskId: string;
  toolName: string;
  risk: "high";
  input: Record<string, unknown>;
  requestedAt: string;
};

export type AgentConversationSnapshot = {
  currentUser: { id: string; displayName: string; avatarLabel: string };
  agent: { id: string | null; displayName: string; enabled: boolean };
  roomId: string | null;
  messages: AgentConversationMessage[];
  tasks: AgentConversationTask[];
  pendingApprovals: AgentConversationApproval[];
};

export type AgentConversationSendResult = {
  currentUserId: string;
  roomId: string;
  message: AgentConversationMessage;
  task: AgentConversationTask;
  replayed: boolean;
};
