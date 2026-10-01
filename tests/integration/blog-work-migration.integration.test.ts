import { execFile } from "node:child_process";
import { mkdtemp, cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";
import { expect, it } from "vitest";
const exec = promisify(execFile);
it("旧版本有文章和照片连线时增量迁移可重复部署，内容不自动分组", async () => {
  const directory = await mkdtemp(join(tmpdir(), "xoxo-blog-migrate-"));
  const schemaName = `blog_migration_${Date.now()}`;
  const url = new URL(process.env.DATABASE_URL!); url.searchParams.set("schema", schemaName);
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  try {
    await cp(resolve("prisma"), directory, { recursive: true });
    await rm(join(directory, "migrations/20260930070000_blog_spatial_drafts"), { recursive: true });
    const env = { ...process.env, DATABASE_URL: url.toString(), DIRECT_URL: url.toString() };
    const args = [resolve("node_modules/prisma/build/index.js"), "migrate", "deploy", "--schema", join(directory, "schema.prisma")];
    await exec(process.execPath, args, { env });
    await db.$executeRawUnsafe(`INSERT INTO "AtlasBoard" (id,"updatedAt") VALUES ('home-board',CURRENT_TIMESTAMP)`);
    await db.$executeRawUnsafe(`INSERT INTO "Post" (id,slug,title,content,"publishedAt","updatedAt") VALUES ('old','old-url','旧文章','正文','2026-09-01',CURRENT_TIMESTAMP)`);
    await db.$executeRawUnsafe(`INSERT INTO "AtlasElement" (id,"boardId",type,x,y,"updatedAt") VALUES ('p1','home-board','photo',12,34,CURRENT_TIMESTAMP),('p2','home-board','photo',100,200,CURRENT_TIMESTAMP)`);
    await db.$executeRawUnsafe(`INSERT INTO "AtlasConnection" (id,"boardId","fromId","toId") VALUES ('line','home-board','p1','p2')`);
    await cp(resolve("prisma/migrations/20260930070000_blog_spatial_drafts"), join(directory, "migrations/20260930070000_blog_spatial_drafts"), { recursive: true });
    await exec(process.execPath, args, { env }); await exec(process.execPath, args, { env });
    expect(await db.post.findUnique({ where: { slug: "old-url" } })).toMatchObject({ id: "old", workId: null, publishedAt: new Date("2026-09-01") });
    expect(await db.atlasElement.findUnique({ where: { id: "p1" } })).toMatchObject({ x: 12, y: 34, workId: null });
    expect(await db.atlasConnection.count()).toBe(1); expect(await db.blogWork.count()).toBe(0);
  } finally { await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`); await db.$disconnect(); await rm(directory, { recursive: true, force: true }); }
});
