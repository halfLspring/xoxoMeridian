import { randomUUID } from "node:crypto";
import { beforeEach, afterAll, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createTestUser, resetTestDatabase } from "@/tests/integration/support/database";
import { createWork, mutateWork } from "@/lib/blog-work/mutations";
const auth = vi.hoisted(() => ({ id: "" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireCurrentUser: async () => { if (!auth.id) throw new Response("Unauthorized", { status: 401 }); return { id: auth.id }; }, requirePageUser: async () => ({ id: auth.id, displayName: "测试", avatarLabel: "测" }) }));
import { GET as getWork, PATCH as patchWork } from "@/app/api/blog/works/[workId]/route";
import { GET as feed } from "@/app/api/blog/feed/route";
import { GET as posts } from "@/app/api/posts/route";
import { GET as detail, PUT as legacyPut } from "@/app/api/posts/[slug]/route";
import { PATCH as oldHomePatch } from "@/app/api/home-board/elements/[elementId]/route";
import { GET as bytes } from "@/app/api/atlas/uploads/[filename]/route";
import HomePage from "@/app/home/page";
let owner: string, other: string;
beforeEach(async () => { await resetTestDatabase(); owner = (await createTestUser()).id; other = (await createTestUser()).id; auth.id = owner; });
afterAll(() => prisma.$disconnect());
const create = () => createWork(owner, { mutationId: randomUUID(), viewportX: 0, viewportY: 0, viewportWidth: 960, viewportHeight: 540, draftX: 123, draftY: 234 });
it("跨用户新旧 GET/详情/SSR 载荷不含私密正文，旧写路径拒绝作品锚点", async () => {
  const w = await create(); await mutateWork(owner, w.workId, { mutationId: randomUUID(), baseRevision: 0, expectedStatus: "draft" }, { operation: "post.create", data: { title: "PRIVATE-TITLE", content: "PRIVATE-CONTENT" } });
  const post = await prisma.post.findFirstOrThrow({ where: { workId: w.workId } }), element = await prisma.atlasElement.findFirstOrThrow({ where: { workId: w.workId } }); auth.id = other;
  expect((await getWork(new Request("http://localhost/api/blog/works/x"), { params: Promise.resolve({ workId: w.workId }) })).status).toBe(404);
  expect((await detail(new Request("http://localhost/api/posts/x"), { params: Promise.resolve({ slug: post.slug }) })).status).toBe(404);
  for (const response of [await posts(new Request("http://localhost/api/posts")), await feed(new Request("http://localhost/api/blog/feed?q=PRIVATE"))]) expect(await response.text()).not.toContain("PRIVATE");
  expect(JSON.stringify(await HomePage())).not.toContain("PRIVATE");
  for (const actor of [owner, other]) { auth.id = actor; expect((await legacyPut(new Request("http://localhost/api/posts/x", { method: "PUT", body: JSON.stringify({ title: "hacked" }) }), { params: Promise.resolve({ slug: post.slug }) })).status).toBe(404); expect((await oldHomePatch(new Request("http://localhost/api/home-board/elements/x", { method: "PATCH", body: JSON.stringify({ x: 500 }) }), { params: Promise.resolve({ elementId: element.id }) })).status).toBe(404); }
});
it("身份前置条件、畸形输入、幂等键重用和错误响应均 no-store", async () => {
  const w = await create();
  const request = (body: unknown, actor = owner) => new Request("http://localhost/api/blog/works/x", { method: "PATCH", headers: { "X-Blog-Viewer-Id": actor }, body: JSON.stringify(body) });
  const params = { params: Promise.resolve({ workId: w.workId }) };
  const input = { mutationId: randomUUID(), baseRevision: 0, expectedStatus: "draft", command: { operation: "frame", data: { viewportWidth: 800 } } };
  const wrongActor = await patchWork(request(input, other), params); expect(wrongActor.status).toBe(401); expect(wrongActor.headers.get("cache-control")).toContain("no-store");
  const invalid = await patchWork(request({ ...input, command: { operation: "frame", data: { ownerId: other } } }), params); expect(invalid.status).toBe(400); expect(invalid.headers.get("vary")).toContain("Cookie");
  expect((await patchWork(request(input), params)).status).toBe(200);
  const reused = await patchWork(request({ ...input, baseRevision: 1 }), params); expect(reused.status).toBe(409); expect((await reused.json()).code).toBe("MUTATION_REUSED");
  auth.id = ""; const anonymous = await getWork(new Request("http://localhost/api/blog/works/x"), params); expect(anonymous.status).toBe(401); expect(anonymous.headers.get("cache-control")).toContain("no-store");
});
it("pending、无引用和任意存储 key 均在读取字节前被拒绝", async () => {
  const w = await create(); const key = `atlas/${randomUUID()}.png`;
  await prisma.blogMediaAsset.create({ data: { storageKey: key, ownerId: owner, workId: w.workId, uploadMutationId: randomUUID(), contentType: "image/png", size: 10, expiresAt: new Date(Date.now() + 10000) } });
  for (const filename of [key, "atlas/untracked.png", "../secret"]) { const response = await bytes(new Request("http://localhost/api/atlas/uploads/x"), { params: Promise.resolve({ filename }) }); expect(response.status).toBe(404); expect(response.headers.get("cache-control")).toContain("no-store"); }
});
