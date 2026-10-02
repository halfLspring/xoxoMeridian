import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import bcrypt from "bcryptjs";

import { E2E_PASSWORD } from "./support/credentials";

let email: string;
const displayName = "开发来源测试";

test.beforeAll(async () => {
  const databaseUrl = (await readFile("test-results/.e2e-database-url", "utf8")).trim();
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  email = `dev-origin-${randomUUID()}@example.com`;
  try {
    await db.user.create({ data: {
      email, displayName, avatarLabel: "测试", passwordHash: await bcrypt.hash(E2E_PASSWORD, 10),
      profile: { create: { city: "—", country: "—", timezone: "Asia/Shanghai" } },
      participants: { create: { room: { connect: { slug: "e2e-room" } } } },
    } });
  } finally {
    await db.$disconnect();
  }
  // 账号、文章和会话只写入本次 Testcontainer，服务退出时整体回收。
});

test("两个主机各自通过浏览器登录并建立可操作的会话", async ({ page, context, baseURL }) => {
  if (!baseURL) throw new Error("开发双地址回归需要隔离服务地址。");
  await context.clearCookies();
  await page.goto("/");
  await page.getByLabel("邮箱", { exact: true }).fill(email);
  await page.getByLabel("密码", { exact: true }).fill(E2E_PASSWORD);
  const login = page.waitForResponse(response => new URL(response.url()).pathname === "/api/auth/login");
  await page.locator("form").getByRole("button", { name: "登录", exact: true }).click();
  expect((await login).status()).toBe(200);
  await expect(page).toHaveURL(`${baseURL}/home`);
  await page.waitForLoadState("load");
  await expect(page.getByRole("link", { name: displayName, exact: true })).toBeVisible();
  await page.getByRole("link", { name: "New Post", exact: true }).click();
  await expect(page).toHaveURL(`${baseURL}/posts/new`);
  await page.waitForLoadState("load");
  await expect(page.getByRole("heading", { name: "New Post", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page).toHaveURL(`${baseURL}/home`);
});

for (const entry of ["直接访问", "Blog 点击进入", "刷新后继续"] as const) {
  test(`0.0.0.0 监听下 New Post ${entry}可水合、发布并返回 Blog`, async ({ page, context, baseURL }) => {
    if (!baseURL) throw new Error("开发双地址回归需要隔离服务地址。");
    await context.clearCookies();
    const login = await context.request.post("/api/auth/login", {
      headers: { origin: baseURL },
      data: { email, password: E2E_PASSWORD },
    });
    expect(login.status()).toBe(200);
    const cookies = await context.cookies(baseURL);
    expect(cookies.length).toBeGreaterThan(0);
    expect(cookies.every(cookie => cookie.domain === new URL(baseURL).hostname)).toBe(true);
    const health = await context.request.get("/api/health");
    expect(health.status()).toBe(200);

    const cdp = await context.newCDPSession(page);
    const handshakes: number[] = [];
    const origins: string[] = [];
    const socketErrors: string[] = [];
    await cdp.send("Network.enable");
    cdp.on("Network.webSocketHandshakeResponseReceived", event => handshakes.push(event.response.status));
    cdp.on("Network.webSocketWillSendHandshakeRequest", event => origins.push(event.request.headers.Origin));
    cdp.on("Network.webSocketFrameError", event => socketErrors.push(event.errorMessage));

    if (entry === "Blog 点击进入") {
      await page.goto("/home");
      await page.getByRole("link", { name: "New Post", exact: true }).click();
    } else {
      await page.goto("/posts/new");
    }
    if (entry === "刷新后继续") {
      await expect.poll(() => handshakes.length, "刷新前开发 WebSocket 已连接").toBeGreaterThan(0);
      handshakes.length = 0;
      await page.reload();
    }
    await expect(page.getByRole("heading", { name: "New Post", exact: true })).toBeVisible();
    // 101 证明握手确实完成，而非仅创建了 WebSocket 对象或收到 HTML。
    await expect.poll(() => handshakes.length, "开发 WebSocket 握手成功").toBeGreaterThan(0);
    expect(handshakes.every(status => status === 101)).toBe(true);
    expect(origins.every(origin => origin === baseURL)).toBe(true);
    expect(socketErrors).toEqual([]);

    const title = `开发来源 ${entry} ${randomUUID()}`;
    const content = `通过 ${new URL(baseURL).hostname} 验证受控输入与发布。`;
    await page.getByLabel("Post title", { exact: true }).fill(title);
    await page.getByLabel("Post content", { exact: true }).fill(content);
    const published = page.waitForResponse(response =>
      response.request().method() === "POST" && Boolean(response.request().headers()["next-action"]),
    );
    const detail = page.waitForResponse(response => {
      const path = new URL(response.url()).pathname;
      return response.request().method() === "GET" && path.startsWith("/posts/") && path !== "/posts/new";
    });
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    expect((await published).status()).toBe(200);
    expect((await detail).status()).toBe(200);
    await (await detail).finished();
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await expect(page.getByText(content, { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Blog", exact: true }).click();
    await expect(page).toHaveURL(`${baseURL}/home`);
    await expect(page.getByRole("link", { name: displayName, exact: true })).toBeVisible();
    expect(socketErrors).toEqual([]);
    console.log(`[dev-origins] host=${new URL(baseURL).hostname}，入口=${entry}，health=200，WebSocket=${handshakes.join(",")}，输入/发布/站内导航通过。`);
  });
}
