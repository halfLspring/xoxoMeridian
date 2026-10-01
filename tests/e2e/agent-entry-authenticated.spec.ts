import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { expect, test, type Browser, type Page } from "@playwright/test";
import type { AgentConversationSendResult, AgentConversationSnapshot } from "@/lib/agent-conversation-types";
import { entryChunks, entryName, expectReady, hostInteraction, modelPath, observeEntry, settleHydration } from "./support/agent-entry";
import { expectModelSettled, modelMeasurements, observeModelFrames, privateDatabaseUrl, runPrivateTask, type EntryFrame } from "./support/agent-conversation";
import { e2eAgentEntryTheme, e2eAppMode } from "./support/app-mode";
import { E2E_PASSWORD, E2E_USERS } from "./support/credentials";
import { entryBox, entryPositionKey, expectEntryAt, moveEntryWithMouse, moveEntryWithTouch, savedEntryPosition } from "./support/agent-entry-drag";

// 完整 Chromium 支持原生窗口焦点；默认 headless shell 的 bringToFront 不产生 focus。
test.use({ channel: "chromium" });

async function openDialog(page: Page) {
  await page.getByRole("button", { name: entryName }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "消息", exact: true })).toBeFocused();
}

async function closeDialog(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: entryName })).toBeFocused();
}

async function expectLogoFallback(page: Page) {
  const logo = page.locator('[data-agent-entry] button img[src="/brand/logo_transparent.svg"]');
  await expect(logo).toBeVisible();
  await expect.poll(() => logo.evaluate((image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)).toBe(true);
  const box = (await logo.boundingBox())!;
  expect(box.width).toBe(24);
  expect(box.height).toBe(24);
  const entry = (await page.locator("[data-agent-entry]").boundingBox())!;
  expect(entry.x + entry.width - box.x - box.width).toBeLessThanOrEqual(16);
  expect(entry.y + entry.height - box.y - box.height).toBeLessThanOrEqual(16);
  const viewport = page.viewportSize()!;
  expect(viewport.width - box.x - box.width).toBeLessThanOrEqual(64);
  expect(viewport.height - box.y - box.height).toBeLessThanOrEqual(64);
  const appearance = await logo.evaluate((image) => {
    const style = getComputedStyle(image.parentElement!);
    return { background: style.backgroundColor, borderWidth: style.borderTopWidth };
  });
  expect(appearance.background).toBe("rgba(0, 0, 0, 0)");
  expect(appearance.borderWidth).toBe("0px");
}

async function sendPrivateMessage(page: Page, content: string) {
  await page.getByRole("textbox", { name: "消息", exact: true }).fill(content);
  const accepted = page.waitForResponse((reply) => new URL(reply.url()).pathname === "/api/agent/conversation/messages");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const response = await accepted;
  expect(response.status(), await response.text()).toBe(201);
  return await response.json() as AgentConversationSendResult;
}

test("Chat 冷启动不下载入口代码与模型", async ({ page }) => {
  const observed = observeEntry(page);
  await page.goto("/chat");
  await expect(page).toHaveURL(/\/chat\/[^/]+$/);
  await expect(page.getByRole("button", { name: "发送", exact: true })).toBeVisible();
  await settleHydration(page);
  const chunks = await entryChunks();
  expect(observed.requests.filter((url) => url.endsWith(".glb") || chunks.includes(new URL(url).pathname))).toEqual([]);
  await expect(page.getByRole("button", { name: entryName })).toHaveCount(0);
  expect(observed.errors).toEqual([]);
});

test("同页开窗保留真实 Canvas 与 context，关闭后 Chat 导航仍独立且缓存模型", async ({ page }) => {
  const observed = observeEntry(page);
  await page.addInitScript(() => {
    (window as unknown as { entryViolations: string[] }).entryViolations = [];
    addEventListener("securitypolicyviolation", (event) => {
      (window as unknown as { entryViolations: string[] }).entryViolations.push(event.violatedDirective);
    });
  });
  const response = await page.goto("/home");
  await expectReady(page);
  if (e2eAppMode() === "production") {
    expect(response!.headers()["content-security-policy"]).toContain("'wasm-unsafe-eval'");
    expect(response!.headers()["content-security-policy"]).not.toContain(" 'unsafe-eval'");
  }
  await hostInteraction(page);
  const canvas = await page.locator("[data-agent-entry] canvas").elementHandle();
  const gl = await canvas!.evaluateHandle((node) => (node as HTMLCanvasElement).getContext("webgl2")!);
  const url = page.url();
  const scroll = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
  for (let visit = 0; visit < 3; visit += 1) {
    await openDialog(page);
    await expect(page).toHaveURL(url);
    expect(await canvas!.evaluate((node) => node === document.querySelector("[data-agent-entry] canvas"))).toBe(true);
    expect(await gl.evaluate((context) => context === (document.querySelector("[data-agent-entry] canvas") as HTMLCanvasElement).getContext("webgl2") && !context.isContextLost())).toBe(true);
    await closeDialog(page);
    expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual(scroll);
  }
  await page.getByRole("link", { name: "Chat", exact: true }).click();
  await expect(page).toHaveURL(/\/chat\/[^/]+$/);
  await expect(page.locator("[data-agent-entry] canvas")).toHaveCount(0);
  await expect.poll(() => gl.evaluate((context) => context.isContextLost())).toBe(true);
  await page.goBack();
  await expectReady(page);
  expect(observed.requests.filter((url) => url.endsWith(".glb")).map((url) => new URL(url).pathname)).toEqual([modelPath]);
  expect(observed.requests.filter((url) => /\.(?:glb|wasm|hdr)(?:\?|$)/.test(url) && new URL(url).origin !== new URL(page.url()).origin)).toEqual([]);
  expect(await page.evaluate(() => (window as unknown as { entryViolations: string[] }).entryViolations)).toEqual([]);
  expect(observed.errors).toEqual([]);
  await canvas!.dispose();
  await gl.dispose();
});

test("公开 about 的键盘开关、焦点循环和程序性逃逸守卫", async ({ page }) => {
  await page.goto("/about");
  await expectReady(page);
  await page.getByRole("button", { name: entryName }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  const dialog = page.getByRole("dialog");
  for (let i = 0; i < 7; i += 1) {
    await page.keyboard.press(i % 2 ? "Tab" : "Shift+Tab");
    expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  }
  expect(await page.evaluate(() => {
    const outside = document.createElement("button");
    outside.textContent = "临时外部焦点目标";
    document.body.appendChild(outside);
    outside.focus();
    const contained = document.querySelector('[role="dialog"]')!.contains(document.activeElement);
    outside.remove();
    return contained;
  })).toBe(true);
  await closeDialog(page);
  await page.keyboard.press("Space");
  await expect(dialog).toBeVisible();
  await page.getByRole("button", { name: "关闭对话", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/about$/);
});

test("欢迎动作中键盘激活由点击动作接管，真实 Canvas 连续播放且完整归位", async ({ page }, testInfo) => {
  let release!: () => void;
  const pendingModel = new Promise<void>((resolve) => { release = resolve; });
  await observeModelFrames(page);
  await page.route(`**${modelPath}`, async (route) => {
    await pendingModel;
    await route.continue().catch(() => undefined);
  });
  try {
    await page.goto("/home");
    // 在模型尚未就绪时聚焦，随后用真实 Space 激活；避免鼠标移入先将欢迎抢占为关注动作。
    const trigger = page.getByRole("button", { name: entryName });
    await trigger.focus();
    release();
    // 直接按浏览器帧同步：多个 locator 的默认退避轮询可能在 850ms 欢迎结束后才完成。
    // 返回时保存的是仍在运动的真实画面和 Canvas，下一步立即通过键盘激活。
    const welcome = await page.waitForFunction((animated) => {
      const state = (window as unknown as { entryMeasurements?: { frames: EntryFrame[] } }).entryMeasurements;
      const canvas = document.querySelector<HTMLCanvasElement>("[data-agent-entry][data-ready=true] canvas");
      const baseline = state?.frames[0];
      const current = state?.frames.at(-1);
      if (!canvas || !baseline || !current || baseline.pixels <= 50) return null;
      if (animated && Math.abs(current.center - baseline.center) <= 0.75) return null;
      return { canvas, baseline, current, clickedAt: performance.now() };
    }, e2eAgentEntryTheme() === "default", { polling: "raf", timeout: 30_000 });
    try {
      await page.keyboard.press("Space");
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(page.getByRole("textbox", { name: "消息", exact: true })).toBeFocused();
      const focusedAt = await page.evaluate(() => performance.now());
      const { baseline, current: welcomeLast, clickedAt, sameCanvas } = await welcome.evaluate((captured) => {
        if (!captured) throw new Error("未捕获就绪的欢迎画面。");
        return {
          baseline: captured.baseline, current: captured.current, clickedAt: captured.clickedAt,
          sameCanvas: captured.canvas === document.querySelector("[data-agent-entry] canvas"),
        };
      });
      expect(sameCanvas).toBe(true);
      const beforeSettling = await modelMeasurements(page);
      const welcomeFrames = beforeSettling.frames.filter((frame) => frame.at < clickedAt);
      if (e2eAgentEntryTheme() === "default") {
        expect(Math.abs(welcomeLast.center - baseline.center)).toBeGreaterThan(0.75);
        expect(clickedAt - welcomeLast.at).toBeLessThan(250);
        await expect(page.getByRole("tooltip")).toContainText("在呢，我们聊聊。");
      }
      await expectModelSettled(page);
      const measured = await modelMeasurements(page);
      const clickFrames = measured.frames.filter((frame) => frame.at >= clickedAt);
      if (e2eAgentEntryTheme() === "default") {
        expect(clickFrames.filter((frame) => frame.at > focusedAt).length).toBeGreaterThan(2);
        expect(Math.max(...clickFrames.map((frame) => Math.abs(frame.center - baseline.center)))).toBeGreaterThan(2);
        // 短欢迎已经开始，新的点击仍播放自己的完整时长；850ms 的欢迎残段不足以通过。
        expect(clickFrames.at(-1)!.at - clickFrames[0].at).toBeGreaterThanOrEqual(850);
        expect(Math.abs(clickFrames.at(-1)!.center - baseline.center)).toBeLessThan(1);
      } else {
        expect(measured.frames.every((frame) => Math.abs(frame.center - baseline.center) < 1)).toBe(true);
      }
      await testInfo.attach("agent-entry-welcome-interruption-frames", {
        body: JSON.stringify({ theme: e2eAgentEntryTheme(), baseline, clickedAt, focusedAt, welcomeFrames, clickFrames }),
        contentType: "application/json",
      });
    } finally { await welcome.dispose(); }
  } finally { release(); }
});

test("默认模型长时间静止后点击仍有可见位移，autofocus 后完成回位并停止绘制", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await observeModelFrames(page);
  await page.goto("/home");
  await expectReady(page);
  await page.mouse.move(0, 0);
  await expectModelSettled(page);
  const baseline = (await modelMeasurements(page)).frames.at(-1)!;
  expect(baseline.pixels).toBeGreaterThan(50);
  // 实际静止时间用于覆盖 demand clock 的大 delta，不是用等待替代就绪断言。
  if (e2eAgentEntryTheme() === "default") await page.waitForTimeout(30_000);
  const clickedAt = await page.evaluate(() => performance.now());
  await openDialog(page);
  const focusedAt = await page.evaluate(() => performance.now());
  if (e2eAgentEntryTheme() === "default") await expect(page.getByRole("tooltip")).toContainText("在呢，我们聊聊。");
  await page.mouse.move(0, 0);
  await expectModelSettled(page);
  const measured = await modelMeasurements(page);
  const frames = measured.frames.filter((frame) => frame.at >= clickedAt);
  if (e2eAgentEntryTheme() === "default") {
    expect(frames.filter((frame) => frame.at > focusedAt).length).toBeGreaterThan(2);
    expect(Math.max(...frames.map((frame) => Math.abs(frame.center - baseline.center)))).toBeGreaterThan(2);
    expect(Math.abs(measured.frames.at(-1)!.center - baseline.center)).toBeLessThan(1);
  } else {
    expect(frames.every((frame) => Math.abs(frame.center - baseline.center) < 1)).toBe(true);
  }
  await testInfo.attach("agent-entry-real-frames", {
    body: JSON.stringify({ theme: e2eAgentEntryTheme(), baseline, focusedAt, frames, note: "Chromium/软件 WebGL 的真实透明轮廓读回；不代表实体手机性能。" }), contentType: "application/json",
  });
});

test("GLB pending 时普通入口可开窗，释放真实二进制后沿用面板与草稿", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route(`**${modelPath}`, async (route) => { await gate; await route.continue().catch(() => undefined); });
  try {
    await page.goto("/home");
    await expectLogoFallback(page);
    await openDialog(page);
    await page.getByRole("textbox", { name: "消息", exact: true }).fill("加载时的草稿");
    release();
    await expectReady(page);
    await expect(page.locator('[data-agent-entry] button img[src="/brand/logo_transparent.svg"]')).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "消息", exact: true })).toHaveValue("加载时的草稿");
    await closeDialog(page);
    await page.getByRole("link", { name: "Chat", exact: true }).click();
    await expect(page).toHaveURL(/\/chat\/[^/]+$/);
    await expect(page.locator("[data-agent-entry]")).toHaveCount(0);
  } finally { release(); }
});

for (const failure of ["404", "损坏", "chunk", "context-lost", "webgl-create"] as const) {
  test(`${failure} 故障保留 DOM 私聊和草稿，宿主仍可操作`, async ({ page }) => {
    const observed = observeEntry(page);
    let failedRequest = false;
    if (failure === "404" || failure === "损坏") {
      await page.route(`**${modelPath}`, (route) => {
        failedRequest = true;
        return route.fulfill({ status: failure === "404" ? 404 : 200, body: "invalid GLB", contentType: "model/gltf-binary" });
      });
    }
    if (failure === "chunk") {
      const chunks = await entryChunks();
      await page.route((url) => chunks.includes(url.pathname), (route) => { failedRequest = true; return route.abort(); });
    }
    if (failure === "webgl-create") {
      await page.addInitScript(() => {
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...args: unknown[]) {
          if (type === "webgl2" || type === "webgl" || type === "experimental-webgl") return null;
          return Reflect.apply(original, this, [type, ...args]);
        } as typeof original;
      });
    }
    await page.goto("/home");
    if (failure === "context-lost") await expectReady(page);
    else if (failure !== "webgl-create") await expect.poll(() => failedRequest).toBe(true);
    if (failure === "404") await expectLogoFallback(page);
    await openDialog(page);
    await page.getByRole("textbox", { name: "消息", exact: true }).fill("视觉失败也保留");
    if (failure === "context-lost") {
      await page.locator("[data-agent-entry] canvas").evaluate((node) => {
        const extension = (node as HTMLCanvasElement).getContext("webgl2")?.getExtension("WEBGL_lose_context");
        if (!extension) throw new Error("浏览器必须支持真实 WebGL context lost 验证");
        extension.loseContext();
      });
    }
    await expect(page.locator("[data-agent-entry] canvas")).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "消息", exact: true })).toHaveValue("视觉失败也保留");
    const sent = await sendPrivateMessage(page, `降级发送-${failure}-${randomUUID()}`);
    expect(sent.task.status).toBe("pending");
    await closeDialog(page);
    await hostInteraction(page);
    expect(observed.errors).toEqual([]);
  });
}

test("触摸、320px 和极短视口保留输入与小人，减少动态偏好停止位移", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, storageState: E2E_USERS[0].storageState, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1.5, reducedMotion: "reduce" });
  const page = await context.newPage();
  try {
    await observeModelFrames(page);
    await page.goto("/home");
    await expectReady(page);
    await expectModelSettled(page);
    const before = await modelMeasurements(page);
    await page.getByRole("button", { name: entryName }).tap();
    await expect(page.getByRole("dialog")).toBeVisible();
    await settleHydration(page);
    const after = await modelMeasurements(page);
    expect(after.frames.slice(before.frames.length).every((frame) => Math.abs(frame.center / frame.height - before.frames.at(-1)!.center / before.frames.at(-1)!.height) < 0.01)).toBe(true);
    for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 320, height: 320 }]) {
      await page.setViewportSize(viewport);
      for (const locator of [page.getByRole("button", { name: entryName }), page.getByRole("textbox", { name: "消息", exact: true }), page.getByRole("button", { name: "关闭对话", exact: true })]) {
        await expect(locator).toBeInViewport();
        const box = (await locator.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
        expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
      }
      await page.getByRole("textbox", { name: "消息", exact: true }).fill("触摸私聊草稿");
      await expect(page.getByRole("textbox", { name: "消息", exact: true })).toHaveValue("触摸私聊草稿");
    }
  } finally { await context.close(); }
});

if (e2eAgentEntryTheme() === "default") {
  test("归位清除小助手位置记录并恢复默认点，刷新后仍可拖拽", async ({ page }) => {
    await page.goto("/home");
    await expectReady(page);
    const initial = await entryBox(page);
    const dropped = { x: initial.x - 140, y: initial.y - 100 };
    await moveEntryWithMouse(page, dropped);
    await expectEntryAt(page, dropped);
    expect(await savedEntryPosition(page)).not.toBeNull();
    await page.evaluate(() => localStorage.setItem("other-preference", "keep"));
    await openDialog(page);
    await page.getByRole("textbox", { name: "消息", exact: true }).fill("归位时保留草稿");
    const reset = page.getByRole("button", { name: "归位", exact: true });
    await expect(reset).toBeVisible();
    await expect(reset.locator("svg")).toBeVisible();
    const clear = page.getByRole("button", { name: "清空与小助手的聊天记录" });
    expect((await reset.boundingBox())!.width).toBe((await clear.boundingBox())!.width);
    const resetHint = reset.getByText("归位", { exact: true });
    await expect(resetHint).toHaveCSS("opacity", "0");
    await reset.hover();
    await expect(resetHint).toHaveCSS("opacity", "1");
    await page.mouse.move(0, 0);
    await expect(resetHint).toHaveCSS("opacity", "0");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(reset).toBeFocused();
    await expect(resetHint).toHaveCSS("opacity", "1");
    await page.keyboard.press("Enter");
    await expectEntryAt(page, initial);
    expect(await savedEntryPosition(page)).toBeNull();
    expect(await page.evaluate(() => localStorage.getItem("other-preference"))).toBe("keep");
    await expect(page.getByRole("textbox", { name: "消息", exact: true })).toHaveValue("归位时保留草稿");
    await closeDialog(page);
    await page.reload();
    await expectReady(page);
    await expectEntryAt(page, initial);
    await moveEntryWithMouse(page, dropped);
    await expectEntryAt(page, dropped);
    expect(await savedEntryPosition(page)).not.toBeNull();
  });

  test("窄屏私聊归位保留临时顶部布局，关闭后恢复默认点", async ({ browser, baseURL }) => {
    const context = await browser.newContext({
      baseURL, storageState: E2E_USERS[0].storageState, viewport: { width: 320, height: 320 },
      hasTouch: true, isMobile: true, deviceScaleFactor: 1.5,
    });
    const page = await context.newPage();
    try {
      await page.goto("/home");
      await expectReady(page);
      const initial = await entryBox(page);
      await moveEntryWithTouch(page, { x: -60, y: -50 });
      expect(await savedEntryPosition(page)).not.toBeNull();
      await page.getByRole("button", { name: entryName }).tap();
      await expect(page.getByRole("dialog")).toBeVisible();
      const compact = await entryBox(page);
      expect(compact.y).toBeLessThan(100);
      const reset = page.getByRole("button", { name: "归位", exact: true });
      await expect(reset).toBeInViewport();
      await reset.tap();
      await expect(reset.getByText("归位", { exact: true })).toHaveCSS("opacity", "1");
      await expectEntryAt(page, compact);
      expect(await savedEntryPosition(page)).toBeNull();
      await page.getByRole("button", { name: "关闭对话", exact: true }).tap();
      await expectEntryAt(page, initial);
      await page.reload();
      await expectReady(page);
      await expectEntryAt(page, initial);
    } finally { await context.close(); }
  });

  test("拖拽超过阈值才移动，真实模型反馈原地回稳且刷新和 Chat 回返记住放置点", async ({ page }, testInfo) => {
    const observed = observeEntry(page);
    await observeModelFrames(page);
    await page.goto("/home");
    await expectReady(page);
    const initial = await entryBox(page);
    const center = { x: initial.x + initial.width / 2, y: initial.y + initial.height / 2 };
    await page.mouse.move(center.x, center.y);
    await expectModelSettled(page);
    const baseline = (await modelMeasurements(page)).frames.at(-1)!;
    const canvas = await page.locator("[data-agent-entry] canvas").elementHandle();
    expect(await savedEntryPosition(page)).toBeNull();
    await page.mouse.down();
    try {
      await page.mouse.move(center.x - 3, center.y - 2);
      await settleHydration(page);
      await expectEntryAt(page, initial);
      await expect(page.getByRole("dialog")).toHaveCount(0);
      expect(await savedEntryPosition(page)).toBeNull();

      const draggingAt = await page.evaluate(() => performance.now());
      await page.mouse.move(center.x - 150, center.y - 100, { steps: 10 });
      await expect(page.getByRole("tooltip")).toContainText("诶，要带我去哪？");
      await expectEntryAt(page, { x: initial.x - 150, y: initial.y - 100 });
      await expect.poll(async () => {
        const frames = (await modelMeasurements(page)).frames.filter((frame) => frame.at >= draggingAt);
        return Math.max(0, ...frames.map((frame) => Math.abs(frame.center - baseline.center)));
      }).toBeGreaterThan(2);
      await page.mouse.move(center.x - 210, center.y - 120, { steps: 6 });
      await expectEntryAt(page, { x: initial.x - 210, y: initial.y - 120 });
      // 拖动只改变呈现，松手才写入位置；抓取偏移保持不变。
      expect(await savedEntryPosition(page)).toBeNull();
    } finally {
      await page.mouse.up();
    }
    await expect(page.getByRole("tooltip")).toContainText("好，就待在这里。");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const dropped = { x: initial.x - 210, y: initial.y - 120 };
    await page.mouse.move(0, 0);
    await expectModelSettled(page);
    await expectEntryAt(page, dropped);
    const measured = await modelMeasurements(page);
    expect(Math.abs(measured.frames.at(-1)!.center - baseline.center)).toBeLessThan(1);
    expect(await canvas!.evaluate((node) => node === document.querySelector("[data-agent-entry] canvas"))).toBe(true);
    const saved = await savedEntryPosition(page);
    expect(saved).not.toBeNull();
    await openDialog(page);
    await expectEntryAt(page, dropped);
    const panel = (await page.getByRole("region", { name: "与小助手聊天", exact: true }).boundingBox())!;
    const mascot = await entryBox(page);
    expect(panel.x + panel.width <= mascot.x || panel.x >= mascot.x + mascot.width).toBe(true);
    await closeDialog(page);
    expect(await canvas!.evaluate((node) => node === document.querySelector("[data-agent-entry] canvas"))).toBe(true);
    expect(await savedEntryPosition(page)).toBe(saved);

    await page.getByRole("link", { name: "Chat", exact: true }).click();
    await expect(page).toHaveURL(/\/chat\/[^/]+$/);
    await expect(page.locator("[data-agent-entry] canvas")).toHaveCount(0);
    await page.goBack();
    await expectReady(page);
    await expectEntryAt(page, dropped);
    expect(observed.requests.filter((url) => url.endsWith(".glb")).map((url) => new URL(url).pathname)).toEqual([modelPath]);
    await page.reload();
    await expectReady(page);
    await expectEntryAt(page, dropped);
    expect(await savedEntryPosition(page)).toBe(saved);
    expect(observed.errors).toEqual([]);
    await testInfo.attach("agent-entry-drag-real-frames", {
      body: JSON.stringify({ baseline, dropped, frames: measured.frames, note: "浏览器原生鼠标拖放与实际 WebGL 轮廓读回。" }),
      contentType: "application/json",
    });
    await canvas!.dispose();
  });

  test("减少动态偏好仍可键盘移动并持久化，Enter 和 Space 保留私聊激活", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await observeModelFrames(page);
    await page.goto("/home");
    await expectReady(page);
    await expectModelSettled(page);
    const initial = await entryBox(page);
    const baseline = (await modelMeasurements(page)).frames.at(-1)!;
    await page.getByRole("button", { name: entryName }).focus();
    await page.keyboard.down("ArrowLeft");
    await expectEntryAt(page, { x: initial.x - 10, y: initial.y });
    expect(await savedEntryPosition(page)).toBeNull();
    await page.keyboard.up("ArrowLeft");
    const saved = await savedEntryPosition(page);
    expect(saved).not.toBeNull();
    await page.keyboard.press("Shift+ArrowUp");
    const moved = { x: initial.x - 10, y: initial.y - 40 };
    await expectEntryAt(page, moved);
    expect(await savedEntryPosition(page)).not.toBe(saved);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const frames = (await modelMeasurements(page)).frames;
    expect(frames.every((frame) => Math.abs(frame.center - baseline.center) < 1)).toBe(true);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
    await closeDialog(page);
    await page.keyboard.press("Space");
    await expect(page.getByRole("dialog")).toBeVisible();
    await closeDialog(page);
    await page.reload();
    await expectReady(page);
    await expectEntryAt(page, moved);
  });

  test("原生触摸拖放可取消，手机私聊临时顶部布局不覆盖放置点", async ({ browser, baseURL }) => {
    const context = await browser.newContext({
      baseURL, storageState: E2E_USERS[0].storageState, viewport: { width: 390, height: 844 },
      hasTouch: true, isMobile: true, deviceScaleFactor: 1.5,
    });
    const page = await context.newPage();
    try {
      await page.goto("/home");
      await expectReady(page);
      const initial = await entryBox(page);
      const canvas = await page.locator("[data-agent-entry] canvas").elementHandle();
      await moveEntryWithTouch(page, { x: -70, y: -170 });
      const dropped = { x: initial.x - 70, y: initial.y - 170 };
      await expectEntryAt(page, dropped);
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.getByRole("tooltip")).toContainText("好，就待在这里。");
      const saved = await savedEntryPosition(page);
      expect(saved).not.toBeNull();
      const scroll = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
      await moveEntryWithTouch(page, { x: -40, y: -80 }, true);
      await expectEntryAt(page, dropped);
      expect(await savedEntryPosition(page)).toBe(saved);
      await expect(page.getByRole("dialog")).toHaveCount(0);
      expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual(scroll);
      // pointercancel 后的下一次普通点击不能被旧手势的 click 抑制吞掉。
      await page.getByRole("button", { name: entryName }).tap();
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(page.getByRole("textbox", { name: "消息", exact: true })).toBeFocused();
      const compact = await entryBox(page);
      expect(compact.y).toBeLessThan(100);
      expect(compact.width).toBeLessThan(initial.width);
      expect(await savedEntryPosition(page)).toBe(saved);
      await moveEntryWithTouch(page, { x: -30, y: 40 });
      await expectEntryAt(page, compact);
      expect(await savedEntryPosition(page)).toBe(saved);
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.getByRole("button", { name: "关闭对话", exact: true }).tap();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expectEntryAt(page, dropped);
      expect(await canvas!.evaluate((node) => node === document.querySelector("[data-agent-entry] canvas"))).toBe(true);
      expect(await savedEntryPosition(page)).toBe(saved);
      await page.reload();
      await expectReady(page);
      await expectEntryAt(page, dropped);
      await canvas!.dispose();
    } finally { await context.close(); }
  });

  test("拖至四周保留可见边距，视口缩小只修正呈现且恢复后仍在用户放置点", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 844 });
    await page.goto("/home");
    await expectReady(page);
    const initial = await entryBox(page);
    await moveEntryWithMouse(page, { x: -initial.width / 2 + 1, y: -initial.height / 2 + 1 });
    await expectEntryAt(page, { x: 12, y: 12 });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const bubble = (await page.getByRole("tooltip").boundingBox())!;
    expect(bubble.x).toBeGreaterThanOrEqual(0);
    expect(bubble.y).toBeGreaterThanOrEqual(0);
    await moveEntryWithMouse(page, { x: 1279 - initial.width / 2, y: 843 - initial.height / 2 });
    const dropped = { x: 1280 - initial.width - 12, y: 844 - initial.height - 12 };
    await expectEntryAt(page, dropped);
    const saved = await savedEntryPosition(page);
    await page.setViewportSize({ width: 320, height: 320 });
    await expect(page.getByRole("button", { name: entryName })).toBeInViewport();
    await expect.poll(async () => {
      const box = await entryBox(page);
      return box.x >= 11 && box.y >= 11 && box.x + box.width <= 309 && box.y + box.height <= 309;
    }).toBe(true);
    expect(await savedEntryPosition(page)).toBe(saved);
    await page.setViewportSize({ width: 1280, height: 844 });
    await expectEntryAt(page, dropped);
    expect(await savedEntryPosition(page)).toBe(saved);
  });
} else {
  test("生日主题保留固定位置，默认主题保存点和拖拽交互均不改变生日入口", async ({ page }) => {
    const saved = JSON.stringify({ version: 1, x: 0.2, y: 0.2 });
    await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), { key: entryPositionKey, value: saved });
    await page.goto("/home");
    await expectReady(page);
    const initial = await entryBox(page);
    await moveEntryWithMouse(page, { x: initial.x - 280, y: initial.y - 120 });
    await expectEntryAt(page, initial);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: entryName }).focus();
    await page.keyboard.press("ArrowLeft");
    await expectEntryAt(page, initial);
    expect(await savedEntryPosition(page)).toBe(saved);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
  });
}

for (const width of [320, 390, 1280]) {
  test(`${width}px 页面表单、Study 与 Post 控件可操作`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/me");
    await expectReady(page);
    await page.getByLabel("昵称", { exact: true }).click();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.getByRole("button", { name: "保存", exact: true }).click({ trial: true, timeout: 5_000 });
    await page.getByRole("button", { name: "退出登录", exact: true }).click({ trial: true, timeout: 5_000 });
    if (width < 768) {
      // 模拟输入期间可用视口缩短；真实系统软键盘仍须在目标设备复核。
      await page.getByLabel(/自我介绍/).click();
      await page.setViewportSize({ width, height: 400 });
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.getByRole("button", { name: "保存", exact: true }).click({ trial: true, timeout: 5_000 });
      await page.setViewportSize({ width, height: 844 });
    }

    await page.goto("/study");
    await expectReady(page);
    await page.getByRole("button", { name: "开始专注", exact: true }).click({ trial: true });
    await page.getByRole("textbox", { name: "添加待办" }).fill("入口布局检查");

    // Node APIRequestContext 曾出现 socket hang up；布局夹具改走当前浏览器的同源请求。
    // 保留真实 HTTP/认证/数据库写入，不增加请求重试或放宽业务断言。
    const created = await page.evaluate(async (viewportWidth) => {
      const response = await fetch("/api/posts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: `Agent Entry 布局 ${viewportWidth}`, content: "正文段落\n\n".repeat(50) }),
      });
      return { ok: response.ok, payload: await response.json() as { post: { slug: string } } };
    }, width);
    expect(created.ok).toBe(true);
    const { post } = created.payload;
    try {
      await page.goto(`/posts/${post.slug}`);
      await expectReady(page);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.getByRole("link", { name: "返回博客列表" }).click({ trial: true });
      await page.goto(`/posts/edit/${post.slug}`);
      await expectReady(page);
      await page.getByLabel("正文（Markdown）", { exact: true }).click();
      await page.getByRole("button", { name: "保存博文", exact: true }).click({ trial: true });
      const confirmation = page.waitForEvent("dialog").then(async dialog => {
        expect(dialog.message()).toBe("删除这篇博文？");
        await dialog.dismiss();
      });
      await page.getByRole("button", { name: "删除博文", exact: true }).click();
      await confirmation;
      await expect(page.getByRole("dialog", { name: "编辑博文" })).toBeVisible();
      await page.getByRole("button", { name: "关闭编辑博文" }).click();

    } finally {
      expect(await page.evaluate(async (slug) => (await fetch(`/api/posts/${slug}`, { method: "DELETE" })).ok, post.slug)).toBe(true);
    }
  });
}

async function secondUserContext(browser: Browser, baseURL: string | undefined) {
  if (!baseURL) throw new Error("入口身份生命周期验证需要隔离 E2E baseURL");
  // 独立登录第二位用户，避免使其他用例复用的第一位用户 Session 失效。
  const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  try {
    const response = await context.request.post("/api/auth/login", {
      headers: { origin: baseURL },
      data: { email: E2E_USERS[1].email, password: E2E_PASSWORD },
    });
    expect(response.status()).toBe(200);
    if (e2eAppMode() === "development") {
      // 跨标签持有 WebGL 句柄期间不能发生首次路由编译引起的整页重载。
      for (const path of ["/", "/home", "/me", "/about", "/api/auth/logout"]) {
        const warm = await context.request.get(path);
        expect(warm.status()).toBe(path === "/api/auth/logout" ? 405 : 200);
      }
    }
    return context;
  } catch (error) {
    await context.close();
    throw error;
  }
}

async function useNativeFocus(...pages: Page[]) {
  // Playwright 在跨文档导航后重新启用始终聚焦，须在导航完成后取消这个覆盖。
  for (const page of pages) {
    const session = await page.context().newCDPSession(page);
    await session.send("Emulation.setFocusEmulationEnabled", { enabled: false });
  }
}

test.describe("入口身份生命周期", () => {
  test("跨标签退出卸载公开页入口与 WebGL，重新登录并聚焦后复用模型恢复私聊", async ({ browser, baseURL }) => {
    test.setTimeout(90_000);
    const context = await secondUserContext(browser, baseURL);
    try {
      const otherTab = await context.newPage();
      await otherTab.goto("/me");
      await expectReady(otherTab);
      const page = await context.newPage();
      const observed = observeEntry(page);
      await page.goto("/about");
      await expectReady(page);
      await useNativeFocus(page, otherTab);
      await otherTab.bringToFront();
      await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(false);
      const oldContext = await page.locator("[data-agent-entry] canvas").evaluateHandle((canvas) => {
        const gl = (canvas as HTMLCanvasElement).getContext("webgl2");
        if (!gl) throw new Error("入口需要真实 WebGL2 context");
        return gl;
      });
      expect(await oldContext.evaluate((gl) => gl.isContextLost())).toBe(false);
      otherTab.once("dialog", (dialog) => dialog.accept());
      const logout = otherTab.waitForResponse((response) => new URL(response.url()).pathname === "/api/auth/logout");
      const invalidated = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/auth/me" && response.status() === 401, { timeout: 10_000 });
      await otherTab.getByRole("button", { name: "退出登录", exact: true }).click();
      expect((await logout).status()).toBe(200);
      await invalidated;
      // 公开 About 没有 SessionHeartbeat；不导航、不手动聚焦也必须收到跨标签退出通知。
      await expect(page).toHaveURL(/\/about$/);
      await expect(page.getByRole("button", { name: entryName })).toHaveCount(0);
      await expect(page.locator("[data-agent-entry] canvas")).toHaveCount(0);
      await expect.poll(() => oldContext.evaluate((gl) => gl.isContextLost())).toBe(true);
      await oldContext.dispose();

      const loginForm = otherTab.locator("form");
      await expect(loginForm.getByRole("button", { name: "登录", exact: true })).toBeVisible();
      // 硬导航后的表单须已能交互，再填写受控输入；仅看到 SSR 按钮不足以证明 hydration 完成。
      await loginForm.getByRole("button", { name: "显示密码", exact: true }).click();
      await expect(loginForm.getByLabel("密码", { exact: true })).toHaveAttribute("type", "text");
      await loginForm.getByRole("button", { name: "隐藏密码", exact: true }).click();
      await loginForm.getByLabel("邮箱", { exact: true }).fill(E2E_USERS[1].email);
      await loginForm.getByLabel("密码", { exact: true }).fill(E2E_PASSWORD);
      const login = otherTab.waitForResponse((response) => new URL(response.url()).pathname === "/api/auth/login");
      await loginForm.getByRole("button", { name: "登录", exact: true }).click();
      const loginResponse = await login;
      expect(loginResponse.request().postDataJSON()).toEqual({ email: E2E_USERS[1].email, password: E2E_PASSWORD });
      expect(loginResponse.status()).toBe(200);
      await expect(otherTab).toHaveURL(/\/home$/);
      await expectReady(otherTab);
      await useNativeFocus(page, otherTab);
      const revalidated = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/auth/me" && response.status() === 200, { timeout: 10_000 });
      await page.bringToFront();
      await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true);
      await revalidated;
      await expectReady(page);
      expect(observed.requests.filter((url) => url.endsWith(".glb")).map((url) => new URL(url).pathname)).toEqual([modelPath]);
      await page.getByRole("button", { name: entryName }).focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(page).toHaveURL(/\/about$/);
      await expect(page.getByRole("button", { name: "发送", exact: true })).toBeVisible();
      await expect(page.locator("[data-agent-entry] canvas")).toHaveCount(1);
      expect(observed.errors).toEqual([]);
    } finally {
      try {
        await context.request.post("/api/auth/logout", { headers: { origin: baseURL! } });
      } finally { await context.close(); }
    }
  });

  test("真实 Session 到期后聚焦重验 401 并释放入口，不依赖退出通知", async ({ browser, baseURL }) => {
    const databaseUrl = process.env.E2E_DATABASE_URL
      ?? (await readFile("test-results/.e2e-database-url", "utf8")).trim();
    const database = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const context = await secondUserContext(browser, baseURL);
    try {
      const page = await context.newPage();
      const observed = observeEntry(page);
      await page.goto("/about");
      await expectReady(page);
      const otherTab = await context.newPage();
      await otherTab.goto("about:blank");
      await useNativeFocus(page, otherTab);
      await otherTab.bringToFront();
      await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(false);
      const expired = await database.session.updateMany({
        where: { user: { email: E2E_USERS[1].email } },
        data: { expiresAt: new Date(0) },
      });
      expect(expired.count).toBe(1);
      expect((await context.request.get("/api/auth/me")).status()).toBe(401);
      const revalidated = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/auth/me" && response.status() === 401, { timeout: 10_000 });
      await page.bringToFront();
      await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true);
      await revalidated;
      await expect(page).toHaveURL(/\/about$/);
      await expect(page.getByRole("button", { name: entryName })).toHaveCount(0);
      await expect(page.locator("[data-agent-entry] canvas")).toHaveCount(0);
      expect(observed.requests.filter((url) => url.endsWith(".glb"))).toHaveLength(1);
      expect(observed.errors).toEqual([]);
    } finally {
      try {
        await context.request.post("/api/auth/logout", { headers: { origin: baseURL! } });
      } finally {
        await context.close();
        await database.$disconnect();
      }
    }
  });
});

test("两位用户的私聊持久隔离，关闭后任务完成、重新打开回复，审批后继续且 Chat 保持共享", async ({ page, browser, baseURL }) => {
  test.setTimeout(120_000);
  const databaseUrl = await privateDatabaseUrl();
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const second = await secondUserContext(browser, baseURL);
  const other = await second.newPage();
  const markerA = `仅属于A-${randomUUID()}`;
  const markerB = `仅属于B-${randomUUID()}`;
  const createdRooms: string[] = [];
  try {
    const users = await db.user.findMany({ where: { email: { in: E2E_USERS.map((user) => user.email) } } });
    await db.room.deleteMany({ where: { kind: "agent_private", privateOwnerId: { in: users.map((user) => user.id) } } });
    await page.goto("/home");
    await expectReady(page);
    await openDialog(page);
    const sentA = await sendPrivateMessage(page, `备忘录：${markerA}`);
    createdRooms.push(sentA.roomId);
    await expect(page.getByRole("tooltip")).toContainText("小助手正在思考…");
    await closeDialog(page);
    await expect(page.getByRole("tooltip")).toContainText("小助手正在思考…");
    await runPrivateTask(sentA.task.id, databaseUrl);
    const completedA = await db.agentTask.findUniqueOrThrow({ where: { id: sentA.task.id } });
    expect(completedA.status).toBe("completed");
    const replyA = await db.message.findUniqueOrThrow({ where: { id: completedA.finalMessageId! } });
    await expect(page.getByRole("tooltip")).toContainText("回复准备好啦。");
    await openDialog(page);
    await expect(page.getByRole("dialog").getByText(replyA.content, { exact: true })).toBeVisible();
    const memo = await db.memo.findFirstOrThrow({ where: { roomId: sentA.roomId } });
    expect(memo.content).toContain(markerA);
    expect(await db.post.count({ where: { agentTaskId: sentA.task.id } })).toBe(0);

    await other.goto("/about");
    await openDialog(other);
    await expect(other.getByRole("dialog").getByText(markerA, { exact: false })).toHaveCount(0);
    const sentB = await sendPrivateMessage(other, markerB);
    createdRooms.push(sentB.roomId);
    expect(sentB.roomId).not.toBe(sentA.roomId);
    await runPrivateTask(sentB.task.id, databaseUrl);
    await expect.poll(async () => (await db.agentTask.findUniqueOrThrow({ where: { id: sentB.task.id } })).status).toBe("completed");
    const replyB = await db.message.findFirstOrThrow({ where: { roomId: sentB.roomId, senderType: "agent" } });
    await expect(other.getByRole("dialog").getByText(replyB.content, { exact: true })).toBeVisible();
    const forbidden = await second.request.get(`/api/agent/tasks/${sentA.task.id}`);
    expect(forbidden.status()).toBe(403);

    const approvalSend = await sendPrivateMessage(page, `删除刚才记录的 ${markerA}`);
    // 只控制模型决策；真实 API、持久任务、工具治理、审批和恢复均走应用链路。
    await db.agentTask.update({ where: { id: approvalSend.task.id }, data: { plan: {
      intent: "delete_memo", confidence: 0.95, requiredTools: ["memo.delete"],
      taskSteps: ["经批准删除备忘录"], finalResponsePlan: "确认删除结果",
      finalResponseText: "这条私人备忘录已经删除。", toolInputs: { "memo.delete": { memoId: memo.id } },
    } } });
    await runPrivateTask(approvalSend.task.id, databaseUrl);
    expect((await db.agentTask.findUniqueOrThrow({ where: { id: approvalSend.task.id } })).status).toBe("waiting_approval");
    const approve = page.getByRole("button", { name: "批准并执行", exact: true });
    await expect(approve).toBeVisible();
    const approved = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/agent/tasks/${approvalSend.task.id}/approvals` && response.request().method() === "POST");
    await approve.click();
    expect((await approved).status()).toBe(200);
    await runPrivateTask(approvalSend.task.id, databaseUrl);
    await expect(page.getByRole("dialog").getByText("备忘录已删除。", { exact: true })).toBeVisible();
    await expect(page.getByRole("dialog").getByText("这条私人备忘录已经删除。", { exact: true })).toHaveCount(0);
    expect(await db.memo.findUnique({ where: { id: memo.id } })).toBeNull();
    await page.reload();
    await openDialog(page);
    await expect(page.getByRole("dialog").getByText(`备忘录：${markerA}`, { exact: true })).toBeVisible();
    await expect(page.getByRole("dialog").getByText(markerB, { exact: true })).toHaveCount(0);
    await closeDialog(page);
    await page.getByRole("link", { name: "Chat", exact: true }).click();
    await expect(page).toHaveURL(/\/chat\/[^/]+$/);
    expect(new URL(page.url()).pathname).not.toBe(`/chat/${sentA.roomId}`);
    await expect(page.getByRole("button", { name: "发送", exact: true })).toBeVisible();
    await expect(page.getByText(markerA, { exact: false })).toHaveCount(0);
    await expect(page.getByText(markerB, { exact: false })).toHaveCount(0);
  } finally {
    await page.close();
    await second.request.post("/api/auth/logout", { headers: { origin: baseURL! } }).catch(() => undefined);
    await second.close();
    await db.room.deleteMany({ where: { id: { in: createdRooms } } });
    await db.$disconnect();
  }
});

test("小助手清空按钮删除数据库私聊记录，刷新后为空且可重新发送", async ({ page }) => {
  const databaseUrl = await privateDatabaseUrl();
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  let roomId: string | undefined;
  try {
    await page.goto("/about");
    await openDialog(page);
    const sent = await sendPrivateMessage(page, `清空验证-${randomUUID()}`);
    roomId = sent.roomId;
    await expect(page.getByRole("dialog").getByText(sent.message.content, { exact: true })).toBeVisible();
    const clear = page.getByRole("button", { name: "清空与小助手的聊天记录" });
    const close = page.getByRole("button", { name: "关闭对话", exact: true });
    const clearBox = (await clear.boundingBox())!;
    const closeBox = (await close.boundingBox())!;
    expect(clearBox.x + clearBox.width).toBeLessThanOrEqual(closeBox.x);
    page.once("dialog", (dialog) => dialog.accept());
    const deleted = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/agent/conversation"
      && response.request().method() === "DELETE");
    await clear.focus();
    await page.keyboard.press("Enter");
    expect((await deleted).status()).toBe(200);
    await expect(page.getByRole("dialog").getByText(sent.message.content, { exact: true })).toHaveCount(0);
    await expect(page.getByText("今天有什么想聊的？直接告诉我就好。")).toBeVisible();
    expect(await db.message.count({ where: { roomId } })).toBe(0);
    expect(await db.agentTask.count({ where: { roomId } })).toBe(0);
    expect(await db.eventLog.count({ where: { roomId } })).toBe(0);
    await page.reload();
    await openDialog(page);
    await expect(page.getByText("今天有什么想聊的？直接告诉我就好。")).toBeVisible();
    await expect(page.getByRole("dialog").getByText(sent.message.content, { exact: true })).toHaveCount(0);
    const next = await sendPrivateMessage(page, "清空后的新消息");
    expect(next.roomId).toBe(roomId);
    await expect(page.getByRole("dialog").getByText("清空后的新消息", { exact: true })).toBeVisible();
  } finally {
    await page.close();
    if (roomId) await db.room.deleteMany({ where: { id: roomId } });
    await db.$disconnect();
  }
});

test("Cookie 换号不把旧草稿写入新用户，身份重验保留新会话登录", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, storageState: E2E_USERS[0].storageState });
  const page = await context.newPage();
  let releaseReads!: () => void;
  const pausedReads = new Promise<void>((resolve) => { releaseReads = resolve; });
  try {
    await page.goto("/about");
    const initialRead = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/agent/conversation");
    await openDialog(page);
    expect((await initialRead).status()).toBe(200);
    // 暂缓后续轮询，精确覆盖 POST 的写前身份守卫；轮询先发现换号也是正确行为。
    await page.route("**/api/agent/conversation", async (route) => {
      await pausedReads;
      await route.continue().catch(() => undefined);
    });
    const draft = `旧账号草稿-${randomUUID()}`;
    await page.getByRole("textbox", { name: "消息", exact: true }).fill(draft);
    // 从独立登录取得 B Cookie，再替换当前窗口 Cookie，不发送 logout/focus 通知。
    // 登录接口会撤销请求携带的跨账号旧 Session，不能借此污染其他用例共享的 A 会话。
    const replacement = await secondUserContext(browser, baseURL);
    try { await context.addCookies(await replacement.cookies()); }
    finally { await replacement.close(); }
    const rejected = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/agent/conversation/messages");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    expect((await rejected).status()).toBe(401);
    releaseReads();
    await page.unroute("**/api/agent/conversation");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const me = await context.request.get("/api/auth/me");
    expect(me.status()).toBe(200);
    const identity = await me.json() as { id: string };
    const snapshot = await context.request.get("/api/agent/conversation", { headers: { "X-Agent-Viewer-Id": identity.id } });
    expect(snapshot.status()).toBe(200);
    expect((await snapshot.json() as AgentConversationSnapshot).messages.some((message) => message.content === draft)).toBe(false);
    await openDialog(page);
    await expect(page.getByRole("textbox", { name: "消息", exact: true })).toHaveValue("");
  } finally {
    releaseReads();
    await context.request.post("/api/auth/logout", { headers: { origin: baseURL! } }).catch(() => undefined);
    await context.close();
  }
});
