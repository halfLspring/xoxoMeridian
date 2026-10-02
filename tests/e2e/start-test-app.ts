import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";

import { ABOUT_PHOTOS, aboutPhotoExists, stageAboutPhoto } from "./support/about-photos";
import { E2E_INVITE_CODE } from "./support/credentials";
import { e2eAgentEntryTheme, e2eAppMode } from "./support/app-mode";

const execFileAsync = promisify(execFile);
const port = "3100";
const baseURL = `http://127.0.0.1:${port}`;
const dataDir = await mkdtemp(join(tmpdir(), "xoxo-meridian-e2e-"));
const databaseUrlFile = resolve("test-results/.e2e-database-url");
const appInfoFile = resolve("test-results/.e2e-app.json");
const appMode = e2eAppMode();
const devOrigins = process.env.E2E_DEV_ORIGINS === "true";
if (devOrigins && appMode !== "development") {
  throw new Error("双地址来源回归必须使用 development 模式。");
}
const buildTheme = e2eAgentEntryTheme();
const runtimeTheme = appMode === "production"
  ? (buildTheme === "default" ? "birthday-2026" : "default")
  : buildTheme;
let postgres: StartedPostgreSqlContainer;
try {
  postgres = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("xoxo_meridian_e2e")
    .withUsername("xoxo_e2e")
    .withPassword("xoxo_e2e_password")
    .start();
} catch (error) {
  await rm(dataDir, { recursive: true, force: true });
  throw new Error(
    "无法启动 E2E 所需的 PostgreSQL Testcontainer。请确认 Docker daemon 可用且当前用户可访问；E2E 不会静默跳过。",
    { cause: error }
  );
}
const databaseUrl = postgres.getConnectionUri();
const appEnv: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_ENV: appMode,
  DATABASE_URL: databaseUrl,
  DIRECT_URL: databaseUrl,
  APP_BASE_URL: baseURL,
  ALLOWED_ORIGINS: devOrigins ? `${baseURL},http://localhost:${port}` : baseURL,
  NEXT_PUBLIC_APP_URL: baseURL,
  NEXT_PUBLIC_AGENT_ENTRY_THEME: buildTheme,
  SESSION_SECRET: "xoxo-e2e-session-secret-at-least-thirty-two-characters",
  INVITE_CODE: E2E_INVITE_CODE,
  DEMO_ROOM_SLUG: "e2e-room",
  EMAIL_PROVIDER: "mock",
  EMAIL_FROM: "e2e@example.com",
  LLM_PROVIDER: "openai-compatible",
  LLM_API_KEY: "",
  WEATHER_PROVIDER: "mock",
  ATLAS_STORAGE_PROVIDER: "local",
  ATLAS_UPLOAD_DIR: join(dataDir, "atlas-uploads"),
  CHAT_LOG_DIR: join(dataDir, "chat-logs"),
  AGENT_TASK_INLINE_RUN: "false",
};
const prismaCli = resolve("node_modules/prisma/build/index.js");
const nextCli = resolve("node_modules/next/dist/bin/next");
let activeChild: ChildProcess | undefined;
let shuttingDown = false;
const aboutPhotoCleanups: (() => Promise<void>)[] = [];

async function shutdown(exitCode: number) {
  if (shuttingDown) return;
  shuttingDown = true;
  const child = activeChild;
  if (child && child.exitCode === null && child.signalCode === null) {
    await new Promise<void>((resolveShutdown) => {
      const timeout = setTimeout(() => { child.kill("SIGKILL"); }, 10_000);
      child.once("exit", () => { clearTimeout(timeout); resolveShutdown(); });
      child.kill("SIGTERM");
    });
  }
  for (const cleanup of aboutPhotoCleanups) await cleanup().catch(() => undefined);
  await postgres.stop().catch(() => undefined);
  await rm(databaseUrlFile, { force: true });
  await rm(appInfoFile, { force: true });
  await rm(dataDir, { recursive: true, force: true });
  process.exit(exitCode);
}

process.on("SIGTERM", () => void shutdown(0));
process.on("SIGINT", () => void shutdown(130));

try {
  await execFileAsync(process.execPath, [prismaCli, "migrate", "deploy"], {
    cwd: process.cwd(), env: appEnv,
  });
  await execFileAsync(process.execPath, ["--import", "tsx", "prisma/seed.ts"], {
    cwd: process.cwd(), env: appEnv,
  });
  await mkdir(resolve("test-results"), { recursive: true });
  await rm(databaseUrlFile, { force: true });
  await writeFile(databaseUrlFile, databaseUrl, { mode: 0o600 });

  if (appMode === "production") {
    await new Promise<void>((resolveBuild, rejectBuild) => {
      const build = spawn("npm", ["run", "build"], {
        cwd: process.cwd(), env: appEnv, stdio: "inherit",
      });
      activeChild = build;
      build.once("error", rejectBuild);
      build.once("exit", (code) => {
        activeChild = undefined;
        if (code === 0) resolveBuild();
        else rejectBuild(new Error(`E2E production 构建失败：exit=${String(code)}`));
      });
    });
  }

  // About 照片是部署资产：`next start` 只在启动时快照 public 目录，照片必须在服务起来之前就位。
  // 这里只暂存第一张免费的照片且不覆盖交付方资源，浏览器门禁因此能在同一次启动里同时覆盖
  // “已交付→真实加载”和“缺失→回退”；交付状态写进日志，便于核对本次实际覆盖了哪一条。
  const deliveredAboutPhotos: string[] = [];
  const missingAboutPhotos: string[] = [];
  let aboutPhotoStaged = false;
  for (const photo of ABOUT_PHOTOS) {
    if (await aboutPhotoExists(photo.publicPath)) {
      deliveredAboutPhotos.push(photo.publicPath);
      continue;
    }
    const cleanup = aboutPhotoStaged ? null : await stageAboutPhoto(photo.publicPath);
    if (cleanup) {
      aboutPhotoCleanups.push(cleanup);
      aboutPhotoStaged = true;
      deliveredAboutPhotos.push(photo.publicPath);
      continue;
    }
    missingAboutPhotos.push(photo.publicPath);
  }
  // 走 stderr：Playwright 的 webServer 只把子进程 stderr 转发到测试输出，stdout 看不到。
  process.stderr.write(
    `[e2e-app] About 照片交付状态：已交付 ${deliveredAboutPhotos.join("、") || "无"}；缺失 ${missingAboutPhotos.join("、") || "无"}。\n`,
  );

  await writeFile(appInfoFile, JSON.stringify({
    appMode, buildTheme, runtimeTheme, baseURL,
  }, null, 2), { mode: 0o600 });
  console.log(`[e2e-app] mode=${appMode}，构建主题=${buildTheme}，启动主题=${runtimeTheme}。`);
  const server = spawn(process.execPath, [
    nextCli,
    ...(appMode === "production" ? ["start"] : ["dev", "--webpack"]),
    "--hostname", devOrigins ? "0.0.0.0" : "127.0.0.1", "--port", port,
  ], {
    cwd: process.cwd(),
    env: { ...appEnv, NEXT_PUBLIC_AGENT_ENTRY_THEME: runtimeTheme },
    stdio: "inherit",
  });
  activeChild = server;
  server.once("error", (error) => {
    console.error(error);
    void shutdown(1);
  });
  server.once("exit", (code) => void shutdown(code ?? 1));
} catch (error) {
  console.error(error);
  await shutdown(1);
}
