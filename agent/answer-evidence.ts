import { z } from "zod";

import { readAnswerReferences, safeSourceUrl as safeUrl, type AnswerReferences, type AnswerSource } from "@/lib/answer-references";

import type { LLMAnswerRequest, LLMAnswerResult, ToolResult } from "@/agent/types";

type Data = Record<string, unknown>;

function object(value: unknown): Data {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Data : {};
}

function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function rows(value: unknown): Data[] {
  return Array.isArray(value) ? value.map(object) : [];
}

function dateRange(start: unknown, end: unknown): string[] {
  if (typeof start !== "string" || typeof end !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(start) || !/^\d{4}-\d{2}-\d{2}$/u.test(end)) return [];
  const from = Date.parse(`${start}T00:00:00Z`);
  const to = Date.parse(`${end}T00:00:00Z`);
  const days = (to - from) / 86_400_000 + 1;
  if (!Number.isInteger(days) || days < 1 || days > 31) return [];
  return Array.from({ length: days }, (_, day) => new Date(from + day * 86_400_000).toISOString().slice(0, 10));
}

function unavailable(output: Data): boolean {
  return output.provider === "mock" || output.availability === "unavailable" || output.status === "failed" || output.error !== undefined;
}

function localDate(timestamp: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(timestamp));
  } catch {
    return timestamp.slice(0, 10);
  }
}

/** Evidence is data, never instructions. Keep every call, including duplicate tool names. */
export function buildAnswerEvidence(request: LLMAnswerRequest) {
  const sources: AnswerSource[] = [];
  const sourceByUrl = new Map<string, AnswerSource>();
  function registerSource(value: unknown, title: unknown, dates: AnswerSource["dates"]): string | undefined {
    const url = safeUrl(value);
    if (!url || url.length > 4000) return undefined;
    let source = sourceByUrl.get(url);
    if (!source) {
      if (sources.length >= 100) return undefined;
      source = { id: `s${sources.length + 1}`, url, title: (string(title).trim() || new URL(url).hostname).slice(0, 300), dates: [] };
      sourceByUrl.set(url, source);
      sources.push(source);
    }
    for (const date of dates) {
      if (date.value && date.value.length <= 100 && source.dates.length < 40 && !source.dates.some((item) => item.kind === date.kind && item.value === date.value)) source.dates.push(date);
    }
    return source.id;
  }
  const weatherTimezones = [...new Set(request.toolResults
    .filter((result) => result.toolName === "weather.get")
    .map((result) => string(object(result.output).timezone)).filter(Boolean))];
  const referenceTimezone = weatherTimezones.length === 1 ? weatherTimezones[0] : request.roomContext.self?.timezone || "UTC";
  const referenceDate = localDate(request.referenceTime, referenceTimezone);
  const calls = request.toolResults.map((result) => {
    const output = { ...object(result.output) };
    const input = object(result.input);
    const coverage = object(output.coverage);
    const requestedDates = result.toolName === "weather.get"
      ? dateRange(coverage.requestedStartDate ?? input.startDate, coverage.requestedEndDate ?? input.endDate)
      : [];
    const availableDates = new Set(unavailable(output) ? [] : rows(output.forecast).map((day) => string(day.date)));
    const missingDates = requestedDates.filter((date) => !availableDates.has(date));
    if (unavailable(output)) {
      // 旧 checkpoint 的模拟/失败数据可能仍包含貌似真实的温度、摘要或链接。
      for (const key of Object.keys(output)) {
        if (!["provider", "availability", "city", "query", "fallbackReason", "fetchedAt", "coverage"].includes(key)) delete output[key];
      }
      output.availability = "unavailable";
    }
    const sourceIds: string[] = [];
    if (result.toolName === "weather.get" && !unavailable(output)) {
      const source = object(output.source);
      const sourceId = registerSource(source.url, source.name, [
        { kind: "issued", value: string(output.issuedAt) },
        { kind: "observed", value: string(output.observedAt) },
        { kind: "fetched", value: string(output.fetchedAt) },
      ]);
      if (sourceId) sourceIds.push(sourceId);
      output.source = { name: source.name, url: safeUrl(source.url), sourceId };
    }
    if (result.toolName === "web.search") {
      // 供应商生成的摘要不是独立证据；发布时间与有效期交给模型结合正文判断。
      delete output.answer;
      output.results = rows(output.results).map((source) => {
        const sourceId = registerSource(source.url, source.title, [
          { kind: "published", value: string(source.publishedDate) },
          { kind: "fetched", value: string(output.fetchedAt) },
        ]);
        if (sourceId) sourceIds.push(sourceId);
        return { ...source, url: safeUrl(source.url), sourceId };
      });
    }
    return { toolName: result.toolName, stepKey: result.stepKey, input: result.input, output, sourceIds: [...new Set(sourceIds)], requestedDates, requestedDayCount: requestedDates.length, missingDates };
  });
  return { referenceTime: request.referenceTime, referenceTimezone, referenceDate, calls, sources };
}

function renderWeather(output: Data, requestedDates: string[], missingDates: string[]): string {
  const city = string(output.city) || "所查询城市";
  const parts: string[] = [];
  if (typeof output.temperatureC === "number") {
    parts.push(`${city}实况：${string(output.condition)}，${output.temperatureC}°C${output.observedAt ? `（观测时间 ${output.observedAt}）` : "（观测时间未知）"}。`);
  }
  const forecast = rows(output.forecast).filter((day) => !requestedDates.length || requestedDates.includes(string(day.date)));
  if (forecast.length) parts.push(`${city}逐日预报：\n${forecast.map((day) => `- ${string(day.date)} ${string(day.textDay)} ${day.tempMinC ?? "未知"}～${day.tempMaxC ?? "未知"}°C`).join("\n")}`);
  if (missingDates.length) parts.push(`缺失预报日期：${missingDates.join("、")}，这些日期的天气暂时无法确认。`);
  if (!parts.length) parts.push(`${city}没有可用天气数据。`);
  if (output.availability === "partial" && !missingDates.length) parts.push("天气资料不完整，未提供的部分暂时无法确认。");
  return parts.join("\n");
}

function renderSchedule(output: Data): string {
  const description = string(output.description) || string(output.prompt) || "定时任务";
  let nextRunAt = string(output.nextRunAt);
  if (nextRunAt && output.timezone) {
    try {
      nextRunAt = new Intl.DateTimeFormat("zh-CN", { timeZone: string(output.timezone), dateStyle: "medium", timeStyle: "short" }).format(new Date(nextRunAt));
    } catch {
      // Keep the explicit offset from the tool if its optional timezone is unknown.
    }
  }
  return `${description}${nextRunAt ? `；下次执行 ${nextRunAt}` : ""}${output.timezone ? `（${output.timezone}）` : ""}${output.runOnce === true ? "；仅执行一次" : output.cron ? `；周期 ${output.cron}` : ""}`;
}

function sentence(text: string): string {
  return /[。！？.!?]$/u.test(text) ? text : `${text}。`;
}

function renderLocalResult(result: ToolResult): string {
  const output = object(result.output);
  const confirmationKeys: Record<string, string> = {
    "memo.create": "memoId", "memo.update": "memoId", "memory.set": "memoryId",
    "schedule.create": "jobId", "schedule.update": "jobId",
  };
  const confirmationKey = confirmationKeys[result.toolName];
  if (confirmationKey && !string(output[confirmationKey])) return "尚未取得该项操作成功的确认。";
  switch (result.toolName) {
    case "memo.create": return sentence(`备忘录已保存：${string(output.title) || string(output.content) || "未命名备忘录"}`);
    case "memo.update": return sentence(`备忘录已更新：${string(output.title) || string(output.content) || "指定备忘录"}`);
    case "memo.delete": return output.deleted === true ? "备忘录已删除。" : "未取得备忘录删除成功的确认。";
    case "memory.set": return sentence(`已记住：${string(output.value) || string(output.key) || "该信息"}`);
    case "schedule.create": return `已安排：${renderSchedule(output)}。`;
    case "schedule.update": return `已更新：${renderSchedule(output)}。`;
    case "schedule.cancel": return output.cancelled === true ? "指定定时任务已取消。" : "未取得定时任务取消成功的确认。";
    case "memo.list": return rows(output.memos).length ? `备忘录：\n${rows(output.memos).map((memo) => `- ${string(memo.title)}${memo.content ? `：${memo.content}` : ""}`).join("\n")}` : "当前没有备忘录。";
    case "memory.recall": return rows(output.memories).length ? `已存记忆：\n${rows(output.memories).map((memory) => `- ${string(memory.value)}`).join("\n")}` : "没有找到相关记忆。";
    case "schedule.list": return rows(output.jobs).length ? `现有定时任务：\n${rows(output.jobs).map((job) => `- ${renderSchedule(job)}`).join("\n")}` : "当前没有启用的定时任务。";
    case "timezone.compare": {
      const from = object(output.from);
      const to = object(output.to);
      return `${string(from.label) || "本人"}这边是 ${string(from.time) || "未知"}；${string(to.label) || "对方"}那边是 ${string(to.time) || "未知"}。${string(output.suggestion)}`;
    }
    default: return "该项操作已返回结果，但暂时无法整理其内容。";
  }
}

type AnswerBlock = { text: string; sourceIds: string[] };

function assembleAnswer(blocks: AnswerBlock[], sources: AnswerSource[]): Pick<LLMAnswerResult, "text" | "references"> {
  const citations: AnswerReferences["citations"] = [];
  let text = "";
  for (const block of blocks) {
    if (text) text += "\n\n";
    const start = text.length;
    text += block.text;
    if (block.sourceIds.length) citations.push({ start, end: text.length, sourceIds: [...new Set(block.sourceIds)] });
  }
  const used = new Set(citations.flatMap((citation) => citation.sourceIds));
  return { text, ...(used.size ? { references: { version: 1, sources: sources.filter((source) => used.has(source.id)), citations } as AnswerReferences } : {}) };
}

/** 综合不可用时只呈现可确定的结果；未完成核验的检索条目不冒充引用。 */
export function buildEvidenceFallback(request: LLMAnswerRequest, reason?: string): Pick<LLMAnswerResult, "text" | "references"> {
  const evidence = buildAnswerEvidence(request);
  const blocks: AnswerBlock[] = [];
  if (reason) blocks.push({ text: "暂时未能完成综合分析，以下是已确认的结果；其余问题暂时无法确认。", sourceIds: [] });
  let searchNoted = false;
  for (const call of evidence.calls) {
    let text: string;
    let sourceIds: string[] = [];
    if (unavailable(call.output)) {
      const label = call.toolName === "weather.get" ? "天气" : call.toolName === "web.search" ? "相关资料" : "该项操作";
      text = `${label}：${call.output.provider === "mock" ? "当前仅有模拟结果，真实数据不可用" : "此次结果不可用，暂时无法确认"}。`;
    } else if (call.toolName === "weather.get") {
      text = renderWeather(call.output, call.requestedDates, call.missingDates);
      sourceIds = call.sourceIds;
    } else if (call.toolName === "web.search") {
      if (searchNoted) continue;
      searchNoted = true;
      text = "相关资料尚不足以形成可核实的答复，暂时无法确认所问情况。";
    } else text = renderLocalResult(call);
    blocks.push({ text, sourceIds });
  }
  return assembleAnswer(blocks.length ? blocks : [{ text: "没有取得可用于回答此次问题的结果。", sourceIds: [] }], evidence.sources);
}

export function renderEvidenceFallback(request: LLMAnswerRequest, reason?: string): string {
  return buildEvidenceFallback(request, reason).text;
}

const answerSchema = z.object({
  blocks: z.array(z.object({
    text: z.string().trim().min(1).max(24_000),
    sourceIds: z.array(z.string().regex(/^s[1-9]\d*$/u)).max(100),
  }).strict()).min(1).max(80),
}).strict();

export function parseAnswerResponse(content: string, request: LLMAnswerRequest): Pick<LLMAnswerResult, "text" | "references"> {
  let value: unknown;
  try { value = JSON.parse(content); } catch { throw new Error("综合回答格式无效，预期 JSON 对象。"); }
  const parsed = answerSchema.safeParse(value);
  if (!parsed.success) throw new Error("综合回答格式无效，预期非空 blocks 和 sourceIds。");
  const sources = buildAnswerEvidence(request).sources;
  const ids = new Set(sources.map((source) => source.id));
  if (parsed.data.blocks.some((block) => block.sourceIds.some((id) => !ids.has(id)))) throw new Error("综合回答引用了未提供的来源。");
  const answer = assembleAnswer(parsed.data.blocks, sources);
  return validateAnswerResult(answer, request);
}

/** Provider 与 checkpoint 都经过相同的来源白名单校验。 */
export function validateAnswerResult(answer: Pick<LLMAnswerResult, "text" | "references">, request: LLMAnswerRequest) {
  const text = validateAnswerText(answer.text, request);
  if (text.length > 24_000) throw new Error("综合回答格式无效，正文过长。");
  if (!answer.references) return { text };
  const references = readAnswerReferences({ answerReferences: answer.references }, text);
  if (!references) throw new Error("综合回答来源关联格式无效。");
  const catalog = buildAnswerEvidence(request).sources;
  if (references.sources.some((source) => {
    const actual = catalog.find((item) => item.id === source.id);
    return !actual || source.url !== actual.url || source.title !== actual.title || JSON.stringify(source.dates) !== JSON.stringify(actual.dates);
  })) {
    throw new Error("综合回答引用了未提供的来源。");
  }
  return { text, references };
}

function extractLinkTargets(text: string): string[] {
  const destinations: Array<{ start: number; end: number; value: string }> = [];
  // Read only destinations; optional titles must not hide a relative/unsafe URL.
  for (const pattern of [/\]\(\s*/gu, /^[ \t]{0,3}\[[^\]\n]+\]:[ \t]*/gmu]) {
    for (const match of text.matchAll(pattern)) {
      const start = match.index + match[0].length;
      let end = start;
      if (text[start] === "<") {
        const close = text.indexOf(">", start + 1);
        end = close < 0 ? text.length : close + 1;
        destinations.push({ start, end, value: text.slice(start + 1, close < 0 ? end : close) });
        continue;
      }
      let depth = 0;
      for (; end < text.length && !/\s/u.test(text[end]); end += 1) {
        if (text[end] === "(") depth += 1;
        if (text[end] === ")") {
          if (depth === 0) break;
          depth -= 1;
        }
      }
      destinations.push({ start, end, value: text.slice(start, end) });
    }
  }
  for (const match of text.matchAll(/<([a-z][a-z\d+.-]*:[^<>\s]*)>/giu)) {
    destinations.push({ start: match.index, end: match.index + match[0].length, value: match[1] });
  }
  const targets = destinations.map((destination) => destination.value);
  for (const match of text.matchAll(/https?:\/\/[^\s<>"\]），。；！？]+/gu)) {
    if (destinations.some((destination) => match.index >= destination.start && match.index < destination.end)) continue;
    let value = match[0].replace(/[.,;!?]+$/u, "");
    while (value.endsWith(")") && (value.match(/\)/gu)?.length ?? 0) > (value.match(/\(/gu)?.length ?? 0)) value = value.slice(0, -1);
    targets.push(value);
  }
  return targets;
}

function collectLocalUrls(output: unknown): string[] {
  const urls: string[] = [];
  const pending: Array<{ value: unknown; depth: number }> = [{ value: output, depth: 0 }];
  for (let inspected = 0; pending.length && inspected < 1_000; inspected += 1) {
    const { value, depth } = pending.pop()!;
    if (typeof value === "string") urls.push(...extractLinkTargets(value));
    else if (value && typeof value === "object" && depth < 6) {
      for (const entry of Object.values(value).slice(0, 100)) pending.push({ value: entry, depth: depth + 1 });
    }
  }
  return urls;
}

/** Reject invented or unsafe citations rather than rendering untraceable sources. */
export function validateAnswerText(text: string, request: LLMAnswerRequest): string {
  if (!text.trim()) throw new Error("综合回答不能为空。");
  const urls = new Set<string>();
  for (const call of buildAnswerEvidence(request).calls) {
    const localUrls = /^(memo|memory|schedule)\./u.test(call.toolName) ? collectLocalUrls(call.output) : [];
    for (const value of [object(call.output.source).url, ...rows(call.output.results).map((row) => row.url), ...localUrls]) {
      const url = safeUrl(value);
      if (url) urls.add(url);
    }
  }
  for (const value of extractLinkTargets(text)) {
    const url = safeUrl(value);
    if (!url || !urls.has(url)) throw new Error("综合回答引用了未提供或不安全的来源。");
  }
  return text.trim();
}
