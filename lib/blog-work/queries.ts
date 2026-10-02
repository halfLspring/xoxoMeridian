import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { parseBody } from "@/lib/validation";
import { assertWorkAccess, visibleConnectionWhere, visibleElementWhere } from "@/lib/blog-work/policy";
import type { WorkSnapshot } from "@/lib/blog-work/types";
import { workIdSchema } from "@/lib/blog-work/schemas";
import { visibleAnchor, windowRect } from "@/lib/blog-work/geometry";

export async function readWork(actorId: string, id: string): Promise<WorkSnapshot> {
  const work = await prisma.blogWork.findUnique({ where: { id: parseBody(workIdSchema, id) }, include: {
    owner: { select: { displayName: true } }, posts: { orderBy: { workOrder: "asc" } }, elements: { orderBy: { zIndex: "asc" } },
  } });
  assertWorkAccess(work, actorId);
  const connections = await prisma.atlasConnection.findMany({ where: { AND: [visibleConnectionWhere(actorId), { OR: [{ workId: id }, { work: { is: { status: "published" } } }] }], OR: [{ workId: id }, { fromEl: { workId: id } }, { toEl: { workId: id } }] } });
  return {
    id: work.id, ownerId: work.ownerId, ownerName: work.owner.displayName, status: work.status, revision: work.revision,
    viewportX: work.viewportX, viewportY: work.viewportY, viewportWidth: work.viewportWidth, viewportHeight: work.viewportHeight,
    layoutWidth: work.layoutWidth, ...(work.status === "draft" ? { draftX: work.draftX, draftY: work.draftY } : {}),
    publishedAt: work.publishedAt?.toISOString() ?? null, updatedAt: work.updatedAt.toISOString(), canManage: work.ownerId === actorId,
    posts: work.posts.map(p => ({ id: p.id, slug: work.status === "draft" ? null : p.slug, title: p.title, content: p.content, workOrder: p.workOrder!, publishedAt: p.publishedAt?.toISOString() ?? null, authorTimezone: p.authorTimezone, authorCity: p.authorCity, authorCountry: p.authorCountry, elementId: work.elements.find(e => e.postId === p.id)!.id })),
    elements: work.elements.map(e => ({ id: e.id, workId: work.id, type: e.type, postId: e.postId, x: e.x, y: e.y, width: e.width, height: e.height, rotation: e.rotation, zIndex: e.zIndex, caption: e.caption, content: null, imageUrl: e.imageUrl, createdById: e.createdById, createdAt: e.createdAt.toISOString() })),
    connections: connections.map(c => ({ id: c.id, workId: c.workId!, fromId: c.fromId, toId: c.toId, color: c.color })),
  };
}
const listCursor = z.strictObject({ updatedAt: z.iso.datetime(), id: workIdSchema });
export const draftListQuerySchema = z.object({
  cursor: z.string().max(1024).optional().transform((value, ctx) => {
    if (!value) return undefined;
    try { return listCursor.parse(JSON.parse(Buffer.from(value, "base64url").toString())); }
    catch { ctx.addIssue({ code: "custom", message: "无效游标" }); return z.NEVER; }
  }), limit: z.coerce.number().int().min(1).max(50).default(20),
});
export async function listDrafts(actorId: string, raw: unknown) {
  const { cursor, limit } = parseBody(draftListQuerySchema, raw);
  const works = await prisma.blogWork.findMany({ where: { ownerId: actorId, status: "draft", ...(cursor ? { OR: [{ updatedAt: { lt: new Date(cursor.updatedAt) } }, { updatedAt: new Date(cursor.updatedAt), id: { lt: cursor.id } }] } : {}) },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: limit + 1,
    select: { id: true, updatedAt: true, revision: true, viewportX: true, viewportY: true, viewportWidth: true, viewportHeight: true, posts: { orderBy: { workOrder: "asc" }, take: 1, select: { title: true, authorTimezone: true } }, elements: { where: { type: "photo", mediaAsset: { is: { status: "ready" } } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { imageUrl: true, x: true, y: true, width: true, height: true, rotation: true } } },
  });
  const page = works.slice(0, limit), last = page.at(-1);
  return { drafts: page.map(w => ({ id: w.id, revision: w.revision, updatedAt: w.updatedAt.toISOString(), authorTimezone: w.posts[0]?.authorTimezone ?? null, title: w.posts[0]?.title || "未命名草稿", thumbnail: w.elements.find(e => visibleAnchor(e, e.rotation, [windowRect(w)]))?.imageUrl ?? null })), nextCursor: works.length > limit && last ? Buffer.from(JSON.stringify({ updatedAt: last.updatedAt.toISOString(), id: last.id })).toString("base64url") : null };
}
export async function connectionTargets(actorId: string, workId: string, q: string) {
  await readWork(actorId, workId);
  const elements = await prisma.atlasElement.findMany({ where: { AND: [visibleElementWhere(actorId)], OR: [{ workId }, { work: { is: { status: "published" } } }, { workId: null }], ...(q ? { AND: [visibleElementWhere(actorId), { OR: [{ caption: { contains: q, mode: "insensitive" } }, { post: { title: { contains: q, mode: "insensitive" } } }] }] } : {}) }, take: 300, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, type: true, workId: true, caption: true, post: { select: { title: true } } } });
  return elements.map(e => ({ id: e.id, kind: e.type, workId: e.workId, name: e.post?.title || e.caption || (e.type === "photo" ? "未标注图片" : "未命名博文") }));
}
