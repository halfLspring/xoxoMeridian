import { TRANSIENT_TOOL_RETRY } from "@/agent/tool-errors";
import type { AgentTool, ToolExecutionContext } from "@/agent/types";
import { scheduleDescriptionSchema } from "@/lib/life-authoring-contract";
import {
  createActiveScheduledJob,
  updateScheduledJobWithActiveCap,
} from "@/lib/scheduled-job-authoring";
import {
  resolveOneShotSchedule,
  resolveRecurringSchedule,
  ScheduledJobFireAtError,
  ScheduledJobTimezoneError,
} from "@/lib/scheduled-job-one-shot";
import { resolveParticipantPair } from "@/lib/participant-resolution";

type ScheduleCreateInput = {
  cron?: string;
  fireAt?: string;
  timezone?: string;
  prompt?: string;
  description?: string | null;
  runOnce?: boolean;
};

type ScheduleListInput = Record<string, never>;

type ScheduleCancelInput = {
  jobId?: string;
};

type ScheduleUpdateInput = {
  jobId?: string;
  cron?: string;
  fireAt?: string;
  timezone?: string;
  prompt?: string;
  description?: string | null;
  runOnce?: boolean;
};

/**
 * Resolves a one-shot request with the Agent's own error contract: the model
 * needs to be told to go back to the user, which is not something the HTTP
 * routes have to say. Cron failures are already worded for the model, so they
 * pass through from the shared resolver unchanged.
 */
function resolveOneShotForTool(input: {
  fireAt: string;
  cron?: string | null;
  timezone: string;
}): { nextRunAt: Date; cron: string } {
  try {
    return resolveOneShotSchedule(input);
  } catch (err) {
    if (err instanceof ScheduledJobFireAtError) {
      throw new Error(
        err.reason === "invalid"
          ? `Invalid fireAt '${err.fireAt}': not a valid ISO datetime.`
          : `fireAt '${err.fireAt}' is more than 5 minutes in the past. Ask the user to clarify the time.`,
      );
    }
    if (err instanceof ScheduledJobTimezoneError) {
      throw new Error(`${err.message} Use an IANA zone like 'Asia/Shanghai'.`);
    }
    throw err;
  }
}

export function createScheduleCreateTool(): AgentTool<ScheduleCreateInput> {
  return {
    name: "schedule.create",
    risk: "medium",
    retry: TRANSIENT_TOOL_RETRY,
    description: "创建计划，到时由助手执行 prompt。一次性绝对时间使用 fireAt，重复周期使用 cron；两者互斥。修改已有计划优先 schedule.update。",
    effect: "database-write",
    schema: {
      type: "object",
      required: ["timezone", "prompt"],
      properties: {
        fireAt: {
          type: "string",
          description:
            "ISO-8601 absolute datetime with timezone offset, e.g. '2026-05-09T20:40:00+08:00'. " +
            "Use this for any one-off at a specific time. Automatically sets runOnce=true. " +
            "Exactly one of fireAt or cron must be provided."
        },
        cron: {
          type: "string",
          description:
            "Standard 5-field cron expression for recurring schedules. " +
            "Exactly one of fireAt or cron must be provided."
        },
        timezone: { type: "string", description: "IANA timezone, e.g. 'Asia/Shanghai'." },
        prompt: { type: "string", description: "What the agent should do when fired." },
        description: { type: "string", description: "Short human-readable summary, e.g. '今晚 20:40 发一首诗'." },
        runOnce: {
          type: "boolean",
          description:
            "If true, the job fires exactly once and then disables itself. Automatically forced to true when fireAt is used. " +
            "Only set this manually with cron if you really need a cron-matched one-off (rare — prefer fireAt)."
        }
      }
    },
    async execute(input, context) {
      const cron = input.cron?.trim();
      const fireAtRaw = input.fireAt?.trim();
      const timezone = input.timezone?.trim() || inferRequesterTimezone(context) || "Asia/Shanghai";
      const prompt = input.prompt?.trim();
      const description = scheduleDescriptionSchema.optional().parse(input.description) ?? null;

      if (!prompt) throw new Error("prompt is required.");
      if (prompt.length > 500) throw new Error("prompt too long (>500 chars).");
      if (!cron && !fireAtRaw) throw new Error("one of 'cron' or 'fireAt' is required.");

      let nextRunAt: Date;
      let effectiveCron: string;
      let runOnce = input.runOnce === true;

      if (fireAtRaw) {
        const resolved = resolveOneShotForTool({
          fireAt: fireAtRaw,
          cron: cron ?? null,
          timezone,
        });
        nextRunAt = resolved.nextRunAt;
        effectiveCron = resolved.cron;
        runOnce = true;
      } else {
        const resolved = resolveRecurringSchedule({ cron: cron!, timezone });
        nextRunAt = resolved.nextRunAt;
        effectiveCron = resolved.cron;
      }

      const job = await createActiveScheduledJob(
        context.prisma,
        {
          roomId: context.roomId,
          agentId: context.agentId,
          cron: effectiveCron,
          timezone,
          payload: {
            prompt,
            description,
            runOnce
          },
          enabled: true,
          nextRunAt,
          createdById: context.requestedById ?? undefined
        },
      );

      return {
        jobId: job.id,
        cron: job.cron,
        timezone: job.timezone,
        nextRunAt: job.nextRunAt.toISOString(),
        description,
        runOnce
      };
    }
  };
}

export function createScheduleListTool(): AgentTool<ScheduleListInput> {
  return {
    name: "schedule.list",
    risk: "low",
    retry: TRANSIENT_TOOL_RETRY,
    description:
      "List the active scheduled jobs for this room (recurring and one-off). Call this BEFORE creating or updating a schedule if the user's request sounds similar to an existing one, so you don't create duplicates.",
    schema: { type: "object", properties: {} },
    async execute(_input, context) {
      const jobs = await context.prisma.scheduledJob.findMany({
        where: { roomId: context.roomId, enabled: true },
        orderBy: { nextRunAt: "asc" },
        take: 50,
        select: {
          id: true,
          cron: true,
          timezone: true,
          nextRunAt: true,
          payload: true
        }
      });
      return {
        count: jobs.length,
        jobs: jobs.map((j) => {
          const payload = (j.payload as { description?: string; prompt?: string; runOnce?: boolean } | null) ?? {};
          return {
            jobId: j.id,
            cron: j.cron,
            timezone: j.timezone,
            nextRunAt: j.nextRunAt.toISOString(),
            description: payload.description ?? null,
            prompt: payload.prompt ?? null,
            runOnce: payload.runOnce === true
          };
        })
      };
    }
  };
}

export function createScheduleCancelTool(): AgentTool<ScheduleCancelInput> {
  return {
    name: "schedule.cancel",
    risk: "medium",
    retry: TRANSIENT_TOOL_RETRY,
    description:
      "Cancel (disable) a scheduled job by its jobId. Use this when the user asks to fully stop a scheduled task. " +
      "If the user only wants to CHANGE the schedule (frequency, time, prompt), use schedule.update instead of cancel+create. " +
      "Call schedule.list first if you don't know the id.",
    effect: "database-write",
    schema: {
      type: "object",
      required: ["jobId"],
      properties: {
        jobId: { type: "string", description: "The ScheduledJob id returned from schedule.list or schedule.create." }
      }
    },
    async execute(input, context) {
      const jobId = input.jobId?.trim();
      if (!jobId) throw new Error("jobId is required.");

      const job = await context.prisma.scheduledJob.findUnique({ where: { id: jobId } });
      if (!job) throw new Error(`Scheduled job not found: ${jobId}`);
      if (job.roomId !== context.roomId) {
        throw new Error("Scheduled job does not belong to this room.");
      }

      await context.prisma.scheduledJob.update({
        where: { id: jobId },
        data: { enabled: false }
      });

      return { jobId, cancelled: true };
    }
  };
}

export function createScheduleUpdateTool(): AgentTool<ScheduleUpdateInput> {
  return {
    name: "schedule.update",
    risk: "medium",
    retry: TRANSIENT_TOOL_RETRY,
    description:
      "Modify an existing scheduled job in place. Use this when the user wants to change an existing schedule — " +
      "for example '改成每周六' / '其实我只要今晚一次' / '把时间改到九点'. " +
      "Prefer update over cancel+create so the user gets a single coherent change. " +
      "Only provide the fields you want to change; omitted fields keep their current value. " +
      "**To move a ONE-OFF job to a new datetime**, pass **fireAt** with an ISO-8601 datetime (with offset) — " +
      "same field as schedule.create, e.g. fireAt='2026-05-09T21:30:00+08:00'. It forces runOnce=true and rewrites " +
      "nextRunAt, so never express a one-off move as cron alone. " +
      "Setting runOnce=true converts a recurring job into a one-off that disables itself after the next fire; " +
      "setting runOnce=false converts it back to recurring. " +
      "If you change fireAt, cron or timezone, nextRunAt is recomputed automatically; a job converted from one-off " +
      "back to recurring is re-derived from its cron.",
    effect: "database-write",
    schema: {
      type: "object",
      required: ["jobId"],
      properties: {
        jobId: { type: "string", description: "The ScheduledJob id from schedule.list or schedule.create." },
        cron: { type: "string", description: "New cron expression. Omit to keep current." },
        fireAt: {
          type: "string",
          description:
            "New absolute datetime for a one-off, ISO-8601 with timezone offset, e.g. '2026-05-09T21:30:00+08:00'. " +
            "Forces runOnce=true. Cannot be combined with cron. Omit to keep the current timing."
        },
        timezone: { type: "string", description: "New IANA timezone. Omit to keep current." },
        prompt: { type: "string", description: "New prompt for the agent when fired." },
        description: { type: "string", description: "New human-readable description." },
        runOnce: {
          type: "boolean",
          description: "If true, the job disables itself after the next fire."
        }
      }
    },
    async execute(input, context) {
      const jobId = input.jobId?.trim();
      if (!jobId) throw new Error("jobId is required.");

      const updated = await updateScheduledJobWithActiveCap(context.prisma, {
        roomId: context.roomId,
        jobId,
        buildData(existing) {
          const timezone = input.timezone?.trim() || existing.timezone;
          const fireAtRaw = input.fireAt?.trim();

          const prevPayload = (existing.payload as {
            prompt?: string;
            description?: string | null;
            runOnce?: boolean;
          } | null) ?? {};
          const existingRunOnce = prevPayload.runOnce === true;

          const nextPrompt = input.prompt !== undefined
            ? input.prompt.trim()
            : prevPayload.prompt ?? "";
          if (!nextPrompt) throw new Error("prompt cannot be empty.");
          if (nextPrompt.length > 500) throw new Error("prompt too long (>500 chars).");

          const runOnce = input.runOnce !== undefined
            ? input.runOnce === true
            : existingRunOnce;
          const description = input.description !== undefined
            ? scheduleDescriptionSchema.parse(input.description)
            : prevPayload.description ?? null;

          // An explicit instant defines the whole schedule, exactly as it does on
          // the PATCH route: the stored cron follows the new fireAt because the
          // scheduler re-derives the next run from cron when it claims the job.
          if (fireAtRaw) {
            const resolved = resolveOneShotForTool({
              fireAt: fireAtRaw,
              cron: input.cron?.trim() ?? null,
              timezone,
            });
            return {
              cron: resolved.cron,
              timezone,
              nextRunAt: resolved.nextRunAt,
              enabled: true,
              failCount: 0,
              payload: { prompt: nextPrompt, description, runOnce: true },
            };
          }

          const cron = input.cron?.trim() || existing.cron;
          const cronChanged = input.cron !== undefined && input.cron.trim() !== existing.cron;
          const tzChanged = input.timezone !== undefined && input.timezone.trim() !== existing.timezone;
          // Converting a one-shot back to recurring must re-derive the instant
          // from cron; otherwise the job stays pinned to the old one-off time
          // even when the cron string itself is unchanged.
          const convertingToRecurring = existingRunOnce && !runOnce;

          const nextRunAt = cronChanged || tzChanged || convertingToRecurring
            ? resolveRecurringSchedule({ cron, timezone }).nextRunAt
            : existing.nextRunAt;

          return {
            cron,
            timezone,
            nextRunAt,
            enabled: true,
            failCount: 0,
            payload: { prompt: nextPrompt, description, runOnce },
          };
        },
      });

      const updatedPayload = (updated.payload as {
        description?: string | null;
        runOnce?: boolean;
      } | null) ?? {};

      return {
        jobId: updated.id,
        cron: updated.cron,
        timezone: updated.timezone,
        nextRunAt: updated.nextRunAt.toISOString(),
        description: updatedPayload.description ?? null,
        runOnce: updatedPayload.runOnce === true
      };
    }
  };
}

function inferRequesterTimezone(context: ToolExecutionContext): string | undefined {
  const { self } = resolveParticipantPair(
    context.runtimeContext.participants,
    context.requestedById,
    (participant) => participant.userId
  );
  return self?.user.profile?.timezone ?? undefined;
}
