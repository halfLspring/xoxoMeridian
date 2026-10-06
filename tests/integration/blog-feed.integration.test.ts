import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createTestRoom, createTestUser, resetTestDatabase } from "@/tests/integration/support/database";
import { queryBlogFeed } from "@/lib/blog-work/feed";
import { createPublishedPost, createStandalonePost } from "@/lib/blog-work/legacy-posts";
import type { BlogFeed } from "@/lib/blog-work/types";
const auth = vi.hoisted(() => ({ userId: "" }));
vi.mock("@/lib/auth", () => ({ requireCurrentUser: async () => ({ id: auth.userId }) }));
import { GET } from "@/app/api/blog/feed/route";
let actor: string;
beforeEach(async () => { await resetTestDatabase(); actor = (await createTestUser()).id; auth.userId = actor; });
afterAll(() => prisma.$disconnect());
it.each([1, 17, 50])("大量日志穿插同毫秒混合时间线 limit=%s：首页/API/搜索无重复遗漏且日志载荷不变", async limit => {
  const now = new Date("2026-09-30T01:00:00.123Z");
  await prisma.atlasBoard.create({ data: { id: "home-board" } });
  for (let i = 0; i < 25; i++) {
    await prisma.post.create({ data: { id: `legacy-${i}`, slug: randomUUID(), title: "首页记录 weather.get agent.log", content: "正文", publishedAt: now, authorId: actor } });
    await prisma.blogWork.create({ data: { id: `work-${i}`, ownerId: actor, boardId: "home-board", status: "published", publishedAt: now, posts: { create: { slug: randomUUID(), title: "首页记录 作品内", content: "正文", workOrder: 0, publishedAt: now, authorId: actor } } } });
  }
  const posts = await prisma.post.findMany({ where: { workId: { not: null } } });
  for (const post of posts) await prisma.atlasElement.create({ data: { workId: post.workId, boardId: "home-board", type: "note", postId: post.id, x: 0, y: 0 } });
  const room = await createTestRoom();
  await prisma.roomParticipant.create({ data: { roomId: room.id, userId: actor } });
  await prisma.post.createMany({ data: Array.from({ length: 180 }, (_, i) => ({
    id: `log-${i}`, slug: `log-${i}`, title: "首页记录 作品内 工具日志", content: `输入输出 ${i}`,
    type: "agent_log" as const, roomId: room.id, publishedAt: new Date(now.getTime() + (i % 3 - 1)),
    metadata: { taskId: `missing-${i}`, input: { index: i }, output: { values: [i, "完整载荷"] }, error: i % 2 ? "合成错误" : null },
  })) });
  const logsBefore = await prisma.post.findMany({ where: { type: "agent_log" }, orderBy: { id: "asc" } });
  for (const q of ["", "首页记录"]) {
    const keys: string[] = []; let cursor: string | null = null;
    do {
      const feed = await queryBlogFeed(actor, { q, limit, ...(cursor ? { cursor } : {}) });
      const response = await GET(new Request(`http://localhost/api/blog/feed?${new URLSearchParams({ q, limit: String(limit), ...(cursor ? { cursor } : {}) })}`));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(JSON.parse(JSON.stringify(feed)));
      expect(feed.entries).toHaveLength(Math.min(limit, 50 - keys.length));
      keys.push(...feed.entries.map(entry => entry.kind === "post" ? entry.post.id : entry.work.id));
      expect(keys.length).toBeLessThanOrEqual(50);
      cursor = feed.nextCursor;
    } while (cursor);
    expect(keys).toHaveLength(50); expect(new Set(keys).size).toBe(50);
    expect(keys.slice(0, 25).every(key => key.startsWith("work-"))).toBe(true);
    expect([...keys].sort()).toEqual(Array.from({ length: 25 }, (_, i) => [`legacy-${i}`, `work-${i}`]).flat().sort());
  }
  const search = await queryBlogFeed(actor, { q: "作品内", limit: 100 }); expect(search.entries).toHaveLength(25); expect(search.entries.every(e => e.kind === "work")).toBe(true);
  expect(await prisma.post.findMany({ where: { type: "agent_log" }, orderBy: { id: "asc" } })).toEqual(logsBefore);
});
it("纯日志首页与仅命中日志的搜索返回空集合和空游标，日志原样保留", async () => {
  const room = await createTestRoom();
  await prisma.roomParticipant.create({ data: { roomId: room.id, userId: actor } });
  await prisma.post.createMany({ data: Array.from({ length: 75 }, (_, i) => ({
    slug: `only-log-${i}`, title: "仅日志命中", content: "日志正文", type: "agent_log" as const,
    roomId: room.id, publishedAt: new Date(), metadata: { taskId: `deleted-task-${i}` },
  })) });
  const before = await prisma.post.findMany({ orderBy: { id: "asc" } });
  for (const q of ["", "仅日志命中"]) {
    expect(await queryBlogFeed(actor, { q, limit: 1 })).toEqual({ entries: [], nextCursor: null });
    const response = await GET(new Request(`http://localhost/api/blog/feed?q=${encodeURIComponent(q)}&limit=50`));
    expect(response.status).toBe(200);
    expect(await response.json() as BlogFeed).toEqual({ entries: [], nextCursor: null });
  }
  expect(await prisma.post.findMany({ orderBy: { id: "asc" } })).toEqual(before);
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
