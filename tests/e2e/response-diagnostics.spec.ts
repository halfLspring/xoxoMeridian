import { createServer, type ServerResponse } from "node:http";

import { expect, test, type Page, type Response, type TestInfo } from "@playwright/test";

import { observeResponseDiagnostics } from "@/tests/e2e/support/response-diagnostics";

type DiagnosticEvent = Record<string, unknown>;

async function withPendingResponse(
  page: Page,
  testInfo: TestInfo,
  run: (fixture: {
    response: Response;
    outgoing: ServerResponse;
    events: DiagnosticEvent[];
    record: (event: DiagnosticEvent) => void;
    stop: () => void;
    closed: Promise<void>;
  }) => Promise<void>,
  status = 200,
) {
  const pathname = "/api/blog/works/diagnostic";
  const startedAt = Date.now(), events: DiagnosticEvent[] = [];
  const record = (event: DiagnosticEvent) => { events.push({ ...event, at: Date.now() - startedAt }); };
  const stop = observeResponseDiagnostics(page, pathname, record);
  let receive!: (value: { outgoing: ServerResponse; closed: Promise<void> }) => void;
  const received = new Promise<{ outgoing: ServerResponse; closed: Promise<void> }>(resolve => { receive = resolve; });
  const server = createServer((request, outgoing) => {
    if (request.url !== pathname) { outgoing.writeHead(404).end(); return; }
    const closed = new Promise<void>(resolve => {
      outgoing.once("close", () => { record({ event: "server-response-closed", bodyEnded: outgoing.writableEnded }); resolve(); });
    });
    outgoing.writeHead(status, { "Content-Type": "application/json", "Content-Length": "11" });
    outgoing.flushHeaders();
    outgoing.write("{\"ok\":");
    record({ event: "server-headers-sent", status });
    receive({ outgoing, closed });
  });
  try {
    await new Promise<void>(resolve => { server.listen(0, "127.0.0.1", resolve); });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("诊断回归的 HTTP 服务未监听 TCP 端口。");
    // 真实 HTTP 只交付响应头和部分正文；由用例事件释放正文或断开，不依赖 sleep。
    const response = await page.goto(`http://127.0.0.1:${address.port}${pathname}`, { waitUntil: "commit" });
    expect(response?.status()).toBe(status);
    expect(events).toContainEqual(expect.objectContaining({ event: "response", requestId: 1, method: "GET", status }));
    expect(events.some(event => event.event === "body-finished")).toBe(false);
    await run({ response: response!, ...await received, events, record, stop });
  } finally {
    stop();
    try {
      await page.close();
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); });
      record({ event: "server-stopped" });
      await testInfo.attach("response-diagnostic-events", { contentType: "application/json", body: JSON.stringify(events, null, 2) });
    }
  }
}

for (const cleanup of ["关闭页面", "先移除监听再关闭页面", "关闭上下文"] as const) {
  test(`响应诊断在正文未完成时${cleanup}，不产生未处理拒绝`, async ({ page, context }, testInfo) => {
    await withPendingResponse(page, testInfo, async ({ events, record, stop, closed }) => {
      if (cleanup === "先移除监听再关闭页面") stop();
      record({ event: "close-requested", cleanup });
      if (cleanup === "关闭上下文") await context.close();
      else await page.close();
      await closed;
      stop();
      expect(events.some(event => event.event === "body-finished")).toBe(false);
      expect(events).toContainEqual(expect.objectContaining({ event: "server-response-closed", bodyEnded: false }));
      if (cleanup !== "先移除监听再关闭页面") {
        expect(events.findIndex(event => event.event === "page-closed")).toBeGreaterThan(events.findIndex(event => event.event === "response"));
        expect(events.at(-1)).toMatchObject({ event: "diagnostics-stopped", pageClosed: true });
      }
      expect(events.filter(event => event.event === "diagnostics-stopped")).toHaveLength(1);
    });
  });
}

for (const status of [200, 409, 503]) {
  test(`响应诊断保留 HTTP ${status}，只在完整正文到达后记录完成`, async ({ page }, testInfo) => {
    await withPendingResponse(page, testInfo, async ({ response, outgoing, events, record, stop }) => {
      record({ event: "server-body-released" });
      outgoing.end("true}");
      expect(await response.json()).toEqual({ ok: true });
      await expect.poll(() => events.filter(event => event.event === "body-finished")).toHaveLength(1);
      expect(events.findIndex(event => event.event === "body-finished")).toBeGreaterThan(events.findIndex(event => event.event === "server-body-released"));
      expect(events.find(event => event.event === "body-finished")).toMatchObject({ requestId: 1, method: "GET", timing: { responseEnd: expect.any(Number) } });
      expect(events.some(event => event.event === "request-failed")).toBe(false);
      stop();
      const stoppedEvents = [...events];
      // 只移除自己的监听；其他调用方仍可收到关闭事件，已停止的诊断不再写入。
      const closed = page.waitForEvent("close");
      await page.close();
      await closed;
      expect(events).toEqual(stoppedEvents);
    }, status);
  });
}

test("响应诊断保留非关闭引起的网络失败，正文读取仍拒绝", async ({ page }, testInfo) => {
  await withPendingResponse(page, testInfo, async ({ response, outgoing, events, record }) => {
    const failed = page.waitForEvent("requestfailed", request => request === response.request());
    record({ event: "server-disconnected" });
    outgoing.destroy();
    const request = await failed;
    expect(page.isClosed()).toBe(false);
    expect(request.failure()?.errorText).toBe("net::ERR_CONTENT_LENGTH_MISMATCH");
    expect(events).toContainEqual(expect.objectContaining({ event: "request-failed", requestId: 1, failure: request.failure() }));
    expect(events.some(event => event.event === "body-finished")).toBe(false);
    await expect(response.body()).rejects.toThrow();
  });
});

test("响应诊断不掩盖无效 JSON 和页面异常", async ({ page }, testInfo) => {
  await withPendingResponse(page, testInfo, async ({ response, outgoing, events }) => {
    outgoing.end("oops}");
    await expect(response.json()).rejects.toThrow(SyntaxError);
    const pageError = page.waitForEvent("pageerror");
    await page.evaluate(() => { queueMicrotask(() => { throw new Error("诊断回归页面异常"); }); });
    expect((await pageError).message).toBe("诊断回归页面异常");
    expect(events).toContainEqual(expect.objectContaining({ event: "page-error", message: "诊断回归页面异常" }));
  });
});
