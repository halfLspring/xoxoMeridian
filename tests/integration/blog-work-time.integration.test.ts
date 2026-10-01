import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { listDrafts, readWork } from "@/lib/blog-work/queries";
import { createTestUser, resetTestDatabase } from "@/tests/integration/support/database";

beforeEach(resetTestDatabase);
afterAll(() => prisma.$disconnect());

it.each(["draft", "published"] as const)("%s 读取保留每篇博文的作者快照，列表按首篇快照而非当前档案展示", async status => {
  const owner = await createTestUser();
  await prisma.userProfile.create({ data: { userId: owner.id, city: "Shanghai", country: "China", timezone: "Asia/Shanghai" } });
  await prisma.atlasBoard.create({ data: { id: "home-board" } });
  const publishedAt = status === "published" ? new Date("2026-09-30T23:30:00.000Z") : null;
  const work = await prisma.blogWork.create({ data: { ownerId: owner.id, boardId: "home-board", status, publishedAt } });
  for (const [workOrder, authorTimezone] of [[1, null], [0, "Asia/Tokyo"]] as const) {
    const post = await prisma.post.create({ data: {
      workId: work.id, workOrder, authorId: owner.id, authorTimezone,
      slug: randomUUID(), title: `博文 ${workOrder}`, content: "时区快照", publishedAt,
    } });
    await prisma.atlasElement.create({ data: { workId: work.id, boardId: "home-board", type: "note", postId: post.id, x: 0, y: 0 } });
  }
  const snapshot = await readWork(owner.id, work.id);
  expect(snapshot.posts.map(post => ({ order: post.workOrder, timezone: post.authorTimezone })))
    .toEqual([{ order: 0, timezone: "Asia/Tokyo" }, { order: 1, timezone: null }]);
  if (status === "draft") {
    const empty = await prisma.blogWork.create({ data: { ownerId: owner.id, boardId: "home-board" } });
    const { drafts } = await listDrafts(owner.id, {});
    expect(drafts.find(draft => draft.id === work.id)?.authorTimezone).toBe("Asia/Tokyo");
    expect(drafts.find(draft => draft.id === empty.id)?.authorTimezone).toBeNull();
  }
});
