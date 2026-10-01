import type { UserProfile } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { generateSlug, snapshotProfileLocation, writePostWithUniqueSlug } from "@/lib/posts";
import { transaction } from "@/lib/blog-work/mutations";
import { WorkError } from "@/lib/blog-work/policy";

// New Post 沿用独立文章的发布方式，不为普通发文建立空间作品。
export async function createStandalonePost(actor: { id: string; profile?: UserProfile | null }, data: { title: string; content: string }) {
  return writePostWithUniqueSlug(generateSlug(data.title), slug => prisma.post.create({
    data: { ...data, slug, type: "user_post", authorId: actor.id, ...snapshotProfileLocation(actor.profile), publishedAt: new Date() },
  }));
}

// 兼容入口仍是完整校验后的显式发布，一次事务建立单篇公开作品及 anchor。
export async function createPublishedPost(actor: { id: string; profile?: UserProfile | null }, data: { title: string; content: string }) {
  return writePostWithUniqueSlug(generateSlug(data.title), slug => transaction(async tx => {
    await tx.atlasBoard.upsert({ where: { id: "home-board" }, create: { id: "home-board" }, update: {} });
    const now = new Date();
    const work = await tx.blogWork.create({ data: { ownerId: actor.id, boardId: "home-board", status: "published", publishedAt: now } });
    const post = await tx.post.create({ data: { ...data, slug, type: "user_post", authorId: actor.id, ...snapshotProfileLocation(actor.profile), publishedAt: now, workId: work.id, workOrder: 0 } });
    await tx.atlasElement.create({ data: { boardId: "home-board", workId: work.id, postId: post.id, type: "note", createdById: actor.id, x: 0, y: 0, width: 352, height: 180 } });
    return post;
  }));
}
export async function updatePublishedPost(postId: string, actorId: string, data: { title?: string; content?: string }) {
  const update = (slug?: string) => transaction(async tx => {
    const post = await tx.post.findUnique({ where: { id: postId } });
    if (!post?.publishedAt) throw new WorkError("NOT_FOUND", 404, "Not found");
    if (post.authorId !== actorId) throw new WorkError("FORBIDDEN", 403, "Forbidden");
    if (post.workId) await tx.blogWork.update({ where: { id: post.workId }, data: { revision: { increment: 1 } } });
    return tx.post.update({ where: { id: postId }, data: { ...data, ...(slug ? { slug } : {}) } });
  });
  return data.title !== undefined ? writePostWithUniqueSlug(generateSlug(data.title), update) : update();
}
export async function deletePublishedPost(postId: string, actorId: string) {
  return transaction(async tx => {
    const post = await tx.post.findUnique({ where: { id: postId } });
    if (!post?.publishedAt) throw new WorkError("NOT_FOUND", 404, "Not found");
    if (post.authorId !== actorId) throw new WorkError("FORBIDDEN", 403, "Forbidden");
    if (post.workId) await tx.blogWork.update({ where: { id: post.workId }, data: { revision: { increment: 1 } } });
    await tx.post.delete({ where: { id: postId } });
  });
}
