import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { generateSlug, snapshotProfileLocation } from "@/lib/posts";
import { parseBody, postCreateSchema } from "@/lib/validation";
import { assertWorkAccess, visibleElementWhere, WorkError } from "@/lib/blog-work/policy";
import { createWorkSchema, mutationSchema, workCommandSchema, windowSchema, type CreateWorkInput, type MutationInput, type WorkCommand } from "@/lib/blog-work/schemas";

export type Tx = Prisma.TransactionClient;
export type MutationResult = { workId: string; revision: number; resourceId?: string; publishedAt?: string; deleted?: boolean };
export function inputHash(input: unknown): string {
  function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
    return value;
  }
  return createHash("sha256").update(JSON.stringify(canonical(input))).digest("hex");
}
export async function transaction<T>(fn: (tx: Tx) => Promise<T>, retrySlug = false): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await prisma.$transaction(fn, { isolationLevel: "Serializable", timeout: 15000 }); }
    catch (error) {
      const retry = error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2034" ||
        (error.code === "P2002" && Array.isArray(error.meta?.target) &&
          (error.meta.target.includes("mutationId") || (retrySlug && error.meta.target.includes("slug")))));
      if (!retry || attempt >= 4) throw error;
    }
  }
}
export async function replay(tx: Tx, actorId: string, mutationId: string, hash: string): Promise<MutationResult | null> {
  const fact = await tx.blogWorkMutation.findUnique({ where: { actorId_mutationId: { actorId, mutationId } } });
  if (!fact) return null;
  if (fact.inputHash !== hash) throw new WorkError("MUTATION_REUSED", 409, "重试标识与原操作不一致");
  return fact.result as MutationResult;
}
export async function remember(tx: Tx, actorId: string, mutationId: string, hash: string, operation: string, result: MutationResult) {
  await tx.blogWorkMutation.create({ data: { actorId, mutationId, inputHash: hash, operation, workId: result.workId, result } });
  return result;
}
export async function advance(tx: Tx, workId: string, actorId: string, input: MutationInput, ownerOnly: boolean) {
  const work = await tx.blogWork.findUnique({ where: { id: workId } });
  assertWorkAccess(work, actorId, ownerOnly);
  if (work.status !== input.expectedStatus) throw new WorkError("STATUS_CONFLICT", 409, "作品状态已改变，请重新打开作品");
  const changed = await tx.blogWork.updateMany({ where: { id: workId, revision: input.baseRevision, status: input.expectedStatus }, data: { revision: { increment: 1 } } });
  if (!changed.count) throw new WorkError("REVISION_CONFLICT", 409, "作品已有更新，请选择保留哪份修改");
  return work;
}
export async function checkElementBudget(tx: Tx, workId: string) {
  const [count, pending] = await Promise.all([
    tx.atlasElement.count({ where: { workId } }), tx.blogMediaAsset.count({ where: { workId, status: "pending" } }),
  ]);
  if (count + pending >= 300) throw new WorkError("LIMIT", 400, "每份作品最多包含 300 个元素");
}
export async function allocateSlug(tx: Tx, title: string, excludeId?: string): Promise<string> {
  const base = generateSlug(title);
  for (let i = 1; i <= 5; i++) {
    const slug = i === 1 ? base : `${base}-${i}`;
    const exists = await tx.post.findUnique({ where: { slug }, select: { id: true } });
    if (!exists || exists.id === excludeId) return slug;
  }
  throw new WorkError("SLUG_CONFLICT", 409, "同名文章过多，请调整标题");
}
export async function createWork(actorId: string, raw: CreateWorkInput) {
  const input = parseBody(createWorkSchema, raw), hash = inputHash({ operation: "create", input });
  return transaction(async tx => {
    const previous = await replay(tx, actorId, input.mutationId, hash);
    if (previous) return previous;
    await tx.atlasBoard.upsert({ where: { id: "home-board" }, create: { id: "home-board" }, update: {} });
    const { mutationId, ...frame } = input;
    const work = await tx.blogWork.create({ data: { ...frame, ownerId: actorId, boardId: "home-board", layoutWidth: Math.max(400, input.viewportWidth) } });
    return remember(tx, actorId, mutationId, hash, "create", { workId: work.id, revision: work.revision });
  });
}
async function validateConnection(tx: Tx, actorId: string, workId: string, data: { fromId: string; toId: string }, excludeId?: string) {
  const ends = await tx.atlasElement.findMany({ where: { AND: [visibleElementWhere(actorId)], id: { in: [data.fromId, data.toId] } }, include: { work: true } });
  if (ends.length !== 2 || !ends.some(e => e.workId === workId) || ends.some(e => e.workId !== workId && e.work && e.work.status !== "published") || ends.every(e => e.type === "note")) {
    throw new WorkError("INVALID_ENDPOINTS", 400, "请选择当前作品中的端点及可见的公开图文，不能连接两篇博文");
  }
  const duplicate = await tx.atlasConnection.findFirst({ where: { boardId: "home-board", ...(excludeId ? { id: { not: excludeId } } : {}), OR: [{ fromId: data.fromId, toId: data.toId }, { fromId: data.toId, toId: data.fromId }] } });
  if (duplicate) throw new WorkError("DUPLICATE_CONNECTION", 409, "这两个元素已经连接");
}
export async function mutateWork(actorId: string, workId: string, rawInput: MutationInput, rawCommand: WorkCommand): Promise<MutationResult> {
  const input = parseBody(mutationSchema, rawInput), command = parseBody(workCommandSchema, rawCommand);
  const hash = inputHash({ workId, input, command });
  return transaction(async tx => {
    const previous = await replay(tx, actorId, input.mutationId, hash);
    if (previous) return previous;
    const ownerOnly = !command.operation.startsWith("photo.") && !command.operation.startsWith("connection.");
    const work = await advance(tx, workId, actorId, input, ownerOnly);
    let resourceId: string | undefined;
    let publishedAt: string | undefined;
    switch (command.operation) {
      case "frame": {
        const frame = parseBody(windowSchema, { viewportX: command.data.viewportX ?? work.viewportX, viewportY: command.data.viewportY ?? work.viewportY, viewportWidth: command.data.viewportWidth ?? work.viewportWidth, viewportHeight: command.data.viewportHeight ?? work.viewportHeight });
        if (work.status === "published" && (command.data.draftX !== undefined || command.data.draftY !== undefined)) throw new WorkError("INVALID_FRAME", 400, "公开作品位置由时间线决定");
        await tx.blogWork.update({ where: { id: workId }, data: { ...command.data, ...frame } }); break;
      }
      case "post.create": {
        await checkElementBudget(tx, workId);
        const data = work.status === "published" ? parseBody(postCreateSchema, command.data) : command.data;
        const last = await tx.post.aggregate({ where: { workId }, _max: { workOrder: true } });
        const profile = await tx.userProfile.findUnique({ where: { userId: work.ownerId } });
        const post = await tx.post.create({ data: { ...data, workId, workOrder: (last._max.workOrder ?? -1) + 1, authorId: work.ownerId, slug: work.status === "draft" ? `draft-${randomUUID()}` : await allocateSlug(tx, data.title), publishedAt: work.status === "draft" ? null : new Date(), ...snapshotProfileLocation(profile) } });
        await tx.atlasElement.create({ data: { boardId: work.boardId, workId, type: "note", postId: post.id, createdById: work.ownerId, x: 0, y: 0, width: 352, height: 180 } });
        resourceId = post.id; break;
      }
      case "post.update": case "post.delete": {
        const post = await tx.post.findFirst({ where: { id: command.id, workId } });
        if (!post) throw new WorkError("NOT_FOUND", 404, "博文不可用");
        if (command.operation === "post.delete") await tx.post.delete({ where: { id: post.id } });
        else {
          const data = work.status === "published" ? parseBody(postCreateSchema, command.data) : command.data;
          await tx.post.update({ where: { id: post.id }, data: { ...data, ...(work.status === "published" ? { slug: await allocateSlug(tx, data.title, post.id) } : {}) } });
        }
        resourceId = post.id; break;
      }
      case "photo.update": case "photo.delete": {
        const element = await tx.atlasElement.findFirst({ where: { id: command.id, workId, type: "photo", postId: null } });
        if (!element) throw new WorkError("NOT_FOUND", 404, "图片不可用");
        if (command.operation === "photo.delete") await tx.atlasElement.delete({ where: { id: element.id } });
        else await tx.atlasElement.update({ where: { id: element.id }, data: command.data });
        resourceId = element.id; break;
      }
      case "connection.create": case "connection.update": case "connection.delete": {
        if (command.operation !== "connection.create" && !await tx.atlasConnection.findFirst({ where: { id: command.id, workId } })) throw new WorkError("NOT_FOUND", 404, "连线不可用");
        if (command.operation === "connection.delete") await tx.atlasConnection.delete({ where: { id: command.id } });
        else {
          await validateConnection(tx, actorId, workId, command.data, command.operation === "connection.update" ? command.id : undefined);
          if (command.operation === "connection.create" && await tx.atlasConnection.count({ where: { workId } }) >= 1000) throw new WorkError("LIMIT", 400, "每份作品最多 1000 条连线");
          const connection = command.operation === "connection.create"
            ? await tx.atlasConnection.create({ data: { ...command.data, workId, boardId: work.boardId } })
            : await tx.atlasConnection.update({ where: { id: command.id }, data: command.data });
          resourceId = connection.id;
        }
        break;
      }
      case "publish": {
        if (work.status === "published") { publishedAt = work.publishedAt!.toISOString(); break; }
        const [posts, photos, pending, invalidAssets] = await Promise.all([
          tx.post.findMany({ where: { workId }, orderBy: { workOrder: "asc" } }),
          tx.atlasElement.count({ where: { workId, type: "photo" } }),
          tx.blogMediaAsset.count({ where: { workId, status: "pending" } }),
          tx.atlasElement.count({ where: { workId, type: "photo", OR: [{ mediaAssetId: null }, { mediaAsset: { is: { status: { not: "ready" } } } }] } }),
        ]);
        if (pending || invalidAssets) throw new WorkError("UPLOAD_PENDING", 409, "请先完成图片上传");
        if (!posts.length && !photos) throw new WorkError("EMPTY_WORK", 400, "请添加博文或图片后发布");
        const normalized = posts.map(p => ({ post: p, data: parseBody(postCreateSchema, { title: p.title, content: p.content }) }));
        const now = new Date(), profile = await tx.userProfile.findUnique({ where: { userId: work.ownerId } });
        for (const { post, data } of normalized) await tx.post.update({ where: { id: post.id }, data: { ...data, slug: await allocateSlug(tx, data.title), publishedAt: now, ...snapshotProfileLocation(profile) } });
        await tx.blogWork.update({ where: { id: workId }, data: { status: "published", publishedAt: now } });
        publishedAt = now.toISOString(); break;
      }
      case "delete": {
        await tx.blogMediaAsset.updateMany({ where: { workId }, data: { status: "cleanup", nextRetryAt: null } });
        await tx.blogWork.delete({ where: { id: workId } }); break;
      }
    }
    const latest = await tx.blogWork.findUnique({ where: { id: workId }, select: { revision: true } });
    return remember(tx, actorId, input.mutationId, hash, command.operation, { workId, revision: latest?.revision ?? work.revision + 1, ...(resourceId ? { resourceId } : {}), ...(publishedAt ? { publishedAt } : {}), ...(command.operation === "delete" ? { deleted: true } : {}) });
  }, true);
}
