import type { Prisma } from "@prisma/client";
import { z } from "zod";

const cursorPayloadSchema = z.strictObject({
  v: z.literal(1),
  publishedAt: z.iso.datetime({ precision: 3 }),
  id: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/),
});

const postCursorSchema = z.string().min(1).max(1024).regex(/^[A-Za-z0-9_-]+$/).transform((value, ctx) => {
  try {
    const bytes = Buffer.from(value, "base64url");
    if (bytes.toString("base64url") === value) {
      const result = cursorPayloadSchema.safeParse(JSON.parse(bytes.toString("utf8")));
      if (result.success) return result.data;
    }
  } catch {
    // 非规范编码、非法 JSON 与旧时间字符串统一由 cursor 验证错误返回。
  }
  ctx.addIssue({ code: "custom", message: "无效的文章分页游标，请使用接口返回的 nextCursor" });
  return z.NEVER;
});

export const postPaginationSchema = z.object({
  // 正整数保证每页前进；保留默认 50 条及最大 100 条的既有约定。
  limit: z.coerce.number().int().positive().transform((value) => Math.min(value, 100)).default(50),
  cursor: postCursorSchema.optional(),
});

export function encodePostCursor(post: { publishedAt: Date | null; id: string }) {
  if (!post.publishedAt) throw new Error("Unpublished post cursor");
  return Buffer.from(JSON.stringify({ v: 1, publishedAt: post.publishedAt.toISOString(), id: post.id })).toString("base64url");
}

export function getPostCursorWhere(cursor: z.infer<typeof postCursorSchema>): Prisma.PostWhereInput {
  const publishedAt = new Date(cursor.publishedAt);
  return {
    OR: [
      { publishedAt: { lt: publishedAt } },
      { publishedAt, id: { lt: cursor.id } },
    ],
  };
}
