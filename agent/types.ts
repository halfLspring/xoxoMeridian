import type { AnswerReferences } from "@/lib/answer-references";

import type { Prisma } from "@prisma/client";
import type { z } from "zod";

import type { ExecutionTracer } from "@/agent/execution-tracer";

export type AgentPlan = {
  intent: string;
  confidence: number;
  requiredTools: string[];
  taskSteps: string[];
  finalResponsePlan: string;
  finalResponseText: string;
  toolInputs: Record<string, unknown>;
};

export type LLMToolDescriptor = {
  name: string;
  description: string;
  schema: unknown;
};

export type StructuredRoomParticipant = {
  userId: string;
  displayName: string;
  city: string | null;
  timezone: string | null;
  profileNote: string | null;
};

export type StructuredRoomContext = {
  room: { name: string; slug: string; kind?: "shared" | "agent_private" };
  requestedById: string | null;
  self: StructuredRoomParticipant | null;
  partner: StructuredRoomParticipant | null;
  participants: StructuredRoomParticipant[];
  recentMessages: Array<{ from: string; content: string; at: string }>;
  pinnedMemos: Array<{ title: string; content: string }>;
  activeSchedules: Array<{
    jobId: string;
    cron: string;
    timezone: string;
    nextRunAt: string;
    description: string | null;
  }>;
  semanticMemory: {
    aboutHer: Array<{ key: string; value: string }>;
    aboutMe: Array<{ key: string; value: string }>;
    shared: Array<{ key: string; value: string }>;
  };
  summaries: {
    global: { summary: string; createdAt: string } | null;
    recent: Array<{ summary: string; createdAt: string }>;
  };
};

export type LLMPlanRequest = {
  prompt: string;
  referenceTime?: string;
  roomContext: StructuredRoomContext;
  availableTools: LLMToolDescriptor[];
  agentSystemPrompt?: string | null;
  maxCompletionTokens?: number;
  signal?: AbortSignal;
  validationFeedback?: {
    previousPlan: AgentPlan;
    issues: string;
  };
};

export type LLMPlanResult = AgentPlan & {
  rawResponse?: unknown;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
};

export type LLMAnswerRequest = {
  prompt: string;
  referenceTime: string;
  roomContext: StructuredRoomContext;
  plan: AgentPlan;
  toolResults: ToolResult[];
  agentSystemPrompt?: string | null;
  maxCompletionTokens?: number;
  signal?: AbortSignal;
};

export type LLMAnswerResult = {
  text: string;
  references?: AnswerReferences;
  rawResponse?: unknown;
  usage?: LLMPlanResult["usage"];
};

export interface LLMProvider {
  name: string;
  model: string;
  plan(request: LLMPlanRequest): Promise<LLMPlanResult>;
  synthesize?(request: LLMAnswerRequest): Promise<LLMAnswerResult>;
}

export type RuntimeContext = Awaited<ReturnType<typeof import("@/agent/context-builder").buildAgentContext>>;

export type AgentTaskLeaseOwnership = {
  attemptId: string;
  workerId: string;
  leaseDurationMs: number;
};

export type ToolExecutionContext = {
  prisma: Prisma.TransactionClient;
  taskId: string;
  roomId: string;
  agentId: string;
  requestedById: string | null;
  runtimeContext: RuntimeContext;
  tracer: ExecutionTracer;
  lease?: AgentTaskLeaseOwnership;
  signal?: AbortSignal;
  referenceTime?: string;
  reserveToolCall?: (input: {
    toolName: string;
    stepKey: string;
    attempt: number;
  }) => Promise<void>;
};

export type ToolRisk = "low" | "medium" | "high";
export type ToolErrorCategory =
  | "validation"
  | "permission"
  | "timeout"
  | "network"
  | "tool"
  | "runtime";

export type ToolRetryPolicy = {
  maxAttempts: number;
  backoffMs: number;
  retryOn: ToolErrorCategory[];
};

export interface AgentTool<Input = unknown, Output = unknown> {
  name: string;
  description: string;
  schema: unknown;
  risk: ToolRisk;
  retry: ToolRetryPolicy;
  effect?: "database-write";
  inputSchema?: z.ZodType<Input>;
  outputSchema?: z.ZodType<Output>;
  execute(input: Input, context: ToolExecutionContext): Promise<Output>;
}

export type ToolResult = {
  toolName: string;
  input?: unknown;
  stepKey?: string;
  output: unknown;
};
