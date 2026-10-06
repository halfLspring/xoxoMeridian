import type { PrismaClient } from "@prisma/client";
import type { BrowserContext, Page } from "@playwright/test";

export type PrivateCleanupEvent = { stage: string; phase: "begin" | "end"; elapsedMs: number; ok?: boolean };

export async function cleanupPrivateConversation({ page, second, database, roomIds, baseURL, onEvent }: {
  page: Page;
  second: BrowserContext | undefined;
  database: PrismaClient;
  roomIds: string[];
  baseURL: string;
  onEvent?: (event: PrivateCleanupEvent) => void;
}) {
  const failures: unknown[] = [];
  const started = performance.now();
  const cleanup = async (stage: string, action: () => Promise<unknown>) => {
    onEvent?.({ stage, phase: "begin", elapsedMs: performance.now() - started });
    let ok = true;
    try { await action(); } catch (error) { ok = false; failures.push(error); }
    onEvent?.({ stage, phase: "end", elapsedMs: performance.now() - started, ok });
  };
  // 每一步失败仍继续回收后续资源；关闭和数据库失败必须报告给 fixture teardown。
  await cleanup("page.close", () => page.close());
  if (second) {
    await cleanup("logout", async () => {
      const response = await second.request.post("/api/auth/logout", { headers: { origin: baseURL } });
      if (!response.ok()) throw new Error(`私聊夹具退出失败：HTTP ${response.status()}`);
    });
    await cleanup("second.close", () => second.close());
  }
  await cleanup("db.delete", () => database.room.deleteMany({ where: { id: { in: roomIds } } }));
  await cleanup("db.disconnect", () => database.$disconnect());
  if (failures.length) throw new AggregateError(failures, "私聊夹具清理失败");
}
