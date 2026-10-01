import type { BlogWork, Prisma } from "@prisma/client";

export class WorkError extends Error {
  constructor(public code: string, public status: number, message: string) { super(message); }
}
export function visibleWorkWhere(actorId: string): Prisma.BlogWorkWhereInput {
  return { OR: [{ status: "published" }, { ownerId: actorId }] };
}
export function assertWorkAccess(work: BlogWork | null, actorId: string, ownerOnly = false): asserts work is BlogWork {
  if (!work || (work.status === "draft" && work.ownerId !== actorId)) throw new WorkError("NOT_FOUND", 404, "作品不可用");
  if (ownerOnly && work.ownerId !== actorId) throw new WorkError("FORBIDDEN", 403, "仅作者可操作");
}
export function visibleElementWhere(actorId: string): Prisma.AtlasElementWhereInput {
  return { boardId: "home-board", OR: [
    { work: { is: visibleWorkWhere(actorId) } },
    { workId: null, OR: [{ type: "photo", postId: null }, { post: { is: { type: "user_post", publishedAt: { not: null }, workId: null } } }] },
  ] };
}
export function visibleConnectionWhere(actorId: string): Prisma.AtlasConnectionWhereInput {
  return {
    boardId: "home-board", work: { is: visibleWorkWhere(actorId) },
    fromEl: { is: visibleElementWhere(actorId) }, toEl: { is: visibleElementWhere(actorId) },
  };
}
