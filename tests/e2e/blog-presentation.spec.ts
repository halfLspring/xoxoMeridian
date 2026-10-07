import { randomUUID } from "node:crypto";
import { expect, test, type Locator } from "@playwright/test";
import { withStudyUser } from "@/tests/e2e/support/study";
import { MINIMAL_PNG } from "@/tests/fixtures/image-bytes";

const title = "同一篇中文 English 博文";
const content = "**中文 English 摘要**\n第二行 second line\n\n- 列表 one\n- 列表 two\n\n" + "后续段落 Paragraph。".repeat(50) + "全文结尾 END";
const publishedAt = new Date("2050-05-02T16:30:00Z");

async function waitForPublishedWorkLayout(editor: Locator, savedWidth: number, timeout = 5000) {
  // Edit 可见时，首次 fit 仍可能未提交；等待实际宽度和居中位置，避免 hover 后目标移开。
  await expect.poll(() => editor.evaluate((node, width) => {
    const host = node.parentElement!.getBoundingClientRect(), frame = node.getBoundingClientRect();
    const displayedWidth = Math.min(width, host.width);
    return Math.abs(frame.width - displayedWidth) <= 1 && Math.abs(frame.x - host.x - (host.width - displayedWidth) / 2) <= 1;
  }, savedWidth), { timeout, message: "已发布作品适配布局就绪" }).toBe(true);
}

async function hoverPublishedWorkEdit(editor: Locator, savedWidth: number, edit: Locator, timeout = 5000) {
  await waitForPublishedWorkLayout(editor, savedWidth, timeout);
  await edit.hover();
}

async function cardStyles(card: Locator) {
  return card.evaluate(node => {
    const article = node.matches("article") ? node : node.querySelector("article") ?? node;
    const styles = (element: Element) => {
      const css = getComputedStyle(element);
      return Object.fromEntries(["fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "color", "marginTop", "marginBottom"].map(key => [key, css[key as keyof CSSStyleDeclaration]]));
    };
    const body = article.querySelector(".prose")!;
    return {
      card: Object.fromEntries(["backgroundColor", "borderColor", "borderWidth", "borderRadius", "padding"].map(key => [key, getComputedStyle(article)[key as keyof CSSStyleDeclaration]])),
      author: styles(article.querySelector(".metadata-mono, .work-post-meta")!),
      time: styles(article.querySelector("time")!),
      title: styles(article.querySelector("h2, h3")!),
      body: styles(body), paragraph: styles(body.querySelector("p")!), list: styles(body.querySelector("li")!),
      maxHeight: getComputedStyle(body).maxHeight, text: body.textContent,
    };
  });
}

async function renderedColor(control: Locator) {
  return control.evaluate(node => {
    // 比较浏览器实际渲染的 sRGB 像素，兼容 rgba 与 Tailwind 4 的 color-mix/OKLab 序列化。
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d")!;
    context.fillStyle = getComputedStyle(node).color;
    context.fillRect(0, 0, 1, 1);
    return Array.from(context.getImageData(0, 0, 1, 1).data);
  });
}

async function pins(line: Locator) {
  return line.locator("circle[stroke]").evaluateAll(nodes => nodes.map(node => {
    const circle = node as SVGCircleElement;
    const point = new DOMPoint(circle.cx.baseVal.value, circle.cy.baseVal.value).matrixTransform(circle.getScreenCTM()!);
    return { x: point.x, y: point.y, width: circle.getBoundingClientRect().width };
  }));
}

async function expectPin(line: Locator, index: number, target: Locator) {
  // 刷新先完成客户端图钉挂载，再核对真实屏幕几何，避免把尚未水合当成位置偏差。
  await expect(line.locator("circle[stroke]").nth(index)).toBeAttached();
  await expect.poll(async () => {
    const point = (await pins(line))[index], rect = await target.boundingBox();
    if (!point || !rect) return Infinity;
    return Math.hypot(point.x - rect.x - rect.width / 2, point.y - rect.y - rect.height / 2);
  }).toBeLessThan(1);
}

test.describe("博文共享展示", () => {
  test.use({ locale: "zh-CN", timezoneId: "America/Los_Angeles", contextOptions: { reducedMotion: "reduce" } });

  for (const status of ["draft", "published"] as const) {
    test(`${status === "draft" ? "草稿" : "已发布作品"} Edit 与 home 样式一致，仅编辑态可见并保存恢复`, async ({ context }) => {
      await withStudyUser(context, async ({ page, db, userId }) => {
        const ordinary = await db.post.create({ data: { authorId: userId, title: "普通博文编辑入口", content: "普通正文", slug: randomUUID(), publishedAt } });
        try {
          const work = await db.blogWork.create({ data: {
            owner: { connect: { id: userId } }, board: { connectOrCreate: { where: { id: "home-board" }, create: { id: "home-board" } } },
            viewportWidth: 960, viewportHeight: 620, status, publishedAt: status === "published" ? publishedAt : null,
          } });
          const posts: { id: string; title: string; content: string }[] = [];
          for (const workOrder of [0, 1]) {
            const post = await db.post.create({ data: { authorId: userId, workId: work.id, workOrder, title: `草稿博文 ${workOrder + 1}`, content: `正文 ${workOrder + 1}`, slug: randomUUID(), publishedAt: status === "published" ? publishedAt : null } });
            await db.atlasElement.create({ data: { workId: work.id, boardId: "home-board", postId: post.id, type: "note", x: 96, y: 72 } });
            posts.push(post);
          }
          const editStyles = (control: Locator) => control.evaluate(node => {
            const css = getComputedStyle(node);
            return {
              fontFamily: css.fontFamily, fontSize: css.fontSize, fontWeight: css.fontWeight, lineHeight: css.lineHeight,
              color: css.color, padding: css.padding, borderRadius: css.borderRadius, backgroundColor: css.backgroundColor,
              marginTop: getComputedStyle(node.parentElement!).marginTop,
            };
          });
          await page.setViewportSize({ width: 1440, height: 1100 });
          await page.goto("/home");
          const normalEdit = page.getByRole("link", { name: "Edit", exact: true }).and(page.locator(`a[href="/posts/edit/${ordinary.slug}"]`));
          await expect(normalEdit).toBeVisible();
          const baseline = await editStyles(normalEdit);
          expect(baseline).toMatchObject({ fontSize: "12px", padding: "0px", marginTop: "12px" });
          expect(await renderedColor(normalEdit)).toEqual([0, 0, 0, 102]);
          await normalEdit.hover();
          await expect.poll(() => renderedColor(normalEdit)).toEqual([0, 0, 0, 255]);
          const hovered = await editStyles(normalEdit);
          await page.goto(status === "draft" ? `/home?draft=${work.id}` : "/home");
          const editor = page.locator(`[data-work-id="${work.id}"]`);
          if (status === "published") {
            await expect(editor.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
            await waitForPublishedWorkLayout(editor, work.viewportWidth);
            await editor.getByRole("button", { name: "编辑作品", exact: true }).click();
          }
          const first = editor.locator(`[data-work-post="${posts[0].id}"]`), second = editor.locator(`[data-work-post="${posts[1].id}"]`);
          const firstEdit = first.getByRole("button", { name: "Edit", exact: true }), secondEdit = second.getByRole("button", { name: "Edit", exact: true });
          await expect(editor.getByRole("button", { name: "Edit", exact: true })).toHaveCount(2);
          await expect(firstEdit).toBeVisible();
          await page.mouse.move(0, 0);
          expect(await editStyles(firstEdit)).toEqual(baseline);
          if (status === "published") await hoverPublishedWorkEdit(editor, work.viewportWidth, firstEdit);
          else await firstEdit.hover();
          await expect.poll(() => editStyles(firstEdit)).toEqual(hovered);
          await firstEdit.click();
          const dialog = page.getByRole("dialog", { name: "编辑博文", exact: true });
          await expect(dialog.getByLabel("标题", { exact: true })).toHaveValue(posts[0].title);
          await expect(dialog.getByLabel("正文（Markdown）")).toHaveValue(posts[0].content);
          await dialog.getByRole("button", { name: "关闭编辑博文", exact: true }).click();

          await first.getByRole("button", { name: `连接博文：${posts[0].title}` }).focus();
          await page.keyboard.press("Enter");
          await second.getByRole("button", { name: posts[1].title, exact: true }).focus();
          await page.keyboard.press("Tab");
          await expect(secondEdit).toBeFocused();
          await page.keyboard.press("Enter");
          await expect(dialog.getByLabel("标题", { exact: true })).toHaveValue(posts[1].title);
          await expect(dialog.getByLabel("正文（Markdown）")).toHaveValue(posts[1].content);
          const updated = { title: "Edit 修改后的第二篇", content: "键盘入口修改正文，刷新后保留。" };
          const [saved] = await Promise.all([
            page.waitForResponse(response => response.request().method() === "PATCH" && response.url().endsWith(`/api/blog/works/${work.id}`)
              && response.request().postDataJSON().command.id === posts[1].id && response.request().postDataJSON().command.data?.content === updated.content),
            (async () => {
              await dialog.getByLabel("标题", { exact: true }).fill(updated.title);
              await dialog.getByLabel("正文（Markdown）").fill(updated.content);
              if (status === "published") await dialog.getByRole("button", { name: "保存博文", exact: true }).click();
              await dialog.getByRole("button", { name: "关闭编辑博文", exact: true }).click();
            })(),
          ]);
          expect(saved.status()).toBe(200);
          await saved.json();
          await expect(editor.getByText("已自动保存", { exact: true })).toBeVisible();
          expect(await db.atlasConnection.count({ where: { workId: work.id } })).toBe(0);
          expect(await db.post.findUniqueOrThrow({ where: { id: posts[0].id } })).toMatchObject({ title: posts[0].title, content: posts[0].content });
          if (status === "published") {
            await editor.getByRole("button", { name: "退出编辑", exact: true }).click();
            await expect(editor.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
          }
          await page.setViewportSize({ width: 390, height: 844 });
          await page.reload();
          if (status === "published") {
            await expect(editor.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
            await waitForPublishedWorkLayout(editor, work.viewportWidth);
            await editor.getByRole("button", { name: "编辑作品", exact: true }).click();
          }
          await secondEdit.click();
          await expect(dialog.getByLabel("标题", { exact: true })).toHaveValue(updated.title);
          await expect(dialog.getByLabel("正文（Markdown）")).toHaveValue(updated.content);
          await dialog.getByRole("button", { name: "关闭编辑博文", exact: true }).click();
        } finally {
          await page.close();
          await db.post.deleteMany({ where: { id: ordinary.id } });
        }
      });
    });
  }

  test("已发布作品 Edit 在真实适配就绪前不执行悬停", async ({ context }) => {
    await withStudyUser(context, async ({ page, db, userId }) => {
      // 在应用监听器注册前建立通知门闩；页面关闭即释放此页面的全部监听器。
      await page.addInitScript(() => {
        let paused = false;
        window.addEventListener("resize", event => { if (paused) event.stopImmediatePropagation(); }, true);
        const gate = window as unknown as { pauseWorkLayout: () => void; resumeWorkLayout: () => void };
        gate.pauseWorkLayout = () => { paused = true; };
        gate.resumeWorkLayout = () => { paused = false; window.dispatchEvent(new Event("resize")); };
      });
      const work = await db.blogWork.create({ data: {
        owner: { connect: { id: userId } }, board: { connectOrCreate: { where: { id: "home-board" }, create: { id: "home-board" } } },
        viewportWidth: 960, viewportHeight: 620, status: "published", publishedAt,
      } });
      const post = await db.post.create({ data: { authorId: userId, workId: work.id, workOrder: 0, title: "适配悬停回归", content: "真实浏览器布局", slug: randomUUID(), publishedAt } });
      await db.atlasElement.create({ data: { workId: work.id, boardId: "home-board", postId: post.id, type: "note", x: 96, y: 72 } });
      await page.setViewportSize({ width: 1440, height: 1100 });
      await page.goto("/home");
      const editor = page.locator(`[data-work-id="${work.id}"]`);
      await waitForPublishedWorkLayout(editor, work.viewportWidth);
      await editor.getByRole("button", { name: "编辑作品", exact: true }).click();
      const edit = editor.getByRole("button", { name: "Edit", exact: true });
      await expect(edit).toBeVisible();
      await waitForPublishedWorkLayout(editor, work.viewportWidth);
      await page.mouse.move(0, 0);

      // 只在此独立页面暂扣 resize 通知，释放时执行应用的真实适配回调。
      // 250ms 用于证明未就绪会拒绝悬停；业务准备及原颜色断言仍使用 5 秒。
      await page.evaluate(() => (window as unknown as { pauseWorkLayout: () => void }).pauseWorkLayout());
      await page.setViewportSize({ width: 1120, height: 1100 });
      await expect(edit).toBeVisible();
      await expect(hoverPublishedWorkEdit(editor, work.viewportWidth, edit, 250)).rejects.toThrow("已发布作品适配布局就绪");
      expect(await edit.evaluate(node => node.matches(":hover"))).toBe(false);
      await expect.poll(() => renderedColor(edit)).toEqual([0, 0, 0, 102]);

      await page.evaluate(() => (window as unknown as { resumeWorkLayout: () => void }).resumeWorkLayout());
      await hoverPublishedWorkEdit(editor, work.viewportWidth, edit);
      expect(await edit.evaluate(node => node.matches(":hover"))).toBe(true);
      await expect.poll(() => renderedColor(edit)).toEqual([0, 0, 0, 255]);
      await edit.click();
      await expect(page.getByRole("dialog", { name: "编辑博文", exact: true }).getByLabel("标题", { exact: true })).toHaveValue(post.title);
    });
  });

  for (const timezone of ["Asia/Tokyo", null]) {
    test(`中英文、Markdown 摘要及时间一致：${timezone ?? "UTC 回退"}`, async ({ context }) => {
      await withStudyUser(context, async ({ page, db, userId }) => {
        await db.user.update({ where: { id: userId }, data: { displayName: "作者 Author" } });
        const work = await db.blogWork.create({ data: {
          owner: { connect: { id: userId } }, board: { connectOrCreate: { where: { id: "home-board" }, create: { id: "home-board" } } },
          status: "published", publishedAt, viewportWidth: 960, viewportHeight: 540,
        } });
        const data = { authorId: userId, title, content, publishedAt, authorTimezone: timezone, authorCity: "Tokyo", authorCountry: "Japan" };
        const ordinary = await db.post.create({ data: { ...data, slug: randomUUID() } });
        try {
          const post = await db.post.create({ data: { ...data, slug: randomUUID(), workId: work.id, workOrder: 0 } });
          await db.atlasElement.create({ data: { workId: work.id, boardId: "home-board", postId: post.id, type: "note", x: 96, y: 72 } });
          const errors: string[] = [];
          page.on("pageerror", error => errors.push(error.message));
          await page.setViewportSize({ width: 1440, height: 1100 });
          await page.goto("/home");
          const normal = page.locator("article").filter({ has: page.locator(`a[href="/posts/${ordinary.slug}"]`) });
          const editor = page.locator(`[data-work-id="${work.id}"]`);
          const spatial = editor.locator(`[data-work-post="${post.id}"]`);
          await normal.scrollIntoViewIfNeeded();
          await expect(spatial).toBeVisible();
          await expect.poll(async () => (await spatial.boundingBox())!.width).toBe(352);
          expect((await normal.boundingBox())!.width).toBe(352);
          const baseline = await cardStyles(normal);
          expect.soft(await cardStyles(spatial)).toEqual(baseline);
          expect(baseline.card).toMatchObject({
            backgroundColor: "rgb(255, 255, 255)", borderColor: "rgb(232, 232, 232)",
            borderWidth: "1px", borderRadius: "10px", padding: "20px",
          });
          expect(baseline.author).toMatchObject({ fontSize: "12px" });
          expect(baseline.title).toMatchObject({ fontSize: "18px", fontWeight: "600" });
          expect(baseline.body).toMatchObject({ fontSize: "14px", lineHeight: "19.25px" });
          expect(baseline.maxHeight).toBe("78px");
          expect(baseline.text).not.toContain("全文结尾");
          await expect(page.locator("nav")).toHaveCSS("backdrop-filter", "blur(4px)");
          await expect(spatial.locator("time")).toHaveText(await normal.locator("time").innerText());

          await normal.getByRole("link", { name: title, exact: true }).focus();
          await page.keyboard.press("Enter");
          await expect(page.getByText(/全文结尾 END/)).toBeVisible();
          await page.goto("/home");
          const readButton = spatial.getByRole("button", { name: title, exact: true });
          // focus() 不等待 enabled；水合前禁用的标题不能获得键盘焦点。
          await expect(readButton).toBeEnabled();
          await readButton.focus();
          await expect(readButton).toBeFocused();
          await page.keyboard.press("Enter");
          await expect(page.getByRole("dialog", { name: "阅读博文" })).toContainText("全文结尾 END");
          await page.getByRole("button", { name: "关闭阅读博文" }).click();
          await editor.getByRole("button", { name: "编辑作品", exact: true }).click();
          await expect(editor.getByRole("button", { name: "退出编辑", exact: true })).toBeVisible();
          expect(await cardStyles(spatial)).toEqual(baseline);
          await spatial.getByRole("button", { name: title, exact: true }).click();
          await expect(page.getByLabel("正文（Markdown）")).toHaveValue(content);
          await page.getByRole("button", { name: "关闭编辑博文" }).click();
          await editor.getByRole("button", { name: "退出编辑", exact: true }).click();
          await page.reload();
          await expect(spatial).toBeVisible();
          expect(await cardStyles(spatial)).toEqual(baseline);
          await page.setViewportSize({ width: 390, height: 844 });
          await expect.poll(async () => (await spatial.boundingBox())!.width).toBeLessThan(352);
          expect(await cardStyles(spatial)).toEqual(baseline);
          expect((await db.post.findUniqueOrThrow({ where: { id: post.id } })).content).toBe(content);
          expect(await db.blogWork.findUniqueOrThrow({ where: { id: work.id } })).toEqual(work);
          expect(errors).toEqual([]);
        } finally {
          await page.close();
          await db.post.deleteMany({ where: { id: ordinary.id } });
        }
      });
    });
  }

  test("Markdown 正文保留标题、列表、代码和表格排版及窄屏滚动", async ({ context }) => {
    await withStudyUser(context, async ({ page, db, userId }) => {
      const markdown = [
        "## 排版 Heading", "正文 paragraph **粗体** 与 [链接](#heading)。",
        "- 列表 one\n- 列表 two", "1. 有序 one\n2. 有序 two",
        "```ts\nconst example = \"" + "long_code_".repeat(30) + "\";\n```",
        "| 列 A | 列 B |\n| --- | --- |\n| 单元格 | cell |",
      ].join("\n\n");
      const post = await db.post.create({ data: {
        authorId: userId, slug: randomUUID(), title: "Markdown 排版契约", content: markdown, publishedAt,
      } });
      await page.goto(`/posts/${post.slug}`);
      const prose = page.locator(".prose");
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 844 });
        await expect(prose).toHaveCSS("font-size", "16px");
        await expect(prose).toHaveCSS("line-height", "28px");
        await expect(prose).toHaveCSS("color", "rgb(51, 43, 37)");
        await expect(prose.locator("h2")).toHaveCSS("font-size", "24px");
        await expect(prose.locator("h2")).toHaveCSS("font-weight", "700");
        await expect(prose.locator("h2")).toHaveCSS("color", "rgb(44, 62, 80)");
        await expect(prose.locator("ul")).toHaveCSS("list-style-type", "disc");
        await expect(prose.locator("ol")).toHaveCSS("list-style-type", "decimal");
        await expect(prose.locator("pre")).toHaveCSS("background-color", "rgb(30, 30, 30)");
        await expect(prose.locator("pre code")).toHaveCSS("font-size", "14px");
        await expect(prose.locator("pre code")).toHaveCSS("color", "rgb(224, 224, 224)");
        await expect(prose.locator("pre code")).toHaveCSS("font-family", /monospace/);
        await expect(prose.locator("thead")).toHaveCSS("border-bottom-width", "1px");
        expect(await prose.locator("pre").evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      }
      await prose.getByRole("link", { name: "链接", exact: true }).focus();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/#heading$/);
      expect((await db.post.findUniqueOrThrow({ where: { id: post.id } })).content).toBe(markdown);
    });
  });

  test("三种连线使用相同虚线、下垂曲线和图钉，移动旋转滚动缩放后跟随", async ({ context }) => {
    await withStudyUser(context, async ({ page, db, userId }) => {
      const work = await db.blogWork.create({ data: {
        owner: { connect: { id: userId } }, board: { connectOrCreate: { where: { id: "home-board" }, create: { id: "home-board" } } },
        status: "published", publishedAt, viewportWidth: 960, viewportHeight: 540,
      } });
      const photo = async (workId: string | null, x: number, y: number) => db.atlasElement.create({ data: {
        workId, boardId: "home-board", createdById: userId, type: "photo", x, y, width: 120, height: 90,
        imageUrl: "/brand/logo_transparent.svg", caption: `连线图片 ${x}`,
      } });
      const a = await photo(null, 80, 120), b = await photo(null, 300, 120);
      const c = await photo(work.id, 80, 160), d = await photo(work.id, 300, 160);
      const line = async (workId: string | null, fromId: string, toId: string) => db.atlasConnection.create({ data: { boardId: "home-board", workId, fromId, toId, color: "#915c83" } });
      await line(null, a.id, b.id);
      const internal = await line(work.id, c.id, d.id), external = await line(work.id, c.id, a.id);
      try {
        await page.setViewportSize({ width: 1440, height: 1100 });
        await page.goto("/home");
        const layers = [page.locator(".home-connection-layer"), page.locator(`[data-work-connection="${internal.id}"]`), page.locator(`[data-external-connection="${external.id}"]`)];
        const verifyStyle = async (layer: Locator) => {
          const path = layer.locator("path:not([role=\"button\"])");
          await expect(path).toHaveAttribute("stroke", "#915c83");
          const actual = await path.evaluate(node => ({ width: getComputedStyle(node).strokeWidth, dash: getComputedStyle(node).strokeDasharray, cap: getComputedStyle(node).strokeLinecap, path: node.getAttribute("d") }));
          expect(actual).toMatchObject({ width: "2px", dash: "6px, 4px", cap: "round", path: expect.stringContaining(" Q ") });
          const points = actual.path!.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/g)!.map(Number);
          const [x1, y1, cx, cy, x2, y2] = points;
          expect(cx).toBeCloseTo((x1 + x2) / 2, 5);
          expect(cy).toBeCloseTo((y1 + y2) / 2 + Math.min(Math.abs(x2 - x1) * 0.22 + 18, 120), 5);
          await expect(layer.locator("circle")).toHaveCount(6);
          for (const pin of await pins(layer)) expect(pin.width).toBeCloseTo(10, 1);
        };
        for (const layer of layers) await verifyStyle(layer);
        const editor = page.locator(`[data-work-id="${work.id}"]`);
        const start = editor.locator(`[data-element-id="${c.id}"]`), end = editor.locator(`[data-element-id="${d.id}"]`);
        const outside = page.locator(`[data-element-id="${a.id}"]`);
        await expectPin(layers[0], 0, outside);
        await expectPin(layers[1], 0, start);
        await expectPin(layers[1], 1, end);
        await expectPin(layers[2], 0, start);
        await expectPin(layers[2], 1, outside);
        await editor.getByRole("button", { name: "编辑作品", exact: true }).click();
        const box = (await start.boundingBox())!;
        await page.mouse.move(box.x + 40, box.y + 40);
        await page.mouse.down();
        await page.mouse.move(box.x + 95, box.y + 70, { steps: 5 });
        await page.mouse.up();
        await expect.poll(async () => (await db.atlasElement.findUniqueOrThrow({ where: { id: c.id } })).x).toBe(135);
        await start.getByRole("button", { name: "旋转照片：连线图片 80" }).focus();
        await page.keyboard.press("ArrowRight");
        await expect.poll(async () => (await db.atlasElement.findUniqueOrThrow({ where: { id: c.id } })).rotation).not.toBe(0);
        await expectPin(layers[1], 0, start);
        await expectPin(layers[2], 0, start);
        await page.evaluate(() => window.scrollBy(0, 120));
        await expectPin(layers[1], 0, start);
        await expectPin(layers[2], 0, start);
        await editor.getByRole("button", { name: "退出编辑", exact: true }).click();
        await page.reload();
        await expectPin(layers[2], 0, start);
        for (const width of [390, 1440]) {
          await page.setViewportSize({ width, height: 1100 });
          await expectPin(layers[1], 0, start);
          await expectPin(layers[2], 0, start);
          for (const layer of layers) await verifyStyle(layer);
        }
        page.once("dialog", dialog => dialog.accept());
        await page.getByRole("button", { name: "删除连线 1", exact: true }).focus();
        await page.keyboard.press("Enter");
        await expect(layers[0].locator("path")).toHaveCount(0);
        expect(await db.atlasConnection.count({ where: { fromId: a.id, toId: b.id } })).toBe(0);
      } finally {
        await page.close();
        await db.atlasElement.deleteMany({ where: { id: { in: [a.id, b.id] } } });
      }
    });
  });

  test("草稿摘要随全文修改重排，发布和其他用户阅读保持全文及权限", async ({ context, browser }) => {
    await withStudyUser(context, async ({ page, db, userId }) => {
      const work = await db.blogWork.create({ data: { owner: { connect: { id: userId } }, board: { connectOrCreate: { where: { id: "home-board" }, create: { id: "home-board" } } }, viewportWidth: 960, viewportHeight: 620, updatedAt: publishedAt } });
      const makePost = async (workOrder: number, text: string) => {
        const post = await db.post.create({ data: { authorId: userId, workId: work.id, workOrder, title: workOrder ? "后续卡片" : title, content: text, slug: randomUUID(), authorTimezone: "Asia/Tokyo" } });
        const element = await db.atlasElement.create({ data: { workId: work.id, boardId: "home-board", postId: post.id, type: "note", x: 96, y: 72, width: 352, height: 180 } });
        return { post, element };
      };
      const first = await makePost(0, content), second = await makePost(1, "后续正文");
      const upload = await page.request.post(`/api/blog/works/${work.id}/uploads`, {
        headers: { "X-Blog-Viewer-Id": userId, origin: new URL(test.info().project.use.baseURL!).origin },
        multipart: { file: { name: "preview.png", mimeType: "image/png", buffer: MINIMAL_PNG }, metadata: JSON.stringify({ mutationId: randomUUID(), baseRevision: 0, expectedStatus: "draft", data: { x: 640, y: 160, width: 120, height: 90, caption: "摘要布局图片" } }) },
      });
      expect(upload.status()).toBe(200);
      const image = await db.atlasElement.findFirstOrThrow({ where: { workId: work.id, type: "photo" } });
      const draftUpdatedAt = (await db.blogWork.findUniqueOrThrow({ where: { id: work.id } })).updatedAt;
      const connection = await db.atlasConnection.create({ data: { workId: work.id, boardId: "home-board", fromId: first.element.id, toId: image.id } });
      const followingConnection = await db.atlasConnection.create({ data: { workId: work.id, boardId: "home-board", fromId: second.element.id, toId: image.id } });
      await page.setViewportSize({ width: 1440, height: 1100 });
      await page.goto(`/home?draft=${work.id}`);
      const editor = page.locator(`[data-work-id="${work.id}"]`);
      const top = editor.locator(`[data-work-post="${first.post.id}"]`), bottom = editor.locator(`[data-work-post="${second.post.id}"]`);
      const line = editor.locator(`[data-work-connection="${connection.id}"]`);
      await expect(top.locator("time")).toHaveAttribute("datetime", draftUpdatedAt.toISOString());
      await expect(top).not.toContainText("全文结尾 END");
      const originalHeight = (await top.boundingBox())!.height;
      const checkLayout = async () => {
        await expect.poll(async () => {
          const a = (await top.boundingBox())!, b = (await bottom.boundingBox())!;
          return Math.abs(b.y - a.y - a.height - 32);
        }).toBeLessThan(1);
        await expectPin(line, 0, top);
        await expectPin(editor.locator(`[data-work-connection="${followingConnection.id}"]`), 0, bottom);
      };
      await checkLayout();
      await top.getByRole("button", { name: title, exact: true }).focus();
      await page.keyboard.press("Enter");
      await expect(page.getByLabel("正文（Markdown）")).toHaveValue(content);
      await page.getByLabel("正文（Markdown）").fill("短文 Short");
      await page.getByRole("button", { name: "关闭编辑博文" }).click();
      await expect(editor.getByText("已自动保存", { exact: true })).toBeVisible();
      await expect.poll(async () => (await top.boundingBox())!.height).toBeLessThan(originalHeight);
      await checkLayout();
      await top.getByRole("button", { name: title, exact: true }).click();
      await page.getByLabel("正文（Markdown）").fill(content);
      await page.getByRole("button", { name: "关闭编辑博文" }).click();
      await expect(editor.getByText("已自动保存", { exact: true })).toBeVisible();
      await expect.poll(async () => (await top.boundingBox())!.height).toBe(originalHeight);
      await checkLayout();
      expect(await db.atlasElement.findUniqueOrThrow({ where: { id: image.id } })).toEqual(image);
      expect(await db.atlasElement.findUniqueOrThrow({ where: { id: first.element.id } })).toEqual(first.element);
      const beforePublish = await db.blogWork.findUniqueOrThrow({ where: { id: work.id } });
      for (const key of ["viewportX", "viewportY", "viewportWidth", "viewportHeight", "layoutWidth"] as const) expect(beforePublish[key]).toBe(work[key]);
      const [published] = await Promise.all([
        page.waitForResponse(response => response.request().method() === "PATCH" && response.url().endsWith(`/api/blog/works/${work.id}`) && response.request().postDataJSON().command.operation === "publish"),
        editor.getByRole("button", { name: "发布", exact: true }).click(),
      ]);
      expect(published.status()).toBe(200);
      await expect(editor.getByRole("button", { name: "编辑作品", exact: true })).toBeVisible();
      const saved = await db.post.findUniqueOrThrow({ where: { id: first.post.id } });
      expect(saved.content).toBe(content);
      expect(saved.publishedAt).not.toBeNull();
      await expect(top.locator("time")).toHaveAttribute("datetime", saved.publishedAt!.toISOString());
      await expect(top).not.toContainText("草稿");
      await checkLayout();
      const other = await browser.newContext({ baseURL: test.info().project.use.baseURL, locale: "zh-CN", timezoneId: "America/Los_Angeles" });
      try {
        // 第二位读者也用独立账号；重新登录共享 setup 账号会轮换它的会话，污染后续旅程。
        await withStudyUser(other, async ({ page: viewer }) => {
          await viewer.goto("/home");
          const publicWork = viewer.locator(`[data-work-id="${work.id}"]`), card = publicWork.locator(`[data-work-post="${first.post.id}"]`);
          await expect(card).toBeVisible();
          const ownerStyles = await cardStyles(top), viewerStyles = await cardStyles(card);
          for (const key of ["author", "time", "title", "body", "paragraph", "list", "maxHeight", "text"] as const) expect(viewerStyles[key]).toEqual(ownerStyles[key]);
          await expect(card.locator("time")).toHaveText(await top.locator("time").innerText());
          await publicWork.getByRole("button", { name: "编辑作品", exact: true }).click();
          await expect(publicWork.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
          await expect(publicWork.getByRole("button", { name: "删除作品", exact: true })).toHaveCount(0);
          await card.getByRole("button", { name: title, exact: true }).focus();
          await viewer.keyboard.press("Enter");
          await expect(viewer.getByRole("dialog", { name: "阅读博文" })).toContainText("全文结尾 END");
          await expect(viewer.getByLabel("正文（Markdown）")).toHaveCount(0);
          await viewer.getByRole("button", { name: "关闭阅读博文" }).click();
          await viewer.setViewportSize({ width: 390, height: 844 });
          await viewer.reload();
          await expect(card).not.toContainText("全文结尾 END");
          await card.getByRole("button", { name: title, exact: true }).click();
          await expect(viewer.getByRole("dialog", { name: "阅读博文" })).toContainText("全文结尾 END");
          expect((await db.post.findUniqueOrThrow({ where: { id: first.post.id } })).content).toBe(content);
        });
      } finally { await other.close(); }
    });
  });

  test("窄屏刷新在脚本交付及首次适配后才启用标题，首次点击打开只读全文", async ({ context, browser }) => {
    await withStudyUser(context, async ({ db, userId }) => {
      const work = await db.blogWork.create({ data: {
        owner: { connect: { id: userId } }, board: { connectOrCreate: { where: { id: "home-board" }, create: { id: "home-board" } } },
        status: "published", publishedAt, viewportWidth: 960, viewportHeight: 620,
      } });
      const post = await db.post.create({ data: { authorId: userId, workId: work.id, workOrder: 0, title, content, slug: randomUUID(), publishedAt } });
      const element = await db.atlasElement.create({ data: { workId: work.id, boardId: "home-board", postId: post.id, type: "note", x: 96, y: 72 } });
      const other = await browser.newContext({ baseURL: test.info().project.use.baseURL, locale: "zh-CN", timezoneId: "America/Los_Angeles" });
      try {
        await withStudyUser(other, async ({ page: viewer }) => {
          await viewer.goto("/home");
          const publicWork = viewer.locator(`[data-work-id="${work.id}"]`);
          const card = publicWork.locator(`[data-work-post="${post.id}"]`);
          const button = card.getByRole("button", { name: title, exact: true });
          await waitForPublishedWorkLayout(publicWork, work.viewportWidth);
          await viewer.setViewportSize({ width: 390, height: 844 });

          // 只暂扣此页面的真实脚本响应；保留 SSR、CSS、Cookie 和 PostgreSQL。
          // commit 允许检查脚本尚未交付时的可见标题，门闩按断言释放，不使用固定 sleep。
          let release!: () => void;
          const scriptsReady = new Promise<void>(resolve => { release = resolve; });
          let heldScripts = 0;
          await viewer.route("**/_next/**/*.js", async route => {
            heldScripts++;
            await scriptsReady;
            await route.continue();
          });
          try {
            await viewer.reload({ waitUntil: "commit" });
            await expect(button).toBeVisible();
            await expect.poll(() => heldScripts).toBeGreaterThan(0);
            await expect(button).toBeDisabled();
            await expect(card).not.toContainText("全文结尾 END");
            release();
            await viewer.waitForLoadState("load");

            // 沿用原旅程的单次真实点击，不先等待布局或重试打开弹窗。
            await button.click();
            const dialog = viewer.getByRole("dialog", { name: "阅读博文", exact: true });
            await expect(dialog).toContainText("全文结尾 END");
            await expect(dialog.getByLabel("正文（Markdown）")).toHaveCount(0);
            await expect(publicWork.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
            await viewer.getByRole("button", { name: "关闭阅读博文", exact: true }).click();
            await expect(button).toBeFocused();
            await viewer.keyboard.press("Enter");
            await expect(dialog).toContainText("全文结尾 END");
            expect(await db.post.findUniqueOrThrow({ where: { id: post.id } })).toEqual(post);
            expect(await db.blogWork.findUniqueOrThrow({ where: { id: work.id } })).toEqual(work);
            expect(await db.atlasElement.findUniqueOrThrow({ where: { id: element.id } })).toEqual(element);
          } finally {
            release();
            await viewer.unrouteAll({ behavior: "wait" });
          }
        });
      } finally { await other.close(); }
    });
  });

  test("组内及跨作品端点使用裁切交集，边界相切和完全隐藏时不留图钉或命中区", async ({ context }) => {
    await withStudyUser(context, async ({ page, db, userId }) => {
      const draft = await db.blogWork.create({ data: { owner: { connect: { id: userId } }, board: { connectOrCreate: { where: { id: "home-board" }, create: { id: "home-board" } } }, viewportWidth: 420, viewportHeight: 500 } });
      const published = await db.blogWork.create({ data: { ownerId: userId, boardId: "home-board", status: "published", publishedAt, viewportWidth: 960, viewportHeight: 540 } });
      const photo = (workId: string, x: number) => db.atlasElement.create({ data: { workId, boardId: "home-board", type: "photo", x, y: 200, width: 120, height: 90, imageUrl: "/brand/logo_transparent.svg" } });
      const a = await photo(draft.id, 300), b = await photo(draft.id, 80), c = await photo(published.id, 600);
      const internal = await db.atlasConnection.create({ data: { workId: draft.id, boardId: "home-board", fromId: a.id, toId: b.id, color: "" } });
      const external = await db.atlasConnection.create({ data: { workId: draft.id, boardId: "home-board", fromId: a.id, toId: c.id, color: "" } });
      await page.setViewportSize({ width: 1440, height: 1100 });
      await page.goto(`/home?draft=${draft.id}`);
      const editor = page.locator(`[data-work-id="${draft.id}"]`);
      const lines = [editor.locator(`[data-work-connection="${internal.id}"]`), page.locator(`[data-external-connection="${external.id}"]`)];
      const resize = async (width: number) => {
        const crop = (await editor.locator(".work-crop").boundingBox())!;
        const edge = (await editor.getByRole("button", { name: "调整草稿右边界", exact: true }).boundingBox())!;
        await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2);
        await page.mouse.down();
        await page.mouse.move(edge.x + edge.width / 2 + width - crop.width, edge.y + edge.height / 2, { steps: 4 });
        await page.mouse.up();
        await expect.poll(async () => (await db.blogWork.findUniqueOrThrow({ where: { id: draft.id } })).viewportWidth).toBe(width);
      };
      for (const line of lines) {
        await expect(line.locator("path[stroke-dasharray]")).toHaveAttribute("stroke", "#668a5b");
      }
      await expect(page.getByRole("button", { name: /删除作品连线/ })).toHaveCount(2);
      await resize(360);
      for (const line of lines) {
        await expect.poll(async () => {
          const crop = (await editor.locator(".work-crop").boundingBox())!, point = (await pins(line))[0];
          return point ? Math.hypot(point.x - crop.x - 330, point.y - crop.y - 245) : Infinity;
        }).toBeLessThan(1);
      }
      await expectPin(lines[1], 1, page.locator(`[data-element-id="${c.id}"]`));
      await resize(300);
      for (const line of lines) await expect(line).toHaveCount(0);
      await expect(page.getByRole("button", { name: /删除作品连线/ })).toHaveCount(0);
      await editor.getByRole("button", { name: "调整草稿右边界", exact: true }).focus();
      await page.keyboard.press("ArrowLeft");
      await expect(editor.getByText("已自动保存", { exact: true })).toBeVisible();
      for (const line of lines) await expect(line).toHaveCount(0);
      await resize(420);
      for (const line of lines) await expectPin(line, 0, editor.locator(`[data-element-id="${a.id}"]`));
      await page.reload();
      for (const line of lines) await expectPin(line, 0, editor.locator(`[data-element-id="${a.id}"]`));
      for (const element of [a, b, c]) expect(await db.atlasElement.findUniqueOrThrow({ where: { id: element.id } })).toEqual(element);
    });
  });
});
