import { z } from "zod";

import { memoCreateFields, memoUpdateFields, scheduleDescriptionSchema } from "@/lib/life-authoring-contract";
import {
  hasAtMostOneScheduledJobTrigger,
  hasExactlyOneScheduledJobTrigger,
  scheduledJobFireAtSchema,
} from "@/lib/scheduled-job-one-shot";

const emptyInput = z.object({}).strict();
const id = z.string().min(1).max(200);
const isoDateString = z.string().min(1).max(100);

const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Expected a valid calendar date (YYYY-MM-DD).");

export const weatherInputSchema = z.object({
  city: z.string().trim().min(1).max(200).optional().describe("查询城市。省略时使用伙伴城市，不能由参与者数组顺序推断身份。"),
  includeForecast: z.boolean().optional().describe("不指定日期时可请求三天预报；指定起止日期时自动请求最多七天预报。"),
  startDate: calendarDate.optional().describe("First destination date, inclusive; supply with endDate. The range may contain at most 31 dates."),
  endDate: calendarDate.optional().describe("Last destination date, inclusive. The provider can supply at most seven days from the reference date; later dates are reported missing.")
}).strict().refine((input) => Boolean(input.startDate) === Boolean(input.endDate), {
  message: "startDate and endDate must be supplied together."
}).refine((input) => !input.startDate || !input.endDate || (
  input.startDate <= input.endDate &&
  Date.parse(input.endDate) - Date.parse(input.startDate) <= 30 * 86400000
), { message: "Weather date range must contain 1–31 calendar dates." });

export const searchInputSchema = z.object({
  query: z.string().trim().min(1).max(400).describe("围绕当前问题的具体检索关键词，包含需要的地点与适用时间。"),
  maxResults: z.number().int().min(1).max(10).optional(),
  searchDepth: z.enum(["basic", "advanced"]).optional(),
  topic: z.enum(["general", "news"]).optional(),
  timeRange: z.enum(["day", "week", "month", "year"]).optional().describe("相对当前时间的发布/更新窗口；与 startDate/endDate 互斥。"),
  startDate: calendarDate.optional().describe("Earliest publication/update date, not the future travel date."),
  endDate: calendarDate.optional().describe("Latest publication/update date, not the event validity date."),
  includeDomains: z.array(z.string().trim().max(253).regex(
    /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/
  )).min(1).max(10).optional()
}).strict().refine((input) => !input.startDate || !input.endDate || input.startDate <= input.endDate, {
  message: "Search startDate must not be after endDate."
}).refine((input) => !input.timeRange || (!input.startDate && !input.endDate), {
  message: "Use timeRange or startDate/endDate, not both."
});

const memoSummary = z.object({
  memoId: id,
  title: z.string(),
  content: z.string(),
  pinned: z.boolean().optional(),
  createdAt: isoDateString.optional()
}).passthrough();

const scheduleSummary = z.object({
  jobId: id,
  cron: z.string(),
  timezone: z.string(),
  nextRunAt: isoDateString,
  description: z.string().nullable(),
  prompt: z.string().nullable().optional(),
  runOnce: z.boolean()
}).passthrough();

export const BUILT_IN_TOOL_CONTRACTS = {
  "memo.list": {
    inputSchema: emptyInput,
    outputSchema: z.object({
      count: z.number().int().nonnegative(),
      memos: z.array(memoSummary)
    })
  },
  "memo.create": {
    inputSchema: z.object(memoCreateFields).strict(),
    outputSchema: memoSummary.pick({ memoId: true, title: true, content: true })
  },
  "memo.update": {
    inputSchema: z.object({
      ...memoUpdateFields,
      memoId: id,
    }).strict(),
    outputSchema: memoSummary.pick({
      memoId: true,
      title: true,
      content: true,
      pinned: true
    })
  },
  "memo.delete": {
    inputSchema: z.object({ memoId: id }).strict(),
    outputSchema: z.object({ memoId: id, deleted: z.literal(true) })
  },
  "memory.set": {
    inputSchema: z.object({
      key: z.string().min(1).max(80).regex(/^[a-z0-9._-]+$/i).describe("稳定的点分小写键，以 me.（本人）、her.（伙伴）或 shared.（房间）开头；同键更新既有事实。"),
      value: z.string().min(1).max(1000).describe("明确的持久事实，写成陈述句；不保存临时情绪、猜测或操作指令。"),
      scope: z.enum(["shared", "me", "her"]).optional().describe("记忆归属，与 key 前缀一致，私聊不能推断伙伴。"),
      source: z.string().max(200).optional()
    }).strict(),
    outputSchema: z.object({
      memoryId: id,
      key: z.string(),
      value: z.string(),
      merged: z.string().optional()
    })
  },
  "memory.recall": {
    inputSchema: z.object({
      prefix: z.string().max(80).optional(),
      limit: z.number().int().min(1).max(50).optional()
    }).strict(),
    outputSchema: z.object({
      count: z.number().int().nonnegative(),
      memories: z.array(z.object({
        key: z.string(),
        value: z.string(),
        updatedAt: isoDateString
      }))
    })
  },
  "schedule.create": {
    inputSchema: z.object({
      cron: z.string().min(1).max(200).optional().describe("重复周期使用五段 cron，与 fireAt 互斥；修改已有任务优先 schedule.update。"),
      fireAt: scheduledJobFireAtSchema.optional().describe("一次性绝对时间点，ISO-8601 含时区偏移；自动单次执行，与 cron 互斥。"),
      timezone: z.string().min(1).max(200).describe("计划所属 IANA 时区。"),
      prompt: z.string().min(1).max(500).describe("到时助手执行的动作，不是再次创建计划的指令。"),
      description: scheduleDescriptionSchema.optional(),
      runOnce: z.boolean().optional().describe("true 为下次执行后停用；false 为重复执行；fireAt 路径始终单次。")
    }).strict().refine(hasExactlyOneScheduledJobTrigger, {
      message: "Exactly one of fireAt or cron is required",
    }),
    outputSchema: scheduleSummary.omit({ prompt: true })
  },
  "schedule.list": {
    inputSchema: emptyInput,
    outputSchema: z.object({
      count: z.number().int().nonnegative(),
      jobs: z.array(scheduleSummary)
    })
  },
  "schedule.cancel": {
    inputSchema: z.object({ jobId: id }).strict(),
    outputSchema: z.object({ jobId: id, cancelled: z.literal(true) })
  },
  "schedule.update": {
    inputSchema: z.object({
      jobId: id,
      cron: z.string().min(1).max(200).optional().describe("重复周期使用五段 cron，与 fireAt 互斥；修改已有任务优先 schedule.update。"),
      fireAt: scheduledJobFireAtSchema.optional().describe("一次性绝对时间点，ISO-8601 含时区偏移；自动单次执行，与 cron 互斥。"),
      timezone: z.string().min(1).max(200).optional(),
      prompt: z.string().min(1).max(500).optional(),
      description: scheduleDescriptionSchema.optional(),
      runOnce: z.boolean().optional().describe("true 为下次执行后停用；false 为重复执行；fireAt 路径始终单次。")
    }).strict().refine(hasAtMostOneScheduledJobTrigger, {
      message: "fireAt and cron cannot be provided together",
    }),
    outputSchema: scheduleSummary.omit({ prompt: true })
  },
  "timezone.compare": {
    inputSchema: z.object({
      fromLabel: z.string().max(200).optional(),
      fromTimezone: z.string().max(200).optional(),
      toLabel: z.string().max(200).optional(),
      toTimezone: z.string().max(200).optional()
    }).strict(),
    outputSchema: z.object({
      from: z.object({ label: z.string(), timezone: z.string(), time: z.string() }),
      to: z.object({ label: z.string(), timezone: z.string(), time: z.string() }),
      suggestion: z.string()
    })
  },
  "weather.get": {
    inputSchema: weatherInputSchema,
    outputSchema: z.object({
      provider: z.enum(["qweather", "mock"]),
      city: z.string(),
      condition: z.string(),
      advice: z.string(),
      availability: z.enum(["available", "partial", "unavailable"]).optional(),
      fetchedAt: z.string().optional(),
      issuedAt: z.string().nullable().optional(),
      source: z.object({ name: z.string(), url: z.string().nullable() }).optional(),
      coverage: z.object({
        requestedStartDate: calendarDate.nullable(),
        requestedEndDate: calendarDate.nullable(),
        referenceDate: calendarDate.nullable(),
        availableDates: z.array(calendarDate),
        missingDates: z.array(calendarDate),
        forecastDays: z.union([z.literal(0), z.literal(3), z.literal(7)])
      }).optional()
    }).passthrough()
  },
  "web.search": {
    inputSchema: searchInputSchema,
    outputSchema: z.object({
      provider: z.enum(["tavily", "mock"]),
      query: z.string(),
      answer: z.string().optional(),
      availability: z.enum(["available", "unavailable"]).optional(),
      fetchedAt: z.string().optional(),
      constraints: z.object({
        topic: z.enum(["general", "news"]).optional(),
        timeRange: z.enum(["day", "week", "month", "year"]).optional().describe("相对当前时间的发布/更新窗口；与 startDate/endDate 互斥。"),
        startDate: calendarDate.optional(),
        endDate: calendarDate.optional(),
        includeDomains: z.array(z.string()).optional()
      }).optional(),
      results: z.array(z.object({
        title: z.string(),
        url: z.string(),
        content: z.string(),
        score: z.number(),
        publishedDate: z.string().nullable().optional(),
        dateStatus: z.enum(["known", "unknown"]).optional(),
        dateMeaning: z.literal("published_or_updated").optional(),
        fetchedAt: z.string().optional()
      })),
      responseTime: z.number().optional(),
      fallbackReason: z.string().optional(),
      _meta: z.object({
        totalResults: z.number().int().nonnegative(),
        displayMode: z.enum(["inline", "card", "collapsed"]).optional()
      }).optional()
    })
  }
} as const;

export type BuiltInToolName = keyof typeof BUILT_IN_TOOL_CONTRACTS;

export function getBuiltInToolContract(name: string) {
  return name in BUILT_IN_TOOL_CONTRACTS
    ? BUILT_IN_TOOL_CONTRACTS[name as BuiltInToolName]
    : null;
}
