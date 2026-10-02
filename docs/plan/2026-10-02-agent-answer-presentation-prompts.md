# Agent 回答呈现与提示词优化方案

登记日期：2026-10-02。对应 feat-108。用户随后授权实施；当前实现和评估结果见文末，最终状态以 feature_list.json 为准。用户已选择 A：正文简洁，消息底部提供默认折叠的“参考来源”；同时要求抽象或删除过于具体的天气、台风、旅游提示，更多使用模型自身的判断能力。

本项由 QAM-08 负责规划、综合、证据和降级答复，QAM-02 负责消息投影与呈现。前置 feat-080、feat-083 均已完成，记录位于 [第二批归档](../harness/archive/features-batch-002.json)；当前验收入口是 [feature_list.json](../../feature_list.json)。用户提供的活动回复仅作为表达问题的案例，没有重新核实活动、票务或天气事实，也没有据此判断实际出行条件。

## 实施前问题与目标

实施前的回复把答案、核验说明、来源元数据和部分工具过程混合在正文中。目标是让正文直接满足用户的问题，让来源支持按需核验，让运行记录支持排障；关键缺口和不确定性仍在相关结论附近说明。下表记录改动前的机制，链接指向对应职责文件，当前实现见文末。

| 已确认机制 | 对体验的影响 | 源码证据 |
| --- | --- | --- |
| 综合提示要求每条外部事实附近提供链接和日期，要求反映 warnings，并指定天气、台风、旅游的答复结构 | 容易产生密集引用、机械分节和额外话题 | [LLM provider](../../agent/llm-provider.ts) |
| 证据构建为每次天气调用添加台风与旅游限制，为早于参考日的资料添加警告，并为普通日期范围添加说明 | 内部检查事项容易进入正文；发布时间较早本身不等于内容失效 | [证据构建和降级](../../agent/answer-evidence.ts) |
| 查询综合仅返回 text；消息界面直接显示 content，没有独立来源展示 | 标题链接也会作为文本显示，来源没有自己的位置 | [类型](../../agent/types.ts)、[共享聊天](../../components/chat/MessageList.tsx)、[私聊弹窗](../../components/agent-entry/AgentConversationDialog.tsx)、[学习页聊天](../../components/study/MiniRoomChat.tsx) |
| 综合失败后按工具列出结果、搜索链接和时间 | 正常综合提示词的改进无法覆盖失败降级 | [Runtime](../../agent/agent-runtime.ts)、[降级渲染](../../agent/answer-evidence.ts) |

以上是静态实现证据，不代表已经取得案例对应的生产 Trace，也不能据此确定该回复走了哪条运行分支。feat-083 对真实结果、日期覆盖、多次调用和恢复语义的修复继续作为正确性基线。

## 官方实践与本项目选择

OpenAI 的推理模型指南建议指令简洁直接、明确目标和约束，优先尝试不带示例的提示。这支持减少场景教程，但该建议有模型适用范围。[Reasoning best practices](https://developers.openai.com/api/docs/guides/reasoning-best-practices)

工具仍应清楚说明用途、参数和输出含义，能确定执行的工作交给代码。这支持将产品工具契约与通用回答原则分别维护。[Function calling](https://developers.openai.com/api/docs/guides/function-calling)

提示词适合作为代码管理，采用命名模块、明确动态输入并随产品改动评估。本项目继续使用现有 provider 协议，在仓库内整理提示词职责。[Prompting](https://developers.openai.com/api/docs/guides/prompting)

评估应包含典型、边界和对抗案例，比较输出并结合人工判断。本项目采用固定工具快照做消融对照，判断哪些规则确实改善效果。[Evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices)

上述分层是结合官方原则与当前实现提出的项目方案。仓库 [默认配置](../../lib/env.ts) 和 [.env.example](../../.env.example) 均写 `gpt-4.1-mini`，本地实际配置已核实为 openai-compatible / deepseek-v4-flash，真实评估使用 api.deepseek.com；未核实生产部署配置，不能将某类推理模型的建议直接当作当前模型的效果保证。本项不包含模型升级、API 迁移或新增一轮润色调用。

## 提示词与程序的职责

| 位置 | 保留内容 | 调整方式 |
| --- | --- | --- |
| 通用行为提示 | 中文自然回答、用户目标与范围、证据与结论相符、关键不确定性 | 删除天气、台风、旅游等命名场景和历史失败示例，不规定固定章节或默认条目数量 |
| 规划阶段 | 当前身份与房间边界、所需信息与动作、可用工具、结构化计划契约 | 根据缺少什么信息选择工具；去掉重复的工具教程；无工具聊天仍按通用风格回答 |
| 工具描述与字段 schema | 实际能力范围、参数含义、时间语义、输入限制、写入效果 | 每项约定维护在相应工具的有效契约里；跨工具统一约束留在规划层 |
| 工具结果与证据 | 状态、覆盖范围、时间、资料类型、来源标识 | 提供可判断的数据；删除对所有调用一律附加的场景化说教，只记录实际缺口和可确定的问题 |
| 最终综合阶段 | 用户当前问题、已取得结果、正文和来源关联的输出格式 | 只保留最终回答职责，不重复规划教程；按用户目标组织正文 |
| 程序 | 权限、输入输出校验、日期计算、来源解析、动作确认、预算与恢复 | 保留并复用既有确定性保障，不依赖提示词取代程序约束 |

需要保留的产品知识包括：一次性计划的 `fireAt` 与周期 `cron` 语义、记忆的作用域、本人和伙伴的显式身份、工具能提供的预报范围、搜索日期筛选的真实含义。这些是本应用的契约，模型无法凭通用知识知道。消除重复与冗长示例，不擅自改变记忆写入、计划审批或工具能力。

工具 Registry 实际使用 `z.toJSONSchema(inputSchema)` 生成交给模型的参数说明。实施时核对最终出站 `available_tools`，需要字段解释时维护有效的 Zod 描述，避免只修改会被覆盖的手写 schema。[Registry](../../agent/tool-registry.ts)、[工具契约](../../agent/tool-contracts.ts)

对用户指出的两段规则，建议这样处理：

| 现有场景规则 | 处理 |
| --- | --- |
| 未检索到台风不等于无台风，普通天气不证明无台风，不能保证适合旅游 | 删除整段。由通用的证据原则和关键不确定性要求覆盖；原案例保留为评估输入 |
| 天气、台风、旅游必须分项回答，逐日列出全部日期且不限前三天 | 删除固定组合与排版。用户明确要求逐日详情时覆盖整个范围；概览可以归纳完整范围，有数据缺口则说明 |
| 每条事实附近附链接和适用日期 | 改为提供正文与来源关联，核验元数据由界面折叠展示；影响答案的业务日期保留正文 |
| 所有 warnings 必须反映 | 删除笼统展示要求；模型根据当前问题判断哪些实际限制会影响结论 |

以下保留讨论阶段的通用行为候选文本；最终运行文本见实施记录中的 prompts.ts，它不替代单独的信任边界、工具和输出协议：

> 用自然、直接的中文回应用户当前的目标，覆盖明确提出的问题与范围，详略服从用户需求。依据可用信息作答，使结论与证据支持程度相符；仅说明影响当前答案或行动选择的关键缺口、冲突和假设。按问题组织内容，默认先给答案或建议。参考来源交由来源字段承载；用户需要访问的操作入口或明确索取的链接可以直接提供。

阶段协议继续明确：外部网页、工具返回文本和用户档案作为数据处理；只使用已提供的有效来源标识；写入完成以实际执行结果为准；综合阶段不能新增动作。身份风格与这些协议分段维护，避免再次堆成一个包含所有功能教程的长字符串。

## 来源与消息呈现

正文默认没有资料型裸 URL、逐条发布日期或工具过程说明。活动日期、地点和影响行动的风险留在正文；购票、报名、导航等实际操作链接以及用户明确索取的链接按需求提供，不用正则统一删除所有 URL。

模型输出正文及段落或结论与来源标识的关联；候选契约可使用带 `sourceIds` 的正文段落。服务端从本次实际结果生成稳定来源目录，校验关联并解析安全 HTTP(S) URL，去重后持久化。具体字段在实施时通过 Zod 定义，不让模型自行生成来源地址、发布元数据或可信度。编号存在与链接合法只能验证结构，来源是否真正支持结论仍需语义评估。

“参考来源”默认折叠，只列支撑本次答复的来源；展开后显示短标题、网站、已有的日期信息和可点击链接，并可判断来源支持哪段内容。不把全部搜索结果都冒充引用；没有来源时不展示空入口。链接和折叠控件支持键盘及可访问名称。

优先利用 `Message.metadata` 的 JSON 承载版本化的来源关联，正文继续写 `Message.content`；通过受现有授权保护的明确 DTO 输出来源字段，不把整个 `toolResults` 或执行载荷发送到 UI。覆盖全局私聊弹窗、共享 Chat 与 Study Mini Chat，刷新、历史读取、SSE/快照和任务恢复后保持一致。历史无来源元数据的消息继续正常显示，不批量改写历史正文。

综合失败、provider 不支持、格式或来源校验失败、预算不足等实际进入降级的路径也应保持正文与来源分离。写操作逐项按真实结果确认；查询资料不足时简短说明限制，避免伪造确定结论或重新展示完整检索清单。复用已有综合步骤与 checkpoint，不增加模型调用次数，不丢失工具结果或恢复时的来源关联。

## 实施顺序与验收

1. 固定旧版本输入输出契约和评估集，核实实际使用的 provider/model/参数，提取基线。评估输入使用合成或脱敏的固定工具结果，保留相同参考时间和上下文。
2. 整理规划与综合提示词、有效工具说明和证据元数据，加入正文与来源关联的校验及持久化，覆盖全部相关降级和旧 checkpoint 兼容路径。
3. 完成各消息入口的来源投影与默认折叠展示，验证链接、键盘、历史消息及私聊/共享隔离。
4. 在相同模型与参数下比较旧版本、通用精简版，以及在精简版基础上进一步删除通用证据提醒的版本。固定结果综合与完整规划链路分别评估，避免把检索结果变化误判为提示词收益。多次采样并保留未用于调整提示词的案例。
5. 记录相关性、明确问题覆盖、结论与证据的一致性、关键不确定性、工具/参数正确性、写操作结果一致性、自然度与阅读负担，同时观察提示词长度、输出长度和延迟。先定义评分口径，再对照；不能靠更短或一句固定措辞作为通过标准。

评估覆盖普通活动查询、明确逐日请求、概览请求、多工具组合、同工具多次调用、追问和指代、空结果、服务失败/mock、部分覆盖、日期不明、有效期冲突、提前发布但仍有效的公告、来源冲突、恶意网页指令、操作链接、纯聊天以及写入成功/失败。天气与台风案例属于此集合的一部分；同时保留非天气案例，检验抽象后的通用性。关键错误不得回归，任何删除规则的保留或补回都需对应可复现结果；必要的局部补充放到正确契约位置。

自动化 Node/组件测试使用受控输入验证可观察行为，不能通过扫描提示词字面内容证明模型会遵循。真实 PostgreSQL 覆盖消息/来源持久化、所有权与任务恢复，生产 Playwright 覆盖各入口的折叠、展开、链接、键盘和刷新。独立的真实模型抽样评估与确定性应用门禁分开，记录模型、参数、样本和人工复核结果；缺少模型或凭据时如实记录未验证，不将 mock 通过视为真实语义效果。

实施前运行 `./scripts/run-node22.sh ./init.sh`，完成后运行 `./scripts/run-node22.sh npm run check:full`（包含标准门禁）。若进一步修改 Worker 启动或部署路径，再补风险匹配的 Compose smoke。沿用独立副本及独立 node_modules，避免干扰用户开发构建。

## 方案登记验证（实施前）

登记阶段只增加计划和待实施 feature，并重写交接。`./scripts/run-node22.sh node --input-type=module` 的只读核验 exit 0，使用 Node.js 22.23.2：根列表 14 项、归档 94 项、全局 108 个唯一 ID，计数、状态、依赖和相对链接有效，未达到归档阈值。Python SHA-256 对照确认原 13 项 feature、其他根元数据、归档、应用文件和既有 PNG 均未改动；`git diff --check` exit 0，已检查 `git status --short`。

登记阶段没有修改应用代码、依赖、构建或运行配置，按 AGENTS.md 的文档例外未运行 `./init.sh`、`npm run check`、`npm run check:full`、`npm run test:compose-smoke` 或 `npm run dev`。当时没有调用真实模型、访问业务数据库、执行外部搜索供应商测试或重新核实样例中的活动事实。该次结构核验只验收方案登记，实际实施与门禁记录如下。


## 实施记录（2026-10-02）

已实现 `Message.content` 正文与 `metadata.answerReferences` 的版本化来源关联。模型输出 `blocks[{text, sourceIds}]`；服务端从实际结果按规范化 HTTP(S) URL 建立来源目录、合并重复来源，校验后生成正文字符区间与来源关联。日期、标题和地址来自服务端目录；模型不能自行提供这些字段。来源只投影给已有授权保护的消息 DTO，不输出完整 metadata 或 toolResults。共享 Chat、Study Mini Chat、Agent 私聊使用同一个默认折叠组件，展开可读来源网站、日期和对应正文。

规划、无工具回复和综合共用简短行为原则，职责维护在 [prompts.ts](../../agent/prompts.ts)。已删除领域组合教程、强制展示所有 warnings、每条事实旁放链接以及固定日期示例。工具输入含义通过 Registry 实际使用的 Zod 描述传递；保留一次性/周期计划、记忆作用域和显式身份契约。证据构建保留每次调用和原始时间/日期缺口，不再自动将早发布资料判为过期。保留预算、输入输出校验、审批、提示注入边界和 Trace。

综合和最终消息复用原有 checkpoint。新记录持久化引用，旧的仅含 text 的 checkpoint 和历史消息继续兼容；恢复不重复工具写入、模型综合或最终消息。provider 失败/不支持、无效来源和预算不足均使用相同的正文/来源边界。降级只引用能直接支撑已知内容的来源，未完成综合的搜索结果不整页倾倒给用户。纯写入依实际成功标识确认，也修正了内容本身已有句号时的双句号。

没有数据库迁移、依赖升级、模型切换、API 迁移、自动补查或额外润色调用，没有更改 Worker/部署路径。

### 真实模型对照

本地配置：`openai-compatible`，请求模型 `deepseek-v4-flash`，端点主机 `api.deepseek.com`；`temperature=0.2`、`max_completion_tokens=8192`、超时 20000ms。评估发送仓库中的合成上下文和固定工具快照，不读取业务数据库、不向模型发送真实用户档案，也不验证用户原样例里的活动是否真实。模型后端的内部修订版本未提供，本记录只确认实际请求配置。

评分口径在 [案例](../../tests/evals/agent-answer/cases.ts) 中预先定义，覆盖相关性、范围、证据、关键不确定性、工具与参数、真实写入确认、自然度和阅读负担。每个版本为 12 个固定综合案例和 6 个规划案例，各采样两次；规划与综合分别计分，不把外部检索变化当成提示词收益。最初对照旧版、通用精简版、进一步删除通用证据原则版；根据对照调整通用表达，未加入新的领域教程。主对照中最初标为 held-out 的案例结果也参与过选型，不能视为最终独立验证；最终冻结后另加 validation 集，单独报告。旧基线出站快照在 [legacy-requests.json](../../tests/evals/agent-answer/legacy-requests.json)，最终出站快照在 [final-requests.json](evidence/feat-108/final-requests.json)。

| 版本 | 结构校验 | 有效综合正文平均字符 | 正文URL总数 | 平均请求耗时 |
| --- | --- | --- | --- | --- |
| 旧版 | 33/36 | 246 | 24 | 2867ms |
| 初始通用精简版 | 36/36 | 131 | 4 | 2904ms |
| 初始精简版删除通用证据原则 | 36/36 | 130 | 3 | 2261ms |
| 最终通用精简版 | 36/36 | 103 | 2 | 2510ms |
| 最终精简版删除通用证据原则（补充对照） | 36/36 | 85 | 2 | 2421ms |

最终两个正文 URL 均来自明确索要报名链接的案例；其余引用在来源字段中。系统提示文本长度由规划 3188→813 字符、综合 945→601 字符；包含工具定义和输入的规划请求平均 16496→12459 字符。字数与延迟仅为辅助观察：旧版有 2 个无效 JSON 和 1 个链接解析失败，正文均值只计算有效综合输出，不能把这些数字当作准确率或性能承诺。[完整结构度量](evidence/feat-108/metrics.json)

最终稿冻结后新增 4 个独立验证案例（各两次），验证旧停运公告、冲突票价、19点已过入场时间、网页伪指令，8/8 结构与关键行为通过；它们没有用于继续调整提示词。另以真实模型规划、合成工具适配、实际 Zod 校验和真实模型综合完成 6 类工作流各两次，12/12 完成；涵盖无工具、查询组合、一次性/周期提醒和记忆归属。真实工具权限、数据库副作用及恢复另由应用集成/E2E 验证，合成工作流不替代它们。[独立样本](evidence/feat-108/validation.json)、[工作流](evidence/feat-108/workflow-final.json)

保留通用证据原则：删除版出现“19点仍可参观17点已闭馆展览”等错误，冲突和综合建议也更容易作过强判断。最终稿仍会偶尔附带发布日期或被排除活动；一个报名样本将展期转述成报名期，说明来源编号合法不等于每句转述精确。已逐项记录这些限制，未宣称模型事实准确率为100%，也未声称完成独立人工评审或线上A/B。[语义复核与限制](evidence/feat-108/semantic-review.json)

收尾补充了与最终稿完全匹配的删除原则对照，同样18题各两次。逐条断言36次出站消息的唯一变化是删除 `EVIDENCE_GUIDANCE`，工具、案例、协议与参数相同；请求快照和哈希均保留。这一版多数案例仍能处理缺口、冲突、网页伪指令和失败写入，但有一条在缺少当前风险证据时断言“整体没有极端天气”，两条将展期转述为报名期。继续选择保留通用原则的最终稿，没有继续修改提示词；样本量不足以证明统计显著优势。中间候选未逐版归档完整出站请求，不能据其输出文件声称可逐字重放所有历史候选；补充对照用于补齐最终取舍的复现边界。[匹配核验与度量](evidence/feat-108/matched-ablation.json)、[消融输出](evidence/feat-108/minimal-final.json)、[出站快照](evidence/feat-108/minimal-final-requests.json)

可复现命令（真实模型评估会消耗已配置供应商额度，应用 CI 不自动调用）：

```bash
./scripts/run-node22.sh node --env-file=.env --import tsx scripts/eval-agent-answers.ts legacy /tmp/agent-legacy.jsonl
./scripts/run-node22.sh node --env-file=.env --import tsx scripts/eval-agent-answers.ts concise /tmp/agent-concise.jsonl
./scripts/run-node22.sh node --env-file=.env --import tsx scripts/eval-agent-answers.ts minimal /tmp/agent-minimal.jsonl
./scripts/run-node22.sh node --env-file=.env --import tsx scripts/eval-agent-answers.ts concise /tmp/agent-validation.jsonl validation
./scripts/run-node22.sh node --env-file=.env --import tsx scripts/eval-agent-workflow.ts /tmp/agent-workflow.jsonl
./scripts/run-node22.sh node --import tsx scripts/summarize-agent-eval.ts
```

上述命令默认重跑 18 个主对照案例，validation 参数单独运行新增独立题；concise/minimal 使用当前提示词，不会恢复中间候选。已保留全部合成模型输出，包括中间候选和首次工作流适配错误。初次工作流适配缺少搜索 `score` 与 `schedule.list` 返回，5 个样本未完成；补齐工具契约后复核全部通过，没有执行真实写入。

### 应用验证与收尾

验证在 `/tmp/xoxo-feat108-Xi0xdK` 的独立源码/独立 node_modules 中执行，未复制真实 `.env`，不改动用户开发构建产物。实施前 `./scripts/run-node22.sh ./init.sh` exit 0：106 文件/1007 项 Node/组件测试。

- 定向 `npx vitest run`：4 文件/50 项通过，覆盖来源去重、范围、旧资料、无效/危险链接、mock、失败降级、元数据投影和折叠展示。
- 定向真实 PostgreSQL：`sudo -n -g docker -u dadalv ./scripts/run-node22.sh npm run test:integration -- tests/integration/agent-answer-references.integration.test.ts tests/integration/chat-message-read-model.integration.test.ts tests/integration/agent-private-conversation.integration.test.ts tests/integration/agent-answer-quality.integration.test.ts` exit 0，4 文件/28 项通过；覆盖 GET/初始快照/SSE、私聊所有权、预算/失败/不支持/无效来源、Final 失权恢复和副作用去重。
- 第一轮 `./scripts/run-node22.sh npm run check:quick` 与集成测试并行时 exit 1：18 项组件断言超时/受超时连带影响，另 1 项仍断言旧英文工具描述。宿主交换空间当时用满。修正旧文案绑定后，以 `VITEST_MAX_WORKERS=1 ./scripts/run-node22.sh npm test` 单进程复核 exit 0，108 文件/1025 项通过；未增大用例超时、未跳过测试。
- 首轮 `sudo -n -g docker -u dadalv ./scripts/run-node22.sh env VITEST_MAX_WORKERS=1 E2E_SOFTWARE_WEBGL=true npm run check:full` exit 1：生产构建、覆盖率、108 文件/1025 项 Node/组件及 45 文件/199 项 PostgreSQL 通过；生产浏览器 122/123 通过。唯一失败是新增三入口测试 `getByRole('link', { name: 'shared（新窗口打开）' })` 找不到元素，实际可访问名称为 `shared （新窗口打开）`。已按完整名称、允许规范化空白校准查询，保留键盘、链接、刷新和权限断言。最终定向与完整浏览器复核均通过，见下文。
- 第二轮 `sudo -n -g docker -u dadalv ./scripts/run-node22.sh env VITEST_MAX_WORKERS=1 CIRCLE_NODE_TOTAL=4 E2E_SOFTWARE_WEBGL=true npm run check:full` exit 1：最终代码的 108 文件/1027 项 Node/组件、生产构建、覆盖率和 45 文件/199 项 PostgreSQL 均通过；E2E 生产服务构建出现 `read ECONNRESET` / `socket hang up`，最终 `Timed out waiting 600000ms from config.webServer`，本轮未进入浏览器断言。核对环境确认普通 shell 有代理变量，sudo 用户组边界清除了它们；保留既有代理后同一字体 CSS 请求返回 HTTP 200。后续仅在验证命令上保留这些网络变量，不改变字体、应用或测试配置，也不使用模拟字体替代生产构建。

- 定向生产浏览器：保留代理后运行 `sudo -n --preserve-env=HTTP_PROXY,HTTPS_PROXY,http_proxy,https_proxy,NO_PROXY,no_proxy -g docker -u dadalv ./scripts/run-node22.sh env VITEST_MAX_WORKERS=1 CIRCLE_NODE_TOTAL=4 E2E_SOFTWARE_WEBGL=true npm run test:e2e:production -- tests/e2e/agent-answer-quality.spec.ts` exit 0，3/3 通过（含 setup），覆盖实际工具至答复与全部三个入口。
- 最终完整门禁：以下命令 exit 0，类型、lint、生产构建与覆盖率通过；108 文件/1027 项 Node/组件、45 文件/199 项真实 PostgreSQL、123 项生产 Playwright 全部通过。覆盖率为语句54.55%、分支48.55%、函数58.90%、行55.71%。[应用验证与源码指纹](evidence/feat-108/application-verification.json)

```bash
sudo -n --preserve-env=HTTP_PROXY,HTTPS_PROXY,http_proxy,https_proxy,NO_PROXY,no_proxy -g docker -u dadalv ./scripts/run-node22.sh env VITEST_MAX_WORKERS=1 CIRCLE_NODE_TOTAL=4 E2E_SOFTWARE_WEBGL=true npm run check:full
```

上述并发和代理变量仅作用于该命令；`VITEST_MAX_WORKERS=1` 保持集成串行，`CIRCLE_NODE_TOTAL=4` 使当前 Next 构建使用3个静态页 worker，浏览器仍用原配置的1个 worker、0次重试。未修改检查门槛、测试超时、应用配置或字体资源。

最终验证后比对34个改动代码/测试文件与独立副本SHA-256完全一致。已清理31项本轮临时工件，包括独立副本、临时原始评估JSONL、日志和测试报告；E2E临时目录与Testcontainers均已回收。仓库内合成评估输出、请求快照和复核记录作为长期证据保留。原有13项feature与用户PNG保留。收尾只读账本核验首次使用固定预期14时得到 `15 !== 14`：工作区同时新增了feat-109及一张PNG。已完整保留这些改动，并同步记录根15项、归档94项、全局109个唯一ID；不触发归档。这是并行状态登记变化，应用源码指纹继续单独复核。

feat-108 已完成。没有提交、推送或部署；未改 Worker 启动或部署路径，因此未追加 Compose smoke；未启动或重启用户开发服务。功能状态和下一会话恢复说明分别更新至 feature_list.json 与 session-handoff.md。

收尾 `./scripts/run-node22.sh node --input-type=module` 只读核验 exit 0：15/94/109计数、全局ID、状态/依赖、30个相对链接、评估JSON、34份源码指纹及匹配消融参数通过；`git diff --check` exit 0，已检查 `git status --short`。本轮临时路径与测试容器无残留。
