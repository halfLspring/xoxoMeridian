-- CreateEnum
CREATE TYPE "BlogWorkStatus" AS ENUM ('draft', 'published');

-- CreateEnum
CREATE TYPE "BlogMediaStatus" AS ENUM ('pending', 'ready', 'cleanup');

-- AlterTable
ALTER TABLE "AtlasElement" ADD COLUMN     "mediaAssetId" TEXT,
ADD COLUMN     "workId" TEXT;

-- AlterTable
ALTER TABLE "AtlasConnection" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "workId" TEXT;

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "workId" TEXT,
ADD COLUMN     "workOrder" INTEGER,
ALTER COLUMN "publishedAt" DROP NOT NULL;

-- CreateTable
CREATE TABLE "BlogWork" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "status" "BlogWorkStatus" NOT NULL DEFAULT 'draft',
    "publishedAt" TIMESTAMP(3),
    "revision" INTEGER NOT NULL DEFAULT 0,
    "draftX" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "draftY" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "viewportX" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "viewportY" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "viewportWidth" DOUBLE PRECISION NOT NULL DEFAULT 960,
    "viewportHeight" DOUBLE PRECISION NOT NULL DEFAULT 540,
    "layoutWidth" DOUBLE PRECISION NOT NULL DEFAULT 960,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlogWork_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlogWorkMutation" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "mutationId" TEXT NOT NULL,
    "workId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlogWorkMutation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlogMediaAsset" (
    "id" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "ownerId" TEXT,
    "workId" TEXT,
    "uploadMutationId" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "status" "BlogMediaStatus" NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "cleanupAttempts" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlogMediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BlogWork_ownerId_status_updatedAt_id_idx" ON "BlogWork"("ownerId", "status", "updatedAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "BlogWork_status_publishedAt_id_idx" ON "BlogWork"("status", "publishedAt" DESC, "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "BlogWork_boardId_id_key" ON "BlogWork"("boardId", "id");

-- CreateIndex
CREATE INDEX "BlogWorkMutation_createdAt_idx" ON "BlogWorkMutation"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BlogWorkMutation_actorId_mutationId_key" ON "BlogWorkMutation"("actorId", "mutationId");

-- CreateIndex
CREATE UNIQUE INDEX "BlogMediaAsset_storageKey_key" ON "BlogMediaAsset"("storageKey");

-- CreateIndex
CREATE INDEX "BlogMediaAsset_status_expiresAt_idx" ON "BlogMediaAsset"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "BlogMediaAsset_workId_idx" ON "BlogMediaAsset"("workId");

-- CreateIndex
CREATE UNIQUE INDEX "AtlasElement_mediaAssetId_key" ON "AtlasElement"("mediaAssetId");

-- CreateIndex
CREATE INDEX "AtlasElement_workId_idx" ON "AtlasElement"("workId");

-- CreateIndex
CREATE INDEX "AtlasConnection_workId_idx" ON "AtlasConnection"("workId");

-- CreateIndex
CREATE UNIQUE INDEX "Post_workId_workOrder_key" ON "Post"("workId", "workOrder");

-- AddForeignKey
ALTER TABLE "AtlasElement" ADD CONSTRAINT "AtlasElement_workId_fkey" FOREIGN KEY ("workId") REFERENCES "BlogWork"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtlasElement" ADD CONSTRAINT "AtlasElement_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "BlogMediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtlasConnection" ADD CONSTRAINT "AtlasConnection_workId_fkey" FOREIGN KEY ("workId") REFERENCES "BlogWork"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_workId_fkey" FOREIGN KEY ("workId") REFERENCES "BlogWork"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlogWork" ADD CONSTRAINT "BlogWork_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlogWork" ADD CONSTRAINT "BlogWork_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "AtlasBoard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlogMediaAsset" ADD CONSTRAINT "BlogMediaAsset_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlogMediaAsset" ADD CONSTRAINT "BlogMediaAsset_workId_fkey" FOREIGN KEY ("workId") REFERENCES "BlogWork"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- 裁切窗口与场景坐标相互独立；旧内容保持原归属与时间。
ALTER TABLE "BlogWork" ADD CONSTRAINT "BlogWork_window_check" CHECK (
  "boardId" = 'home-board' AND "revision" >= 0
  AND "viewportWidth" BETWEEN 160 AND 8192 AND "viewportHeight" BETWEEN 120 AND 8192
  AND "layoutWidth" BETWEEN 400 AND 8192
  AND "viewportX" BETWEEN -1000000 AND 1000000 AND "viewportY" BETWEEN -1000000 AND 1000000
  AND "draftX" BETWEEN -1000000 AND 1000000 AND "draftY" BETWEEN -1000000 AND 1000000
  AND (("status" = 'draft' AND "publishedAt" IS NULL) OR ("status" = 'published' AND "publishedAt" IS NOT NULL))
);
ALTER TABLE "Post" ADD CONSTRAINT "Post_work_check" CHECK (
  ("workId" IS NULL AND "workOrder" IS NULL AND "publishedAt" IS NOT NULL)
  OR ("workId" IS NOT NULL AND "workOrder" IS NOT NULL AND "workOrder" >= 0 AND "type" = 'user_post')
);
ALTER TABLE "AtlasElement" ADD CONSTRAINT "AtlasElement_work_board_fkey"
  FOREIGN KEY ("boardId", "workId") REFERENCES "BlogWork"("boardId", "id") ON DELETE CASCADE;
ALTER TABLE "AtlasConnection" ADD CONSTRAINT "AtlasConnection_work_board_fkey"
  FOREIGN KEY ("boardId", "workId") REFERENCES "BlogWork"("boardId", "id") ON DELETE CASCADE;
CREATE UNIQUE INDEX "AtlasConnection_work_undirected_key" ON "AtlasConnection"
  ("boardId", LEAST("fromId", "toId"), GREATEST("fromId", "toId")) WHERE "workId" IS NOT NULL;

CREATE FUNCTION blog_anchor_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."postId" IS NOT NULL AND EXISTS (
    SELECT 1 FROM "Post" p WHERE p.id = NEW."postId" AND p."workId" IS DISTINCT FROM NEW."workId"
  ) THEN RAISE EXCEPTION 'Post anchor work mismatch' USING ERRCODE = '23514'; END IF;
  IF NEW."mediaAssetId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "BlogMediaAsset" a WHERE a.id = NEW."mediaAssetId" AND a."workId" = NEW."workId"
  ) THEN RAISE EXCEPTION 'Media work mismatch' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "blog_anchor_scope" BEFORE INSERT OR UPDATE ON "AtlasElement" FOR EACH ROW EXECUTE FUNCTION blog_anchor_scope();

-- 外部端点经任何旧入口删除也使相关作品版本失效，随后 FK 级联只删连线。
CREATE FUNCTION blog_endpoint_deleted() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "BlogWork" SET revision = revision + 1, "updatedAt" = CURRENT_TIMESTAMP
    WHERE id IN (SELECT "workId" FROM "AtlasConnection" WHERE "fromId" = OLD.id OR "toId" = OLD.id);
  IF OLD."mediaAssetId" IS NOT NULL THEN
    UPDATE "BlogMediaAsset" SET status = 'cleanup', "workId" = NULL, "ownerId" = NULL, "nextRetryAt" = NULL WHERE id = OLD."mediaAssetId";
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER "blog_endpoint_deleted" BEFORE DELETE ON "AtlasElement" FOR EACH ROW EXECUTE FUNCTION blog_endpoint_deleted();

CREATE FUNCTION blog_post_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "AtlasElement" e WHERE e."postId" = NEW.id AND e."workId" IS DISTINCT FROM NEW."workId") THEN
    RAISE EXCEPTION 'Post anchor work mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "blog_post_scope" BEFORE UPDATE ON "Post" FOR EACH ROW EXECUTE FUNCTION blog_post_scope();
CREATE FUNCTION blog_connection_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."workId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "AtlasElement" a JOIN "AtlasElement" b ON b.id = NEW."toId"
    WHERE a.id = NEW."fromId" AND a.id <> b.id AND a."boardId" = NEW."boardId" AND b."boardId" = NEW."boardId"
      AND (a."workId" = NEW."workId" OR b."workId" = NEW."workId") AND (a.type = 'photo' OR b.type = 'photo')
  ) THEN RAISE EXCEPTION 'Connection scope mismatch' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "blog_connection_scope" BEFORE INSERT OR UPDATE ON "AtlasConnection" FOR EACH ROW EXECUTE FUNCTION blog_connection_scope();
