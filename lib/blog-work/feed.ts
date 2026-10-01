import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseBody } from "@/lib/validation";
import { getPostVisibilityWhere } from "@/lib/post-visibility";
import { postTimelineSelect } from "@/lib/post-timeline";
import { projectTimelinePosts } from "@/lib/post-timeline-projection";
import { readWork } from "@/lib/blog-work/queries";
import { workIdSchema } from "@/lib/blog-work/schemas";
import type { BlogFeed, BlogFeedEntry } from "@/lib/blog-work/types";

const cursorSchema = z.strictObject({ v: z.literal(1), publishedAt: z.iso.datetime({ precision: 3 }), kind: z.enum(["post", "work"]), id: workIdSchema });
const feedQuerySchema = z.object({
  q: z.string().max(200).default(""), limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(1024).optional().transform((value, ctx) => {
    if (!value) return undefined;
    try {
      const bytes = Buffer.from(value, "base64url");
      if (bytes.toString("base64url") === value) return cursorSchema.parse(JSON.parse(bytes.toString()));
    } catch { /* 统一拒绝旧游标及非法编码。 */ }
    ctx.addIssue({ code: "custom", message: "无效的时间线游标" }); return z.NEVER;
  }),
});
function boundary(kind: "post" | "work", cursor: z.infer<typeof cursorSchema> | undefined) {
  if (!cursor) return {};
  const date = new Date(cursor.publishedAt);
  return { OR: [
    { publishedAt: { lt: date } },
    ...(kind < cursor.kind ? [{ publishedAt: date }] : kind === cursor.kind ? [{ publishedAt: date, id: { lt: cursor.id } }] : []),
  ] };
}
export async function queryBlogFeed(actorId: string, raw: unknown = {}): Promise<BlogFeed> {
  const { q, cursor, limit } = parseBody(feedQuerySchema, raw);
  const matchPost: Prisma.PostWhereInput = q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { content: { contains: q, mode: "insensitive" } }] } : {};
  const [posts, works] = await Promise.all([
    prisma.post.findMany({ where: { AND: [getPostVisibilityWhere(actorId), { workId: null }, matchPost, boundary("post", cursor)] }, orderBy: [{ publishedAt: "desc" }, { id: "desc" }], take: limit + 1, select: postTimelineSelect }),
    prisma.blogWork.findMany({ where: { AND: [{ status: "published" }, boundary("work", cursor), ...(q ? [{ OR: [{ posts: { some: matchPost } }, { elements: { some: { caption: { contains: q, mode: "insensitive" as const } } } }] }] : [])] }, orderBy: [{ publishedAt: "desc" }, { id: "desc" }], take: limit + 1, select: { id: true, publishedAt: true } }),
  ]);
  const merged = [...posts.map(post => ({ kind: "post" as const, id: post.id, publishedAt: post.publishedAt! })), ...works.map(work => ({ kind: "work" as const, id: work.id, publishedAt: work.publishedAt! }))].sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime() || (a.kind < b.kind ? 1 : a.kind > b.kind ? -1 : a.id < b.id ? 1 : -1));
  const page = merged.slice(0, limit), projected = await projectTimelinePosts(posts);
  const entries = await Promise.all(page.map(async key => {
    if (key.kind === "post") return { kind: "post", post: projected.find(p => p.id === key.id)! };
    const work = await readWork(actorId, key.id), needle = q.toLocaleLowerCase();
    const matches = q ? [...work.posts.filter(p => `${p.title}\n${p.content}`.toLocaleLowerCase().includes(needle)).map(p => p.elementId), ...work.elements.filter(e => e.type === "photo" && e.caption?.toLocaleLowerCase().includes(needle)).map(e => e.id)] : [];
    return { kind: "work", work, ...(q ? { matchedElementIds: matches } : {}) };
  })) as BlogFeedEntry[];
  const last = page.at(-1);
  return { entries, nextCursor: merged.length > limit && last ? Buffer.from(JSON.stringify({ v: 1, ...last, publishedAt: last.publishedAt.toISOString() })).toString("base64url") : null };
}
