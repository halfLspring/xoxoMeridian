import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createTestUser, resetTestDatabase } from "@/tests/integration/support/database";
import { queryBlogFeed } from "@/lib/blog-work/feed";
import { createPublishedPost, createStandalonePost } from "@/lib/blog-work/legacy-posts";
let actor: string;
beforeEach(async () => { await resetTestDatabase(); actor = (await createTestUser()).id; });
afterAll(() => prisma.$disconnect());
it.each([1, 17, 50])("同毫秒混合时间线 limit=%s 无重复遗漏，组内博文不独立入线", async limit => {
  const now = new Date("2026-09-30T01:00:00.123Z");
  await prisma.atlasBoard.create({ data: { id: "home-board" } });
  for (let i = 0; i < 25; i++) {
    await prisma.post.create({ data: { id: `legacy-${i}`, slug: randomUUID(), title: "旧文章", content: "正文", publishedAt: now, authorId: actor } });
    await prisma.blogWork.create({ data: { id: `work-${i}`, ownerId: actor, boardId: "home-board", status: "published", publishedAt: now, posts: { create: { slug: randomUUID(), title: "作品内", content: "正文", workOrder: 0, publishedAt: now, authorId: actor } } } });
  }
  const posts = await prisma.post.findMany({ where: { workId: { not: null } } });
  for (const post of posts) await prisma.atlasElement.create({ data: { workId: post.workId, boardId: "home-board", type: "note", postId: post.id, x: 0, y: 0 } });
  const keys: string[] = []; let cursor: string | null = null;
  do { const feed = await queryBlogFeed(actor, { limit, ...(cursor ? { cursor } : {}) }); keys.push(...feed.entries.map(entry => entry.kind === "post" ? entry.post.id : entry.work.id)); cursor = feed.nextCursor; } while (cursor);
  expect(keys).toHaveLength(50); expect(new Set(keys).size).toBe(50); expect(keys.slice(0, 25).every(key => key.startsWith("work-"))).toBe(true);
  const search = await queryBlogFeed(actor, { q: "作品内", limit: 100 }); expect(search.entries).toHaveLength(25); expect(search.entries.every(e => e.kind === "work")).toBe(true);
});
it("旧显式创建契约原子建立已发布单文作品并保留详情 slug", async () => {
  const post = await createPublishedPost({ id: actor }, { title: "兼容文章", content: "兼容正文" });
  expect(post.slug).toBe("jian-rong-wen-zhang"); expect(post.workId).not.toBeNull();
  const feed = await queryBlogFeed(actor); expect(feed.entries).toHaveLength(1); expect(feed.entries[0].kind).toBe("work");
  expect(await prisma.atlasElement.count({ where: { postId: post.id, workId: post.workId } })).toBe(1);
});
it("New Post 发布独立文章并分配唯一 slug，时间线不生成空间作品", async () => {
  const posts = await Promise.all([1, 2].map(() => createStandalonePost({ id: actor }, { title: "普通博文", content: "独立发布正文" })));
  expect(posts.map(post => post.slug).sort()).toEqual(["pu-tong-bo-wen", "pu-tong-bo-wen-2"]);
  for (const post of posts) {
    expect(post.workId).toBeNull();
    expect(post.workOrder).toBeNull();
    expect(post.publishedAt).toBeInstanceOf(Date);
    expect(post.authorId).toBe(actor);
  }
  expect(await prisma.blogWork.count()).toBe(0);
  const feed = await queryBlogFeed(actor);
  expect(feed.entries).toHaveLength(2);
  expect(feed.entries.every(entry => entry.kind === "post")).toBe(true);
});
