import { z } from "zod";

export function safeSourceUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

const sourceId = z.string().regex(/^s[1-9]\d*$/u).max(20);
const sourceSchema = z.object({
  id: sourceId,
  title: z.string().min(1).max(300),
  url: z.string().max(4000).refine((value) => safeSourceUrl(value) === value),
  dates: z.array(z.object({
    kind: z.enum(["published", "issued", "observed", "fetched"]),
    value: z.string().min(1).max(100),
  }).strict()).max(40),
}).strict();

export const answerReferencesSchema = z.object({
  version: z.literal(1),
  sources: z.array(sourceSchema).min(1).max(100),
  citations: z.array(z.object({
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
    sourceIds: z.array(sourceId).min(1).max(100),
  }).strict()).min(1).max(80),
}).strict();

export type AnswerSource = z.infer<typeof sourceSchema>;
export type AnswerReferences = z.infer<typeof answerReferencesSchema>;

/** 只投影版本化来源；旧消息或损坏的元数据继续显示原正文。 */
export function readAnswerReferences(metadata: unknown, content: string): AnswerReferences | undefined {
  if (!metadata || typeof metadata !== "object" || !("answerReferences" in metadata)) return undefined;
  const parsed = answerReferencesSchema.safeParse(metadata.answerReferences);
  if (!parsed.success) return undefined;
  const { sources, citations } = parsed.data;
  const ids = new Set(sources.map((source) => source.id));
  const used = new Set(citations.flatMap((citation) => citation.sourceIds));
  if (ids.size !== sources.length || used.size !== ids.size || [...used].some((id) => !ids.has(id))) return undefined;
  let previousEnd = 0;
  for (const citation of citations) {
    if (citation.start < previousEnd || citation.end <= citation.start || citation.end > content.length) return undefined;
    previousEnd = citation.end;
  }
  return parsed.data;
}
