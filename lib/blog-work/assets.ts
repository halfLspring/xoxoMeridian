import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getPostVisibilityWhere } from "@/lib/post-visibility";
import { advance, checkElementBudget, inputHash, remember, replay, transaction, type MutationResult } from "@/lib/blog-work/mutations";
import { assertWorkAccess, WorkError } from "@/lib/blog-work/policy";
import { mutationSchema, uploadFieldsSchema, type MutationInput } from "@/lib/blog-work/schemas";
import { parseBody } from "@/lib/validation";
import { getAtlasStorage, makeAtlasImageUrl, makeAtlasObjectKey, normalizeAtlasStorageKey, validateAtlasImageContent, validateAtlasImageFile } from "@/lib/storage/atlas-storage";

export async function assertAssetRead(key: string, actorId: string) {
  try { normalizeAtlasStorageKey(key); } catch { throw new WorkError("NOT_FOUND", 404, "图片不可用"); }
  const asset = await prisma.blogMediaAsset.findUnique({ where: { storageKey: key }, include: { element: { include: { work: true } } } });
  if (asset) {
    if (asset.status !== "ready" || !asset.element || asset.element.workId !== asset.workId) throw new WorkError("NOT_FOUND", 404, "图片不可用");
    assertWorkAccess(asset.element.work, actorId);
    return;
  }
  const url = makeAtlasImageUrl(key);
  const legacy = await prisma.atlasElement.findFirst({ where: {
    workId: null, mediaAssetId: null, type: "photo", imageUrl: url,
    boardId: { in: ["home-board", "atlas-global-board"] },
    OR: [{ postId: null }, { post: { is: getPostVisibilityWhere(actorId) } }],
  }, select: { id: true } });
  if (!legacy) throw new WorkError("NOT_FOUND", 404, "图片不可用");
}

// 只处理有账本且无引用的资源，不扫描存储目录，也不删除旧无账本文件。
export async function cleanupBlogAssets({ limit = 100, dryRun = false, now = new Date() } = {}) {
  const candidates = await prisma.blogMediaAsset.findMany({ where: {
    element: { is: null }, AND: [
      { OR: [{ status: "cleanup" }, { status: "pending", expiresAt: { lte: now } }, { workId: null }] },
      { OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }] },
    ],
  }, orderBy: { createdAt: "asc" }, take: Math.max(1, Math.min(500, limit)) });
  const result = { inspected: candidates.length, deleted: 0, failed: 0, dryRun };
  for (const asset of candidates) {
    if (dryRun) continue;
    // 先不可逆地进入 cleanup，迟到上传完成不能再关联元素。
    const claimed = await prisma.blogMediaAsset.updateMany({ where: { id: asset.id, element: { is: null } }, data: { status: "cleanup", cleanupAttempts: { increment: 1 } } });
    if (!claimed.count) continue;
    try {
      await getAtlasStorage().delete(asset.storageKey);
      // 保留墓碑以接住迟到写入；每一天可重新删除，仍无读取权限。
      await prisma.blogMediaAsset.update({ where: { id: asset.id }, data: { nextRetryAt: new Date(now.getTime() + 86400000) } });
      result.deleted++;
    } catch {
      await prisma.blogMediaAsset.update({ where: { id: asset.id }, data: { nextRetryAt: new Date(now.getTime() + 60000) } });
      result.failed++;
    }
  }
  return result;
}
export async function uploadWorkPhoto(actorId: string, workId: string, rawInput: MutationInput, rawFields: unknown, file: File): Promise<MutationResult> {
  const input = parseBody(mutationSchema, rawInput), fields = parseBody(uploadFieldsSchema, rawFields);
  validateAtlasImageFile(file);
  const body = Buffer.from(await file.arrayBuffer()), contentType = validateAtlasImageContent(body);
  const hash = inputHash({ workId, input, fields, bodyHash: inputHash(body.toString("base64")), contentType });
  const finishId = `${input.mutationId}:ready`;
  const reserved = await transaction(async tx => {
    const finished = await replay(tx, actorId, finishId, hash);
    if (finished) return { finished };
    const prior = await replay(tx, actorId, input.mutationId, hash);
    if (prior) return { reservation: prior };
    await advance(tx, workId, actorId, input, false);
    await checkElementBudget(tx, workId);
    const asset = await tx.blogMediaAsset.create({ data: { ownerId: actorId, workId, uploadMutationId: input.mutationId, storageKey: makeAtlasObjectKey("blog-photo", undefined, contentType), contentType, size: body.length, expiresAt: new Date(Date.now() + 86400000) } });
    return { reservation: await remember(tx, actorId, input.mutationId, hash, "upload.reserve", { workId, revision: input.baseRevision + 1, resourceId: asset.id }) };
  });
  if (reserved.finished) return reserved.finished;
  const reservation = reserved.reservation!;
  const asset = await prisma.blogMediaAsset.findUnique({ where: { id: reservation.resourceId } });
  if (!asset || asset.workId !== workId || asset.status !== "pending" || asset.expiresAt.getTime() <= Date.now()) throw new WorkError("UPLOAD_EXPIRED", 409, "上传已结束，请重新选择图片");
  try {
    await getAtlasStorage().save({ key: asset.storageKey, body, contentType });
    return await transaction(async tx => {
      const finished = await replay(tx, actorId, finishId, hash);
      if (finished) return finished;
      const active = await tx.blogMediaAsset.findUnique({ where: { id: asset.id } });
      if (!active || active.status !== "pending" || active.workId !== workId || active.expiresAt.getTime() <= Date.now()) throw new WorkError("UPLOAD_EXPIRED", 409, "上传已过期");
      await advance(tx, workId, actorId, { ...input, baseRevision: reservation.revision }, false);
      const element = await tx.atlasElement.create({ data: { ...fields, boardId: "home-board", workId, mediaAssetId: asset.id, type: "photo", createdById: actorId, imageUrl: makeAtlasImageUrl(asset.storageKey) } });
      await tx.blogMediaAsset.update({ where: { id: asset.id }, data: { status: "ready" } });
      return remember(tx, actorId, finishId, hash, "upload.ready", { workId, revision: reservation.revision + 1, resourceId: element.id });
    });
  } catch (error) {
    // 并发重放若已有 ready，不能回收另一个请求刚完成的图片。
    const finished = await prisma.blogWorkMutation.findUnique({ where: { actorId_mutationId: { actorId, mutationId: finishId } } });
    if (finished) return finished.result as MutationResult;
    await prisma.blogMediaAsset.updateMany({ where: { id: asset.id, element: { is: null } }, data: { status: "cleanup", nextRetryAt: null } });
    await cleanupBlogAssets().catch(() => {});
    throw error;
  }
}
export type AssetTransaction = Prisma.TransactionClient;
