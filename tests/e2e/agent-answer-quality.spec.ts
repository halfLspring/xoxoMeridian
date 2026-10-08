import { execFile } from "node:child_process";
import { createServer, type IncomingMessage } from "node:http";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { PrismaClient } from "@prisma/client";
import { expect, test, type Locator } from "@playwright/test";

import { answerReferencesSchema, readAnswerReferences } from "@/lib/answer-references";

import { privateDatabaseUrl } from "./support/agent-conversation";
import { withStudyUser } from "./support/study";
import { entryName } from "./support/agent-entry";
import { E2E_USERS } from "./support/credentials";

const weatherSource = "https://weather.example.test/sanya/2026-09-22";
const warningSource = "https://warning.example.test/hainan/2026-09-12";
const undatedSource = "https://warning.example.test/hainan/status";
const firstPrompt = "@小助手 帮我查一下三亚在九月二十四到九月二十八四天的天气情况，有台风吗，是否适合旅游？";
const secondPrompt = "三亚最近有台风吗 @小助手";

type EvidenceCall = { toolName: string; output: Record<string, unknown> };
type ModelInput = {
  user_prompt: string;
  reference_time?: string;
  available_tools?: unknown[];
  room_context?: { recentMessages?: Array<{ content: string }> };
  evidence?: { calls: EvidenceCall[]; sources: Array<{ id: string; url: string }> };
};

async function jsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

function longAnswer(label: string) {
  const content = Array.from({ length: 12 }, (_, index) => `${label}第 ${index + 1} 条合成资料结论，用于验证长引用的滚动边界。`).join("\n");
  const sources = Array.from({ length: 5 }, (_, index) => ({
    id: `s${index + 1}`, title: `${label}来源 ${index + 1}`, url: new URL(`https://source.example.test/${label}/${index + 1}`).href,
    dates: [{ kind: "published", value: "2026-10-08" }],
  }));
  const references = answerReferencesSchema.parse({
    version: 1, sources, citations: [{ start: 0, end: content.length, sourceIds: sources.map(({ id }) => id) }],
  });
  const metadata = { answerReferences: references };
  expect(readAnswerReferences(metadata, content)).toEqual(references);
  return { content, metadata };
}

async function referenceLayout(summary: Locator) {
  return summary.evaluate((element) => {
    // 从交互入口找实际滚动容器，不依赖样式类名或伪造 jsdom 几何。
    let list = element.parentElement;
    while (list && !/^(auto|scroll)$/u.test(getComputedStyle(list).overflowY)) list = list.parentElement;
    if (!list?.parentElement || !document.scrollingElement) throw new Error("来源必须位于消息滚动区内。");
    const root = document.scrollingElement;
    const input = document.querySelector('[aria-label="消息内容"]');
    const inputRect = input?.getBoundingClientRect();
    return {
      rootHeight: root.scrollHeight, rootClientHeight: root.clientHeight, windowY: window.scrollY,
      mainHeight: document.querySelector("main")!.getBoundingClientRect().height,
      hostHeight: list.parentElement.getBoundingClientRect().height,
      listHeight: list.clientHeight, listScrollHeight: list.scrollHeight, listTop: list.scrollTop,
      inputHeight: inputRect?.height ?? 0, inputTop: inputRect ? inputRect.top + window.scrollY : 0,
    };
  });
}

async function expectReferenceBoundary(summary: Locator, baseline: Awaited<ReturnType<typeof referenceLayout>>) {
  await expect.poll(async () => {
    const current = await referenceLayout(summary);
    return Math.max(...([
      "rootHeight", "rootClientHeight", "mainHeight", "hostHeight", "listHeight", "inputHeight", "inputTop",
    ] as const).map((key) => Math.abs(current[key] - baseline[key])));
  }, { message: "展开来源只能增加消息区内部滚动，不得撑大整页、宿主或输入区" }).toBeLessThanOrEqual(1);
  const current = await referenceLayout(summary);
  expect(current.windowY).toBeLessThanOrEqual(baseline.rootHeight - baseline.rootClientHeight + 1);
  return current;
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 1280, height: 600 }]) {
  test(`长来源展开仅滚动聊天消息区，发送、SSE 和刷新后保持边界（${viewport.width}×${viewport.height}）`, async ({ context }) => {
    await withStudyUser(context, async ({ page, db, roomId, userId }) => {
      await page.setViewportSize(viewport);
      const agent = await db.agent.findUniqueOrThrow({ where: { slug: "life-assistant" } });
      await db.message.createMany({ data: Array.from({ length: 12 }, (_, index) => ({
        roomId, senderId: userId, senderType: "human" as const, content: `历史消息 ${index + 1}`,
        createdAt: new Date(Date.UTC(2026, 9, 1, 0, index)),
      })) });
      await db.message.create({ data: { roomId, senderType: "agent", senderAgentId: agent.id, ...longAnswer("历史") } });
      await page.goto(`/chat/${roomId}`);
      const summaries = page.locator("summary").filter({ hasText: "参考来源（5）" });
      const summary = summaries.first();
      await expect(summaries).toHaveCount(1);
      await summary.focus();
      const baseline = await referenceLayout(summary);
      // 短视口原本有 720px 最小高度，只约束展开增量。
      expect(baseline.mainHeight).toBe(Math.max(720, viewport.height));
      const measurements = [{ phase: "收起", ...baseline }];

      await summary.press("Enter");
      const links = page.getByRole("link", { name: /^历史来源 \d\s*（新窗口打开）$/u });
      await expect(links).toHaveCount(5);
      const expanded = await referenceLayout(summary);
      await test.info().attach("长来源展开前后尺寸", { contentType: "application/json", body: JSON.stringify({ baseline, expanded }) });
      measurements.push({ phase: "展开", ...await expectReferenceBoundary(summary, baseline) });
      expect(expanded.listScrollHeight).toBeGreaterThan(baseline.listScrollHeight);
      for (let index = 0; index < 5; index++) await page.keyboard.press("Tab");
      await expect(links.last()).toBeFocused();
      await expect(links.last()).toBeInViewport();
      await expect(links.last()).toHaveAttribute("target", "_blank");
      await expect(links.last()).toHaveAttribute("rel", "noopener noreferrer");
      await expect(links.last()).toHaveAttribute("href", new URL("https://source.example.test/历史/5").href);
      const focused = await expectReferenceBoundary(summary, baseline);
      expect(focused.listTop).toBeGreaterThan(expanded.listTop);
      measurements.push({ phase: "末项聚焦", ...focused });
      await summary.press("Space");
      await expect(links).toHaveCount(0);
      measurements.push({ phase: "收起恢复", ...await expectReferenceBoundary(summary, baseline) });
      await summary.click();
      await expect(links).toHaveCount(5);
      await expectReferenceBoundary(summary, baseline);
      await summary.click();
      await expect(links).toHaveCount(0);

      const input = page.getByLabel("消息内容");
      const sentText = "来源切换后仍可发送消息";
      await input.fill(sentText);
      const accepted = page.waitForResponse((response) => response.request().method() === "POST"
        && new URL(response.url()).pathname === `/api/rooms/${roomId}/messages`);
      await input.press("Enter");
      expect((await accepted).ok()).toBe(true);
      await expect(input).toHaveValue("");
      await expect(input).toBeFocused();
      await expect(page.getByText(sentText, { exact: true })).toBeVisible();
      await expectReferenceBoundary(summary, baseline);

      // 页面不刷新、不注入响应：新增持久化消息经真实 SSE 快照进入界面。
      await db.message.create({ data: { roomId, senderType: "agent", senderAgentId: agent.id, ...longAnswer("实时") } });
      await expect(summaries).toHaveCount(2);
      const latest = summaries.last();
      await latest.focus();
      await latest.press("Enter");
      await expect(page.getByRole("link", { name: /^实时来源 5\s*（新窗口打开）$/u })).toHaveCount(1);
      measurements.push({ phase: "SSE 新消息展开", ...await expectReferenceBoundary(latest, baseline) });
      await latest.press("Space");
      await page.reload();
      await expect(summaries).toHaveCount(2);
      await expect(page.getByRole("link", { name: /来源 \d\s*（新窗口打开）$/u })).toHaveCount(0);
      await latest.click();
      measurements.push({ phase: "刷新后展开", ...await expectReferenceBoundary(latest, baseline) });
      await test.info().attach("来源完整旅程尺寸", { contentType: "application/json", body: JSON.stringify(measurements) });
    });
  });
}

test("指定日期天气与台风追问经过真实工具综合，来源与答复刷新后保持一致", async ({ page }) => {
  test.setTimeout(120_000);
  const databaseUrl = await privateDatabaseUrl();
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const roomId = `e2e-answer-quality-${Date.now().toString(36)}`;
  const requests: string[] = [];
  const synthesisInputs: ModelInput[] = [];
  const fixtureErrors: string[] = [];
  const replies: string[] = [];

  const fixture = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://fixture.invalid");
      requests.push(url.pathname);
      let result: unknown;
      if (url.pathname.endsWith("/city/lookup")) {
        result = { code: "200", location: [{ id: "101310201", name: "三亚", adm1: "海南省", country: "中国", tz: "Asia/Shanghai" }] };
      } else if (url.pathname === "/qweather/v7/weather/now") {
        result = {
          code: "200", updateTime: "2026-09-22T18:00+08:00", fxLink: weatherSource,
          now: { obsTime: "2026-09-22T18:00+08:00", temp: "28", feelsLike: "29", text: "阴", windDir: "东北风", windScale: "4", windSpeed: "23", humidity: "80", precip: "0", pressure: "1010", vis: "8" }
        };
      } else if (url.pathname === "/qweather/v7/weather/7d") {
        result = {
          code: "200", updateTime: "2026-09-22T18:00+08:00", fxLink: weatherSource,
          daily: [22, 23, 24, 25, 26, 27, 28].map((day) => ({
            fxDate: `2026-09-${day}`, tempMax: day === 24 ? "32" : "31", tempMin: "25",
            textDay: day === 24 ? "雷阵雨" : "多云", textNight: "多云", windDirDay: "东风", windScaleDay: "3-4"
          }))
        };
      } else if (url.pathname === "/search") {
        const body = await jsonBody(request);
        expect(body.include_answer).toBe(false);
        expect(body.include_published_date).toBe(true);
        result = {
          query: body.query,
          // 即使供应商违背 include_answer 约定返回摘要，也不能升级成证据。
          answer: "未经原文支持的摘要：现在没有台风，放心旅游。",
          results: String(body.query).includes("来源日期") ? [{
            title: "时间不明的状态页", url: undatedSource,
            content: "页面没有发布时间，无法确认所述海上状态对应哪一天。", score: 0.99, published_date: null
          }] : [{
            title: "历史海上预警", url: warningSource,
            content: "2026年9月12日发布，影响时段为9月12日至9月15日。不能说明9月22日是否仍生效。",
            score: 0.98, published_date: "2026-09-12T09:30:00+08:00"
          }]
        };
      } else if (url.pathname === "/v1/chat/completions") {
        const body = await jsonBody(request);
        const messages = body.messages as Array<{ role: string; content: string }>;
        const input = JSON.parse(messages.find((message) => message.role === "user")!.content) as ModelInput;
        let content: unknown;
        if (input.available_tools) {
          const followup = !input.user_prompt.includes("九月二十四");
          content = {
            intent: followup ? "确认三亚近期台风" : "三亚指定日期天气与旅游",
            confidence: 0.95,
            required_tools: followup ? ["web.search", "weather.get"] : ["weather.get", "web.search"],
            task_steps: ["查询目标日期天气", "核对台风来源与适用时间"],
            final_response_plan: "根据实际结果回答天气、台风与旅游影响",
            final_response_text: "执行前未核验草稿：没有台风，很适合旅游。",
            tool_inputs: {
              "weather.get": { city: "三亚", includeForecast: true, startDate: "2026-09-24", endDate: "2026-09-28" },
              "web.search": [
                { query: "三亚 台风 2026年9月22日 最新预警", searchDepth: "advanced", topic: "news", timeRange: "week" },
                { query: "三亚 台风 来源日期 核对", maxResults: 3 }
              ]
            }
          };
        } else {
          synthesisInputs.push(input);
          const calls = input.evidence?.calls;
          expect(calls).toHaveLength(3);
          expect(calls!.filter((call) => call.toolName === "web.search")).toHaveLength(2);
          const weather = calls!.find((call) => call.toolName === "weather.get")!.output;
          const daily = weather.forecast as Array<{ date: string; textDay: string; tempMinC: number; tempMaxC: number }>;
          expect(daily.map((day) => day.date)).toEqual([22, 23, 24, 25, 26, 27, 28].map((day) => `2026-09-${day}`));
          const serialized = JSON.stringify(input.evidence);
          expect(serialized).toContain(warningSource);
          expect(serialized).toContain(undatedSource);
          expect(serialized).not.toContain("未经原文支持的摘要");
          expect(serialized).not.toContain("执行前未核验草稿");
          expect(input.reference_time).toBe("2026-09-22T10:00:00.000Z");
          const followup = !input.user_prompt.includes("九月二十四");
          if (followup) {
            expect(input.room_context?.recentMessages?.some((message) => message.content === replies[0])).toBe(true);
          }
          const dates = daily.filter((day) => day.date >= "2026-09-24").map((day) => `${day.date.slice(5)} ${day.textDay} ${day.tempMinC}～${day.tempMaxC}℃`).join("；");
          const sources = input.evidence!.sources;
          const sourceId = (url: string) => sources.find((source) => source.url === url)!.id;
          const blocks = followup
            ? [{ text: "台风情况暂时无法确认：查到的是9月12日发布、适用至9月15日的历史公告，另一页时间不明，不能据此断言现在没有台风。", sourceIds: [sourceId(warningSource), sourceId(undatedSource)] }]
            : [
              { text: `你说的9月24日至28日包含五个日期，先按明确日期范围整理。\n${dates}。`, sourceIds: [sourceId(weatherSource)] },
              { text: "台风情况暂时无法确认：历史公告只适用于9月12日至15日。旅游安排需保留调整空间，当前证据不足以保证出海安全。", sourceIds: [sourceId(warningSource)] },
            ];
          replies.push(blocks.map((block) => block.text).join("\n\n"));
          content = { blocks };
        }
        result = { choices: [{ message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } };
      } else {
        throw new Error(`非预期测试请求：${url.pathname}`);
      }
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(result));
    })().catch((error: unknown) => {
      fixtureErrors.push(error instanceof Error ? error.message : String(error));
      response.writeHead(500, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "受控 HTTP 证据断言失败" }));
    });
  });

  try {
    await new Promise<void>((resolveListen, reject) => {
      fixture.once("error", reject);
      fixture.listen(0, "127.0.0.1", resolveListen);
    });
    const address = fixture.address();
    if (!address || typeof address === "string") throw new Error("HTTP fixture 未监听本机端口。");
    const fixtureOrigin = `http://127.0.0.1:${address.port}`;
    const user = await db.user.findUniqueOrThrow({ where: { email: E2E_USERS[0].email } });
    await db.room.create({ data: {
      id: roomId, slug: roomId, name: "工具综合双轮测试房间",
      participants: { create: { userId: user.id, role: "owner" } }
    } });
    await page.goto(`/chat/${roomId}`);

    for (const prompt of [firstPrompt, secondPrompt]) {
      await page.getByLabel("消息内容").fill(prompt);
      const accepted = page.waitForResponse((response) => response.request().method() === "POST"
        && new URL(response.url()).pathname === `/api/rooms/${roomId}/messages`);
      await page.getByRole("button", { name: "发送", exact: true }).click();
      const response = await accepted;
      expect(response.ok(), await response.text()).toBe(true);
      const payload = await response.json() as { task: { id: string } };
      expect(payload.task?.id).toBeTruthy();
      // 固定该测试任务的查询参考时间；消息与最终答复仍完全由真实聊天/Runtime 写入。
      await db.agentTask.update({ where: { id: payload.task.id }, data: { createdAt: new Date("2026-09-22T10:00:00Z") } });
      await promisify(execFile)(process.execPath, [
        "--import", "tsx", resolve("tests/e2e/support/run-answer-quality-task.ts"), payload.task.id, fixtureOrigin
      ], { env: {
        ...process.env, NODE_ENV: "test", DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl,
        LLM_PROVIDER: "openai-compatible", LLM_API_KEY: "isolated-answer-test", LLM_MODEL: "answer-test",
        LLM_BASE_URL: `${fixtureOrigin}/v1`, WEATHER_PROVIDER: "qweather", WEATHER_API_KEY: "isolated-weather-test",
        QWEATHER_API_HOST: "answer-quality.qweather.invalid", QWEATHER_GEOAPI_HOST: "answer-quality.qweather.invalid",
        TAVILY_API_KEY: "isolated-search-test", AGENT_DEBUG_ENABLED: "false"
      }, timeout: 30_000 });
      expect(fixtureErrors).toEqual([]);
      const saved = await db.agentTask.findUniqueOrThrow({
        where: { id: payload.task.id }, include: { finalMessage: true, llmCalls: true, toolCalls: true }
      });
      expect(saved.status).toBe("completed");
      expect(saved.turnsUsed).toBe(2);
      expect(saved.llmCalls).toHaveLength(2);
      expect(saved.toolCalls).toHaveLength(3);
      expect(saved.finalMessage?.content).toBe(replies.at(-1));
      await expect(page.getByRole("article").locator(":scope > p").filter({ hasText: replies.at(-1)! })).toBeVisible();
    }

    const summaries = page.locator("summary").filter({ hasText: "参考来源" });
    await expect(summaries).toHaveCount(2);
    await expect(page.getByRole("link", { name: /历史海上预警/ })).toHaveCount(0);
    await summaries.first().focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("link", { name: /历史海上预警/ })).toHaveAttribute("href", warningSource);
    await summaries.first().press("Space");
    await expect(page.getByRole("link", { name: /历史海上预警/ })).toHaveCount(0);
    expect(synthesisInputs).toHaveLength(2);
    expect(synthesisInputs.map((input) => input.evidence!.calls.map((call) => call.toolName))).toEqual([
      ["weather.get", "web.search", "web.search"], ["web.search", "web.search", "weather.get"]
    ]);
    expect(requests.filter((path) => path === "/qweather/v7/weather/7d")).toHaveLength(2);
    expect(requests.filter((path) => path === "/search")).toHaveLength(4);
    await page.reload();
    for (const reply of replies) await expect(page.getByRole("article").locator(":scope > p").filter({ hasText: reply })).toBeVisible();
    expect(await db.message.count({ where: { roomId, senderType: "agent" } })).toBe(2);
    await expect(page.getByText(/执行前未核验草稿|未经原文支持的摘要/)).toHaveCount(0);
  } finally {
    await page.goto("about:blank").catch(() => undefined);
    await new Promise<void>((resolveClose) => fixture.close(() => resolveClose()));
    try { await db.room.deleteMany({ where: { id: roomId } }); }
    finally { await db.$disconnect(); }
  }
});


test("共享Chat、Study与专属私聊的来源均支持键盘展开、历史刷新与隔离", async ({ context }) => {
  await withStudyUser(context, async ({ page, db, roomId, userId }) => {
    const agent = await db.agent.findUniqueOrThrow({ where: { slug: "life-assistant" } });
    const privateRoom = await db.room.create({ data: {
      slug: `${userId}-private`, name: "专属来源验证", kind: "agent_private", privateOwnerId: userId, maxHumanUsers: 1,
      participants: { create: { userId, role: "owner" } },
    } });
    const shared = longAnswer("shared");
    const privateAnswer = longAnswer("private");
    const sharedText = shared.content;
    const privateText = privateAnswer.content;
    try {
      await db.message.createMany({ data: [
        { roomId, senderType: "agent", senderAgentId: agent.id, ...shared, metadata: { ...shared.metadata, toolResults: "内部载荷不得显示" } },
        { roomId, senderType: "agent", senderAgentId: agent.id, content: "没有来源的历史消息。" },
        { roomId: privateRoom.id, senderType: "agent", senderAgentId: agent.id, ...privateAnswer },
      ] });
      for (const path of [`/chat/${roomId}`, "/study", "/home"]) {
        await page.goto(path);
        const isPrivate = path === "/home";
        if (isPrivate) await page.getByRole("button", { name: entryName }).click();
        const scope = isPrivate ? page.getByRole("dialog") : page.locator("main");
        const summary = scope.locator("summary").filter({ hasText: "参考来源" });
        await expect(summary).toHaveCount(1);
        await expect(scope.getByText(isPrivate ? privateText : sharedText, { exact: true }).first()).toBeVisible();
        await expect(scope.getByText(isPrivate ? sharedText : privateText, { exact: true })).toHaveCount(0);
        const links = scope.getByRole("link", { name: isPrivate ? /^private来源 \d\s*（新窗口打开）$/u : /^shared来源 \d\s*（新窗口打开）$/u });
        const link = links.first();
        await expect(link).toHaveCount(0);
        await summary.focus();
        const baseline = await referenceLayout(summary);
        await page.keyboard.press("Enter");
        await expect(link).toBeVisible();
        await expectReferenceBoundary(summary, baseline);
        await page.keyboard.press("Tab");
        await expect(link).toBeFocused();
        await expect(link).toHaveAttribute("href", `https://source.example.test/${isPrivate ? "private" : "shared"}/1`);
        await expect(scope.getByText("发布/更新：2026-10-08")).toHaveCount(5);
        for (let index = 1; index < 5; index++) await page.keyboard.press("Tab");
        await expect(links.last()).toBeFocused();
        await expect(links.last()).toBeInViewport();
        await expectReferenceBoundary(summary, baseline);
        await page.reload();
        if (isPrivate) await page.getByRole("button", { name: entryName }).click();
        await expect(summary).toBeVisible();
        await expect(link).toHaveCount(0);
        await summary.focus();
        const refreshed = await referenceLayout(summary);
        await page.keyboard.press("Space");
        await expect(link).toBeVisible();
        await expectReferenceBoundary(summary, refreshed);
        await expect(scope.getByText("内部载荷不得显示")).toHaveCount(0);
      }
    } finally {
      await page.goto("about:blank");
      await db.room.delete({ where: { id: privateRoom.id } });
    }
  });
});
