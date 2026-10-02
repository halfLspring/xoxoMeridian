import { describe, expect, it } from "vitest";

import { buildAnswerEvidence, buildEvidenceFallback, parseAnswerResponse, renderEvidenceFallback, validateAnswerText } from "@/agent/answer-evidence";
import type { LLMAnswerRequest, ToolResult } from "@/agent/types";

function request(toolResults: ToolResult[], prompt = "三亚9月24日到28日四天的天气，有台风吗，适合旅游吗"): LLMAnswerRequest {
  return {
    prompt, referenceTime: "2026-09-22T11:00:00Z",
    plan: { intent: "查询天气和台风", confidence: 0.9, requiredTools: [], taskSteps: [], finalResponsePlan: "内部计划", finalResponseText: "草稿称没有台风", toolInputs: {} },
    toolResults,
    roomContext: {
      room: { name: "测试", slug: "test" }, requestedById: null, self: null, partner: null,
      participants: [], recentMessages: [], pinnedMemos: [], activeSchedules: [],
      semanticMemory: { aboutHer: [], aboutMe: [], shared: [] }, summaries: { global: null, recent: [] }
    }
  };
}

const weather: ToolResult = {
  toolName: "weather.get", stepKey: "weather-0", input: { city: "三亚", startDate: "2026-09-24", endDate: "2026-09-28" },
  output: {
    provider: "qweather", city: "三亚", condition: "阴", temperatureC: 28, observedAt: "2026-09-22T18:48+08:00",
    issuedAt: "2026-09-22T08:00+08:00", timezone: "Asia/Shanghai",
    source: { name: "和风天气", url: "https://weather.test/sanya" },
    forecast: [{ date: "2026-09-24", textDay: "多云", tempMinC: 24, tempMaxC: 33 }]
  }
};
const search: ToolResult = {
  toolName: "web.search", output: {
    provider: "tavily", answer: "摘要错误断言当前有台风", results: [
      { title: "9月12日预警", url: "https://news.test/old", publishedDate: "2026-09-12", content: "影响时段9月12至15日。" },
      { title: "气候均值", url: "https://climate.test/sanya", content: "九月气候统计均值。" }
    ]
  }
};

describe("工具执行后证据与如实降级", () => {
  it("保留每次调用并隔离规划草稿和供应商摘要", () => {
    const input = request([weather, search, { ...weather, stepKey: "weather-1", output: { city: "海口" } }]);
    const evidence = buildAnswerEvidence(input);
    expect(evidence.calls).toHaveLength(3);
    expect(evidence.calls.map((call) => call.stepKey)).toEqual(["weather-0", undefined, "weather-1"]);
    expect(JSON.stringify(evidence)).not.toContain("摘要错误");
    expect(JSON.stringify(evidence)).not.toContain("草稿称");
    expect(JSON.stringify(input.toolResults)).toContain("摘要错误");
  });

  it("提供完整日历范围与实际缺失日期，不附加场景教程", () => {
    const evidence = buildAnswerEvidence(request([weather]));
    expect(evidence.calls[0].missingDates).toEqual(["2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28"]);
    expect(evidence.calls[0].requestedDayCount).toBe(5);
    const text = renderEvidenceFallback(request([weather]));
    expect(text).toContain("2026-09-28");
    expect(text).toContain("暂时无法确认");
    expect(text).not.toContain("草稿称");
  });

  it("保留来源的原始日期和适用期，不把提前发布或日期未知自动当作过期", () => {
    const evidence = buildAnswerEvidence(request([search]));
    expect(evidence.sources[0].dates).toEqual([{ kind: "published", value: "2026-09-12" }]);
    expect(evidence.sources[1].dates).toEqual([]);
    expect(evidence.calls[0].output.results).toEqual(expect.arrayContaining([expect.objectContaining({ content: "影响时段9月12至15日。", sourceId: "s1" })]));
    const fallback = buildEvidenceFallback(request([search]), "无法综合");
    expect(fallback.text).toContain("暂时无法确认");
    expect(fallback.text).not.toMatch(/https?:|摘要错误|台风|旅游/);
    expect(fallback.references).toBeUndefined();
  });

  it("参考日期按目的地时区计算，原始发布时间不被覆盖", () => {
    const input = request([weather, search]);
    input.referenceTime = "2026-09-21T20:00:00Z";
    const evidence = buildAnswerEvidence(input);
    expect(evidence.referenceDate).toBe("2026-09-22");
    expect(evidence.referenceTimezone).toBe("Asia/Shanghai");
    expect(evidence.sources[0].dates).toContainEqual({ kind: "issued", value: "2026-09-22T08:00+08:00" });
  });

  it("天气和搜索调换顺序均展示两份结果，不截断目标范围", () => {
    const allWeather = { ...weather, output: { ...weather.output as object, forecast: [24, 25, 26, 27, 28].map((day) => ({ date: `2026-09-${day}`, textDay: "多云", tempMinC: 24, tempMaxC: 33 })) } };
    for (const results of [[allWeather, search], [search, allWeather]]) {
      const text = renderEvidenceFallback(request(results));
      expect(text).toContain("2026-09-28 多云");
      expect(text).toContain("相关资料尚不足");
      expect(text).not.toContain("缺失预报日期");
    }
  });

  it("模拟数据及失败不呈现为实况或确切出行判断", () => {
    const text = renderEvidenceFallback(request([
      { toolName: "weather.get", output: { provider: "mock", city: "三亚", temperatureC: 16, condition: "晴", fallbackReason: "供应商不可用" } },
      { toolName: "web.search", output: { availability: "unavailable", results: [], answer: "确定没有台风" } }
    ]));
    expect(text).toContain("模拟");
    expect(text).toContain("不可用");
    expect(text).not.toContain("16°C");
    expect(text).not.toContain("确定没有台风");
    expect(text).toContain("暂时无法确认");
  });

  it("非天气组合和同工具多次调用都保留，记忆与列表响应真实结果变化", () => {
    const output = (value: string) => renderEvidenceFallback(request([
      { toolName: "memo.create", output: { memoId: "saved-memo", title: "备忘一" } },
      { toolName: "memo.create", output: { memoId: "saved-memo", title: "备忘二" } },
      { toolName: "memory.recall", output: { memories: [{ key: "shared.preference", value }] } },
      { toolName: "memo.list", output: { memos: [{ title: "周末", content: "一起散步" }] } },
      { toolName: "timezone.compare", output: { from: { label: "甲", time: "10:00" }, to: { label: "乙", time: "12:00" }, suggestion: "联系建议" } },
      search
    ], "查看备忘、记忆、时区和搜索"));
    expect(output("甲偏好")).toContain("甲偏好");
    expect(output("乙偏好")).not.toContain("甲偏好");
    for (const value of ["备忘一", "备忘二", "一起散步", "10:00", "相关资料尚不足"]) expect(output("甲偏好")).toContain(value);
  });

  it("已完成写操作按真实结果确认，不依赖综合服务", () => {
    const text = renderEvidenceFallback(request([
      { toolName: "schedule.create", output: { jobId: "saved-job", description: "散步", nextRunAt: "2026-09-23T12:00:00Z", timezone: "Asia/Shanghai", runOnce: true } },
      { toolName: "schedule.update", output: { jobId: "saved-job", description: "吃饭", nextRunAt: "2026-09-24T12:00:00Z", timezone: "Asia/Shanghai", runOnce: false, cron: "0 20 * * *" } },
      { toolName: "schedule.cancel", output: { cancelled: true } },
      { toolName: "memo.delete", output: { deleted: true } },
      { toolName: "memory.set", output: { memoryId: "saved-memory", value: "喜欢散步。" } }
    ], "更新计划"));
    for (const value of ["已安排", "仅执行一次", "已更新", "已取消", "已删除", "喜欢散步"]) expect(text).toContain(value);
    expect(text).not.toContain("草稿称");
    expect(text).not.toContain("。。");
  });

  it("写入缺少成功标识或返回失败时不声称完成", () => {
    const text = renderEvidenceFallback(request([
      { toolName: "memo.create", output: {} },
      { toolName: "memory.set", output: { status: "failed", error: "unavailable" } },
    ], "保存结果"));
    expect(text).toContain("尚未取得该项操作成功的确认");
    expect(text).not.toMatch(/已保存|已记住/);
  });

  it("纯写入旅游备忘时只确认保存，不增加未经请求的旅行判断", () => {
    expect(renderEvidenceFallback(request([{ toolName: "memo.create", output: { memoId: "saved-memo", title: "新的备忘录" } }], "备忘录：三亚旅游时查台风"))).toBe("备忘录已保存：新的备忘录。");
  });

  it("仅允许实际来源中的安全链接，拒绝模型编造来源", () => {
    const input = request([search]);
    expect(validateAnswerText("资料见[旧公告](https://news.test/old)。", input)).toContain("旧公告");
    expect(() => validateAnswerText("见 https://invented.test/typhoon", input)).toThrow(/来源/);
    expect(() => validateAnswerText("[危险](javascript:alert(1))", input)).toThrow(/来源/);
    expect(() => validateAnswerText(" ", input)).toThrow();
  });

  it.each([
    '[来源](//invented.test/current "标题")',
    '[来源](javascript:alert(1) "标题")',
    '[来源][1]\n[1]: //invented.test/current "标题"',
    '[来源][1]\n[1]: <javascript:alert(1)>',
    '<mailto:invented@test.invalid>'
  ])("拒绝带标题或引用式的未提供链接：%s", (text) => {
    expect(() => validateAnswerText(text, request([search]))).toThrow(/来源/);
  });

  it("接受实际来源的带标题/引用式链接及含配对括号的URL", () => {
    const source = "https://news.test/notice(2026)";
    const input = request([{ toolName: "web.search", output: { results: [{ url: source }] } }]);
    for (const text of [
      `[来源](${source} "标题")`,
      `[来源](<${source}> "标题")`,
      `[来源][1]\n[1]: ${source} "标题"`,
      `来源：${source}。`
    ]) expect(() => validateAnswerText(text, input), text).not.toThrow();
  });

  it("允许如实复述本地记忆和备忘里的URL，不把输入、草稿或搜索摘要链接当来源", () => {
    const input = request([
      { toolName: "memory.recall", output: { memories: [{ value: "喜欢 https://memory.test/place" }] } },
      { toolName: "memo.list", output: { memos: [{ content: "参考[网页](https://memo.test/page)" }] } },
      { toolName: "web.search", input: { query: "https://input.test" }, output: { answer: "https://summary.test", results: [{ url: "https://source.test", content: "https://snippet.test" }] } }
    ]);
    input.plan.finalResponseText = "https://draft.test";
    expect(validateAnswerText("喜欢 https://memory.test/place；备忘[网页](https://memo.test/page)", input)).toContain("memory.test");
    for (const url of ["https://input.test", "https://summary.test", "https://snippet.test", "https://draft.test"]) {
      expect(() => validateAnswerText(url, input)).toThrow(/来源/);
    }
  });
});


describe("正文和来源关联协议", () => {
  it("只保留实际引用的来源，按规范URL去重并保留段落关联", () => {
    const input = request([search, { ...search, stepKey: "again" }]);
    const answer = parseAnswerResponse(JSON.stringify({ blocks: [
      { text: "目前资料不覆盖所问日期。", sourceIds: ["s1", "s1"] },
      { text: "这份公告只在9月12日至15日适用。", sourceIds: ["s1"] },
      { text: "尚不能确认当前情况。", sourceIds: [] }
    ] }), input);
    expect(answer.text).not.toContain("http");
    expect(answer.references?.sources).toHaveLength(1);
    expect(answer.references?.sources[0].url).toBe("https://news.test/old");
    expect(answer.references?.citations.map((item) => answer.text.slice(item.start, item.end))).toEqual([
      "目前资料不覆盖所问日期。", "这份公告只在9月12日至15日适用。"
    ]);
  });

  it.each([
    { blocks: [{ text: "伪造来源", sourceIds: ["s99"] }] },
    { blocks: [{ text: "坏链接 [详情](javascript:alert(1))", sourceIds: [] }] },
    { blocks: [{ text: "坏地址 https://invented.test", sourceIds: [] }] },
    { blocks: [{ text: " ", sourceIds: [] }] },
    { text: "旧格式只能读取旧 checkpoint，不能作为新模型输出" },
  ])("拒绝不存在来源、不安全地址和不合约的新模型输出", (value) => {
    expect(() => parseAnswerResponse(JSON.stringify(value), request([search]))).toThrow();
  });

  it("用户要求的真实操作链接可留正文，失败和mock不能供应引用", () => {
    expect(parseAnswerResponse(JSON.stringify({ blocks: [{ text: "入口：https://news.test/old", sourceIds: ["s1"] }] }), request([search])).text).toContain("https://news.test/old");
    const input = request([{ ...search, output: { ...search.output as object, provider: "mock" } }]);
    expect(buildAnswerEvidence(input).sources).toEqual([]);
    expect(() => parseAnswerResponse(JSON.stringify({ blocks: [{ text: "事实", sourceIds: ["s1"] }] }), input)).toThrow(/来源/);
  });

  it("天气降级正文保留完整范围和缺口，来源单独关联", () => {
    const answer = buildEvidenceFallback(request([weather]), "provider失败");
    expect(answer.text).toContain("2026-09-28");
    expect(answer.text).not.toMatch(/https?:|台风|旅游|sourceId/);
    expect(answer.references?.sources).toHaveLength(1);
    const citation = answer.references!.citations[0];
    expect(answer.text.slice(citation.start, citation.end)).toContain("三亚逐日预报");
  });
});
