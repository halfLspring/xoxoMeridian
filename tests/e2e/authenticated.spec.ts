import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { Prisma, PrismaClient } from "@prisma/client";
import { expect, request as playwrightRequest, test, type Locator } from "@playwright/test";

import type { ChatMessage, RoomSnapshot } from "@/components/chat/types";
import { cancelOnlyPlan, scheduleClarificationPrompt } from "@/tests/fixtures/schedule-clarification";
import { MINIMAL_PNG } from "@/tests/fixtures/image-bytes";
import { generateSlug } from "@/lib/posts";

import { E2E_PASSWORD, E2E_USERS } from "./support/credentials";
import { startStudyFocus, stopStudyFocus, withStudyUser } from "./support/study";

test("Agent 创建的较长备忘录和计划可在 UI 编辑保存并刷新回读", async ({ page }) => {
  test.setTimeout(120_000);
  // 共享字段校验进入浏览器后，也必须在生产 CSP 下加载和提交。
  const cspViolations: string[] = [];
  await page.exposeFunction("recordLifeFieldViolation", (directive: string) => cspViolations.push(directive));
  await page.addInitScript(() => {
    addEventListener("securitypolicyviolation", (event) => {
      const recorder = (window as unknown as { recordLifeFieldViolation: (directive: string) => Promise<void> }).recordLifeFieldViolation;
      void recorder(event.violatedDirective);
    });
  });
  const databaseUrl = process.env.E2E_DATABASE_URL
    ?? (await readFile(resolve("test-results/.e2e-database-url"), "utf8")).trim();
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const roomId = `e2e-life-fields-${Date.now().toString(36)}`;
  const title = "备忘录".repeat(100);
  const content = "一起记录生活".repeat(1500);
  const description = "每天记得休息".repeat(50);
  const updatedTitle = title.slice(0, -1) + "新";
  const updatedContent = content.slice(0, -1) + "新";
  const updatedDescription = description.slice(0, -1) + "新";

  try {
    const user = await db.user.findUniqueOrThrow({ where: { email: E2E_USERS[0].email } });
    const agent = await db.agent.findUniqueOrThrow({ where: { slug: "life-assistant" } });
    await db.room.create({ data: {
      id: roomId, slug: roomId, name: "生活字段一致性房间",
      participants: { create: { userId: user.id, role: "owner" } },
    } });
    const task = await db.agentTask.create({ data: {
      roomId, agentId: agent.id, requestedById: user.id,
      input: { normalizedContent: "保存备忘录并安排每日休息提醒", trigger: "mention" },
      plan: {
        intent: "manage_life", confidence: 0.95,
        requiredTools: ["memo.create", "schedule.create"],
        taskSteps: ["保存备忘录", "保存每日提醒"],
        finalResponsePlan: "确认保存结果", finalResponseText: "备忘录与每日提醒已保存。",
        toolInputs: {
          "memo.create": { title, content },
          "schedule.create": { cron: "0 9 * * *", timezone: "Asia/Shanghai", prompt: "提醒一起休息", description },
        },
      },
    } });
    await page.goto(`/chat/${roomId}`);
    const response = await page.request.post(`/api/agent/tasks/${task.id}/run`, {
      headers: { origin: new URL(page.url()).origin },
    });
    expect(response.ok(), await response.text()).toBe(true);
    await promisify(execFile)(process.execPath, [
      "--import", "tsx", resolve("tests/e2e/support/run-agent-task.ts"), task.id,
    ], {
      env: {
        ...process.env, NODE_ENV: "test", DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl,
        LLM_PROVIDER: "mock", LLM_API_KEY: "", AGENT_DEBUG_ENABLED: "false",
      },
      timeout: 30_000,
    });
    expect((await db.agentTask.findUniqueOrThrow({ where: { id: task.id } })).status).toBe("completed");
    expect(await db.toolCall.count({ where: { taskId: task.id, status: "completed" } })).toBe(2);
    const memo = await db.memo.findFirstOrThrow({ where: { roomId } });
    const job = await db.scheduledJob.findFirstOrThrow({ where: { roomId } });
    expect(memo).toMatchObject({ title, content });
    expect(job.payload).toMatchObject({ description });

    const save = async (path: string) => {
      const saved = page.waitForResponse((reply) => new URL(reply.url()).pathname === path && reply.request().method() === "PATCH");
      await page.getByRole("button", { name: "保存", exact: true }).click();
      expect((await saved).status()).toBe(200);
      await expect(page.getByRole("button", { name: "保存", exact: true })).toHaveCount(0);
    };
    await page.getByRole("button", { name: "编辑备忘录", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "标题 *" })).toHaveValue(title);
    await expect(page.getByRole("textbox", { name: "内容 *" })).toHaveValue(content);
    for (const name of ["标题 *", "内容 *"]) {
      const input = page.getByRole("textbox", { name });
      await input.focus();
      await input.press("ControlOrMeta+End");
      await input.press("Backspace");
      await page.keyboard.insertText("新");
    }
    await save(`/api/rooms/${roomId}/memos/${memo.id}`);
    expect(await db.memo.findUniqueOrThrow({ where: { id: memo.id } })).toMatchObject({ title: updatedTitle, content: updatedContent });

    await page.getByRole("button", { name: "编辑任务", exact: true }).click();
    const descriptionInput = page.getByRole("textbox", { name: "任务描述" });
    await expect(descriptionInput).toHaveValue(description);
    await descriptionInput.focus();
    await descriptionInput.press("End");
    await descriptionInput.press("Backspace");
    await page.keyboard.insertText("新");
    await save(`/api/rooms/${roomId}/scheduled-jobs/${job.id}`);
    const stored = await db.scheduledJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(stored.payload).toMatchObject({ description: updatedDescription, prompt: "提醒一起休息", runOnce: false });
    expect(stored.nextRunAt).toEqual(job.nextRunAt);
    expect(stored.cron).toBe(job.cron);

    await page.reload();
    await page.getByRole("button", { name: "编辑备忘录", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "标题 *" })).toHaveValue(updatedTitle);
    await expect(page.getByRole("textbox", { name: "内容 *" })).toHaveValue(updatedContent);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "编辑任务", exact: true }).click();
    await expect(descriptionInput).toHaveValue(updatedDescription);
    expect(cspViolations).toEqual([]);
  } finally {
    await page.goto("about:blank").catch(() => undefined);
    try {
      await db.room.deleteMany({ where: { id: roomId } });
    } finally {
      await db.$disconnect();
    }
  }
});

test("计划语义澄清与仍有效的旧计划在执行后和刷新后保持一致", async ({ page }) => {
  test.setTimeout(90_000);
  const databaseUrl = process.env.E2E_DATABASE_URL
    ?? (await readFile(resolve("test-results/.e2e-database-url"), "utf8")).trim();
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const roomId = `e2e-schedule-clarify-${Date.now().toString(36)}`;
  const description = "澄清前的晚间散步计划";
  let plannerServer: Server | undefined;
  let plannerCalls = 0;

  try {
    const user = await db.user.findUniqueOrThrow({ where: { email: E2E_USERS[0].email } });
    const agent = await db.agent.findUniqueOrThrow({ where: { slug: "life-assistant" } });
    await db.room.create({ data: {
      id: roomId, slug: roomId, name: "计划澄清测试房间",
      participants: { create: { userId: user.id, role: "owner" } }
    } });
    const job = await db.scheduledJob.create({ data: {
      roomId, agentId: agent.id, createdById: user.id, enabled: true,
      cron: "0 20 * * *", timezone: "Asia/Shanghai", nextRunAt: new Date("2099-09-13T12:00:00Z"),
      payload: { description, prompt: "提醒散步", runOnce: false }
    } });
    const plan = cancelOnlyPlan(job.id);
    // 仅替换进程外 LLM HTTP 边界；真实 Provider、Runtime、数据库和浏览器均参与执行。
    plannerServer = createServer((request, response) => {
      request.resume();
      plannerCalls += 1;
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
        intent: plan.intent, confidence: plan.confidence, required_tools: plan.requiredTools,
        task_steps: plan.taskSteps, final_response_plan: plan.finalResponsePlan,
        final_response_text: plan.finalResponseText, tool_inputs: plan.toolInputs
      }) } }] }));
    });
    await new Promise<void>((resolve, reject) => {
      plannerServer!.once("error", reject);
      plannerServer!.listen(0, "127.0.0.1", resolve);
    });
    const address = plannerServer.address();
    if (!address || typeof address === "string") throw new Error("测试 Planner 未绑定本地端口。");
    const task = await db.agentTask.create({ data: {
      roomId, agentId: agent.id, requestedById: user.id,
      input: { normalizedContent: scheduleClarificationPrompt, trigger: "mention" }
    } });
    await page.goto(`/chat/${roomId}`);
    await expect(page.getByText(description, { exact: true })).toBeVisible();
    const response = await page.request.post(`/api/agent/tasks/${task.id}/run`, {
      headers: { origin: new URL(page.url()).origin }
    });
    expect(response.ok(), await response.text()).toBe(true);
    await promisify(execFile)(process.execPath, [
      "--import", "tsx", resolve("tests/e2e/support/run-agent-task.ts"), task.id
    ], {
      env: {
        ...process.env, NODE_ENV: "test", DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl,
        LLM_PROVIDER: "openai-compatible", LLM_API_KEY: "isolated-test-planner",
        LLM_BASE_URL: `http://127.0.0.1:${address.port}/v1`, LLM_MODEL: "test-planner",
        AGENT_DEBUG_ENABLED: "false"
      },
      timeout: 30_000
    });
    expect(plannerCalls).toBe(2);
    const saved = await db.agentTask.findUniqueOrThrow({
      where: { id: task.id }, include: { finalMessage: true, eventLogs: true }
    });
    expect(saved.status).toBe("completed");
    expect(saved.eventLogs.some((event) => event.type === "agent.plan.validation.fallback")).toBe(true);
    expect(await db.toolCall.count({ where: { taskId: task.id } })).toBe(0);
    expect(await db.scheduledJob.findMany({ where: { roomId } })).toEqual([job]);
    const clarification = page.getByText("请再确认这次一次性任务的具体日期、时间和时区。", { exact: true });
    const assertConsistent = async () => {
      await expect(clarification).toBeVisible();
      await expect(page.getByText(/已经.*取消|已取消|帮你取消/)).toHaveCount(0);
      await expect(page.getByText(plan.finalResponseText, { exact: true })).toHaveCount(0);
      const card = page.getByText(description, { exact: true }).locator("..");
      await expect(card).toBeVisible();
      await expect(card.getByRole("button", { name: "停用任务", exact: true })).toBeEnabled();
    };
    await assertConsistent();
    await page.reload();
    await assertConsistent();
  } finally {
    await page.goto("about:blank").catch(() => undefined);
    if (plannerServer) await new Promise<void>((resolve) => plannerServer!.close(() => resolve()));
    try {
      await db.room.deleteMany({ where: { id: roomId } });
    } finally {
      await db.$disconnect();
    }
  }
});

test("shows an invalid Agent plan as failed after execution and reload", async ({ page }) => {
  test.setTimeout(90_000);
  const databaseUrl = process.env.E2E_DATABASE_URL
    ?? (await readFile(resolve("test-results/.e2e-database-url"), "utf8")).trim();
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const roomId = `e2e-plan-validation-${Date.now().toString(36)}`;
  const misleadingReply = "已经替你保存了散步备忘录，任务全部完成。";

  try {
    const user = await db.user.findUniqueOrThrow({ where: { email: E2E_USERS[0].email } });
    const agent = await db.agent.findUniqueOrThrow({ where: { slug: "life-assistant" } });
    await db.room.create({
      data: {
        id: roomId, slug: roomId, name: "计划校验测试房间",
        participants: { create: { userId: user.id, role: "owner" } }
      }
    });
    const task = await db.agentTask.create({
      data: {
        roomId, agentId: agent.id, requestedById: user.id,
        input: { normalizedContent: "帮我保存散步备忘录", trigger: "mention" },
        plan: {
          intent: "create_memo", confidence: 0.9, requiredTools: ["memo.create"],
          taskSteps: ["保存备忘录"], finalResponsePlan: "确认完成",
          finalResponseText: misleadingReply, toolInputs: { "memo.create": [] }
        }
      }
    });
    await page.goto(`/chat/${roomId}`);
    const response = await page.request.post(`/api/agent/tasks/${task.id}/run`, {
      headers: { origin: new URL(page.url()).origin }
    });
    expect(response.ok(), await response.text()).toBe(true);
    // E2E Web 关闭 inline 且不启动常驻 Worker；独立进程只消费本例的隔离任务。
    await promisify(execFile)(process.execPath, [
      "--import", "tsx", resolve("tests/e2e/support/run-agent-task.ts"), task.id
    ], {
      env: {
        ...process.env, NODE_ENV: "test", DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl,
        LLM_PROVIDER: "mock", LLM_API_KEY: "", AGENT_DEBUG_ENABLED: "false"
      },
      timeout: 30_000
    });
    const failure = page.getByText("我无法确认这次任务的操作和参数，任务未完成。请把要做的事说得更具体一些后重试。", { exact: true });
    await expect(failure).toBeVisible();
    await expect(page.getByText(/执行失败/, { exact: false })).toBeVisible();
    await expect(page.getByText(misleadingReply, { exact: true })).toHaveCount(0);
    await page.reload();
    await expect(failure).toBeVisible();
    await expect(page.getByText(/执行失败/, { exact: false })).toBeVisible();
    await expect(page.getByText(misleadingReply, { exact: true })).toHaveCount(0);
    const saved = await db.agentTask.findUniqueOrThrow({ where: { id: task.id }, include: { finalMessage: true } });
    expect(saved.status).toBe("failed");
    expect(saved.finalMessage?.status).toBe("failed");
    expect(saved.error).toContain("empty_tool_calls");
    expect(await db.toolCall.count({ where: { taskId: task.id } })).toBe(0);
    expect(await db.memo.count({ where: { roomId } })).toBe(0);
    const trace = await page.request.get(`/api/agent/tasks/${task.id}/trace`);
    expect(trace.ok()).toBe(true);
    expect(JSON.stringify(await trace.json())).toContain("agent.plan.validation.failed");
  } finally {
    await page.goto("/home");
    await db.room.deleteMany({ where: { id: roomId } });
    await db.$disconnect();
  }
});

test("retries Home photo edits and deletions without false success after failures", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  const databaseUrl = process.env.E2E_DATABASE_URL
    ?? (await readFile(resolve("test-results/.e2e-database-url"), "utf8")).trim();
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const suffix = Date.now().toString(36);
  const photoIds = [1, 2, 3].map((id) => `e2e-home-retry-${suffix}-${id}`);
  const photoId = photoIds[0];
  const caption = `保存重试照片 ${suffix}`;
  const editedCaption = `保存后的标注 ${suffix}`;
  const photoUrl = `/api/home-board/elements/${photoId}`;
  const photoCard = () => page.locator("[data-home-photo]").filter({ has: page.getByRole("img", { name: caption, exact: true }) });

  try {
    const user = await db.user.findUniqueOrThrow({ where: { email: E2E_USERS[0].email } });
    await db.atlasBoard.upsert({ where: { id: "home-board" }, update: {}, create: { id: "home-board" } });
    await db.atlasElement.createMany({
      data: photoIds.map((id, index) => ({
        id, boardId: "home-board", type: "photo" as const,
        x: 24, y: 80 + index * 290, width: 240, height: 180,
        caption: index === 0 ? caption : `${caption} 伙伴 ${index}`,
        imageUrl: "/brand/logo_white.svg", createdById: user.id,
      })),
    });
    await db.atlasConnection.createMany({
      data: photoIds.slice(1).map((toId, index) => ({
        id: `e2e-home-retry-connection-${suffix}-${index}`, boardId: "home-board", fromId: photoId, toId,
      })),
    });
    await page.goto("/home");
    await expect(page.getByRole("img", { name: caption, exact: true })).toBeVisible();
    // 等入场动画实际结束后再取手柄坐标，避免鼠标落在移动前的旧位置。
    await page.waitForFunction(() => [...document.querySelectorAll(".page-enter")].every(node => node.getAnimations().every(animation => animation.playState === "finished")));

    await page.route(`**${photoUrl}`, (route) => route.fulfill({ status: 500, json: { error: "test failure" } }), { times: 1 });
    const resize = photoCard().getByRole("button", { name: /调整照片大小/ });
    await photoCard().hover({ position: { x: 20, y: 20 } });
    const handle = await resize.boundingBox();
    if (!handle) throw new Error("照片缩放控件没有可操作的位置");
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2 + 40, handle.y + handle.height / 2);
    await page.mouse.up();
    await expect(page.getByRole("alert").filter({ hasText: "失败" })).toHaveText("照片大小保存失败。");
    expect(await db.atlasElement.findUniqueOrThrow({ where: { id: photoId } })).toMatchObject({ width: 240, height: 180 });
    await expect(photoCard()).toHaveCSS("width", "280px");
    const resized = page.waitForResponse((response) => response.url().endsWith(photoUrl) && response.request().method() === "PATCH" && response.ok());
    await page.getByRole("button", { name: "重试保存照片大小" }).press("Enter");
    await resized;
    await expect(page.getByRole("alert").filter({ hasText: "失败" })).toHaveCount(0);
    await page.reload();
    await expect(photoCard()).toHaveCSS("width", "280px");
    expect(await db.atlasElement.findUniqueOrThrow({ where: { id: photoId } })).toMatchObject({ width: 280, height: 210 });

    await page.route(`**${photoUrl}`, (route) => route.abort("connectionreset"), { times: 1 });
    await page.getByRole("button", { name: caption, exact: true }).press("Enter");
    await page.getByLabel("照片标注", { exact: true }).fill(`  ${editedCaption}  `);
    await page.getByLabel("照片标注", { exact: true }).press("Enter");
    await expect(page.getByRole("alert").filter({ hasText: "失败" })).toHaveText("照片标注保存失败。");
    expect(await db.atlasElement.findUniqueOrThrow({ where: { id: photoId } })).toMatchObject({ caption });
    await expect(page.getByRole("img", { name: editedCaption, exact: true })).toBeVisible();
    const captionSaved = page.waitForResponse((response) => response.url().endsWith(photoUrl) && response.request().method() === "PATCH" && response.ok());
    await page.getByRole("button", { name: "重试保存照片标注" }).press("Enter");
    await captionSaved;
    await expect(page.getByRole("alert").filter({ hasText: "失败" })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("img", { name: editedCaption, exact: true })).toBeVisible();
    expect(await db.atlasElement.findUniqueOrThrow({ where: { id: photoId } })).toMatchObject({ caption: editedCaption, width: 280, height: 210 });

    let deletedConnectionId: string | null = null;
    await page.route("**/api/home-board/connections?*", (route) => {
      deletedConnectionId = new URL(route.request().url()).searchParams.get("id");
      return route.fulfill({ status: 500, json: { error: "test failure" } });
    }, { times: 1 });
    await page.getByRole("button", { name: /^删除连线 / }).first().press("Enter");
    await expect(page.getByRole("alert").filter({ hasText: "失败" })).toHaveText("连线删除失败。");
    expect(await db.atlasConnection.count({ where: { fromId: photoId } })).toBe(2);
    await expect(page.getByRole("button", { name: /^删除连线 / })).toHaveCount(2);
    const connectionDeleted = page.waitForResponse((response) => response.url().includes("/api/home-board/connections?") && response.request().method() === "DELETE" && response.ok());
    await page.getByRole("button", { name: "重试删除连线" }).press("Enter");
    await connectionDeleted;
    await expect(page.getByRole("alert").filter({ hasText: "失败" })).toHaveCount(0);
    expect(deletedConnectionId).not.toBeNull();
    expect(await db.atlasConnection.count({ where: { id: deletedConnectionId! } })).toBe(0);
    await page.reload();
    await expect(page.getByRole("button", { name: /^删除连线 / })).toHaveCount(1);

    await page.route(`**${photoUrl}`, (route) => route.abort("connectionreset"), { times: 1 });
    await page.getByRole("button", { name: `删除照片：${editedCaption}`, exact: true }).press("Enter");
    await expect(page.getByRole("alert").filter({ hasText: "失败" })).toHaveText("照片删除失败。");
    await expect(page.getByRole("img", { name: editedCaption, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /^删除连线 / })).toHaveCount(1);
    expect(await db.atlasElement.count({ where: { id: photoId } })).toBe(1);
    expect(await db.atlasConnection.count({ where: { fromId: photoId } })).toBe(1);
    const photoDeleted = page.waitForResponse((response) => response.url().endsWith(photoUrl) && response.request().method() === "DELETE" && response.ok());
    await page.getByRole("button", { name: "重试删除照片" }).press("Enter");
    await photoDeleted;
    await expect(page.getByRole("img", { name: editedCaption, exact: true })).toHaveCount(0);
    await expect(page.getByRole("alert").filter({ hasText: "失败" })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("img", { name: editedCaption, exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^删除连线 / })).toHaveCount(0);
    expect(await db.atlasElement.count({ where: { id: { in: photoIds } } })).toBe(2);
    expect(await db.atlasConnection.count({ where: { fromId: photoId } })).toBe(0);
  } finally {
    await db.atlasElement.deleteMany({ where: { id: { in: photoIds } } });
    await db.$disconnect();
  }
});

test("opens the Home add-photo menu beside the right-clicked point", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/home");
  const board = page.locator(".home-spatial-board");
  const boardBox = await board.boundingBox();
  if (!boardBox) throw new Error("首页画布不可见");

  const point = { x: boardBox.x + 24, y: boardBox.y + 180 };
  await page.mouse.click(point.x, point.y, { button: "right" });
  const menu = page.locator("[data-home-context-menu]");
  await expect(menu.getByRole("button", { name: "添加图片" })).toBeVisible();
  const menuBox = await menu.boundingBox();
  if (!menuBox) throw new Error("添加图片菜单不可见");
  expect(Math.abs(menuBox.x - point.x)).toBeLessThanOrEqual(4);
  expect(Math.abs(menuBox.y - point.y)).toBeLessThanOrEqual(4);

  await page.evaluate(() => { document.body.style.minHeight = "1600px"; });
  await page.evaluate(() => window.scrollTo(0, 200));
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  const scrolledPoint = { x: 24, y: 200 };
  await page.mouse.click(scrolledPoint.x, scrolledPoint.y, { button: "right" });
  const scrolledMenuBox = await menu.boundingBox();
  if (!scrolledMenuBox) throw new Error("滚动后的添加图片菜单不可见");
  expect(Math.abs(scrolledMenuBox.x - scrolledPoint.x)).toBeLessThanOrEqual(4);
  expect(Math.abs(scrolledMenuBox.y - scrolledPoint.y)).toBeLessThanOrEqual(4);

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.mouse.click(1260, 760, { button: "right" });
  const edgeMenuBox = await menu.boundingBox();
  if (!edgeMenuBox) throw new Error("视口边缘的添加图片菜单不可见");
  expect(edgeMenuBox.x).toBeGreaterThanOrEqual(0);
  expect(edgeMenuBox.y).toBeGreaterThanOrEqual(0);
  expect(edgeMenuBox.x + edgeMenuBox.width).toBeLessThanOrEqual(1280);
  expect(edgeMenuBox.y + edgeMenuBox.height).toBeLessThanOrEqual(800);

  await menu.getByRole("button", { name: "添加图片" }).press("Escape");
  await expect(menu).toHaveCount(0);

  let uploadedId: string | null = null;
  try {
    const uploadBoardBox = await board.boundingBox();
    if (!uploadBoardBox) throw new Error("上传前首页画布不可见");
    await page.mouse.click(point.x, point.y, { button: "right" });
    await menu.getByRole("button", { name: "添加图片" }).press("Enter");
    await expect(page.getByRole("heading", { name: "添加图片" })).toBeVisible();
    const caption = `菜单定位上传 ${Date.now().toString(36)}`;
    await page.locator('input[type="file"]').setInputFiles({
      name: "position.png", mimeType: "image/png", buffer: MINIMAL_PNG,
    });
    await page.getByPlaceholder("给图片添加一行标注…").fill(caption);
    const upload = page.waitForResponse((response) => response.url().endsWith("/api/home-board/uploads") && response.request().method() === "POST");
    await page.getByRole("button", { name: "上传", exact: true }).click();
    const response = await upload;
    expect(response.status()).toBe(201);
    const payload = await response.json() as { element: { id: string; x: number; y: number } };
    uploadedId = payload.element.id;
    expect(Math.abs(payload.element.x - (point.x - uploadBoardBox.x))).toBeLessThanOrEqual(2);
    expect(Math.abs(payload.element.y - (point.y - uploadBoardBox.y))).toBeLessThanOrEqual(2);
    await expect(page.getByRole("img", { name: caption, exact: true })).toBeVisible();
  } finally {
    if (uploadedId) {
      const cleanup = await page.request.delete(`/api/home-board/elements/${uploadedId}`, {
        headers: { origin: new URL(page.url()).origin },
      });
      expect(cleanup.status()).toBe(200);
    }
  }
});

test("rotates a Home photo smoothly with a handle, keyboard and touch, and persists the final angle", async ({ page, browser }, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  const databaseUrl = process.env.E2E_DATABASE_URL
    ?? (await readFile(resolve("test-results/.e2e-database-url"), "utf8")).trim();
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const photoId = `e2e-home-rotation-${Date.now().toString(36)}`;
  const caption = "旋转验收照片";
  const photoUrl = `/api/home-board/elements/${photoId}`;
  const visualRotation = (photo: Locator) => photo.evaluate((element) => {
    const values = getComputedStyle(element).transform.match(/matrix\(([^)]+)\)/)?.[1].split(",").map(Number);
    if (!values) throw new Error("照片缺少可见旋转变换");
    return Math.atan2(values[1], values[0]) * 180 / Math.PI;
  });
  const gesturePoints = async (handle: Locator) => {
    // 入场动画在 hydration 后的 rAF 才启动，先等动画挂载并结束，再读取手势中心。
    await handle.page().locator(".page-enter").evaluate(async (element) => {
      await Promise.all(element.getAnimations().map((animation) => animation.finished));
    });
    await handle.scrollIntoViewIfNeeded();
    const { photoBox, handleBox } = await handle.evaluate((button) => {
      const photo = button.closest("[data-home-photo]");
      if (!photo) throw new Error("旋转手柄没有对应照片");
      return { photoBox: photo.getBoundingClientRect().toJSON(), handleBox: button.getBoundingClientRect().toJSON() };
    });
    const center = { x: photoBox.x + photoBox.width / 2, y: photoBox.y + photoBox.height / 2 };
    const start = { x: handleBox.x + handleBox.width / 2, y: handleBox.y + handleBox.height / 2 };
    const radius = Math.hypot(start.x - center.x, start.y - center.y);
    const angle = Math.atan2(start.y - center.y, start.x - center.x);
    return (delta: number) => ({
      x: center.x + radius * Math.cos(angle + delta * Math.PI / 180),
      y: center.y + radius * Math.sin(angle + delta * Math.PI / 180),
    });
  };

  try {
    const user = await db.user.findUniqueOrThrow({ where: { email: E2E_USERS[0].email } });
    await db.atlasBoard.upsert({ where: { id: "home-board" }, update: {}, create: { id: "home-board" } });
    await db.atlasElement.create({ data: {
      id: photoId, boardId: "home-board", type: "photo",
      x: 50, y: 400, width: 240, height: 180, rotation: 0,
      caption, imageUrl: "/brand/logo_white.svg", createdById: user.id,
    } });
    await page.goto("/home");
    const photo = page.locator("[data-home-photo]").filter({ has: page.getByRole("img", { name: caption, exact: true }) });
    const handle = photo.getByRole("button", { name: `旋转照片：${caption}` });
    await photo.hover();
    await expect(handle).toHaveCSS("opacity", "1");
    await expect(photo.getByRole("slider")).toHaveCount(0);
    const writes: unknown[] = [];
    page.on("request", (request) => {
      if (request.url().endsWith(photoUrl) && request.method() === "PATCH") writes.push(request.postDataJSON());
    });
    const saveAfter = async (action: () => Promise<unknown>) => {
      const response = page.waitForResponse((item) => item.url().endsWith(photoUrl) && item.request().method() === "PATCH" && item.ok());
      await action();
      await response;
    };

    // 每一度都检查呈现，持续拖动进入边界再反向，不能靠单击滑杆通过。
    const at = await gesturePoints(handle);
    await page.mouse.move(at(0).x, at(0).y);
    await page.mouse.down();
    await expect.poll(() => visualRotation(photo)).toBeCloseTo(0, 0);
    for (let delta = 1; delta <= 30; delta += 1) {
      await page.mouse.move(at(delta).x, at(delta).y);
      if (delta >= 2) await expect.poll(() => visualRotation(photo)).toBeCloseTo(Math.min(delta, 25), 0);
    }
    for (let delta = 29; delta >= 25; delta -= 1) {
      await page.mouse.move(at(delta).x, at(delta).y);
      await expect.poll(() => visualRotation(photo)).toBeCloseTo(delta - 5, 0);
    }
    expect(writes).toEqual([]);
    await saveAfter(() => page.mouse.up());
    expect(writes).toEqual([{ rotation: 20 }]);
    expect(await db.atlasElement.findUniqueOrThrow({ where: { id: photoId } }))
      .toMatchObject({ rotation: 20, x: 50, y: 400, width: 240, height: 180 });
    await page.screenshot({ path: testInfo.outputPath("rotation-handle-desktop.png") });

    await saveAfter(() => handle.press("ArrowRight"));
    await expect.poll(() => visualRotation(photo)).toBeCloseTo(21, 0);
    await saveAfter(() => handle.press("Shift+ArrowRight"));
    await expect.poll(() => visualRotation(photo)).toBeCloseTo(25, 0);
    await saveAfter(() => handle.press("Home"));
    await expect.poll(() => visualRotation(photo)).toBeCloseTo(0, 0);

    await handle.click();
    const angleInput = page.getByRole("spinbutton", { name: "照片旋转角度" });
    await angleInput.fill("26");
    await angleInput.press("Enter");
    expect(await angleInput.evaluate((input: HTMLInputElement) => input.validity.rangeOverflow)).toBe(true);
    await expect.poll(() => visualRotation(photo)).toBeCloseTo(0, 0);
    await angleInput.fill("-25");
    await saveAfter(() => angleInput.press("Enter"));
    await page.reload();
    await expect.poll(() => visualRotation(photo)).toBeCloseTo(-25, 0);
    await page.goto("/about");
    await page.goto("/home");
    await expect.poll(() => visualRotation(photo)).toBeCloseTo(-25, 0);

    // 在非零初始角度和真实滚动位置下拖动；Escape 恢复原角度，不提交取消的手势。
    await page.evaluate(() => { document.body.style.minHeight = "1600px"; window.scrollTo(0, 120); });
    await photo.hover();
    const cancelAt = await gesturePoints(handle);
    const beforeCancel = writes.length;
    await page.mouse.move(cancelAt(0).x, cancelAt(0).y);
    await page.mouse.down();
    await page.mouse.move(cancelAt(15).x, cancelAt(15).y, { steps: 10 });
    await expect.poll(() => visualRotation(photo)).toBeCloseTo(-10, 0);
    await handle.press("Escape");
    await page.mouse.up();
    await expect.poll(() => visualRotation(photo)).toBeCloseTo(-25, 0);
    expect(writes).toHaveLength(beforeCancel);

    // 倾斜后的缩放沿照片自身横轴计算，不能继续把屏幕 dx 当作宽度变化。
    const resize = photo.getByRole("button", { name: `调整照片大小：${caption}` });
    const resizeBox = await resize.boundingBox();
    if (!resizeBox) throw new Error("缩放手柄不可见");
    const resizeStart = { x: resizeBox.x + resizeBox.width / 2, y: resizeBox.y + resizeBox.height / 2 };
    await page.mouse.move(resizeStart.x, resizeStart.y);
    await page.mouse.down();
    await page.mouse.move(resizeStart.x + 40 * Math.cos(-25 * Math.PI / 180), resizeStart.y + 40 * Math.sin(-25 * Math.PI / 180), { steps: 5 });
    await saveAfter(() => page.mouse.up());
    const resized = await db.atlasElement.findUniqueOrThrow({ where: { id: photoId } });
    expect(resized.width).toBeCloseTo(280, 1);
    expect(resized.rotation).toBe(-25);

    const reset = await page.request.patch(photoUrl, {
      headers: { origin: new URL(page.url()).origin },
      data: { rotation: 0, width: 240, height: 180 },
    });
    expect(reset.status()).toBe(200);
    const touchContext = await browser.newContext({
      hasTouch: true, viewport: { width: 390, height: 844 }, storageState: "test-results/.auth/user-one.json",
    });
    try {
      const touchPage = await touchContext.newPage();
      await touchPage.goto(new URL("/home", page.url()).href);
      const touchPhoto = touchPage.locator("[data-home-photo]").filter({ has: touchPage.getByRole("img", { name: caption, exact: true }) });
      const touchHandle = touchPhoto.getByRole("button", { name: `旋转照片：${caption}` });
      await expect(touchHandle).toHaveCSS("opacity", "1");
      const touchAt = await gesturePoints(touchHandle);
      const cdp = await touchContext.newCDPSession(touchPage);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...touchAt(0), id: 1 }] });
      for (let delta = -2; delta >= -20; delta -= 2) {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...touchAt(delta), id: 1 }] });
        await expect.poll(() => visualRotation(touchPhoto)).toBeCloseTo(delta, 0);
      }
      const touchSave = touchPage.waitForResponse((response) => response.url().endsWith(photoUrl) && response.request().method() === "PATCH" && response.ok());
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await touchSave;
      expect(await db.atlasElement.findUniqueOrThrow({ where: { id: photoId } }))
        .toMatchObject({ rotation: -20, x: 50, y: 400, width: 240, height: 180 });
      await touchPage.screenshot({ path: testInfo.outputPath("rotation-handle-touch.png") });
      const touchCancelAt = await gesturePoints(touchHandle);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...touchCancelAt(0), id: 1 }] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...touchCancelAt(10), id: 1 }] });
      await expect.poll(() => visualRotation(touchPhoto)).toBeCloseTo(-10, 0);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
      await expect.poll(() => visualRotation(touchPhoto)).toBeCloseTo(-20, 0);
      expect((await db.atlasElement.findUniqueOrThrow({ where: { id: photoId } })).rotation).toBe(-20);
    } finally {
      await touchContext.close();
    }
  } finally {
    await db.atlasElement.deleteMany({ where: { id: photoId } });
    await db.$disconnect();
  }
});

test("renders the authenticated home navigation", async ({ page }) => {
  await page.goto("/home");

  const brandLink = page.getByRole("link", { name: "XOXO Meridian" });
  await expect(brandLink.locator("img")).toHaveAttribute(
    "src",
    "/brand/logo_transparent.svg",
  );
  await expect(brandLink.locator("img").locator("..")).toHaveCSS(
    "background-color",
    "rgb(125, 168, 120)",
  );
  await expect(page.getByRole("link", { name: "Blog" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Chat" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Study" })).toBeVisible();
  await expect(page.getByRole("link", { name: E2E_USERS[0].displayName })).toBeVisible();
});

test("首页刷新、站内返回与搜索均排除新旧 Agent 日志，独立日志详情仍可读取", async ({ page }) => {
  const databaseUrl = process.env.E2E_DATABASE_URL
    ?? (await readFile(resolve("test-results/.e2e-database-url"), "utf8")).trim();
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const prefix = `e2e-agent-hidden-${Date.now().toString(36)}`;
  const roomId = `${prefix}-room`;
  const names = ["article-owner", "article-partner", "log-owner-new", "log-owner-old", "log-partner", "log-scheduled", "log-missing", "log-orphan", "article-unmatched"];
  const postIds = names.map(name => `${prefix}-${name}`);
  const titles = [`${prefix} 我的文章 weather.get agent.log`, `${prefix} 伙伴文章`];
  const payload = `${prefix} 隐藏工具载荷`;

  try {
    const [owner, partner, agent] = await Promise.all([
      db.user.findUniqueOrThrow({ where: { email: E2E_USERS[0].email } }),
      db.user.findUniqueOrThrow({ where: { email: E2E_USERS[1].email } }),
      db.agent.findUniqueOrThrow({ where: { slug: "life-assistant" } }),
    ]);
    await db.room.create({ data: {
      id: roomId, slug: roomId, name: "首页日志隐藏回归",
      participants: { create: [{ userId: owner.id }, { userId: partner.id }] },
    } });
    const createTask = (requestedById: string | null) => db.agentTask.create({ data: {
      roomId, agentId: agent.id, requestedById, status: "completed", input: {},
    } });
    const [ownerNew, ownerOld, partnerTask, scheduledTask] = await Promise.all([
      createTask(owner.id), createTask(owner.id), createTask(partner.id), createTask(null),
    ]);
    const baseTime = Date.UTC(2098, 8, 23);
    const taskLinks = [
      { agentTaskId: ownerNew.id, metadata: { taskId: ownerNew.id } },
      { metadata: { taskId: ownerOld.id } },
      { agentTaskId: partnerTask.id, metadata: { taskId: partnerTask.id } },
      { agentTaskId: scheduledTask.id, metadata: { taskId: scheduledTask.id } },
      { metadata: { taskId: "deleted-task" } },
      { metadata: { taskId: "orphan-task" } },
    ];
    await db.post.createMany({ data: [
      { id: postIds[0], slug: postIds[0], title: titles[0], content: "普通文章仍可阅读与编辑", type: "user_post", authorId: owner.id, publishedAt: new Date(baseTime) },
      { id: postIds[1], slug: postIds[1], title: titles[1], content: "伙伴的普通文章", type: "user_post", authorId: partner.id, publishedAt: new Date(baseTime + 1_000) },
      ...taskLinks.map((link, i) => ({ id: postIds[i + 2], slug: postIds[i + 2], title: `${prefix} ${names[i + 2]}`, content: payload, type: "agent_log" as const, roomId: i === 5 ? null : roomId, ...link, publishedAt: new Date(baseTime + (i + 2) * 1_000) })),
      { id: postIds[8], slug: postIds[8], title: "搜索前附加文章", content: "搜索结果应排除这张卡片", type: "user_post", authorId: owner.id, publishedAt: new Date(baseTime + 8_000) },
    ] });
    const logsBefore = await db.post.findMany({ where: { id: { in: postIds.slice(2, 8) } }, orderBy: { id: "asc" } });
    const assertNoLogs = async () => {
      for (const id of postIds.slice(2, 8)) {
        await expect(page.getByRole("heading", { name: `${prefix} ${names[postIds.indexOf(id)]}`, exact: true })).toHaveCount(0);
        await expect(page.locator(`a[href="/posts/${id}"]`)).toHaveCount(0);
      }
      await expect(page.getByRole("main").getByText(payload, { exact: true })).toHaveCount(0);
    };
    await page.goto("/home");
    for (const title of titles) await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    const centers = await Promise.all(titles.map(async title => {
      const box = await page.getByRole("article").filter({ has: page.getByRole("heading", { name: title, exact: true }) }).boundingBox();
      expect(box).not.toBeNull();
      return box!.x + box!.width / 2;
    }));
    expect(centers[0]).toBeLessThan(page.viewportSize()!.width / 2);
    expect(centers[1]).toBeGreaterThan(page.viewportSize()!.width / 2);
    await expect(page.getByRole("heading", { name: "搜索前附加文章", exact: true })).toBeVisible();
    await assertNoLogs();
    await page.reload();
    await expect(page.getByRole("heading", { name: titles[0], exact: true })).toBeVisible();
    await assertNoLogs();
    const articleLink = page.getByRole("link", { name: titles[0], exact: true });
    await articleLink.focus();
    await articleLink.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/posts/${postIds[0]}$`));
    await expect(page.getByRole("heading", { level: 1, name: titles[0] })).toBeVisible();
    await page.getByRole("link", { name: "Back to Blog", exact: true }).click();
    await expect(page).toHaveURL(/\/home$/);
    await expect(page.getByRole("heading", { name: titles[0], exact: true })).toBeVisible();
    await assertNoLogs();

    const search = async (query: string) => {
      const received = page.waitForResponse(response => {
        const url = new URL(response.url());
        return url.pathname === "/api/blog/feed" && url.searchParams.get("q") === query;
      });
      await page.getByRole("textbox", { name: "Search posts", exact: true }).fill(query);
      const response = await received;
      expect(response.status()).toBe(200);
      return response.json();
    };
    const results = await search(prefix);
    expect(results.entries.map(({ post }: { post: { id: string } }) => post.id).sort()).toEqual(postIds.slice(0, 2).sort());
    await expect(page.getByRole("heading", { name: "搜索前附加文章", exact: true })).toHaveCount(0);
    await expect(page.getByRole("main").getByRole("article")).toHaveCount(2);
    await assertNoLogs();
    expect(await search(payload)).toEqual({ entries: [], nextCursor: null });
    await expect(page.getByText("No posts match your search.", { exact: true })).toBeVisible();
    await expect(page.getByRole("main").getByRole("article")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "加载更早的作品", exact: true })).toHaveCount(0);
    await expect(page.getByText(/wait for the agent/i)).toHaveCount(0);
    await assertNoLogs();

    // 首页呈现不改变独立日志读取和详情权限。
    const logsResponse = await page.request.get(`/api/posts?type=agent_log&q=${encodeURIComponent(prefix)}`);
    expect(logsResponse.status()).toBe(200);
    expect((await logsResponse.json()).posts.map((post: { id: string }) => post.id).sort()).toEqual(postIds.slice(2, 7).sort());
    await page.goto(`/posts/${postIds[2]}`);
    await expect(page.getByRole("heading", { level: 1, name: `${prefix} log-owner-new`, exact: true })).toBeVisible();
    await expect(page.getByText(payload, { exact: true })).toBeVisible();
    expect(await db.post.findMany({ where: { id: { in: postIds.slice(2, 8) } }, orderBy: { id: "asc" } })).toEqual(logsBefore);
  } finally {
    await page.goto("about:blank").catch(() => undefined);
    try {
      await db.post.deleteMany({ where: { id: { in: postIds } } });
      await db.agentTask.deleteMany({ where: { roomId } });
      await db.room.deleteMany({ where: { id: roomId } });
    } finally {
      await db.$disconnect();
    }
  }
});

test("首页与搜索加载更多跳过大量穿插日志，普通文章无漏无重并可键盘阅读", async ({ page }) => {
  const databaseUrl = process.env.E2E_DATABASE_URL
    ?? (await readFile(resolve("test-results/.e2e-database-url"), "utf8")).trim();
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const prefix = `e2e-feed-pages-${Date.now().toString(36)}`;
  const roomId = `${prefix}-room`;
  const articleIds = Array.from({ length: 56 }, (_, i) => `${prefix}-article-${i}`);
  const logIds = Array.from({ length: 180 }, (_, i) => `${prefix}-log-${i}`);
  try {
    const owner = await db.user.findUniqueOrThrow({ where: { email: E2E_USERS[0].email } });
    await db.room.create({ data: { id: roomId, slug: roomId, name: "首页日志分页回归", participants: { create: { userId: owner.id } } } });
    const at = Date.UTC(2099, 0, 1);
    await db.post.createMany({ data: [
      ...articleIds.map((id, i) => ({ id, slug: id, title: `${prefix} 文章 ${i}`, content: "普通分页内容 weather.get agent.log", type: "user_post" as const, authorId: owner.id, publishedAt: new Date(at + i * 1_000) })),
      ...logIds.map((id, i) => ({ id, slug: id, title: `${prefix} 日志 ${i}`, content: "隐藏分页载荷", type: "agent_log" as const, roomId, metadata: { taskId: `lost-${i}` }, publishedAt: new Date(at + (i - 60) * 500) })),
    ] });
    const articleLinks = page.locator(`main h2 a[href^="/posts/${prefix}-article-"]`);
    const assertArticles = async (ids: string[]) => {
      await expect(articleLinks).toHaveCount(ids.length);
      expect((await articleLinks.evaluateAll(nodes => nodes.map(node => node.getAttribute("href")!.split("/").at(-1)))).sort()).toEqual([...ids].sort());
      await expect(page.locator(`main a[href^="/posts/${prefix}-log-"]`)).toHaveCount(0);
      await expect(page.getByRole("main").getByText("隐藏分页载荷", { exact: true })).toHaveCount(0);
    };
    const loadMore = async (query: string) => {
      const reply = page.waitForResponse(response => {
        const url = new URL(response.url());
        return url.pathname === "/api/blog/feed" && url.searchParams.get("q") === query && url.searchParams.has("cursor");
      });
      await page.getByRole("button", { name: "加载更早的作品", exact: true }).click();
      const response = await reply;
      expect(response.status()).toBe(200);
      const data = await response.json();
      expect(data.entries.every((entry: { kind: string; post?: { type: string } }) => entry.kind !== "post" || entry.post?.type === "user_post")).toBe(true);
      return data;
    };
    await page.goto("/home");
    await assertArticles(articleIds.slice(6));
    await loadMore("");
    await assertArticles(articleIds);
    const firstSearch = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === "/api/blog/feed" && url.searchParams.get("q") === prefix && !url.searchParams.has("cursor");
    });
    await page.getByRole("textbox", { name: "Search posts", exact: true }).fill(prefix);
    expect((await firstSearch).status()).toBe(200);
    await assertArticles(articleIds.slice(6));
    const lastPage = await loadMore(prefix);
    expect(lastPage.entries.map((entry: { post: { id: string } }) => entry.post.id).sort()).toEqual(articleIds.slice(0, 6).sort());
    expect(lastPage.nextCursor).toBeNull();
    await assertArticles(articleIds);
    await expect(page.getByRole("button", { name: "加载更早的作品", exact: true })).toHaveCount(0);
    const earlierArticle = page.getByRole("link", { name: `${prefix} 文章 0`, exact: true });
    await earlierArticle.focus();
    await earlierArticle.press("Enter");
    await expect(page.getByRole("heading", { level: 1, name: `${prefix} 文章 0`, exact: true })).toBeVisible();
    expect(await db.post.count({ where: { id: { in: logIds } } })).toBe(180);
  } finally {
    await page.goto("about:blank").catch(() => undefined);
    try {
      await db.post.deleteMany({ where: { id: { in: [...articleIds, ...logIds] } } });
      await db.room.deleteMany({ where: { id: roomId } });
    } finally {
      await db.$disconnect();
    }
  }
});

test("keeps the Home felt surface covering content appended after the page element", async ({ page }) => {
  await page.goto("/home");
  await expect(page.locator(".home-linen-page")).toBeVisible();

  // root layout 在 {children} 之后渲染 Agent 入口的留白占位，页面元素的盒子因此总是短于
  // 文档；该留白依赖 WebGL 模型加载，这里用同形状的尾部内容稳定复现这个结构。
  await page.evaluate(() => {
    const tail = document.createElement("div");
    tail.setAttribute("data-e2e-document-tail", "");
    tail.style.height = "232px";
    document.body.appendChild(tail);
  });
  const scrollToDocumentEnd = () =>
    page.evaluate(async () => {
      window.scrollTo(0, document.documentElement.scrollHeight);
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
      window.scrollTo(0, document.documentElement.scrollHeight);
    });
  await scrollToDocumentEnd();
  // 留白可能在上一次滚动之后才出现，滚到新的文档末尾再取一次。
  await scrollToDocumentEnd();

  // 文档最后一个像素行必须仍落在承载毡板纹理的表面上，且该表面覆盖整个文档；
  // 纹理挂在页面元素上时，末尾留白由 body 的纯色填充，这里取不到纹理表面。
  const coverage = await page.evaluate(() => {
    let surface = document.elementFromPoint(Math.round(window.innerWidth / 2), window.innerHeight - 1);
    while (surface && getComputedStyle(surface).backgroundImage === "none") {
      surface = surface.parentElement;
    }
    const rect = surface?.getBoundingClientRect() ?? null;
    return {
      scrollHeight: document.documentElement.scrollHeight,
      backgroundImage: surface ? getComputedStyle(surface).backgroundImage : null,
      top: rect ? rect.top + window.scrollY : null,
      bottom: rect ? rect.bottom + window.scrollY : null,
    };
  });

  expect(coverage.backgroundImage).toContain("repeating-linear-gradient");
  expect(coverage.top).toBe(0);
  expect(coverage.bottom).toBeGreaterThanOrEqual(coverage.scrollHeight);
});

test("scopes the Home felt surface to the Home document", async ({ page }) => {
  // 毡板纹理挂在文档表面（body:has(.home-linen-page)）而非页面元素上，作用域由页面
  // 元素上的类名决定；这里固定它只跟随 /home，别的路由的文档表面保持纯色。
  const response = await page.goto("/study");
  expect(response?.status()).toBe(200);
  // 未认证时守卫会因重定向到登录页而「空过」：登录页同样没有毡板类名、body 同样没有背景图。
  // 这里固定测试确实停在 /study。
  await expect(page).toHaveURL(/\/study$/);
  await expect(page.locator(".home-linen-page")).toHaveCount(0);

  const surface = await page.evaluate(() => {
    const style = getComputedStyle(document.body);
    return { backgroundImage: style.backgroundImage, backgroundColor: style.backgroundColor };
  });
  expect(surface.backgroundImage).toBe("none");
  expect(surface.backgroundColor).toBe("rgb(243, 247, 240)");
});

test("keeps room-scoped Home anchors out of non-member payloads and mutations", async ({
  baseURL,
  page,
}) => {
  if (!baseURL) {
    throw new Error("Playwright baseURL is required for Home board authorization");
  }
  const databaseUrl = process.env.E2E_DATABASE_URL
    ?? (await readFile(resolve("test-results/.e2e-database-url"), "utf8")).trim();
  const e2ePrisma = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });
  const suffix = Date.now().toString(36);
  const privateRoomId = `e2e-home-private-room-${suffix}`;
  const hiddenPostId = `e2e-home-hidden-post-${suffix}`;
  const globalPostId = `e2e-home-global-post-${suffix}`;
  const hiddenAnchorId = `e2e-home-hidden-anchor-${suffix}`;
  const globalAnchorId = `e2e-home-global-anchor-${suffix}`;
  const photoOneId = `e2e-home-photo-one-${suffix}`;
  const photoTwoId = `e2e-home-photo-two-${suffix}`;
  const hiddenConnectionId = `e2e-home-hidden-connection-${suffix}`;
  const visibleConnectionId = `e2e-home-visible-connection-${suffix}`;

  try {
    const users = await e2ePrisma.user.findMany({
      where: { email: { in: E2E_USERS.map((user) => user.email) } },
      select: { id: true, email: true },
    });
    const userByEmail = new Map(users.map((user) => [user.email, user]));
    const currentUser = userByEmail.get(E2E_USERS[0].email);
    const otherUser = userByEmail.get(E2E_USERS[1].email);
    expect(currentUser).toBeDefined();
    expect(otherUser).toBeDefined();
    if (!currentUser || !otherUser) return;

    await e2ePrisma.room.create({
      data: {
        id: privateRoomId,
        slug: `e2e-home-private-${suffix}`,
        name: "E2E private Home room",
        participants: { create: { userId: otherUser.id } },
      },
    });
    await e2ePrisma.atlasBoard.upsert({
      where: { id: "home-board" },
      update: {},
      create: { id: "home-board" },
    });
    await e2ePrisma.post.createMany({
      data: [
        {
          id: hiddenPostId,
          slug: `e2e-home-hidden-${suffix}`,
          title: "Hidden room agent log",
          content: "This content and its spatial anchor are room scoped.",
          type: "agent_log",
          roomId: privateRoomId,
          publishedAt: new Date(),
        },
        {
          id: globalPostId,
          slug: `e2e-home-global-${suffix}`,
          title: "Visible global user post",
          content: "User posts remain globally visible.",
          type: "user_post",
          authorId: otherUser.id,
          roomId: privateRoomId,
          publishedAt: new Date(),
        },
      ],
    });
    await e2ePrisma.atlasElement.createMany({
      data: [
        {
          id: hiddenAnchorId,
          boardId: "home-board",
          type: "note",
          postId: hiddenPostId,
          x: 10,
          y: 20,
        },
        {
          id: globalAnchorId,
          boardId: "home-board",
          type: "note",
          postId: globalPostId,
          x: 30,
          y: 40,
        },
        {
          id: photoOneId,
          boardId: "home-board",
          type: "photo",
          imageUrl: "/api/atlas/uploads/atlas%2Fe2e-home-one.jpg",
          x: 50,
          y: 60,
          createdById: otherUser.id,
        },
        {
          id: photoTwoId,
          boardId: "home-board",
          type: "photo",
          imageUrl: "/api/atlas/uploads/atlas%2Fe2e-home-two.jpg",
          x: 70,
          y: 80,
          createdById: otherUser.id,
        },
      ],
    });
    await e2ePrisma.atlasConnection.createMany({
      data: [
        {
          id: hiddenConnectionId,
          boardId: "home-board",
          fromId: hiddenAnchorId,
          toId: photoOneId,
        },
        {
          id: visibleConnectionId,
          boardId: "home-board",
          fromId: globalAnchorId,
          toId: photoOneId,
        },
      ],
    });

    const homeResponse = await page.goto("/home");
    expect(homeResponse?.ok()).toBe(true);
    const homePayload = await homeResponse?.text();
    expect(homePayload).toContain(globalAnchorId);
    expect(homePayload).toContain(photoOneId);
    expect(homePayload).toContain(visibleConnectionId);
    expect(homePayload).not.toContain(hiddenPostId);
    expect(homePayload).not.toContain(hiddenAnchorId);
    expect(homePayload).not.toContain(hiddenConnectionId);

    const requestHeaders = { origin: baseURL };
    const patchResponse = await page.request.patch(
      `/api/home-board/elements/${hiddenAnchorId}`,
      { headers: requestHeaders, data: { x: 999 } },
    );
    const createResponse = await page.request.post("/api/home-board/connections", {
      headers: requestHeaders,
      data: { fromId: hiddenAnchorId, toId: photoTwoId },
    });
    const deleteResponse = await page.request.delete(
      `/api/home-board/connections?id=${hiddenConnectionId}`,
      { headers: requestHeaders },
    );

    expect(patchResponse.status()).toBe(404);
    expect(createResponse.status()).toBe(404);
    expect(deleteResponse.status()).toBe(404);
    await expect(e2ePrisma.atlasElement.findUniqueOrThrow({
      where: { id: hiddenAnchorId },
    })).resolves.toMatchObject({ x: 10, y: 20 });
    await expect(e2ePrisma.atlasConnection.findUnique({
      where: { id: hiddenConnectionId },
    })).resolves.not.toBeNull();
    await expect(e2ePrisma.atlasConnection.count({
      where: {
        boardId: "home-board",
        fromId: hiddenAnchorId,
        toId: photoTwoId,
      },
    })).resolves.toBe(0);
  } finally {
    await e2ePrisma.post.deleteMany({
      where: { id: { in: [hiddenPostId, globalPostId] } },
    });
    await e2ePrisma.atlasElement.deleteMany({
      where: { id: { in: [photoOneId, photoTwoId] } },
    });
    await e2ePrisma.room.deleteMany({ where: { id: privateRoomId } });
    await e2ePrisma.$disconnect();
  }
});

test("reuses the brand mark in the chat navigation", async ({ page }) => {
  await page.goto("/chat");

  await expect(page).toHaveURL(/\/chat\/[^/?]+/);
  const brandLink = page.getByRole("link", { name: "XOXO Meridian" });
  await expect(brandLink.locator("img")).toHaveAttribute(
    "src",
    "/brand/logo_transparent.svg",
  );
  await expect(brandLink.locator("img").locator("..")).toHaveCSS(
    "background-color",
    "rgb(125, 168, 120)",
  );
});

test("resolves life panel identity for the second room participant", async ({
  baseURL,
  browser,
}) => {
  if (!baseURL) {
    throw new Error("Playwright baseURL is required for the second participant journey");
  }
  const databaseUrl = process.env.E2E_DATABASE_URL
    ?? (await readFile(resolve("test-results/.e2e-database-url"), "utf8")).trim();
  const e2ePrisma = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });
  const authContext = await playwrightRequest.newContext({
    baseURL,
    extraHTTPHeaders: { origin: baseURL },
    storageState: { cookies: [], origins: [] },
  });
  const loginResponse = await authContext.post("/api/auth/login", {
    data: {
      email: E2E_USERS[1].email,
      password: E2E_PASSWORD,
    },
  });
  expect(loginResponse.status()).toBe(200);
  const context = await browser.newContext({
    baseURL,
    storageState: await authContext.storageState(),
  });
  await authContext.dispose();

  try {
    const users = await e2ePrisma.user.findMany({
      where: { email: { in: E2E_USERS.map((user) => user.email) } },
      select: { id: true, email: true },
    });
    const userByEmail = new Map(users.map((user) => [user.email, user]));
    const firstUser = userByEmail.get(E2E_USERS[0].email);
    const secondUser = userByEmail.get(E2E_USERS[1].email);
    expect(firstUser).toBeDefined();
    expect(secondUser).toBeDefined();
    if (!firstUser || !secondUser) return;

    const participant = await e2ePrisma.roomParticipant.findFirstOrThrow({
      where: { userId: secondUser.id },
      select: { roomId: true },
    });
    await Promise.all([
      e2ePrisma.userProfile.update({
        where: { userId: firstUser.id },
        data: { city: "Tokyo", timezone: "Asia/Tokyo" },
      }),
      e2ePrisma.userProfile.update({
        where: { userId: secondUser.id },
        data: { city: "London", timezone: "Europe/London" },
      }),
    ]);

    const page = await context.newPage();
    const weatherResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === `/api/rooms/${participant.roomId}/weather`
    );
    await page.goto(`/chat/${participant.roomId}`);

    const weatherResponse = await weatherResponsePromise;
    const weatherPayload = await weatherResponse.json() as {
      results: Array<{ subject: string; displayName: string; city: string }>;
    };
    expect(weatherPayload.results[0]).toMatchObject({
      subject: "partner",
      displayName: E2E_USERS[0].displayName,
      city: "Tokyo",
    });

    const timeSection = page.getByRole("heading", { name: "两地时间" }).locator("..");
    const timeTexts = await timeSection.locator("p").allTextContents();
    expect(timeTexts.indexOf(E2E_USERS[1].displayName)).toBeLessThan(
      timeTexts.indexOf(E2E_USERS[0].displayName)
    );

    await page.getByTitle("新建任务").click();
    await expect(page.getByRole("combobox", { name: "时区" })).toHaveValue("Europe/London");
  } finally {
    await e2ePrisma.userProfile.updateMany({
      where: { user: { email: { in: E2E_USERS.map((user) => user.email) } } },
      data: { city: "—", timezone: "Asia/Shanghai" },
    });
    await context.close();
    await e2ePrisma.$disconnect();
  }
});

test.describe("计划表单键盘操作", () => {
  test.use({ timezoneId: "Europe/London" });

  test("仅用键盘创建计划，刷新后仍按名称读回小时、分钟和时区", async ({ page }) => {
    const databaseUrl = process.env.E2E_DATABASE_URL
      ?? (await readFile(resolve("test-results/.e2e-database-url"), "utf8")).trim();
    const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const roomId = `e2e-schedule-keyboard-${Date.now().toString(36)}`;
    const description = "键盘创建的晚间计划";
    const prompt = "提醒一起散步";
    const tabTo = async (target: Locator) => {
      for (let attempt = 0; attempt < 80; attempt += 1) {
        if (await target.evaluate((element) => element === document.activeElement)) break;
        await page.keyboard.press("Tab");
      }
      await expect(target).toBeFocused();
    };

    try {
      const user = await db.user.findUniqueOrThrow({ where: { email: E2E_USERS[0].email } });
      await db.room.create({
        data: {
          id: roomId,
          slug: roomId,
          name: "计划键盘测试房间",
          participants: { create: { userId: user.id, role: "owner" } },
        },
      });
      await page.goto(`/chat/${roomId}`);
      await tabTo(page.getByTitle("新建任务"));
      await page.keyboard.press("Enter");
      await expect(page.getByRole("heading", { name: "新建任务" })).toBeVisible();

      await tabTo(page.getByRole("textbox", { name: "任务描述" }));
      await page.keyboard.type(description);
      await page.keyboard.press("Tab");
      await expect(page.getByRole("textbox", { name: "执行指令 *" })).toBeFocused();
      await page.keyboard.type(prompt);

      const time = page.getByRole("group", { name: "执行时间" });
      const hour = time.getByRole("spinbutton", { name: "小时", exact: true });
      const minute = time.getByRole("spinbutton", { name: "分钟", exact: true });
      await page.keyboard.press("Tab");
      await expect(hour).toBeFocused();
      await page.keyboard.press("ControlOrMeta+A");
      await page.keyboard.type("18");
      await page.keyboard.press("Tab");
      await expect(minute).toBeFocused();
      await page.keyboard.press("ControlOrMeta+A");
      await page.keyboard.type("45");

      const timezone = page.getByRole("combobox", { name: "时区" });
      await expect(timezone).toHaveValue("Asia/Shanghai");
      await tabTo(timezone);
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Tab");
      await expect(timezone).toHaveValue("Europe/London");
      await expect(page.getByText("每天 18:45 执行", { exact: true })).toBeVisible();

      await tabTo(page.getByRole("button", { name: "保存", exact: true }));
      const createdResponse = page.waitForResponse((response) =>
        new URL(response.url()).pathname === `/api/rooms/${roomId}/scheduled-jobs`
        && response.request().method() === "POST"
      );
      await page.keyboard.press("Enter");
      const response = await createdResponse;
      expect(response.status()).toBe(201);
      await expect(page.getByText(description, { exact: true })).toBeVisible();
      const saved = await db.scheduledJob.findFirstOrThrow({ where: { roomId } });
      expect(saved).toMatchObject({
        cron: "45 18 * * *",
        timezone: "Europe/London",
        payload: { description, prompt, runOnce: false },
      });

      await page.reload();
      const card = page.getByText(description, { exact: true }).locator("..");
      await tabTo(card.getByRole("button", { name: "编辑任务" }));
      await page.keyboard.press("Enter");
      await expect(page.getByRole("heading", { name: "编辑任务" })).toBeVisible();
      await expect(hour).toHaveValue("18");
      await expect(minute).toHaveValue("45");
      await expect(timezone).toHaveValue("Europe/London");
      await page.keyboard.press("Escape");
    } finally {
      // 超时后页面可能已关闭；清理导航失败也必须继续释放隔离数据与连接。
      await page.goto("about:blank").catch(() => undefined);
      try {
        await db.room.deleteMany({ where: { id: roomId } });
      } finally {
        await db.$disconnect();
      }
    }
  });
});

test("keeps private profile fields out of Chat and Study browser payloads", async ({ page }) => {
  const databaseUrl = process.env.E2E_DATABASE_URL
    ?? (await readFile(resolve("test-results/.e2e-database-url"), "utf8")).trim();
  const e2ePrisma = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });
  const privateValues = [
    "e2e-private-profile-note-one",
    "e2e-private-profile-note-two",
    "e2e-private-preferences-one",
    "e2e-private-preferences-two",
    "198.51.100.21",
    "198.51.100.22",
  ];

  try {
    const users = await e2ePrisma.user.findMany({
      where: { email: { in: E2E_USERS.map((user) => user.email) } },
      orderBy: { email: "asc" },
      select: {
        id: true,
        email: true,
        displayName: true,
        avatarLabel: true,
        passwordHash: true,
      },
    });
    expect(users).toHaveLength(2);
    const userByEmail = new Map(users.map((user) => [user.email, user]));
    const currentUser = userByEmail.get(E2E_USERS[0].email);
    const partnerUser = userByEmail.get(E2E_USERS[1].email);
    expect(currentUser).toBeDefined();
    expect(partnerUser).toBeDefined();
    if (!currentUser || !partnerUser) return;

    const participant = await e2ePrisma.roomParticipant.findFirstOrThrow({
      where: { userId: currentUser.id },
      select: { roomId: true },
    });
    await Promise.all([
      e2ePrisma.userProfile.update({
        where: { userId: currentUser.id },
        data: {
          city: "Public City One",
          country: "Public Country One",
          timezone: "Asia/Tokyo",
          lastGeoIp: "198.51.100.21",
          preferences: { privateMarker: "e2e-private-preferences-one" },
          profileNote: "e2e-private-profile-note-one",
        },
      }),
      e2ePrisma.userProfile.update({
        where: { userId: partnerUser.id },
        data: {
          city: "Public City Two",
          country: "Public Country Two",
          timezone: "Asia/Seoul",
          lastGeoIp: "198.51.100.22",
          preferences: { privateMarker: "e2e-private-preferences-two" },
          profileNote: "e2e-private-profile-note-two",
        },
      }),
    ]);

    const chatResponse = await page.goto(`/chat/${participant.roomId}`);
    expect(chatResponse?.ok()).toBe(true);
    const chatPayload = await chatResponse?.text();
    expect(chatPayload).toContain("Public City One");
    expect(chatPayload).toContain("Public City Two");
    expect(chatPayload).toContain("Asia/Tokyo");
    expect(chatPayload).toContain("Asia/Seoul");
    await expect(page.getByText("Public City One", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Public City Two", { exact: true }).first()).toBeVisible();

    const studyResponse = await page.goto("/study");
    expect(studyResponse?.ok()).toBe(true);
    const studyPayload = await studyResponse?.text();
    expect(studyPayload).toContain("Public City One");
    expect(studyPayload).toContain("Public City Two");
    expect(studyPayload).toContain("Asia/Tokyo");
    expect(studyPayload).toContain("Asia/Seoul");

    for (const payload of [chatPayload, studyPayload]) {
      expect(payload).toContain(currentUser.displayName);
      expect(payload).toContain(partnerUser.displayName);
      expect(payload).toContain(currentUser.avatarLabel);
      for (const privateField of [
        "email",
        "passwordHash",
        "sessionVersion",
        "lastGeoIp",
        "preferences",
        "profileNote",
      ]) {
        expect(payload).not.toContain(privateField);
      }
      for (const privateValue of [
        ...privateValues,
        currentUser.email,
        currentUser.passwordHash,
        partnerUser.email,
        partnerUser.passwordHash,
      ]) {
        expect(payload).not.toContain(privateValue);
      }
    }
  } finally {
    await e2ePrisma.userProfile.updateMany({
      where: { user: { email: { in: E2E_USERS.map((user) => user.email) } } },
      data: {
        city: "—",
        country: "—",
        timezone: "Asia/Shanghai",
        lastGeoIp: null,
        preferences: Prisma.JsonNull,
        profileNote: null,
      },
    });
    await e2ePrisma.$disconnect();
  }
});

test("New Post 恢复独立发文，详情与 Blog 时间线保持原有入口", async ({ context }, testInfo) => {
  await withStudyUser(context, async ({ page, db, userId }) => {
    await page.goto("/home");
    await expect(page.getByRole("link", { name: "New Draft", exact: true })).toHaveCount(0);
    await page.getByRole("link", { name: "New Post", exact: true }).click();
    await expect(page).toHaveURL(/\/posts\/new$/);
    await expect(page.getByRole("heading", { name: "New Post", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "空间草稿" })).toHaveCount(0);
    await expect(page.getByRole("group", { name: "框选草稿区域" })).toHaveCount(0);
    await page.getByLabel("Post title", { exact: true }).fill("E2E 独立博文");
    await page.getByLabel("Post content", { exact: true }).fill("从 New Post 直接发布的独立正文。");
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(page).toHaveURL(/\/posts\/e2e-du-li-bo-wen$/);
    await expect(page.getByRole("heading", { name: "E2E 独立博文", exact: true })).toBeVisible();
    const post = await db.post.findFirstOrThrow({ where: { authorId: userId, title: "E2E 独立博文" } });
    expect(post.workId).toBeNull();
    expect(post.publishedAt).not.toBeNull();
    expect(await db.blogWork.count({ where: { ownerId: userId } })).toBe(0);
    await page.goto(`/posts/edit/${post.slug}`);
    await expect(page.getByRole("heading", { name: "Edit Post", exact: true })).toBeVisible();
    await expect(page.getByLabel("Post content", { exact: true })).toHaveValue("从 New Post 直接发布的独立正文。");
    await page.getByRole("link", { name: "Blog", exact: true }).click();
    await expect(page.getByRole("heading", { name: "E2E 独立博文", exact: true })).toBeVisible();
    await expect(page.locator(".scroll-reveal").filter({ has: page.getByRole("heading", { name: "E2E 独立博文", exact: true }) })).toHaveCSS("opacity", "1");
    await page.screenshot({ path: testInfo.outputPath("new-post-timeline.png") });
  });
});

test("starts and stops a focus session", async ({ context }) => {
  await withStudyUser(context, async ({ page, db, userId }) => {
    await page.goto("/study");
    const sessionKey = await startStudyFocus(page);
    await stopStudyFocus(page, sessionKey);
    await expect(db.focusSession.count({ where: { userId, sessionKey } })).resolves.toBe(1);
  });
});

test("reconciles one expired focus session after leaving and revisiting Study", async ({ context }) => {
  await withStudyUser(context, async ({ page, db, userId }) => {
    await page.goto("/study");
    const sessionKey = await startStudyFocus(page);
    await page.goto("/home");
    const expectedEndAt = new Date(Date.now() - 60_000);
    await db.focusState.update({
      where: { userId, currentSessionKey: sessionKey },
      data: {
        startedAt: new Date(expectedEndAt.getTime() - 25 * 60_000),
        expectedEndAt,
      },
    });

    expect((await page.goto("/study"))?.status()).toBe(200);
    await expect(page.getByRole("button", { name: "开始专注" })).toBeVisible();
    await expect(page.getByText("25 分钟", { exact: true })).toHaveCount(1);

    expect((await page.reload())?.status()).toBe(200);
    await expect(page.getByRole("button", { name: "开始专注" })).toBeVisible();
    await expect(page.getByText("25 分钟", { exact: true })).toHaveCount(1);
    await expect(db.focusSession.count({ where: { userId, sessionKey } })).resolves.toBe(1);
    await expect(db.focusState.findUniqueOrThrow({ where: { userId } })).resolves.toMatchObject({
      status: "idle", currentSessionKey: sessionKey, expectedEndAt: null,
    });
  });
});

test("Focus 用例失败后清理运行状态，下一次使用从 idle 开始", async ({ context }) => {
  let failedUserId = "";
  let failedRoomId = "";
  const failure = new Error("模拟 Focus 启动后的用例失败");
  await expect(withStudyUser(context, async ({ page, db, userId, roomId }) => {
    failedUserId = userId;
    failedRoomId = roomId;
    await page.goto("/study");
    const sessionKey = await startStudyFocus(page);
    await expect(db.focusState.findUniqueOrThrow({ where: { userId } })).resolves.toMatchObject({
      status: "running", currentSessionKey: sessionKey,
    });
    throw failure;
  })).rejects.toBe(failure);

  await withStudyUser(context, async ({ page, db, userId }) => {
    expect(userId).not.toBe(failedUserId);
    await expect(db.user.count({ where: { id: failedUserId } })).resolves.toBe(0);
    await expect(db.session.count({ where: { userId: failedUserId } })).resolves.toBe(0);
    await expect(db.focusState.count({ where: { userId: failedUserId } })).resolves.toBe(0);
    await expect(db.focusSession.count({ where: { userId: failedUserId } })).resolves.toBe(0);
    await expect(db.room.count({ where: { id: failedRoomId } })).resolves.toBe(0);
    await page.goto("/study");
    await expect(page.getByRole("button", { name: "开始专注", exact: true })).toBeVisible();
    await expect(page.getByText(/专注中 ·/)).toHaveCount(0);
    const sessionKey = await startStudyFocus(page);
    await stopStudyFocus(page, sessionKey);
  });
});

test("sends a room message and renders it in the timeline", async ({ page }) => {
  await page.goto("/chat");
  await expect(page).toHaveURL(/\/chat\/[^/?]+/);
  await expect(page.getByText("连接中…", { exact: true })).toBeHidden({
    timeout: 15_000,
  });
  const message = `E2E message ${Date.now()}`;
  await page.getByLabel("消息内容").fill(message);
  const sendResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      /\/api\/rooms\/[^/]+\/messages$/.test(new URL(response.url()).pathname),
  );
  await page.getByRole("button", { name: "发送", exact: true }).click();
  expect((await sendResponse).ok()).toBe(true);

  await expect(page.getByRole("article").getByText(message, { exact: true })).toBeVisible();
});

test("keeps the latest 80 messages and task summaries through send, reload and SSE reconnect", async ({ page, context }) => {
  test.setTimeout(120_000);
  const databaseUrl = process.env.E2E_DATABASE_URL
    ?? (await readFile(resolve("test-results/.e2e-database-url"), "utf8")).trim();
  const e2ePrisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const suffix = Date.now().toString(36);
  const roomId = `e2e-long-chat-${suffix}`;
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  const snapshots: RoomSnapshot[] = [];
  cdp.on("Network.eventSourceMessageReceived", (event) => {
    if (event.eventName !== "snapshot") return;
    const snapshot = JSON.parse(event.data) as RoomSnapshot;
    if (snapshot.room.id === roomId) snapshots.push(snapshot);
  });
  const paragraphs = page.getByRole("article").locator(":scope > p");

  try {
    const [viewer, partner, agent] = await Promise.all([
      e2ePrisma.user.findUniqueOrThrow({ where: { email: E2E_USERS[0].email } }),
      e2ePrisma.user.findUniqueOrThrow({ where: { email: E2E_USERS[1].email } }),
      e2ePrisma.agent.findUniqueOrThrow({ where: { slug: "life-assistant" } }),
    ]);
    await e2ePrisma.room.create({
      data: {
        id: roomId,
        slug: roomId,
        name: "长对话回归",
        participants: { create: [{ userId: viewer.id }, { userId: partner.id }] },
      },
    });
    const rows = Array.from({ length: 100 }, (_, index) => ({
      id: `${roomId}-${String(index).padStart(3, "0")}`,
      roomId,
      senderId: viewer.id,
      senderType: "human" as const,
      content: `长对话消息 ${String(index).padStart(3, "0")}`,
      createdAt: new Date(Date.UTC(2026, 8, 1, 0, 0, Math.floor(index / 7))),
    }));
    await e2ePrisma.message.createMany({ data: [...rows].reverse() });
    await e2ePrisma.message.update({
      where: { id: rows[99].id },
      data: {
        senderId: null,
        senderType: "agent",
        senderAgentId: agent.id,
        metadata: { toolResults: [{ output: "e2e-private-message-output" }] },
      },
    });
    await e2ePrisma.agentTask.create({
      data: {
        roomId,
        agentId: agent.id,
        requestedById: viewer.id,
        sourceMessageId: rows[98].id,
        finalMessageId: rows[99].id,
        status: "completed",
        input: { prompt: "e2e-private-task-prompt" },
        toolCalls: {
          create: {
            toolName: "memo.list",
            status: "completed",
            durationMs: 12,
            input: { prompt: "e2e-private-tool-input" },
            output: { content: "e2e-private-tool-output" },
          },
        },
        llmCalls: {
          create: {
            provider: "mock",
            model: "e2e-model",
            status: "completed",
            totalTokens: 42,
            inputSummary: "e2e-private-llm-prompt",
            requestPayload: { prompt: "e2e-private-llm-request" },
            responsePayload: { content: "e2e-private-llm-response" },
          },
        },
      },
    });

    let expectedRows = rows.slice(-80).map(({ id, content }) => ({ id, content }));
    const checkWindow = async () => {
      await expect(paragraphs).toHaveText(expectedRows.map((row) => row.content));
      const response = await page.request.get(`/api/rooms/${roomId}/messages`);
      expect(response.ok()).toBe(true);
      const messages = (await response.json()).messages as ChatMessage[];
      expect(messages.map(({ id }) => id)).toEqual(expectedRows.map(({ id }) => id));
      expect(JSON.stringify(messages)).not.toContain("e2e-private-");
      await expect.poll(() => snapshots.at(-1)?.messages.map(({ id }) => id))
        .toEqual(expectedRows.map(({ id }) => id));
      expect(snapshots.at(-1)?.messages).toEqual(messages);
      expect(JSON.stringify(snapshots)).not.toContain("e2e-private-");
    };

    const initialResponse = await page.goto(`/chat/${roomId}`);
    expect(initialResponse?.ok()).toBe(true);
    const initialPayload = await initialResponse!.text();
    expect(initialPayload).toContain(rows[99].content);
    expect(initialPayload).not.toContain(rows[0].content);
    expect(initialPayload).not.toContain("e2e-private-");
    await checkWindow();
    await page.getByText("执行链路", { exact: true }).click();
    await expect(page.getByText("memo.list / completed / 12ms", { exact: true })).toBeVisible();
    await expect(page.getByText("mock / e2e-model / completed / 42 tokens", { exact: true })).toBeVisible();
    await expect(page.getByText("已派发", { exact: true })).toBeVisible();

    const content = "长对话发送后的最新消息";
    await page.getByLabel("消息内容").fill(content);
    const sent = page.waitForResponse((response) =>
      response.request().method() === "POST"
      && new URL(response.url()).pathname === `/api/rooms/${roomId}/messages`,
    );
    await page.getByRole("button", { name: "发送", exact: true }).click();
    const sentResponse = await sent;
    expect(sentResponse.status()).toBe(201);
    const { message } = await sentResponse.json();
    expectedRows = [...expectedRows.slice(1), { id: message.id, content }];
    await checkWindow();

    // 刷新关闭旧连接后，在浏览器 HTTP 边界注入连接重置；恢复时仍连接真实 SSE 服务。
    let allowStream = false;
    await page.route(`**/api/rooms/${roomId}/stream`, async (route) => {
      if (allowStream) await route.continue();
      else await route.abort("connectionreset");
    });
    const reloaded = await page.reload();
    expect(await reloaded!.text()).not.toContain("e2e-private-");
    await expect(paragraphs).toHaveText(expectedRows.map((row) => row.content));

    await expect(page.getByText("重连中…", { exact: true })).toBeVisible();
    const offlineMessage = await e2ePrisma.message.create({
      data: { roomId, senderId: partner.id, senderType: "human", content: "离线期间伙伴的新消息" },
    });
    expectedRows = [...expectedRows.slice(1), { id: offlineMessage.id, content: offlineMessage.content }];
    const refreshed = page.waitForResponse((response) =>
      response.request().method() === "GET"
      && new URL(response.url()).pathname === `/api/rooms/${roomId}/messages`,
    );
    allowStream = true;
    expect((await refreshed).ok()).toBe(true);
    await checkWindow();
    await expect(page.getByText("重连中…", { exact: true })).toBeHidden();
    const snapshotCount = snapshots.length;
    await expect.poll(() => snapshots.length).toBeGreaterThan(snapshotCount);
    await checkWindow();
  } finally {
    await page.goto("about:blank");
    await page.unroute(`**/api/rooms/${roomId}/stream`);
    await cdp.detach();
    await e2ePrisma.room.deleteMany({ where: { id: roomId } });
    await e2ePrisma.$disconnect();
  }
});

test("慢查询跨多个轮询周期时聊天快照保持串行，消息和 Agent 状态在重连后稳定", async ({ page, context }) => {
  test.setTimeout(120_000);
  const databaseUrl = process.env.E2E_DATABASE_URL
    ?? (await readFile(resolve("test-results/.e2e-database-url"), "utf8")).trim();
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const roomId = `e2e-slow-stream-${Date.now().toString(36)}`;
  const streamUrl = `**/api/rooms/${roomId}/stream`;
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  const snapshots: RoomSnapshot[] = [];
  cdp.on("Network.eventSourceMessageReceived", (event) => {
    if (event.eventName !== "snapshot") return;
    const snapshot = JSON.parse(event.data) as RoomSnapshot;
    if (snapshot.room.id === roomId) snapshots.push(snapshot);
  });

  try {
    const viewer = await db.user.findUniqueOrThrow({ where: { email: E2E_USERS[0].email } });
    const agent = await db.agent.findUniqueOrThrow({ where: { slug: "life-assistant" } });
    await db.room.create({ data: {
      id: roomId, slug: roomId, name: "慢查询实时回归",
      participants: { create: { userId: viewer.id, role: "owner" } },
    } });
    const task = await db.agentTask.create({ data: {
      roomId, agentId: agent.id, requestedById: viewer.id, status: "running", input: {},
    } });
    await page.goto(`/chat/${roomId}`);
    await expect.poll(() => snapshots.at(-1)?.agentStatus.isWorking).toBe(true);
    await expect(page.getByText(/正在调用工具$/)).toBeVisible();
    const snapshotCountBeforeLock = snapshots.length;

    // 只锁隔离数据库的 Memo 表，使真实 snapshot 中的一条 SELECT 阻塞。
    // 用 PostgreSQL 锁等待及查询年龄确认跨过多个 tick，不替换服务器或 EventSource。
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`LOCK TABLE "Memo" IN ACCESS EXCLUSIVE MODE`;
      const waitingReads = () => db.$queryRaw<Array<{ ageSeconds: number }>>`
        SELECT EXTRACT(EPOCH FROM (clock_timestamp() - activity.query_start))::float8 AS "ageSeconds"
        FROM pg_locks AS waiting_lock
        JOIN pg_stat_activity AS activity ON activity.pid = waiting_lock.pid
        WHERE waiting_lock.relation = '"Memo"'::regclass
          AND waiting_lock.mode = 'AccessShareLock' AND NOT waiting_lock.granted
          AND activity.datname = current_database()
      `;
      await expect.poll(async () => Math.max(0, ...(await waitingReads()).map((row) => row.ageSeconds)), {
        timeout: 15_000, intervals: [200],
      }).toBeGreaterThanOrEqual(6);
      expect(await waitingReads()).toHaveLength(1);

      await db.$transaction([
        db.agentTask.update({ where: { id: task.id }, data: { status: "completed" } }),
        db.message.create({ data: {
          roomId, senderType: "agent", senderAgentId: agent.id, content: "慢查询期间任务已完成",
        } }),
      ]);
    }, { timeout: 30_000 });

    await expect.poll(() => snapshots.at(-1)?.agentStatus.recentTasks[0]?.status, { timeout: 15_000 }).toBe("completed");
    await expect(page.getByRole("article").getByText("慢查询期间任务已完成", { exact: true })).toBeVisible();
    await expect(page.getByText(/已就绪$/)).toBeVisible();
    const completedIndex = snapshots.findIndex((snapshot) => snapshot.agentStatus.recentTasks[0]?.status === "completed");
    expect(completedIndex).toBeGreaterThanOrEqual(snapshotCountBeforeLock);
    await expect.poll(() => snapshots.length, { timeout: 10_000 }).toBeGreaterThanOrEqual(completedIndex + 3);
    for (const snapshot of snapshots.slice(completedIndex)) {
      expect(snapshot.agentStatus).toMatchObject({ isWorking: false, runningTasks: 0 });
      expect(snapshot.agentStatus.recentTasks[0]?.status).toBe("completed");
      expect(snapshot.messages.map(({ content }) => content)).toEqual(["慢查询期间任务已完成"]);
    }

    let allowStream = false;
    await page.route(streamUrl, async (route) => {
      if (allowStream) await route.continue();
      else await route.abort("connectionreset");
    });
    await page.reload();
    await expect(page.getByText("重连中…", { exact: true })).toBeVisible();
    const nextTask = await db.agentTask.create({ data: {
      roomId, agentId: agent.id, requestedById: viewer.id, status: "running", input: {},
    } });
    await db.message.create({ data: {
      roomId, senderType: "human", senderId: viewer.id, content: "断线期间的新消息",
    } });
    const reconnectIndex = snapshots.length;
    allowStream = true;
    await expect.poll(() => snapshots.at(-1)?.agentStatus.recentTasks[0]?.id, { timeout: 15_000 }).toBe(nextTask.id);
    await expect(page.getByText("重连中…", { exact: true })).toBeHidden();
    await expect(page.getByText(/正在调用工具$/)).toBeVisible();
    await expect(page.getByRole("article").getByText("断线期间的新消息", { exact: true })).toBeVisible();
    await expect.poll(() => snapshots.length, { timeout: 10_000 }).toBeGreaterThanOrEqual(reconnectIndex + 3);
    for (const snapshot of snapshots.slice(reconnectIndex)) {
      expect(snapshot.agentStatus).toMatchObject({ isWorking: true, runningTasks: 1 });
      expect(snapshot.agentStatus.recentTasks[0]).toMatchObject({ id: nextTask.id, status: "running" });
      expect(snapshot.messages.map(({ content }) => content)).toEqual(["慢查询期间任务已完成", "断线期间的新消息"]);
    }
  } finally {
    await page.goto("about:blank").catch(() => undefined);
    await page.unroute(streamUrl);
    await cdp.detach();
    try {
      await db.room.deleteMany({ where: { id: roomId } });
    } finally {
      await db.$disconnect();
    }
  }
});

test("搜索失败保留已有文章，键盘重试恢复后位置与首页一致", async ({ page }) => {
  test.setTimeout(90_000);
  const databaseUrl = process.env.E2E_DATABASE_URL
    ?? (await readFile(resolve("test-results/.e2e-database-url"), "utf8")).trim();
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const prefix = `e2e-search-${Date.now().toString(36)}`;
  const authorId = `${prefix}-author`;
  const legacyId = `${prefix}-legacy`;
  const snapshotId = `${prefix}-snapshot`;
  const legacyTitle = `${prefix} 旧文章`;
  const snapshotTitle = `${prefix} 快照文章`;
  const searchRoute = "**/api/blog/feed?*";
  const searchError = page.getByRole("main").getByRole("alert");
  let failure: 401 | 500 | "network" | null = null;
  const legacyCard = page.getByRole("article").filter({ has: page.getByRole("heading", { name: legacyTitle, exact: true }) });
  const snapshotCard = page.getByRole("article").filter({ has: page.getByRole("heading", { name: snapshotTitle, exact: true }) });
  const searchResponse = (query: string) => page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/blog/feed" && url.searchParams.get("q") === query;
  });
  const submitSearch = (query: string, status: number) => test.step(`搜索查询并收到 HTTP ${status}`, async () => {
    const [response] = await Promise.all([
      searchResponse(query),
      test.step("输入查询并更新 URL", async () => {
        const input = page.getByRole("textbox", { name: "Search posts", exact: true });
        await input.fill(query);
        await expect(page.getByRole("button", { name: "Clear search", exact: true })).toBeVisible();
        await page.waitForURL((url) => url.pathname === "/home" && url.searchParams.get("q") === query);
        await expect(input).toHaveValue(query);
      }),
    ]);
    expect(response.status()).toBe(status);
    return response;
  });

  try {
    await db.user.create({ data: {
      id: authorId, email: `${authorId}@example.com`, displayName: "搜索作者", avatarLabel: "搜",
      passwordHash: "unused-e2e-search-password-hash",
      profile: { create: { city: "Tokyo", country: "Japan", timezone: "Asia/Tokyo" } },
    } });
    await db.post.createMany({ data: [
      {
        id: legacyId, slug: legacyId, title: legacyTitle, content: "旧文章没有位置快照，显示作者公开位置。",
        authorId, publishedAt: new Date("2026-09-13T00:00:00Z"),
      },
      {
        id: snapshotId, slug: snapshotId, title: snapshotTitle, content: "快照位置优先于作者当前档案。",
        authorId, publishedAt: new Date("2026-09-13T00:01:00Z"),
        authorCity: "London", authorCountry: "United Kingdom", authorTimezone: "Europe/London",
      },
    ] });
    await page.goto("/home");
    await expect(legacyCard).toBeVisible();
    await expect(snapshotCard).toBeVisible();
    const legacyTime = await legacyCard.locator("time").innerText();
    const snapshotTime = await snapshotCard.locator("time").innerText();
    expect(legacyTime).toContain("Tokyo");
    expect(snapshotTime).toContain("London");

    await page.route(searchRoute, async (route) => {
      if (failure === "network") return route.abort("connectionfailed");
      if (failure) return route.fulfill({ status: failure, json: { error: "测试搜索失败" } });
      return route.continue();
    });
    const initialSearch = await submitSearch(prefix, 200);
    const initialResults = await initialSearch.json() as { entries: Array<{ post: { id: string } }> };
    expect(initialResults.entries.map(({ post }) => post.id).sort()).toEqual([legacyId, snapshotId].sort());
    await test.step("首次结果已显示后再验证失败保留", async () => {
      await expect(page.getByRole("article")).toHaveCount(2);
      await expect(page.getByRole("status").filter({ hasText: "正在搜索…" })).toHaveCount(0);
    });
    await expect(legacyCard.locator("time")).toHaveText(legacyTime);
    await expect(snapshotCard.locator("time")).toHaveText(snapshotTime);

    failure = 500;
    await submitSearch(legacyTitle, 500);
    await expect(searchError).toContainText("搜索失败");
    await expect(legacyCard).toBeVisible();
    await expect(snapshotCard).toBeVisible();
    await expect(page.getByText("No posts match your search.", { exact: true })).toHaveCount(0);

    for (const nextFailure of [401, "network"] as const) {
      failure = nextFailure;
      const failed = nextFailure === "network"
        ? page.waitForEvent("requestfailed", (request) => new URL(request.url()).pathname === "/api/blog/feed")
        : searchResponse(legacyTitle);
      await page.getByRole("button", { name: "重试搜索", exact: true }).focus();
      await page.keyboard.press("Enter");
      await failed;
      await expect(searchError).toContainText(nextFailure === 401 ? "登录已失效" : "搜索失败");
      await expect(legacyCard.locator("time")).toHaveText(legacyTime);
      await expect(snapshotCard).toBeVisible();
    }

    failure = null;
    const recovered = searchResponse(legacyTitle);
    await page.getByRole("button", { name: "重试搜索", exact: true }).focus();
    await page.keyboard.press("Enter");
    expect((await recovered).status()).toBe(200);
    await expect(searchError).toHaveCount(0);
    await expect(snapshotCard).toHaveCount(0);
    await expect(legacyCard.locator("time")).toHaveText(legacyTime);
    await legacyCard.getByRole("link", { name: legacyTitle, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/posts/${legacyId}$`));
    await expect(page.getByRole("heading", { name: legacyTitle, exact: true })).toBeVisible();
  } finally {
    try {
      // 路由拦截随此页关闭释放；超时已关闭页面时也不能阻断数据清理。
      await page.close();
    } finally {
      try {
        await db.$transaction([
          db.post.deleteMany({ where: { id: { in: [legacyId, snapshotId] } } }),
          db.user.deleteMany({ where: { id: authorId } }),
        ]);
      } finally {
        await db.$disconnect();
      }
    }
  }
});

test("同毫秒文章在首页与搜索保持稳定顺序，真实 API 分页无遗漏", async ({ page }) => {
  test.setTimeout(90_000);
  const databaseUrl = process.env.E2E_DATABASE_URL
    ?? (await readFile(resolve("test-results/.e2e-database-url"), "utf8")).trim();
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const prefix = `cpagination${Date.now().toString(36)}`;
  const ids = Array.from({ length: 53 }, (_, index) => `${prefix}${String(index).padStart(3, "0")}`);
  const publishedAt = new Date("2099-09-13T01:02:03.123Z");
  const headings = page.getByRole("article").getByRole("heading", { level: 2 });
  const expectedTitles = ids.slice(3).map((id) => `同毫秒记录 ${id}`);

  try {
    const author = await db.user.findUniqueOrThrow({ where: { email: E2E_USERS[0].email } });
    // 乱序写入，避免依赖数据库插入顺序恰好与预期相同。
    await db.post.createMany({ data: ids.map((_, index) => {
      const id = ids[(index * 7) % ids.length];
      return { id, slug: id, title: `同毫秒记录 ${id}`, content: "分页完整性回归", authorId: author.id, publishedAt };
    }) });
    await page.goto("/home");
    await expect(headings).toHaveText(expectedTitles);
    await expect(headings.first()).toBeVisible();
    await headings.last().scrollIntoViewIfNeeded();
    await expect(headings.last()).toBeVisible();
    await page.reload();
    await expect(headings).toHaveText(expectedTitles);

    const search = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/blog/feed" && url.searchParams.get("q") === prefix;
    });
    await page.getByRole("textbox", { name: "Search posts", exact: true }).fill(prefix);
    const searchResponse = await search;
    expect(searchResponse.status()).toBe(200);
    const firstPage = await searchResponse.json() as { entries: Array<{ post: { id: string } }>; nextCursor: string | null };
    expect(firstPage.entries.map(({ post }) => post.id)).toEqual([...ids].reverse().slice(0, 50));
    await expect(headings).toHaveText(expectedTitles);

    const pagedIds: string[] = [];
    const params: Record<string, string> = { q: prefix, limit: "17" };
    let ended = false;
    for (let index = 0; index < 5; index += 1) {
      const response = await page.request.get("/api/posts", { params });
      expect(response.status()).toBe(200);
      const body = await response.json() as { posts: Array<{ id: string }>; nextCursor: string | null };
      pagedIds.push(...body.posts.map((post) => post.id));
      if (body.nextCursor === null) {
        ended = true;
        break;
      }
      params.cursor = body.nextCursor;
    }
    expect(ended).toBe(true);
    expect(pagedIds).toEqual([...ids].reverse());
    expect(new Set(pagedIds).size).toBe(ids.length);
    const legacy = await page.request.get("/api/posts", { params: { cursor: publishedAt.toISOString() } });
    expect(legacy.status()).toBe(400);
    expect(await legacy.json()).toMatchObject({ error: "Invalid request" });
  } finally {
    await page.goto("about:blank").catch(() => undefined);
    try {
      await db.post.deleteMany({ where: { id: { in: ids } } });
    } finally {
      await db.$disconnect();
    }
  }
});

test("编辑器提交纯空白正文时显示错误横幅并停在编辑页，合法保存仍跳转", async ({ baseURL, page }) => {
  test.setTimeout(60_000);
  if (!baseURL) {
    throw new Error("Playwright baseURL is required for the Post editor write contract");
  }
  const databaseUrl = process.env.E2E_DATABASE_URL
    ?? (await readFile(resolve("test-results/.e2e-database-url"), "utf8")).trim();
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const requestHeaders = { origin: baseURL };
  const suffix = Date.now().toString(36);
  const title = `编辑器空白正文 ${suffix}`;
  const originalContent = "提交前的原始正文";
  const validContent = "合法保存的正文内容";
  // PostEditor 的 #post-title 与 #post-content 都带原生 required：真正留空会被浏览器自身拦下、
  // Server Action 根本不会被调用，测不到写入契约。必须提交「纯空白」（三个空格）才触达
  // postUpdateSchema 的 .trim().min(1)；后来者若把这里改成清空后提交，本用例会静默失去覆盖。
  const blankContent = "   ";

  // 保留未归组历史 Post 的编辑契约；新建 API 现在会建立 BlogWork。
  const author = await db.user.findUniqueOrThrow({ where: { email: E2E_USERS[0].email } });
  const post = await db.post.create({ data: { slug: generateSlug(title), title, content: originalContent, authorId: author.id, publishedAt: new Date() } });

  try {
    const before = await db.post.findUniqueOrThrow({ where: { slug: post.slug } });
    await page.goto(`/posts/edit/${post.slug}`);
    await expect(page.getByLabel("Post content", { exact: true })).toHaveValue(originalContent);

    await page.getByLabel("Post content", { exact: true }).fill(blankContent);
    await page.getByRole("button", { name: "Update", exact: true }).click();

    await expect(page.getByText("Content is required", { exact: true })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/posts/edit/${post.slug}$`));
    const afterBlank = await db.post.findUniqueOrThrow({ where: { slug: post.slug } });
    expect(afterBlank.content).toBe(before.content);
    expect(afterBlank.slug).toBe(before.slug);
    expect(afterBlank.updatedAt.toISOString()).toBe(before.updatedAt.toISOString());

    // 对照步骤：合法内容必须真正保存并跳转，证明上一条断言不是「提交永远不生效」的假阳性。
    await page.getByLabel("Post content", { exact: true }).fill(`  ${validContent}  `);
    await page.getByRole("button", { name: "Update", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/posts/${post.slug}$`), { timeout: 15_000 });
    const saved = await db.post.findUniqueOrThrow({ where: { slug: post.slug } });
    expect(saved.content).toBe(validContent);
    expect(saved.slug).toBe(before.slug);
  } finally {
    await page.goto("about:blank").catch(() => undefined);
    try {
      expect((await page.request.delete(`/api/posts/${post.slug}`, { headers: requestHeaders })).ok()).toBe(true);
    } finally {
      await db.$disconnect();
    }
  }
});

test("编辑器遇到数据库异常时只显示通用文案且不跳转", async ({ baseURL, page }) => {
  test.setTimeout(90_000);
  if (!baseURL) {
    throw new Error("Playwright baseURL is required for the Post editor error contract");
  }
  const databaseUrl = process.env.E2E_DATABASE_URL
    ?? (await readFile(resolve("test-results/.e2e-database-url"), "utf8")).trim();
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const suffix = Date.now().toString(36);
  const failingTitle = `错误脱敏 ${suffix}`;
  const contrastTitle = `错误脱敏对照 ${suffix}`;

  const author = await db.user.findUniqueOrThrow({ where: { email: E2E_USERS[0].email } });
  const post = await db.post.create({ data: { slug: `legacy-error-${suffix}`, title: "故障前原文", content: "正文", authorId: author.id, publishedAt: new Date() } });
  // 用历史独立 Post 的更新路径注入真实 PostgreSQL 失败，仍验证旧编辑入口的错误脱敏。
  await db.$executeRawUnsafe(`
    CREATE FUNCTION fail_probe_post_update() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'duplicate key value violates unique constraint "Post_probe_key"';
    END;
    $$ LANGUAGE plpgsql
  `);
  await db.$executeRawUnsafe(`
    CREATE TRIGGER fail_probe_post_update BEFORE UPDATE ON "Post"
    FOR EACH ROW WHEN (NEW."title" = '${failingTitle}')
    EXECUTE FUNCTION fail_probe_post_update()
  `);
  try {
    await page.goto(`/posts/edit/${post.slug}`);
    await page.getByLabel("Post title", { exact: true }).fill(failingTitle);
    await page.getByRole("button", { name: "Update", exact: true }).click();
    const banner = page.getByText("Internal server error", { exact: true });
    await expect(banner).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/posts/edit/${post.slug}$`));
    for (const leaked of ["Post_probe_key", "Unique constraint", "duplicate key value", "PrismaClient"]) {
      expect(await banner.innerText()).not.toContain(leaked);
      expect(await page.locator("body").innerText()).not.toContain(leaked);
    }
    expect(await db.post.count({ where: { title: failingTitle } })).toBe(0);
    await page.getByLabel("Post title", { exact: true }).fill(contrastTitle);
    await page.getByRole("button", { name: "Update", exact: true }).click();
    await expect(page).toHaveURL(/\/posts\/(?!edit)[^/]+$/, { timeout: 15_000 });
    expect(await db.post.count({ where: { title: contrastTitle } })).toBe(1);
  } finally {
    await page.goto("about:blank").catch(() => undefined);
    await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS fail_probe_post_update ON "Post"');
    await db.$executeRawUnsafe("DROP FUNCTION IF EXISTS fail_probe_post_update()");
    await db.post.deleteMany({ where: { id: post.id } });
    await db.$disconnect();
  }
});

test("keeps the Home navigation sticky above the scrollable felt board", async ({ page }) => {
  test.setTimeout(120_000);
  // 回归对象：SiteNav 在 /home 上必须吸顶。页面容器 .home-linen-page 一旦是粘性元素的
  // 滚动容器（overflow: hidden），sticky 就相对该容器解析，导航随文档滚走。
  const databaseUrl = process.env.E2E_DATABASE_URL
    ?? (await readFile(resolve("test-results/.e2e-database-url"), "utf8")).trim();
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const suffix = Date.now().toString(36);
  const postIds: string[] = [];
  const photoId = `e2e-home-nav-${suffix}-photo`;
  const photoCaption = `导航吸顶越界照片 ${suffix}`;
  const navLinkNames = ["Blog", "Chat", "Study", "New Post"] as const;

  const navTop = () => page.locator("nav").evaluate((nav) => nav.getBoundingClientRect().top);
  const scrollTo = (target: number) =>
    page.evaluate(async (y) => {
      window.scrollTo(0, y);
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
      return window.scrollY;
    }, target);
  // elementFromPoint 是「用户此刻真的点得到它吗」的判据：遮挡或滚出视口都会命中别的元素。
  const hitTestNavLink = (name: string) =>
    page.evaluate((linkName) => {
      const link = Array.from(document.querySelectorAll("nav a"))
        .find((candidate) => candidate.textContent?.trim() === linkName);
      if (!link) return { found: false, hits: false };
      const rect = link.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return { found: true, hits: Boolean(hit && (hit === link || link.contains(hit))) };
    }, name);

  try {
    const user = await db.user.findUniqueOrThrow({ where: { email: E2E_USERS[0].email } });
    // 时间线随文章增长：用真实 Post 把文档撑到足以滚动 1200px 的长度。
    for (let index = 0; index < 12; index += 1) {
      const post = await db.post.create({
        data: {
          slug: `e2e-home-nav-${suffix}-${index}`,
          title: `导航吸顶文章 ${index} ${suffix}`,
          content: `导航吸顶内容 ${index}`,
          authorId: user.id,
          publishedAt: new Date(Date.now() - index * 60_000),
        },
      });
      postIds.push(post.id);
    }
    // 照片的 x/y 没有夹取（拖拽时按位移累加），用户可以把照片拖出容器右边界；这条记录
    // 守住「越界元素仍被容器裁掉」——容器不再裁切时文档会出现横向滚动条。
    await db.atlasBoard.upsert({ where: { id: "home-board" }, update: {}, create: { id: "home-board" } });
    await db.atlasElement.create({
      data: {
        id: photoId, boardId: "home-board", type: "photo",
        x: 1250, y: 120, width: 240, height: 180,
        caption: photoCaption, imageUrl: "/brand/logo_white.svg", createdById: user.id,
      },
    });

    await page.goto("/home");
    await expect(page.locator(".home-linen-page")).toBeVisible();
    await expect(page.getByRole("img", { name: photoCaption, exact: true })).toBeVisible();

    const enoughContent = await page.evaluate(() => ({
      scrollable: document.documentElement.scrollHeight - window.innerHeight,
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    // 内容不足会让「滚动 1200px」变成空断言，这里先失败而不是静默弱化。
    expect(enoughContent.scrollable).toBeGreaterThanOrEqual(1200);

    // 滚动前：导航吸顶、四个入口可见且可点击。
    expect(await navTop()).toBe(0);
    for (const name of navLinkNames) {
      await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
      expect(await hitTestNavLink(name)).toEqual({ found: true, hits: true });
    }

    // 滚动 1200px 后：导航仍吸顶在视口顶部，入口依旧可见、可点击。
    expect(await scrollTo(1200)).toBeGreaterThanOrEqual(1200);
    expect(await navTop()).toBe(0);
    for (const name of navLinkNames) {
      await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
      expect(await hitTestNavLink(name)).toEqual({ found: true, hits: true });
    }

    // 越界照片不得把容器之外的内容带进文档：横向不出现滚动条（裁切语义未被删除）。
    expect(await page.evaluate(() => document.documentElement.scrollWidth))
      .toBe(enoughContent.clientWidth);

    // 吸顶状态下真实点击仍能完成导航，而不是只通过位置断言。
    await page.getByRole("link", { name: "Chat", exact: true }).click();
    await expect(page).toHaveURL(/\/chat(\/|$)/);
  } finally {
    await db.atlasElement.deleteMany({ where: { id: photoId } });
    await db.post.deleteMany({ where: { id: { in: postIds } } });
    await db.$disconnect();
  }
});

test("keeps the Home board working on the Atlas surface it still shares", async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  if (!baseURL) {
    throw new Error("Playwright baseURL is required for the Home shared-surface journey");
  }
  // 回归对象：退役 `/atlas` 页面与其 SSE 传输（feat-078）时，Home 与它共享的运行时面必须原样可用——
  // 共享的是 `/api/atlas/uploads/[filename]` 读取路由与 atlas-storage 适配层，Home 照片的
  // `<img src>` 正是这条读取路由。只断言「/home 返回 200」抓不到这条路径断掉：照片仍会渲染成
  // 破图。这里走完整旅程：真实上传字节 → 记录返回的 imageUrl → 该 URL 读回同一份字节 →
  // /home 中浏览器真实解码成图。
  await page.setViewportSize({ width: 1600, height: 1000 });
  const databaseUrl = process.env.E2E_DATABASE_URL
    ?? (await readFile(resolve("test-results/.e2e-database-url"), "utf8")).trim();
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const suffix = Date.now().toString(36);
  const caption = `退役后共享面照片 ${suffix}`;
  const photoElement = () =>
    page.locator("[data-home-photo]").filter({ has: page.getByRole("img", { name: caption, exact: true }) });

  try {
    const user = await db.user.findUniqueOrThrow({ where: { email: E2E_USERS[0].email } });
    await db.atlasBoard.upsert({ where: { id: "home-board" }, update: {}, create: { id: "home-board" } });

    const uploadResponse = await page.request.post("/api/home-board/uploads", {
      headers: { origin: baseURL },
      multipart: {
        file: { name: "home-photo.png", mimeType: "image/png", buffer: MINIMAL_PNG },
        x: "24", y: "80", caption, width: "240", height: "180",
      },
    });
    expect(uploadResponse.status()).toBe(201);
    const uploaded = (await uploadResponse.json()) as { element: { id: string; imageUrl: string } };
    // 共享面就在这里：Home 的上传路由把图片写进 atlas-storage，回读 URL 指向 atlas 读取路由。
    expect(uploaded.element.imageUrl.startsWith("/api/atlas/uploads/")).toBe(true);

    // 读回同一份字节：状态、内容类型与字节都必须是真实图片，而不是任何错误页。
    const readResponse = await page.request.get(uploaded.element.imageUrl);
    expect(readResponse.status()).toBe(200);
    expect(readResponse.headers()["content-type"]).toBe("image/png");
    expect(Buffer.compare(await readResponse.body(), MINIMAL_PNG)).toBe(0);

    await page.goto("/home");
    await expect(photoElement()).toBeVisible();
    // naturalWidth 是「浏览器真的解码了这份字节」的判据：读取路由返回错误页或截断内容时，
    // 元素仍在 DOM 里可见（alt 文本），但解码宽度为 0。
    await expect.poll(() => photoElement().locator("img").evaluate((img) => (img as HTMLImageElement).naturalWidth))
      .toBe(1);

    // 共享面之外的 Home 写入路径同样不受退役影响：拖动位置仍能落库并回读。
    const moved = await page.request.patch(`/api/home-board/elements/${uploaded.element.id}`, {
      headers: { origin: baseURL },
      data: { x: 320 },
    });
    expect(moved.status()).toBe(200);
    await expect.poll(async () =>
      (await db.atlasElement.findUniqueOrThrow({ where: { id: uploaded.element.id } })).x
    ).toBe(320);
  } finally {
    await db.atlasElement.deleteMany({ where: { caption } });
    await db.$disconnect();
  }
});

test("keeps the retired Atlas page and its SSE transport unreachable", async ({ page }) => {
  test.setTimeout(120_000);
  // 回归对象：`/chat/[roomId]/atlas` 页面与 `/api/atlas/stream` 传输已于 2026-09-21 退役
  // （feat-078，来源 QAM-06-008）——该页无任何导航入口，其 SSE 路由每放弃一条连接就泄漏
  // 一个永久轮询。这条用例守住「不再可达」：重新引入任一入口都会让它变红。
  const databaseUrl = process.env.E2E_DATABASE_URL
    ?? (await readFile(resolve("test-results/.e2e-database-url"), "utf8")).trim();
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const roomId = `e2e-atlas-retired-${Date.now().toString(36)}`;

  try {
    const viewer = await db.user.findUniqueOrThrow({ where: { email: E2E_USERS[0].email } });
    // 必须是真实房间：退役前这个 URL 会渲染出画布页，404 才有意义。
    await db.room.create({ data: {
      id: roomId, slug: roomId, name: "退役画布回归",
      participants: { create: { userId: viewer.id, role: "owner" } },
    } });

    // 传输面：已认证请求也必须是 404。若被重新引入且仍在流式输出，这里会有界超时失败，
    // 而不是一直挂着——守卫的失败必须是快的、可读的。
    const streamResponse = await page.request.get("/api/atlas/stream", { timeout: 15_000 });
    expect(streamResponse.status()).toBe(404);

    // 页面面：退役的路由不再渲染。
    const pageResponse = await page.request.get(`/chat/${roomId}/atlas`);
    expect(pageResponse.status()).toBe(404);

    // 正向对照（同时证明会话确实已认证）：被保留的 Atlas API 子树仍在服务。没有它，
    // 「整棵 /api/atlas 子树挂掉」也会让上面的 404 通过；未认证时这里会得到 401。
    const boardResponse = await page.request.get("/api/atlas");
    expect(boardResponse.status()).toBe(200);
    expect(await boardResponse.json()).toMatchObject({ boardId: "atlas-global-board" });

    // 正向对照：接替它的产品面（Home 空间毡板）仍然可达。
    expect((await page.goto("/home"))?.status()).toBe(200);
  } finally {
    await db.room.deleteMany({ where: { id: roomId } });
    await db.$disconnect();
  }
});
