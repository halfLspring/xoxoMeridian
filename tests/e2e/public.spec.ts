import { expect, test, type Page } from "@playwright/test";

import {
  ABOUT_PHOTOS,
  aboutPhotoExists,
  clearStagedAboutPhoto,
  matchAboutPhotoRequest,
  type AboutPhotoSpec,
} from "./support/about-photos";
import { E2E_PASSWORD, E2E_USERS } from "./support/credentials";

async function expectLoadedPortrait(page: Page, photo: AboutPhotoSpec) {
  const portrait = page.getByRole("img", { name: photo.alt });
  await expect(portrait).toBeVisible();
  // naturalWidth 只在浏览器真实解码出交付资源后才大于 0。
  await expect
    .poll(() => portrait.evaluate((element: HTMLImageElement) => element.naturalWidth))
    .toBeGreaterThan(0);
  await expect(page.locator(`img[src*="${photo.id}.jpg"]`)).toHaveCount(1);
}

async function expectFallbackPortrait(page: Page, photo: AboutPhotoSpec) {
  const portrait = page.getByRole("img", { name: photo.alt });
  await expect(portrait).toBeVisible();
  await expect(portrait).toContainText("photo coming soon");
  await expect(page.locator(`img[src*="${photo.id}.jpg"]`)).toHaveCount(0);
}

test("shows accessible login and registration forms", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "欢迎回来！" })).toBeVisible();
  await expect(page.getByLabel("邮箱")).toBeVisible();
  await expect(page.getByLabel("密码", { exact: true })).toBeVisible();

  await page.locator("form").getByRole("button", { name: "注册", exact: true }).click();
  await expect(page.getByRole("heading", { name: "创建账号" })).toBeVisible();
  await expect(page.getByLabel("昵称")).toBeVisible();
  await expect(page.getByLabel("邀请码")).toBeVisible();
});

test("表单保留字号、焦点和桌面及窄屏布局", async ({ page }) => {
  for (const width of [1280, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    const email = page.getByLabel("邮箱");
    const submit = page.locator("form").getByRole("button", { name: "登录", exact: true });
    await expect(email).toHaveCSS("font-size", "15px");
    await expect(email).toHaveCSS("font-weight", "500");
    await expect(email).toHaveCSS("line-height", "22.5px");
    await expect(email).toHaveCSS("padding", "12px 16px");
    await expect(email).toHaveCSS("border-radius", "10px");
    await expect(submit).toHaveCSS("font-size", "15px");
    await expect(submit).toHaveCSS("font-weight", "600");
    await expect(submit).toHaveCSS("cursor", "pointer");
    await email.focus();
    await page.keyboard.type("layout@example.com");
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("密码", { exact: true })).toBeFocused();
    await expect(email).toHaveValue("layout@example.com");
    const visual = page.getByTestId(/^auth-visual-layer-/).first();
    if (width >= 1024) await expect(visual).toBeVisible();
    else await expect(visual).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
});

test("serves the shared brand mark and browser tab icon", async ({ page }) => {
  for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");

    const brandLink = page.getByRole("link", { name: "XOXO Meridian" });
    const brandMark = brandLink.locator("img");
    await expect(brandLink).toBeVisible();
    await expect(brandLink).toHaveAttribute("href", "/home");
    await expect(brandMark).toHaveAttribute("src", "/brand/logo_transparent.svg");
    await expect(brandMark).toHaveAttribute("alt", "");
    await expect(brandMark).toHaveCSS("width", "24px");
    await expect(brandMark).toHaveCSS("height", "24px");
    await expect(brandMark.locator("..")).toHaveCSS("width", "32px");
    await expect(brandMark.locator("..")).toHaveCSS("height", "32px");

    const brandBox = await brandLink.boundingBox();
    expect(brandBox).not.toBeNull();
    expect((brandBox?.x ?? width) + (brandBox?.width ?? 0)).toBeLessThanOrEqual(width);
  }

  const iconLink = page.locator('head link[rel="icon"]');
  await expect(iconLink).toHaveAttribute("href", "/brand/logo_white.svg");
  await expect(iconLink).toHaveAttribute("type", "image/svg+xml");
  await expect(iconLink).toHaveAttribute("sizes", "any");

  const iconResponse = await page.request.get("/brand/logo_white.svg");
  expect(iconResponse.ok()).toBe(true);
  expect(iconResponse.headers()["content-type"]).toContain("image/svg+xml");

  const renderedIconSizes = await page.evaluate(async () => {
    return Promise.all([16, 32].map(async (size) => {
      const image = new Image(size, size);
      image.src = "/brand/logo_white.svg";
      image.style.width = `${size}px`;
      image.style.height = `${size}px`;
      document.body.append(image);
      await image.decode();
      const bounds = image.getBoundingClientRect();
      image.remove();
      return { width: bounds.width, height: bounds.height };
    }));
  });
  expect(renderedIconSizes).toEqual([
    { width: 16, height: 16 },
    { width: 32, height: 32 },
  ]);
});

test("supports password visibility and recovery entry points", async ({ page }) => {
  await page.goto("/");
  const password = page.getByLabel("密码", { exact: true });
  await password.fill("visible-password");
  await page.getByRole("button", { name: "显示密码" }).click();
  await expect(password).toHaveAttribute("type", "text");

  await page.getByRole("link", { name: "忘记密码？" }).click();
  await expect(page.getByRole("heading", { name: "重置密码" })).toBeVisible();
  await expect(page.getByLabel("邮箱")).toBeVisible();
});

test("redirects anonymous visitors away from protected pages", async ({ page }) => {
  await page.goto("/home");

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "欢迎回来！" })).toBeVisible();
});

test("About 照片按交付状态加载或回退，且不产生损坏请求", async ({ page }) => {
  const responses: { path: string; status: number }[] = [];
  page.on("response", (response) => {
    const path = matchAboutPhotoRequest(response.url());
    if (path) responses.push({ path, status: response.status() });
  });

  const requestedPaths = () => [...new Set(responses.map((entry) => entry.path))].sort();
  const failedRequests = () => responses.filter((entry) => entry.status >= 400);

  // 交付状态由服务启动时 public 目录的内容决定：start-test-app.ts 会在启动前暂存第一张免费的照片，
  // 干净工作树因此表现为“一张已交付 + 一张缺失”。
  const delivered = new Set<string>();
  for (const photo of ABOUT_PHOTOS) {
    if (await aboutPhotoExists(photo.publicPath)) delivered.add(photo.publicPath);
  }
  if (!process.env.PLAYWRIGHT_BASE_URL) {
    // 托管模式下 start-test-app.ts 保证启动前已交付一张照片；缺了这条保护，
    // “两张都缺失”也会全回退通过，本用例会静默失去已交付分支的覆盖。
    expect(delivered.size, "E2E 托管应用应至少交付一张 About 照片（start-test-app.ts 启动前暂存）").toBeGreaterThan(0);
  }

  try {
    // 阶段一：已交付的照片必须真实加载，缺失的照片渲染回退，且只请求实际交付的路径。
    await page.goto("/about");
    for (const photo of ABOUT_PHOTOS) {
      if (delivered.has(photo.publicPath)) await expectLoadedPortrait(page, photo);
      else await expectFallbackPortrait(page, photo);
    }
    expect(failedRequests()).toEqual([]);
    expect(requestedPaths()).toEqual([...delivered].sort());

    // 阶段二：移除 E2E 暂存的照片；回退立即恢复且不再请求该路径。
    const cleared: AboutPhotoSpec[] = [];
    for (const photo of ABOUT_PHOTOS) {
      if (await clearStagedAboutPhoto(photo.publicPath)) cleared.push(photo);
    }
    if (cleared.length === 0) {
      test.info().annotations.push({
        type: "about-photo-removal",
        description: "交付目录里没有 E2E 暂存的照片（两张都是交付方真实资源），跳过移除后的回退验证。",
      });
      return;
    }
    responses.length = 0;
    await page.reload();
    for (const photo of cleared) await expectFallbackPortrait(page, photo);
    expect(failedRequests()).toEqual([]);
    expect(requestedPaths()).toEqual([]);
  } finally {
    for (const photo of ABOUT_PHOTOS) await clearStagedAboutPhoto(photo.publicPath);
  }
});

test("logs an existing user in through the browser", async ({ page }) => {
  const loginUser = E2E_USERS[1];

  await page.goto("/");
  await page.getByLabel("邮箱").fill(loginUser.email);
  await page.getByLabel("密码", { exact: true }).fill(E2E_PASSWORD);
  await page.locator("form").getByRole("button", { name: "登录", exact: true }).click();

  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole("link", { name: loginUser.displayName })).toBeVisible();
});
