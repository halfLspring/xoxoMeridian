import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { PrismaClient } from "@prisma/client";
import type { BrowserContext } from "@playwright/test";
import { z } from "zod";

import { cleanupPrivateConversation, type PrivateCleanupEvent } from "./private-conversation-cleanup";

const inputSchema = z.object({
  driver: z.string(), databaseUrl: z.string(), baseURL: z.string().url(), signal: z.string(),
  failure: z.boolean(), disposeRequest: z.boolean(), password: z.string(),
  users: z.array(z.object({ id: z.string(), email: z.string().email(), roomId: z.string() })).length(2),
});
const input = inputSchema.parse(JSON.parse(await readFile(process.argv[2], "utf8")));
const require = createRequire(import.meta.url);
const { chromium } = require(input.driver) as typeof import("playwright-core");
// 原录制器会在 close 中编码数十分钟补帧。子进程自退出时 Playwright 的 exit
// 处理器同步杀死它启动的 Chromium/FFmpeg；外层 finally 回收真实 PG 账号。
const deadline = setTimeout(() => {
  process.stderr.write("视频时钟回归：真实浏览器收尾未在 20 秒内完成。\n");
  process.exit(1);
}, 20_000);
const database = new PrismaClient({ datasources: { db: { url: input.databaseUrl } } });
const observer = new PrismaClient({ datasources: { db: { url: input.databaseUrl } } });
const browser = await chromium.launch({ channel: "chromium", headless: true });
const primary = await browser.newContext({ baseURL: input.baseURL, recordVideo: { dir: `${input.signal}-videos` } });
const page = await primary.newPage();
const video = page.video()!;
let second: BrowserContext | undefined;
const events: PrivateCleanupEvent[] = [];
const wallFrames: number[] = [];
let bodyError: string | null = null;
let cleanupFailure = false;
let cookiesIsolated = false;
let videoDuration = 0;
let roomsRemaining = -1;
let secondSessionsRemaining = -1;
const started = performance.now();
try {
  try {
    second = await browser.newContext({ baseURL: input.baseURL });
    await second.newPage();
    for (const [index, context] of [primary, second].entries()) {
      const response = await context.request.post("/api/auth/login", {
        headers: { origin: input.baseURL }, data: { email: input.users[index].email, password: input.password },
      });
      if (response.status() !== 200) throw new Error(`隔离账号登录失败：${response.status()}`);
      const identity = await context.request.get("/api/auth/me");
      if (identity.status() !== 200 || (await identity.json()).id !== input.users[index].id) {
        throw new Error("隔离 Cookie 未对应当前账号");
      }
    }
    const firstCookie = (await primary.cookies()).find(cookie => cookie.name === "xoxo_session");
    const secondCookie = (await second.cookies()).find(cookie => cookie.name === "xoxo_session");
    cookiesIsolated = !!firstCookie && !!secondCookie && firstCookie.value !== secondCookie.value;
    let framesReady!: () => void;
    const received = new Promise<void>(resolve => { framesReady = resolve; });
    await page.screencast.start({ onFrame: async ({ timestamp }) => {
      wallFrames.push(timestamp);
      if (wallFrames.length === 1) await writeFile(input.signal, "inject", { mode: 0o600 });
      if (wallFrames.length >= 8) framesReady();
    } });
    await page.setContent('<style>@keyframes move { to { transform: translateX(100px); } } div { width: 40px; height: 40px; background: red; animation: move .4s infinite alternate; }</style><div>时钟回归</div>');
    await received;
    if (input.disposeRequest) await second.request.dispose();
    if (input.failure) throw new Error("isolated-body-failure");
  } catch (error) {
    if (!input.failure || !(error instanceof Error) || error.message !== "isolated-body-failure") throw error;
    bodyError = error.message;
  } finally {
    try {
      try {
        await cleanupPrivateConversation({ page, second, database, roomIds: input.users.map(user => user.roomId), baseURL: input.baseURL, onEvent: event => events.push(event) });
      } catch (error) {
        if (!input.disposeRequest || !(error instanceof AggregateError) || error.errors.length !== 1) throw error;
        cleanupFailure = true;
      }
    } finally {
      await primary.close();
    }
  }
  roomsRemaining = await observer.room.count({ where: { id: { in: input.users.map(user => user.roomId) } } });
  secondSessionsRemaining = await observer.session.count({ where: { userId: input.users[1].id } });
  const playback = await browser.newContext();
  try {
    const player = await playback.newPage();
    const data = (await readFile(await video.path())).toString("base64");
    videoDuration = await player.evaluate(data => new Promise<number>((resolve, reject) => {
      const element = document.createElement("video");
      element.onloadedmetadata = () => resolve(element.duration);
      element.onerror = () => reject(new Error("真实 WebM 无法解码"));
      element.src = `data:video/webm;base64,${data}`;
    }), data);
  } finally {
    await playback.close();
  }
} finally {
  try { await browser.close(); } finally {
    await database.$disconnect();
    await observer.$disconnect();
    clearTimeout(deadline);
  }
}
const deltas = wallFrames.slice(1).map((value, index) => value - wallFrames[index]);
process.stdout.write(JSON.stringify({
  events, bodyError, cleanupFailure, cookiesIsolated, videoDuration, roomsRemaining, secondSessionsRemaining,
  wallFrameDeltaMs: deltas.reduce((largest, value) => Math.abs(value) > Math.abs(largest) ? value : largest, 0), contextsRemaining: browser.contexts().length,
  browserDisconnected: !browser.isConnected(), elapsedMs: performance.now() - started,
}));
