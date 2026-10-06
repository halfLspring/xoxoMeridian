import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";

import { hashPassword } from "@/lib/password";
import { privateDatabaseUrl } from "./support/agent-conversation";
import { E2E_PASSWORD } from "./support/credentials";

for (const scenario of [
  { name: "前跳后关页", jumpMs: 4_024_686.544, failure: false, disposeRequest: false },
  { name: "后跳且退出请求已释放、业务失败后清理", jumpMs: -3_600_000, failure: true, disposeRequest: true },
]) {
  test(`录制墙钟${scenario.name}仍保存可播放视频并关闭真实 Context、清理 PG`, async ({ baseURL }, testInfo) => {
    if (!baseURL) throw new Error("视频时钟回归需要隔离 E2E 服务");
    const directory = await mkdtemp(join(tmpdir(), "xoxo-video-clock-"));
    const require = createRequire(import.meta.url);
    const databaseUrl = await privateDatabaseUrl();
    const database = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const ids: string[] = [];
    const roomIds: string[] = [];
    try {
      // 隔离的驱动副本只注入 Chromium 帧的墙钟字段，不修改宿主时钟、
      // 当前 runner 或录制器。断言真实 FFmpeg/WebM、Cookie 与 PostgreSQL 行为。
      const driver = join(directory, "playwright-core");
      await cp(dirname(require.resolve("playwright-core/package.json")), driver, { recursive: true });
      const bundlePath = join(driver, "lib/coreBundle.js");
      const source = await readFile(bundlePath, "utf8");
      const anchor = "_onScreencastFrame(payload) {";
      if (source.split(anchor).length !== 2) throw new Error("已审查的 Chromium 帧故障注入点发生变化");
      await writeFile(bundlePath, source.replace(anchor, `${anchor}
        if (require("node:fs").existsSync(process.env.XOXO_VIDEO_CLOCK_SIGNAL) && payload.metadata.timestamp) {
          payload.metadata.timestamp += Number(process.env.XOXO_VIDEO_CLOCK_JUMP_MS) / 1000;
        }`));
      const passwordHash = await hashPassword(E2E_PASSWORD);
      const users = [];
      for (let index = 0; index < 2; index += 1) {
        const sharedRoomId = `video-clock-shared-${randomUUID()}`;
        roomIds.push(sharedRoomId);
        const user = await database.user.create({ data: {
          email: `video-clock-${randomUUID()}@example.com`, displayName: "时钟回归", avatarLabel: "时钟", passwordHash,
          profile: { create: { timezone: "UTC", city: "—", country: "—" } },
          participants: { create: { role: "owner", room: { create: { id: sharedRoomId, slug: sharedRoomId, name: "隔离认证房间" } } } },
        } });
        ids.push(user.id);
        const room = await database.room.create({ data: { slug: `video-clock-${randomUUID()}`, name: "隔离时钟回归", kind: "agent_private", privateOwnerId: user.id, maxHumanUsers: 1 } });
        roomIds.push(room.id);
        users.push({ id: user.id, email: user.email, roomId: room.id });
      }
      const signal = join(directory, "frame-jump");
      const input = join(directory, "input.json");
      await writeFile(input, JSON.stringify({ driver, databaseUrl, baseURL, signal, failure: scenario.failure, disposeRequest: scenario.disposeRequest, password: E2E_PASSWORD, users }), { mode: 0o600 });
      const { stdout } = await promisify(execFile)(process.execPath, ["--import", "tsx", resolve("tests/e2e/support/video-clock-probe.ts"), input], {
        env: { ...process.env, XOXO_VIDEO_CLOCK_SIGNAL: signal, XOXO_VIDEO_CLOCK_JUMP_MS: String(scenario.jumpMs) },
        timeout: 25_000, maxBuffer: 32_768,
      });
      const result = JSON.parse(stdout) as {
        events: { stage: string; phase: string; ok?: boolean }[]; bodyError: string | null; cleanupFailure: boolean; cookiesIsolated: boolean;
        videoDuration: number; roomsRemaining: number; secondSessionsRemaining: number; wallFrameDeltaMs: number;
        contextsRemaining: number; browserDisconnected: boolean; elapsedMs: number;
      };
      await testInfo.attach("video-clock-observation", { contentType: "application/json", body: stdout });
      expect(result.cookiesIsolated).toBe(true);
      expect(Math.abs(result.wallFrameDeltaMs - scenario.jumpMs)).toBeLessThan(2_000);
      expect(result.videoDuration).toBeGreaterThanOrEqual(1);
      expect(result.videoDuration).toBeLessThan(10);
      expect(result.bodyError).toBe(scenario.failure ? "isolated-body-failure" : null);
      expect(result.cleanupFailure).toBe(scenario.disposeRequest);
      expect(result.events.filter(event => event.phase === "end").map(event => [event.stage, event.ok])).toEqual([
        ["page.close", true], ["logout", !scenario.disposeRequest], ["second.close", true], ["db.delete", true], ["db.disconnect", true],
      ]);
      expect(result.roomsRemaining).toBe(0);
      expect(result.secondSessionsRemaining).toBe(scenario.disposeRequest ? 1 : 0);
      expect(result.contextsRemaining).toBe(0);
      expect(result.browserDisconnected).toBe(true);
    } finally {
      try {
        await database.room.deleteMany({ where: { id: { in: roomIds } } });
        await database.user.deleteMany({ where: { id: { in: ids } } });
        expect(await database.user.count({ where: { id: { in: ids } } })).toBe(0);
        expect(await database.session.count({ where: { userId: { in: ids } } })).toBe(0);
      } finally {
        await database.$disconnect();
        await rm(directory, { recursive: true, force: true });
      }
    }
  });
}
