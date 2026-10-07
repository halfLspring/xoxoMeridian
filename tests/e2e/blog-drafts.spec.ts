import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { expect, test, type Frame, type Locator, type Page } from "@playwright/test";
import { withStudyUser } from "@/tests/e2e/support/study";
import { E2E_PASSWORD, E2E_USERS } from "@/tests/e2e/support/credentials";
import { observeResponseDiagnostics } from "@/tests/e2e/support/response-diagnostics";
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

async function waitForWorkLayout(page: Page, editor: Locator) {
  await expect(editor).toBeVisible();
  await page.waitForFunction(() => [...document.querySelectorAll(".page-enter")].every(node => node.getAnimations().every(animation => animation.playState === "finished")));
}

async function workGeometry(editor: Locator) {
  return editor.evaluate(node => {
    const rect = (target: Element) => {
      const box = target.getBoundingClientRect();
      return { x: box.x + scrollX, y: box.y + scrollY, width: box.width, height: box.height };
    };
    const row = node.closest(".work-timeline-row")!;
    return {
      outer: rect(node), frame: rect(node.querySelector(".work-frame")!), crop: rect(node.querySelector(".work-crop")!),
      scene: rect(node.querySelector(".work-scene")!), post: rect(node.querySelector("[data-work-post]")!),
      row: rect(row), next: rect(row.nextElementSibling!),
    };
  });
}

async function waitForPublishedLayout(page: Page, editor: Locator, savedWidth: number) {
  await waitForWorkLayout(page, editor);
  // 初次 SSR 尚未读取宿主宽度；等实际等比适配和居中完成后，才比较同一显示比例的两态。
  await expect.poll(() => editor.evaluate((node, width) => {
    const host = node.parentElement!.getBoundingClientRect(), frame = node.getBoundingClientRect();
    const displayedWidth = Math.min(width, host.width);
    return Math.abs(frame.width - displayedWidth) <= 1 && Math.abs(frame.x - host.x - (host.width - displayedWidth) / 2) <= 1;
  }, savedWidth)).toBe(true);
}

function expectSameGeometry(actual: Awaited<ReturnType<typeof workGeometry>>, expected: Awaited<ReturnType<typeof workGeometry>>) {
  for (const key of Object.keys(expected) as Array<keyof typeof expected>) {
    for (const dimension of ["x", "y", "width", "height"] as const) {
      expect(Math.abs(actual[key][dimension] - expected[key][dimension]), `${key}.${dimension}`).toBeLessThanOrEqual(1);
    }
  }
}

for (const example of [
  { name: "桌面", screen: { width: 1440, height: 1100 }, width: 1240, height: 520, x: 0, y: 0 },
  { name: "已调整裁切窗口", screen: { width: 1440, height: 1100 }, width: 720, height: 310, x: 80, y: 40 },
  { name: "窄屏等比", screen: { width: 390, height: 844 }, width: 960, height: 540, x: 0, y: 0 },
  { name: "小窗口外置控件", screen: { width: 390, height: 844 }, width: 160, height: 120, x: 0, y: 0 },
]) {
  test(`作品浏览与编辑保持相同几何：${example.name}、反复切换及刷新不写入`, async ({ context }, testInfo) => {
    await withStudyUser(context, async ({ page, db, userId }) => {
      const work = await db.blogWork.create({ data: {
        owner: { connect: { id: userId } }, board: { connectOrCreate: { where: { id: "home-board" }, create: { id: "home-board" } } },
        status: "published", publishedAt: new Date("2050-05-02T16:30:00Z"),
        viewportWidth: example.width, viewportHeight: example.height, viewportX: example.x, viewportY: example.y,
      } });
      await db.blogWork.create({ data: { ownerId: userId, boardId: "home-board", status: "published", publishedAt: new Date("2050-05-04T00:00:00Z"), viewportHeight: 200 } });
      const post = await db.post.create({ data: { workId: work.id, authorId: userId, workOrder: 0, title: "窗口内的博文", content: "编辑状态不改变构图", slug: randomUUID(), publishedAt: new Date("2049-01-01T00:00:00Z"), authorTimezone: "Asia/Shanghai" } });
      await db.atlasElement.create({ data: { workId: work.id, boardId: "home-board", postId: post.id, type: "note", x: 96, y: 72, width: 352, height: 180 } });
      const storedElements = await db.atlasElement.findMany({ where: { workId: work.id } });
      const writes: string[] = [];
      page.on("request", request => { if (request.method() === "PATCH" && request.url().includes(`/api/blog/works/${work.id}`)) writes.push(request.url()); });
      await page.setViewportSize(example.screen);
      await page.goto("/home");
      const editor = page.locator(`[data-work-id="${work.id}"]`);
      await waitForPublishedLayout(page, editor, example.width);
      const before = await workGeometry(editor);
      for (let cycle = 0; cycle < 2; cycle++) {
        const refresh = page.waitForResponse(reply => new URL(reply.url()).pathname === `/api/blog/works/${work.id}` && reply.request().method() === "GET");
        await editor.getByRole("button", { name: "编辑作品", exact: true }).click();
        await (await refresh).finished();
        await expect(editor.getByRole("button", { name: "退出编辑", exact: true })).toBeVisible();
        const editing = await workGeometry(editor);
        if (cycle === 0) {
          const header = await editor.locator(".work-header").boundingBox();
          console.log(`作品几何 ${example.name}: ${JSON.stringify({ before, editing, header })}`);
          await testInfo.attach("作品两态几何", { contentType: "application/json", body: JSON.stringify({ before, editing, header }) });
        }
        expectSameGeometry(editing, before);
        expect(editing.outer).toEqual(editing.frame);
        expect(editing.outer).toEqual(editing.crop);
        await expect(editor.getByRole("button", { name: /^调整草稿.+边界$/ })).toHaveCount(8);
        for (const name of ["删除作品", "退出编辑", "博文", "图片"]) {
          await editor.getByRole("button", { name, exact: true }).click({ trial: true });
        }
        await editor.getByRole("button", { name: "退出编辑", exact: true }).click();
        await expect(editor.getByRole("button", { name: "编辑作品", exact: true })).toBeVisible();
        expectSameGeometry(await workGeometry(editor), before);
      }
      await page.reload();
      await waitForPublishedLayout(page, editor, example.width);
      expectSameGeometry(await workGeometry(editor), before);
      expect(await db.blogWork.findUniqueOrThrow({ where: { id: work.id } })).toEqual(work);
      expect(await db.atlasElement.findMany({ where: { workId: work.id } })).toEqual(storedElements);
      expect(writes).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath(`published-${example.name}.png`) });
    });
  });
}

async function seedTimeWork(db: PrismaClient, userId: string, followingHeight = 200) {
  const work = await db.blogWork.create({ data: {
    owner: { connect: { id: userId } }, board: { connectOrCreate: { where: { id: "home-board" }, create: { id: "home-board" } } },
    status: "published", publishedAt: new Date("2050-05-02T16:30:00Z"), viewportWidth: 960, viewportHeight: 540,
  } });
  await db.blogWork.create({ data: { ownerId: userId, boardId: "home-board", status: "published", publishedAt: new Date("2050-05-04T00:00:00Z"), viewportHeight: followingHeight } });
  const post = await db.post.create({ data: { workId: work.id, authorId: userId, workOrder: 0, title: "单篇时间保持独立", content: "时间浮层不改变作品构图", slug: randomUUID(), publishedAt: new Date("2049-01-01T00:00:00Z"), authorTimezone: "Asia/Shanghai" } });
  await db.atlasElement.create({ data: { workId: work.id, boardId: "home-board", postId: post.id, type: "note", x: 96, y: 72, width: 352, height: 180 } });
  return work;
}

test("作品发布时间仅在框外悬停查看，无时钟按钮，两态均不改变占位", async ({ context }, testInfo) => {
  await withStudyUser(context, async ({ page, db, userId }) => {
    const work = await seedTimeWork(db, userId);
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.goto("/home");
    const editor = page.locator(`[data-work-id="${work.id}"]`);
    const tooltip = page.getByRole("tooltip", { name: "作品发布时间", exact: true });
    await waitForPublishedLayout(page, editor, work.viewportWidth);
    await page.mouse.move(1, 100);
    await expect(tooltip).toHaveCount(0);
    await expect(editor.locator(".work-header time")).toHaveCount(0);
    await expect(editor.locator(".work-post time")).toHaveAttribute("datetime", "2049-01-01T00:00:00.000Z");
    // 控制的只是悬停关闭宽限期，所有尺寸仍由真实浏览器布局提供。
    await page.clock.install();
    for (const mode of ["浏览", "编辑"]) {
      await expect(editor.getByRole("button", { name: "查看作品发布时间", exact: true })).toHaveCount(0);
      const before = await workGeometry(editor);
      await editor.hover({ position: { x: 600, y: 260 } });
      await expect(tooltip).toBeVisible();
      await expect(tooltip.locator("time")).toHaveAttribute("datetime", "2050-05-02T16:30:00.000Z");
      await expect(tooltip).toContainText("05/03/2050");
      const frame = (await editor.boundingBox())!, popup = (await tooltip.boundingBox())!;
      expect(popup.x).toBeCloseTo(frame.x, 0);
      expect(popup.y + popup.height).toBeLessThanOrEqual(frame.y - 12);
      expectSameGeometry(await workGeometry(editor), before);
      await editor.hover({ position: { x: 800, y: 400 } });
      expect(await tooltip.boundingBox()).toEqual(popup);
      await tooltip.hover();
      await page.clock.runFor(250);
      await expect(tooltip).toBeVisible();
      expect(await tooltip.evaluate(node => {
        const box = node.getBoundingClientRect();
        return node.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
      })).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`published-time-${mode}.png`) });
      await page.mouse.move(1, 100);
      await page.clock.runFor(250);
      await expect(tooltip).toHaveCount(0);
      expectSameGeometry(await workGeometry(editor), before);
      await editor.hover({ position: { x: 600, y: 260 } });
      await expect(tooltip).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(tooltip).toHaveCount(0);
      if (mode === "浏览") {
        const refresh = page.waitForResponse(reply => new URL(reply.url()).pathname === `/api/blog/works/${work.id}` && reply.request().method() === "GET");
        await editor.getByRole("button", { name: "编辑作品", exact: true }).click();
        await (await refresh).finished();
        await expect(editor.getByRole("button", { name: "退出编辑", exact: true })).toBeVisible();
        await page.mouse.move(1, 100);
      }
    }
    expect(await db.blogWork.findUniqueOrThrow({ where: { id: work.id } })).toEqual(work);
  });
});

test("作品时间浮层在窄屏右侧和顶部避让，缩放手柄及裁切保持可用", async ({ context }, testInfo) => {
  await withStudyUser(context, async ({ page, db, userId }) => {
    // 用真实的后续作品保证足够滚动空间，不依赖首页空白高度或其它用例留下的内容。
    const work = await seedTimeWork(db, userId, 2400);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/home");
    const editor = page.locator(`[data-work-id="${work.id}"]`);
    await waitForPublishedLayout(page, editor, work.viewportWidth);
    await editor.getByRole("button", { name: "编辑作品", exact: true }).click();
    const edge = editor.getByRole("button", { name: "调整草稿左边界", exact: true });
    const handle = (await edge.boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await expect(page.getByRole("tooltip", { name: "作品发布时间" })).toBeVisible();
    const saved = page.waitForResponse(reply => new URL(reply.url()).pathname === `/api/blog/works/${work.id}` && reply.request().method() === "PATCH");
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2 + 190, handle.y + handle.height / 2, { steps: 6 });
    await page.mouse.up();
    expect((await saved).status()).toBe(200);
    await (await saved).finished();
    await expect(editor.getByText("已自动保存", { exact: true })).toBeVisible();
    const resized = await db.blogWork.findUniqueOrThrow({ where: { id: work.id } });
    expect(resized.viewportWidth).toBeLessThan(work.viewportWidth);
    await page.mouse.move(1, 100);
    await page.keyboard.press("Escape");
    await editor.evaluate(node => window.scrollTo(0, node.getBoundingClientRect().top + scrollY - 4));
    await expect.poll(async () => Math.abs((await editor.boundingBox())!.y - 4)).toBeLessThanOrEqual(1);
    const before = await workGeometry(editor), frame = (await editor.boundingBox())!;
    await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height - 20);
    const tooltip = page.getByRole("tooltip", { name: "作品发布时间" });
    await expect(tooltip).toBeVisible();
    const popup = (await tooltip.boundingBox())!;
    expect(popup.x).toBeLessThan(frame.x);
    expect(popup.x).toBeGreaterThanOrEqual(8);
    expect(popup.x + popup.width).toBeLessThanOrEqual(382);
    expect(popup.y).toBeGreaterThanOrEqual(frame.y + frame.height + 12);
    expect(popup.y + popup.height).toBeLessThanOrEqual(836);
    expectSameGeometry(await workGeometry(editor), before);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("published-time-viewport-edge.png") });
    await page.keyboard.press("Escape");
    await expect(tooltip).toHaveCount(0);
    expectSameGeometry(await workGeometry(editor), before);
    expect(await db.blogWork.findUniqueOrThrow({ where: { id: work.id } })).toEqual(resized);
  });
});

test("未发布草稿悬停不显示发布时间", async ({ context }) => {
  await withStudyUser(context, async ({ page, db, userId }) => {
    const draft = await db.blogWork.create({ data: {
      owner: { connect: { id: userId } },
      board: { connectOrCreate: { where: { id: "home-board" }, create: { id: "home-board" } } },
    } });
    await page.goto(`/home?draft=${draft.id}`);
    const privateEditor = page.getByRole("region", { name: "空间草稿" });
    await waitForWorkLayout(page, privateEditor);
    // 透明草稿空白处允许穿透；直接移动真实指针，并在可命中的控件上复核父级悬停。
    const box = (await privateEditor.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect(privateEditor.getByRole("button", { name: "查看作品发布时间" })).toHaveCount(0);
    await expect(page.getByRole("tooltip", { name: "作品发布时间" })).toHaveCount(0);
    await privateEditor.getByRole("button", { name: "退出草稿", exact: true }).hover();
    await expect(page.getByRole("tooltip", { name: "作品发布时间" })).toHaveCount(0);
  });
});

async function startFrameMove(page: Page, editor: Locator, edge = "上") {
  const border = editor.getByRole("button", { name: `平移草稿${edge}边框`, exact: true });
  const box = (await border.boundingBox())!;
  // 避开四角和边中点的缩放手柄，验证实际命中边框。
  const at = box.width > box.height
    ? { x: box.x + box.width / 4, y: box.y + box.height / 2 }
    : { x: box.x + box.width / 2, y: box.y + box.height / 4 };
  expect(await border.evaluate((node, point) => document.elementFromPoint(point.x, point.y) === node, at)).toBe(true);
  await page.mouse.move(at.x, at.y);
  await expect(border).toHaveCSS("cursor", "grab");
  await page.mouse.down();
  await expect(border).toHaveCSS("cursor", "grabbing");
  return { border, ...at };
}

test("整稿平移连续预览、缩放交替及刷新恢复，内容与控件一起移动", async ({ context }, testInfo) => {
  await withStudyUser(context, async ({ page, db, userId }) => {
    const work = await db.blogWork.create({ data: { owner: { connect: { id: userId } }, board: { connectOrCreate: { where: { id: "home-board" }, create: { id: "home-board" } } }, draftX: 100, draftY: 80, viewportWidth: 900, viewportHeight: 600 } });
    const upload = await page.request.post(`/api/blog/works/${work.id}/uploads`, {
      headers: { "X-Blog-Viewer-Id": userId, origin: new URL(testInfo.project.use.baseURL!).origin },
      multipart: { file: { name: "move.png", mimeType: "image/png", buffer: png }, metadata: JSON.stringify({ mutationId: randomUUID(), baseRevision: 0, expectedStatus: "draft", data: { x: 500, y: 200, width: 240, height: 180, caption: "整稿平移图片" } }) },
    });
    expect(upload.status()).toBe(200);
    const uploaded = await db.atlasElement.findFirstOrThrow({ where: { workId: work.id, type: "photo" } });
    const photo = await db.atlasElement.update({ where: { id: uploaded.id }, data: { rotation: 12 } });
    const post = await db.post.create({ data: { workId: work.id, authorId: userId, workOrder: 0, title: "整稿平移正文", content: "保留内部排版", slug: randomUUID() } });
    await db.atlasElement.create({ data: { workId: work.id, boardId: "home-board", postId: post.id, type: "note", x: 0, y: 0, width: 352, height: 180 } });
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.goto(`/home?draft=${work.id}`);
    const editor = page.getByRole("region", { name: "空间草稿" });
    await waitForWorkLayout(page, editor);
    const positions = async () => Promise.all([
      editor, editor.locator(".work-frame"), editor.locator(".work-crop"), editor.locator(".work-header"),
      editor.getByRole("toolbar", { name: "草稿工具栏" }), editor.locator(`[data-element-id="${photo.id}"]`), editor.locator(`[data-work-post="${post.id}"]`),
    ].map(async node => (await node.boundingBox())!));
    const start = await positions();
    const initialRevision = (await db.blogWork.findUniqueOrThrow({ where: { id: work.id } })).revision;
    const at = await startFrameMove(page, editor);
    for (const [dx, dy] of [[30, 20], [90, 40], [60, 70]]) {
      await page.mouse.move(at.x + dx, at.y + dy, { steps: 4 });
      const preview = await positions();
      for (let i = 0; i < start.length; i++) {
        expect(preview[i].x - start[i].x).toBeCloseTo(dx, 0);
        expect(preview[i].y - start[i].y).toBeCloseTo(dy, 0);
        expect(preview[i].width).toBe(start[i].width);
        expect(preview[i].height).toBe(start[i].height);
      }
      expect((await db.blogWork.findUniqueOrThrow({ where: { id: work.id } })).revision).toBe(initialRevision);
      await expect(editor.getByRole("button", { name: "发布", exact: true })).toBeDisabled();
    }
    const saved = page.waitForResponse(r => r.request().method() === "PATCH" && r.url().endsWith(`/works/${work.id}`));
    await page.mouse.up();
    expect((await saved).request().postDataJSON().command).toEqual({ operation: "frame", data: { draftX: 160, draftY: 150 } });
    await expect(editor.getByText("已自动保存", { exact: true })).toBeVisible();
    const moved = await positions();
    const corner = (await editor.getByRole("button", { name: "调整草稿左上边界", exact: true }).boundingBox())!;
    await page.mouse.move(corner.x + 12, corner.y + 12); await page.mouse.down();
    await page.mouse.move(corner.x + 42, corner.y + 32, { steps: 4 }); await page.mouse.up();
    await expect(editor.getByText("已自动保存", { exact: true })).toBeVisible();
    const resized = await positions();
    expect(resized[5]).toEqual(moved[5]); expect(resized[6]).toEqual(moved[6]);
    const next = await startFrameMove(page, editor, "左");
    await page.mouse.move(next.x - 20, next.y + 10, { steps: 4 }); await page.mouse.up();
    await expect(editor.getByText("已自动保存", { exact: true })).toBeVisible();
    const final = await positions();
    expect(await db.blogWork.findUniqueOrThrow({ where: { id: work.id } })).toMatchObject({ draftX: 170, draftY: 180, viewportX: 30, viewportY: 20, viewportWidth: 870, viewportHeight: 580 });
    expect(await db.atlasElement.findUniqueOrThrow({ where: { id: photo.id } })).toEqual(photo);
    await editor.getByRole("button", { name: "退出草稿", exact: true }).click();
    await page.reload();
    await page.getByRole("link", { name: "My Draft", exact: true }).click();
    await page.getByRole("button", { name: /^整稿平移正文/ }).click();
    await waitForWorkLayout(page, editor);
    expect(await positions()).toEqual(final);
    await page.screenshot({ path: testInfo.outputPath("draft-moved-desktop.png") });
    await editor.getByRole("button", { name: "发布", exact: true }).click();
    const published = page.getByRole("region", { name: "已发布作品" }).filter({ has: page.getByRole("heading", { name: "整稿平移正文" }) });
    await published.getByRole("button", { name: "编辑作品", exact: true }).click();
    await expect(published.getByRole("button", { name: /^平移草稿/ })).toHaveCount(0);
    await expect(published.getByRole("button", { name: /^调整草稿/ })).toHaveCount(8);
  });
});

test("整稿平移 Escape、pointercancel 和丢失捕获取消且不写入", async ({ context }) => {
  await withStudyUser(context, async ({ page, db, userId }) => {
    const work = await db.blogWork.create({ data: { owner: { connect: { id: userId } }, board: { connectOrCreate: { where: { id: "home-board" }, create: { id: "home-board" } } }, draftX: 100, draftY: 60, viewportWidth: 800, viewportHeight: 540 } });
    await page.goto(`/home?draft=${work.id}`);
    const editor = page.getByRole("region", { name: "空间草稿" });
    await waitForWorkLayout(page, editor);
    const before = await editor.boundingBox(), writes: unknown[] = [];
    page.on("request", request => { if (request.method() === "PATCH" && request.url().endsWith(`/works/${work.id}`)) writes.push(request.postDataJSON()); });
    for (const action of ["Escape", "pointercancel", "lostpointercapture"]) {
      if (action === "pointercancel") {
        const cdp = await context.newCDPSession(page);
        try {
          await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true });
          const border = (await editor.getByRole("button", { name: "平移草稿上边框", exact: true }).boundingBox())!;
          const at = { x: border.x + border.width / 4, y: border.y + border.height / 2, id: 1 };
          await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [at] });
          await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...at, x: at.x + 60, y: at.y + 40 }] });
          expect((await editor.boundingBox())!.x).toBeCloseTo(before!.x + 60, 0);
          await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
        } finally { await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false }); await cdp.detach(); }
      } else {
        const at = await startFrameMove(page, editor);
        await page.mouse.move(at.x + 60, at.y + 40, { steps: 4 });
        expect((await editor.boundingBox())!.x).toBeCloseTo(before!.x + 60, 0);
        if (action === "Escape") await page.keyboard.press("Escape");
        else await at.border.evaluate(node => node.releasePointerCapture(1));
        await page.mouse.up();
      }
      // 原生取消事件交付后还需等待 React 提交布局；同时保留零写入和精确几何断言。
      await expect.poll(() => editor.boundingBox(), { message: `${action} 后恢复原位置` }).toEqual(before);
      await expect(editor.getByText("已自动保存", { exact: true })).toBeVisible();
    }
    expect(writes).toEqual([]);
    expect(await db.blogWork.findUniqueOrThrow({ where: { id: work.id } })).toEqual(work);
  });
});

test("整稿平移在窄屏保持比例，键盘等价操作和图片拖动互不抢占", async ({ context }, testInfo) => {
  await withStudyUser(context, async ({ page, db, userId }) => {
    const work = await db.blogWork.create({ data: { owner: { connect: { id: userId } }, board: { connectOrCreate: { where: { id: "home-board" }, create: { id: "home-board" } } }, draftX: 24, draftY: 40, viewportHeight: 960 } });
    const photo = await db.atlasElement.create({ data: { boardId: "home-board", workId: work.id, type: "photo", x: 80, y: 350, width: 240, height: 180, imageUrl: "/brand/logo_transparent.svg", caption: "平移与图片" } });
    await page.setViewportSize({ width: 390, height: 844 }); await page.goto(`/home?draft=${work.id}`);
    const editor = page.getByRole("region", { name: "空间草稿" }), node = editor.locator(`[data-element-id="${photo.id}"]`);
    await waitForWorkLayout(page, editor);
    const before = (await editor.boundingBox())!, imageBefore = (await node.boundingBox())!;
    const ratio = imageBefore.width / photo.width;
    expect(ratio).toBeLessThan(1);
    const at = await startFrameMove(page, editor);
    await page.mouse.move(at.x + 8, at.y + 30, { steps: 5 }); await page.mouse.up();
    await expect(editor.getByText("已自动保存", { exact: true })).toBeVisible();
    const imageMoved = (await node.boundingBox())!;
    expect(imageMoved.x - imageBefore.x).toBeCloseTo(8, 0);
    expect(imageMoved.y - imageBefore.y).toBeCloseTo(30, 0);
    expect(imageMoved.width).toBe(imageBefore.width);
    expect((await editor.boundingBox())!.width).toBe(before.width);
    await page.reload(); await waitForWorkLayout(page, editor);
    expect(await node.boundingBox()).toEqual(imageMoved);
    const move = editor.getByRole("button", { name: "平移草稿上边框", exact: true });
    await move.focus(); await page.keyboard.press("Tab");
    await expect(editor.getByRole("button", { name: "平移草稿右边框", exact: true })).toBeFocused();
    await page.keyboard.press("Shift+ArrowLeft"); await page.keyboard.press("ArrowUp");
    await expect(editor.getByText("已自动保存", { exact: true })).toBeVisible();
    expect(await db.blogWork.findUniqueOrThrow({ where: { id: work.id } })).toMatchObject({ draftX: 22, draftY: 69, viewportX: 0, viewportY: 0, viewportWidth: 960, viewportHeight: 960 });
    expect(await db.atlasElement.findUniqueOrThrow({ where: { id: photo.id } })).toEqual(photo);
    const pic = (await node.boundingBox())!, x = pic.x + pic.width / 2, y = pic.y + pic.height / 3;
    expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest("[data-element-id]")?.getAttribute("data-element-id"), { x, y })).toBe(photo.id);
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 20, y + 10, { steps: 5 }); await page.mouse.up();
    await expect(editor.getByText("已自动保存", { exact: true })).toBeVisible();
    expect((await db.atlasElement.findUniqueOrThrow({ where: { id: photo.id } })).x).toBeCloseTo(80 + 20 / ratio, 0);
    expect(await db.blogWork.findUniqueOrThrow({ where: { id: work.id } })).toMatchObject({ draftX: 22, draftY: 69 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await editor.getByRole("button", { name: "博文", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "编辑博文" })).toBeVisible();
    await page.getByRole("button", { name: "关闭编辑博文", exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath("draft-moved-mobile.png") });
  });
});

test("整稿平移等待保存时可连续操作，取消保留前次位置，失败沿用幂等键重试", async ({ context }) => {
  await withStudyUser(context, async ({ page, db, userId }) => {
    const work = await db.blogWork.create({ data: { owner: { connect: { id: userId } }, board: { connectOrCreate: { where: { id: "home-board" }, create: { id: "home-board" } } }, draftX: 100, draftY: 60, viewportWidth: 800, viewportHeight: 540 } });
    await page.goto(`/home?draft=${work.id}`);
    const editor = page.getByRole("region", { name: "空间草稿" });
    await waitForWorkLayout(page, editor);
    let release!: () => void, ready!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; }), requested = new Promise<void>(resolve => { ready = resolve; });
    const writes: Array<{ mutationId: string; command: unknown }> = [];
    await page.route(`**/api/blog/works/${work.id}`, async route => {
      if (route.request().method() !== "PATCH") { await route.continue(); return; }
      writes.push(route.request().postDataJSON());
      if (writes.length === 1) { const response = await route.fetch(); ready(); await held; await route.fulfill({ response }); }
      else if (writes.length === 2) await route.fulfill({ status: 503, json: { error: "平移保存暂时失败" } });
      else await route.continue();
    });
    try {
      for (const [dx, dy] of [[40, 20], [30, 10]]) {
        const at = await startFrameMove(page, editor);
        await page.mouse.move(at.x + dx, at.y + dy, { steps: 4 }); await page.mouse.up();
      }
      await requested;
      const latest = await editor.boundingBox();
      const cancel = await startFrameMove(page, editor);
      await page.mouse.move(cancel.x + 50, cancel.y + 30, { steps: 4 });
      await page.keyboard.press("Escape"); await page.mouse.up();
      expect(await editor.boundingBox()).toEqual(latest);
      release();
      await expect(editor.getByText("保存失败", { exact: true })).toBeVisible();
      expect(await editor.boundingBox()).toEqual(latest);
      await expect(editor.getByRole("button", { name: "发布", exact: true })).toBeDisabled();
      await editor.getByRole("button", { name: "重试保存", exact: true }).click();
      await expect(editor.getByText("已自动保存", { exact: true })).toBeVisible();
      expect(writes).toHaveLength(3);
      expect(writes[2]).toEqual(writes[1]);
      expect(writes[1].command).toEqual({ operation: "frame", data: { draftX: 170, draftY: 90 } });
      expect(await editor.boundingBox()).toEqual(latest);
      expect(await db.blogWork.findUniqueOrThrow({ where: { id: work.id } })).toMatchObject({ draftX: 170, draftY: 90, revision: 2 });
    } finally { release(); await page.unrouteAll({ behavior: "wait" }); }
  });
});

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
          `[data-work-post="${published.post.id}"] .post-card-meta`,
        ];
        const serverText = await page.evaluate(({ html, selectors }) => {
          const doc = new DOMParser().parseFromString(html, "text/html");
          return selectors.map(selector => doc.querySelector(selector)?.textContent?.trim());
        }, { html, selectors });
        const publishedEditor = page.locator(`[data-work-id="${published.work.id}"]`);
        await waitForPublishedLayout(page, publishedEditor, published.work.viewportWidth);
        await expect(publishedEditor.locator(".work-header time")).toHaveCount(0);
        await publishedEditor.hover();
        await expect(page.getByRole("tooltip", { name: "作品发布时间" }).locator("time")).toHaveText(scenario.date);
        await page.keyboard.press("Escape");
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
        expect(serverText).toEqual([`E2E Focus · ${scenario.timestamp}  —`]);
        await expect(draftButton.locator("time")).toHaveText(scenario.timestamp);
        await expect(dialog.getByRole("button", { name: /^未命名草稿/ }).locator("time")).toHaveText("09/30/2026, 23:30");
        await draftButton.click();
        const editor = page.getByRole("region", { name: "空间草稿" });
        await expect(editor.locator(".post-card-meta")).toHaveText(`E2E Focus · ${scenario.timestamp} — 草稿`);
        // 草稿通过水合后的读取请求恢复；刷新仍必须保持相同的显式时间语义。
        await page.goto(`/home?draft=${draft.work.id}`);
        await expect(editor.locator(".post-card-meta")).toHaveText(`E2E Focus · ${scenario.timestamp} — 草稿`);
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

for (const [width, height] of [[1000, 479], [1000, 480], [1000, 481], [1000, 240], [160, 120]]) {
  test(`草稿各尺寸只有一层蒙版，精简工具栏贴底且已移除辅助入口：${width}×${height}`, async ({ context }, testInfo) => {
    await withStudyUser(context, async ({ page, db, userId }) => {
      await page.setViewportSize({ width: 1440, height: 1000 });
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
      await expect(toolbar.getByRole("button")).toHaveText(["博文", "图片"]);
      const bar = (await toolbar.boundingBox())!;
      if (height >= 240) {
        expect(frame.y + frame.height - bar.y - bar.height).toBeCloseTo(8, 0);
        expect(bar.x + bar.width / 2).toBeCloseTo(frame.x + frame.width / 2, 0);
      } else {
        expect(bar.y).toBeGreaterThan(frame.y + frame.height);
      }
      await expect(editor.getByRole("button", { name: /^(内容列表|放大查看|调整边框)$/ })).toHaveCount(0);
      await expect(editor.getByText("整组内容（含被裁切的部分）将公开。")).toHaveCount(0);
      for (const name of ["退出草稿", "发布", "博文", "图片"]) {
        await editor.getByRole("button", { name, exact: true }).click({ trial: true });
      }
      await page.screenshot({ path: testInfo.outputPath(`frame-${width}x${height}.png`) });
    });
  });
}

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
    for (const name of ["退出草稿", "发布", "博文", "图片"]) {
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

test("右键框选空白作品，双篇双图自动布局、点击连线及恢复", async ({ context }, testInfo) => {
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
    await first.getByRole("button", { name: "连接照片：未标注照片" }).focus(); await page.keyboard.press("Enter");
    await editor.locator(`[data-element-id="${photos[1].id}"]`).getByRole("button", { name: "连接照片：未标注照片" }).focus(); await page.keyboard.press("Space");
    await expect(editor.getByRole("button", { name: "删除作品连线 1" })).toBeVisible();
    await expect(editor.locator("[data-work-connection]")).toHaveCount(1);
    const cards = editor.locator("[data-work-post]"), originalSecond = (await cards.nth(1).boundingBox())!.y;
    const fullContent = "更长的完整正文。\n\n".repeat(30);
    await editor.getByRole("heading", { name: "把九月，留在这片绿色里" }).click(); await page.getByLabel("正文（Markdown）").fill(fullContent); await page.getByRole("button", { name: "关闭编辑博文" }).click();
    // 卡片按摘要的实际高度让位，长文不再把后续卡片推开数百像素。
    await expect.poll(async () => (await cards.nth(1).boundingBox())!.y).toBeGreaterThan(originalSecond);
    await expect(cards.first().locator(".prose")).toHaveCSS("max-height", "78px");
    const firstRect = (await cards.first().boundingBox())!, secondRect = (await cards.nth(1).boundingBox())!;
    expect(Math.abs(secondRect.y - firstRect.y - firstRect.height - 32)).toBeLessThan(1);
    expect(secondRect.y - originalSecond).toBeLessThanOrEqual(78);
    await expect(editor.getByText("已自动保存", { exact: true })).toBeVisible();
    expect((await db.post.findFirstOrThrow({ where: { workId: id, title: "把九月，留在这片绿色里" } })).content).toBe(fullContent);
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
    await page.getByRole("button", { name: "连接博文：外部公开博文" }).focus(); await page.keyboard.press("Enter");
    await editor.getByRole("button", { name: "连接照片：窗边植物" }).focus(); await page.keyboard.press("Space");
    await expect(page.getByRole("button", { name: "删除作品连线 1" })).toBeVisible();
    expect(await db.atlasConnection.findFirst({ where: { workId } })).toMatchObject({ fromId: photo.id, toId: externalAnchor.id });
    await expect(page.locator("[data-external-connection] path[stroke-dasharray]")).toHaveCount(1);
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
      await expect(partnerPage.locator("[data-external-connection] path[stroke-dasharray]")).toHaveCount(1);
      await partnerWork.getByRole("button", { name: "编辑作品", exact: true }).click();
      await expect(partnerWork.getByRole("button", { name: "删除作品", exact: true })).toHaveCount(0);
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
      // 原生按钮在水合和首次适配前禁用；直接点击按钮，让就绪检查覆盖实际阅读入口。
      await publicWork.getByRole("button", { name: "把九月，留在这片绿色里", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "阅读博文" })).toContainText("散步、拍照");
      await page.screenshot({ path: testInfo.outputPath("draft-mobile-reading.png") });
      await page.getByRole("button", { name: "关闭阅读博文" }).click();
      await publicWork.getByRole("button", { name: "编辑作品", exact: true }).click();
      await expect(publicWork.getByRole("toolbar", { name: "草稿工具栏" }).getByRole("button")).toHaveText(["博文", "图片"]);
      const deleteButton = publicWork.getByRole("button", { name: "删除作品", exact: true });
      await deleteButton.scrollIntoViewIfNeeded();
      const deleteBox = (await deleteButton.boundingBox())!;
      expect(deleteBox.x).toBeGreaterThanOrEqual(0); expect(deleteBox.x + deleteBox.width).toBeLessThanOrEqual(390);
      await expect(publicWork.getByText("已自动保存", { exact: true })).toHaveCSS("background-color", "rgb(213, 228, 202)");
      await page.screenshot({ path: testInfo.outputPath("published-delete-mobile.png") });
      page.once("dialog", dialog => { expect(dialog.message()).toContain("全部博文、图片和相关连线"); void dialog.accept(); });
      const deleted = page.waitForResponse(r => r.request().method() === "PATCH" && r.url().endsWith(`/works/${workId}`));
      await deleteButton.focus(); await page.keyboard.press("Enter");
      expect((await deleted).status()).toBe(200);
      await expect(publicWork).toHaveCount(0);
      await expect(page.locator("[data-external-connection] path[stroke-dasharray]")).toHaveCount(0);
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

for (const entry of ["发布后原页", "作品深链"]) {
  test(`整组删除从${entry}即时移除，取消不写入且刷新不恢复`, async ({ context }, testInfo) => {
    await withStudyUser(context, async ({ page, db, userId }) => {
      const work = await db.blogWork.create({ data: { owner: { connect: { id: userId } }, board: { connectOrCreate: { where: { id: "home-board" }, create: { id: "home-board" } } }, viewportWidth: 960, viewportHeight: 540 } });
      const post = await db.post.create({ data: { workId: work.id, authorId: userId, workOrder: 0, title: "待删除整组作品", content: "删除后正文和图片一起移除", slug: randomUUID() } });
      await db.atlasElement.create({ data: { workId: work.id, boardId: "home-board", postId: post.id, type: "note", x: 0, y: 0, width: 352, height: 180 } });
      const headers = { "X-Blog-Viewer-Id": userId, origin: new URL(testInfo.project.use.baseURL!).origin };
      const upload = await page.request.post(`/api/blog/works/${work.id}/uploads`, {
        headers, multipart: { file: { name: "delete.png", mimeType: "image/png", buffer: png }, metadata: JSON.stringify({ mutationId: randomUUID(), baseRevision: 0, expectedStatus: "draft", data: { x: 540, y: 180, width: 240, height: 180, caption: "待删除图片" } }) },
      });
      expect(upload.status()).toBe(200);
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto(`/home?draft=${work.id}`);
      const draft = page.getByRole("region", { name: "空间草稿" });
      await waitForWorkLayout(page, draft);
      const saved = draft.getByText("已自动保存", { exact: true });
      await expect(saved).toHaveCSS("border-radius", "8px");
      await expect(saved).toHaveCSS("background-color", "rgb(213, 228, 202)");
      await draft.getByRole("button", { name: "发布", exact: true }).click();
      await expect(draft).toHaveCount(0);
      const published = page.locator(`[data-work-id="${work.id}"]`);
      if (entry === "作品深链") await page.goto(`/home?work=${work.id}`);
      else await published.getByRole("button", { name: "编辑作品", exact: true }).click();
      const button = published.getByRole("button", { name: "删除作品", exact: true });
      await expect(button).toBeEnabled();
      await expect(published.getByRole("button", { name: "退出编辑" })).toBeVisible();
      const before = await db.blogWork.findUniqueOrThrow({ where: { id: work.id } });
      page.once("dialog", dialog => { expect(dialog.message()).toContain("外部相连作品会保留"); void dialog.dismiss(); });
      await button.click();
      await expect(published.getByRole("heading", { name: post.title })).toBeVisible();
      expect(await db.blogWork.findUniqueOrThrow({ where: { id: work.id } })).toEqual(before);
      await page.screenshot({ path: testInfo.outputPath("published-delete-desktop.png") });
      page.once("dialog", dialog => void dialog.accept());
      await button.click();
      await expect(published).toHaveCount(0);
      expect(await db.post.count({ where: { workId: work.id } })).toBe(0);
      expect(await db.atlasElement.count({ where: { workId: work.id } })).toBe(0);
      expect((await page.request.get(`/api/blog/works/${work.id}`)).status()).toBe(404);
      await page.reload();
      await expect(published).toHaveCount(0);
    });
  });
}

test("窄屏缩放下图片鼠标和触摸位移逆变换，Escape 与 pointercancel 不写入", async ({ context, browser }, testInfo) => {
  await withStudyUser(context, async ({ page, db, userId }) => {
    const work = await db.blogWork.create({ data: { owner: { connect: { id: userId } }, board: { connectOrCreate: { where: { id: "home-board" }, create: { id: "home-board" } } }, viewportHeight: 960 } });
    const photo = await db.atlasElement.create({ data: { boardId: "home-board", workId: work.id, type: "photo", x: 80, y: 350, width: 240, height: 180, imageUrl: "/brand/logo_transparent.svg", caption: "缩放移动" } });
    const writes: string[] = [];
    const observeWrites = (target: Page) => target.on("request", request => {
      if (request.method() === "PATCH" && new URL(request.url()).pathname === `/api/blog/works/${work.id}`) writes.push(request.url());
    });
    observeWrites(page);
    const savedGesture = async (target: Page, revision: number, gesture: () => Promise<unknown>) => {
      const reply = target.waitForResponse(response => response.request().method() === "PATCH" && new URL(response.url()).pathname === `/api/blog/works/${work.id}`);
      await gesture();
      const response = await reply;
      expect(response.status()).toBe(200);
      expect((await response.json()).work.revision).toBe(revision);
      await response.finished();
      await expect(target.getByText("已自动保存", { exact: true })).toBeVisible();
    };
    await page.setViewportSize({ width: 390, height: 844 }); await page.goto(`/home?draft=${work.id}`);
    await page.waitForFunction(() => {
      const root = document.querySelector<HTMLElement>(".active-draft .blog-work"), scene = root?.querySelector<HTMLElement>(".work-scene");
      return root && scene && Math.abs(new DOMMatrixReadOnly(getComputedStyle(scene).transform).a - Math.min(1, root.clientWidth / 960)) < 0.001 && [...document.querySelectorAll(".page-enter")].every(node => node.getAnimations().every(animation => animation.playState === "finished"));
    });
    const node = page.locator(`[data-element-id="${photo.id}"]`), box = (await node.boundingBox())!, scale = box.width / 240;
    const x = box.x + box.width / 2, y = box.y + box.height / 3;
    // 工具栏精简后此尺寸的控件留在框内；手势夹具须位于未被状态/工具栏遮挡的内容区。
    expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest("[data-element-id]")?.getAttribute("data-element-id"), { x, y })).toBe(photo.id);
    await savedGesture(page, 1, async () => {
      await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 30, y + 15); await page.mouse.up();
    });
    await expect.poll(async () => (await db.atlasElement.findUniqueOrThrow({ where: { id: photo.id } })).x).toBeCloseTo(80 + 30 / scale, 0);
    const before = await db.atlasElement.findUniqueOrThrow({ where: { id: photo.id } }), revision = (await db.blogWork.findUniqueOrThrow({ where: { id: work.id } })).revision;
    expect(revision).toBe(1);
    expect(writes).toHaveLength(1);
    const moved = (await node.boundingBox())!;
    await page.mouse.move(moved.x + 20, moved.y + 20); await page.mouse.down(); await page.mouse.move(moved.x + 40, moved.y + 30); await page.keyboard.press("Escape"); await page.mouse.up();
    expect(writes).toHaveLength(1);
    expect(await db.atlasElement.findUniqueOrThrow({ where: { id: photo.id } })).toEqual(before);
    expect((await db.blogWork.findUniqueOrThrow({ where: { id: work.id } })).revision).toBe(revision);
    const touch = await browser.newContext({ baseURL: testInfo.project.use.baseURL, viewport: { width: 390, height: 844 }, hasTouch: true, storageState: await context.storageState() });
    try {
      const touchPage = await touch.newPage(); observeWrites(touchPage); await touchPage.goto(`/home?draft=${work.id}`);
      await touchPage.waitForFunction(() => {
        const root = document.querySelector<HTMLElement>(".active-draft .blog-work"), scene = root?.querySelector<HTMLElement>(".work-scene");
        return root && scene && Math.abs(new DOMMatrixReadOnly(getComputedStyle(scene).transform).a - Math.min(1, root.clientWidth / 960)) < 0.001 && [...document.querySelectorAll(".page-enter")].every(node => node.getAnimations().every(animation => animation.playState === "finished"));
      });
      const touchNode = touchPage.locator(`[data-element-id="${photo.id}"]`), rect = (await touchNode.boundingBox())!, cdp = await touch.newCDPSession(touchPage);
      const at = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 3, id: 1 };
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [at] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...at, x: at.x + 20, y: at.y + 10 }] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
      await expect.poll(async () => (await touchNode.boundingBox())!.x).toBeCloseTo(rect.x, 0);
      expect(writes).toHaveLength(1);
      expect(await db.atlasElement.findUniqueOrThrow({ where: { id: photo.id } })).toEqual(before);
      expect((await db.blogWork.findUniqueOrThrow({ where: { id: work.id } })).revision).toBe(revision);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [at] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...at, x: at.x + 20, y: at.y + 10 }] });
      await savedGesture(touchPage, 2, () => cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }));
      await expect.poll(async () => (await db.atlasElement.findUniqueOrThrow({ where: { id: photo.id } })).x).toBeCloseTo(before.x + 20 / scale, 0);
      const resizeBox = (await touchNode.getByRole("button", { name: "调整照片大小：缩放移动" }).boundingBox())!;
      const resizeAt = { x: resizeBox.x + resizeBox.width / 2, y: resizeBox.y + resizeBox.height / 2, id: 1 };
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [resizeAt] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...resizeAt, x: resizeAt.x + 12 }] });
      await expect.poll(async () => (await touchNode.boundingBox())!.width).toBeCloseTo(Math.round(240 + 12 / scale) * scale, 0);
      expect((await db.atlasElement.findUniqueOrThrow({ where: { id: photo.id } })).width).toBe(240);
      await savedGesture(touchPage, 3, () => cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }));
      await expect.poll(async () => (await db.atlasElement.findUniqueOrThrow({ where: { id: photo.id } })).width).toBe(Math.round(240 + 12 / scale));
      const rotatedBox = (await touchNode.boundingBox())!, rotationHandle = (await touchNode.getByRole("button", { name: "旋转照片：缩放移动" }).boundingBox())!;
      const cx = rotatedBox.x + rotatedBox.width / 2, cy = rotatedBox.y + rotatedBox.height / 2;
      const dx = rotationHandle.x + rotationHandle.width / 2 - cx, dy = rotationHandle.y + rotationHandle.height / 2 - cy;
      const rotationAt = (degrees: number) => { const angle = degrees * Math.PI / 180; return { x: cx + dx * Math.cos(angle) - dy * Math.sin(angle), y: cy + dx * Math.sin(angle) + dy * Math.cos(angle), id: 1 }; };
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [rotationAt(0)] });
      for (const angle of [5, 10, 15, 20]) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [rotationAt(angle)] });
      await expect.poll(() => touchNode.evaluate(node => { const m = new DOMMatrixReadOnly(getComputedStyle(node).transform); return Math.atan2(m.b, m.a) * 180 / Math.PI; })).toBeCloseTo(20, 0);
      expect((await db.atlasElement.findUniqueOrThrow({ where: { id: photo.id } })).rotation).toBe(0);
      await savedGesture(touchPage, 4, () => cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }));
      await expect.poll(async () => (await db.atlasElement.findUniqueOrThrow({ where: { id: photo.id } })).rotation).toBe(20);
      expect(writes).toHaveLength(4);
      const final = await db.atlasElement.findUniqueOrThrow({ where: { id: photo.id } });
      expect(final.y).toBeCloseTo(before.y + 10 / scale, 0);
      expect(final.height).toBe(Math.round(final.width / (240 / 180)));
      expect((await db.blogWork.findUniqueOrThrow({ where: { id: work.id } })).revision).toBe(4);
      await touchPage.reload();
      await expect.poll(() => touchPage.locator(`[data-element-id="${photo.id}"]`).evaluate(node => { const m = new DOMMatrixReadOnly(getComputedStyle(node).transform); return Math.atan2(m.b, m.a) * 180 / Math.PI; })).toBeCloseTo(20, 0);
      expect(await db.atlasElement.findUniqueOrThrow({ where: { id: photo.id } })).toEqual(final);
      expect(writes).toHaveLength(4);
      await cdp.detach();
    } finally { await touch.close(); }
  });
});

test("保存响应与 Escape 交叠、迟到鼠标释放均不提交触摸取消，后续手势可保存", async ({ context, browser }, testInfo) => {
  await withStudyUser(context, async ({ db, userId }) => {
    const work = await db.blogWork.create({ data: { owner: { connect: { id: userId } }, board: { connectOrCreate: { where: { id: "home-board" }, create: { id: "home-board" } } }, viewportHeight: 960 } });
    const photo = await db.atlasElement.create({ data: { boardId: "home-board", workId: work.id, type: "photo", x: 80, y: 350, width: 240, height: 180, imageUrl: "/brand/logo_transparent.svg", caption: "交叠取消" } });
    const touch = await browser.newContext({ baseURL: testInfo.project.use.baseURL, viewport: { width: 390, height: 844 }, hasTouch: true, storageState: await context.storageState() });
    const page = await touch.newPage();
    const writes: Array<{ baseRevision: number; operation: string; utc: string; monotonicNs: string }> = [];
    let pointers: object[] = [];
    let releaseResponse: () => void = () => {};
    try {
      const heldResponse = new Promise<void>(resolve => { releaseResponse = resolve; });
      let held = false;
      await page.route(`**/api/blog/works/${work.id}`, async route => {
        if (route.request().method() !== "PATCH" || held) { await route.continue(); return; }
        held = true;
        const response = await route.fetch();
        await heldResponse;
        await route.fulfill({ response });
      });
      page.on("request", request => {
        if (request.method() === "PATCH" && new URL(request.url()).pathname === `/api/blog/works/${work.id}`) {
          const body = request.postDataJSON();
          writes.push({ baseRevision: body.baseRevision, operation: body.command.operation, utc: new Date().toISOString(), monotonicNs: process.hrtime.bigint().toString() });
        }
      });
      await page.goto(`/home?draft=${work.id}`);
      const editor = page.getByRole("region", { name: "空间草稿" }), node = page.locator(`[data-element-id="${photo.id}"]`);
      await waitForWorkLayout(page, editor);
      await expect.poll(() => editor.locator(".work-scene").evaluate(scene => new DOMMatrixReadOnly(getComputedStyle(scene).transform).a)).toBeLessThan(1);
      await node.evaluate(target => {
        const events: object[] = [];
        Object.assign(window, { photoCancellationEvents: events });
        for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel", "gotpointercapture", "lostpointercapture"]) {
          target.addEventListener(type, raw => {
            const event = raw as PointerEvent;
            events.push({ type, pointerId: event.pointerId, pointerType: event.pointerType, capture: target.hasPointerCapture(event.pointerId), x: event.clientX, y: event.clientY, utc: new Date().toISOString(), monotonicMs: performance.now() });
          }, true);
        }
      });
      const box = (await node.boundingBox())!, scale = box.width / photo.width;
      const at = { x: box.x + box.width / 2, y: box.y + box.height / 3, id: 1 };
      expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest("[data-element-id]")?.getAttribute("data-element-id"), at)).toBe(photo.id);
      // 首次提交使用可精确表示的场景位移，使本例只观测响应/事件交叠。
      const firstResponse = page.waitForResponse(response => response.request().method() === "PATCH" && new URL(response.url()).pathname === `/api/blog/works/${work.id}`);
      await page.mouse.move(at.x, at.y); await page.mouse.down(); await page.mouse.move(at.x + 80 * scale, at.y + 40 * scale); await page.mouse.up();
      // 真实事务已提交，但响应正文暂未交给编辑器；不靠 sleep 安排交叠。
      await expect.poll(async () => (await db.atlasElement.findUniqueOrThrow({ where: { id: photo.id } })).x).toBeCloseTo(photo.x + 80, 0);
      const before = await db.atlasElement.findUniqueOrThrow({ where: { id: photo.id } });
      expect((await db.blogWork.findUniqueOrThrow({ where: { id: work.id } })).revision).toBe(1);
      const moved = (await node.boundingBox())!;
      const start = { x: moved.x + moved.width / 2, y: moved.y + moved.height / 3, id: 1 };
      await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(start.x + 20, start.y + 10);
      releaseResponse();
      await page.keyboard.press("Escape");
      expect(await node.evaluate(target => target.hasPointerCapture(1))).toBe(false);
      await expect.poll(async () => (await node.boundingBox())!.x).toBeCloseTo(moved.x, 0);
      expect((await firstResponse).status()).toBe(200);
      await expect(editor.getByText("已自动保存", { exact: true })).toBeVisible();
      const cdp = await touch.newCDPSession(page);
      try {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [start] });
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...start, x: start.x + 20, y: start.y + 10 }] });
        await expect.poll(async () => (await node.boundingBox())!.x).toBeCloseTo(moved.x + 20, 0);
        // 已取消的鼠标仍物理按住；迟到 pointerup 不能结束当前触摸或清除其预览。
        await page.mouse.up();
        await expect.poll(async () => (await node.boundingBox())!.x).toBeCloseTo(moved.x + 20, 0);
        await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
        await expect.poll(async () => (await node.boundingBox())!.x).toBeCloseTo(moved.x, 0);
        expect(writes).toHaveLength(1);
        expect((await db.blogWork.findUniqueOrThrow({ where: { id: work.id } })).revision).toBe(1);
        expect(await db.atlasElement.findUniqueOrThrow({ where: { id: photo.id } })).toEqual(before);
        const saved = page.waitForResponse(response => response.request().method() === "PATCH" && new URL(response.url()).pathname === `/api/blog/works/${work.id}`);
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [start] });
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...start, x: start.x + 20, y: start.y + 10 }] });
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        const response = await saved;
        expect(response.status()).toBe(200);
        expect((await response.json()).work.revision).toBe(2);
        await response.finished();
        await expect(editor.getByText("已自动保存", { exact: true })).toBeVisible();
        const after = await db.atlasElement.findUniqueOrThrow({ where: { id: photo.id } });
        expect(after.x).toBeCloseTo(before.x + 20 / scale, 0);
        expect(after.y).toBeCloseTo(before.y + 10 / scale, 0);
        expect(after).toMatchObject({ width: before.width, height: before.height, rotation: before.rotation });
        expect((await db.blogWork.findUniqueOrThrow({ where: { id: work.id } })).revision).toBe(2);
        expect(writes.map(write => write.baseRevision)).toEqual([0, 1]);
        pointers = await page.evaluate(() => (window as unknown as { photoCancellationEvents: object[] }).photoCancellationEvents);
        await page.reload();
        await waitForWorkLayout(page, editor);
        await expect.poll(() => node.evaluate(target => Number.parseFloat((target as HTMLElement).style.left))).toBeCloseTo(after.x, 0);
        expect(await db.atlasElement.findUniqueOrThrow({ where: { id: photo.id } })).toEqual(after);
      } finally { await cdp.detach(); }
    } finally {
      releaseResponse();
      pointers = await page.evaluate(() => (window as unknown as { photoCancellationEvents?: object[] }).photoCancellationEvents).catch(() => undefined) ?? pointers;
      await testInfo.attach("图片取消请求与指针时序", { contentType: "application/json", body: JSON.stringify({ pointers, writes }) });
      await touch.close();
    }
  });
});

test("图片改回原尺寸后交叠保存响应不覆盖预览，后续键盘尺寸正确持久化", async ({ context }, testInfo) => {
  await withStudyUser(context, async ({ page, db, userId }) => {
    const work = await db.blogWork.create({ data: { ownerId: userId, boardId: "home-board" } });
    const upload = await page.request.post(`/api/blog/works/${work.id}/uploads`, {
      headers: { "X-Blog-Viewer-Id": userId, origin: new URL(testInfo.project.use.baseURL!).origin },
      multipart: { file: { name: "overlap.png", mimeType: "image/png", buffer: png }, metadata: JSON.stringify({ mutationId: randomUUID(), baseRevision: 0, expectedStatus: "draft", data: { x: 80, y: 180, width: 240, height: 180, caption: "连续缩放" } }) },
    });
    expect(upload.status()).toBe(200);
    const photo = await db.atlasElement.findFirstOrThrow({ where: { workId: work.id, type: "photo" } });
    const initialRevision = (await db.blogWork.findUniqueOrThrow({ where: { id: work.id } })).revision;
    const path = `/api/blog/works/${work.id}`;
    const replies = Array.from({ length: 2 }, () => {
      let release!: () => void;
      const pending = new Promise<void>(resolve => { release = resolve; });
      return { pending, release };
    });
    const widths: number[] = [];
    // 确认编辑器已经读取首次响应，再等待一帧，观察真实渲染后的编辑基线。
    await page.addInitScript(({ path }) => {
      const original = window.fetch;
      Object.assign(window, { photoSaveReads: [] });
      window.fetch = async (...args) => {
        const response = await original(...args);
        if (new URL(response.url).pathname === path && args[1]?.method === "PATCH") {
          const read = response.json.bind(response);
          response.json = async () => {
            const data = await read();
            (window as unknown as { photoSaveReads: number[] }).photoSaveReads.push(data.work?.revision ?? -1);
            return data;
          };
        }
        return response;
      };
    }, { path });
    await page.route(`**${path}`, async route => {
      if (route.request().method() !== "PATCH") { await route.continue(); return; }
      const index = widths.length;
      widths.push(route.request().postDataJSON().command.data.width);
      const response = await route.fetch();
      if (replies[index]) await replies[index].pending;
      await route.fulfill({ response });
    });
    try {
      await page.goto(`/home?draft=${work.id}`);
      const editor = page.getByRole("region", { name: "空间草稿" });
      const node = editor.locator(`[data-element-id="${photo.id}"]`);
      const resize = node.getByRole("button", { name: "调整照片大小：连续缩放", exact: true });
      const displayedWidth = () => node.evaluate(target => (target as HTMLElement).style.getPropertyValue("--home-photo-width"));
      await waitForWorkLayout(page, editor);
      await resize.press("ArrowRight");
      await expect.poll(async () => (await db.blogWork.findUniqueOrThrow({ where: { id: work.id } })).revision).toBe(initialRevision + 1);
      await resize.press("ArrowLeft");
      await expect.poll(displayedWidth).toBe("240px");
      replies[0].release();
      await page.waitForFunction(revision => (window as unknown as { photoSaveReads: number[] }).photoSaveReads.includes(revision), initialRevision + 1);
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
      // 第二次事务已提交，但响应仍暂扣；首次响应不能把预览改回 250。
      await expect.poll(async () => (await db.blogWork.findUniqueOrThrow({ where: { id: work.id } })).revision).toBe(initialRevision + 2);
      await expect.poll(displayedWidth).toBe("240px");
      await resize.press("ArrowRight");
      await expect.poll(displayedWidth).toBe("250px");
      replies[1].release();
      await expect(editor.getByText("已自动保存", { exact: true })).toBeVisible();
      expect(widths).toEqual([250, 240, 250]);
      expect(await db.atlasElement.findUniqueOrThrow({ where: { id: photo.id } })).toMatchObject({ width: 250, height: 188 });
      expect((await db.blogWork.findUniqueOrThrow({ where: { id: work.id } })).revision).toBe(initialRevision + 3);
      await page.reload();
      await waitForWorkLayout(page, editor);
      await expect.poll(displayedWidth).toBe("250px");
      await expect(editor.getByRole("button", { name: "发布", exact: true })).toBeEnabled();
      expect(widths).toHaveLength(3);
    } finally {
      replies.forEach(reply => reply.release());
    }
  });
});

test("非精确缩放的已保存图片在响应交叠后取消不残留脏状态，真实编辑仍须确认保存", async ({ context }, testInfo) => {
  await withStudyUser(context, async ({ page, db, userId }) => {
    const work = await db.blogWork.create({ data: { owner: { connect: { id: userId } }, board: { connectOrCreate: { where: { id: "home-board" }, create: { id: "home-board" } } }, viewportHeight: 960 } });
    const upload = await page.request.post(`/api/blog/works/${work.id}/uploads`, {
      headers: { "X-Blog-Viewer-Id": userId, origin: new URL(testInfo.project.use.baseURL!).origin },
      multipart: { file: { name: "roundoff.png", mimeType: "image/png", buffer: png }, metadata: JSON.stringify({ mutationId: randomUUID(), baseRevision: 0, expectedStatus: "draft", data: { x: 80, y: 350, width: 240, height: 180, caption: "尾差取消" } }) },
    });
    expect(upload.status()).toBe(200);
    const photo = await db.atlasElement.findFirstOrThrow({ where: { workId: work.id, type: "photo" } });
    const initialRevision = (await db.blogWork.findUniqueOrThrow({ where: { id: work.id } })).revision;
    const path = `/api/blog/works/${work.id}`;
    const writes: Array<{ baseRevision: number; command: { operation: string; data?: { x?: number; y?: number } } }> = [];
    const observations: object[] = [];
    let releaseResponse: () => void = () => {};
    const heldResponse = new Promise<void>(resolve => { releaseResponse = resolve; });
    let held = false, failNext = false;
    await page.setViewportSize({ width: 390, height: 844 });
    // 观察应用实际消费 JSON 的时刻，再等浏览器绘制；响应到达不等于编辑器已处理。
    await page.addInitScript(({ path }) => {
      const original = window.fetch;
      Object.assign(window, { photoSaveReads: [] });
      window.fetch = async (...args) => {
        const response = await original(...args);
        if (new URL(response.url).pathname === path && args[1]?.method === "PATCH") {
          const read = response.json.bind(response);
          response.json = async () => {
            const data = await read();
            (window as unknown as { photoSaveReads: number[] }).photoSaveReads.push(data.work?.revision ?? -1);
            return data;
          };
        }
        return response;
      };
    }, { path });
    await page.route(`**${path}`, async route => {
      if (route.request().method() !== "PATCH") { await route.continue(); return; }
      if (failNext) { failNext = false; await route.fulfill({ status: 500, json: { error: "测试图片保存失败" } }); return; }
      if (held) { await route.continue(); return; }
      held = true;
      const response = await route.fetch();
      await heldResponse;
      await route.fulfill({ response });
    });
    page.on("request", request => {
      if (request.method() === "PATCH" && new URL(request.url()).pathname === path) writes.push(request.postDataJSON());
    });
    try {
      await page.goto(`/home?draft=${work.id}`);
      const editor = page.getByRole("region", { name: "空间草稿" }), node = editor.locator(`[data-element-id="${photo.id}"]`);
      await waitForWorkLayout(page, editor);
      await expect.poll(() => editor.locator(".work-scene").evaluate(scene => new DOMMatrixReadOnly(getComputedStyle(scene).transform).a)).toBe(0.36875);
      const box = (await node.boundingBox())!, start = { x: box.x + box.width / 2, y: box.y + box.height / 3 };
      await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(start.x + 30, start.y + 15); await page.mouse.up();
      await expect.poll(async () => (await db.blogWork.findUniqueOrThrow({ where: { id: work.id } })).revision).toBe(initialRevision + 1);
      const committed = await db.atlasElement.findUniqueOrThrow({ where: { id: photo.id } });
      const submitted = writes[0].command.data!;
      expect(submitted.x).toBe(161.35593220338984);
      expect(committed.x).toBe(161.3559322033898);
      const moved = (await node.boundingBox())!, next = { x: moved.x + moved.width / 2, y: moved.y + moved.height / 3 };
      await page.mouse.move(next.x, next.y); await page.mouse.down(); await page.mouse.move(next.x + 20, next.y + 10);
      await expect.poll(async () => (await node.boundingBox())!.x).toBeCloseTo(moved.x + 20, 0);
      releaseResponse();
      await page.waitForFunction(revision => (window as unknown as { photoSaveReads: number[] }).photoSaveReads.includes(revision), initialRevision + 1);
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
      await page.keyboard.press("Escape"); await page.mouse.up();
      await expect.poll(async () => (await node.boundingBox())!.x).toBeCloseTo(moved.x, 0);
      expect(await node.evaluate(target => target.hasPointerCapture(1))).toBe(false);
      expect(writes).toHaveLength(1);
      expect(await db.atlasElement.findUniqueOrThrow({ where: { id: photo.id } })).toEqual(committed);
      expect((await db.blogWork.findUniqueOrThrow({ where: { id: work.id } })).revision).toBe(initialRevision + 1);
      observations.push({ stage: "取消后", submitted, stored: { x: committed.x, y: committed.y }, writes: writes.length, status: await editor.getByRole("status").innerText() });
      await expect(editor.getByText("已自动保存", { exact: true })).toBeVisible();
      await expect(editor.getByRole("button", { name: "发布", exact: true })).toBeEnabled();

      // 位置、尺寸、角度均有真实保存；失败时仍阻止发布，重试保留原操作。
      await page.mouse.move(next.x, next.y); await page.mouse.down(); await page.mouse.move(next.x + 10, next.y + 5);
      await expect(editor.getByText("保存中…", { exact: true })).toBeVisible();
      await expect(editor.getByRole("button", { name: "发布", exact: true })).toBeDisabled();
      expect(writes).toHaveLength(1);
      await page.mouse.up();
      await expect(editor.getByText("已自动保存", { exact: true })).toBeVisible();
      await expect.poll(async () => (await db.blogWork.findUniqueOrThrow({ where: { id: work.id } })).revision).toBe(initialRevision + 2);
      const movedAgain = await db.atlasElement.findUniqueOrThrow({ where: { id: photo.id } });
      expect(movedAgain.x).toBeCloseTo(committed.x + 10 / 0.36875, 8);
      expect(movedAgain.y).toBeCloseTo(committed.y + 5 / 0.36875, 8);
      await node.getByRole("button", { name: "调整照片大小：尾差取消", exact: true }).press("ArrowRight");
      await expect(editor.getByText("已自动保存", { exact: true })).toBeVisible();
      expect(await db.atlasElement.findUniqueOrThrow({ where: { id: photo.id } })).toMatchObject({ width: 250, height: 188 });
      failNext = true;
      await node.getByRole("button", { name: "旋转照片：尾差取消", exact: true }).focus();
      await page.keyboard.down("ArrowRight");
      await expect(editor.getByText("保存中…", { exact: true })).toBeVisible();
      expect(writes).toHaveLength(3);
      await page.keyboard.up("ArrowRight");
      await expect(editor.getByText("保存失败", { exact: true })).toBeVisible();
      await expect(editor.getByRole("button", { name: "发布", exact: true })).toBeDisabled();
      expect((await db.atlasElement.findUniqueOrThrow({ where: { id: photo.id } })).rotation).toBe(0);
      await editor.getByRole("button", { name: "重试保存", exact: true }).click();
      await expect(editor.getByText("已自动保存", { exact: true })).toBeVisible();
      const final = await db.atlasElement.findUniqueOrThrow({ where: { id: photo.id } });
      expect(final.rotation).toBe(1);
      expect(writes.map(write => write.baseRevision)).toEqual([0, 1, 2, 3, 3].map(delta => initialRevision + delta));
      observations.push({ stage: "真实修改及重试后", stored: { x: final.x, y: final.y, width: final.width, height: final.height, rotation: final.rotation }, writes: writes.length });
      await editor.getByRole("button", { name: "退出草稿", exact: true }).click();
      await expect(editor).toHaveCount(0);
      await page.goto(`/home?draft=${work.id}`);
      await waitForWorkLayout(page, editor);
      await expect(editor.getByText("已自动保存", { exact: true })).toBeVisible();
      await page.reload();
      await waitForWorkLayout(page, editor);
      await expect(editor.getByText("已自动保存", { exact: true })).toBeVisible();
      expect(await db.atlasElement.findUniqueOrThrow({ where: { id: photo.id } })).toEqual(final);
      expect(writes).toHaveLength(5);
      await editor.getByRole("button", { name: "发布", exact: true }).click();
      await expect(page.locator(`[data-work-id="${work.id}"]`).getByRole("button", { name: "编辑作品", exact: true })).toBeVisible();
      expect((await db.blogWork.findUniqueOrThrow({ where: { id: work.id } }))).toMatchObject({ revision: initialRevision + 5, status: "published" });
      expect(writes.map(write => write.command.operation)).toEqual(["photo.update", "photo.update", "photo.update", "photo.update", "photo.update", "publish"]);
    } finally {
      releaseResponse();
      await testInfo.attach("图片尾差与保存行为", { contentType: "application/json", body: JSON.stringify({ observations, writes }) });
    }
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
    await expect(editor.locator(`[data-work-connection="${connection.id}"] path[stroke-dasharray]`)).toBeVisible();
    const circles = await editor.locator(`[data-work-connection="${connection.id}"] circle`).evaluateAll(nodes => nodes.map(n => ({ x: Number(n.getAttribute("cx")), y: Number(n.getAttribute("cy")) })));
    expect(circles[1].x).toBeGreaterThan(0); expect(circles[1].y).toBeGreaterThan(120);
    await page.setViewportSize({ width: 375, height: 812 }); await expect(editor.locator(`[data-work-connection="${connection.id}"] path[stroke-dasharray]`)).toBeVisible();
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
    for (const name of ["博文", "图片"]) await editor.getByRole("button", { name, exact: true }).click({ trial: true });
  });
});

test("双标签页同字段冲突保留本地输入，明确选择后重提", async ({ context }, testInfo) => {
  await withStudyUser(context, async ({ page, db, userId }) => {
    const work = await db.blogWork.create({ data: { owner: { connect: { id: userId } }, board: { connectOrCreate: { where: { id: "home-board" }, create: { id: "home-board" } } } } });
    const other = await context.newPage();
    const startedAt = Date.now(), loadingEvents: Array<Record<string, unknown>> = [];
    const stopDiagnostics = ([["first", page], ["second", other]] as const).map(([label, tab]) =>
      observeResponseDiagnostics(tab, `/api/blog/works/${work.id}`, event => loadingEvents.push({ tab: label, ...event, at: Date.now() - startedAt })));
    const responseFor = (tab: Page, method: "GET" | "PATCH", status?: number) => tab.waitForResponse(response =>
      response.request().method() === method && response.url().endsWith(`/api/blog/works/${work.id}`) && (status === undefined || response.status() === status));
    try {
      const revisions: number[] = [];
      for (const [label, tab] of [["first", page], ["second", other]] as const) {
        // document load 不表示水合后的作品 GET 已完成；先确认真实响应，再开始 UI 断言。
        const [response] = await Promise.all([responseFor(tab, "GET"), tab.goto(`/home?draft=${work.id}`)]);
        expect(response.status()).toBe(200);
        const { work: opened } = await response.json();
        revisions.push(opened.revision);
        await expect(tab.getByRole("region", { name: "空间草稿" })).toBeVisible();
        loadingEvents.push({ tab: label, event: "editor-ready", revision: opened.revision, at: Date.now() - startedAt, ...await tab.evaluate(() => ({ ready: document.readyState, visibility: document.visibilityState })) });
      }
      expect(revisions).toEqual([work.revision, work.revision]);
      // 一直冻结第二页回读到旧版本 PATCH 真正发出，随后允许冲突处理读取最新状态。
      let stalePatchSent = false;
      await other.route(`**/api/blog/works/${work.id}`, async route => {
        if (route.request().method() === "PATCH") stalePatchSent = true;
        if (route.request().method() === "GET" && !stalePatchSent) await route.fulfill({ status: 503, json: { error: "离线回读" } });
        else await route.continue();
      });
      const firstSaved = responseFor(page, "PATCH");
      await page.getByRole("button", { name: "调整草稿右边界", exact: true }).focus(); await page.keyboard.press("Shift+ArrowLeft");
      const firstResponse = await firstSaved;
      expect(firstResponse.status()).toBe(200);
      expect(firstResponse.request().postDataJSON().baseRevision).toBe(work.revision);
      const { work: firstResult } = await firstResponse.json();
      expect(firstResult.viewportWidth).toBe(950);
      await expect(page.getByText("已自动保存", { exact: true })).toBeVisible();
      const conflictResult = Promise.all([
        responseFor(other, "PATCH").then(async response => {
          expect(response.status()).toBe(409);
          expect(response.request().postDataJSON().baseRevision).toBe(work.revision);
          expect(await response.json()).toMatchObject({ code: "REVISION_CONFLICT" });
        }),
        responseFor(other, "GET", 200).then(async response => {
          const { work: latest } = await response.json();
          expect(latest).toMatchObject({ revision: firstResult.revision, viewportWidth: 950 });
        }),
      ]);
      await other.getByRole("button", { name: "调整草稿右边界", exact: true }).focus(); await other.keyboard.press("ArrowLeft");
      await conflictResult;
      await expect(other.getByText("修改冲突", { exact: true })).toBeVisible();
      expect((await db.blogWork.findUniqueOrThrow({ where: { id: work.id } })).viewportWidth).toBe(950);
      const resubmitted = responseFor(other, "PATCH");
      await other.getByRole("button", { name: "重新提交我的修改" }).click();
      const resubmittedResponse = await resubmitted;
      expect(resubmittedResponse.status()).toBe(200);
      expect(resubmittedResponse.request().postDataJSON().baseRevision).toBe(firstResult.revision);
      expect((await resubmittedResponse.json()).work.viewportWidth).toBe(959);
      await expect(other.getByText("已自动保存", { exact: true })).toBeVisible();
      expect((await db.blogWork.findUniqueOrThrow({ where: { id: work.id } })).viewportWidth).toBe(959);
    } finally {
      try {
        await other.close();
      } finally {
        for (const stop of stopDiagnostics) stop();
        await testInfo.attach("draft-loading-events", { contentType: "application/json", body: JSON.stringify(loadingEvents, null, 2) });
      }
    }
  });
});

test("草稿内点击接线与取消、键盘删除，图片手势及刷新保持正确", async ({ context }) => {
  await withStudyUser(context, async ({ page, db, userId }) => {
    const work = await db.blogWork.create({ data: { ownerId: userId, boardId: "home-board", viewportWidth: 960, viewportHeight: 540 } });
    const post = await db.post.create({ data: { workId: work.id, authorId: userId, workOrder: 0, title: "点击连线的博文", content: "正文区域直接连接图片", slug: randomUUID() } });
    const note = await db.atlasElement.create({ data: { workId: work.id, boardId: "home-board", postId: post.id, type: "note", x: 96, y: 72 } });
    const photo = await db.atlasElement.create({ data: { workId: work.id, boardId: "home-board", type: "photo", x: 560, y: 200, width: 180, height: 140, imageUrl: "/brand/logo_transparent.svg", caption: "点击图片" } });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/home?draft=${work.id}`);
    const editor = page.locator(`[data-work-id="${work.id}"]`), picture = editor.getByRole("button", { name: "连接照片：点击图片" });
    const body = editor.locator(`[data-work-post="${post.id}"] .prose`);
    await waitForWorkLayout(page, editor);
    await expect(editor.getByRole("toolbar").getByRole("button")).toHaveText(["博文", "图片"]);
    await picture.click({ position: { x: 60, y: 65 } });
    await expect(picture).toHaveAttribute("aria-pressed", "true");
    await picture.click({ position: { x: 60, y: 65 } });
    await expect(picture).toHaveAttribute("aria-pressed", "false");
    await body.click();
    await expect(editor.getByRole("button", { name: "连接博文：点击连线的博文" })).toHaveAttribute("aria-pressed", "true");
    await expect(editor.getByRole("button", { name: "连接博文：点击连线的博文" })).toHaveAttribute("aria-pressed", "false");
    // 越过拖动阈值后回到原点，不能把松手解释成第二次点击。
    await body.click();
    const box = (await picture.boundingBox())!;
    await page.mouse.move(box.x + 60, box.y + 65); await page.mouse.down();
    await page.mouse.move(box.x + 95, box.y + 85, { steps: 3 });
    await page.mouse.move(box.x + 60, box.y + 65, { steps: 3 }); await page.mouse.up();
    await expect(editor.getByText("已自动保存", { exact: true })).toBeVisible();
    expect(await db.atlasConnection.count({ where: { workId: work.id } })).toBe(0);
    await page.keyboard.press("Escape");
    await body.click(); await picture.click({ position: { x: 60, y: 65 } });
    await expect(editor.locator("[data-work-connection]")).toHaveCount(1);
    await expect(editor.getByText("已自动保存", { exact: true })).toBeVisible();
    expect(await db.atlasConnection.findFirst({ where: { workId: work.id } })).toMatchObject({ fromId: note.id, toId: photo.id });
    await page.reload();
    await expect(editor.locator("[data-work-connection]")).toHaveCount(1);
    await editor.getByRole("button", { name: "删除作品连线 1" }).focus(); await page.keyboard.press("Space");
    await expect(editor.locator("[data-work-connection]")).toHaveCount(0);
    await expect(editor.getByText("已自动保存", { exact: true })).toBeVisible();
    await page.reload();
    await expect(editor.getByText("已自动保存", { exact: true })).toBeVisible();
    await expect(editor.locator("[data-work-connection]")).toHaveCount(0);
    expect(await db.atlasElement.count({ where: { workId: work.id } })).toBe(2);
  });
});

for (const target of ["普通图片", "公开作品博文"] as const) {
  for (const outsideFirst of [false, true]) {
    test(`草稿跨边界点击：${target}、${outsideFirst ? "外部" : "草稿"}先选，归属与删除刷新一致`, async ({ context }) => {
      await withStudyUser(context, async ({ page, db, userId }) => {
        const work = await db.blogWork.create({ data: { ownerId: userId, boardId: "home-board", draftX: target === "普通图片" && outsideFirst ? 24 : 800, draftY: 40, viewportWidth: 640, viewportHeight: 420 } });
        const upload = await page.request.post(`/api/blog/works/${work.id}/uploads`, {
          headers: { origin: new URL(test.info().project.use.baseURL!).origin, "X-Blog-Viewer-Id": userId },
          multipart: {
            file: { name: "connection.png", mimeType: "image/png", buffer: png },
            metadata: JSON.stringify({ mutationId: randomUUID(), baseRevision: work.revision, expectedStatus: "draft", data: { x: 400, y: 150, width: 180, height: 140, caption: "草稿端点" } }),
          },
        });
        expect(upload.status()).toBe(200);
        const { resourceId: localId } = await upload.json() as { resourceId: string };
        const publicWork = target === "公开作品博文" ? await db.blogWork.create({ data: { ownerId: userId, boardId: "home-board", status: "published", publishedAt: new Date("2020-01-01T00:00:00Z"), viewportWidth: 640, viewportHeight: 360 } }) : null;
        const post = publicWork ? await db.post.create({ data: { authorId: userId, workId: publicWork.id, workOrder: 0, title: "外部作品端点", content: "点击这段公开正文", slug: randomUUID(), publishedAt: publicWork.publishedAt } }) : null;
        const external = await db.atlasElement.create({ data: { boardId: "home-board", workId: publicWork?.id, postId: post?.id, type: post ? "note" : "photo", x: 60, y: 200, width: 180, height: 140, imageUrl: post ? null : "/brand/logo_transparent.svg", caption: "外部画板端点" } });
        try {
          await page.setViewportSize({ width: 1600, height: 1050 }); await page.goto(`/home?draft=${work.id}`);
          const editor = page.locator(`[data-work-id="${work.id}"]`), picture = editor.getByRole("button", { name: "连接照片：草稿端点" });
          await waitForWorkLayout(page, editor);
          const outside = post ? page.locator(`[data-work-post="${post.id}"] .prose`) : page.getByRole("button", { name: "连接照片：外部画板端点" });
          if (publicWork) await waitForPublishedLayout(page, page.locator(`[data-work-id="${publicWork.id}"]`), 640);
          // 先测量两个可见端点，再连续发送真实指针事件，避免第二次定位/滚动耗时超过 1500ms 选择窗口。
          const insideBox = (await picture.boundingBox())!, outsideBox = (await outside.boundingBox())!;
          const insidePoint = { x: insideBox.x + 60, y: insideBox.y + 65 };
          const outsidePoint = { x: outsideBox.x + (post ? 25 : 60), y: outsideBox.y + (post ? 15 : 65) };
          for (const point of [insidePoint, outsidePoint]) {
            expect(point.x).toBeGreaterThan(0); expect(point.x).toBeLessThan(1600);
            expect(point.y).toBeGreaterThan(0); expect(point.y).toBeLessThan(1050);
          }
          const clickInside = () => page.mouse.click(insidePoint.x, insidePoint.y);
          const clickOutside = () => page.mouse.click(outsidePoint.x, outsidePoint.y);
          if (outsideFirst) { await clickOutside(); await clickInside(); }
          else { await clickInside(); await clickOutside(); }
          const line = page.locator("[data-external-connection]");
          await expect(line).toHaveCount(1);
          await expect(editor.getByText("已自动保存", { exact: true })).toBeVisible();
          const saved = await db.atlasConnection.findFirstOrThrow({ where: { workId: work.id } });
          expect(saved).toMatchObject({ fromId: localId, toId: external.id, workId: work.id });
          expect((await db.atlasElement.findUniqueOrThrow({ where: { id: external.id } })).workId).toBe(publicWork?.id ?? null);
          // 发布后另一作品也会读到这条线；删除必须以所属作品的新快照为准。
          const publishBeforeDelete = !!publicWork && outsideFirst;
          if (publishBeforeDelete) {
            await editor.getByRole("button", { name: "发布", exact: true }).click();
            await expect(editor.getByRole("button", { name: "编辑作品", exact: true })).toBeVisible();
          }
          await page.reload();
          await waitForWorkLayout(page, editor);
          if (publishBeforeDelete) await waitForPublishedLayout(page, editor, work.viewportWidth);
          if (publicWork) await waitForPublishedLayout(page, page.locator(`[data-work-id="${publicWork.id}"]`), publicWork.viewportWidth);
          expect(await db.atlasConnection.findUnique({ where: { id: saved.id } })).toMatchObject({ workId: work.id, fromId: localId, toId: external.id });
          await expect(line, "两端布局就绪后，刷新保留已保存连线").toHaveCount(1);
          if (publishBeforeDelete) await editor.getByRole("button", { name: "编辑作品", exact: true }).click();
          await page.getByRole("button", { name: "删除作品连线 1" }).focus(); await page.keyboard.press("Enter");
          await expect(line).toHaveCount(0);
          await expect(editor.getByText("已自动保存", { exact: true })).toBeVisible();
          await page.reload();
          if (publishBeforeDelete) await editor.getByRole("button", { name: "编辑作品", exact: true }).click();
          await expect(editor.getByText("已自动保存", { exact: true })).toBeVisible();
          await expect(line).toHaveCount(0);
          expect(await db.atlasElement.count({ where: { id: { in: [localId, external.id] } } })).toBe(2);
          expect(await db.atlasConnection.count({ where: { id: saved.id } })).toBe(0);
        } finally { await page.close(); await db.atlasElement.deleteMany({ where: { id: external.id } }); }
      });
    });
  }
}
