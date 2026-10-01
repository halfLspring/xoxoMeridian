import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createTestUser, resetTestDatabase } from "@/tests/integration/support/database";
import { createWork, mutateWork } from "@/lib/blog-work/mutations";
import { readWork, listDrafts } from "@/lib/blog-work/queries";
import { queryBlogFeed } from "@/lib/blog-work/feed";
import { assertAssetRead, cleanupBlogAssets, uploadWorkPhoto } from "@/lib/blog-work/assets";
import { getHomeBoardSnapshot } from "@/lib/home-board";
import { getPostVisibilityWhere } from "@/lib/post-visibility";
import type { MutationInput, WorkCommand } from "@/lib/blog-work/schemas";
const storage = vi.hoisted(() => ({ save: vi.fn(), delete: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/storage/atlas-storage", async original => ({ ...await original<typeof import("@/lib/storage/atlas-storage")>(), getAtlasStorage: () => storage }));
let owner: string, other: string;
const frame = { viewportX: 0, viewportY: 0, viewportWidth: 960, viewportHeight: 540, draftX: 20, draftY: 40 };
const draft = () => createWork(owner, { ...frame, mutationId: randomUUID() });
const command = async (id: string, cmd: WorkCommand, actor = owner) => { const w = await readWork(actor, id); return mutateWork(actor, id, { mutationId: randomUUID(), baseRevision: w.revision, expectedStatus: w.status }, cmd); };
function file() { return new File([Buffer.from("89504e470d0a1a0a49454e44", "hex")], "test.png", { type: "image/png" }); }
async function photo(id: string, x = 100) { const w = await readWork(owner, id); return uploadWorkPhoto(owner, id, { mutationId: randomUUID(), baseRevision: w.revision, expectedStatus: w.status }, { x, y: 100, width: 320, height: 240, caption: "绿叶照片" }, file()); }
beforeEach(async () => { await resetTestDatabase(); owner = (await createTestUser()).id; other = (await createTestUser()).id; vi.clearAllMocks(); storage.save.mockResolvedValue({}); storage.delete.mockResolvedValue(undefined); });
afterAll(() => prisma.$disconnect());
describe("空间草稿真实数据库生命周期", () => {
  it("空白创建幂等，框选不会吸收公开对象", async () => {
    await prisma.atlasBoard.create({ data: { id: "home-board" } });
    const old = await prisma.atlasElement.create({ data: { boardId: "home-board", type: "photo", x: 20, y: 40 } });
    const input = { ...frame, mutationId: randomUUID() }, a = await createWork(owner, input), b = await createWork(owner, input);
    expect(a).toEqual(b); expect((await readWork(owner, a.workId)).elements).toHaveLength(0);
    expect((await prisma.atlasElement.findUniqueOrThrow({ where: { id: old.id } })).workId).toBeNull();
    await expect(createWork(owner, { ...input, viewportWidth: 1000 })).rejects.toMatchObject({ status: 409 });
  });
  it("所有公共查询隔离草稿，图片字节须经归属授权", async () => {
    const w = await draft(); await command(w.workId, { operation: "post.create", data: { title: "私密标题", content: "秘密正文" } }); await photo(w.workId);
    await expect(readWork(other, w.workId)).rejects.toMatchObject({ status: 404 });
    expect((await listDrafts(other, {})).drafts).toHaveLength(0);
    expect((await queryBlogFeed(owner, { q: "私密标题" })).entries).toHaveLength(0);
    expect(await prisma.post.count({ where: getPostVisibilityWhere(owner) })).toBe(0);
    expect((await getHomeBoardSnapshot({ boardId: "home-board", userId: owner })).elements).toHaveLength(0);
    const asset = await prisma.blogMediaAsset.findFirstOrThrow();
    await expect(assertAssetRead(asset.storageKey, owner)).resolves.toBeUndefined();
    await expect(assertAssetRead(asset.storageKey, other)).rejects.toMatchObject({ status: 404 });
    await expect(assertAssetRead("untracked.png", owner)).rejects.toMatchObject({ status: 404 });
  });
  it("纯文字和同名多篇整组发布，时间和归属稳定", async () => {
    const w = await draft(); for (let i = 0; i < 2; i++) await command(w.workId, { operation: "post.create", data: { title: "同名", content: `正文 ${i}` } });
    const before = await readWork(owner, w.workId), input: MutationInput = { mutationId: randomUUID(), expectedStatus: "draft", baseRevision: before.revision };
    const published = await mutateWork(owner, w.workId, input, { operation: "publish" });
    expect(await mutateWork(owner, w.workId, input, { operation: "publish" })).toEqual(published);
    const after = await readWork(other, w.workId); expect(after.posts.map(p => p.slug)).toEqual(["tong-ming", "tong-ming-2"]); expect(new Set(after.posts.map(p => p.publishedAt)).size).toBe(1); expect(after).not.toHaveProperty("draftX");
    expect((await queryBlogFeed(other, { q: "正文 1" })).entries).toHaveLength(1);
    await command(w.workId, { operation: "post.update", id: after.posts[0].id, data: { title: "新标题", content: "新正文" } });
    expect((await readWork(owner, w.workId)).publishedAt).toBe(after.publishedAt);
    await expect(mutateWork(owner, w.workId, { ...input, mutationId: randomUUID() }, { operation: "frame", data: { viewportWidth: 400 } })).rejects.toMatchObject({ code: "STATUS_CONFLICT" });
  });
  it("空白正文阻止全组发布，不丢弃或部分公开", async () => {
    const w = await draft(); await command(w.workId, { operation: "post.create", data: { title: "", content: "保留尾部空格  " } }); await photo(w.workId);
    await expect(command(w.workId, { operation: "publish" })).rejects.toBeDefined();
    const after = await readWork(owner, w.workId); expect(after.status).toBe("draft"); expect(after.posts[0].content).toBe("保留尾部空格  "); expect(after.revision).toBe(3);
  });
  it("发布事务数据库故障全组回滚", async () => {
    const w = await draft(); await command(w.workId, { operation: "post.create", data: { title: "故障", content: "正文" } });
    await prisma.$executeRawUnsafe(`CREATE FUNCTION reject_blog_publish() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status = 'published' THEN RAISE EXCEPTION 'injected'; END IF; RETURN NEW; END $$`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER reject_publish BEFORE UPDATE ON "BlogWork" FOR EACH ROW EXECUTE FUNCTION reject_blog_publish()`);
    try { await expect(command(w.workId, { operation: "publish" })).rejects.toBeDefined(); const after = await readWork(owner, w.workId); expect(after.status).toBe("draft"); expect(after.posts[0].slug).toBeNull(); expect(after.posts[0].publishedAt).toBeNull(); }
    finally { await prisma.$executeRawUnsafe('DROP TRIGGER reject_publish ON "BlogWork"'); await prisma.$executeRawUnsafe('DROP FUNCTION reject_blog_publish()'); }
  });
  it("公开图线允许协作，正文和边框及整组删除仅作者", async () => {
    const w = await draft(), p = await photo(w.workId); await command(w.workId, { operation: "publish" });
    await command(w.workId, { operation: "photo.update", id: p.resourceId!, data: { rotation: 25, caption: "伙伴标注" } }, other);
    for (const cmd of [{ operation: "frame", data: { viewportWidth: 300 } }, { operation: "post.create", data: { title: "不能写", content: "不能写" } }, { operation: "delete" }] as WorkCommand[]) await expect(command(w.workId, cmd, other)).rejects.toMatchObject({ status: 403 });
    await command(w.workId, { operation: "photo.delete", id: p.resourceId! }, other);
    expect((await readWork(other, w.workId)).elements).toHaveLength(0);
  });
  it("并发 CAS 只有一个提交，重试不重复创建", async () => {
    const w = await draft(), input = { mutationId: randomUUID(), baseRevision: 0, expectedStatus: "draft" as const };
    const result = await Promise.allSettled([mutateWork(owner, w.workId, input, { operation: "post.create", data: { title: "A", content: "A" } }), mutateWork(owner, w.workId, { ...input, mutationId: randomUUID() }, { operation: "post.create", data: { title: "B", content: "B" } })]);
    expect(result.filter(r => r.status === "fulfilled")).toHaveLength(1); expect((await readWork(owner, w.workId)).posts).toHaveLength(1);
  });
  it("窗口上限与300元素独立，超限更新零写入且可以发布全部", async () => {
    const w = await draft();
    await prisma.$transaction(async tx => { for (let i = 0; i < 300; i++) { const p = await tx.post.create({ data: { workId: w.workId, workOrder: i, slug: `draft-${i}`, title: `博文 ${i}`, content: "正文", authorId: owner } }); await tx.atlasElement.create({ data: { workId: w.workId, boardId: "home-board", type: "note", postId: p.id, x: 0, y: i * 212 } }); } }, { timeout: 15000 });
    await command(w.workId, { operation: "frame", data: { viewportWidth: 8192, viewportHeight: 8192 } });
    await expect(command(w.workId, { operation: "frame", data: { viewportHeight: 8193 } })).rejects.toBeDefined();
    await expect(command(w.workId, { operation: "post.create", data: { title: "第301项", content: "正文" } })).rejects.toMatchObject({ code: "LIMIT" });
    await command(w.workId, { operation: "publish" }); const result = await readWork(other, w.workId); expect(result.posts).toHaveLength(300); expect(result.posts.at(-1)?.title).toBe("博文 299"); expect(result.viewportHeight).toBe(8192);
  });
  it("跨作品线不改变外部归属，删外部端点级联连线并推进草稿版本", async () => {
    const a = await draft(), b = await draft(), pa = await photo(a.workId), pb = await photo(b.workId); await command(b.workId, { operation: "publish" });
    await command(a.workId, { operation: "connection.create", data: { fromId: pa.resourceId!, toId: pb.resourceId!, color: "#72975a" } });
    expect((await readWork(other, b.workId)).connections).toHaveLength(0);
    await expect(command(a.workId, { operation: "connection.create", data: { fromId: pb.resourceId!, toId: pa.resourceId!, color: "#72975a" } })).rejects.toMatchObject({ status: 409 });
    const before = await readWork(owner, a.workId); await command(b.workId, { operation: "delete" }); const after = await readWork(owner, a.workId); expect(after.connections).toHaveLength(0); expect(after.revision).toBeGreaterThan(before.revision); expect(after.elements).toHaveLength(1);
  });
  it("另一私密草稿不能作为外部端点", async () => { const a = await draft(), b = await draft(), pa = await photo(a.workId), pb = await photo(b.workId); await expect(command(a.workId, { operation: "connection.create", data: { fromId: pa.resourceId!, toId: pb.resourceId!, color: "#72975a" } })).rejects.toMatchObject({ status: 400 }); });
  it("已发布整组删除原子清理图文及双向跨组连线，保留外部内容且可幂等重试", async () => {
    const local = await draft(), external = await draft();
    for (const work of [local, external]) {
      for (let i = 0; i < 2; i++) await command(work.workId, { operation: "post.create", data: { title: `${work.workId} 第 ${i} 篇`, content: "整组删除回归" } });
      await photo(work.workId); await photo(work.workId, 500);
      await command(work.workId, { operation: "publish" });
    }
    const a = await readWork(owner, local.workId), b = await readWork(owner, external.workId);
    const ap = a.elements.filter(e => e.type === "photo"), bp = b.elements.filter(e => e.type === "photo");
    const connect = (id: string, fromId: string, toId: string) => command(id, { operation: "connection.create", data: { fromId, toId, color: "#72975a" } });
    await connect(a.id, ap[0].id, a.posts[0].elementId);
    await connect(a.id, ap[1].id, bp[0].id);
    await connect(b.id, bp[1].id, ap[0].id);
    const keepLine = await connect(b.id, bp[0].id, b.posts[0].elementId);
    const current = await readWork(owner, a.id), externalBefore = await readWork(owner, b.id);
    const input: MutationInput = { mutationId: randomUUID(), baseRevision: current.revision, expectedStatus: "published" };
    const localAssets = await prisma.blogMediaAsset.findMany({ where: { workId: a.id } });
    const externalAssets = await prisma.blogMediaAsset.findMany({ where: { workId: b.id } });
    await expect(mutateWork(other, a.id, input, { operation: "delete" })).rejects.toMatchObject({ status: 403 });
    await expect(mutateWork(owner, a.id, { ...input, baseRevision: current.revision - 1 }, { operation: "delete" })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect(await readWork(owner, a.id)).toEqual(current);
    const deleted = await mutateWork(owner, a.id, input, { operation: "delete" });
    expect(deleted.deleted).toBe(true);
    expect(await mutateWork(owner, a.id, input, { operation: "delete" })).toEqual(deleted);
    await expect(readWork(owner, a.id)).rejects.toMatchObject({ status: 404 });
    expect(await prisma.post.count({ where: { workId: a.id } })).toBe(0);
    expect(await prisma.atlasElement.count({ where: { workId: a.id } })).toBe(0);
    expect(await prisma.atlasConnection.count({ where: { OR: [{ workId: a.id }, { fromId: { in: a.elements.map(e => e.id) } }, { toId: { in: a.elements.map(e => e.id) } }] } })).toBe(0);
    const externalAfter = await readWork(owner, b.id);
    expect(externalAfter.posts).toEqual(externalBefore.posts);
    expect(externalAfter.elements).toEqual(externalBefore.elements);
    expect(externalAfter.connections.map(c => c.id)).toEqual([keepLine.resourceId]);
    expect(externalAfter.revision).toBeGreaterThan(externalBefore.revision);
    for (const asset of localAssets) await expect(assertAssetRead(asset.storageKey, owner)).rejects.toMatchObject({ status: 404 });
    for (const asset of externalAssets) await expect(assertAssetRead(asset.storageKey, other)).resolves.toBeUndefined();
    expect(await cleanupBlogAssets()).toMatchObject({ deleted: 2, failed: 0 });
    expect(storage.delete.mock.calls.map(([key]) => key).sort()).toEqual(localAssets.map(asset => asset.storageKey).sort());
    expect((await queryBlogFeed(owner, {})).entries.filter(e => e.kind === "work").map(e => e.work.id)).toEqual([b.id]);
  });
  it("上传失败留清理账本、删除失败可重试，GC 不删仍被引用资源", async () => {
    const w = await draft(); storage.save.mockRejectedValueOnce(new Error("storage unavailable")); storage.delete.mockRejectedValueOnce(new Error("delete unavailable"));
    await expect(photo(w.workId)).rejects.toThrow("storage unavailable"); const broken = await prisma.blogMediaAsset.findFirstOrThrow(); expect(broken.status).toBe("cleanup");
    await photo(w.workId); const before = storage.delete.mock.calls.length;
    expect(await cleanupBlogAssets({ dryRun: true, now: new Date(Date.now() + 120000) })).toMatchObject({ inspected: 1, deleted: 0 }); expect(storage.delete).toHaveBeenCalledTimes(before);
    expect(await cleanupBlogAssets({ now: new Date(Date.now() + 120000) })).toMatchObject({ deleted: 1 });
    expect(await prisma.blogMediaAsset.count({ where: { status: "ready" } })).toBe(1);
    await prisma.user.delete({ where: { id: owner } }); expect(await cleanupBlogAssets({ now: new Date(Date.now() + 240000) })).toMatchObject({ deleted: 1 });
  });
  it("图片上传重放不重复创建，私密变公开不改变 key", async () => {
    const w = await draft(), input = { mutationId: randomUUID(), baseRevision: 0, expectedStatus: "draft" as const }, fields = { x: 0, y: 0, width: 320, height: 240, caption: "" };
    const first = await uploadWorkPhoto(owner, w.workId, input, fields, file()); expect(await uploadWorkPhoto(owner, w.workId, input, fields, file())).toEqual(first);
    const asset = await prisma.blogMediaAsset.findFirstOrThrow(); await command(w.workId, { operation: "publish" }); await expect(assertAssetRead(asset.storageKey, other)).resolves.toBeUndefined(); expect(storage.save).toHaveBeenCalledTimes(1);
  });
  it("两个作品并发发布同名博文，slug 重试保留完整事务", async () => {
    const a = await draft(), b = await draft();
    for (const w of [a, b]) await command(w.workId, { operation: "post.create", data: { title: "并发同名", content: "正文" } });
    await Promise.all([command(a.workId, { operation: "publish" }), command(b.workId, { operation: "publish" })]);
    const works = await Promise.all([readWork(owner, a.workId), readWork(owner, b.workId)]);
    expect(works.map(w => w.status)).toEqual(["published", "published"]);
    expect(new Set(works.map(w => w.posts[0].slug)).size).toBe(2);
  });
  it("上传期间阻止发布，删除后的迟到存储完成不会复活作品或资源", async () => {
    const w = await draft();
    let release!: () => void, started!: () => void;
    const saving = new Promise<void>(resolve => { started = resolve; });
    storage.save.mockImplementationOnce(() => { started(); return new Promise<void>(resolve => { release = resolve; }); });
    const pending = photo(w.workId).catch(error => error);
    await saving;
    await expect(command(w.workId, { operation: "publish" })).rejects.toMatchObject({ code: "UPLOAD_PENDING" });
    await command(w.workId, { operation: "delete" }); release();
    expect(await pending).toMatchObject({ code: "UPLOAD_EXPIRED" });
    expect(await prisma.blogWork.count()).toBe(0); expect(await prisma.atlasElement.count()).toBe(0);
    const asset = await prisma.blogMediaAsset.findFirstOrThrow(); expect(asset.status).toBe("cleanup");
    await expect(assertAssetRead(asset.storageKey, owner)).rejects.toMatchObject({ status: 404 });
  });
});
