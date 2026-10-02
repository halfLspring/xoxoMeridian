import { randomUUID } from "node:crypto";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { withStudyUser } from "./support/study";

// 即使缺陷回归，也只记录布尔结果；不将 HTML / Flight 或账号字段写入 trace、附件和截图。
test.use({ trace: "off", screenshot: "off", video: "off" });

type Fixture = Parameters<Parameters<typeof withStudyUser>[1]>[0];
type CapturedResponse = { status: number; payload?: string; error?: string };
type FlightWindow = Window & { __xoxoBoundaryFlights?: Array<Promise<CapturedResponse>> };

async function observeNavigationFlight(page: Page, target: string) {
  await page.addInitScript(targetPath => {
    const observed = window as FlightWindow;
    const flights: Array<Promise<CapturedResponse>> = [];
    observed.__xoxoBoundaryFlights = flights;
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const response = await nativeFetch(input, init);
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      if (new URL(response.url, window.location.href).pathname === targetPath
        && headers.get("next-router-prefetch") !== "1"
        && response.headers.get("content-type")?.includes("text/x-component")) {
        // 直接复制浏览器收到的流；原响应原样交回应用，不依赖 Chromium 调试接口的响应缓存。
        flights.push(response.clone().text().then(
          payload => ({ status: response.status, payload }),
          () => ({ status: response.status, error: "Flight 响应流读取失败" }),
        ));
      }
      return response;
    };
  }, target);
}

async function withBoundaryUser(context: BrowserContext, run: (fixture: Fixture & {
  displayName: string;
  privateValues: Record<string, string>;
  post: { slug: string; title: string };
}) => Promise<void>) {
  await withStudyUser(context, async fixture => {
    const { db, page, userId } = fixture;
    const suffix = randomUUID();
    const displayName = `Boundary Owner ${suffix.slice(0, 8)}`;
    try {
      const user = await db.user.update({ where: { id: userId }, data: {
        displayName,
        email: `boundary-${suffix}@example.com`,
        profile: { update: {
          city: "Boundary City", country: "Boundary Country", timezone: "Asia/Shanghai", geoSource: "manual",
          profileNote: `private-note-${suffix}`,
          preferences: { boundaryMarker: `private-preferences-${suffix}` },
          lastGeoIp: "192.0.2.237",
        } },
      }, include: { profile: true } });
      const post = await db.post.create({ data: {
        slug: `boundary-${suffix}`, title: `Boundary Post ${suffix}`, content: "Public post body.",
        authorId: userId, publishedAt: new Date(),
      } });
      await run({ ...fixture, displayName, post, privateValues: {
        passwordHash: user.passwordHash,
        email: user.email,
        profileNote: user.profile!.profileNote!,
        preferences: `private-preferences-${suffix}`,
        lastGeoIp: user.profile!.lastGeoIp!,
        profileId: user.profile!.id,
      } });
    } finally {
      await page.close();
      await db.post.deleteMany({ where: { authorId: userId } });
    }
  });
}

function assertPrivateValuesAbsent(payload: string, privateValues: Record<string, string>) {
  const exposed = Object.fromEntries(Object.entries(privateValues).map(([field, value]) => [field, payload.includes(value)]));
  // 只把字段名和 true / false 交给断言；失败输出也不会打印字段值或响应载荷。
  expect(exposed).toEqual(Object.fromEntries(Object.keys(privateValues).map(field => [field, false])));
  expect(payload.includes("passwordHash"), "响应不应包含密码哈希字段").toBe(false);
}

async function assertNavigation(page: Page, displayName: string, isStudy: boolean) {
  const nav = page.getByRole("navigation");
  for (const [name, href] of [["Blog", "/home"], ["Chat", "/chat"], ["Study", "/study"], [displayName, "/me"]]) {
    await expect(nav.getByRole("link", { name, exact: true })).toHaveAttribute("href", href);
  }
  for (const [name, href] of [["New Post", "/posts/new"], ["My Draft", "/home?draft=list"]]) {
    const link = nav.getByRole("link", { name, exact: true });
    if (isStudy) await expect(link).toHaveCount(0);
    else await expect(link).toHaveAttribute("href", href);
  }
}

for (const entry of ["Blog", "New Post", "Post detail", "Edit Post", "Study"] as const) {
  for (const transport of ["HTML", "Flight"] as const) {
    test(`${entry} ${transport} 只传递必要用户数据并保留共享导航`, async ({ context }) => {
      await withBoundaryUser(context, async ({ page, post, displayName, privateValues, roomId }) => {
        const target = {
          Blog: "/home", "New Post": "/posts/new", "Post detail": `/posts/${post.slug}`,
          "Edit Post": `/posts/edit/${post.slug}`, Study: "/study",
        }[entry];
        let received: CapturedResponse[];
        if (transport === "HTML") {
          const response = await page.goto(target);
          expect(response?.status()).toBe(200);
          expect(response!.headers()["content-type"]).toContain("text/html");
          received = [{ status: response!.status(), payload: await response!.text() }];
        } else {
          // 检查真实点击导航的完整 Flight；Next 可以取消预取，不能把已取消的预取当作导航载荷。
          await observeNavigationFlight(page, target);
          await page.goto(entry === "Blog" ? "/posts/new" : "/home");
          if (entry === "Post detail") {
            await page.getByRole("link", { name: post.title, exact: true }).click();
          } else if (entry === "Edit Post") {
            await page.getByRole("article").filter({ has: page.getByRole("heading", { name: post.title, exact: true }) })
              .getByRole("link", { name: "Edit", exact: true }).click();
          } else {
            await page.getByRole("navigation").getByRole("link", { name: entry, exact: true }).click();
          }
          await expect(page).toHaveURL(new RegExp(`${target}$`));
          await expect.poll(() => page.evaluate(() => (window as FlightWindow).__xoxoBoundaryFlights?.length ?? 0), "捕获实际站内 Flight 响应").toBeGreaterThan(0);
          received = await page.evaluate(() => Promise.all((window as FlightWindow).__xoxoBoundaryFlights ?? []));
        }
        await assertNavigation(page, displayName, entry === "Study");
        expect(received.every(result => result.status === 200), "真实页面响应成功").toBe(true);
        expect(received.filter(result => result.error).map(result => result.error), "真实响应载荷可读取").toEqual([]);
        const payloads = received.map(result => result.payload!);
        expect(payloads.some(payload => payload.includes(displayName)), "响应包含本次测试账号的可见昵称").toBe(true);
        for (const payload of payloads) assertPrivateValuesAbsent(payload, privateValues);
        console.log(`[blog-boundary] entry=${entry}，transport=${transport}，responses=${received.length}，私密字段均未出现。`);
        if (entry === "New Post") {
          await page.getByRole("navigation").getByRole("link", { name: displayName, exact: true }).click();
          await expect(page).toHaveURL(/\/me$/);
        }
        if (entry === "Study") {
          await page.getByRole("navigation").getByRole("link", { name: "Chat", exact: true }).click();
          await expect(page).toHaveURL(new RegExp(`/chat/${roomId}$`));
        }
      });
    });
  }
}

test("不向编辑器传用户对象时，普通博文新建、取消、修改、删除及非作者保护仍成立", async ({ context, browser, baseURL }) => {
  if (!baseURL) throw new Error("博文边界回归需要隔离服务地址。");
  await withBoundaryUser(context, async ({ page, db, userId }) => {
    const title = `独立博文边界 ${randomUUID()}`;
    await page.goto("/home");
    await page.getByRole("link", { name: "New Post", exact: true }).click();
    await expect(page).toHaveURL(/\/posts\/new$/);
    await page.getByLabel("Post title", { exact: true }).fill(title);
    await page.getByLabel("Post content", { exact: true }).fill("发布正文");
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    const post = await db.post.findFirstOrThrow({ where: { authorId: userId, title } });
    expect(post).toMatchObject({ content: "发布正文", workId: null, authorCity: "Boundary City", authorCountry: "Boundary Country", authorTimezone: "Asia/Shanghai" });
    expect(post.publishedAt).not.toBeNull();
    const edit = async () => {
      await page.getByRole("link", { name: "Blog", exact: true }).click();
      await page.getByRole("article").filter({ has: page.getByRole("heading", { name: title, exact: true }) })
        .getByRole("link", { name: "Edit", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Edit Post", exact: true })).toBeVisible();
    };
    await edit();
    await page.getByLabel("Post content", { exact: true }).fill("未保存修改");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page).toHaveURL(/\/home$/);
    expect((await db.post.findUniqueOrThrow({ where: { id: post.id } })).content).toBe("发布正文");
    await edit();
    await page.getByLabel("Post content", { exact: true }).fill("修改后的正文");
    await page.getByRole("button", { name: "Update", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/posts/${post.slug}$`));
    expect((await db.post.findUniqueOrThrow({ where: { id: post.id } })).content).toBe("修改后的正文");

    const otherContext = await browser.newContext({ baseURL });
    try {
      await withStudyUser(otherContext, async ({ page: otherPage }) => {
        await otherPage.goto(`/posts/edit/${post.slug}`);
        await expect(otherPage).toHaveURL(/\/home$/);
        const card = otherPage.getByRole("article").filter({ has: otherPage.getByRole("heading", { name: title, exact: true }) });
        await expect(card).toBeVisible();
        await expect(card.getByRole("link", { name: "Edit", exact: true })).toHaveCount(0);
        const headers = { origin: baseURL };
        expect((await otherContext.request.put(`/api/posts/${post.slug}`, { headers, data: { content: "越权修改" } })).status()).toBe(403);
        expect((await otherContext.request.delete(`/api/posts/${post.slug}`, { headers })).status()).toBe(403);
        expect((await db.post.findUniqueOrThrow({ where: { id: post.id } })).content).toBe("修改后的正文");
      });
    } finally {
      await otherContext.close();
    }
    await edit();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByText("Are you sure you want to delete this post?", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Cancel", exact: true }).last().click();
    expect(await db.post.count({ where: { id: post.id } })).toBe(1);
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await page.getByRole("button", { name: "Delete", exact: true }).last().click();
    await expect(page).toHaveURL(/\/home$/);
    expect(await db.post.count({ where: { id: post.id } })).toBe(0);
  });
});
