# feat-083：Agent 天气与搜索查询的证据质量和回答闭环

- 登记日期：2026-09-22。
- 状态：`done`。2026-09-22 用户已明确要求执行方案并完成 feat-083；采用推荐的一次规划、工具执行、一次结果综合，不纳入可选自动补查。下方调查时的“待讨论/未实施”描述保留为历史证据。
- 直接责任：QAM-08 的规划、工具结果消费与最终回复；关联责任：QAM-03 的天气数据契约。搜索适配归 QAM-08。
- 入口：[feat-083 验收证据](../../feature_list.json)。
- 本轮参考 QAM-08/QAM-03 审查技能的证据纪律与责任划分；这是针对用户案例的根因调查，不是全模块重新评分。既有 QAM 分数没有因本次调查而更新。

## 1. 用户目标与证据边界

用户询问三亚 9 月 24 日至 28 日的天气、是否有台风、是否适合旅游；随后再次追问近期台风。两次计划均列出 `weather.get` 和 `web.search`，工具结果也均存在，最终消息却只有当前天气及 9 月 22 日至 24 日的三天预报。

日期按首尾都包含计算是 5 个日历日，原问题中的“四天”与明确日期范围有歧义。合格答复应说明暂按 24–28 日处理，或在确实影响检索时澄清；不能默默删掉一天。查询基准时间和目的地时区也应明确，而不是让模型只从最近消息猜测。

用户提供的外部搜索内容仅作为当次工具返回快照：本轮没有重新核验当时台风实况，也不据此判断现实旅游安全。没有保存用户身份、原始 rawResponse 或模型 reasoning_content；下方实验使用最小天气字段与合成搜索来源。

## 2. 已确认的根因

下表源码定位与第 6、7 节探针对应实施前基线 `f37ffdc`；原函数和行号已随修复变化。最终实现及回归入口见第 8 节。

| 编号 | 机制与影响 | 证据 |
| --- | --- | --- |
| R1 | `renderAgentReply` 先把结果按工具名称转为 Map，然后只要存在天气结果就提前 return。天气优先级由代码分支决定，与调用顺序、问题重点无关；搜索和旅行判断均被跳过。同工具多次调用也只剩最后一份。 | [Runtime 最终呈现](../../agent/agent-runtime.ts#L664)、[实际工具执行与最终写入](../../agent/agent-runtime.ts#L282)；本轮离线行为探针 E3 |
| R2 | LLM 只做工具执行前的 plan，却被要求同时生成“实际发给用户”的 final_response_text；接口只有 plan 方法。工具执行后直接调用模板，没有把真实结果送回模型综合。finalResponsePlan/taskSteps 只是记录，不会执行“综合判断”这类自然语言步骤。 | [Provider 提示词](../../agent/llm-provider.ts#L204)、[Provider 接口](../../agent/types.ts#L56)、[执行顺序](../../agent/agent-runtime.ts#L312)，E2 |
| R3 | 天气输入仅 city/includeForecast；调用固定 `/v7/weather/3d`，输出又被模板截断到前三天。案例查询时 3 天是 09-22～09-24，只覆盖所问范围的一天，不是从出行日开始的三天。没有请求日期、实际覆盖缺口、预报发布时间和台风预警契约；晴阴与当前风力无法证明没有台风。 | [天气输入](../../agent/tool-contracts.ts#L139)、[天气请求](../../agent/tools/weather-tool.ts#L224)、[格式化](../../agent/tools/weather-tool.ts#L265)、[截断](../../agent/agent-runtime.ts#L704)，E2；给模板七天数据仍只显示前三天的探针 E3 |
| R4 | 搜索只传 query/max_results/search_depth，并要求 include_answer=true；没有检索时间窗口、来源约束和证据适用期判断。单独搜索时，模板直接展示供应商生成的 answer。相关性得分和“advanced”均不等于当前、可靠或适用。 | [搜索 contract](../../agent/tool-contracts.ts#L151)、[Tavily 请求与结果投影](../../agent/tools/search-tool.ts#L166)、[搜索呈现](../../agent/agent-runtime.ts#L741)，E2；未核验摘要原样呈现的探针 E3 |
| R5 | 系统提示与工具说明笼统禁止“天气问题使用搜索”，没有区分普通天气、超出天气工具覆盖范围的预报、台风公告和海上活动限制。这两次仍搜到了结果，因此它不是此次答复一致的直接原因，但会妨碍后续正确规划。 | [Planner 搜索说明](../../agent/llm-provider.ts#L234)、[Tool 描述](../../agent/tools/search-tool.ts#L91)，E2 |
| R6 | 天气 API 失败或配置缺失会返回 mock 的固定天气；天气最终模板不展示 provider/fallbackReason。搜索虽有模拟提示，但两工具的失败语义不统一，返回成功的 ToolCall 不能代表取到了真实资料。此次返回 qweather/tavily，因此降级不是所报两次故障的原因。 | [天气降级](../../agent/tools/weather-tool.ts#L75)、[模拟值](../../agent/tools/weather-tool.ts#L143)、[呈现](../../agent/agent-runtime.ts#L718)、[搜索降级](../../agent/tools/search-tool.ts#L63)，E2；模拟天气未标明的探针 E3 |
| R7 | 现有测试主要验证注册、单工具适配、缓存、参数、mock 与计划结构；语义校验集中在计划创建/取消承诺。缺少本案例这种跨工具、日期覆盖和信息时效性到最终消息的验收。 | [现有 Runtime 测试](../../tests/agent/agent-runtime.test.ts)、[天气测试](../../tests/agent/weather-tool.test.ts)、[搜索测试](../../tests/agent/search-tool.test.ts)、[语义校验](../../agent/plan-validator.ts#L67)，E2；本轮三文件 40/40 通过，同时渲染探针复现缺陷 |

用户样例中的结果本身也需要筛选：

- 第一轮排名靠前的气候统计不能当成 09-24～09-28 的逐日预报；09-01 的台风公告不能支持 09-22 仍有该预警。
- 第二轮公告发表于 09-12，正文影响时段主要是 09-12～09-15，不能直接支持 09-22 或 09-24～09-28 的台风结论。
- 第一轮返回的中央气象台片段包含目标日期的预报，但也混有其他日期内容；需要核对预报发布时间、日期段和来源，不能整段无差别采用。
- Tavily 的 answer 是另一个 LLM 生成的摘要，不能独立充当事实来源；Planner 提前写出的“没有明显台风威胁”“适合旅游”同样没有经过本次结果验证。
- 因此，简单拼接两份模板、调整分支顺序、直接输出 plan.finalResponseText，均不能满足验收。

## 2.1 通用影响范围复核（2026-09-22）

用户追问该问题是否只影响天气。本轮以当前同一个呈现函数补做非天气实验，6/6 断言复现，命令 exit 0：

| 输入结果 | 实际答复行为 |
| --- | --- |
| timezone.compare + web.search | 仅返回两地时间，搜索证据不进入答复 |
| memo.create + web.search | 仅确认备忘录标题，搜索证据不进入答复 |
| 两次 memo.create，标题分别为备忘一/备忘二 | 仅确认备忘二 |
| memory.recall 返回甲或乙（两个独立用例） | 两种情况均原样返回执行前草稿 |
| memo.list 返回两条备忘录 | 原样返回执行前草稿，不展示列表 |

共享函数的分支顺序是 weather.get → timezone.compare → memo.create → web.search → plan.finalResponseText。没有专用分支的查询工具同样没有结果综合步骤；工具结果改变不一定改变最终答案。此处丢失的是最终答复消费的信息，不能据此断言工具未执行或数据库记录丢失：Runtime 仍保留原始 toolResults，Map 只在呈现函数内部建立。

通用根因属于 QAM-08 的结果消费与最终回复链路；天气三天窗口属于具体工具能力，搜索时效性则会影响各类实时查询。单一工具、简单确认恰好与模板匹配时可以正常回答，不能把本结论写成“所有工具调用都失败”。

本轮补充影响范围证据，不改变用户尚未确认的实施范围。feat-083 仍为 not-started；建议以共享 Runtime 修复为核心，用天气/搜索和上述非天气场景验证通用规则，再单独处理已有工具的日期/来源契约。

## 3. 推荐方案（待讨论）

采用有边界的两阶段流程：

`理解问题与规划 → 执行工具 → 整理证据与缺口 → 基于结果生成答复 → 持久化最终消息`

1. **保留用户要解决的问题。** 规划阶段提取地点、明确日期、目的地时区与问题清单；注入明确的查询参考时间。需要工具时，规划期文本不能作为已查证的答案。延续上下文解释“最近有台风吗”时，先回答台风，天气只是补充。
2. **让已有工具携带可判断的证据。** 天气支持按所需范围选择有界预报长度，返回实际覆盖日期、预报发布时间、来源与不可用原因；查询日到 09-28 在本例需要覆盖七天。搜索支持有校验的发布时间范围、来源约束及发布日期，并保留原文片段、URL、获取时间和时间不明标识。发布窗口与旅行日期分开，不能把未来旅行日期直接当作新闻发布日期过滤器。保留每次调用，不按工具名覆盖。
3. **按原问题进行结果综合。** 对需要查询综合的请求，在工具之后增加一次 LLM 调用，读取原问题、必要上下文及完整的相关证据集合；按日期天气、台风现状、旅行影响回答。将预报、实况、历史事件和气候均值分开；来源冲突和缺失必须显式说明。最终引用只能指向实际返回的来源，模型生成的解释不能升级为新的外部事实。网页内容作为不可信数据处理。
4. **事实不足时保留不确定性。** 没搜到新公告不等于没有台风；拿到旧公告也不等于现在仍有预警。服务错误、mock 或时效无法确认应让用户看到“暂时无法确认”的具体范围，不用固定示例天气填充。当前实况不能单独支撑未来几天适合旅游的结论。
5. **沿用执行保障。** 综合调用纳入既有 token/cost/turn/deadline 预算、AbortSignal、lease、LLMCall/Trace 和 checkpoint；完成后的综合结果可恢复复用，恢复时不重复已有工具副作用或最终消息。只传本次所需上下文，避免额外复制完整房间资料。普通零工具聊天及已完成写操作的确认仍需回归保护。
6. **以最终效果验收。** 增加按场景维护的离线行为用例，检查问题覆盖、日期覆盖、来源与结论对应、时效性、信息不足表达和多结果保留；不能仅以 ToolCall completed、JSON schema 通过或测试总数作为质量结论。

范围边界：本项围绕已有 weather.get/web.search 的查询与回答闭环；不自动新增台风专用工具、付费服务、全局监控面板或无限重规划循环，也不合并既有 QAM-08 的其他恢复/隐私专项。跨工具综合属于共享 Runtime；天气适配修改须保持现有 LifePanel 调用契约。

### 官方能力核对（2026-09-22）

- [QWeather 城市逐日预报文档](https://dev.qweather.com/en/docs/api/weather/weather-daily-forecast-webapi-v7/)列出 3d/7d/10d/15d/30d，说明三天不是服务的唯一能力；该页面同时标注 v7 将弃用。
- [QWeather 新逐日预报文档](https://dev.qweather.com/en/docs/api/weather/weather-daily-forecast/)采用经纬度和 1～10 天参数，默认七天。实现前须按当前账户核对可用端点与兼容成本，本轮未调用真实凭据接口；若需独立迁移工程，不能隐式扩大本 feature。
- [Tavily Search 文档](https://docs.tavily.com/documentation/api-reference/endpoint/search)提供 topic、time_range、start_date/end_date、include_domains 和日期元数据。日期可能是估算的发布或更新时间，未知日期也可能被保留，所以服务端筛选仍不能替代正文适用期判断。include_answer 明确是 LLM 生成内容。

### 讨论点

推荐先实现“一次规划、工具执行、一次结果综合”，接受查询类任务增加一次模型调用的延迟和费用；证据仍不足就明确说明缺口。是否在本期加入“结果不足时最多一次定向补查”，会增加模型调用、工具次数和恢复状态，应由用户选择后再固定验收。当前没有把补查循环视为已授权范围。

## 4. 拟定验收

| 场景 | 可观察的验收标准 |
| --- | --- |
| 09-24～09-28 天气＋台风＋旅游 | 明确处理“四天/五个日期”的歧义；逐日覆盖所问区间或列出缺失日期；分别回应台风与旅行影响，提供来源/时间，不只回复当前天气 |
| 只追问台风 | 台风结论或证据不足是答复重点；不会因存在天气结果而丢掉搜索信息 |
| 工具顺序交换、同工具多次调用 | 顺序不改变问题覆盖；不同城市/不同查询的相关结果均保留，不仅消费最后一次 |
| 旧公告、气候平均值、月份不符、无日期网页、来源冲突 | 不将它们当成目标日期的已验证预报或当前有效预警；保留正确标识，说明冲突或未知；避免仅凭 URL 年份或搜索分数判断 |
| 搜索摘要与原文冲突 | 不直接复述供应商摘要或规划期草稿；结论以可追溯原文和时间范围为依据 |
| 缺预报、天气/搜索失败或模拟数据 | 区分部分可用与不可用，不显示模拟天气为实况，不从“无结果”推导“无台风” |
| 综合失败、预算耗尽、lease 失权和重启 | 有明确、可恢复且如实的终态；不重复已完成副作用或最终消息；综合调用记入预算和 Trace |
| 普通天气、无工具聊天及既有写工具路径 | 保持可用与原有权限、审批、幂等边界；天气 UI 不因 Agent 参数演进退化 |

实施后的验证应包括：Node 的问题/证据到答复行为回归与 HTTP adapter 替身；真实 PostgreSQL 的最终消息、步骤恢复与预算计数；生产 Playwright 的双轮聊天、引用、刷新后内容一致性。外部 LLM/Tavily/QWeather 使用可控 HTTP 边界，不能只预置最终消息绕过 Runtime。模型替身证明编排与规则，不代表真实模型在所有问法上均正确；真实模型质量抽样如需开展另行确定样本和费用。风险匹配门禁为 `./init.sh` 与 `npm run check:full`；若改动独立 Worker/部署路径，再执行相应 Compose smoke。

## 5. 本轮验证与未运行项

- 现有定向测试：`./scripts/run-node22.sh npm exec -- vitest run tests/agent/agent-runtime.test.ts tests/agent/weather-tool.test.ts tests/agent/search-tool.test.ts`，exit 0，3 文件/40 项，534ms。
- 下方 Node 离线探针：exit 0，精确复现用户给出的最终回复；七个机制观察均为 true。它运行当前函数体的实际 JavaScript，断言返回值，不用源码字符串匹配当作行为证明；但仅验证呈现函数，不冒充 Runtime/数据库/浏览器全链路。
- 不依赖真实外部网络或凭据运行上述实验；官方文档核对仅为方案能力核实。
- 未运行 `./init.sh`、`npm run check`、`npm run check:full`、真实 PostgreSQL、Playwright、Compose smoke、构建或重启：本轮只排查并登记文档，产品代码/依赖/运行配置没有修改，且用户要求讨论后实施。这些检查不能标为已通过。
- JSON/跨归档 ID/依赖/计数、本轮链接、既有状态保留和 diff/status 由收尾结构检查验证，最终结果见任务进度。没有留下临时测试文件、数据库记录、容器或失败日志。

## 6. 可复现的最小离线探针

以下是实施前的历史探针，需使用当时仍包含 `renderAgentReply` 的版本；修复后的代码已删除该函数，应运行第 8 节正式回归。在仓库根只在内存中提取并转译原私有呈现函数，不改动源文件或导出接口。这里有意断言“缺陷可以复现”，所以 exit 0 表示诊断成立，不表示修复通过。

```bash
./scripts/run-node22.sh node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const source = readFileSync("agent/agent-runtime.ts", "utf8");
const file = ts.createSourceFile("runtime.ts", source, ts.ScriptTarget.Latest, true);
const node = file.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === "renderAgentReply");
assert.ok(node);
const compiled = ts.transpileModule(node.getText(file), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const render = vm.runInNewContext(compiled + "\nrenderAgentReply");
const plan = { intent: "查询三亚目标日期天气和台风", finalResponseText: "规划期草稿标记" };
const weather = { toolName: "weather.get", output: {
  provider: "qweather", city: "三亚", condition: "阴", temperatureC: 28,
  feelsLikeC: 29, humidityPercent: 80, wind: { direction: "东北风", scale: "4" },
  forecast: [22, 23, 24].map((day) => ({
    date: "2026-09-" + day, textDay: "多云", tempMinC: day === 22 ? 25 : 24, tempMaxC: 33
  })), advice: "今天预计有降水，可以备一把伞。"
} };
const search = { toolName: "web.search", output: {
  provider: "tavily", query: "三亚 台风", answer: "未核验的旧预警摘要",
  results: [{ title: "旧预警", url: "https://example.com/old-warning", content: "2026-09-12 发布，适用 09-12 至 09-15。", score: 0.9 }]
} };
const reply = render(plan, [weather, search]);
const expected = "三亚现在阴，28°C，体感 29°C，湿度 80%，东北风 4 级。\n未来几天：09-22 多云 25~33°C；09-23 多云 24~33°C；09-24 多云 24~33°C。\n今天预计有降水，可以备一把伞。";
assert.equal(reply, expected);
const extended = structuredClone(weather);
extended.output.forecast.push(...[25, 26, 27, 28].map((day) => ({
  date: "2026-09-" + day, textDay: "测试预报", tempMinC: 25, tempMaxC: 31
})));
const duplicate = render(plan, [weather, { ...weather, output: { ...weather.output, city: "海口" } }]);
const mockReply = render(plan, [{ toolName: "weather.get", output: {
  provider: "mock", city: "三亚", condition: "partly cloudy", temperatureC: 16,
  advice: "带一件薄外套，晚上可能会凉一点。", fallbackReason: "测试供应商不可用"
} }]);
const findings = {
  weatherShadowsSearchBothOrders: render(plan, [search, weather]) === reply,
  changingSearchDoesNotChangeReply: render(plan, [weather, { ...search, output: { ...search.output, answer: "相反的检索结论" } }]) === reply,
  plannerDraftIgnored: !reply.includes(plan.finalResponseText),
  sameToolEarlierResultsLost: !duplicate.includes("三亚") && duplicate.includes("海口"),
  weatherMockNotDisclosed: !/模拟|mock|不可用/.test(mockReply),
  sevenDayPayloadStillTruncated: render(plan, [extended, search]) === reply,
  searchOnlyBlindlyUsesSummary: render(plan, [search]).startsWith(search.output.answer)
};
assert.ok(Object.values(findings).every(Boolean));
console.log(JSON.stringify({ reproducedReply: reply, findings }, null, 2));
NODE
```


## 7. 非天气场景补充探针

同样是实施前的历史探针，仅运行原呈现函数，不访问数据库或外部服务，也不代表完整 Runtime 已验证。当时没有重跑上轮 40 项测试或应用门禁，因为只补充调查文档和状态证据。

```bash
./scripts/run-node22.sh node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const source = readFileSync("agent/agent-runtime.ts", "utf8");
const file = ts.createSourceFile("runtime.ts", source, ts.ScriptTarget.Latest, true);
const node = file.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === "renderAgentReply");
assert.ok(node);
const compiled = ts.transpileModule(node.getText(file), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const render = vm.runInNewContext(compiled + "\nrenderAgentReply");
const plan = { intent: "合成诊断请求", finalResponseText: "执行前的草稿" };
const search = { toolName: "web.search", output: { provider: "tavily", query: "测试", answer: "搜索证据", results: [] } };
const timezone = { toolName: "timezone.compare", output: { from: { label: "甲地", time: "10:00" }, to: { label: "乙地", time: "12:00" }, suggestion: "测试建议" } };
const memo = (title) => ({ toolName: "memo.create", output: { title } });
const recallA = { toolName: "memory.recall", output: { count: 1, memories: [{ key: "shared.preference", value: "甲" }] } };
const recallB = { toolName: "memory.recall", output: { count: 1, memories: [{ key: "shared.preference", value: "乙" }] } };
const examples = {
  timezoneAndSearch: render(plan, [timezone, search]),
  memoAndSearch: render(plan, [memo("备忘一"), search]),
  twoMemoCreates: render(plan, [memo("备忘一"), memo("备忘二")]),
  memoryRecallA: render(plan, [recallA]),
  memoryRecallB: render(plan, [recallB]),
  memoList: render(plan, [{ toolName: "memo.list", output: { count: 2, memos: [{ title: "备忘一" }, { title: "备忘二" }] } }])
};
assert.ok(!examples.timezoneAndSearch.includes("搜索证据"));
assert.equal(examples.memoAndSearch, "备忘录已保存：备忘一。");
assert.equal(examples.twoMemoCreates, "备忘录已保存：备忘二。");
assert.equal(examples.memoryRecallA, plan.finalResponseText);
assert.equal(examples.memoryRecallB, plan.finalResponseText);
assert.equal(examples.memoList, plan.finalResponseText);
console.log(JSON.stringify({ probe: "非天气呈现路径", checks: "6/6 复现", examples }, null, 2));
NODE
```


## 8. 实施记录（2026-09-22）

用户已明确授权执行本方案并完成 feat-083，采用推荐范围：一次规划、执行工具、查询结果再综合一次；不加入自动补查。没有新增供应商、依赖或数据库迁移。

- [Runtime](../../agent/agent-runtime.ts) 保留每次工具结果和调用输入，以任务创建时间固定本轮参考时间。任何读取工具参与时执行后置综合；纯写入逐项确认真实结果，无工具聊天继续直接回答。综合沿用 [预算](../../agent/runtime-budget.ts)、deadline、AbortSignal、lease 和 LLMCall；以独立 `synthesis` stepKey 持久化、复用既有模型步骤 `plan` kind。完成的综合在恢复时复用，不重复副作用或最终消息。
- [证据整理](../../agent/answer-evidence.ts) 剥离规划草稿、供应商摘要及模拟事实，保留每次调用，标明日期缺口和来源适用限制。综合失败时呈现真实取得的结果和未知范围；综合预算耗尽仍使用原 limit_exceeded 终态，但同时说明已经完成的工具结果。
- [Provider](../../agent/llm-provider.ts) 增加执行后接口，限定中文 JSON 答复、真实来源引用及不可用语义；传入原问题、参考时间、必要近期上下文和实际证据，不复制全部备忘与记忆。普通日期预报与台风/海上限制分别规划，取消笼统的天气禁搜规则。
- [天气](../../agent/tools/weather-tool.ts) 保留 UI 原调用方式，支持 1～31 个目标日历日范围，按参考日与目的地时区选择 3d/7d；七天以外明确缺失。返回实际 fxLink、发布时间、获取时间、实际覆盖和缺口；预报失败保留真实实况并标记 partial；不可用时不返回伪造温度。
- [搜索](../../agent/tools/search-tool.ts) 支持经校验与规范化的发布日期窗口、topic、来源域约束；`include_answer=false`，即使供应商返回摘要也丢弃。保存原文片段、URL、发布日期或更新时间、未知日期标识和获取时间。筛选不替代正文适用期判断。
- 新增 [证据测试](../../tests/agent/answer-evidence.test.ts)、[模型 HTTP 测试](../../tests/agent/llm-provider.test.ts)、[真实 PostgreSQL 测试](../../tests/integration/agent-answer-quality.integration.test.ts) 与 [生产浏览器双轮旅程](../../tests/e2e/agent-answer-quality.spec.ts)，覆盖通用多结果、原始天气场景、恢复与预算边界。浏览器使用真实聊天和 Runtime/适配层、本机受控 HTTP 供应商；现有聊天以纯文本显示消息，验收来源标题与 URL 的可见性和刷新一致性，不新增 Markdown 呈现功能。

### 已核对的外部能力与限制

QWeather 沿用当前 v7 host/auth 和 7d 路径，受控 HTTP 覆盖正常、403、部分与无配置情况。工作区账户能力检查使用 Node 22 从 `.env` 读取配置，仅输出是否配置和接口状态、不输出凭据或天气正文；结果为 `configured:false, reason:provider_or_credential_unavailable`，没有发起真实供应商请求。因此真实账户七天权限尚未验证，部署需提供有权限的 QWeather 配置；此处不以模拟测试冒充账户验证，也不扩大到 v1 迁移。Tavily 的 [官方 Search API](https://docs.tavily.com/documentation/api-reference/endpoint/search) 支持 `include_domains_mode=restrict`，用于只检索所列来源域。

确定性校验保证数据传递、日期缺口、模拟结果剥离和引用边界；时效适用、冲突解释与问题覆盖仍需要综合模型判断。受控模型测试证明编排与规则，不代表真实模型所有问法均正确；本期没有进行付费真实模型抽样。失权后的模型响应被挡在发布前，沿用既有 heartbeat 行为，未新增即时中断失权 HTTP 的机制。若进程在模型返回而综合 checkpoint 尚未提交时崩溃，恢复可能再次调用模型并继续计费；已完成 checkpoint 则复用，工具副作用和最终消息不重复。

日期范围的 31 天上限是输入表达能力，真实预报最多取参考日起七天，不是从旅行首日起七天。搜索窗口筛选发布／更新时间，日期可能由供应商估算；保留无日期来源并标记未知，只有规划传入 `includeDomains` 时才施加指定来源域约束。URL 校验保证引用来自实际证据，不等于逐句结论都得到对应正文支持。

### 迭代验证证据

- `./init.sh`：exit 0，类型、lint、93 文件/860 项快速基线通过。
- 天气新回归先红 11 失败/7 通过；工具和 Registry 首版最终 3 文件/53 项通过。搜索第一轮有 5 个输入负例仅 spy 未替换 fetch，用固定非真实 `test-key` 请求 Tavily 并收到 401；已修正为隔离 HTTP 替身，后续验证不使用真实网络。域名规范化追加回归先红后绿，搜索 27/27 通过。
- `./scripts/run-node22.sh npm exec -- vitest run tests/agent/agent-runtime.test.ts tests/agent/answer-evidence.test.ts tests/agent/llm-provider.test.ts tests/agent/plan-contract.test.ts tests/agent/weather-tool.test.ts tests/agent/search-tool.test.ts tests/agent/runtime-budget.test.ts`：exit 0，7 文件/134 项。
- 首轮四文件 PostgreSQL 定向命令：`./scripts/run-node22.sh npm run test:integration -- tests/integration/agent-answer-quality.integration.test.ts tests/integration/agent-plan-validation.integration.test.ts tests/integration/agent-durable-step.integration.test.ts tests/integration/agent-runtime-budget.integration.test.ts`，exit 1，21 通过/1 失败。新增综合 4 项均通过；旧用例错误地仅期待两次备忘创建的最后一条确认，实际已返回两条。已改为不同标题并验证全部确认，保留请求者、写入数量与消息幂等断言。
- 首轮 `./scripts/run-node22.sh npm run check:full`：在快速门禁阶段 exit 1，902 通过/5 失败。1 项是新增域名规范化红测试捕获未 trim 的输入（随后修复）；4 项是旧 task-claim 夹具缺少数据库必有的 createdAt，导致参考时间读取失败。补齐夹具固定创建时间后，`./scripts/run-node22.sh npm exec -- vitest run tests/agent/task-claim.test.ts tests/agent/search-tool.test.ts` exit 0，2 文件/32 项。失败轮未进入构建、覆盖率、集成或浏览器阶段。

- 独立复核补齐来源校验（带标题链接、引用定义、协议相对链接、本地工具真实 URL）和上海凌晨发布时间比较；新增边界先 5 失败/10 通过，修复后证据/Provider/计划三文件 77 项通过，typecheck 与定向 lint 通过。
- 第二轮 `./scripts/run-node22.sh npm run check:full` exit 1：快速与覆盖率均为 95 文件/915 项；生产构建通过；覆盖率 statements 57.18%、branches 52.58%、functions 61.94%、lines 57.68%；真实 PostgreSQL 39 文件/162 项通过。生产 Playwright 56 通过/2 失败，新工具质量双轮旅程通过。失败分别是既有 3D 拖拽短时 tooltip 在断言时不存在，以及私聊删除仍期待规划草稿文案。后者改为真实删除确认并断言草稿未出现，保留审批、数据库删除和隔离检查。
- `E2E_APP_MODE=production ./scripts/run-node22.sh npm run test:e2e -- tests/e2e/agent-entry-authenticated.spec.ts --grep '拖拽超过阈值才移动|两位用户的私聊持久隔离'` exit 1：2 通过/1 失败（含 setup），私聊删除已通过，既有拖拽仍失败在 `:329`。未修改拖拽产品或测试。
- `E2E_SOFTWARE_WEBGL=true E2E_APP_MODE=production ./scripts/run-node22.sh npm run test:e2e -- tests/e2e/agent-entry-authenticated.spec.ts --grep '拖拽超过阈值才移动' --trace on` exit 0，2/2（含 setup，拖拽 19.8s）。仓库已有软件 WebGL 模式下原断言通过；默认渲染模式的短时 tooltip 失败仍保留为环境差异证据，不据此推断产品已修复或全部默认 GPU 均可用。随后启动 `E2E_SOFTWARE_WEBGL=true ./scripts/run-node22.sh npm run check:full` 做完整验收。

- 最终 `E2E_SOFTWARE_WEBGL=true ./scripts/run-node22.sh npm run check:full` **exit 0**：快速与覆盖率均为 95 文件/915 项，生产构建通过，覆盖率 57.18/52.58/61.94/57.68；真实 PostgreSQL 39 文件/162 项（159.69s）；生产 Playwright **58/58（6.6m，无 skip/retry）**。新双轮工具质量旅程 5.3s，既有拖拽原断言 18.1s，私聊删除 19.4s。软件 WebGL 是已有验证配置，未改产品、放宽超时或跳过测试。默认渲染模式的失败不改写成通过。
- 构建自动改写的 `next-env.d.ts` 两条类型引用还原为原有 `.next/dev/types/*` 后，`./scripts/run-node22.sh npm run typecheck` exit 0。
- 本轮没有改 Worker 启动/部署路径，未运行 Compose smoke、Compose 构建或部署重启；没有新增依赖或数据库迁移。QAM 模块未重新评分。真实账户权限和真实模型抽样的未验证范围见上文，不将受控 HTTP 结果写成线上事实核验。

feat-083 已同步为 done；最终结构检查和工件清理记录见 [feat-083 验收证据](../../feature_list.json)。
