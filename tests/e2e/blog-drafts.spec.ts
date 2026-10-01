import { randomUUID } from "node:crypto";
import { expect, test, type Frame, type Locator, type Page } from "@playwright/test";
import { withStudyUser } from "@/tests/e2e/support/study";
import { E2E_PASSWORD, E2E_USERS } from "@/tests/e2e/support/credentials";
import { MINIMAL_PNG as png } from "@/tests/fixtures/image-bytes";

async function openDraftSelection(page: Page) {
  await page.mouse.click(80, 140, { button: "right" });
  await page.getByRole("button", { name: "新增草稿", exact: true }).click();
}

async function resizeFrame(page: Page, editor: Locator, width: number, height: number) {
  const frame = (await editor.locator(".work-frame").boundingBox())!;
  const scale = await editor.locator(".work-scene").evaluate(node => new DOMMatrixReadOnly(getComputedStyle(node).transform).a);
  const corner = (await editor.getByRole("button", { name: "调整草稿右下边界", exact: true }).boundingBox())!;
  const x = corner.x + corner.width / 2, y = corner.y + corner.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + width * scale - frame.width, y + height * scale - frame.height, { steps: 6 });
  await page.mouse.up();
}

test.describe("作品时间水合", () => {
  test.use({ locale: "zh-CN", timezoneId: "America/Los_Angeles" });

  for (const scenario of [
    { timezone: "Asia/Tokyo", date: "10/01/2026", timestamp: "10/01/2026, 08:30" },
    { timezone: null, date: "09/30/2026", timestamp: "09/30/2026, 23:30" },
  ]) {
    test(`zh-CN 浏览器使用作者快照 ${scenario.timezone ?? "UTC 回退"}，服务端时间与水合一致`, async ({ context }) => {
      await withStudyUser(context, async ({ page, db, userId }) => {
        const instant = new Date("2026-09-30T23:30:00.000Z");
        const createWork = async (status: "published" | "draft") => {
          const work = await db.blogWork.create({ data: {
            owner: { connect: { id: userId } },
            board: { connectOrCreate: { where: { id: "home-board" }, create: { id: "home-board" } } },
            status, publishedAt: status === "published" ? instant : null, updatedAt: instant,
          } });
          const post = await db.post.create({ data: {
            workId: work.id, authorId: userId, workOrder: 0, slug: randomUUID(),
            title: `${status} 时间回归`, content: "跨日时间", authorTimezone: scenario.timezone,
            publishedAt: status === "published" ? instant : null,
          } });
          await db.atlasElement.create({ data: {
            workId: work.id, boardId: "home-board", postId: post.id,
            type: "note", x: 0, y: 0, width: 352, height: 180,
          } });
          return { work, post };
        };
        const published = await createWork("published"), draft = await createWork("draft");
        await db.blogWork.create({ data: { ownerId: userId, boardId: "home-board", updatedAt: instant } });
        const errors: string[] = [];
        page.on("pageerror", error => errors.push(error.message));
        page.on("console", message => {
          if (message.type() === "error" && /hydrat|server rendered|didn't match|Minified React error #(?:418|423|425)/i.test(message.text())) errors.push(message.text());
        });
        const response = await page.goto("/home");
        expect(response?.status()).toBe(200);
        const html = await response!.text();
        const selectors = [
          `[data-work-id="${published.work.id}"] .work-badge`,
          `[data-work-post="${published.post.id}"] .work-post-meta`,
        ];
        const serverText = await page.evaluate(({ html, selectors }) => {
          const doc = new DOMParser().parseFromString(html, "text/html");
          return selectors.map(selector => doc.querySelector(selector)?.textContent?.trim());
        }, { html, selectors });
        // 成功打开并读取列表证明页面已水合；同时检查原始响应里的时间，避免只有客户端渲染的假通过。
        await page.getByRole("link", { name: "My Draft", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "My Draft" });
        const draftButton = dialog.getByRole("button", { name: /^draft 时间回归/ });
        await expect(draftButton).toBeVisible();
        expect(errors).toEqual([]);
        for (let index = 0; index < selectors.length; index++) {
          expect(serverText[index]).toBeTruthy();
          await expect(page.locator(selectors[index])).toHaveText(serverText[index]!);
        }
        expect(serverText).toEqual([
          `E2E Focus · ${scenario.date}`,
          `E2E Focus · ${scenario.timestamp}`,
        ]);
        await expect(draftButton.locator("time")).toHaveText(scenario.timestamp);
        await expect(dialog.getByRole("button", { name: /^未命名草稿/ }).locator("time")).toHaveText("09/30/2026, 23:30");
        await draftButton.click();
        const editor = page.getByRole("region", { name: "空间草稿" });
        await expect(editor.locator(".work-post-meta")).toHaveText(`E2E Focus · ${scenario.timestamp} 草稿`);
        // 草稿通过水合后的读取请求恢复；刷新仍必须保持相同的显式时间语义。
        await page.goto(`/home?draft=${draft.work.id}`);
        await expect(editor.locator(".work-post-meta")).toHaveText(`E2E Focus · ${scenario.timestamp} 草稿`);
        expect(errors).toEqual([]);
      });
    });
  }
});

test("My Draft 首次点击可靠打开，关闭后可再次选择并转到右键新建", async ({ context }) => {
  await withStudyUser(context, async ({ page }) => {
    await page.goto("/home?draft=new", { waitUntil: "domcontentloaded" });
    const drafts = page.getByRole("link", { name: "My Draft", exact: true });
    const loaded = page.waitForResponse(reply => new URL(reply.url()).pathname === "/api/blog/works" && reply.request().method() === "GET");
    await drafts.click();
    await expect(page.getByRole("dialog", { name: "My Draft" })).toBeVisible();
    // 先验证首次点击，再同步真实列表响应；开发模式可能尚在首次编译 API。
    expect((await loaded).status()).toBe(200);
    await expect(page.getByRole("dialog", { name: "My Draft" })).toContainText("右键选择“新增草稿”");
    await page.getByRole("button", { name: "关闭My Draft", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "My Draft" })).toHaveCount(0);
    // 首次点击可能早于水合而走原生深链；水合后必须原地打开，不再触发导航。
    const currentUrl = page.url(), navigations: string[] = [];
    const recordNavigation = (frame: Frame) => { if (frame === page.mainFrame()) navigations.push(frame.url()); };
    page.on("framenavigated", recordNavigation);
    await drafts.click();
    await expect(page.getByRole("dialog", { name: "My Draft" })).toBeVisible();
    await expect(page).toHaveURL(currentUrl);
    expect(navigations).toEqual([]);
    page.off("framenavigated", recordNavigation);
    await page.getByRole("button", { name: "关闭My Draft", exact: true }).click();
    await openDraftSelection(page);
    await expect(page.getByRole("group", { name: "框选草稿区域" })).toHaveCount(1);
    await expect(page.getByRole("button", { name: "新增草稿", exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("group", { name: "框选草稿区域" })).toHaveCount(0);
    expect((await (await page.request.get("/api/blog/works")).json()).drafts).toHaveLength(0);
  });
});

test("My Draft 保留未保存修改的离开守卫，确认保存后再打开列表", async ({ context }) => {
  await withStudyUser(context, async ({ page, db, userId }) => {
    const work = await db.blogWork.create({ data: {
      owner: { connect: { id: userId } },
      board: { connectOrCreate: { where: { id: "home-board" }, create: { id: "home-board" } } },
    } });
    const loaded = page.waitForResponse(reply => new URL(reply.url()).pathname === `/api/blog/works/${work.id}` && reply.request().method() === "GET");
    await page.goto(`/home?draft=${work.id}`);
    expect((await loaded).status()).toBe(200);
    const editor = page.getByRole("region", { name: "空间草稿" });
    await expect(editor).toBeVisible();
    let release!: () => void, ready!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const requested = new Promise<void>(resolve => { ready = resolve; });
    await page.route(`**/api/blog/works/${work.id}`, async route => {
      if (route.request().method() !== "PATCH") { await route.continue(); return; }
      const response = await route.fetch();
      ready();
      await held;
      await route.fulfill({ response });
    });
    try {
      await editor.getByRole("button", { name: "博文", exact: true }).click();
      await requested;
      await page.getByRole("link", { name: "My Draft", exact: true }).click();
      await expect(editor.getByText("正在等待保存后离开。", { exact: true })).toBeVisible();
      await expect(page.getByRole("dialog", { name: "My Draft" })).toHaveCount(0);
      release();
      await expect(page.getByRole("dialog", { name: "My Draft" })).toBeVisible();
      await expect(page.getByRole("region", { name: "空间草稿" })).toHaveCount(0);
      expect(await db.post.count({ where: { workId: work.id } })).toBe(1);
    } finally {
      release();
      await page.unrouteAll({ behavior: "wait" });
    }
  });
});

for (const kind of ["draft", "work"] as const) {
  test(`${kind} 深链首次加载进入编辑器，退出后不会重新打开`, async ({ context }) => {
    await withStudyUser(context, async ({ page, db, userId }) => {
      const work = await db.blogWork.create({ data: {
        owner: { connect: { id: userId } },
        board: { connectOrCreate: { where: { id: "home-board" }, create: { id: "home-board" } } },
        status: kind === "draft" ? "draft" : "published",
        publishedAt: kind === "work" ? new Date("2026-09-30T00:00:00Z") : null,
      } });
      // 新页面直接进入深链，开发模式会真实经历 Strict Mode 的 effect 重放。
      const response = page.waitForResponse(reply => new URL(reply.url()).pathname === `/api/blog/works/${work.id}` && reply.request().method() === "GET");
      await page.goto(`/home?${kind}=${work.id}`);
      expect((await response).status()).toBe(200);
      const editor = page.locator(".active-draft").getByRole("region", { name: kind === "draft" ? "空间草稿" : "已发布作品" });
      await expect(editor).toHaveAttribute("data-work-id", work.id);
      await expect(editor).toBeVisible();
      await expect(page.getByText("正在打开作品…", { exact: true })).toHaveCount(0);
      await editor.getByRole("button", { name: kind === "draft" ? "退出草稿" : "退出编辑", exact: true }).click();
      await expect(page).toHaveURL(/\/home$/);
      await expect(page.locator(".active-draft")).toHaveCount(0);
      await page.reload();
      await expect(page.locator(".active-draft")).toHaveCount(0);
    });
  });
}

test("深链读取中切到 My Draft 并退出，迟到响应不会重开草稿", async ({ context }) => {
  await withStudyUser(context, async ({ page, db, userId }) => {
    const work = await db.blogWork.create({ data: {
      owner: { connect: { id: userId } },
      board: { connectOrCreate: { where: { id: "home-board" }, create: { id: "home-board" } } },
    } });
    let release!: () => void, ready!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const requested = new Promise<void>(resolve => { ready = resolve; });
    const path = `/api/blog/works/${work.id}`;
    await page.route(`**${path}`, async route => {
      const response = await route.fetch();
      ready();
      await held;
      await route.fulfill({ response });
    });
    try {
      await page.goto(`/home?draft=${work.id}`);
      await requested;
      await expect(page.getByText("正在打开作品…", { exact: true })).toBeVisible();
      await page.getByRole("link", { name: "My Draft", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "My Draft" })).toBeVisible();
      await page.getByRole("button", { name: "关闭My Draft", exact: true }).click();
      const response = page.waitForResponse(reply => new URL(reply.url()).pathname === path);
      release();
      await (await response).finished();
      // Strict Mode 可能发起多次读取；等所有被暂存的响应送达后再断言。
      await page.unrouteAll({ behavior: "wait" });
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
      await expect(page.getByText("正在打开作品…", { exact: true })).toHaveCount(0);
      await expect(page.locator(".active-draft")).toHaveCount(0);
      await expect(page.getByRole("dialog", { name: "My Draft" })).toHaveCount(0);
    } finally {
      release();
      await page.unrouteAll({ behavior: "wait" });
    }
  });
});

test("草稿各尺寸只有一层蒙版，精简工具栏贴底且已移除辅助入口", async ({ context }, testInfo) => {
  await withStudyUser(context, async ({ page, db, userId }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    for (const [width, height] of [[1000, 479], [1000, 480], [1000, 481], [1000, 240], [160, 120]]) {
      const work = await db.blogWork.create({ data: { owner: { connect: { id: userId } }, board: { connectOrCreate: { where: { id: "home-board" }, create: { id: "home-board" } } }, draftX: 100, draftY: 60, viewportWidth: width, viewportHeight: height } });
      await page.goto(`/home?draft=${work.id}`);
      const editor = page.getByRole("region", { name: "空间草稿" });
      await expect(editor).toBeVisible();
      await page.waitForFunction(() => [...document.querySelectorAll(".page-enter")].every(node => node.getAnimations().every(animation => animation.playState === "finished")));
      const frame = (await editor.locator(".work-frame").boundingBox())!;
      expect(await editor.boundingBox()).toEqual(frame);
      expect(frame.width).toBe(width);
      expect(frame.height).toBe(height);
      await expect(editor.getByRole("button", { name: /^调整草稿.+边界$/ })).toHaveCount(8);
      const toolbar = editor.getByRole("toolbar", { name: "草稿工具栏" });
      await expect(toolbar.getByRole("button")).toHaveText(["博文", "图片", "连线"]);
      const bar = (await toolbar.boundingBox())!;
      if (height >= 240) {
        expect(frame.y + frame.height - bar.y - bar.height).toBeCloseTo(8, 0);
        expect(bar.x + bar.width / 2).toBeCloseTo(frame.x + frame.width / 2, 0);
      } else {
        expect(bar.y).toBeGreaterThan(frame.y + frame.height);
      }
      await expect(editor.getByRole("button", { name: /^(内容列表|放大查看|调整边框)$/ })).toHaveCount(0);
      await expect(editor.getByText("整组内容（含被裁切的部分）将公开。")).toHaveCount(0);
      for (const name of ["退出草稿", "发布", "博文", "图片", "连线"]) {
        await editor.getByRole("button", { name, exact: true }).click({ trial: true });
      }
      await page.screenshot({ path: testInfo.outputPath(`frame-${width}x${height}.png`) });
    }
  });
});

test("调整草稿边界时蒙版和控件随动，内容不平移且保存恢复不跳位", async ({ context }, testInfo) => {
  await withStudyUser(context, async ({ page, db, userId }) => {
    const work = await db.blogWork.create({ data: { owner: { connect: { id: userId } }, board: { connectOrCreate: { where: { id: "home-board" }, create: { id: "home-board" } } }, draftX: 100, draftY: 80, viewportWidth: 1000, viewportHeight: 600 } });
    const photo = await db.atlasElement.create({ data: { boardId: "home-board", workId: work.id, type: "photo", x: 260, y: 240, width: 240, height: 180, imageUrl: "/brand/logo_transparent.svg", caption: "边框定位回归" } });
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.goto(`/home?draft=${work.id}`);
    const editor = page.getByRole("region", { name: "空间草稿" });
    await expect(editor).toBeVisible();
    await page.waitForFunction(() => [...document.querySelectorAll(".page-enter")].every(node => node.getAnimations().every(animation => animation.playState === "finished")));
    const positions = async () => ({
      frame: (await editor.locator(".work-frame").boundingBox())!,
      badge: (await editor.locator(".work-badge").boundingBox())!,
      publish: (await editor.getByRole("button", { name: "发布", exact: true }).boundingBox())!,
      toolbar: (await editor.getByRole("toolbar", { name: "草稿工具栏" }).boundingBox())!,
      photo: (await editor.locator(`[data-element-id="${photo.id}"]`).boundingBox())!,
    });
    const start = await positions();
    const handle = editor.getByRole("button", { name: "调整草稿左上边界", exact: true });
    const corner = (await handle.boundingBox())!;
    await page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2);
    await page.mouse.down();
    await page.mouse.move(corner.x + corner.width / 2 + 80, corner.y + corner.height / 2 + 50, { steps: 6 });
    const preview = await positions();
    expect(preview.frame.x - start.frame.x).toBeCloseTo(80, 0);
    expect(preview.frame.y - start.frame.y).toBeCloseTo(50, 0);
    expect(preview.badge.x - start.badge.x).toBeCloseTo(80, 0);
    expect(preview.badge.y - start.badge.y).toBeCloseTo(50, 0);
    expect(preview.publish.x).toBeCloseTo(start.publish.x, 0);
    expect(preview.publish.y - start.publish.y).toBeCloseTo(50, 0);
    expect(preview.toolbar.x - start.toolbar.x).toBeCloseTo(40, 0);
    expect(preview.toolbar.y).toBeCloseTo(start.toolbar.y, 0);
    expect(preview.photo.x).toBeCloseTo(start.photo.x, 0);
    expect(preview.photo.y).toBeCloseTo(start.photo.y, 0);
    expect((await db.blogWork.findUniqueOrThrow({ where: { id: work.id } })).revision).toBe(0);
    await page.mouse.up();
    await expect(editor.getByText("已自动保存", { exact: true })).toBeVisible();
    expect(await positions()).toEqual(preview);
    const bottom = (await editor.getByRole("button", { name: "调整草稿右下边界", exact: true }).boundingBox())!;
    await page.mouse.move(bottom.x + 12, bottom.y + 12);
    await page.mouse.down();
    await page.mouse.move(bottom.x + 112, bottom.y + 72, { steps: 6 });
    const expanded = await positions();
    expect(expanded.frame.width - preview.frame.width).toBeCloseTo(100, 0);
    expect(expanded.frame.height - preview.frame.height).toBeCloseTo(60, 0);
    expect(expanded.badge).toEqual(preview.badge);
    expect(expanded.publish.x - preview.publish.x).toBeCloseTo(100, 0);
    expect(expanded.toolbar.x - preview.toolbar.x).toBeCloseTo(50, 0);
    expect(expanded.toolbar.y - preview.toolbar.y).toBeCloseTo(60, 0);
    expect(expanded.photo).toEqual(start.photo);
    await page.mouse.up();
    await expect(editor.getByText("已自动保存", { exact: true })).toBeVisible();
    expect(await positions()).toEqual(expanded);
    const cancel = (await handle.boundingBox())!;
    await page.mouse.move(cancel.x + 12, cancel.y + 12);
    await page.mouse.down();
    await page.mouse.move(cancel.x - 28, cancel.y - 8, { steps: 3 });
    const cancelling = await positions();
    expect(cancelling.badge.x - expanded.badge.x).toBeCloseTo(-40, 0);
    expect(cancelling.badge.y - expanded.badge.y).toBeCloseTo(-20, 0);
    expect(cancelling.photo).toEqual(start.photo);
    await page.keyboard.press("Escape");
    await page.mouse.up();
    expect(await positions()).toEqual(expanded);
    await page.reload();
    await expect(editor).toBeVisible();
    await page.waitForFunction(() => [...document.querySelectorAll(".page-enter")].every(node => node.getAnimations().every(animation => animation.playState === "finished")));
    expect(await positions()).toEqual(expanded);
    const finalToolbar = (await positions()).toolbar;
    expect(expanded.frame.y + expanded.frame.height - finalToolbar.y - finalToolbar.height).toBeCloseTo(8, 0);
    await page.screenshot({ path: testInfo.outputPath("frame-moved.png") });
  });
});

test("窄屏调整边框保持显示比例，极小窗口仍可操作全部控件", async ({ context }, testInfo) => {
  await withStudyUser(context, async ({ page, db, userId }) => {
    const work = await db.blogWork.create({ data: { owner: { connect: { id: userId } }, board: { connectOrCreate: { where: { id: "home-board" }, create: { id: "home-board" } } } } });
    const photo = await db.atlasElement.create({ data: { boardId: "home-board", workId: work.id, type: "photo", x: 240, y: 200, width: 240, height: 180, imageUrl: "/brand/logo_transparent.svg", caption: "窄屏边框" } });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/home?draft=${work.id}`);
    const editor = page.getByRole("region", { name: "空间草稿" });
    await expect(editor).toBeVisible();
    await page.waitForFunction(() => {
      const scene = document.querySelector(".active-draft .work-scene");
      return scene && new DOMMatrixReadOnly(getComputedStyle(scene).transform).a < 1 && [...document.querySelectorAll(".page-enter")].every(node => node.getAnimations().every(animation => animation.playState === "finished"));
    });
    const before = (await editor.locator(`[data-element-id="${photo.id}"]`).boundingBox())!;
    const ratio = await editor.locator(".work-scene").evaluate(node => new DOMMatrixReadOnly(getComputedStyle(node).transform).a);
    const corner = (await editor.getByRole("button", { name: "调整草稿左上边界", exact: true }).boundingBox())!;
    await page.mouse.move(corner.x + 12, corner.y + 12);
    await page.mouse.down();
    await page.mouse.move(corner.x + 32, corner.y + 27, { steps: 4 });
    const during = (await editor.locator(`[data-element-id="${photo.id}"]`).boundingBox())!;
    for (const key of ["x", "y", "width", "height"] as const) expect(during[key]).toBeCloseTo(before[key], 0);
    await page.mouse.up();
    await expect(editor.getByText("已自动保存", { exact: true })).toBeVisible();
    expect(await editor.locator(".work-scene").evaluate(node => new DOMMatrixReadOnly(getComputedStyle(node).transform).a)).toBe(ratio);
    // 为浏览器子像素取整预留 1px，最小边界的精确值另有桌面及领域回归。
    await resizeFrame(page, editor, 161, 121);
    await expect(editor.getByText("已自动保存", { exact: true })).toBeVisible();
    const frame = (await editor.locator(".work-frame").boundingBox())!;
    expect(frame.width).toBeCloseTo(161 * ratio, 0);
    expect(frame.height).toBeCloseTo(121 * ratio, 0);
    expect(await editor.boundingBox()).toEqual(frame);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const name of ["退出草稿", "发布", "博文", "图片", "连线"]) {
      await editor.getByRole("button", { name, exact: true }).click({ trial: true });
    }
    await editor.getByRole("button", { name: "博文", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "编辑博文" })).toBeVisible();
    await page.getByRole("button", { name: "关闭编辑博文", exact: true }).click();
    await expect(editor.getByRole("button", { name: "博文", exact: true })).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath("frame-mobile-minimum.png") });
  });
});

test("右键框选空白作品，双篇双图自动布局、手动连线及恢复", async ({ context }, testInfo) => {
  test.setTimeout(60_000);
  await withStudyUser(context, async ({ page, db }) => {
    await page.setViewportSize({ width: 1672, height: 941 }); await page.goto("/home");
    await page.mouse.click(80, 120, { button: "right" }); await page.getByRole("button", { name: "新增草稿", exact: true }).click();
    await page.mouse.move(137, 134); await page.mouse.down(); await page.mouse.move(1535, 677, { steps: 8 }); await page.mouse.up();
    const editor = page.getByRole("region", { name: "空间草稿" }); await expect(editor).toBeVisible();
    for (const title of ["把九月，留在这片绿色里", "一起记录下一页"]) {
      await editor.getByRole("button", { name: "博文", exact: true }).click(); await page.getByLabel("标题", { exact: true }).fill(title);
      await page.getByLabel("正文（Markdown）").fill("散步、拍照，把普通的一天慢慢记录下来。让文字与照片，留住当时的心情。"); await page.getByRole("button", { name: "关闭编辑博文" }).click();
      await expect(editor.getByText("已自动保存", { exact: true })).toBeVisible();
    }
    for (let i = 0; i < 2; i++) { await editor.getByLabel("上传作品图片").setInputFiles({ name: `image-${i}.png`, mimeType: "image/png", buffer: png }); await expect(editor.locator("img")).toHaveCount(i + 1); await expect(editor.getByText("已自动保存", { exact: true })).toBeVisible(); }
    const id = (await editor.getAttribute("data-work-id"))!, photos = await db.atlasElement.findMany({ where: { workId: id, type: "photo" }, orderBy: { createdAt: "asc" } });
    const first = editor.locator(`[data-element-id="${photos[0].id}"]`);
    await first.getByRole("button", { name: "调整照片大小：未标注照片" }).focus(); await page.keyboard.press("ArrowRight");
    await expect.poll(async () => (await db.atlasElement.findUniqueOrThrow({ where: { id: photos[0].id } })).width).toBe(130);
    await first.getByRole("button", { name: "旋转照片：未标注照片" }).focus(); await page.keyboard.press("ArrowRight");
    await expect.poll(async () => (await db.atlasElement.findUniqueOrThrow({ where: { id: photos[0].id } })).rotation).not.toBe(0);
    await editor.getByRole("button", { name: "连线", exact: true }).click(); await page.getByLabel("起点", { exact: true }).selectOption(photos[0].id); await page.getByLabel("终点", { exact: true }).selectOption(photos[1].id); await page.getByRole("button", { name: "添加连线", exact: true }).click();
    await expect(page.getByRole("button", { name: "删除作品连线 1" })).toBeVisible(); await page.getByRole("button", { name: "关闭连线" }).click();
    await expect(editor.locator("[data-work-connection]")).toHaveCount(1);
    const cards = editor.locator("[data-work-post]"), originalSecond = (await cards.nth(1).boundingBox())!.y;
    await editor.getByRole("heading", { name: "把九月，留在这片绿色里" }).click(); await page.getByLabel("正文（Markdown）").fill("更长的完整正文。\n\n".repeat(30)); await page.getByRole("button", { name: "关闭编辑博文" }).click();
    await expect.poll(async () => (await cards.nth(1).boundingBox())!.y).toBeGreaterThan(originalSecond + 300);
    await editor.getByRole("heading", { name: "把九月，留在这片绿色里" }).click(); await page.getByLabel("正文（Markdown）").fill("散步、拍照，把普通的一天慢慢记录下来。让文字与照片，留住当时的心情。"); await page.getByRole("button", { name: "关闭编辑博文" }).click();
    await expect(editor.getByText("已自动保存", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("reference-desktop.png") });
    await editor.getByRole("button", { name: "退出草稿" }).click(); await page.reload(); await page.getByRole("link", { name: "My Draft", exact: true }).click(); await page.getByRole("button", { name: /^把九月，留在这片绿色里/ }).click();
    await expect(editor.locator("[data-work-post]")).toHaveCount(2); await expect(editor.locator("img")).toHaveCount(2); await expect(editor.locator("[data-work-connection]")).toHaveCount(1);
  });
});

test("草稿自动保存、恢复、私密字节与整组发布协作", async ({ context, browser }, testInfo) => {
  test.setTimeout(90_000);
  await withStudyUser(context, async ({ page, db, userId, roomId }) => {
    const external = await db.post.create({ data: { authorId: userId, slug: `outside-${randomUUID()}`, title: "外部公开博文", content: "保留外部归属", publishedAt: new Date("2026-09-07T11:40:00Z") } });
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.setViewportSize({ width: 1672, height: 941 });
    await page.goto("/home"); await openDraftSelection(page);
    // 框选浮层对指针透明，键盘用户聚焦后按 Enter 才浮现并创建默认区域。
    await page.getByRole("button", { name: "使用默认区域" }).focus(); await page.keyboard.press("Enter");
    const editor = page.getByRole("region", { name: "空间草稿" });
    await expect(editor.getByText("DRAFT", { exact: true })).toBeVisible();
    await editor.getByRole("button", { name: "博文", exact: true }).click();
    await page.getByLabel("标题", { exact: true }).fill("把九月，留在这片绿色里");
    await page.getByLabel("正文（Markdown）").fill("散步、拍照，把普通的一天慢慢记录下来。让文字与照片，留住当时的心情。");
    await page.getByRole("button", { name: "关闭编辑博文" }).click();
    await expect(editor.getByText("已自动保存", { exact: true })).toBeVisible();
    await editor.getByLabel("上传作品图片").setInputFiles({ name: "plant.png", mimeType: "image/png", buffer: png });
    await expect(editor.locator("img")).toHaveCount(1); await expect(editor.getByText("已自动保存", { exact: true })).toBeVisible();
    await editor.getByRole("button", { name: "添加标注…", exact: true }).click();
    await editor.getByLabel("照片标注", { exact: true }).fill("窗边植物");
    await page.keyboard.press("Enter");
    await expect(editor.getByText("已自动保存", { exact: true })).toBeVisible();
    const image = editor.getByRole("img", { name: "窗边植物", exact: true });
    const imageBox = (await image.boundingBox())!;
    await page.mouse.move(imageBox.x + 30, imageBox.y + 30);
    await page.mouse.down();
    await page.mouse.move(imageBox.x - 26, imageBox.y + 30, { steps: 4 });
    await expect(editor.getByRole("button", { name: "发布", exact: true })).toBeDisabled();
    await expect(editor.getByText("保存中…", { exact: true })).toBeVisible();
    await page.mouse.up();
    await expect(editor.getByText("已自动保存", { exact: true })).toBeVisible();
    const workId = (await editor.getAttribute("data-work-id"))!;
    const snapshot = await (await page.request.get(`/api/blog/works/${workId}`)).json();
    const photo = snapshot.work.elements.find((e: { type: string }) => e.type === "photo");
    expect(photo).toMatchObject({ caption: "窗边植物", x: 520 });
    const externalAnchor = await db.atlasElement.findFirstOrThrow({ where: { postId: external.id } });
    await editor.getByRole("button", { name: "连线", exact: true }).click();
    await page.getByLabel("起点", { exact: true }).selectOption(photo.id);
    await page.getByLabel("终点", { exact: true }).selectOption(externalAnchor.id);
    await page.getByRole("button", { name: "添加连线", exact: true }).click();
    await expect(page.getByRole("button", { name: "删除作品连线 1" })).toBeVisible(); await page.getByRole("button", { name: "关闭连线" }).click();
    await expect(page.locator("[data-external-connection] path")).toHaveCount(1);
    const otherId = `e2e-blog-${randomUUID()}`, email = `${otherId}@example.com`, template = await db.user.findUniqueOrThrow({ where: { id: userId } });
    await db.user.create({ data: { id: otherId, email, passwordHash: template.passwordHash, displayName: "伙伴", avatarLabel: "伴", participants: { create: { roomId } } } });
    // 手动创建的 Context 显式清空默认 storageState，避免换号登录撤销基础账号 Session。
    const partner = await browser.newContext({ baseURL: testInfo.project.use.baseURL, storageState: { cookies: [], origins: [] } });
    try {
      expect((await partner.request.post("/api/auth/login", { headers: { origin: new URL(testInfo.project.use.baseURL!).origin }, data: { email, password: E2E_PASSWORD } })).status()).toBe(200);
      const baseline = await browser.newContext({ baseURL: testInfo.project.use.baseURL, storageState: E2E_USERS[0].storageState });
      try { expect((await baseline.request.get("/api/blog/feed?limit=1")).status()).toBe(200); }
      finally { await baseline.close(); }
      expect((await partner.request.get(`/api/blog/works/${workId}`)).status()).toBe(404);
      expect((await partner.request.get(photo.imageUrl)).status()).toBe(404);
      expect((await page.request.get(photo.imageUrl)).headers()["cache-control"]).toContain("no-store");
      const hiddenPosts = await (await partner.request.get("/api/posts?q=把九月")).json(); expect(hiddenPosts.posts).toHaveLength(0);
      await editor.getByRole("button", { name: "退出草稿" }).click(); await expect(editor).toHaveCount(0);
      await page.reload(); await page.getByRole("link", { name: "My Draft", exact: true }).click();
      await page.getByRole("button", { name: /^把九月，留在这片绿色里/ }).click();
      await expect(editor.getByRole("heading", { name: "把九月，留在这片绿色里" })).toBeVisible();
      await expect(editor.locator("img")).toHaveCount(1);
      await page.screenshot({ path: testInfo.outputPath("draft-desktop.png") });
      await editor.getByRole("button", { name: "发布", exact: true }).click(); await expect(editor).toHaveCount(0);
      const publicWork = page.locator(`[data-work-id="${workId}"]`); await expect(publicWork).toBeVisible();
      expect((await partner.request.get(photo.imageUrl)).status()).toBe(200);
      const publicData = await (await partner.request.get(`/api/blog/works/${workId}`)).json();
      expect(publicData.work).not.toHaveProperty("draftX");
      expect(publicData.work.connections).toHaveLength(1);
      expect((await db.post.findUniqueOrThrow({ where: { id: external.id } })).workId).toBeNull();
      const base = { mutationId: randomUUID(), baseRevision: publicData.work.revision, expectedStatus: "published" };
      expect((await partner.request.patch(`/api/blog/works/${workId}`, { headers: { "X-Blog-Viewer-Id": otherId, origin: new URL(testInfo.project.use.baseURL!).origin }, data: { ...base, command: { operation: "frame", data: { viewportWidth: 300 } } } })).status()).toBe(403);
      expect((await partner.request.patch(`/api/blog/works/${workId}`, { headers: { "X-Blog-Viewer-Id": otherId, origin: new URL(testInfo.project.use.baseURL!).origin }, data: { ...base, mutationId: randomUUID(), command: { operation: "photo.update", id: photo.id, data: { rotation: 25, caption: "伙伴的标注" } } } })).status()).toBe(200);
      const partnerPage = await partner.newPage(); partnerPage.on("pageerror", error => errors.push(error.message));
      await partnerPage.goto("/home");
      const partnerWork = partnerPage.locator(`[data-work-id="${workId}"]`);
      await expect(partnerWork).toBeVisible();
      await expect(partnerPage.locator("[data-external-connection] path")).toHaveCount(1);
      await partnerWork.getByRole("button", { name: "编辑作品", exact: true }).click();
      await expect(partnerWork.getByRole("button", { name: "调整边框", exact: true })).toHaveCount(0);
      await expect(partnerWork.getByRole("button", { name: "博文", exact: true })).toHaveCount(0);
      await partnerWork.getByRole("button", { name: "伙伴的标注", exact: true }).click();
      await partnerWork.getByLabel("照片标注", { exact: true }).fill("伙伴共同编辑");
      await partnerPage.keyboard.press("Enter");
      await expect.poll(async () => (await db.atlasElement.findUniqueOrThrow({ where: { id: photo.id } })).caption).toBe("伙伴共同编辑");
      await expect(partnerWork.getByRole("img", { name: "伙伴共同编辑" })).toBeVisible();
      await page.setViewportSize({ width: 390, height: 844 }); await page.reload();
      await expect(publicWork.getByRole("button", { name: /^(内容列表|放大查看|调整边框)$/ })).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await publicWork.getByRole("heading", { name: "把九月，留在这片绿色里" }).click();
      await expect(page.getByRole("dialog", { name: "阅读博文" })).toContainText("散步、拍照");
      await page.screenshot({ path: testInfo.outputPath("draft-mobile-reading.png") });
      await page.getByRole("button", { name: "关闭阅读博文" }).click();
      await publicWork.getByRole("button", { name: "编辑作品", exact: true }).click();
      await expect(publicWork.getByRole("toolbar", { name: "草稿工具栏" }).getByRole("button")).toHaveText(["博文", "图片", "连线"]);
      // 整组删除 API 的生命周期仍保留，已删除的边框设置弹窗不再提供入口。
      const latest = (await (await page.request.get(`/api/blog/works/${workId}`)).json()).work;
      expect((await page.request.patch(`/api/blog/works/${workId}`, { headers: { "X-Blog-Viewer-Id": userId, origin: new URL(testInfo.project.use.baseURL!).origin }, data: { mutationId: randomUUID(), baseRevision: latest.revision, expectedStatus: "published", command: { operation: "delete" } } })).status()).toBe(200);
      await page.reload();
      await expect(publicWork).toHaveCount(0);
      expect(await db.blogWork.count({ where: { id: workId } })).toBe(0);
      expect(await db.atlasElement.count({ where: { workId } })).toBe(0);
      expect((await db.post.findUniqueOrThrow({ where: { id: external.id } })).workId).toBeNull();
      expect((await partner.request.get(photo.imageUrl)).status()).toBe(404);
      expect(errors).toEqual([]);
    } finally { await partner.close(); await db.user.deleteMany({ where: { id: otherId } }); }
  });
});

test("窄屏缩放下图片鼠标和触摸位移逆变换，Escape 与 pointercancel 不写入", async ({ context, browser }, testInfo) => {
  await withStudyUser(context, async ({ page, db, userId }) => {
    const work = await db.blogWork.create({ data: { owner: { connect: { id: userId } }, board: { connectOrCreate: { where: { id: "home-board" }, create: { id: "home-board" } } }, viewportHeight: 960 } });
    const photo = await db.atlasElement.create({ data: { boardId: "home-board", workId: work.id, type: "photo", x: 80, y: 350, width: 240, height: 180, imageUrl: "/brand/logo_transparent.svg", caption: "缩放移动" } });
    await page.setViewportSize({ width: 390, height: 844 }); await page.goto(`/home?draft=${work.id}`);
    await page.waitForFunction(() => {
      const root = document.querySelector<HTMLElement>(".active-draft .blog-work"), scene = root?.querySelector<HTMLElement>(".work-scene");
      return root && scene && Math.abs(new DOMMatrixReadOnly(getComputedStyle(scene).transform).a - Math.min(1, root.clientWidth / 960)) < 0.001 && [...document.querySelectorAll(".page-enter")].every(node => node.getAnimations().every(animation => animation.playState === "finished"));
    });
    const node = page.locator(`[data-element-id="${photo.id}"]`), box = (await node.boundingBox())!, scale = box.width / 240;
    const x = box.x + box.width / 2, y = box.y + box.height / 3;
    // 工具栏精简后此尺寸的控件留在框内；手势夹具须位于未被状态/工具栏遮挡的内容区。
    expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest("[data-element-id]")?.getAttribute("data-element-id"), { x, y })).toBe(photo.id);
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 30, y + 15); await page.mouse.up();
    await expect.poll(async () => (await db.atlasElement.findUniqueOrThrow({ where: { id: photo.id } })).x).toBeCloseTo(80 + 30 / scale, 0);
    const before = await db.atlasElement.findUniqueOrThrow({ where: { id: photo.id } }), revision = (await db.blogWork.findUniqueOrThrow({ where: { id: work.id } })).revision;
    const moved = (await node.boundingBox())!;
    await page.mouse.move(moved.x + 20, moved.y + 20); await page.mouse.down(); await page.mouse.move(moved.x + 40, moved.y + 30); await page.keyboard.press("Escape"); await page.mouse.up();
    expect((await db.blogWork.findUniqueOrThrow({ where: { id: work.id } })).revision).toBe(revision);
    const touch = await browser.newContext({ baseURL: testInfo.project.use.baseURL, viewport: { width: 390, height: 844 }, hasTouch: true, storageState: await context.storageState() });
    try {
      const touchPage = await touch.newPage(); await touchPage.goto(`/home?draft=${work.id}`);
      await touchPage.waitForFunction(() => {
        const root = document.querySelector<HTMLElement>(".active-draft .blog-work"), scene = root?.querySelector<HTMLElement>(".work-scene");
        return root && scene && Math.abs(new DOMMatrixReadOnly(getComputedStyle(scene).transform).a - Math.min(1, root.clientWidth / 960)) < 0.001 && [...document.querySelectorAll(".page-enter")].every(node => node.getAnimations().every(animation => animation.playState === "finished"));
      });
      const touchNode = touchPage.locator(`[data-element-id="${photo.id}"]`), rect = (await touchNode.boundingBox())!, cdp = await touch.newCDPSession(touchPage);
      const at = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 3, id: 1 };
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [at] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...at, x: at.x + 20, y: at.y + 10 }] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
      expect((await db.blogWork.findUniqueOrThrow({ where: { id: work.id } })).revision).toBe(revision);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [at] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...at, x: at.x + 20, y: at.y + 10 }] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await expect.poll(async () => (await db.atlasElement.findUniqueOrThrow({ where: { id: photo.id } })).x).toBeCloseTo(before.x + 20 / scale, 0);
      const resizeBox = (await touchNode.getByRole("button", { name: "调整照片大小：缩放移动" }).boundingBox())!;
      const resizeAt = { x: resizeBox.x + resizeBox.width / 2, y: resizeBox.y + resizeBox.height / 2, id: 1 };
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [resizeAt] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...resizeAt, x: resizeAt.x + 12 }] });
      await expect.poll(async () => (await touchNode.boundingBox())!.width).toBeCloseTo(Math.round(240 + 12 / scale) * scale, 0);
      expect((await db.atlasElement.findUniqueOrThrow({ where: { id: photo.id } })).width).toBe(240);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await expect.poll(async () => (await db.atlasElement.findUniqueOrThrow({ where: { id: photo.id } })).width).toBe(Math.round(240 + 12 / scale));
      const rotatedBox = (await touchNode.boundingBox())!, rotationHandle = (await touchNode.getByRole("button", { name: "旋转照片：缩放移动" }).boundingBox())!;
      const cx = rotatedBox.x + rotatedBox.width / 2, cy = rotatedBox.y + rotatedBox.height / 2;
      const dx = rotationHandle.x + rotationHandle.width / 2 - cx, dy = rotationHandle.y + rotationHandle.height / 2 - cy;
      const rotationAt = (degrees: number) => { const angle = degrees * Math.PI / 180; return { x: cx + dx * Math.cos(angle) - dy * Math.sin(angle), y: cy + dx * Math.sin(angle) + dy * Math.cos(angle), id: 1 }; };
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [rotationAt(0)] });
      for (const angle of [5, 10, 15, 20]) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [rotationAt(angle)] });
      await expect.poll(() => touchNode.evaluate(node => { const m = new DOMMatrixReadOnly(getComputedStyle(node).transform); return Math.atan2(m.b, m.a) * 180 / Math.PI; })).toBeCloseTo(20, 0);
      expect((await db.atlasElement.findUniqueOrThrow({ where: { id: photo.id } })).rotation).toBe(0);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await expect.poll(async () => (await db.atlasElement.findUniqueOrThrow({ where: { id: photo.id } })).rotation).toBe(20);
      await cdp.detach();
    } finally { await touch.close(); }
  });
});

test("框选取消、保存失败重试、裁切恢复及键盘边框", async ({ context }) => {
  await withStudyUser(context, async ({ page, userId }) => {
    await page.goto("/home?draft=new");
    await expect(page.getByRole("group", { name: "框选草稿区域" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "New Draft", exact: true })).toHaveCount(0);
    await page.getByRole("link", { name: "My Draft", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "My Draft" })).toContainText("右键选择“新增草稿”");
    await page.getByRole("button", { name: "关闭My Draft", exact: true }).click();
    await openDraftSelection(page); await page.keyboard.press("Escape");
    expect((await (await page.request.get("/api/blog/works")).json()).drafts).toHaveLength(0);
    await openDraftSelection(page);
    // 框选模式默认不显示提示卡片：卡片完全透明且不接受指针，键盘聚焦后才浮现。
    const help = page.getByRole("group", { name: "框选草稿区域" });
    await expect(help).toHaveCSS("opacity", "0"); await expect(help).toHaveCSS("pointer-events", "none");
    await page.getByRole("button", { name: "使用默认区域" }).focus(); await expect(help).toHaveCSS("opacity", "1");
    await page.keyboard.press("Enter");
    const editor = page.getByRole("region", { name: "空间草稿" }), id = (await editor.getAttribute("data-work-id"))!;
    await editor.getByLabel("上传作品图片").setInputFiles({ name: "test.png", mimeType: "image/png", buffer: png });
    await expect(editor.getByText("已自动保存", { exact: true })).toBeVisible();
    let failed = false;
    await page.route(`**/api/blog/works/${id}`, async route => { if (route.request().method() === "PATCH" && !failed) { failed = true; await route.fulfill({ status: 500, json: { error: "测试保存失败" } }); } else await route.continue(); });
    await page.waitForFunction(() => [...document.querySelectorAll(".page-enter")].every(node => node.getAnimations().every(animation => animation.playState === "finished")));
    await resizeFrame(page, editor, 161, 121);
    await expect(editor.getByRole("button", { name: "发布", exact: true })).toBeDisabled(); await editor.getByRole("button", { name: "重试保存" }).click();
    await expect(editor.getByText("已自动保存", { exact: true })).toBeVisible();
    const small = await (await page.request.get(`/api/blog/works/${id}`, { headers: { "X-Blog-Viewer-Id": userId } })).json(); expect(small.work.viewportWidth).toBeCloseTo(161, 0); expect(small.work.elements[0].width).toBe(120);
    await resizeFrame(page, editor, 960, 540);
    await expect(editor.getByText("已自动保存", { exact: true })).toBeVisible();
    await expect(editor.locator("img")).toBeInViewport();
    const handle = editor.getByRole("button", { name: "调整草稿右边界", exact: true }); await handle.focus(); await page.keyboard.press("ArrowRight");
    await expect(editor.getByText("已自动保存", { exact: true })).toBeVisible(); expect((await (await page.request.get(`/api/blog/works/${id}`)).json()).work.viewportWidth).toBeGreaterThan(160);
  });
});

test("隐藏的框选卡片不拦截指针，卡片区域起手拖动仍能框选", async ({ context }) => {
  await withStudyUser(context, async ({ page, userId }) => {
    await page.setViewportSize({ width: 1440, height: 900 }); await page.goto("/home");
    await openDraftSelection(page);
    const help = page.getByRole("group", { name: "框选草稿区域" });
    await expect(help).toHaveCSS("pointer-events", "none");
    // 页面入场动画会给祖先加 translateY，getBoundingClientRect 会带上它；先在动画结束后再测框选几何。
    await page.waitForFunction(() => [...document.querySelectorAll(".page-enter")].every(node => node.getAnimations().every(animation => animation.playState === "finished")));
    // 卡片默认不可见但仍在文档流内；鼠标从卡片自身区域起手时，pointer 必须穿透到框选层。
    const card = (await help.boundingBox())!;
    const startX = Math.round(card.x + card.width / 2), startY = Math.round(card.y + card.height / 2);
    await page.mouse.move(startX, startY); await page.mouse.down();
    await page.mouse.move(startX + 220, startY + 160, { steps: 6 });
    const rect = page.locator(".draft-selection-rect");
    await expect(rect).toBeVisible();
    const box = (await rect.boundingBox())!; expect(Math.round(box.width)).toBe(220); expect(Math.round(box.height)).toBe(160);
    await page.mouse.up();
    await expect(page.getByRole("region", { name: "空间草稿" })).toBeVisible();
    await expect(rect).toHaveCount(0);
    const drafts = (await (await page.request.get("/api/blog/works")).json()).drafts;
    expect(drafts).toHaveLength(1);
    // 起手点在卡片自身区域，落库的草稿必须记录这段真实框选尺寸，而不是被卡片拦掉的默认区域。
    const created = (await (await page.request.get(`/api/blog/works/${drafts[0].id}`, { headers: { "X-Blog-Viewer-Id": userId } })).json()).work;
    expect(created.viewportWidth).toBeCloseTo(220, 1); expect(created.viewportHeight).toBeCloseTo(160, 1);
  });
});

test("300 篇作品的末项仍可通过博文深链编辑，不改变裁切数据", async ({ context }) => {
  await withStudyUser(context, async ({ page, db, userId }) => {
    const work = await db.blogWork.create({ data: { owner: { connect: { id: userId } }, board: { connectOrCreate: { where: { id: "home-board" }, create: { id: "home-board" } } } } });
    const postIds = Array.from({ length: 300 }, () => randomUUID());
    await db.post.createMany({ data: postIds.map((id, index) => ({ id, workId: work.id, workOrder: index, title: `第 ${index + 1} 篇`, content: `完整正文 ${index + 1}`, slug: `draft-${id}`, authorId: userId })) });
    await db.atlasElement.createMany({ data: postIds.map(postId => ({ workId: work.id, boardId: "home-board", postId, type: "note" as const, x: 0, y: 0, width: 352, height: 180 })) });
    const before = await db.blogWork.findUniqueOrThrow({ where: { id: work.id } });
    await page.goto(`/home?draft=${work.id}&post=${postIds[299]}`);
    const editor = page.getByRole("region", { name: "空间草稿" });
    await expect(page.getByLabel("正文（Markdown）")).toHaveValue("完整正文 300");
    await page.getByLabel("正文（Markdown）").fill("末项完整编辑"); await page.getByRole("button", { name: "关闭编辑博文" }).click();
    await expect(editor.getByText("已自动保存", { exact: true })).toBeVisible();
    const after = await db.blogWork.findUniqueOrThrow({ where: { id: work.id } }); expect(after.viewportHeight).toBe(before.viewportHeight); expect(after.viewportWidth).toBe(before.viewportWidth);
    expect((await db.post.findUniqueOrThrow({ where: { id: postIds[299] } })).content).toBe("末项完整编辑");
  });
});

test("旋转图片 AABB 空角没有线和钉子，扩大窗口后恢复真实交集连线", async ({ context }) => {
  await withStudyUser(context, async ({ page, db, userId }) => {
    const work = await db.blogWork.create({ data: { owner: { connect: { id: userId } }, board: { connectOrCreate: { where: { id: "home-board" }, create: { id: "home-board" } } }, viewportX: 320 + 320 * (Math.cos(25 * Math.PI / 180) + Math.sin(25 * Math.PI / 180)) - 160, viewportY: 320 - 320 * (Math.cos(25 * Math.PI / 180) + Math.sin(25 * Math.PI / 180)), viewportWidth: 160, viewportHeight: 120 } });
    const first = await db.atlasElement.create({ data: { boardId: "home-board", workId: work.id, type: "photo", x: 0, y: 0, width: 640, height: 640, rotation: 25, imageUrl: "/brand/logo_transparent.svg", caption: "旋转几何" } });
    const second = await db.atlasElement.create({ data: { boardId: "home-board", workId: work.id, type: "photo", x: 650, y: -80, width: 120, height: 90, imageUrl: "/brand/logo_transparent.svg", caption: "可见终点" } });
    const connection = await db.atlasConnection.create({ data: { boardId: "home-board", workId: work.id, fromId: first.id, toId: second.id } });
    await page.goto(`/home?draft=${work.id}`); const editor = page.getByRole("region", { name: "空间草稿" });
    await expect(editor.getByText("DRAFT", { exact: true })).toBeVisible();
    await expect(editor.locator(`[data-work-connection="${connection.id}"]`)).toHaveCount(0);
    await page.waitForFunction(() => [...document.querySelectorAll(".page-enter")].every(node => node.getAnimations().every(animation => animation.playState === "finished")));
    await resizeFrame(page, editor, 360, 360);
    await expect(editor.locator(`[data-work-connection="${connection.id}"] path`)).toBeVisible();
    const circles = await editor.locator(`[data-work-connection="${connection.id}"] circle`).evaluateAll(nodes => nodes.map(n => ({ x: Number(n.getAttribute("cx")), y: Number(n.getAttribute("cy")) })));
    expect(circles[0].x).toBeGreaterThan(work.viewportX); expect(circles[0].y).toBeGreaterThan(work.viewportY + 120);
    await page.setViewportSize({ width: 375, height: 812 }); await expect(editor.locator(`[data-work-connection="${connection.id}"] path`)).toBeVisible();
    expect(await db.atlasConnection.count({ where: { id: connection.id } })).toBe(1);
  });
});

test("最大窗口的边框手柄不能越界，裁切外的图片数据仍保留", async ({ context }) => {
  await withStudyUser(context, async ({ page, db, userId }) => {
    const work = await db.blogWork.create({ data: { owner: { connect: { id: userId } }, board: { connectOrCreate: { where: { id: "home-board" }, create: { id: "home-board" } } }, viewportWidth: 8191, viewportHeight: 8000 } });
    await db.atlasElement.createMany({ data: [0, 9000].map((x, i) => ({ boardId: "home-board", workId: work.id, type: "photo" as const, x, y: 100, width: 240, height: 180, imageUrl: "/brand/logo_transparent.svg", caption: `远距图片 ${i + 1}` })) });
    await page.setViewportSize({ width: 1440, height: 1500 });
    await page.goto(`/home?draft=${work.id}`);
    const editor = page.getByRole("region", { name: "空间草稿" });
    const handle = editor.getByRole("button", { name: "调整草稿右边界", exact: true });
    await handle.focus(); await page.keyboard.press("ArrowRight");
    await expect(editor.getByText("已自动保存", { exact: true })).toBeVisible();
    expect((await db.blogWork.findUniqueOrThrow({ where: { id: work.id } })).viewportWidth).toBe(8192);
    await page.keyboard.press("ArrowRight");
    await expect(editor.getByText("已自动保存", { exact: true })).toBeVisible();
    expect((await db.blogWork.findUniqueOrThrow({ where: { id: work.id } })).viewportWidth).toBe(8192);
    expect(await db.atlasElement.count({ where: { workId: work.id } })).toBe(2);
    expect((await db.atlasElement.findFirstOrThrow({ where: { workId: work.id, x: 9000 } })).caption).toBe("远距图片 2");
    for (const name of ["博文", "图片", "连线"]) await editor.getByRole("button", { name, exact: true }).click({ trial: true });
  });
});

test("双标签页同字段冲突保留本地输入，明确选择后重提", async ({ context }) => {
  await withStudyUser(context, async ({ page, db, userId }) => {
    const work = await db.blogWork.create({ data: { owner: { connect: { id: userId } }, board: { connectOrCreate: { where: { id: "home-board" }, create: { id: "home-board" } } } } });
    const other = await context.newPage();
    try {
      await page.goto(`/home?draft=${work.id}`); await other.goto(`/home?draft=${work.id}`);
      for (const tab of [page, other]) await expect(tab.getByRole("region", { name: "空间草稿" })).toBeVisible();
      // 两页已拿到同一版本后，故意阻止第二页的后台回读，确保测试实际竞争。
      await other.route(`**/api/blog/works/${work.id}`, async route => {
        if (route.request().method() === "GET") await route.fulfill({ status: 503, json: { error: "离线回读" } }); else await route.continue();
      });
      await page.getByRole("button", { name: "调整草稿右边界", exact: true }).focus(); await page.keyboard.press("Shift+ArrowLeft");
      await expect(page.getByText("已自动保存", { exact: true })).toBeVisible();
      await other.unroute(`**/api/blog/works/${work.id}`);
      await other.getByRole("button", { name: "调整草稿右边界", exact: true }).focus(); await other.keyboard.press("ArrowLeft");
      await expect(other.getByText("修改冲突", { exact: true })).toBeVisible();
      expect((await db.blogWork.findUniqueOrThrow({ where: { id: work.id } })).viewportWidth).toBe(950);
      await other.getByRole("button", { name: "重新提交我的修改" }).click(); await expect(other.getByText("已自动保存", { exact: true })).toBeVisible();
      expect((await db.blogWork.findUniqueOrThrow({ where: { id: work.id } })).viewportWidth).toBe(959);
    } finally { await other.close(); }
  });
});
