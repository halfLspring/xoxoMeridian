import type { AgentTool } from "@/agent/types";
import { TRANSIENT_TOOL_RETRY } from "@/agent/tool-errors";
import { deduplicatedMemoryWrite } from "@/agent/memory-dedup";
import {
  projectMemoryForRequester,
  projectMergedMemoryKey,
  resolveMemoryIdentity,
  resolveMemoryRecallFilter
} from "@/agent/memory-identity";

type MemorySetInput = {
  key?: string;
  value?: string;
  scope?: "shared" | "me" | "her";
  source?: string;
};

type MemoryRecallInput = {
  prefix?: string;
  limit?: number;
};

const KEY_PATTERN = /^[a-z0-9._-]{1,80}$/i;
const VALUE_MAX = 1000;

export function createMemorySetTool(): AgentTool<MemorySetInput> {
  return {
    name: "memory.set",
    risk: "medium",
    retry: TRANSIENT_TOOL_RETRY,
    description: "记住当前房间内明确且持久的事实。优先保留用户纠正、长期偏好、关系事实和环境信息；不记录临时情绪、近期对话或猜测。归属与更新方式见参数契约。",
    effect: "database-write",
    schema: {
      type: "object",
      required: ["key", "value"],
      properties: {
        key: { type: "string", description: "Dotted lowercase key. Must start with 'shared.', 'me.', or 'her.'" },
        value: { type: "string", description: "The fact to remember, ideally <200 chars." },
        scope: { type: "string", enum: ["shared", "me", "her"], description: "Optional: redundant if key already starts with the scope prefix." },
        source: { type: "string", description: "Optional provenance, defaults to 'agent-runtime'." }
      }
    },
    async execute(input, context) {
      const key = input.key?.trim().toLowerCase();
      const value = input.value?.trim();

      if (!key) throw new Error("Memory key is required.");
      if (!value) throw new Error("Memory value is required.");
      if (!KEY_PATTERN.test(key)) {
        throw new Error("Memory key must be dotted lowercase ([a-z0-9._-], 1-80 chars), e.g. 'her.allergy.peanut'.");
      }
      if (!key.startsWith("shared.") && !key.startsWith("me.") && !key.startsWith("her.")) {
        throw new Error("Memory key must start with 'shared.', 'me.', or 'her.'");
      }
      const keyScope = key.slice(0, key.indexOf("."));
      if (input.scope && input.scope !== keyScope) {
        throw new Error("Memory scope must match the key prefix.");
      }
      if (value.length > VALUE_MAX) {
        throw new Error(`Memory value too long (${value.length} > ${VALUE_MAX}).`);
      }

      const identity = resolveMemoryIdentity(
        key,
        context.requestedById,
        context.runtimeContext.participants
      );

      const result = await deduplicatedMemoryWrite(
        context.prisma,
        context.roomId,
        identity,
        value,
        input.source ?? "agent-runtime"
      );

      return {
        memoryId: result.memoryId,
        key,
        value,
        ...(result.merged && {
          merged: projectMergedMemoryKey(result.merged, identity.relativeScope)
        })
      };
    }
  };
}

export function createMemoryRecallTool(): AgentTool<MemoryRecallInput> {
  return {
    name: "memory.recall",
    risk: "low",
    retry: TRANSIENT_TOOL_RETRY,
    description:
      "Retrieve previously persisted facts about this room. Useful when you need to verify a remembered detail before acting (e.g. confirming an allergy before suggesting food). " +
      "Returns up to `limit` rows ordered by recency. Optional `prefix` filter (e.g. 'her.') narrows by key namespace.",
    schema: {
      type: "object",
      properties: {
        prefix: { type: "string", description: "Optional key prefix filter, e.g. 'her.' or 'shared.anniversary'." },
        limit: { type: "number", description: "Max rows to return, default 20, max 50." }
      }
    },
    async execute(input, context) {
      const prefix = input.prefix?.trim().toLowerCase();
      const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
      const filter = resolveMemoryRecallFilter(
        prefix,
        context.requestedById,
        context.runtimeContext.participants
      );

      if (filter.ownerKeys.length === 0) {
        return { count: 0, memories: [] };
      }

      const memories = await context.prisma.memory.findMany({
        where: {
          roomId: context.roomId,
          ownerKey: { in: filter.ownerKeys },
          ...(filter.storagePrefix
            ? { key: { startsWith: filter.storagePrefix } }
            : {})
        },
        orderBy: { updatedAt: "desc" },
        take: limit,
        select: {
          ownerKey: true,
          userId: true,
          key: true,
          value: true,
          updatedAt: true
        }
      });

      const projected = memories.flatMap((memory) => {
        const view = projectMemoryForRequester(
          memory,
          context.requestedById,
          context.runtimeContext.participants
        );
        return view
          ? [{ ...view, updatedAt: memory.updatedAt.toISOString() }]
          : [];
      });

      return {
        count: projected.length,
        memories: projected
      };
    }
  };
}
