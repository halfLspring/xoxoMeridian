import { randomUUID } from "node:crypto";
import { expect, test, type Locator } from "@playwright/test";
import { withStudyUser } from "@/tests/e2e/support/study";
import { MINIMAL_PNG } from "@/tests/fixtures/image-bytes";

const title = "同一篇中文 English 博文";
const content = "**中文 English 摘要**\n第二行 second line\n\n- 列表 one\n- 列表 two\n\n" + "后续段落 Paragraph。".repeat(50) + "全文结尾 END";
const publishedAt = new Date("2050-05-02T16:30:00Z");

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

async function pins(line: Locator) {
  return line.locator("circle[stroke]").evaluateAll(nodes => nodes.map(node => {
    const circle = node as SVGCircleElement;
    const point = new DOMPoint(circle.cx.baseVal.value, circle.cy.baseVal.value).matrixTransform(circle.getScreenCTM()!);
    return { x: point.x, y: point.y, width: circle.getBoundingClientRect().width };
  }));
}

async function expectPin(line: Locator, index: number, target: Locator) {
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
          expect(baseline).toMatchObject({ fontSize: "12px", color: "rgba(0, 0, 0, 0.4)", padding: "0px", marginTop: "12px" });
          await normalEdit.hover();
          await expect.poll(async () => (await editStyles(normalEdit)).color).toBe("rgb(0, 0, 0)");
          const hovered = await editStyles(normalEdit);
          await page.goto(status === "draft" ? `/home?draft=${work.id}` : "/home");
          const editor = page.locator(`[data-work-id="${work.id}"]`);
          if (status === "published") {
            await expect(editor.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
            await editor.getByRole("button", { name: "编辑作品", exact: true }).click();
          }
          const first = editor.locator(`[data-work-post="${posts[0].id}"]`), second = editor.locator(`[data-work-post="${posts[1].id}"]`);
          const firstEdit = first.getByRole("button", { name: "Edit", exact: true }), secondEdit = second.getByRole("button", { name: "Edit", exact: true });
          await expect(editor.getByRole("button", { name: "Edit", exact: true })).toHaveCount(2);
          await expect(firstEdit).toBeVisible();
          await page.mouse.move(0, 0);
          expect(await editStyles(firstEdit)).toEqual(baseline);
          await firstEdit.hover();
          await expect.poll(() => editStyles(firstEdit)).toEqual(hovered);
          await firstEdit.click();
          const dialog = page.getByRole("dialog", { name: "编辑博文", exact: true });
          await expect(dialog.getByLabel("标题", { exact: true })).toHaveValue(posts[0].title);
          await expect(dialog.getByLabel("正文（Markdown）")).toHaveValue(posts[0].content);
          await dialog.getByRole("button", { name: "关闭编辑博文", exact: true }).click();

          await first.getByRole("button", { name: "选择为连线端点" }).click();
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
          expect(baseline.author).toMatchObject({ fontSize: "12px" });
          expect(baseline.title).toMatchObject({ fontSize: "18px", fontWeight: "600" });
          expect(baseline.body).toMatchObject({ fontSize: "14px", lineHeight: "19.25px" });
          expect(baseline.maxHeight).toBe("78px");
          expect(baseline.text).not.toContain("全文结尾");
          await expect(spatial.locator("time")).toHaveText(await normal.locator("time").innerText());

          await normal.getByRole("link", { name: title, exact: true }).focus();
          await page.keyboard.press("Enter");
          await expect(page.getByText(/全文结尾 END/)).toBeVisible();
          await page.goto("/home");
          await spatial.getByRole("button", { name: title, exact: true }).focus();
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
      for (const line of lines) await expect(line.locator("path")).toHaveAttribute("stroke", "#668a5b");
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
