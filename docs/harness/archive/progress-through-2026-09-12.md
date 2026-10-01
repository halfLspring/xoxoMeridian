## 2026-09-12 — feat-053 完成（QAM-08-005 resolved）

### 交付与范围

- 按顺序读取四份启动文件，确认 feat-018/019/050 均 done 后，只将排名第 3 的 feat-053 标为 in-progress，再运行 `./init.sh`。沿用已登记的修复与验收标准，通过 `superpowers:brainstorming` 核对有界方案，使用 QAM-08 审查 Skill 维护问题/证据，使用 `harness-creator` 维护会话状态；会话前 feat-051/052 的用户改动完整保留。
- 新增 [`agent/plan-contract.ts`](../../../agent/plan-contract.ts)：外部 snake_case 仅映射字段名，不过滤动作或补默认值；与 Task.plan、completed Plan checkpoint、语义 repair 结果共用 Zod 结构及实际 Registry input schema。校验有限 confidence 0..1、Tool 名称/当前 trigger 允许集合、必需参数、全部批次、输入/动作对应；拒绝重复 Tool、空调用数组和孤立输入。
- Provider 与 Runtime 共用同一 Registry 实例；权威 completed checkpoint 在 Step 恢复冲突检查前重验，以便 Registry/trigger 漂移留下明确 validation 原因。已存在的非法计划不会被当成无计划重新调用 LLM；整份计划通过后才开始任何新 Tool Step，避免合法前缀先写入。合法零 Tool、批次、已完成 Tool 重放和请求者身份保持。
- 类型化 `AgentPlanValidationError` 只记录固定错误码、顶层/调用位置及 schema code，最多 8 项，错误字符串最多 512 字符，不复制任意 Tool 名称、输入值或 Zod 错误正文。Task/Message 明确 failed，活动 Step 的 errorCategory 为 validation，记录 `agent.plan.validation.failed`；最终正文告知“任务未完成”，不复用原模型的完成声明。旧 completed Step 保留原证据，不回滚历史 attempt 已提交的合法副作用。
- 改动共 14 个文件：4 个 Agent 实现文件；新增 Node/集成测试和 E2E 子进程入口、更新既有 Runtime 与 authenticated 测试共 5 个测试文件；QAM-08 报告/总览和状态文件。未新增 Tool、修改 Route、Prisma schema/migration、依赖、部署、后处理或 LLM transport；QAM-08-001～004 保持独立。

### 负向对照与专项验证

- Node.js v22.23.2 / npm 10.9.8；启动 `./init.sh` exit 0，Prisma generate、资产、类型、lint 和 73 文件/496 项 Vitest 全部通过。Docker 可直接使用，无权限对照阻塞。
- 原始命令 `./scripts/run-node22.sh npm run test:unit -- tests/agent/plan-contract.test.ts`：旧实现 exit 1，25 failed/4 passed（初版将相同非法案例的 persisted/external 断言合在一项）。复现置信度/字段/Tool/输入缺陷、非法 JSON/根结构和允许集合未校验。最终拆开两入口断言，并补当前 Registry schema 替换，新增 45/45；`./scripts/run-node22.sh npm run test:unit -- tests/agent/plan-contract.test.ts tests/agent/agent-runtime.test.ts tests/agent/task-claim.test.ts tests/agent/plan-validator.test.ts tests/agent/plan-repair.test.ts` exit 0，5 文件/79 项。
- 原始命令 `./scripts/run-node22.sh npm run test:integration -- tests/integration/agent-plan-validation.integration.test.ts`：旧实现 exit 1，11 failed/1 passed。其中 10 项缺陷场景失败：空调用数组错误 completed，未知或后续非法动作让合法前缀先写入，恢复漂移缺明确 validation 结果等；另外 1 项合法恢复用例误把原模型文本作为最终回复，实际沿用既有 Memo renderer 的“备忘录已保存：新的备忘录。”。只修正该测试预期，没有为其改变回复逻辑。
- 修复后 `./scripts/run-node22.sh npm run test:integration -- tests/integration/agent-plan-validation.integration.test.ts tests/integration/agent-durable-step.integration.test.ts tests/integration/agent-requester-memory.integration.test.ts tests/integration/agent-runtime-budget.integration.test.ts` exit 0，4 文件/21 项，其中新增 12/12。使用真实 PostgreSQL 验证移除 Tool、旧参数名、scheduled.job trigger 漂移、checkpoint 权威、非法 live/retry、零新 Tool/业务写入，以及合法批次重放、请求者和最终 Message/Trace；仅 Planner 外部边界使用可控替身。
- 开发期 `./scripts/run-node22.sh npm run typecheck` 首次 exit 2：新集成测试把含 `Record<string, unknown>` 的测试 plan 直接写入 Prisma JSON，TS2322；补显式 `Prisma.InputJsonObject` 后 typecheck/lint exit 0，完整门禁再次通过。
- 浏览器三轮原始命令均为 `./scripts/run-node22.sh npm run test:e2e -- tests/e2e/authenticated.spec.ts --grep 'invalid Agent plan'`。首轮 exit 1（setup 通过、共 31.5s），在 response.ok 处失败，测试写请求未携带 Proxy 要求的 Origin；补齐后第二轮仍 exit 1，E2E Web 的 inline 关闭且启动器没有常驻 Worker，测试没有触发实际执行。新增隔离子进程入口只消费本例的 taskId，不更改产品执行配置；第三轮 exit 0，2/2（34.8s）。
- 最终浏览器通过受认证真实 API 入队、独立 Node 进程执行真实 Runtime、真实 SSE 和 reload，验证错误正文、失败 badge、持久 Task/Message、零 ToolCall/Memo 及成员 Trace；没有伪造成功响应或直接写入任务终态。不将该证据称为常驻 Worker 调度或 Compose 验收。

### 完整门禁与复审

- 最终 `./scripts/run-node22.sh npm run check:full` **单次 exit 0**：资产、TypeScript、ESLint、**74 文件/541 项 Vitest**、Next.js 16.3.3 production build、覆盖率、**25 文件/87 项真实 PostgreSQL** 和 **33/33 Playwright**（4.0 分钟，0 failed/flaky/skipped）。覆盖率 statements **49.00%**、branches **43.61%**、functions **53.54%**、lines **49.68%**，没有修改门槛。命令已经包含 `npm run check`，通过后未重复测试。
- 浏览器现有故障注入期间出现 destination stream closed early、About 图像资源及 THREE.Clock deprecation 等 stderr，未造成测试失败；本轮未扩展这些既有路径。未改启动/部署路径，`npm run test:compose-smoke` 未运行，不声称新增部署验收；启动基线为本轮成功的 `./init.sh`。
- QAM-08-005 resolved；抽象与复用、健壮性各 +1，QAM-08 **82/L2**（Score L3、Gate/Final L2），组合均分 **84.3**。其他评分维度和未验证的 crash/post-task/Trace/shutdown 边界保持。
- 复核中另发现 **QAM-08-007**：语义 repair 无法解决 `one_shot_promise_without_create` 时，`buildClarifyPlan()` 返回零 Tool 计划，却固定回复“之前那个已经帮你取消了”。该根因为语义澄清输出与执行事实不符，独立登记 **feat-061/not-started**，仅有源码/既有测试的 E2，未执行其 PostgreSQL/浏览器场景，未在本次修复。QAM-08 开放 P2 仍为 5，组合开放 P0×0/P1×0/P2×36，原前十项顺序不变。

### 清理与恢复

- 本轮 coverage、playwright-report、test-results（含临时认证状态）与 `/tmp/xoxo-feat053-*` 日志已清理；开发期失败原始命令、结果和原因保留在本节，不保留失败诊断工件。隔离数据库/容器/测试服务已退出，仅剩会话前既有健康 `xoxo-meridian-postgres`；`.next` 缓存保留，`next-env.d.ts` 无差异。
- 状态记录写回后，共 61 个 feature：done×53、not-started×8，无 in-progress/blocked。Harness validator exit 0、100/100，五个子系统均 5/5；JSON/连续 ID/单 feature 状态/依赖/原排名、前 50 项与 HEAD 一致、QAM 十维与总览算术、报告链接及工件清理断言全部通过。`git diff --check` exit 0，`git status --short` 已复核；未提交 Git commit 或部署，既有用户源码、测试和其他 QAM 报告未覆盖。
- clean restart：依次读取 AGENTS.md、feature_list.json、本交接；用 `./scripts/run-node22.sh` 校验 Node 22.23.2/npm 10.9.8。确认 feat-053 done、feat-054 的 feat-044 依赖和验收标准，只将 feat-054 标为 in-progress，再运行 `./init.sh`。
- 唯一推荐下一步：开始已登记排名第 4 的 **feat-054（QAM-03-006，计划小时、分钟与时区控件缺少可访问名称）**；feat-061 保持独立登记，不自动插队。

## 2026-09-12 — feat-052 完成（QAM-06-007 resolved）

### 交付与范围

- 按顺序读取四份启动文件，确认 feat-029/048 均 done 后，只将排名第 2 的 feat-052 标为 in-progress。沿用登记的修复与验收方案，通过 `superpowers:brainstorming` 核对有界范围，使用 QAM-06 审查 Skill 维护稳定 ID/证据，使用 `harness-creator` 维护状态闭环；没有启动其他 P2。
- 新增 [`useHomeBoardMutations`](../../../components/home/useHomeBoardMutations.ts)：照片位置、大小、标注共用 per-photo 串行 PATCH，后续同名字段取最新值，失败字段与后续不同字段合并保留；仅 2xx 清除待保存状态，失败明确显示 alert 和重试。成功响应不重放整个 element，以免覆盖后续编辑或在途拖动；caption 显示与提交同时沿用服务端 trim 语义。
- 照片 DELETE 等待在途 PATCH，删除确认前保留照片及关联连线；删除失败后可重试，未确认的编辑仍保留。连线 DELETE 同样只在 2xx 后移除；照片成功删除会清除对应连线操作，迟到的连接失败不能复活错误提示。删除进行中阻止同一照片的后续交互，卸载后不继续派发排队操作。
- `HomeTimelineBoard` 负责装配和反馈，`HomeSpatialLayer` 传递删除状态；`HomePhotoElement` 增加唯一 label、删除/缩放可访问名称、键盘方向键缩放和重新进入编辑时的当前标注；`HomeConnectionLayer` 支持具名键盘删除，`app/globals.css` 让缩放焦点可见。
- 改动范围共 14 个文件：上述 6 个实现文件，新增组件/真实 PostgreSQL 测试、扩展 `tests/e2e/authenticated.spec.ts`，QAM-06 报告与总览、状态记录。未修改服务端 Route、Prisma schema/migration、依赖、存储适配层、Home 协作协议或旧 Atlas SSE。会话前 feat-051 的代码、测试、报告和已登记 P2 内容均保留。

### 负向对照与专项验证

- 启动 `./init.sh` exit 0：Prisma generate、两主题资产、类型、lint 和 72 文件/482 项 Vitest 通过；Node.js 22.23.2 / npm 10.9.8，当前 Docker 可直接使用，无权限边界阻塞。
- 修复前 `./scripts/run-node22.sh npm run test:component -- tests/component/home-timeline-board-mutations.test.tsx` exit 1、12/12 failed：四种操作的 500/网络拒绝均 `Unable to find role="alert"`；连续编辑实际同时发出 3 个 PATCH，预期只有 1 个在途请求；DELETE 越过在途 PATCH；连线缺少可访问按钮。修复后扩展延迟成功/失败与照片级联后的迟到连接响应，最终定向命令 `./scripts/run-node22.sh npm run test:component -- tests/component/home-timeline-board-mutations.test.tsx tests/component/home-timeline-board-drag.test.tsx tests/component/home-timeline-board-search.test.tsx` exit 0、3 文件/18 项（新增 14、既有 4）。
- 首轮 `./scripts/run-node22.sh npm run test:integration -- tests/integration/home-mutation-persistence.integration.test.ts tests/integration/home-drag-persistence.integration.test.ts tests/integration/home-board-authorization.integration.test.ts tests/integration/atlas-board-scope.integration.test.ts` exit 1、6 passed/2 failed：新 resize/caption 测试在成功重试后按数组顺序比较连线，但 snapshot 没有连线排序契约，实际只是相同两条记录的顺序不同。测试改为按 ID 比较完整记录集合，并修正 snapshot 调用为显式 boardId/userId，未修改产品查询或排序。
- 修正后 `./scripts/run-node22.sh npm run test:integration -- tests/integration/home-mutation-persistence.integration.test.ts` exit 0、4/4。真实 PostgreSQL trigger 分别让大小/标注 UPDATE、照片/连线 DELETE 抛错，实际 Route 返回 500，重读 snapshot 保持原记录；移除 trigger 后同请求 200，尺寸/trim 标注一致，照片级联只删除关联连线，其他照片/连线保留，DELETE 重放 404 且终态不变。既有双进程拖动、Home 授权和 Atlas board scope 共 3 文件/4 项在前一 bundle 已通过，完整门禁将再次覆盖。
- 类型检查开发期 `./scripts/run-node22.sh npm run typecheck && ./scripts/run-node22.sh npm run lint` 曾 exit 2：先是 await 后可变队列被 TypeScript 窄化为 null 及 Testing Library 不支持 `exact`，随后是新集成测试错误传入 string 而非 HomeBoardAccessScope。修正为从 Map 读取最新 pending、移除不支持的测试选项、传入显式 scope；首轮 lint exit 0 但报告缺少 setConnections 依赖，补齐后同命令 exit 0、0 warning/error。
- 浏览器原始命令均为 `./scripts/run-node22.sh npm run test:e2e -- tests/e2e/authenticated.spec.ts --grep 'retries Home photo'`：首次 exit 1、setup 通过，照片中心被连线点击区域覆盖，`locator.hover` 在 120000ms 超时；改为照片角落后第二次 exit 1、25.8s，`getByRole('alert')` 同时匹配实际错误提示与 Next.js 空白 route announcer。限定操作反馈查询后，原命令 exit 0、2/2（setup + 旅程，35.8s），无需修改产品逻辑绕过测试。
- 最终 Chromium 使用真实指针缩放、键盘标注/重试/删除，注入 HTTP 500 与 connectionreset，再放行真实请求；四种操作均失败可恢复，成功后逐次 reload，UI 与隔离 PostgreSQL 尺寸、caption、照片、关联连线一致。使用真实 API、数据库和级联，不伪造成功响应或 snapshot。

### 完整门禁与复审

- 最终 `./scripts/run-node22.sh npm run check:full` **单次 exit 0**：两主题资产、TypeScript、ESLint（0 warning/error）、73 文件/496 项 Vitest、Next.js 16.3.3 production build、覆盖率门槛、**24 文件/75 项真实 PostgreSQL** 和 **32/32 Playwright**（4.3 分钟，0 failed/flaky/skipped）。覆盖率 statements **47.76%**、branches **42.59%**、functions **52.56%**、lines **48.54%**，未修改门槛；该命令包含 `npm run check`，不另行重复门禁。
- 本次未修改启动或部署路径，`npm run test:compose-smoke` 未运行；数据写入/级联/授权与关键编辑旅程由完整门禁覆盖，不声称新增 Compose 验收。启动脚本未改，启动基线为本轮实际成功的 `./init.sh`。
- `feat-052` 标记 done；总计 done×52、not-started×8，无 in-progress/blocked。`QAM-06-007` resolved，QAM-06 **79/L2**：结构 +1、复用 +1、状态一致性 +1、健壮性 +2；Gate 仍受 Atlas SSE 与 DB/blob 证据缺口约束，其他五个 P2 保持开放。总览均分 **84.1**，开放 **P0×0/P1×0/P2×36**，历史评分不改写。

### 清理与恢复

- 本轮 `coverage/`、`playwright-report/`、`test-results/`（含临时认证状态）、`/tmp/xoxo-feat052-*.log` 和报告草稿已清理；开发期原始失败命令、结果与原因保留在上节，不保留失败诊断工件。Testcontainers、测试数据库/目录与临时 Next 服务自动退出，仅保留会话前既有健康 `xoxo-meridian-postgres` 与 `.next` 缓存；`next-env.d.ts` 无差异。
- Harness 结构验证 100/100；JSON、单 feature 状态/依赖/排名、QAM-06 十维合计/总览算术、报告链接、`git diff --check` 与 `git status --short` 复核通过。前 50 条 feature 与 HEAD 一致，其余已登记项仅 feat-052 的状态/证据变化；feat-051 的用户未提交代码/测试/报告与其他 P2 登记全部保留。本轮没有 Git commit 或部署。
- clean restart：依次阅读四份启动文件，用 `./scripts/run-node22.sh` 校验 Node.js 22.23.2/npm 10.9.8；确认 feat-052 done 以及 feat-053 的依赖/验收后，只将 feat-053 标为 in-progress，再运行 `./init.sh`。
- 唯一推荐下一步：开始已登记排名第 3 的 **feat-053（QAM-08-005，Agent 非法计划被静默忽略后误报完成）**，先补 Planner 输出与持久化恢复计划的非法输入行为回归。

## 2026-09-12 — feat-051 完成（QAM-02-002 resolved）

### 交付与范围

- 按顺序读取 `AGENTS.md`、`feature_list.json` 和 `session-handoff.md`，确认 feat-036/037 均 done 后，只将优先级第 1 的 feat-051 标为 in-progress。沿用已登记的修复/验收方案，用 `superpowers:brainstorming` 核对有界范围，用 `xoxo-qam-02-room-message-review` 维护问题 ID、责任边界与 E3 证据；原有前 50 项及其 done 状态、其余九项 P2 的排序/验收均保留。
- 新增 [`lib/chat-messages.ts`](../../../lib/chat-messages.ts)：GET 与 [`getRoomSnapshot()`](../../../lib/room-snapshot.ts)（SSR/SSE/Study）共用显式消息和 Task/Tool/LLM select，以 `(createdAt desc,id desc)` 取最新 80 条，再反转升序并统一日期序列化；Tool/LLM 摘要也有稳定第二排序键。完整 AgentTask input/plan/result、Tool input/output、LLM prompt/request/response 和未被列表消费的 Message metadata（包括 toolResults）不随消息列表返回。
- [`消息 GET`](../../../app/api/rooms/%5BroomId%5D/messages/route.ts) 保留认证、成员资格与 no-store；ChatMessage contract、既有任务/调用摘要呈现和专门 Trace 授权入口保持。没有修改 Prisma schema/migration、依赖、客户端 merge、SSE interval、Agent 写入/Trace 存储或启动/部署配置；QAM-02-006 继续作为独立 P2。
- 改动文件：上述 3 个业务文件、新增 [`tests/integration/chat-message-read-model.integration.test.ts`](../../../tests/integration/chat-message-read-model.integration.test.ts)、扩展 [`tests/e2e/authenticated.spec.ts`](../../../tests/e2e/authenticated.spec.ts)、QAM-02 报告/共享总览与状态记录，共 10 个文件。没有新增 Node mock 测试来替代真实查询/浏览器语义。

### 负向对照与回归

- 原始命令 `./scripts/run-node22.sh npm run test:integration -- tests/integration/chat-message-read-model.integration.test.ts`：旧实现 exit 1、3/3 failed，HTTP 窗口首项出现 message-014 而预期 message-020；SSR/SSE 返回最旧窗口，完整 Trace/metadata 超出摘要字段；短窗口同时间消息实际 system-b/system-a 而预期 system-a/system-b。修复后原命令 exit 0、3/3 passed（9.64s）。
- PostgreSQL 反向植入 100 条消息、每七条同时间且窗口边界穿过同时间组；重复读取实际 GET、Page 的 initialSnapshot 与 SSE Response 后 ID、顺序、摘要一致。测试同时覆盖空/短窗口、其他房间消息隔离、成员仍可读完整 Trace、非成员消息 GET/Trace 403、SSE 拒绝和 Page 重定向；未 mock Prisma/数据库查询或 assertRoomAccess。
- 原始浏览器命令 `./scripts/run-node22.sh npm run test:e2e -- tests/e2e/authenticated.spec.ts --grep 'latest 80 messages'`：旧实现 exit 1，setup 通过、旅程因初始 HTML/RSC 缺少“长对话消息 099”失败（24.4s）。首次修复后已通过窗口/发送/摘要/刷新，但 Playwright setOffline 未关闭既有 SSE，等待“重连中…”超过 5000ms，命令 exit 1（39.1s）；这属于故障注入未生效，没有据此修改产品重连逻辑。
- 最终浏览器故障注入改为刷新后在 HTTP 请求边界触发 connectionreset，再放行真实 SSE 服务；同一命令 exit 0，setup + 旅程 2/2 passed（34.8s）。验证发送、刷新、重连 refresh、伙伴离线期间新增消息及后续周期都保持相同最新 80 条；HTML/RSC/GET/SSE 无植入私有值，已派发、Tool 和 LLM 摘要可见。没有伪造 EventSource 或 snapshot。

### 完整门禁与状态

- 工具链为 Node.js v22.23.2 / npm 10.9.8；启动 `./init.sh` exit 0，Prisma generate、资产、类型、lint 和 72 文件/482 项通过。修复后 `./scripts/run-node22.sh npm run check:quick` exit 0、72/482；当前用户已在 docker group，Docker/Testcontainers 可用，无权限对照阻塞。
- 最终 `./scripts/run-node22.sh npm run check:full` **单次 exit 0**：类型、lint、资产、72 文件/482 项 Vitest、Next.js 16.3.3 production build、覆盖率门槛、23 文件/71 项 PostgreSQL 与 **31/31 Playwright**（3.8 分钟，0 failed/flaky/skipped）。覆盖率 statements **47.72%**、branches **42.56%**、functions **52.56%**、lines **48.54%**，未调整门槛。该命令已包含 `npm run check`，没有另行重复标准门禁。
- `npm run test:compose-smoke` 未运行：本次没有修改启动/部署路径，数据库查询和关键聊天旅程已由完整门禁覆盖；不声称新增 Compose 或独立生产浏览器验收。启动脚本未改，启动基线为本轮实际执行成功的 `./init.sh`。
- `feat-051` 标记 done；总计 done×51、not-started×9，无 in-progress/blocked。QAM-02-002 resolved，QAM-02 **94/L4**（复用 +1、接口 +1、隐私 +2，其余维度/Gate 不变）；组合均分 **83.6**，开放 **P0×0/P1×0/P2×37**。QAM-02-006 慢 snapshot 重入、QAM-08 Trace 生命周期未纳入本次。

### 清理与恢复

- `coverage/`、`playwright-report/`、`test-results/`（含测试认证状态）和本轮 `/tmp/xoxo-feat051-*.log` 已清理；原始失败/修复后命令、结果和原因已记录在本节，未保留失败诊断日志。Testcontainers 与 E2E 临时数据库/目录自动清理，Docker 仅剩会话前既有健康 `xoxo-meridian-postgres`，无临时 Next 服务；既有 `.next` 缓存保留，`next-env.d.ts` 无差异。
- `git diff --check`、JSON/状态依赖/排序、报告链接与 QAM-02 十维算术核验通过；确认前 50 条 feature 与 HEAD 一致，其余九项仍为 not-started，未覆盖用户登记改动。本轮没有 Git commit 或部署。
- clean restart：依次阅读四份启动文件，使用 `./scripts/run-node22.sh` 校验 Node 22.23.2/npm 10.9.8；确认 feat-051 done 后，只将 feat-052 标为 in-progress，再运行 `./init.sh`。
- 唯一推荐下一步：按既有排名开始 **feat-052（QAM-06-007，首页照片与连线保存失败后的错误状态）**，先核对已登记依赖/验收与失败恢复回归，不合并其他 P2。

## 2026-09-12 — 按用户体验优先级登记前 10 项 P2（仅登记）

### 状态与排序依据

- 用户要求先将体验影响最大的 10 项 P2 注册到 `feature_list.json`。本轮读取四份启动文件、`PROJECT_VIEW.md`、十份 QAM 报告的开放问题及相关当前代码，使用 `harness-creator` 校验任务来源、状态和恢复路径；没有启动业务实现。
- 候选池为 38 项开放 P2，无开放 P0/P1。新增 `feat-051`～`feat-060`，均为 `not-started`；既有 `feat-001`～`feat-050` 的内容与 `done` 状态完整保留。当前共 60 项：`done`×50、`not-started`×10、`in-progress`×0、`blocked`×0；QAM 问题仍为开放 P2×38，登记不等于修复或改分。
- 排序综合核心操作受阻或结果失真程度、当前产品入口的影响范围、触发频率与恢复成本；同等影响时优先直接行为证据。频率是代码路径与触发条件的定性判断，没有线上使用量或发生率数据。辅助技术用户的持续操作障碍计入核心任务影响。
- `priority="P2"` 保留严重级别，`priorityRank=1..10` 表达本批执行顺序；`priorityReason`、`sourceIssue`、`sourceReport` 保存决策依据和唯一来源。每项包含具体用户结果、风险匹配回归、验收门禁与独立范围；`dependencies` 仅引用已完成的真实前置基础，不将排序编造成技术依赖链。

| 排名 | Feature | 来源 | 用户体验影响及排序理由 |
| ---: | --- | --- | --- |
| 1 | feat-051 | QAM-02-002 | 长对话超过 80 条后，最新消息与旧 snapshot 反复冲突；双方持续交流受影响，刷新难以稳定恢复。 |
| 2 | feat-052 | QAM-06-007 | 首页照片缩放、改标题、删照片/连线遇到网络故障仍呈现成功；刷新回退使编辑成果和删除结果不可信。 |
| 3 | feat-053 | QAM-08-005 | Agent 静默丢弃未知或缺失动作却可能声称完成；用户难以及时察觉，后续依赖错误结果。 |
| 4 | feat-054 | QAM-03-006 | 屏幕阅读器用户每次操作计划时都无法辨认小时、分钟和时区；关键表单存在持续可访问性障碍。 |
| 5 | feat-055 | QAM-03-005 | Agent 创建的合法长记录无法经 UI 原样保存；小改动也迫使用户先人工缩短内容。 |
| 6 | feat-056 | QAM-02-006 | 慢查询下 SSE 重入使消息/Agent 状态回退并放大卡顿；核心路径受影响，但需超过两秒查询条件。 |
| 7 | feat-057 | QAM-05-007 | 搜索 401/500 被误报为无匹配，作者位置也随入口变化；用户误判内容消失并反复查询。 |
| 8 | feat-058 | QAM-10-003 | Session 失效后多页面保留不可用入口和 WebGL 资源；触达广，点击时仍可由服务端纠正。 |
| 9 | feat-059 | QAM-05-003 | 同毫秒记录跨页时漏文章且顺序不稳定；影响历史内容找回，触发条件较窄。 |
| 10 | feat-060 | QAM-07-003 | DST 边界把两天学习计成三天或错算伙伴分钟；已有直接错算证据，影响特定时区日期的反馈可信度。 |

- 其余 28 项继续在原报告保持 `open`，留待下一批登记。并发 slug/Home anchor/Goal 排序需要更窄的写入交错；Worker 健康、shutdown、Trace/LLM 生命周期和上传补偿主要改善故障发现、恢复或资源治理；QAM-10 实体设备/当前 production 项主要补验证证据，尚不能按已发生的设备故障排序。旧 Atlas 专属建板、连线和 SSE 的优先级依据历史交接中当前产品入口为 `/home` 的边界处理。上述取舍可在实际使用或故障数据出现后调整。

### 验证与权限对照

- 工具链：`./scripts/run-node22.sh node --version` 为 `v22.23.2`，`./scripts/run-node22.sh npm --version` 为 `10.9.8`。
- 首次受限 `./init.sh` exit 1：TypeScript、ESLint、资产通过；Vitest 为 70/72 文件、478/482 项通过，`tests/lib/agent-entry-build-config.test.ts` 3 项和 `tests/lib/scheduled-job-one-shot.test.ts` 1 项因 Node 子进程空 stdout 报 `SyntaxError: Unexpected end of JSON input`。按 `AGENTS.md` 在获准的正常权限边界重跑同一 `./init.sh`，exit 0，Prisma generate、资产、类型、lint、72 文件/482 项全部通过；未修改这四项测试。
- 用户随后明确：没有修改任务代码时不必运行验证。本轮按此要求停止新增检查；收回此前已启动的 `./scripts/run-node22.sh npm run check` 会话时，命令已返回 exit 0，包含 72 文件/482 项 Vitest、Next.js 16.3.3 production build 和覆盖率门槛（statements 47.77% / branches 42.59% / functions 52.71% / lines 48.54%）。保留实际结果，不再重复门禁或最终 init；后续仅登记文档的会话遵循这一用户约定。
- `./scripts/run-node22.sh node /home/dadalv/.agents/skills/harness-creator/scripts/validate-harness.mjs --target .` exit 0、100/100。Python 只读 JSON/来源断言通过：60 个连续唯一 ID、原 50 条与 `HEAD` 完全一致、恰好 10 条 P2/not-started、排名恰为 1～10、来源均是 38 个开放 P2 中的唯一项、依赖均存在且已完成；`git diff --check` 通过。
- `npm run check:full`、`npm run test:compose-smoke` 及新 feature 的专项回归未运行：本轮仅登记任务，未修改应用、数据库、认证或部署实现，用户已明确免除此类文档工作的验证；既有检查结果不作为任何 P2 的修复验收。本次未新增测试。

### 改动、清理与唯一下一步

- 仅保留 `feature_list.json`、`session-handoff.md` 的登记改动；开始时工作树干净，未创建服务、容器或测试数据。已清理本轮新生成的 `coverage/`，将构建自动改写的 `next-env.d.ts` 导入路径还原为会话开始内容，既有 `.next` 缓存保留；没有保留失败日志或测试凭据。登记无阻塞，十项实现均尚未开始。
- 唯一推荐下一步：开始 `feat-051`（QAM-02-002），确认已完成依赖后仅将其标为 `in-progress`，运行 `./init.sh`，先建立超过 80 条消息与 Trace 摘要的真实 PostgreSQL/浏览器回归，再统一 ChatMessage 读取窗口和投影。

## 2026-09-12 — feat-050 完成（QAM-08-006 resolved）

### 交付与范围

- 按启动顺序完整读取 `AGENTS.md`、`feature_list.json` 与 `session-handoff.md`；确认 feat-049 完成后，只登记 feat-050 为 `in-progress`，再运行 `./init.sh` 建立 72 文件/480 项基线。`xoxo-qam-08-agent-runtime-review` 用于保持稳定问题 ID、QAM-08/QAM-01/02/03 责任边界、E3 纪律与只重算受影响评分；`harness-creator` 用于维护单一 feature、门禁、清理和状态记录闭环。
- [`agent/context-builder.ts`](../../../agent/context-builder.ts) 现在接收 `requestedById`，复用 [`lib/participant-resolution.ts`](../../../lib/participant-resolution.ts) 以稳定 userId 派生显式 `requestedById/self/partner`；[`agent/agent-runtime.ts`](../../../agent/agent-runtime.ts) 从 Task 传入请求者，把有效请求者写入 Durable Plan input，并把同一有效身份交给 Tool。[`agent/types.ts`](../../../agent/types.ts) 为参与者保留 userId；[`agent/llm-provider.ts`](../../../agent/llm-provider.ts) 的 mock 和真实提示都只认 self/partner，空或非成员请求者不按数组位置猜城市、时区、姓名或个人 Memory。
- 新增 [`agent/memory-identity.ts`](../../../agent/memory-identity.ts) 作为 Memory identity 单一事实源：`me.*`/`her.*` 在写入时解析为 `user:<id>` owner 与 `person.*` canonical key，`shared.*`/`_system.*` 分别使用 `scope:shared`/`scope:system`；相对 me/her 只在 recall/context 输出时按当前请求者投影。Memory set、owner 内相似值去重、recall、context builder 与 extractor 都复用该协议；空请求者可读写 shared，但个人写入稳定拒绝且个人读取为空。
- [`prisma/schema.prisma`](../../../prisma/schema.prisma) 新增必填 `ownerKey` 与 `(roomId,ownerKey,key)` 唯一键；时间戳迁移 [`20260912175500_add_memory_owner_key`](../../../prisma/migrations/20260912175500_add_memory_owner_key/migration.sql) 在锁定 Memory 表的事务中规范化已知 owner。不同 owner 可保留同一 canonical key；同 owner 规范化冲突、缺 owner 的个人行及未知 key 均不删除、不猜归属，而是保留为带 `ownerMigration` 原因的 `legacy:<id>`；新增 check 约束保护 shared/system/user/legacy 形态并保持 `migrate deploy` 兼容。
- 只处理 QAM-08-006；没有处理 QAM-08-001～005、QAM-03-005/006、Trace、post-task lifecycle、Tool lease、依赖或部署。工作树中 feat-044～049、QAM-10、既有 `docs/optimization/agent-runtime-review.md` 删除状态及其他用户改动全部保留。

### 负向对照与风险匹配回归

- 修复前 `./scripts/run-node22.sh npm run test:unit -- tests/agent/agent-runtime.test.ts` 为 **2 failed/13 passed**：第二位请求者 Bob 的天气/时区计划仍使用第一位 Alice/London，`requestedById=null` 也从 participant 顺序猜出 London/默认时区，而非中性 `{}`。
- 修复前 `sudo -n -g docker -u dadalv ./scripts/run-node22.sh npm run test:integration -- tests/integration/agent-requester-memory.integration.test.ts` 为 **3/3 failed**：Alice 的个人行被 Bob 的同名/相似事实覆盖或去重删除，双方 context/recall 投影错位，空请求者还能写入无法确定 owner 的个人事实。
- 修复后 Node 定向 3 文件/20 项通过。真实 PostgreSQL [`agent-requester-memory.integration.test.ts`](../../../tests/integration/agent-requester-memory.integration.test.ts) 4/4：双方同名 `preference`、相同值不同 owner、owner 内相似事实均按预期保留/合并；切换请求者后 aboutMe/aboutHer 与 recall 双向正确；空请求者只看 shared；完整 Runtime 从第二请求者 Bob/London 规划并执行到 Alice/Shanghai，Durable Plan 记录有效请求者，空请求者的 Tool input 为 `{}`。集成 global setup 显式固定 `LLM_PROVIDER=mock` 并清空 API key；首轮全链路诊断曾暴露测试会继承开发 `.env` 的真实 provider 并发出网络请求，该次结果不计为通过，修正后测试不再依赖真实网络或凭据。
- 新增 [`memory-owner-migration.integration.test.ts`](../../../tests/integration/memory-owner-migration.integration.test.ts) 在 Testcontainer 内创建隔离临时数据库，先部署全部旧迁移、植入 8 条已知 owner/跨 owner 同 key/同 owner 冲突/shared/system/歧义/未知数据，再部署新迁移：1/1 通过，8/8 行保留；已知行正确规范化，冲突与歧义行保留完整 metadata，复合唯一及 owner check 均拒绝非法 SQL。测试 finally 终止该数据库连接、删除精确临时库和临时 schema 目录。

### 门禁、复审与清理

- `npm run db:generate`、`npm run typecheck`、`npm run lint`、`npm run check:quick` 均通过；快速门禁为 72 文件/482 项。定向 requester-memory PostgreSQL 4/4、迁移 1/1，最终全量 PostgreSQL 为 22 文件/68 项。
- 首轮 `sudo -n -g docker -u dadalv ./scripts/run-node22.sh npm run check:full` 的 quick 与 production build 通过，仅 coverage 阶段的无关 `tests/server/home-board-routes.test.ts` “uploads a home photo...” 在 5000ms 超时而 exit 1；该文件立即按原命令定向重跑 8/8，完整 `npm run test:coverage` 重跑 72/482，证明不是稳定代码失败，且没有修改该无关用例。随后一轮 `check:full` 全链路 exit 0；差异审计再将 Tool 的原始 Task 请求者收紧为 context 已验证的有效请求者后，Node 20/20，并再次运行最终 `check:full` **exit 0**：TypeScript、ESLint、72/482 Vitest、Next.js 16.3.3 production build、覆盖率 statements 47.73% / branches 42.56% / functions 52.71% / lines 48.54%、22/68 真实 PostgreSQL、30/30 Playwright（5.9 分钟）。既有占位图片、THREE.Clock、Reduced Motion 与故障注入日志未形成失败；未改部署拓扑，故未运行 Compose smoke，也不声称其通过。
- QAM-08-006 已按原 ID 移入 resolved；只重算身份/owner contract 直接改变的架构、状态一致性、接口、健壮性、隐私与验证可信度，QAM-08 由 70/L1 更新为 **80（Score L3、Gate/Final L2）**。QAM-08-001～005 保持开放 P2；十模块总分 832、均分 83.2，Final 分布 L0×0/L1×0/L2×6/L3×2/L4×2，开放 P0×0/P1×0/P2×38。
- 最终门禁生成的 `coverage/`、`playwright-report/` 与含临时认证状态的 `test-results/` 已按明确路径移入系统回收站，可恢复；`next-env.d.ts` 无差异。迁移测试临时数据库/目录均由 finally 清理；Docker 仅保留会话前既有健康 `xoxo-meridian-postgres`，没有 Testcontainers 残留。
- 状态落盘后最终 `./init.sh` exit 0：Prisma Client、两主题正式资产、TypeScript、ESLint 与 72 文件/482 项 Vitest 全部通过。Harness validator 100/100；50 个 feature ID 连续且全 `done`；QAM-08 十维合计 80、总览十模块总分 832/均分 83.2；质量文档相对链接全部可解析，`feature_list.json` 可解析，`git diff --check` exit 0，最终 status 无本轮测试报告、临时认证目录或迁移临时库。

### 状态与唯一下一步

- feat-001 至 feat-050 均为 `done`，没有 `not-started`、`in-progress` 或 `blocked` feature；当前没有开放 P0/P1，仓库可从四份启动文件与 `./init.sh` 清洁恢复。
- 唯一推荐下一步：由产品优先级登记一个新的独立 feature；当前没有 P1，不在本 feature 内自动扩展到 QAM-08-001～005 或其他 P2。

## 2026-09-12 — feat-049 完成（QAM-03-004 resolved）

### 交付与范围

- 按启动顺序完整读取 `AGENTS.md`、`feature_list.json` 与 `session-handoff.md`；确认 feat-048 完成后，只登记 feat-049 为 `in-progress`，再以 `./init.sh` 建立 72 文件/472 项基线。`xoxo-qam-03-life-plan-review` 用于保持稳定问题 ID、QAM-03/QAM-04/QAM-08 责任边界、E3 纪律与只重算受影响维度；`harness-creator` 用于维护单一 feature、门禁、清理和状态记录闭环。
- [`lib/scheduled-job-one-shot.ts`](../../../lib/scheduled-job-one-shot.ts) 现在导出带 offset 的 ISO datetime Zod schema、create “`fireAt`/`cron` 恰一”与 update “至多一项”谓词；resolver 在构造 `Date` 前再次校验 offset，不能再按 Worker `TZ` 猜测业务时刻。[`lib/validation.ts`](../../../lib/validation.ts) 与 [`agent/tool-contracts.ts`](../../../agent/tool-contracts.ts) 共同引用这一领域 contract，HTTP 和 Agent `schedule.create/update` 不再平行解释 trigger。
- Tool Registry 会在 Tool execute 与 `ScheduledJob` 写入之前拒绝无 offset `fireAt` 和 `fireAt+cron`。合法 offset、五分钟宽限、cron 合成、active cap、QAM-04 的 CAS/run-once missed-window 及 Tool 通用事务/trace 策略均保持；没有修改 schema/migration、依赖或部署配置。
- 只修改上述三个实现文件及 one-shot、schedule Tool、真实 PostgreSQL parity 回归；没有处理 QAM-03-005 字段上限、QAM-03-006 表单可访问名称、QAM-08-006 Memory 身份或其他 QAM。工作树中 feat-044～048、QAM-10 文件、既有 `docs/optimization/agent-runtime-review.md` 删除状态和其他用户改动均保留。

### 负向对照与回归证据

- 修复前运行 `./scripts/run-node22.sh npm run test:unit -- tests/lib/scheduled-job-one-shot.test.ts tests/agent/schedule-tool.test.ts`：2 文件/50 项中 **6 failed、44 passed**。resolver 未拒绝无 offset；实际 Node+tsx 子进程在 `TZ=Asia/Shanghai` 与 `TZ=America/Los_Angeles` 下分别把 `2030-05-09T20:40:00` 解释为 `12:40Z` 与次日 `03:40Z`。四组 Agent create/update 的无 offset 或 `fireAt+cron` 越过 Registry validation，随后才因测试 Task 外键在执行层失败，实际得到 `ToolExecutionError` 而非期望的 `ToolValidationError`。
- 修复后同一命令 exit 0、50/50。合法 `2030-05-09T20:40:00+01:00` 在两个进程 TZ 下均得到 `2030-05-09T19:40:00.000Z` 与 `40 20 * * *`；无 offset 在两边均抛 `ScheduledJobFireAtError`。四组非法 Agent 输入均由 Registry 抛 `ToolValidationError`，Tool execute spy 未调用、无 `ScheduledJob` create/update，并留下既有 validation Event；两组合法 offset contract 由 HTTP/Agent 同时接受。
- `sudo -n -g docker -u dadalv ./scripts/run-node22.sh npm run test:integration -- tests/integration/scheduled-job-one-shot-fireat.integration.test.ts` exit 0、11/11。真实 PostgreSQL 回读 Agent create/update 与 Route POST/PATCH 的 `nextRunAt`、`cron`、`payload.runOnce` parity；四组非法 Agent trigger 均在写入前失败，原 Job 不变且无 ToolCall。测试验证持久化可观察行为，不用源码扫描或低层 mock 代替数据库证据。

### 门禁、复审与清理

- `npm run typecheck`、`npm run lint -- --no-cache`、`npm run check:quick` 均 exit 0；快速门禁为 72 文件/480 项 Vitest。
- 最终 `sudo -n -g docker -u dadalv ./scripts/run-node22.sh npm run check:full` **单次 exit 0**：TypeScript、ESLint、72 文件/480 项 Vitest、Next.js 16.3.3 production build、覆盖率 statements 48.26% / branches 42.98% / functions 53.55% / lines 49.14%、20 文件/63 项真实 PostgreSQL、30/30 Playwright（7.2 分钟）。既有占位图片、THREE.Clock、Reduced Motion 等服务警告未形成失败；未修改部署路径，故未运行 Compose smoke，也不声称其通过。
- QAM-03-004 已按原 ID 移入 resolved；只重算 trigger contract 直接改变的架构、状态一致性、接口、健壮性与验证可信度，各 +1，QAM-03 由 85/L2 更新为 **90（Score/Gate/Final L4）**。QAM-03-005/006 保持开放 P2；组合总分 822、均分 82.2，Final 分布 L1×1/L2×5/L3×2/L4×2，开放 P0×0/P1×1/P2×38。
- `coverage/`、`playwright-report/` 与含测试认证状态的 `test-results/` 已按明确路径移入系统回收站，可恢复；`next-env.d.ts` 未产生差异。Docker 只保留会话前既有且健康的 `xoxo-meridian-postgres`，没有 Testcontainers 残留。
- 状态落盘后最终 `./init.sh` exit 0：Prisma Client、两主题正式资产、TypeScript、ESLint 与 72 文件/480 项 Vitest 全部通过。Harness validator 100/100；49 个 feature ID 连续且全 `done`；QAM-03 十维为 90/100，总览十模块总分 822/均分 82.2；`feature_list.json` 可解析。首轮通用链接脚本把 QAM-05 报告的历史 `javascript:...` 安全示例误判为本地文件而 exit 1；按 URI scheme 规则修正只读检查后，11 份质量文档的 521 个相对链接全部可解析。`git diff --check` exit 0，最终 status 无本轮测试报告或临时认证目录。

### 状态与唯一下一步

- feat-001 至 feat-049 均为 `done`，没有 `not-started`、`in-progress` 或 `blocked` feature；仓库可从四份启动文件与 `./init.sh` 清洁恢复。
- 唯一推荐下一步：另行登记并只修复当前唯一开放 P1 `QAM-08-006`，为 Planner/Memory 建立稳定请求者身份并验证双成员隔离；不要并入 QAM-03-005/006 或其他 QAM。

## 2026-09-12 — feat-048 完成（QAM-06-009 resolved）

### 交付与范围

- 按启动顺序完整读取 `AGENTS.md`、`feature_list.json` 与 `session-handoff.md`，确认 feat-047 已完成后登记 feat-048 为唯一 `in-progress`，再运行 `./init.sh` 建立 72 文件/472 项基线。`xoxo-qam-06-spatial-media-review` 用于保持稳定问题 ID、模块边界、E3 纪律与只重算受影响评分；`harness-creator` 用于维护单一 feature、门禁和状态记录闭环。
- [`lib/home-board.ts`](../../../lib/home-board.ts) 新增单一 Home spatial access contract：固定 `home-board` 下，element 只允许共享 `photo`（`postId=null`）或满足 `getPostVisibilityWhere(userId)` 的 Post anchor；connection access 从两端 element access 派生，任一端不可见即不可读写。`/home` 的 `initialSnapshot` 现在携带当前用户 ID，在数据库查询阶段过滤 element 与 connection。
- Home element PATCH/DELETE 和 connection POST/DELETE 全部复用同一 access predicate；授权不只停留在预读：element 使用带条件的扩展 unique update/delete，connection DELETE 使用带两端可见性的 `deleteMany`，connection POST 使用条件 nested connect，竞争窗口中的成员资格/资源变化映射为 404。固定 board、共享照片、全局 `user_post`、Post-to-Post 禁连与现有连接类型均保持。
- 只修改 Home snapshot/access、对应 Route 与回归；没有修改 Prisma schema/migration、依赖、上传、Atlas SSE、QAM-06 其余 P2、QAM-03-004 或 QAM-08-006。现有 feat-044～047 与其他用户未提交改动均保留。

### 负向对照与回归证据

- 新增真实 PostgreSQL [`home-board-authorization.integration.test.ts`](../../../tests/integration/home-board-authorization.integration.test.ts)，先在未修复实现上运行并一次性收集全部可观察结果，避免首个断言遮蔽后续写入：测试 0/1；A 的 snapshot 实际含 B 的隐藏 anchor 与 connection，PATCH/POST/DELETE 实际为 200/201/200，隐藏 anchor 的 x 从 30 写为 999、原隐藏 connection 被删除，并新增 1 条未授权 connection。
- 修复后同一双 Room 场景 1/1：A snapshot 只含共享照片、全局 `user_post` 与 Room A anchor，隐藏 connection 被过滤；三个 mutation 均为 404，坐标、原 connection 与新增 connection count 全部不变。切换到 B 后隐藏 anchor 的 PATCH、connection POST/DELETE 仍为 200/201/200；全局 anchor 与共享照片 PATCH 仍为 200。
- 新增 Playwright 真实旅程，从 `/home` 的实际响应载荷断言隐藏 Post/anchor/connection ID 均不存在、可见全局 anchor/照片/connection 仍存在，再以已登录浏览器发真实 PATCH/POST/DELETE，断言三个 404 与 PostgreSQL 终态。定向命令 2/2（含 setup）通过；测试在 `finally` 清理其 Post、照片与 Room。
- Route/helper 定向回归 2 文件/10 项通过；相关真实 PostgreSQL bundle（新授权、Post visibility、Home drag、Atlas board scope）4 文件/5 项通过。observer fixture 随新的 snapshot contract 显式传入 `userId`，既有双进程 Home drag 收敛继续通过。

### 门禁、复审与清理

- `npm run typecheck`、`npm run lint` 与 `npm run check:quick` 均 exit 0；快速门禁为 72 文件/472 项 Vitest。
- 最终 `sudo -n -g docker -u dadalv ./scripts/run-node22.sh npm run check:full` **单次 exit 0**：TypeScript、ESLint、72 文件/472 项 Vitest、Next.js 16.3.3 production build、覆盖率 statements 48.21% / branches 42.92% / functions 53.41% / lines 49.09%、20 文件/61 项真实 PostgreSQL、30/30 Playwright（5.1 分钟）。故障注入的 Prisma 错误、既有占位图片与 THREE.Clock 提示均未形成失败；未修改部署路径，因此未运行 Compose smoke，也不声称其通过。
- QAM-06-009 已移入 resolved；只重算访问边界、复用、数据一致性、接口、竞态防护、安全和验证可信度，QAM-06 由 65/L1 更新为 **74（Score/Gate/Final L2）**。六个既有 P2 原样开放；组合总分 817、均分 81.7，Final 分布 L1×1/L2×6/L3×2/L4×1，开放 P0×0/P1×2/P2×38。
- 完整门禁生成的 `coverage/`、`playwright-report/` 与含临时认证状态的 `test-results/` 已按明确路径移入系统回收站，可恢复；`next-env.d.ts` 未产生差异。Docker 只保留会话前既有且健康的 `xoxo-meridian-postgres`，没有 Testcontainers 残留。状态落盘后最终 `./init.sh` exit 0、72/472；Harness validator 100/100，48 个 feature 连续且全 `done`，QAM-06 十维合计 74、组合总分 817/均分 81.7、521 个报告相对链接均可解析，`git diff --check` 通过。

### 状态与唯一下一步

- feat-001 至 feat-048 均为 `done`，当前没有 `not-started`、`in-progress` 或 `blocked` feature；仓库可从四份启动文件与 `./init.sh` 清洁恢复。
- 唯一推荐下一步：另行登记并只修复 `QAM-03-004`，统一 Agent 无 offset `fireAt` 的绝对时刻解析语义并用 Route/Agent 跨进程、时区差异回归保护；不要并入 QAM-08-006 或 QAM-06 的 P2。

## 2026-09-12 — feat-047 完成（QAM-01～QAM-10 全量独立复审）

### 范围与模块治理

- 按用户修正后的范围，对 QAM-01～QAM-09 各派发一个独立子 Agent；每个 Agent 均显式使用对应 `xoxo-qam-*-review` Skill，只修改自己的详细质量报告。主线程完整读取全部九个 Skill、统一标准和仓库上下文，负责组合一致性、模块边界与 Harness 收尾，没有修改业务实现。
- 另派独立边界 Agent 按核心责任、owned state/assets、接口、依赖/被依赖、变化驱动、风险面和测试边界审查 `3D Agent Entry`。结论为应升格 **QAM-10「全局 3D Agent 入口与模型资产生命周期」**：该能力拥有版本化源/正式 GLB、selection/recipe/candidate report、可执行资产晋升接口、WebGL/首帧/缓存/释放状态机和专属风险面，不能由通用应用壳或 QAM-09 完整吸收。
- `PROJECT_VIEW.md` 已增加 QAM-10 的完整 In/Out Scope、接口、资产/状态、依赖、代码映射、变化驱动、质量风险、Quality Tracking，以及 BU-11～BU-14；统一标准的适用范围扩至 QAM-10。使用 `skill-creator` 新建并验证 `.agents/skills/xoxo-qam-10-agent-entry-review/SKILL.md`，再由第十个独立子 Agent 显式调用该 Skill 建立首次质量报告。

### 复审结果

| QAM | Score | Score / Gate / Final | 本轮变化 | 开放问题 |
| --- | ---: | --- | --- | --- |
| QAM-01 | 87 | L3 / L4 / L3 | 0 | P2×3 |
| QAM-02 | 90 | L4 / L4 / L4 | 0 | P2×2 |
| QAM-03 | 85 | L3 / L2 / L2 | -7；新增 QAM-03-004/005/006 | P1×1、P2×2 |
| QAM-04 | 87 | L3 / L3 / L3 | 0 | P2×1 |
| QAM-05 | 73 | L2 / L2 / L2 | 0 | P2×7 |
| QAM-06 | 65 | L1 / L1 / L1 | -6；新增 QAM-06-009 | P1×1、P2×6 |
| QAM-07 | 85 | L3 / L2 / L2 | 0 | P2×2 |
| QAM-08 | 70 | L2 / L1 / L1 | -4；新增 QAM-08-006 | P1×1、P2×5 |
| QAM-09 | 82 | L3 / L2 / L2 | +4；只计 build/image/Compose 直接责任 | P2×5 |
| QAM-10 | 84 | L3 / L2 / L2 | baseline | P2×5 |

- 十模块均分为 **80.8**；Final 分布 L0×0/L1×2/L2×5/L3×2/L4×1；开放问题 P0×0/P1×3/P2×38，另有 QAM-02-005 `not-reproduced` 历史项不计开放问题。
- 三个新增开放 P1 均有明确直接 owner：`QAM-03-004` 复现 Agent 无 offset `fireAt` 按 Worker 时区持久化错误时刻；`QAM-06-009` 发现 Home board snapshot/mutation 未继承 room-scoped Post anchor 成员授权；`QAM-08-006` 发现 Planner/Memory 缺稳定请求者身份，个人相对 key 可跨成员覆盖/错读。本轮仅登记和评分，不顺带修复。
- QAM-09 在新增 QAM-10 后由原审查 Agent 再次复核 BU-12/13：其 +4 只来自 build arg/runtime 隔离、Web image 打包与 Compose/build parity；GLB provenance/预算、WebGL 生命周期、入口交互和 decoder/CSP 直接证据归 QAM-10，未重复计分。

### 验证、边界与清理

- 开始基线 `./init.sh` exit 0：Prisma Client、两主题正式资产、TypeScript、ESLint、72 文件/472 项 Vitest 全部通过。九个既有 QAM 的定向验证分别记录于各报告；其中 QAM-01 为 6 文件/57 项、QAM-02 5/17、QAM-03 9/77、QAM-04 1/18、QAM-05 Node 7/49 + component 2/3、QAM-06 Node 7/40 + component 3/5、QAM-07 8/52、QAM-08 15/124，QAM-09 的构建配置/CSP/资产为 26/26 且三组 Compose config 通过。
- QAM-10 本轮 `check:agent-entry-assets` 两主题通过；定向 Node 31/31、component 20/20、CSP 6/6 与三组 Compose config 通过，四份源/正式 GLB hash 与当前记录一致。feat-040 的两主题 production/Compose 和 feat-046 的完整门禁只标历史 E3；本轮未把 jsdom 写成 WebGL/CSP 证据，也未把软件 Chromium写成实体设备证据。
- 标准门禁 `./scripts/run-node22.sh npm run check` exit 0：两主题资产、TypeScript、ESLint、72 文件/472 项 Vitest、Next.js 16.3.3 production build 和覆盖率全部通过；覆盖率 statements 48.27%、branches 43.21%、functions 53.42%、lines 49.15%。状态落盘与清理后最终 `./init.sh` 再次 exit 0、72/472。`npm run check:full` 与 `npm run test:compose-smoke` 未运行：本 feature 只修改质量治理文档/Skill，不修改数据库、认证、业务、运行配置或部署实现；不把未运行层级标成通过。
- 组合校验确认 10 份报告固定章节、十维合计、总览 Score/Gate/Final、总分 808/均分 80.8、524 个相对链接和 47 个全 `done` feature 一致；首次链接脚本误把报告中的 `javascript:...` 安全示例当本地文件，修正为只检查相对路径后通过。QAM-10 Skill `quick_validate` 通过，Harness validator 100/100，`git diff --check` 通过。
- `npm run check` 产生的 `coverage/` 已移入系统回收站；`next-env.d.ts` 已恢复会话前 dev types。未删除既有 `.next`、容器、用户源码或未提交改动；`docs/optimization/agent-runtime-review.md` 的既有删除状态保持，未恢复或纳入本 feature。

### 唯一推荐下一步

- 另行登记并只修复 `QAM-06-009`：让 Home board snapshot 与 element/connection mutation 复用 room-scoped Post anchor 可见性/成员授权，以真实 PostgreSQL 与 Playwright 证明非成员既看不到隐藏 anchor ID，也不能跨房间修改 anchor 或连接；不要同时处理 QAM-03 fireAt 或 QAM-08 Memory 身份问题。

## 2026-09-12 — feat-046 完成（QAM-04-002 resolved，开放 P1 清零）

### 交付与范围

- 完成最后一个开放 P1 `QAM-04-002`。`agent/scheduler-tick.ts` 的共享 `claimAndDispatchScheduledJob()` 事务现在对所有 `runOnce` Job 写入 `enabled=false`：超过一小时 missed window 时成功 claim 后返回 `skipped`，不创建 AgentTask 或 `scheduler.job.fired` Event；周期 Job 仍保持 enabled 并按 `computeNextRun()` 推进 `nextRunAt`。
- 窗口内 run-once 仍先执行同一原子 claim/Task/Event 路径；若 Task 或 Event 写入失败，整个 transaction 回滚，Job 保持 enabled，既有外部 stale-failure CAS 与 failCount/retry 语义不变。没有增加补发策略、外部调度能力或第二个状态分支。
- 没有修改 QAM-03 的 fireAt/cron authoring 契约、Prisma schema/migration、`QAM-04-003` Worker shutdown、QAM-08 Task 执行或 Docker/Compose。`xoxo-qam-04-scheduler-review` 用于按稳定问题 ID 与 E3 证据复评；`harness-creator` 用于维持单一活动 feature、验证门禁和状态记录闭环。

### 负向对照与回归证据

- 修复前，`./scripts/run-node22.sh npm run test:unit -- tests/agent/scheduler-tick.test.ts` exit 1：1 文件/17 项中 1 failed、16 passed；fake clock 将窗口外 run-once 推进到下一日同一 cron 时刻，实际得到 `{ fired: 1 }` 而非零副作用。修复后同命令 exit 0、18/18；新增回归同时证明窗口外 run-once 只禁用一次，以及窗口外周期 Job 仍 enabled、推进到下一小时且不写 Task/Event。
- 修复前，`sudo -n -g docker -u dadalv ./scripts/run-node22.sh npm run test:integration -- tests/integration/scheduler-atomic-dispatch.integration.test.ts` exit 1：1 文件/4 项中 1 failed、3 passed，真实 PostgreSQL 的下一日 tick 同样实际 `fired: 1`。修复后同命令 exit 0、4/4；测试使用 QAM-03 共享 `resolveOneShotSchedule()` 从 `fireAt` 合成 `0 10 * * *`，断言窗口外 Job disabled、failCount=0、lastRunAt=null、Task/Event 均为零，下一合成 cron 周期不重放。
- 新增测试验证的是 Job、Task、Event 和 tick 结果的可观察行为，不扫描源码字符串；既有窗口内成功、派生失败回滚、并发 CAS、旧 timer 隔离与失败回写回归均继续通过。

### 门禁、复审与清理

- 开始基线 `./init.sh` exit 0：Prisma Client、正式资产、TypeScript、ESLint 与 72 文件/470 项 Vitest 全部通过。
- 最终 `sudo -n -g docker -u dadalv ./scripts/run-node22.sh npm run check:full` **单次 exit 0**：TypeScript、ESLint、72 文件/472 项 Vitest、Next.js 16.3.3 production build、覆盖率 statements 48.27% / branches 43.21% / functions 53.42% / lines 49.15%、19 文件/60 项真实 PostgreSQL、29/29 Playwright（4.8 分钟）。故障注入中的 Prisma `P0001`、无效占位图片与 THREE deprecation 未导致门禁失败，不在本 feature 扩大处理。
- `npm run test:compose-smoke` 未运行：本轮未修改 Worker/Compose 启动路径或部署配置，不把未运行层级标记为通过。完整门禁生成的 `coverage/`、`playwright-report/` 与含临时认证状态的 `test-results/` 已按核对后的明确路径移入系统回收站，可恢复；没有清理 `.next`、用户源码或既有容器。
- QAM-04 只重算本轮证据改变的数据一致性、健壮性和验证可信度，各 +1，由 84 更新为 **87（Score/Gate/Final L3）**；`QAM-04-002` 标为 resolved。总览同步为九模块均分 81.9、Final L2×5/L3×2/L4×2，开放问题 P0×0/P1×0/P2×31。L4 仍受开放 P2 `QAM-04-003` 的 shutdown/in-flight 生命周期 E3 缺口限制。
- 工作树中会话开始前的 feat-044/045 改动全部保留；无关的 `docs/optimization/agent-runtime-review.md` 删除状态未恢复、覆盖或纳入本 feature。清理及文档落盘后，最终 `./init.sh` exit 0、72 文件/472 项；harness validator 100/100，46 个 feature ID 连续且全部 done，跨文件语义断言与 `git diff --check` 通过。最终 `git status --short` 仅显示本 feature 文件和会话开始前已存在的未提交改动，没有生成报告或临时认证目录。

### 状态与下一步

- `feature_list.json` 中 feat-046 已标为 `done`；feat-001 至 feat-046 全部完成，没有 `not-started`、`in-progress` 或 `blocked` feature，当前九个 QAM 报告中没有开放 P0/P1。
- 唯一推荐下一步：若继续治理 QAM-04，另行登记并只修复 P2 `QAM-04-003`，为 Scheduler in-flight callback 增加可等待的有界 shutdown，并以 Worker 信号行为与真实 PostgreSQL 重启恢复验证；不要并入 QAM-08 lease、QAM-09 Compose 拓扑或新调度功能。

## 2026-09-12 — feat-045 完成（QAM-04-001 resolved）

### 交付与范围

- 完成当前首要 P1 `QAM-04-001`。`agent/scheduler-tick.ts` 的 `activeJobTimers` 现在保存 `expectedNextRunAtMs`：相同版本继续去重，重复 tick 看到 Job 改期会清除并替换旧 timer；callback 删除自身条目前核对它仍是当前 timer，再以 `jobId + expectedNextRunAt` 重读持久化 Job。
- `fireJobNow()` 要求 Job 当前仍启用且 `nextRunAt` 与 timer 期望一致；timer 与 polling 都调用 `claimAndDispatchScheduledJob()`，后者统一做 wall-clock due 早期检查，并在 transaction 的 `updateMany` 中再次要求 `enabled=true`、`nextRunAt equals expected/lte now`、`lastRunAt` 与 `failCount` 全部匹配。改晚、改早、停用后按新时间重启用、时钟回拨及并发 claim 都落在同一持久化事实边界。
- 没有修改 Prisma schema/migration、QAM-03 Job authoring/Route/Tool、Worker lifecycle、run-once missed-window 策略或部署拓扑；`QAM-04-002` 与 `QAM-04-003` 保持独立开放。`xoxo-qam-04-scheduler-review` 用于核对范围、证据和持续评分，`harness-creator` 用于保持单 feature、门禁与交接闭环。

### 负向对照与回归证据

- 未修复实现上，新增定向 Node 回归为 1 文件/15 项中 **3 failed / 12 passed**：已注册 timer 后把 Job 改晚、停用后按新时间重启用、或 wall clock 回拨，旧 callback 均在原时刻创建了 1 个 AgentTask。修复后 Scheduler 测试扩展为 16/16；新增的第四种交错证明 Job 改早并再次 tick 时会主动替换旧 timer，在新到期时刻派生且没有等到旧时间。
- `sudo -n -g docker -u dadalv ./scripts/run-node22.sh npm run test:integration -- tests/integration/scheduler-atomic-dispatch.integration.test.ts` exit 0、3/3：真实 PostgreSQL 中，改期后的旧 timer 不创建 Task/Event、不覆盖 `nextRunAt`/`lastRunAt`/`failCount`；两个并发 tick 的独立 transaction 只有一个获得 claim，只生成 1 个 Task 和 1 个 `scheduler.job.fired` Event；既有 Event 插入故障仍让 Job/Task/Event 一起回滚。
- 定向 `npm run typecheck`、`npm run lint -- --no-cache` 与 Scheduler 16/16 通过。受限 `check:quick` 仅 `agent-entry-build-config` 3/3 因已知子进程空 stdout 症状失败，其余 71 文件/467 项通过；相同 Node 22.23.2/npm 10.9.8 在正常权限边界复跑原命令 exit 0、72 文件/470 项。

### 门禁、复审与清理

- 最终 `sudo -n -g docker -u dadalv ./scripts/run-node22.sh npm run check:full` **单次 exit 0**：TypeScript、ESLint、72 文件/470 项 Vitest、Next.js 16.3.3 production build、覆盖率 statements 48.22% / branches 43.18% / functions 53.42% / lines 49.15%、19 文件/59 项真实 PostgreSQL、29/29 Playwright（5.5 分钟）。故障注入的 Prisma `P0001`、无效占位图片、stream 故障和 THREE deprecation 均未导致门禁失败，不在本 feature 扩大处理。
- QAM-04 只重算有证据变化的代码结构、复用、状态一致性、健壮性与可测试性维度，由 75（L2）升至 **84（Score L3、Gate/Final L2）**；`QAM-04-001` 标为 resolved，总览更新为九模块均分 81.6、开放 P1×1/P2×31。Gate 仍为 L2，因为 `QAM-04-002` 的 run-once missed-window 缺陷和长停机/下一 cron 周期 E3 尚未解决。
- `coverage/`、`playwright-report/` 与含临时认证状态的 `test-results/` 均为本轮生成；系统回收站因只读文件系统不可用后，按已核对的明确路径永久删除。没有清理 `.next` 或用户源码。最终正常权限 `./init.sh` exit 0、72/470；`git diff --check` 与最终 harness/status 检查见本条后续收尾证据。
- 工作树中既有 `feat-044` 改动全部保留；盘点中另见与本 feature 无关的 `docs/optimization/agent-runtime-review.md` 删除状态，本轮未恢复、覆盖或纳入验收。

### 状态与下一步

- `feature_list.json` 中 feat-045 已标为 `done`；feat-001 至 feat-045 全部完成，无 `not-started`、`in-progress` 或 `blocked` feature。
- 唯一推荐下一步：另行登记并只修复 `QAM-04-002`，让超过 missed window 的 run-once Job 进入 disabled 终态，并以 fake clock + 真实 PostgreSQL 证明不创建 Task、不会在下一 cron 周期重放；不要并入 `QAM-04-003` shutdown 或新的补发策略。

## 2026-09-12 — feat-044 完成（QAM-03-003 resolved）

### 交付与范围

- 完成当前首要 P1 `QAM-03-003`。新增 `lib/participant-resolution.ts`：调用方提供参与者数组、显式当前用户 ID 和 ID 取值函数，返回匹配的 `self` 与另一参与者 `partner`；当前用户 ID 缺失或不匹配时两者均为空，不把数组位置当作身份协议。
- `components/chat/ChatApp.tsx` 将 `currentUser.id` 贯穿 `LifePanel`；`LifePanel.tsx` 按 ID 排列本人/伙伴并把 ID 传给 `ScheduledJobModal`；`LifePanelModals.tsx`/`TimezoneSelector.tsx` 按本人 profile 选择默认时区，身份无法确认时保留浏览器时区回退。
- `agent/tools/weather-tool.ts` 与 `timezone-tool.ts` 按 `context.requestedById` 解析本人/伙伴，显式 city/timezone/label 继续优先，身份无法确认时使用 Beijing、Asia/Shanghai、Europe/London 及“本人/对方”等中性默认，不猜参与者顺序；`schedule-tool.ts` 的既有请求者时区查找也复用同一 helper，语义不变。
- 没有修改参与者排序、RoomSnapshot/AgentContext transport、API 产品契约、Prisma schema/migration、QAM-04 scheduler tick 或新增生活功能；本次只收敛 QAM-03 UI/Agent 的对象解析与回归证据。`harness-creator` 用于维持单 feature、证据与交接闭环；`xoxo-qam-03-life-plan-review` 用于按十维标准重算有证据变化的维度，没有扩大范围。

### 负向对照与回归证据

- 未修复组件上，`life-panel-weather`/`life-panel-modals` 合计 2/5 失败：当前用户为第二位时“两地时间”仍按 Alice/Bob 展示而非 Bob/Alice，新建计划默认 `Asia/Shanghai` 而非本人的 `Europe/London`；修复后两文件 7/7。
- 未修复 Agent 实现上，第二参与者回归 2/6 失败：`weather.get` 将请求者自己的 London 当成伙伴城市，`timezone.compare` 将 Alice/Shanghai 当成本人；修复后 weather/timezone/schedule 及 Route/Tool 一致性合计 4 文件/35 项 Node 测试通过。`tests/server/weather-participant-resolution.test.ts` 用同一双人资料证明 Weather Route 与 Agent Tool 对 requester=`u2` 都解析伙伴 Alice/Shanghai。
- `tests/e2e/authenticated.spec.ts` 新增真实第二参与者旅程：独立登录 E2E Two，确认伙伴天气对象为 E2E One/Tokyo、两地时间先本人后伙伴、新建计划默认 `Europe/London`。登录用的 API request context 显式设置空 `storageState`，避免单活 Session 逻辑删除共享 `user-one` 会话；完整顺序下该旅程及其后的私密载荷、Post、Study、消息旅程全部通过。

### 门禁、失败复核与环境结论

- 初始受限 `./init.sh`：仅 `tests/lib/agent-entry-build-config.test.ts` 3/3 因子进程空 stdout 失败，其余 69 文件/454 项通过，符合 AGENTS 记录的受限沙箱症状；同 Node 22.23.2/npm 10.9.8 在获准正常权限边界重跑原命令 exit 0，70 文件/457 项通过。
- 定向实现后：组件 2 文件/7 项、Node 4 文件/35 项、`npm run typecheck` 与 `npm run lint` 均 exit 0。隔离数据库/浏览器中的第二参与者定向旅程 setup + test 为 2/2；修复测试 Session 隔离后，独立完整 `npm run test:e2e` 为 29/29。
- 根目录直接 E2E 首次在测试收集前因既有 `.next/dev/lock` 报 “Another next dev server is already running”（报告 PID 180869，复核时进程已不存在）；未中断或删除用户进程，改用隔离副本。
- symlink 依赖隔离副本中的两次默认 `check:full` 均先通过 72/466、production build、覆盖率和 PostgreSQL 19/57，随后 Next dev 持续报 `Cannot find module '../../module.compiled'`，私密载荷旅程收到非 2xx，最终均为 28/29、exit 1。只读 bundle 对照显示同一真实 Next 目录被生成两种不一致的 webpack module ID：调用方为 `(ssr)/./home/...`、目标为 `(ssr)/../../home/...`；这是临时项目根与 symlink 真实依赖根混用造成的验证拓扑故障，不在正常 npm 安装/容器拓扑内。一次 production-mode 尝试复用了已污染 `.next`，在 `_global-error` prerender 同样因该相对模块缺失 exit 1；没有以产品代码绕过。
- 最终在无 `.next`、且把锁定 `node_modules` 独立复制到项目内的隔离副本执行 `sudo -n -g docker -u dadalv ./scripts/run-node22.sh npm run check:full`，**单次 exit 0**：TypeScript、ESLint、72 文件/466 项 Vitest、Next.js 16.3.3 production build、覆盖率 statements 48.18% / branches 42.99% / functions 53.42% / lines 49.10%、19 文件/57 项真实 PostgreSQL、29/29 Playwright（4.9 分钟）。这组正向结果同时证明 symlink 故障不在仓库正常依赖拓扑中。
- 删除根目录 Playwright 报告与 1.9 GiB 最终隔离副本后，获准正常权限边界的最终根仓库 `./init.sh` exit 0：Prisma Client、正式资产、TypeScript、ESLint 与 72 文件/466 项 Vitest 全部通过。

### 复审、状态与下一步

- `docs/optimization/qam-03-life-plan-quality-review.md` 将 QAM-03-003 标为 resolved；仅架构边界、数据一致性、接口依赖和健壮性各 +1，QAM-03 从 88（Score L3、Gate/Final L2）更新为 **92（Score/Gate/Final L4）**。总览同步为九模块均分 80.6、Final L2×6/L3×1/L4×2、开放问题 P1×2/P2×31。
- `feature_list.json` 中 feat-044 已标为 `done`，feat-001 至 feat-044 全部完成；无 `not-started`、`in-progress` 或 `blocked` feature。
- 唯一推荐下一步：另行登记一个 QAM-04 调度器质量复审 feature，使用 `xoxo-qam-04-scheduler-review` 核对 feat-042 已命中的 `nextRunAt`/runOnce 时间语义复审触发条件；只审查既有 scheduler 实现，不把 QAM-03 状态转移重构或新调度功能并入同一 feature。

## 2026-09-11 — feat-043 项目品牌 Logo 与浏览器标签页图标替换完成

### 交付与范围

- 按已批准的 Bounded 设计完成 `feat-043`。用户提供的 `logo_white.svg` 与 `logo_transparent.svg` 已收纳到 `public/brand/`；两份文件统一把原 `0 0 1254 1254` 收紧为等比方形 `181 170 925 925`，清理只对外部 `img`/favicon 无效的内嵌 role/title/desc，保留两条 path 的全部几何数据和 `#0e1418` 品牌色。白底版本继续保留 `#ffffff` rect，透明版本不增加背景。
- `components/layout/BrandBadge.tsx` 使用固定 24×24、`unoptimized` 的 `next/image` 加载透明 SVG；图像为装饰性 `alt=""`/`aria-hidden`，链接的可访问名称由相邻可见 “XOXO / Meridian” 提供。原动态 `accentClass`、32×32 绿色圆角底块、文字、默认/自定义 `href` 与 hover 行为均保留，因此 `AuthPanel`、`SiteNav`、`ChatApp` 三处复用点同步更新。
- `app/layout.tsx` 的根 `Metadata.icons` 新增 `image/svg+xml`、`sizes="any"` 的白底图标引用，真实页面生成 `/brand/logo_white.svg` 的 `rel="icon"`。没有增加 Apple touch icon、PWA manifest 或 Open Graph 图片。
- About 页的装饰叶片和 Study “森林”主题属于内容语义，保持原状；`logo.png` 只作为用户提供的参考图留在根目录，没有加入运行时或改写。
- 使用 `harness-creator` 维持唯一活动 feature、完成证据和重启路径；该 Skill 只影响状态纪律，没有扩大产品范围。

### 验证证据

- 初始 `./init.sh` exit 0：Prisma Client、资产检查、TypeScript、ESLint 与 69 文件/456 项 Vitest 全部通过。新增 `tests/component/brand-badge.test.tsx` 后，旧实现负向对照 0/1：链接的可访问名称仍为 `🌿 XOXO Meridian` 且没有新图像；实现后定向组件回归 1/1。
- SVG 静态/渲染检查 exit 0：Sharp 能解析两份 1254×1254 SVG；两份资产均只有 `rect/g/path`（透明版本无 rect），两条 path 数据逐字一致，不含 `script`、`image`、`use`、`foreignObject`、链接、事件处理器或外部 URL。
- `sudo -n -g docker -u dadalv ./scripts/run-node22.sh npm run test:e2e -- --project=public --project=authenticated --grep 'serves the shared brand mark|renders the authenticated home navigation|reuses the brand mark'` exit 0、4/4（1 条认证 setup + 3 条品牌验收）。真实 Chromium 覆盖登录页、Home 和 Chat 的共用品牌链接；确认 `rel=icon`、资源 200、`image/svg+xml`，并实际 decode/render 16px 与 32px favicon、核对 320px/1280px 品牌尺寸及视口边界。
- 独立截图级目视复核确认：16px 和 32px 均能辨认星球、轨道与四角星；24px 透明标志在原 32px 绿色底块上对比清楚；登录页品牌在 320px/1280px 视口的尺寸和排版一致、无布局偏移。截图仅用于当轮检查，已在确认后清理。
- `./scripts/run-node22.sh npm run check` exit 0：TypeScript、ESLint、70 文件/457 项 Vitest、Next.js 16.3.3 production build（22 个页面）与覆盖率门槛全部通过；覆盖率 statements 46.47%、branches 41.73%、functions 51.75%、lines 47.32%。最终 `./init.sh` 再次 exit 0，为 70 文件/457 项。

### 清理、边界与下一步

- 本次不涉及数据库模型、认证/权限语义、关键业务旅程或部署拓扑，因此按风险执行标准门禁和定向真实 Playwright，没有运行 PostgreSQL integration、`check:full` 或 Compose smoke；不把未运行层级写成通过。
- 本轮生成的 `coverage/`、`playwright-report/`、`test-results/` 已移入系统回收站；`/tmp` 下三张目视截图因该挂载不支持回收站而按明确路径删除。没有保留失败日志或测试凭据，用户参考图 `logo.png` 与其他既有改动保持不变。
- 唯一推荐下一步：由产品优先级决定并登记一个新的独立 feature，确认依赖与验收标准后再启动；不要把 Apple/PWA/OG 等扩展继续并入已完成的 `feat-043`。

## 2026-09-11 — feat-042 修复 QAM-03-001 一次性任务 fireAt 被 PATCH 丢弃

### 交付与范围

- QAM-03-001 已 resolved：把 ScheduledJob 的**一次性时间语义**收敛为 `lib/` 中的单一事实来源。此前同一条规则分散在四处并漂移：`scheduledJobPatchSchema` 没有 `fireAt`（Zod 默认剥离未知键），POST 与 `schedule.create` 各写一遍同段逻辑，PATCH 与 `schedule.update` 则完全没有 `fireAt`。
- 新增 `lib/scheduled-job-one-shot.ts`：从 `agent/tools/schedule-tool.ts` **迁移**（非复制）`FIRE_AT_GRACE_MS`、`isValidCron`、`synthesizeCronFromDate`，并新增 `resolveOneShotSchedule`（NaN 校验 → 5 分钟宽限 → `nextRunAt` → 合法 cron 优先否则按任务时区合成）、`resolveRecurringSchedule`、类型化错误 `ScheduledJobFireAtError`/`ScheduledJobCronError`/`ScheduledJobTimezoneError`。Route 不再从 `agent/tools/` 导入，先前的分层倒置一并消除。
- 新增 `lib/zoned-time.ts`：`datetime-local` 的墙上时间与 `Date` 双向换算，用两遍 offset 求解；春季跳变的**不存在时刻**向前推移（NY `02:30` → `03:30`，与 cron-parser 对同一缺口的方向一致），秋季重复时刻取较早者。
- `app/api/rooms/[roomId]/scheduled-jobs/[jobId]/route.ts` PATCH 按显式状态转移矩阵写入：`fireAt` 分支强制 `runOnce: true` 并按新时区合成 cron；新增 `convertingToRecurring = existingRunOnce && !runOnce`，修掉"一次性转周期时 cron 字符串未变则不重算、首次触发停在旧一次性时刻"的边界。`scheduledJobPatchSchema` 增加 `fireAt` 与"不可与 cron 同时提供"（**未**照搬 POST 的 exactly-one-of，否则会破坏 `prompt`-only 等部分更新）。
- Agent 侧同步收敛：`schedule.create` 的 fireAt 分支改调共享契约并保留"Ask the user to clarify the time."；`schedule.update` 增加 `fireAt` 并在其 `buildData` 中应用同一矩阵。**注意** `agent/tool-contracts.ts` 才是真正的门槛——`tool-registry.ts:65` 会用契约的 `inputSchema` 覆盖工具自带 `schema`，且该契约是 `.strict()`；只改 `schedule-tool.ts` 会让 `fireAt` 在 `execute` 之前被静默拒绝，本次一并补齐契约。
- `components/chat/LifePanelModals.tsx` 的初始值与提交值均按**任务时区**换算：此前显示用 UTC 墙上时间、提交却按浏览器本地时区解析。

### 验证证据

- 定向修复前负向对照（真实执行）：组件测试在**未修复**组件上 3/4 失败——输入框显示 `2026-08-28T01:30`（应为 `09:30`），未改动任何字段直接保存会把存储的 `2026-08-28T01:30:00.000Z` 变成 `2026-08-27T17:30:00.000Z`（**−480 分钟**）。修复后 4/4。
- 新增 `tests/lib/zoned-time.test.ts` 与 `tests/lib/scheduled-job-one-shot.test.ts` 共 29 项；`tests/server/scheduled-jobs-one-shot-patch.test.ts` 6 项；`tests/integration/scheduled-job-one-shot-fireat.integration.test.ts` 真实 PostgreSQL 9/9，包含"Route 与 Agent `schedule.update` 在同一 `fireAt` 上产出相同 `nextRunAt`/`cron`"的防漂移断言。
- 本轮另外修掉两处**已存在**的缺陷：`isValidCron` 只调 `parse()` 而 cron-parser 是惰性的（未知时区要到 `next()` 才抛），导致它对非法时区返回 `true`；以及一次性路径的未知时区会让 `Intl` 抛出裸 `RangeError` 变成 500——而**修复前**同一请求走周期路径返回的是 400，属本次改动会引入的回归，故在共享契约内加类型化守卫，两处均改为 400。
- `npm run check:quick` exit 0：资产检查、TypeScript、ESLint 与 70 文件/457 项 Vitest 全部通过（本 feature 前基线为 67 文件/414 项）。`npm run test:component` 单独 14 文件/43 项通过，确认组件测试中固定的 `process.env.TZ = "Asia/Shanghai"` 未泄漏到其他文件。
- 覆盖率：新增 `lib/scheduled-job-one-shot.ts` lines/statements/functions 100%、branches 89.28%，`lib/zoned-time.ts` lines 94.87%、branches 83.33%，均高于现有门槛。
- 最终 `sudo -n -g docker -u dadalv ./scripts/run-node22.sh npm run check:full` 单次 `EXIT=0`：TypeScript、ESLint、70 文件/457 项 Vitest、Next.js 16.3.3 production build、覆盖率（All files 46.52/41.77/51.75/47.32）、19 文件/57 项真实 PostgreSQL 与 **26/26 Playwright** 全部通过。E2E 为默认（dev 模式）`playwright test`，5.0 分钟，0 failed/flaky/skipped。
- 更正一处记录：本轮初稿曾把当前基线的 Playwright 数写成 `11/11`，那是 feat-039 时期**默认套件**的历史值；feat-040 加入 agent-entry spec 后默认套件已增至 26 项。历史行保留其当时的真实数字，当前基线改为 26/26（依据本轮原始输出 `26 passed (5.0m)`）。
- 状态归一：上述 `70/457` 与本 feature 前 `67/414` 是 feat-042 验收时的原始输出，其中各包含后来按用户要求回退的 1 个无关 logo 测试；回退后本次 `./init.sh` 与 `npm run check` 均 exit 0，当前 quick/coverage 均为 `69/456`，production build 通过，覆盖率为 46.52/41.77/51.75/47.32；不改写历史门禁证据。
- Harness 复核：feature 共 42 个、ID 连续至 feat-042、全部 `done` 且无活动/阻塞项；`harness-creator` validator 为 100/100，跨文件语义断言全部通过。`coverage/` 已移入系统回收站，`git diff --check` exit 0；本次只修正状态文件，保留现有 `logo.png` 与其他用户改动。

### 清理、边界与下一步

- 未改 `agent/scheduler-tick.ts` 的 claim/CAS/触发语义（QAM-04）、未处理 QAM-03-003（参与者身份）。
- 残留并如实记录：合成 cron 描述的是用户请求的时刻而非宽限后推的 `nextRunAt`（"已过期但在宽限内"时相差数秒）；该 Job 为 `runOnce`、触发时即禁用，不影响触发结果，其超出 missed window 的残余语义归 QAM-04-002。
- **QAM-04 复审触发条件已命中**：`docs/optimization/qam-04-scheduler-quality-review.md` 把"修改 QAM-03 ScheduledJob PATCH/Tool update，尤其改变 `nextRunAt` 的时间或 enabled 语义"列为复审触发条件，本次 `once→recurring` 重算与 `fireAt` 合成 cron 正属此类。本次**不改** `agent/scheduler-tick.ts` 的 claim/CAS/派生，`tests/integration/scheduler-atomic-dispatch.integration.test.ts` 在本轮全量 PostgreSQL 中仍然通过（1/1）；但 QAM-04 的评分是否需重算应由下一次 QAM-04 会话按其自身证据判断，本 feature 不代为改分。
- 该界面**没有**浏览器旅程（`tests/e2e/` 无 scheduled-job spec），故按 AGENTS 的分层要求由 lib + server + component + 真实 PostgreSQL 四层承载回归；不声称浏览器层验收。
- 唯一推荐下一步：登记一个独立的 QAM-04 调度器质量复审 feature，使用 `xoxo-qam-04-scheduler-review` 核对 feat-042 触发的时间语义影响；只做既有实现审查，不在同一 feature 中增加调度功能。

## 2026-09-11 — feat-041 依赖审计新增公告处理完成

### 交付与范围

- feat-041 已按独立依赖升级范围完成并标为 `done`；未修改 Agent Entry、邮件业务契约、Prisma schema/migration 或部署拓扑。直接生产依赖 Nodemailer 从 `^9.0.5` 升至同主版本已修复下限 `^9.1.1`，锁文件将 Browserslist 从 4.28.2 升至 4.28.9、js-yaml 从 4.3.1 升至 4.3.2。
- 审计继续发现的低中风险传递依赖均可在既有 semver 范围内修复，因此一并更新 qs 6.16.0、postcss-selector-parser 6.1.4、tsx 4.23.13/esbuild 0.28.2；未引入新依赖或主版本迁移。
- 新增 `tests/lib/smtp-email-provider.test.ts`，通过公开 `sendEmail` 路径验证 SMTP transport 配置、收件人/Reply-To/正文载荷及成功 messageId；测试只模拟 Nodemailer 供应商边界，不访问真实网络或凭据。

### 验证证据

- 升级前使用 npm 官方 registry 的生产审计为 2 low/2 moderate/2 high，全量为 2 low/2 moderate/3 high；升级后 `npm audit --omit=dev --json --registry=https://registry.npmjs.org` 与 `npm audit --json --registry=https://registry.npmjs.org` 均 exit 0、`total=0`。剩余 low/moderate/high/critical 全为 0，因此没有需延期的公告；后续计划是在每次依赖变更与标准门禁中继续用官方 registry 复审。
- `npm run test:unit -- tests/lib/email.test.ts tests/lib/smtp-email-provider.test.ts` exit 0：2 文件/7 项。最终解析版本为 Browserslist 4.28.9、Nodemailer 9.1.1、js-yaml 4.3.2、qs 6.16.0、根级 postcss-selector-parser 6.1.4、tsx 4.23.13 与 esbuild 0.28.2。
- `sudo -n -g docker -u dadalv ./scripts/run-node22.sh npm run check:full` 的快速门禁 66 文件/413 项、Next.js 16.3.3 production build、覆盖率及真实 PostgreSQL 18 文件/48 项均通过；覆盖率 statements 44.60%、branches 39.25%、functions 49.32%、lines 45.35%。命令随后在 Playwright WebServer 启动前 exit 1，原因为项目已有用户开发进程 PID 24031 持有 `.next/dev/lock`：`Another next dev server is already running.`，不是测试断言或代码失败。
- 未终止用户进程；将同一工作树复制到隔离临时目录、复用锁定 `node_modules` 后运行 `sudo -n -g docker -u dadalv ./scripts/run-node22.sh npm run test:e2e`，exit 0、26/26。清理生成物后最终 `./init.sh` exit 0：Prisma generate、资产检查、TypeScript、ESLint 与 66 文件/413 项 Vitest 全部通过。

### 清理、边界与下一步

- 本次 `coverage/`、`playwright-report/`、`test-results/` 已移入系统回收站，290 MiB 隔离副本已删除；Docker 只保留既有健康 `xoxo-meridian-postgres`。用户运行中的开发服务及未跟踪 `产品logo.png`、`产品logo.png:Zone.Identifier` 均未触碰。
- 依赖审计当前无剩余低中风险，不需要为本轮再登记升级 feature。全部 41 个已登记 feature 均完成；唯一推荐下一步：由产品优先级决定并登记一个新的独立 feature，完成依赖和验收标准确认后再按单 feature 工作流启动。

## 2026-09-11 — feat-040 全局 3D Agent Entry 完成（S0–S8）

### 交付与范围

- feat-040 已满足计划验收并标为 done；两个主题均按用户“两个均选择 5%”的决定提升正式 GLB。default：1829016 bytes / 94703 面；birthday：2046212 bytes / 97721 面；均三张 2048 JPEG、validator 0 error / 0 warning。原始源 hash 未变，8 份候选报告、可重复 recipe 与选择记录已归档，20 MB 临时候选已清理；2026-09-11 用户进一步要求删除 `docs/spec` 中用于评审的 PNG/JSON，结论和指标已并入 README 与本记录。
- app/layout.tsx 保持 Server Component；components/agent-entry 实现 server-only resolver、序列化 Registry、匿名/Chat 冷启动零 3D 请求、认证探测取消、动态加载、真实首帧解锁、原生键盘/触摸/Tooltip/reduced-motion、Chat 往返缓存及故障隔离。使用 R3F createRoot 和 DOM useGLTF 错误边界处理锁定库版本的异步错误；Canvas 自有资源按卸载释放。
- 窄屏布局回归发现保存按钮遮挡，Entry 就绪时增加按主题布局计算的文档末尾滚动空间；个人设置、Study、Post 详情/编辑/删除确认均已在 320/390/1280 px 浏览器验证，业务表单未修改。
- proxy.ts 精确增加本地 Meshopt WASM 与内嵌纹理 blob 权限，生产 JavaScript unsafe-eval 仍禁用。next.config.mjs 在 Next 加载 .env* 后内联主题缺省值，Dockerfile/Compose 显式传入构建主题；运行时反转主题不会改变模型。
- 依赖、资产脚本与 checker、组件/Node/E2E 测试、生产 E2E 启动器、Compose 资产核查和环境说明全部交付；Prisma schema/migration、Agent Runtime 与其他业务功能未改。

### 最终验证证据

- `sudo -n -g docker -u dadalv ./scripts/run-node22.sh env E2E_APP_MODE=production E2E_SOFTWARE_WEBGL=true NEXT_PUBLIC_AGENT_ENTRY_THEME=birthday-2026 npm run check:full` 各阶段通过：64 文件/409 项 Vitest、production build、覆盖率、18 文件/48 项 PostgreSQL，及生日主题 production 26/26 Playwright。跨日恢复后原 PTY ID 已失效；落盘 HTML report 的 stats 为 total=26 / expected=26 / unexpected=0 / flaky=0 / skipped=0 / ok=true / errors=[]，.last-run.json 为 passed，未虚构丢失的进程退出码。
- 该全量运行包含生日主题专用脚本的全部 16 条及原有 10 条旅程，因此不再重复同一生日构建。default 独立命令 `sudo -n -g docker -u dadalv ./scripts/run-node22.sh npm run test:e2e:agent-entry:production:default` 退出 0、16/16；两轮分别在启动时反转为另一主题，仍只请求构建主题的 GLB，无外部 decoder/HDR、CSP violation 或入口 pageerror。
- 最终构建缺省值回归 `npm run test:unit -- tests/lib/agent-entry-build-config.test.ts` 为 3/3，真实 Next loadConfig 验证缺省、.env.production.local 与显式环境优先级。该测试在 full 的快速阶段后增加；最终 `./init.sh` 纳入后为 65 文件/412 项、Prisma generate、类型/lint 和正式资产全部通过（正常权限边界 exit 0）。
- 2026-09-11 受限沙箱的首个 `./init.sh` 返回 exit 1：64 文件/409 项通过，配置测试 3 项因 Node 子进程空 stdout 在 JSON.parse 报 Unexpected end of JSON input；按 AGENTS 同一 Node 22 在正常权限边界原命令复跑 exit 0、65/412。未将沙箱差异当作代码缺陷。
- 覆盖率 statements 44.38%、branches 38.94%、functions 48.87%、lines 45.10%，超过现有门槛。最终测试发现为 `npm run test:e2e -- --list` 的 5 文件/26 条。
- 最终 Compose 命令为 `sudo -n -g docker -u dadalv ./scripts/run-node22.sh env HTTP_PROXY=http://127.0.0.1:7897 HTTPS_PROXY=http://127.0.0.1:7897 NO_PROXY=localhost,127.0.0.1 DOCKER_CONFIG=/tmp/agent-entry-docker-net/docker-config BUILDX_BUILDER=agent-entry-proxy-builder npm run test:compose-smoke`，退出 0；项目 xoxo-meridian-smoke-230500-335abfd1，Web 镜像 140131614 bytes，仅两个正式 GLB。init migrate/seed exit 0、Web health/DB 探测、Worker durable plan/final/可见消息均通过，项目容器、网络、卷、镜像自动清理。
- `sudo -n -g docker -u dadalv ./scripts/run-node22.sh npm run check:compose-config` 退出 0，缺省/default/birthday 三组构建参数均通过。更早的 Docker Hub 连接拒绝、缺失测试配置依赖 TS2307、开发模式 Performance.measure/Study 超时与布局探测失败保留于下方阶段记录；最终生产验证未屏蔽错误、跳过用例或降低断言。

### 清理、边界与下一步

- 清理本次 public/.agent-entry-candidates、coverage、playwright-report、test-results（含测试凭据、失败日志与临时截图）、临时预览路由、Buildx builder/volume、导入 BuildKit 镜像及 /tmp/agent-entry-docker-net。2026-09-11 后续清理又删除 `docs/spec/agent-entry-review` 下 17 张 PNG 与 3 个 JSON，并清除 813 MiB 的旧 `.next` 和根目录 `tsconfig.tsbuildinfo`（516 KiB）；测试统计、性能观测、hash 和复建命令保留为文本，`next-env.d.ts` 恢复原内容。用户从 VS Code 终端启动的 `npm run dev` 仍在运行并重新建立 117 MiB 的 `.next/dev`，该活动服务缓存未作为 feat-040 遗留删除。
- 跨日 Docker 复核先因沙箱 no new privileges 失败，正常权限对照又因 WSL socket 尚未恢复报 connect: no such file or directory；socket 恢复后，同一 `sudo -n -g docker -u dadalv ./scripts/run-node22.sh docker ps -a --format '{{.Names}} {{.Image}} {{.Status}}'` 退出 0，仅既有健康 xoxo-meridian-postgres。镜像仅保留既有 postgres:16-alpine 与 testcontainers/ryuk:0.14.0，无本次临时镜像。
- 软件 Chromium 已验证静止停止绘制、3 次路由往返单 Canvas、键盘/触摸、窄屏/横屏及输入时缩短视口；实测数据见评审目录。未取得实体手机性能、系统软键盘或非零安全区实测，不将模拟视口/软件渲染结果描述成实体设备验收。
- 依赖审计仍有既有生产 2 high（Browserslist、Nodemailer）及开发 js-yaml high，已登记独立 feat-041，风险、原因和升级计划见该 feature；本次未声称审计清零。
- 清理后的最终 ./init.sh（2026-09-11 11:04，正常权限边界）再次 exit 0，65 文件/412 项；harness-creator 结构核验为 100/100，JSON 状态为 40 done、1 not-started，git diff --check 与最终状态核对通过。
- 唯一推荐下一步：按单 feature 工作流启动 feat-041，核对并升级受影响依赖，完成邮件适配回归与风险匹配门禁。

以下为 2026-09-10 实施期间的阶段记录，其中“正在进行”仅描述当时状态。

## 2026-09-10 — feat-040 Agent Entry 实施中（S0–S7）

- 依次读取项目约束、状态、交接与原设计/实施计划；feat-039 已 done，开始时工作树干净，feat-040 为唯一 in-progress。
- Node v22.23.2/npm 10.9.8；初始 ./init.sh 退出 0：60 文件/360 项测试、类型/lint、Prisma generate 通过。原始两个 GLB hash 与实施计划一致。
- 锁定 Three 0.185.1、@types/three 0.185.4、R3F 9.7.0、Drei 10.7.8、server-only 0.0.1；资产 CLI/core/extensions 4.5.0、validator 2.0.0-dev.3.10、meshoptimizer 1.2.0、sharp 0.35.4。首次 npm install 因现有 ^react 被求解为 19.3.0 与 R3F <19.3 peer 不兼容而 ERESOLVE；将 React/React DOM 明确固定为既有 19.2.8 后安装成功，没有使用 force/legacy-peer-deps。
- 以 Chromium 加载已安装 three-stdlib 的实际 MeshoptDecoder 本地模块：原 production script-src self/unsafe-inline 返回 CompileError 与 script-src violation；加入 wasm-unsafe-eval 后 decoder.ready 成功、violations=[]。proxy 仅增加 WASM 权限；security-headers 回归修复前 5/6，修复后 6/6。
- npm ls three @react-three/fiber @react-three/drei @types/three react react-dom --depth=0 退出 0。npm audit --omit=dev 默认镜像返回 404 NOT_IMPLEMENTED；npm audit --omit=dev --registry=https://registry.npmjs.org 与全量同参数审计实际退出 1，生产 2 low/2 moderate/2 high，全量 2 low/2 moderate/3 high。既有 Browserslist 4.28.2、Nodemailer 9.0.5 和开发 js-yaml 4.3.1 公告登记为独立 feat-041；不使用旧审计结论声称本轮无 high。
- 用户已完成两主题 5% 选型，正式资产和实现均已落盘；当前正在完成最终生产门禁与清理，feature 暂不标 done。

# 进度日志

### 已选正式模型与当前验证

- 用户查看当时生成的候选对比与完整记录后明确回复“两个均选择 5%”；selection.json 保存精确路径/hash，两个 promote 命令成功，正式 GLB 已接入 check:quick。default：1829016 bytes、94703 面、SHA-256 f8a6b76bbe0658c6f322cd7ed5989173efcafd03b6dca072e5002bac409b12d2；birthday：2046212 bytes、97721 面、SHA-256 a7ec571a233f7ae0b569a0c525cbcab6d5f33988ea005a6d940d8ce8d7c9dab1。纹理均三张 2048 JPEG；两次完整候选生成的所有 hash 一致。评审 PNG/JSON 在选型完成后按用户要求清理。
- 第一轮候选有 generated tangent space warning，增加显式 CLI tangents 步骤后 8 个候选 validator 0 error/0 warning；15%/10% 面数超限仅作参照，5%/7.5% 合格。GLB checker 实际解码 Meshopt 后再次 validator 并核对默认场景实例数。源 hash 未变，源与候选不进入 Docker context。
- 真实生产浏览器发现 ImageBitmapLoader fetch(blob:) 被原 connect-src self 拦截；增加精确 blob: 权限，保留同源限制。真实 source decoder WASM 对照、GLB 纹理与初帧已实测。未创建常驻预览 flag；临时评审路由已删除，截图与参数保留。
- R3F 9.7 内建 Canvas 的异步初始化异常不传给 DOM boundary，改用官方 createRoot + 原生 canvas 显式捕获。浏览器错误注入又证明 R3F 会把 caught error 通过 reportError 变成 pageerror；useGLTF 改在 DOM Suspense/ErrorBoundary 加载并缓存，再把独立 clone 交给 R3F primitive，避免给宿主重新报告已处理错误。
- 阶段 npm run check 退出 0：64 文件/407 项、production build、覆盖率 43.72/37.99/48.42/44.44%；该次尚含临时评审路由，不替代最终门禁。定向 Node 32/32、组件 20/20；PostgreSQL 全量 18 文件/48 项通过。测试发现共 22 条，后新增生命周期用例总数将为 23。
- 首轮新 E2E 8/12：匿名页测试错误地寻找不存在的 link；404/损坏暴露上述 R3F reportError；chunk 故障因 helper 错读 production manifest 未注入。已分别改为键盘滚动、DOM 加载边界、按 development 使用 .next/dev manifest，正在重跑。
- Compose 两次在 Docker Hub auth 端点连接拒绝；创建独立 agent-entry-proxy-builder，并用临时 Docker 配置和本机代理重跑，Alpine npm ci 已通过，构建进行中。没有改变既有服务/daemon 配置或默认 builder；后续必须清理该 builder、临时配置与导入镜像。
- 新发现既有生产 high 仍归独立 feat-041，未扩展到邮件/构建依赖升级；不宣称审计清零。


- 默认主题 production 命令 `sudo -n -g docker -u dadalv ./scripts/run-node22.sh npm run test:e2e:agent-entry:production:default` 退出 0，16/16 通过，包括新增 320/390/1280 px 个人设置、Study、Post 详情/编辑/删除确认控件检查。构建 default、启动 birthday 的反向配置仍只请求 default GLB。开发模式 React Performance.measure 负时间戳在该 production 运行未出现。
- 新布局回归修复前 `env PLAYWRIGHT_BASE_URL=http://127.0.0.1:3100 E2E_EXTERNAL_ISOLATED=true E2E_APP_MODE=development NEXT_PUBLIC_AGENT_ENTRY_THEME=default E2E_SOFTWARE_WEBGL=true npm run test:e2e -- tests/e2e/agent-entry-authenticated.spec.ts --grep '页面表单' --no-deps --output=test-results/layout-probe` 为 1/3：320/390 px 保存按钮被入口拦截。Entry 就绪后增加按 Registry 尺寸计算的文档末尾滚动留白，保持业务表单不变；上面的 production 16/16 已覆盖修复。一次复用已即将退出的开发服务重跑 `--output=test-results/layout-fixed` 为 0/3，首项 ready 超时、后两项 ERR_CONNECTION_REFUSED；随后改为独立 production 启动验证。
- `sudo -n -g docker -u dadalv ./scripts/run-node22.sh env E2E_SOFTWARE_WEBGL=true npm run check:full`：64/409、production build、coverage、PostgreSQL 18/48 通过，development Playwright 19/23；两个新测试因 ChatIndexPage Performance.measure 负时间戳失败，两个既有 Study 用例因启动请求超过 5 秒、遗留活动状态导致后续等待超时。该轮曾并行复用开发服务进行布局探测，不作为最终隔离门禁结论；当前使用 production 隔离服务重新运行完整门禁，未屏蔽 pageerror 或降低断言。
- Compose smoke 已通过一轮：临时代理命令见下方记录，项目 xoxo-meridian-smoke-193221-00f43fcd，init exit 0、Web 健康、Worker durable plan/final/消息通过；Web 镜像 140129435 bytes，只含两个正式 GLB。第三次构建曾报 playwright.config.ts 导入的 tests/e2e/support/app-mode 不在 Docker context（TS2307），已将 Playwright 配置与测试目录一并排除；最终 UI 布局修复后正在复跑 Compose。
- 布局修复后 `npm run check:quick` 退出 0，64 文件/409 项。完整候选 JSON 已归档到 3d-source/agent-entry/candidate-reports；当时的评审截图包含精确相机、变换和布局参数，选型完成后按用户要求删除，参数保留在 Registry 和文字记录中。


- 最终构建缺省值放在 next.config.mjs 的 env 中：Next 读取 .env* 后才提供 default，显式进程环境仍优先；移除早先 package build 中会遮蔽 .env 的 shell 缺省值。应用运行时仍只有 server-only resolver 消费主题变量。新增 tests/lib/agent-entry-build-config.test.ts 在独立目录/进程调用锁定 Next 真实 loadConfig，缺失、文件 birthday、显式 default 覆盖三个回归 3/3；`npm run typecheck` 退出 0。后续生产 E2E 的构建及 Compose 均消费此最终配置。
- 两次已通过的 Compose 命令均为 `sudo -n -g docker -u dadalv ./scripts/run-node22.sh env HTTP_PROXY=http://127.0.0.1:7897 HTTPS_PROXY=http://127.0.0.1:7897 NO_PROXY=localhost,127.0.0.1 DOCKER_CONFIG=/tmp/agent-entry-docker-net/docker-config BUILDX_BUILDER=agent-entry-proxy-builder npm run test:compose-smoke`；第二次项目 xoxo-meridian-smoke-220100-4182e144、Web 140131515 bytes、init/Web/Worker 全部通过且项目清理成功。此代理仅用于本机 Docker Hub 连接限制，不加入仓库运行配置；最终 Next 配置后复核使用相同命令。
- `sudo -n -g docker -u dadalv ./scripts/run-node22.sh npm run check:compose-config` 退出 0，缺省、default、birthday 三组均验证 4 服务、主题 build args、production runner 与 inline=false。`npm run test:e2e -- --list` 最终发现 5 文件/26 条。


## Current State（当前状态）

Last Updated：2026-09-11。共登记 42 个 feature，feat-001 至 feat-042 均为 `done`；当前没有 `not-started`、`in-progress` 或 `blocked` feature。当前 quick/coverage 基线均为 69 文件/456 项 Vitest，production build 通过；feat-042 验收时的 70/457 是包含后来回退之无关 logo 测试的历史原始输出。最新验收证据与唯一推荐下一步见本文件首条，其他日期记录保留历史状态。

## 2026-09-10 — feat-039 ScheduledJob active cap 并发绕过修复

### 已完成

- 按唯一活动 feature 只关闭 QAM-03-002；没有修改 one-shot `fireAt`、participant 身份顺序、QAM-04 Scheduler 触发、Prisma schema/migration 或产品能力。
- 新增 `lib/scheduled-job-authoring.ts`：以 Room `SELECT ... FOR UPDATE` 作为稳定串行化事实源，在同一 transaction 内重算 active count 并执行 create 或 disabled→enabled；已启用 Job 的普通编辑不重复消耗容量。
- ScheduledJob Route POST/PATCH 显式开启 Prisma interactive transaction，并将 cap 领域冲突稳定映射为 409；Agent `schedule.create/update` 复用 Tool Registry 既有的 `database-write` transaction，移除跨入口重复计数逻辑并补齐 Agent re-enable cap。
- 新增真实 PostgreSQL Route/Agent 混合并发回归：delay trigger 放大 enabled INSERT 与 disabled→enabled 窗口，覆盖 create、re-enable、无孤儿记录和满额时 active edit。使用 `xoxo-qam-03-life-plan-review` 仅重算直接受影响维度，QAM-03-002 转为 resolved，QAM-03 从 69/L1 提升为 81/L2（Score L3、Gate L2）；QAM-03-001/003 两项 P1 保持开放。
- 使用 `harness-creator` 维护单 feature 状态、验收证据和恢复路径；并行存在的 Agent Entry 设计、原始 GLB 与 `docs/spec/` 用户改动均原样保留。

### 验证证据

- 开始与清理后的最终 `./init.sh` 均退出 0：Prisma Client、TypeScript、ESLint、60 文件/360 项 Vitest 全部通过；定向 `tests/agent/schedule-tool.test.ts` 为 17/17，`npm run check:quick` 同样为 60 文件/360 项通过。
- 首次执行 `sudo -n -g docker -u dadalv ./scripts/run-node22.sh npm run test:integration -- tests/integration/scheduled-job-active-cap.integration.test.ts` 时，Docker Desktop 的 WSL mount 尚未出现，Testcontainers 在收集前报告 `Could not find a working container runtime strategy`；`docker info` 恢复为 Server 29.7.2 后，同一权限边界命令可正常运行，未把环境失败计为代码结果。
- 临时移除 service 中两处 Room 行锁的负向对照为 0/2：create 与 re-enable 的 Route/Agent 两个请求均实际 `success/success`；立即恢复锁后先为 2/2，加入 active edit 回归后最终为 3/3，两个竞争场景均恰一成功/恰一冲突、active count=30 且无孤儿 Job。
- 全量 `npm run test:integration` 为 18 文件/48 项通过，包含既有 QAM-04 Scheduler 原子派生回归。最终 `sudo -n -g docker -u dadalv ./scripts/run-node22.sh npm run check:full` 单次退出 0：TypeScript、ESLint、60 文件/360 项 Vitest、Next.js 16.3.3 production build、覆盖率、18 文件/48 项真实 PostgreSQL integration 与 11/11 Playwright 全部通过。
- 覆盖率为 statements 42.54%、branches 36.58%、functions 47.83%、lines 43.22%，均高于门槛；既有故障注入的 Prisma `P0001`/唯一约束日志和 WebServer 一次 `The destination stream closed early` 日志均未造成测试失败。

### 范围、清理与下一步

- 未新增依赖或修改锁文件、环境变量、schema、migration、Docker/Compose；Room 锁只保护 ScheduledJob authoring，Scheduler 的到期 claim/CAS/派生语义未改。
- 完整门禁生成的 `coverage/`、`playwright-report/` 和 `test-results/` 已移入系统回收站，可恢复；`next-env.d.ts` 已恢复 production types。Docker 只保留既有且健康的 `xoxo-meridian-postgres`，无 Testcontainers 残留。
- 唯一推荐下一步：按已登记顺序启动 feat-040，先依 `docs/spec/2026-09-10-agent-entry-implementation-plan.md` 的 S0 完成版本/依赖/基线核对；不要同时处理 QAM-03-001 或 QAM-03-003。

## 2026-09-10 — Agent Entry 设计审查与实施计划（仅文档）

### 产出与范围

- 按用户要求审查 `docs/plan/2026-09-09-agent-entry-design.md`，并把审查意见和详细实施计划写入 `docs/spec/2026-09-10-agent-entry-implementation-plan.md`；原设计与两个已暂存的原始 GLB 保持原样。
- 文档记录 9 项发现：生产 CSP/WASM、Docker 构建参数、E2E 测试发现与生产模式为 P1；首帧 ready、资源/错误生命周期、Tooltip、优化管线、探测/导航竞态和人工评审顺序为 P2。这些是设计实施风险，不是新增 QAM 缺陷评分。
- 给出 S0–S8 顺序步骤、组件与状态契约、依赖/文件范围、资产预算及 recipe、人工质量检查点、测试矩阵、门禁命令和恢复路径。
- `feature_list.json` 仅追加 feat-040 为 `not-started`，以 feat-039 作为工作流排期前置；未启动第二个活动 feature。当前另有 ScheduledJob authoring service、Route/Tool 和测试改动，本次未修改或验收它们。

### 验证范围与证据

- 通过 `./scripts/run-node22.sh node --input-type=module -e '…'` 两次只读诊断，核验 GLB JSON/索引/Buffer 与 sharp JPEG 元数据：default 为 60,745,800 bytes、1,894,099 面；birthday 为 62,241,580 bytes、1,954,449 面；两者纹理均为 8192²、4096²、4096²，源 SHA-256 已写入计划。
- 对照当前 Layout、认证探测/跳转、CSP、Docker/Compose、Playwright/Vitest 与本地 Next.js 指南；官方来源链接随对应审查结论写入计划。Meshopt 生产 CSP 风险标为待实测推断，未宣称已复现。
- 文档相对链接与 feature JSON 检查退出 0：ID 无重复，唯一活动项为 feat-039，feat-040 为 not-started，R01–R09 与 S0–S8 各 9 项；`git diff --check` 退出 0，`git status --short` 确认本次文档/状态文件及其他任务改动均保留。
- `./init.sh`、`npm run check`、`npm run check:full`、`npm run test:compose-smoke`：本次均未运行。原因是用户请求仅为审查和编写计划，未实施产品代码，且仓库已有其他活动 feature；不将旧门禁结果当成本次结果，不声明实现完成或会话清洁退出。
- 本次没有安装依赖、创建测试数据、启动服务/容器或生成 GLB 候选，无本次临时测试资源需要清理；所有产品验收仍待 feat-040 实施时执行。

### 唯一推荐下一步

保留并收尾当前 feat-039；其状态满足依赖要求后，再依照实施计划 S0 启动 feat-040，不并行启动第二个实现 feature。

## 2026-09-09 — feat-038 最后房间并发删除竞态修复

### 已完成

- 按唯一下一步只关闭 QAM-02-004；没有修改房间 wipe、消息 trace、SSE、Prisma schema/migration、共享房间产品策略或其他 QAM。
- 新增 lib/room-lifecycle.ts：deleteRoomPreservingUserMembership() 在 Prisma interactive transaction 中先对当前 User 执行 SELECT ... FOR UPDATE，再在同一临界区重新验证目标 RoomParticipant、统计该用户成员关系并删除 Room；同一用户的所有删除请求因此共享稳定串行化事实源。
- Room DELETE Route 保留认证、事务外早期成员校验、按用户/IP 限流和原有 200/409 响应 contract，只把生命周期写入委托给领域服务。事务内二次成员校验防止授权与实际写入之间的状态变化。
- 新增真实 PostgreSQL Route Handler 回归：对 Room DELETE 安装延迟 trigger，稳定放大旧实现的 count → delete 窗口；并发删除同一用户仅有的两个房间时，修复前两个请求都返回 200，修复后严格收敛为 200/409、数据库保留一个 RoomParticipant，并直接执行 ChatIndexPage 验证 /chat 重定向到剩余房间。
- 使用 xoxo-qam-02-room-message-review 只重算并发/生命周期与验证直接影响的维度：QAM-02-004 转为 resolved，QAM-02 从 86/L1 提升到 90/L4，开放项仅余 P2×2；总览同步为平均 78.0、开放 P1×5/P2×31。使用 harness-creator 保持 feat-038 为唯一活动 feature，并同步验收、修复前后证据与清洁重启路径。

### 验证证据

- Node.js/npm 为 v22.23.2 / 10.9.8；开始与最终 ./init.sh 均退出 0，Prisma Client、TypeScript、ESLint、60 文件/360 项 Vitest 全部通过。
- 修复前 sudo -n -g docker -u dadalv ./scripts/run-node22.sh npm run test:integration -- tests/integration/room-delete-invariant.integration.test.ts 为 0/1，原始断言为期望 [200,409]、实际 [200,200]，直接证明两个请求共同删除全部房间。
- 修复后同一定向命令为 1/1；全量 npm run test:integration 为 17 文件/45 项通过。npm run typecheck、npm run lint 与 npm run check:quick 均退出 0，快速门禁为 60 文件/360 项 Vitest。
- 最终 sudo -n -g docker -u dadalv ./scripts/run-node22.sh npm run check:full 单次退出 0：TypeScript、ESLint、60 文件/360 项 Vitest、Next.js 16.3.3 production build、覆盖率、17 文件/45 项真实 PostgreSQL integration 与 11/11 Playwright 全部通过。
- 覆盖率为 statements 42.32%、branches 36.42%、functions 47.72%、lines 43.02%，均高于门槛；集成测试中的 Prisma P0001 和唯一约束日志均来自既有故障注入/约束回归，未造成测试失败。

### 范围、清理与下一步

- 未新增 npm 依赖、修改锁文件、Prisma schema/migration 或部署配置；User 行锁只串行同一用户的 Room DELETE，不改变房间创建、跨参与者策略、wipe、trace 或 SSE。
- 完整门禁生成的 coverage/、playwright-report/ 和 test-results/ 已移入系统回收站，可恢复；next-env.d.ts 已恢复 production types。Docker 只保留既有且健康的 xoxo-meridian-postgres，无 Testcontainers 残留；既有用户改动已保留，与本任务无关的未跟踪 3D_Agent_Entry_Plan.md 未读取或修改。
- 唯一推荐下一步：另行登记并只处理 QAM-03-002，把 ScheduledJob 的 active cap 在 Route create/re-enable 与 Agent Tool create/re-enable 之间收敛为共享事务边界，并用真实 PostgreSQL 并发回归证明 active Job 不超过 30；不要与 one-shot fireAt 或 participant 顺序问题合并。

## 2026-09-09 — feat-037 显式 Agent dispatch 原子幂等派生修复

### 已完成

- 按唯一下一步只关闭 `QAM-02-003`；没有修改 AgentTask claim 后 Runtime/Trace、最后房间删除、message trace、SSE 或其他 QAM。
- 新增 `lib/agent-task-dispatch.ts`：`createAgentTaskWithCreatedEvent()` 统一生成预算快照、Task input 和 `agent.task.created` Event；普通消息在既有 Message transaction 中复用，显式 dispatch 在单一 interactive transaction 中锁定同一 source Message 后复用，Event 写入失败会连同 Task 回滚。
- 显式 source-message 入口以 `SELECT ... FOR UPDATE` 串行同一消息的并发请求，再读取 `AgentTask.sourceMessageId @unique` 事实：首次创建返回 201，重放或并发请求返回相同 Task 的 200；唯一冲突捕获只作为自动消息入口与显式入口跨路径竞争的兜底。
- Route 保留认证、rate limit、Zod、Room 成员资格和 inline-run 契约；显式请求命中既有 pending Task 时仍可交给既有 claim 机制执行。新增真实 PostgreSQL 回归覆盖并发、EventLog trigger 故障回滚/重试，并验证普通消息自动派生仍持久化相同预算、input 和 created Event。
- 使用 `xoxo-qam-02-room-message-review` 只重算派生边界、状态一致性、接口与并发验证直接影响的维度：`QAM-02-003` 转为 `resolved`，QAM-02 从 78 提升到 86、Score L2→L3；最后房间删除 P1 仍开放，因此 Gate/Final 保持 L1。使用 `harness-creator` 维持 feat-037 为唯一活动 feature，并同步验收、修复前后证据与唯一下一步。

### 验证证据

- Node.js/npm 版本为 v22.23.2 / 10.9.8；开始 `./init.sh` 退出 0，Prisma Client、TypeScript、ESLint、60 文件/360 项 Vitest 全部通过。
- 修复前 `sudo -n -g docker -u dadalv ./scripts/run-node22.sh npm run test:integration -- tests/integration/agent-dispatch-atomicity.integration.test.ts` 为 0/2：同一 source Message 并发响应实际为 `[201,500]`（唯一约束冲突），EventLog 注入失败后的 AgentTask count 实际为 1，证明存在孤儿写入。
- 修复后的首次定向运行因测试断言误用 Vitest 不支持的 `toHaveSize` 为 1/2；只将断言改为 `.size` 后为 2/2。加入普通消息共享路径回归后，同命令最终为 3/3：并发响应为 200/201 且 Task ID 相同，数据库恰一 Task/一 created Event；故障时二者均为 0，移除 trigger 后相同请求 201 成功。
- `npm run check:quick` 退出 0：60 文件/360 项 Vitest 通过。最终 `sudo -n -g docker -u dadalv ./scripts/run-node22.sh npm run check:full` 单次退出 0：TypeScript、ESLint、60 文件/360 项 Vitest、Next.js 16.3.3 production build、覆盖率、16 文件/44 项真实 PostgreSQL integration 与 11/11 Playwright 全部通过。
- 最终覆盖率为 statements 42.51%、branches 36.55%、functions 47.94%、lines 43.17%，均高于门槛；故障注入用例中的 Prisma `P0001` 日志为预期回滚证据，不是门禁失败。Playwright WebServer 出现一次 `The destination stream closed early` 日志，但所有 11 项用例及组合命令均退出 0。

### 范围、清理与下一步

- 未新增 npm 依赖、修改锁文件、Prisma schema/migration 或部署配置；行锁只串行同一 source Message 的显式派发，QAM-08 的 claim、lease、budget enforcement 与 durable step 生命周期未改变。
- 最终 `./init.sh` 退出 0：Prisma Client、TypeScript、ESLint、60 文件/360 项 Vitest 全部通过。`harness-creator` 校验为 100/100；`feature_list.json` 可解析，37 个 feature 全部为 `done`、活动/阻塞为 0；QAM-02 评分算术、稳定 ID、总览数字与完整门禁证据一致，`git diff --check` 通过。
- 本轮生成的 `coverage/`、`playwright-report/`、`test-results/` 和 `public/models/` 已移入系统回收站，可恢复；E2E 数据库 URL 文件随 `test-results/` 清理，Docker 只保留既有且健康的 `xoxo-meridian-postgres`，无 Testcontainers 残留；`next-env.d.ts` 已恢复到会话开始时的 production types 引用。
- 唯一推荐下一步：另行登记并只处理 `QAM-02-004`，把最后房间删除的 count/delete 收敛为原子、串行化语义，用真实 PostgreSQL 并发 DELETE 证明最多一个请求成功且用户始终保留一个房间；不要与 wipe、message trace 或 SSE 合并。

## 2026-09-09 — feat-036 Room snapshot 私有档案字段泄露修复

### 已完成

- 按唯一下一步只关闭 `QAM-02-001`；没有改变 QAM-01 档案写入/所有权、Room 成员资格或既有公开 UI，也没有处理 message trace、Agent dispatch、最后房间删除或 SSE。
- `getRoomSnapshot()` 的 Room 与 participant/profile 查询改用 Prisma `select`，返回值按显式 view model 组装，只保留 Room `id/name`、用户 `id/displayName/avatarLabel`、公开 `city/country/timezone` 和运行时 `studyStatus`；不再传播完整 Prisma `User`/`UserProfile`。
- Chat 页面将当前用户也收窄为相同公开身份/档案字段，Study 页面传给 `SiteNav` 的用户只保留 `id/displayName/avatarLabel`；移除 Chat 客户端类型中遗留的 `preferences`，避免第二条完整认证对象序列化路径绕过 snapshot 修复。
- 新增真实 PostgreSQL 快照回归，精确断言两个参与者的公开 view model，并扫描序列化结果中的 `email`、`passwordHash`、`sessionVersion`、定位字段、`preferences` 与 `profileNote`。Playwright 向隔离数据库写入唯一私有标记，再直接检查 `/chat/:roomId` 与 `/study` 的完整 RSC/HTML 响应：公开显示名、头像、城市和时区仍可用，私有字段名和值均不存在。
- 使用 `xoxo-qam-02-room-message-review` 只重算 projection、接口、安全和验证直接受影响的维度：`QAM-02-001` 转为 `resolved`，QAM-02 从 71 提升到 78、Score L2，QAM-02-003/004 两个 P1 仍开放，因此 Gate/Final 保持 L1。使用 `harness-creator` 维持 feat-036 为唯一活动 feature，并同步修复前后证据、完整门禁与唯一下一步。

### 验证证据

- 开始 `./init.sh` 退出 0：Prisma Client、TypeScript、ESLint、60 文件/360 项 Vitest 全部通过。
- 修复前 `sudo -n -g docker -u dadalv ./scripts/run-node22.sh npm run test:integration -- tests/integration/room-snapshot-privacy.integration.test.ts` 为 0/1，差异直接显示完整 User/Profile 中的邮箱、密码摘要、sessionVersion、定位、preferences 与 profileNote；修复后同命令为 1/1。
- 修复前 `sudo -n -g docker -u dadalv ./scripts/run-node22.sh npm run test:e2e -- --project=authenticated --grep 'keeps private profile fields'` 为 1/2（setup 通过、隐私用例失败），Chat RSC 载荷直接包含当前用户 bcrypt hash 和双方完整私有档案；修复后同命令为 2/2。
- `npm run check:quick` 退出 0：60 文件/360 项 Vitest 通过。最终 `sudo -n -g docker -u dadalv ./scripts/run-node22.sh npm run check:full` 单次退出 0：TypeScript、ESLint、60 文件/360 项 Vitest、Next.js 16.3.3 production build、覆盖率、15 文件/41 项真实 PostgreSQL integration 与 11/11 Playwright 全部通过。
- 最终覆盖率为 statements 42.72%、branches 36.73%、functions 48.17%、lines 43.40%，均高于门槛；其他 integration 故障注入用例中的 Prisma `P0001` 日志为预期回滚证据，不是门禁失败。

### 范围、清理与下一步

- 未新增 npm 依赖、修改锁文件、Prisma schema/migration 或部署配置；只收窄已有读取 projection 和服务端到客户端的序列化边界。
- 最终 `./init.sh` 退出 0：Prisma Client、TypeScript、ESLint、60 文件/360 项 Vitest 全部通过。`harness-creator` 校验为 100/100；`feature_list.json` 可解析，36 个 feature 全部为 `done`、活动/阻塞为 0；QAM-02 评分算术、稳定 ID、总览数字与完整门禁证据一致，`git diff --check` 通过。
- 本轮生成的 `coverage/`、`playwright-report/` 和 `test-results/` 已移入系统回收站，可恢复；E2E 数据库 URL 文件不存在，Docker 只保留既有且健康的 `xoxo-meridian-postgres`，无 Testcontainers 残留；`next-env.d.ts` 已恢复到会话开始时的 production types 引用。
- 唯一推荐下一步：另行登记并只处理 `QAM-02-003`，把显式 Agent dispatch 的 Task 创建与 EventLog 派生收敛为原子、幂等语义，用真实 PostgreSQL 覆盖相同 source message 并发派发及 EventLog 写入故障回滚；不要与房间删除、message trace 或 SSE 合并。

## 2026-09-09 — feat-035 Focus 到期状态服务端幂等结算修复

### 已完成

- 按唯一下一步只关闭 `QAM-07-002`；没有修改 DST 统计、Goal 排序、Room snapshot、通知、离线学习或其他 QAM。
- `lib/study-transitions.ts` 抽取手动 stop 与到期恢复共用的 settlement helper；`reconcileExpiredFocusTimer()` 在 Prisma interactive transaction 中先锁定当前 `User`，仅处理 `running/focusing` 且 `expectedEndAt <= now` 的状态，以持久化 deadline 作为 `endedAt`，用 `(userId, sessionKey)` upsert completed Session 并将 state 写为 idle。
- `getStudyPageData()` 在读取 FocusState、Session 统计和 Room 数据前执行 reconciliation，因此 `/api/study` GET 与服务端 `/study` 页面共享恢复语义。`startFocusTimer()` 在同一事务先结算过期旧 key 再开启请求的新 key，`stopFocusTimer()` 对过期 running state 同样使用计划截止时间；未到期 running 和 paused 不会被误结算。
- 活动 legacy state 缺少 `currentSessionKey` 时先条件修复独立旧 key；过期后 start 的新 key 与旧完成记录不会混用。既有客户端 auto-stop 保留为及时 UI 路径，但不再是完成事实的唯一提交者。
- 新增 5 项真实 PostgreSQL 到期回归，覆盖重复 GET/刷新、GET 与新 start 并发、过期 stop 重放、未到期/paused 不变和 trigger 故障回滚；原有 5 项 keyed transition 回归保持通过。Playwright 在离开 Study 后直接推进隔离测试数据库中的 deadline，重访并刷新，从 UI 与数据库同时验证同 key 恰一条 completed Session。
- E2E 启动器只在本地 Testcontainers 模式下将隔离数据库 URL 以 `0600` 写入 `test-results/.e2e-database-url`，结束时删除；外部 `PLAYWRIGHT_BASE_URL` 必须显式提供匹配的隔离 `E2E_DATABASE_URL`。该测试桥接约束已写入 `docs/testing-standards.md`，不会读取开发、预发或生产数据库。
- 使用 `xoxo-qam-07-study-review` 只重算 reconciliation 直接影响的维度：`QAM-07-002` 转为 `resolved`，QAM-07 从 77 提升到 85、Score L2→L3、Gate/Final L1→L2；当前只剩 P2×2。使用 `harness-creator` 维持 feat-035 为唯一活动 feature，并同步验收、失败/通过证据和唯一下一步。

### 验证证据

- 开始与最终 `./init.sh` 均退出 0；最终结果为 Prisma Client、TypeScript、ESLint、60 文件/360 项 Vitest 全部通过。
- 修复前 `sudo -n -g docker -u dadalv ./scripts/run-node22.sh npm run test:integration -- tests/integration/study-focus-transitions.integration.test.ts` 为 6/10 通过：到期 GET 实际仍为 running；到期后 start 实际保留旧 key；过期 stop 的 `endedAt` 使用请求时间而非 deadline；GET settlement 故障用例预期 500、实际 200。修复后同一套测试为 10/10。
- Study 定向 Node 回归为 4 文件/31 项通过；`npm run check:quick` 为 60 文件/360 项通过；独立全量 `npm run test:integration` 为 14 文件/40 项通过；独立全量 `npm run test:e2e` 为 10/10，通过离开/重访/刷新到期恢复旅程。
- 受限权限边界直接执行 `npm run check` 时 quick 全通过，production build 原始失败为 `Error: Could not parse output from TypeScript's --showConfig.`；依 AGENTS.md 使用相同 Node.js 22 命令在获准正常权限边界复核后退出 0，不能将受限边界假失败记作代码阻塞。
- 最终 `sudo -n -g docker -u dadalv ./scripts/run-node22.sh npm run check:full` 单次退出 0：TypeScript、ESLint、60 文件/360 项 Vitest、Next.js 16.3.3 production build、覆盖率、14 文件/40 项真实 PostgreSQL integration 和 10/10 Playwright 全部通过。覆盖率为 statements 42.67%、branches 36.71%、functions 48.17%、lines 43.40%，均高于门槛；故障注入用例中的 Prisma `P0001` 为预期回滚证据。
- `harness-creator` 校验为 100/100；`feature_list.json` 可解析，35 个 feature 全部为 `done`、活动/阻塞为 0；`git diff --check` 通过，`next-env.d.ts` 已恢复到会话开始时的 production types 引用。

### 范围、清理与下一步

- 未新增 npm 依赖、修改锁文件、Prisma schema/migration 或部署配置；本轮复用 feat-034 已有的 key、唯一约束和行锁事实源。前序 QAM-01/QAM-05/QAM-07-001 的未提交改动全部保留。
- 本轮生成的 `coverage/`、`playwright-report/` 和 `test-results/` 在最终状态检查前移入系统回收站，可恢复；E2E 数据库 URL 文件已由启动器删除，Docker 只保留既有 `xoxo-meridian-postgres`，无 Testcontainers 残留，`.next` 构建缓存保留。
- 唯一推荐下一步：另行登记并只处理 `QAM-02-001`，让 Room snapshot 使用 Prisma `select` 与显式公开字段 allow-list，阻止 `lastGeoIp`、`preferences`、未公开 `profileNote` 等私有 UserProfile 字段进入聊天/Study 浏览器载荷，并补真实页面或 Playwright 隐私回归；不要与消息 trace、dispatch、房间删除或 SSE 问题合并。

## 2026-09-08 — feat-034 Focus 状态转移与原子结算修复

### 已完成

- 按唯一下一步只关闭 `QAM-07-001`；没有实现到期自动 reconciliation `QAM-07-002`，也没有修改 DST 统计、Goal 排序、Room snapshot 或其他 QAM。
- 新增 `lib/study-transitions.ts`，start/pause/resume/stop 均在 Prisma interactive transaction 中先锁定当前 `User` 行，再以 prior status 与 `currentSessionKey` 条件写入。start 为新计时生成 UUID；pause/resume/stop 必须提交当前 key，旧标签页或延迟请求无法作用于后来启动的 Session。
- `FocusSession` 新增非空 `sessionKey` 和 `(userId, sessionKey)` 唯一约束；时间戳迁移为既有 Session 与活动 FocusState 回填稳定 legacy key。stop 以复合唯一键 upsert completed Session，并在同一事务内将 FocusState 写为 idle；重复 stop 返回既有 Session，任一步骤失败会整体回滚。
- 四个 Study 状态 Route 收敛为认证、Zod 输入校验、领域服务调用与响应映射；`serializeFocusState`、Study GET 和 `StudyDashboard` 贯穿公开 `sessionKey`。pause/resume/stop 的状态冲突统一返回 409。
- 新增 8 项 transition service 行为测试和 5 项真实 PostgreSQL 回归；后者覆盖 start→刷新→pause→resume→stop→重放、旧 key 隔离、并发 stop、确定性 pause/stop 交错和数据库 trigger 故障回滚。Playwright 停止旅程明确等待并校验 stop 响应，避免 Next.js 冷编译时在请求完成前提前断言 UI。
- 使用 `xoxo-qam-07-study-review` 只重算 QAM-07-001 直接影响的维度：问题转为 `resolved`，QAM-07 从 62 提升到 77、Score L1→L2；到期 reconciliation P1 仍开放，因此 Gate/Final 保持 L1。总览同步为平均 75.0、开放 P1×9/P2×31。
- 使用 `harness-creator` 保持 feat-034 为唯一活动 feature，并同步 feature 验收、失败/通过证据、清理与唯一下一步；该 Skill 没有扩大业务修改范围。

### 验证证据

- 开始与最终 `./init.sh` 均退出 0；最终结果为 Prisma Client、TypeScript、ESLint、60 文件/355 项 Vitest 全部通过。
- 修复前 `sudo -n -g docker -u dadalv ./scripts/run-node22.sh npm run test:integration -- tests/integration/study-focus-transitions.integration.test.ts` 为 0/3：并发 stop 返回不同 Session ID；stop/pause 交错中的 pause 实际为 200（期望 409）；state settlement 故障后 Session count 为 1（期望 0）。
- 修复后同一定向真实 PostgreSQL 测试扩展为 5/5；全量 integration 为 14 文件/35 项通过。Study 定向 Node 回归 6 文件/36 项通过，新增 transition service 行为 8/8，`npm run check:quick` 最终为 60 文件/355 项通过。
- 第一次完整门禁在生产构建与 347 项测试后失败于覆盖率 branches `34.61% < 35%`；补齐服务行为测试后四项覆盖率均过线。随后一次完整门禁进入 Playwright 后为 8/9：stop 请求在冷编译中仍 pending，旧 5 秒 UI 断言提前超时；修正等待边界后定向 Playwright 2/2 通过。
- 最终 `sudo -n -g docker -u dadalv ./scripts/run-node22.sh npm run check:full` 单次退出 0：TypeScript、ESLint、60 文件/355 项 Vitest、Next.js 16.3.3 production build、覆盖率、14 文件/35 项真实 PostgreSQL integration 和 9/9 Playwright 全部通过。
- 最终覆盖率为 statements 42.42%、branches 36.38%、functions 47.68%、lines 43.17%，均高于门槛。故障注入用例中的 Prisma `P0001` 日志是预期响应/回滚证据，测试结果为通过。

### 范围、清理与下一步

- 未新增 npm 依赖或修改锁文件；schema 变更只增加 FocusSession 幂等键及时间戳迁移，不修改既有迁移。用户此前的 QAM-01/QAM-05 源码、测试与报告改动全部保留。
- 本轮生成的 `coverage/`、`playwright-report/` 和 `test-results/` 在最终状态检查前移入系统回收站，可恢复；`.next` 构建缓存保留。
- 唯一推荐下一步：另行登记并只处理 `QAM-07-002`，复用 keyed transition service，在 Study GET/start/stop 入口对已过 `expectedEndAt` 的 running state 做单事务 reconciliation，并用真实 PostgreSQL 与 Playwright 覆盖刷新/离开后的单次结算；不要与 DST 或 Goal P2 合并。

## 2026-09-08 — feat-033 Agent log 跨房间读取边界修复

### 已完成

- 按唯一下一步只关闭 `QAM-05-005`；没有修改 Post 写入、slug、cursor、Agent log durable projection、搜索失败 UI、Post/Atlas 生命周期或其他 QAM。
- 新增 `lib/post-visibility.ts` 的统一 `getPostVisibilityWhere(userId)`：`user_post` 保持既有全局可见语义；`agent_log` 必须仍有关联 Room，且该 Room 的 `participants` 中存在当前用户。`roomId=null` 的孤儿 Agent log 不会因 Room 删除而变成全局内容。
- `GET /api/posts` 将该条件作为 type、author、cursor 和搜索过滤之外的强制 `AND`；`GET /api/posts/:slug`、`/posts/:slug` 页面和 `/home` 首页复用同一条件。详情查询把 slug 与可见性放在同一数据库查询中，非成员稳定得到 404，不先泄漏记录存在性。
- 新增真实 PostgreSQL 回归：建立 A/B 两个用户与相互隔离的 Room、一个带 B roomId 的全局 `user_post`、双方 Agent log 及删除 Room 后 `SetNull` 的孤儿日志；覆盖列表、type、搜索、详情、首页投影和切换当前用户后的成员可见性。
- 使用 `xoxo-qam-05-content-timeline-review` 只重算读取授权直接影响的架构/复用、数据流、接口、安全与验证维度：`QAM-05-005` 转为 `resolved`，QAM-05 从 64/L1 提升到 73/L2；总览同步为平均 73.3、开放 P1×10/P2×31。
- 使用 `harness-creator` 保持 feat-033 为唯一活动 feature，并同步验收证据、验证、清理和唯一下一步；该 Skill 没有扩大业务修改范围。

### 验证证据

- 开始与最终 `./init.sh` 均退出 0；最终结果为 Prisma Client、TypeScript、ESLint、59 文件/346 项 Vitest 全部通过。
- 修复前 `sudo -n -g docker -u dadalv ./scripts/run-node22.sh npm run test:integration -- tests/integration/post-visibility.integration.test.ts` 为 0/1：用户 A 的列表实际返回 `global-user-post`、A/B 双方 Agent log 和 `orphan-agent-log`，期望只返回前者与 A 房间日志。
- 修复后同一定向真实 PostgreSQL 测试为 1/1：A/B 各只看到全局文章和自己 Room 的 Agent log；`type=agent_log` 与 `q` 搜索不能绕过成员条件；成员详情 200，非成员/孤儿详情 404；首页可见 Post 集合与 API 一致，数据库确认孤儿记录仍存在且 `roomId=null`。
- `npm run check:quick` 退出 0：TypeScript、ESLint、59 文件/346 项 Vitest 通过；旧 Post mock 测试已同步验证新增可见性条件与既有 type/search 组合。
- 独立全量 `npm run test:integration` 为 13 文件/30 项通过；`sudo -n -g docker -u dadalv ./scripts/run-node22.sh npm run check:full` 随后单次退出 0：快速门禁、Next.js 16.3.3 production build、覆盖率、13 文件/30 项 PostgreSQL 和 9/9 Playwright 全部通过。
- 覆盖率为 statements 41.94%、branches 35.92%、functions 46.39%、lines 42.62%，均高于门槛。

### 范围、清理与下一步

- 未新增依赖、修改锁文件、Prisma schema/migration、Agent Runtime、Room 写入或部署配置；关系过滤复用既有 `RoomParticipant(userId)` 与 `(roomId,userId)` 索引，未引入第二套成员事实源。
- 本轮生成的 `coverage/`、`playwright-report/` 和 `test-results/` 已移入系统回收站，可恢复；`.next` 构建缓存及所有前序未提交改动保持不变。
- 唯一推荐下一步：另行登记并只处理 `QAM-07-001`，把 Focus start/pause/resume/stop 状态转移与 Session 结算收敛为使用 `currentSessionKey` 的原子、幂等事务，并用真实 PostgreSQL 覆盖并发 stop、pause/stop 交错与故障回滚；不要与到期自动 reconciliation `QAM-07-002` 或 DST/Goal P2 合并。

## 2026-09-08 — feat-032 并发注册房间容量竞态修复

### 已完成

- 按唯一下一步只关闭 `QAM-01-004`；没有修改已通过 E3 的 Session 签发或密码恢复，也没有处理代理头、日志、旧认证工件和其他 QAM。
- `POST /api/auth/register` 不再在事务外读取默认 Room。注册 Prisma transaction 现在先按 `DEMO_ROOM_SLUG` 执行 `SELECT ... FOR UPDATE`，再使用锁内 `maxHumanUsers` 重新统计 Participant；后到事务必须等先到事务提交后再判断剩余容量。
- Room 锁、容量判断、User + 嵌套 UserProfile 和 RoomParticipant 写入保持在同一事务。默认 Room 不存在仍返回 500，已满仍返回 409，首位/后续注册仍分别得到 owner/member，邀请码、响应体与 Session 签发契约不变。
- 新增真实 PostgreSQL Route Handler 回归：Participant insert delay trigger 稳定制造两个注册同时越过旧 count 窗口；insert failure trigger 验证跨写中途失败不会留下 User/Profile/Participant/Session，并证明移除故障后同一邮箱可重试成功。
- 使用 `xoxo-qam-01-identity-review` 只重算直接受影响的状态一致性、并发生命周期和验证可信度：`QAM-01-004` 转为 `resolved`，QAM-01 从 83 提升到 87，Gate/Final 从 L1 提升到 L4/L3。总览同步为平均 72.3、开放 P1×11/P2×31。
- 使用 `harness-creator` 保持 feat-032 为唯一活动 feature，并同步验收证据、清理和唯一下一步；该 Skill 没有扩大业务修改范围。

### 验证证据

- 开始与最终 `./init.sh` 均退出 0；最终结果为 Prisma Client、TypeScript、ESLint、59 文件/346 项 Vitest 全部通过。
- 修复前 `sudo -n -g docker -u dadalv ./scripts/run-node22.sh npm run test:integration -- tests/integration/registration-capacity.integration.test.ts` 为 1/2 通过、1/2 失败：两个并发注册实际均返回 200（期望 200/409），稳定证明最终槽位被重复消费；Participant 故障回滚对照通过。
- 受限沙箱内首次执行上述 Docker 命令退出 1，原始错误为 `sudo: The "no new privileges" flag is set`；在获准的正常权限边界使用同一 Node.js 22 命令后完成修复前后对照。
- 修复后同一定向真实 PostgreSQL 测试为 2/2 通过：已有 1 名成员时两个不同邮箱恰为 200/409、Participant 保持 2，loser 没有 User/Profile/Session；Participant insert trigger 故障返回 500 且全部跨写回滚，移除故障后同一邮箱成功注册为 owner 并获得 Session。
- `npm run check:quick` 退出 0：TypeScript、ESLint、59 文件/346 项 Vitest 通过；随后全量 `npm run test:integration` 为 12 文件/29 项通过，既有 Session、密码恢复、权限和 Agent/画布事务语义保持可用。
- `sudo -n -g docker -u dadalv ./scripts/run-node22.sh npm run check:full` 单次退出 0：快速门禁、Next.js 16.3.3 production build、覆盖率、12 文件/29 项 PostgreSQL 和 9/9 Playwright 全部通过。覆盖率为 statements 41.87%、branches 35.88%、functions 46.30%、lines 42.60%，均高于门槛。

### 范围、清理与下一步

- 未新增依赖、修改锁文件、Prisma schema/migration 或部署配置；Room 行锁只串行同一默认房间的注册容量临界区，不改变其他房间或注册后的 Session 事务。
- 已清理本轮生成的 `coverage/`、`playwright-report/` 和 `test-results/`；`.next` 作为启动/构建缓存保留，既有未提交改动和数据均未删除。
- 唯一推荐下一步：另行登记并只处理 `QAM-05-005`，为 room-scoped `agent_log` 的列表、搜索、详情和首页读取建立统一成员可见性条件，并用真实 PostgreSQL 跨房间回归证明非成员不可见；不要与 slug、cursor 或 durable projection P2 合并。

## 2026-09-07 — feat-031 Session 原子签发与单活跃语义修复

### 已完成

- 按唯一下一步只关闭 `QAM-01-001`；没有修改注册容量 `QAM-01-004`、代理头、日志、旧认证工件、认证产品策略或 Cookie 响应契约。
- `createSessionCookie()` 将当前浏览器可能切换出的旧用户与目标用户 ID 排序，并委托 `replaceActiveSession()` 在固定顺序取得 PostgreSQL `User` 行锁；相关旧 Session 删除、目标用户 Session 全量失效和新 Session 创建均在同一 Prisma transaction 内完成。
- 事务只对 Prisma `P2034` 冲突/死锁最多重试 3 次；普通业务或数据库错误直接上抛。登录、注册和 `setSessionCookie()` 均继续复用该统一签发入口，没有形成第二套 Session 状态事实源。
- 新增真实 PostgreSQL Route Handler 回归：insert delay trigger 强制两个登录同时越过旧实现的删除窗口；insert failure trigger 验证新记录创建失败时旧 Session 回滚保留；注册正向路径验证签发 Cookie 可访问 `/api/auth/me`。
- 使用 `xoxo-qam-01-identity-review` 只重算直接受影响的状态一致性、并发生命周期和验证可信度：`QAM-01-001` 转为 `resolved`，QAM-01 从 76 提升到 83、Score L2→L3；注册容量 P1 仍开放，因此 Gate/Final 保持 L1。总览同步为平均 71.9、开放 P1×12/P2×31。
- 使用 `harness-creator` 保持 feat-031 为唯一活动 feature，并同步验收证据、环境例外、清理与唯一下一步；该 Skill 没有扩大业务修改范围。

### 验证证据

- 开始与最终 `./init.sh` 均退出 0；最终结果为 Prisma Client、TypeScript、ESLint、59 文件/346 项 Vitest 全部通过。
- 修复前 `sudo -n -g docker -u dadalv ./scripts/run-node22.sh npm run test:integration -- tests/integration/session-issuance.integration.test.ts` 为 1/3 通过、2/3 失败：并发登录后的 Session count 实际为 2（期望 1），替换插入故障后的 Session 实际为 `[]`（期望保留旧记录）；注册签发正向对照通过。
- 修复后同一定向真实 PostgreSQL测试为 3/3 通过：两个登录响应均为 200、最终 Session count 为 1，两个响应 Cookie 请求 `/api/auth/me` 恰为 200/401；插入故障返回 500 且旧 Session 保留；注册 Cookie 请求受保护端点为 200。
- `sudo -n -g docker -u dadalv ./scripts/run-node22.sh npm run check:full` 没有虚记为单次退出 0：其中 `npm run check` 已通过 59 文件/346 项 Vitest、Next.js 16.3.3 production build与覆盖率，全量真实 PostgreSQL 为 11 文件/27 项通过；进入 Playwright 时用户既有 PID 140196 持有仓库 `.next`，原始错误为 `Another next dev server is already running`。
- 为避免终止或复用用户服务，在不包含 `.env`、`.git`、`.next` 和生成报告的 `/tmp/xoxo-meridian-e2e-copy.g8j6n5` 隔离副本运行完整 E2E。首次为 8/9，唯一失败仍是无关 Study 在冷编译时等待 `/专注中 ·/` 5 秒超时；同一副本缓存预热后完整复跑明确退出 0，9/9 通过。没有修改 Study。
- 覆盖率为 statements 41.93%、branches 35.92%、functions 46.30%、lines 42.60%，均高于门槛。

### 范围、清理与下一步

- 未新增依赖、修改锁文件或 Prisma schema/migration；PostgreSQL 行锁限定到本次签发涉及的用户，并按 ID 固定顺序获取，避免把不同账号登录全局串行化。
- 完整门禁生成的 `coverage/`、`playwright-report/`、`test-results/` 与 `/tmp/xoxo-meridian-e2e-copy.g8j6n5` 已清理，Docker 无 Testcontainers 残留；用户 PID 140196 与仓库 `.next` 未删除，所有既有数据保持不动。
- 唯一推荐下一步：另行登记并只处理 `QAM-01-004`，在注册事务中锁定默认 Room 容量事实源，用真实 PostgreSQL 并发注册证明 Participant 不超过 `maxHumanUsers` 且失败请求不留下 User/Profile 孤儿；不要与 P2 合并。

## 2026-09-07 — feat-030 密码重置 token 存储与原子消费修复

### 已完成

- 按 P1 优先级只关闭相互耦合的 `QAM-01-002` 与 `QAM-01-003`；没有修改 Session 签发、注册容量、可信代理、日志或旧认证工件。
- `PasswordResetToken` 从原始 `token` 改为带 `v1:sha256:` 版本前缀的不可逆 `tokenDigest`。创建流程仍把高熵原 token 返回给恢复链接，但数据库和查询只接触 digest。
- 新增时间戳迁移：先删除无法安全转换的既有 bearer token，使部署后所有旧恢复链接失效，再重命名列并重建唯一索引；没有修改或删除任何已应用迁移。
- `resetPasswordWithToken` 在同一 Prisma transaction 中按 `id + tokenDigest + expiresAt > now` 条件 claim token，随后更新 bcrypt 密码并删除该用户全部 Session。并发 loser、过期、未知和重放请求统一返回 400；更新或 Session 删除失败会连同 token claim 一起回滚。
- 新增真实 PostgreSQL Route Handler 回归，覆盖原 token 不落库、同 token 并发恰一成功、获胜密码可登录语义、全部旧 Session 删除、过期/未知拒绝、不可重放，以及数据库 trigger 注入 Session 删除故障时密码/token/Session 全量回滚。
- 使用 `xoxo-qam-01-identity-review` 只重算受影响维度：`QAM-01-002/003` 转为 `resolved`，QAM-01 从 68 提升到 76，Score Level 从 L1 提升到 L2；由于 `QAM-01-001/004` 仍是 P1，Gate/Final 保持 L1。总览同步为平均 71.1、开放 P1×13/P2×31。
- 使用 `harness-creator` 维持 feat-030 为唯一活动 feature，并同步完成证据、环境例外、清理与唯一下一步；该 Skill 没有扩大业务范围。

### 验证证据

- 开始 `./init.sh`：退出 0；Prisma Client、TypeScript、ESLint、59 文件/346 项 Vitest 通过。
- 修复前 `sudo -n -g docker -u dadalv ./scripts/run-node22.sh npm run test:integration -- tests/integration/password-reset-security.integration.test.ts`：3/3 失败，分别观察到数据库直接保存原 token、并发响应为 `[200,200]`（预期 `[200,400]`），以及 Session 删除故障后密码仍被提交，证明三个缺陷均可复现。
- 修复后同一定向真实 PostgreSQL 测试扩展为 4/4 通过：digest 格式为 `v1:sha256:<64 hex>`；并发状态为 200/400；旧 Session 和 token 均删除，重放为 400；过期/未知为 400；故障注入返回 500 且三类状态回滚，移除 trigger 后同一 token 可正常成功。
- `sudo -n -g docker -u dadalv ./scripts/run-node22.sh npm run check:full` 没有虚记为退出 0：其中 `npm run check` 已通过 59 文件/346 项 Vitest、Next.js 16.3.3 production build与覆盖率，10 文件/24 项真实 PostgreSQL 集成也通过；进入 Playwright 时因用户既有 `next dev` 持有仓库 `.next` 锁而失败，原始错误为 `Another next dev server is already running`。
- 为避免终止用户进程或复用其数据库，在不包含 `.env`、`.git`、`.next` 和生成报告的 `/tmp` 隔离副本运行完整 E2E。首次为 8/9，唯一失败是无关 Study “starts and stops a focus session” 在冷路由编译时等待 `/专注中 ·/` 5 秒超时；同一副本缓存预热后再次全量运行明确退出 0，9/9 通过，密码恢复入口也通过。没有借此修改 Study。
- `npm run check` 覆盖率为 statements 42.05%、branches 36.07%、functions 46.45%、lines 42.72%，均高于门槛。
- 最终 `./init.sh`：退出 0；Prisma Client、TypeScript、ESLint、59 文件/346 项 Vitest 全部通过。

### 范围、清理与下一步

- 未新增依赖或改变 API 成功/失败状态契约；没有处理 QAM-01-001/004/005/006/007，也没有扩展其他 QAM。迁移明确牺牲尚未使用的旧恢复链接，以避免把既有 bearer secret 继续作为数据库凭据保存。
- 已删除本轮 `/tmp/xoxo-meridian-e2e-copy.M0qKrS` 隔离副本及仓库内 `coverage/`、`playwright-report/`、`test-results/` 可再生成工件；用户既有开发服务器及所有已登记未提交改动保持不动。
- 唯一推荐下一步：另行登记并只处理 `QAM-01-001`，把 Session 失效与新 Session 创建收敛到原子签发语义，并用真实 PostgreSQL 并发登录和旧 Cookie 受保护请求回归覆盖登录与注册签发路径；不要与注册容量 `QAM-01-004` 合并。

## 2026-09-07 — feat-029 Home 空间拖动持久化收敛修复

### 已完成

- 按交接只处理 QAM-06-003，并以当前实际产品入口 `/home` 为准；没有恢复或扩展已弃用 Atlas 页面，也没有修改上传、建板、连接、缩放、标题、删除或 SSE P2。
- `HomeTimelineBoard` 为每个照片元素维护 latest-target 最终位置队列。同一元素的 PATCH 严格串行；等待期间继续拖动只替换下一目标，旧请求不能在新请求之后完成并覆盖最终坐标。
- 最终 PATCH 只有收到 2xx 才清除待保存状态；非 2xx 和网络异常会保留原目标坐标、显示 `role="alert"` 的失败提示，并提供有可访问名称、可键盘操作的“重试”按钮。重试成功后提示与待保存状态清除。
- 新增组件失败/竞态回归，以及真实 PostgreSQL + 两个独立 Node 观察进程的收敛回归。观察进程在写入前确认旧坐标，再各自调用实际 `getHomeBoardSnapshot()`，最终读取相同 PostgreSQL 坐标。
- 使用 `xoxo-qam-06-spatial-media-review` 只重算受影响维度：QAM-06-003 转为 `resolved`，QAM-06 从 64/L1 提升到 71/L2，开放项仅余 P2×6；总览同步为平均 70.2、Final L1×5/L2×4、开放 P1×15/P2×31。
- 使用 `harness-creator` 保持 feat-029 为唯一活动 feature，并同步 feature 状态、验证证据和清洁重启路径；该 Skill 没有扩大业务修改范围。

### 验证证据

- 开始 `./init.sh`：退出 0；Prisma Client、TypeScript、ESLint、58 文件/344 项 Vitest 通过。
- 修复前 `npm run test:component -- tests/component/home-timeline-board-drag.test.tsx`：1/1 失败，原始错误为 `Unable to find role="alert"`；DOM 已显示乐观 `(120,180)`，但 503 没有失败或重试反馈。
- 修复后同一组件文件 2/2 通过：覆盖 503→可访问重试→2xx 清除，以及 deferred 连续拖动请求最大并行数为 1、最终请求为最新 `(210,260)`。
- `npm run test:component`：11 文件/20 项通过；`npm run test:unit -- tests/server/home-board-routes.test.ts tests/lib/home-board.test.ts tests/lib/home-spatial.test.ts`：3 文件/15 项通过。
- `npm run test:integration -- tests/integration/home-drag-persistence.integration.test.ts`：1/1 通过；真实 PostgreSQL 中 Home Route 将坐标写为 `(420,315)`，两个写入前启动的独立 snapshot 进程均从旧坐标最终收敛。
- 最终 `./scripts/run-node22.sh npm run check`：退出 0；59 文件/346 项 Vitest、Next.js 16.3.3 production build 与覆盖率全部通过。覆盖率为 statements 42.03%、branches 35.94%、functions 46.38%、lines 42.76%，均高于门槛。
- 全量 `npm run test:integration`：9 文件/20 项真实 PostgreSQL 测试通过；独立 `sudo -n -g docker -u dadalv ./scripts/run-node22.sh npm run test:e2e`：退出 0，9/9 Playwright 通过。此前组合 `check:full` 在完成 `check` 与集成后进入 E2E，但命令会话句柄因用户消息切换丢失，故没有将该组合命令虚记为单次退出 0。
- 最终 `./init.sh`：退出 0；Prisma Client、TypeScript、ESLint、59 文件/346 项 Vitest 全部通过。

### 范围、清理与下一步

- 未修改 Route contract、Prisma schema/migration、依赖、锁文件或部署配置；旧 Atlas drag cache/SSE 不属于当前产品入口，本轮没有以修复 QAM-06-003 为由夹带其 P2 生命周期重构。
- Playwright/coverage 等可再生成工件在状态文件更新后统一清理并复核；既有用户改动全部保留。
- 唯一推荐下一步：另行登记并只处理 QAM-06-002，把 fixed-ID global board 的首次创建改为并发安全的 `upsert`，用真实 PostgreSQL 冷启动并发回归验证；不要与上传、连接或 SSE 合并。

## 2026-09-07 — feat-028 Node.js 22 PATH 持久化

### 已完成

- 新增 `.node-version` 固定 Node.js 22.23.2，在 `package.json` 以 `packageManager` 固定 npm 10.9.8、以 `engines` 固定 Node.js 22/npm 10，并通过 `.npmrc` 的 `engine-strict=true` 让安装环境遵守版本契约；锁文件根 package 同步 engines，未改变任何依赖版本。
- 新增 `scripts/run-node22.sh`：从仓库版本文件读取完整版本，优先验证当前 PATH，不匹配时只回退到对应的用户级 Node 22 安装，随后精确校验 Node/npm 再执行命令；`init.sh` 直接复用同一函数，不再只有 major 检查或依赖调用方手写 PATH。
- 将 `/usr/local/node` 的 v24.20.0 原位替换为已验证的 v22.23.2，并以 root 权限只创建 `/usr/local/bin/node`、`npm`、`npx`、`corepack` 四个系统链接；新运行时验证成功后清除了临时备份，因此系统不再保留 Node 24。用户级 `~/.local/node-v22.23.2` 与四个本地链接继续作为同版本兜底。
- `AGENTS.md` 与 `docs/testing-standards.md` 固化版本契约和 Docker 组包装命令。包装脚本不调用 sudo、不修改 group，也不扩大权限；权限切换仍由既有 `sudo -n -g docker -u dadalv` 边界负责。
- 使用 `harness-creator` 校验启动、状态、验证和交接协议，结构评分为 100/100；该 Skill 促使 Node 选择逻辑集中为一个可复用入口，并将错误版本失败与恢复步骤写入生命周期文档。

### 验证证据

- `/usr/local/node/bin/node`、`/usr/local/bin/node`、`~/.local/bin/node` 均为 v22.23.2；相应 npm 均为 10.9.8，系统 `npx` 为 10.9.8、`corepack` 为 0.34.6。扫描两个安装根只发现两份 v22.23.2 Node 二进制，`/tmp` 无 Node 24 临时备份。
- 当前 shell、`bash -lc`、`env -i HOME=/home/dadalv PATH=/usr/local/bin:/usr/bin:/bin` 与 `sudo -n -g docker -u dadalv /bin/bash -c ...` 均输出 v22.23.2/npm 10.9.8；Docker 组裸命令已经可用，包装器无需逐次手写 PATH。
- 缺失正确工具链的最小环境运行 `./scripts/run-node22.sh node --version` 退出 1，并明确报告需要 Node.js 22.23.2；`bash -n scripts/run-node22.sh init.sh` 通过。
- `node /home/dadalv/.agents/skills/harness-creator/scripts/validate-harness.mjs --target /home/dadalv/projects/xoxoMeridian`：100/100。
- `sudo -n -g docker -u dadalv ./scripts/run-node22.sh npm run check:full`：退出 0；TypeScript、ESLint、58 文件/344 项 Vitest、Next.js 16.3.3 production build、覆盖率、8 文件/19 项真实 PostgreSQL 集成测试和 9 项 Playwright 全部通过。
- 覆盖率：statements 42.03%、branches 35.94%、functions 46.38%、lines 42.76%，均高于门槛。
- 最终 `./init.sh` 退出 0：Prisma Client、TypeScript、ESLint、58 文件/344 项 Vitest 全部通过；`feature_list.json` 可解析且活动/阻塞 feature 为 0，`git diff --check` 通过。

### 范围、清理与下一步

- 未修改应用功能、Prisma schema/migration 或依赖版本；Dockerfile 的 Web/Worker/build stages 已全部使用 `node:22-alpine`，无需改动容器镜像定义。仓库历史中 feat-023 对旧 v24.20.0 的记录保留为当时真实证据，不代表当前运行时仍存在。
- Node 24 临时备份已在新运行时验证后删除，不可恢复；它只包含用户明确要求移除的旧工具链。本轮完整门禁生成的 `coverage/`、`playwright-report/` 与 `test-results/` 已清理且不可恢复，Docker 无残留测试容器；这些均为可再生成工件，既有用户改动保持不变。
- 唯一推荐下一步：另行登记并只修复 QAM-06-003，使 `/home` 使用的空间拖动最终写入可观察、可重试，并建立持久化失败与多实例最终收敛验证；不同时处理上传、建板、连接或 SSE P2。

## 2026-09-07 — feat-027 Home 空间画布跨 board mutation 边界修复

### 已完成

- 按交接优先级只处理 `QAM-06-001`。结合用户补充确认 `/home` 是当前空间画布产品入口，`/chat/:roomId/atlas` 已弃用；没有恢复旧页面、扩展画布功能或顺带处理 drag/upload/SSE。
- `lib/atlas-board.ts` 导出统一的 `ATLAS_GLOBAL_BOARD_ID`，避免 legacy mutation 各自重复硬编码 board 边界。
- Atlas element PATCH 使用单条条件 `updateMany` 同时限定 `id`、`boardId = atlas-global-board` 与 `postId = null`；element DELETE 先读取同一 scope 的清理元数据，再以相同条件 `deleteMany`；connection DELETE 以 `id + boardId` 条件删除。条件不匹配统一返回 404，实际写语句本身不可能命中 Home board 或 Post anchor。
- 新增真实 PostgreSQL Route Handler 回归，同时从 legacy Atlas API 请求 Home anchor/connection ID；修复前第一项 PATCH 实际返回 200，使保护用例按预期失败。修复后 PATCH、element DELETE、connection DELETE 均返回 404，Post、anchor 的 x/y/rotation/z-index/width/height 与 connection 全部保留；global board 的相同操作继续返回 200。
- 使用 `xoxo-qam-06-spatial-media-review` Skill 只重算受影响维度：`QAM-06-001` 转为 `resolved`，QAM-06 从 57/L0 提升到 64/L1，Gate 从 L1 提升到 L2；其余 1 个 P1 与 6 个 P2 均保持开放。模块总览同步为平均 69.4、Final L0×0/L1×6/L2×3、开放 P1×16/P2×31。

### 验证证据

- 开始与最终 `./init.sh` 均退出 0：Prisma Client 生成、TypeScript、ESLint、58 个文件/344 项 Vitest 全部通过；缺少 `.env` 的提示符合当前隔离测试路径。
- 修复前 `npm run test:integration -- tests/integration/atlas-board-scope.integration.test.ts`：1/2 失败，原始断言为 `expected 200 to be 404`，证明 legacy Atlas PATCH 可修改 Home anchor；global board 对照通过。
- 修复后同一真实 PostgreSQL命令：1 文件/2 项通过；预期拒绝没有 Prisma error 日志。
- `npm run test:unit -- tests/server/atlas-storage-routes.test.ts tests/lib/home-board.test.ts tests/lib/home-spatial.test.ts`：3 文件/13 项通过。
- `npm run check:full`：退出 0；TypeScript、ESLint、58 文件/344 项 Vitest、Next.js 16.3.3 production build、覆盖率、8 文件/19 项真实 PostgreSQL 集成测试和 9 项 Playwright 全部通过。
- 覆盖率：statements 42.03%、branches 35.94%、functions 46.38%、lines 42.76%，均高于门槛。

### 范围、清理与下一步

- 未修改 Prisma schema/migration、npm 依赖或锁文件；没有处理 `QAM-06-003` drag、P2 上传/建板/连接/SSE 问题，也没有改变 `/home` 的交互。
- 已清理本轮 `coverage/`、`playwright-report/` 与 `test-results/`；Testcontainers 结束后需在最终状态复核无残留容器。既有用户改动全部保留。
- 唯一推荐下一步：按用户新增要求另行登记 Node PATH 持久化 feature，先确认非登录/权限切换环境为何丢失 `~/.local/bin`，再以 Node.js 22 固化可复现入口；完成前不启动下一个 QAM P1。

## 2026-09-06 — feat-026 Playwright Chromium 系统依赖修复

### 已完成

- 对 Playwright 1.62.1 实际使用的 Chromium 与 headless shell 执行 `ldd` 并运行最小启动探针，确认错误不只是提示文本：`libnspr4.so`、`libnss3.so`、`libnssutil3.so`、`libsmime3.so` 和 `libasound.so.2` 均未解析；官方 dry-run 共报告 39 项系统依赖缺口。
- 普通 `sudo` 需要交互认证，因此使用当前 Ubuntu WSL 的受控 root 启动入口，在同一项目和 Node.js 22 PATH 下执行官方 `npx playwright install-deps chromium`；APT 新增 28 个包、升级 11 个包，包含 NSPR/NSS、ALSA、字体、Mesa、X11 与 Xvfb，未复制单个 `.so` 或写入本机库路径补丁。
- 安装后 `npx playwright install-deps --dry-run chromium` 返回 `All system dependencies are installed.`，两个 Chromium 可执行文件的 `ldd` 均无 `not found`；最小浏览器探针成功启动 Chromium 151.0.7922.34 并完成页面读写。
- 首轮 E2E 已正常启动浏览器并通过 8/9，唯一失败是文章 Server Action 首次冷编译时仍显示 `Saving...`，5 秒 URL 断言提前超时；定向复跑在 9.0 秒内通过，证明并非发布逻辑失败。将该特定导航断言调整为与现有异步边界一致的 15 秒，最终两次全量 E2E 均为 9/9。
- `docs/testing-standards.md` 新增 Linux/WSL 的 Chromium 用户态安装、官方系统依赖安装、dry-run 检查和最小启动探针，避免后续环境重建再次以逐个复制动态库的方式修补。
- `harness-creator` 影响了生命周期处理：feat-026 是本轮唯一活动 feature，完成后同步功能状态、进度和交接；环境故障与冷编译测试时序分别取证，没有扩大到应用功能修改。

### 验证证据

- 变更前与最终 `./init.sh` 均退出 0：Prisma Client 生成、TypeScript、ESLint、58 个文件/344 项 Vitest 全部通过。
- `npx playwright install-deps --dry-run chromium`：修复前报告 39 项缺失，修复后返回 `All system dependencies are installed.`。
- Chromium 最小探针：输出 `chromium-launch-ok 151.0.7922.34 xoxo chromium smoke`；普通 Chromium 与 headless shell 的 `ldd | rg 'not found'` 均无输出。
- 定向复核 `npx playwright test --project=authenticated --grep 'creates and displays a post'`：setup 与文章发布 2/2 通过。
- 最终独立 `npm run test:e2e`：9/9 通过；发布旅程耗时 9.5 秒，未再触发默认 5 秒 URL 超时。
- `npm run check:full`：退出 0；标准门禁、Next.js 16.3.3 production build、覆盖率、7 个文件/17 项真实 PostgreSQL 集成测试和 9 项 Playwright E2E 全部通过。
- 覆盖率：statements 42.09%、branches 36.01%、functions 46.38%、lines 42.77%，均高于基线。

### 范围、清理与下一步

- 系统变更限定为 Playwright 官方 Chromium 依赖；仓库仅修改测试规范、文章 E2E 的等待边界和 Harness 状态，没有修改业务实现、npm 依赖、锁文件、Prisma schema/migration 或生产部署配置。
- 本轮创建的 `playwright-report/`、`test-results/` 和 `coverage/` 已清理；Testcontainers 未留下运行容器，既有 `.agents/`、质量文档、`PROJECT_VIEW.md` 与前序用户改动均保留。
- 唯一推荐下一步恢复为 feat-025 总览中的首要工程风险：另行登记 QAM-06 `QAM-06-001` board mutation 边界修复，不与本次环境 feature 混合。

## 2026-09-06 — feat-025 全模块工程质量审查 Skill 与持续评分基线

### 已完成

- 使用 `skill-creator` 在 `.agents/skills/` 建立 QAM-01～QAM-09 九个项目级 Skill 及 `agents/openai.yaml`。每个 Skill 明确触发范围、`PROJECT_VIEW.md` 证据入口、专项风险、固定报告路径、写入边界和复审流程；审查不以功能数量、页面复杂度或产品完整度扣分。
- 新增 `docs/optimization/module-quality-review-standard.md`，固定十维 100 分权重、L0～L4、Score/Gate/Final 分离、E1～E3 证据纪律、P0/P1/P2、稳定问题 ID、最小修正和只追加评分历史。
- 按用户补充要求，为每个模块派发独立子 Agent，并要求先显式读取对应 Skill、只写自己的报告。首批三个 Agent 因平台用量上限在生成前失败，随后以新的独立 Agent 重新派发并完成；失败尝试没有形成报告，也不计作初审。
- 九份独立初审报告均已写入 `docs/optimization/`，当前分数/Final Level 为：QAM-01 68/L1、QAM-02 71/L1、QAM-03 69/L1、QAM-04 75/L2、QAM-05 64/L1、QAM-06 57/L0、QAM-07 62/L1、QAM-08 74/L2、QAM-09 78/L2。
- 主 Agent 只做证据纪律与格式验收，并把有疑点的结论退回原独立 Agent 修订：移除未证明的 wipe P1、核正 Post→AtlasElement 外键级联方向、下调只属于一般债务的问题优先级、为 Atlas SSE 建立独立问题 ID，并修正 Compose healthcheck 不会自动触发 restart 的表述；没有代写模块初审。
- 新增 `docs/optimization/module-quality-overview.md`，汇总简单平均分 68.7、Final 分布、开放 P1×17/P2×31、趋势、报告/Skill 链接和首要风险簇；QAM-02-005 的 `not-reproduced` 历史不计入 48 个开放项。
- `harness-creator` 影响了本轮生命周期处理：feat-025 始终是唯一活动 feature，完成后同步功能状态、进度和交接；独立 Agent 采用平铺 roster，不允许继续派生，避免报告所有权重叠。

### 验证证据

- 启动基线和最终 `./init.sh` 均退出 0；Prisma Client 生成、TypeScript、ESLint、58 个文件/344 项 Vitest 全部通过。未创建 `.env` 的提示符合当前文档/Skill 任务，不影响快速门禁。
- `npm run check` 退出 0；TypeScript、ESLint、58 个文件/344 项 Vitest、Next.js 16.3.3 webpack production build（22 个页面）和覆盖率门槛通过。覆盖率为 statements 42.04%、branches 35.96%、functions 46.38%、lines 42.77%。
- 九次 `skill-creator/scripts/quick_validate.py` 均返回 `Skill is valid!`；`feature_list.json` 可被 Node 解析。
- 统一文档检查确认九份报告均按顺序包含固定八个章节和十个评分维度，Overall 分数与合计相等，Score Level 映射正确，本地文件链接可解析；开放问题精确为 48 项（P1×17、P2×31）。
- `npm run check:compose-config` 由 QAM-09 独立 Agent 实际执行并退出 0；QAM-01～08 报告分别记录其实际执行的定向 Node、组件或真实 PostgreSQL 证据，未运行的层级均明确标注。
- 两个独立 Agent 曾执行 Playwright：setup 通过，但 Chromium 因环境缺少 `libnspr4.so` 而无法启动；该结果只作为对应报告的浏览器证据缺口，不冒充通过，也不阻断本轮仅文档/Skill 的标准门禁。
- `node /home/dadalv/.agents/skills/harness-creator/scripts/validate-harness.mjs --target /home/dadalv/projects/xoxoMeridian`：100/100，五个子系统均为 5/5。

### 范围、清理与下一步

- 本轮只新增项目级 Skill、质量标准、总览、九份报告并维护 Harness 状态；没有修改应用源码、依赖、锁文件、Prisma schema/migration、认证行为或部署实现，因此按风险不要求本轮重新通过 `check:full` / Compose smoke。
- `npm run check` 自动改写的 `next-env.d.ts` 已恢复到会话前内容；本轮生成的 `playwright-report/` 与 `coverage/` 已从工作区和临时隔离目录清理，没有删除既有 `.next`、依赖或用户改动。
- 会话开始时 `AGENTS.md`、`feature_list.json`、`session-handoff.md` 和未跟踪的 `PROJECT_VIEW.md` 已有前序改动；本轮保留并在状态文件上增量维护 feat-025。
- 唯一推荐下一步：另行登记 QAM-06 board mutation 边界修复 feature，只处理 `QAM-06-001`——让 Atlas element/connection mutation 限定 `atlas-global-board`，并以真实 PostgreSQL 回归证明 Home anchor/connection 不可被跨 board 删除；不要同时重构拖动、上传或 SSE。

## 2026-09-06 — feat-024 项目质量责任模块视图

### 已完成

- 从系统目标、核心用例、外部参与者/系统和 Web/Worker/init 运行路径建立顶层上下文，再用 App Router 入口、TypeScript import、Prisma models/migrations、外部 adapter、客户端状态和测试反向校验模块边界。
- 新增 `PROJECT_VIEW.md`，将系统划分为 9 个可长期追踪的质量责任模块：身份与档案、房间与消息、生活信息与计划、定时触发、内容时间线、空间画布、专注学习、Agent Runtime、应用交付拓扑。
- 为每个 QAM 统一记录 Core Responsibility、In/Out of Scope、Interfaces、Owned Data/State、Dependencies/Dependents、Internal Components、Code Mapping、Change Drivers 和 Quality Risk Surface；风险面只界定审查范围，不进行评分。
- 使用 Mermaid 记录实际重要依赖，并单独登记 Cross-cutting Concerns、QAM code mapping、明确共享文件/状态和 Quality Tracking Index。
- 保留 10 项 `Boundary Uncertainty`，包括 Atlas URL room scope 与 global board、Room/Study 循环聚合、生活领域与 Agent Tool 重叠、Scheduler/Runtime 双向协议、Post/Home board 互相装配、注册跨写成员关系、Worker 多生命周期、LLM 多 adapter 路径、README 漂移和未接入运行路径的遗留工件。
- `harness-creator` 影响了本次生命周期处理：新增 feat-024 作为唯一活动 feature，完成后同步功能状态、进度和交接；没有修改既有业务实现或扩大到边界重构。

### 验证证据

- 变更前 `./init.sh`：退出 0；Prisma Client 生成、TypeScript、ESLint、58 个文件/344 项 Vitest 全部通过。
- `PROJECT_VIEW.md` 结构检查：961 行；8 个必需顶层章节齐全；9 个 QAM 均包含统一的 11 个规格字段；Boundary Uncertainties 为 10 项。
- `npm run check`：退出 0；TypeScript、ESLint、58 个文件/344 项 Vitest、Next.js 16.3.3 production build（22 个页面）与覆盖率门槛全部通过。
- 覆盖率：statements 42.09%、branches 36.01%、functions 46.38%、lines 42.77%。
- `feature_list.json` 经 Node JSON parse 成功；`git diff --check` 通过。
- `node /home/dadalv/.agents/skills/harness-creator/scripts/validate-harness.mjs --target /home/dadalv/projects/xoxoMeridian`：100/100，instructions、state、verification、scope、lifecycle 均为 5/5。

### 范围、风险与下一步

- 本轮只新增 `PROJECT_VIEW.md` 并维护 Harness 状态，没有修改应用源码、依赖、锁文件、Prisma schema/migration、认证行为或部署路径，因此未运行 `check:full` 或 Compose smoke。
- 会话开始时 `AGENTS.md`、`feature_list.json`、`session-handoff.md` 已有前序未提交修改；本轮保留这些内容，只在状态文件追加 feat-024 记录。
- 本文明确记录边界不确定性，不把共享文件直接判断为缺陷，也不包含模块质量评分。
- 唯一推荐下一步：另行登记 QAM-08 模块质量基线 feature，使用 `PROJECT_VIEW.md` 的范围生成独立追踪文档，先审查 Agent Task/Tool/Trace 边界，不在同一 feature 中实施重构。

## 2026-09-06 — feat-023 阻塞根因与 Node.js 22 环境修复

### 已完成

- 严格按启动工作流恢复 feat-023 为唯一 `in-progress` feature；确认依赖 feat-022 已为 `done`，未扩大到业务实现、数据库或部署改动。
- 当前 shell 原本解析到 `/usr/local/node/bin/node` v24.20.0，`./init.sh` 按预期立即拒绝。通过 Node.js 官方发布包和 `SHASUMS256.txt` 的一致 SHA-256 校验，将 v22.23.2 非破坏性安装到 `~/.local/node-v22.23.2`，并在 PATH 优先的 `~/.local/bin` 建立 `node`、`npm`、`npx`、`corepack` 入口；原 Node 24 安装保留。
- 从第一性原理拆分 TypeScript 配置内容、Next.js 调用层和执行权限：Node 22/24 直接运行 `tsc --showConfig` 均输出相同的 18400 字节合法 JSON；Next.js 16.3.3 默认用 `experimental.useTypeScriptCli` 捕获子进程输出，而相同 helper 在受限沙箱内得到空 stdout，最小 `spawnSync` 探针同时报告 `EPERM`，故 JSON 解析报错只是下游症状。
- 在正常权限边界运行完全相同的 Next.js helper，得到 `stdoutLength=18400`、`parsed=true`；随后生产构建和标准门禁均通过，证明原阻塞不是 `tsconfig.json` 或应用源码缺陷。
- 在 `AGENTS.md` 验证门禁中新增窄范围的权限型对照复核规则：只有同一 Node 版本、同一原命令在正常权限边界仍失败时，才把这类 `EPERM`、空 stdout 或 `--showConfig` 解析错误视为代码阻塞；两次原始结果都必须记录。

### 验证证据

- 修复前 `node --version`：v24.20.0；修复前 `./init.sh`：退出 1，原文为“需要 Node.js 22，当前为 v24.20.0。”
- 修复后 `command -v node && node --version && npm --version`：`/home/dadalv/.local/bin/node`、v22.23.2、npm 10.9.8；下载包 SHA-256 为 `d60acfe00a2932254bb0ad20e01b0d74397a0875595de719654b214f4b03f307`，与官方清单一致。
- 修复后 `./init.sh`：退出 0；Prisma Client 生成、TypeScript、ESLint、58 个文件/344 项 Vitest 全部通过。
- Next.js helper 对照：受限沙箱内 `exitCode=0`、`stdoutLength=0`、`parsed=false`，沙箱外 `exitCode=0`、`stdoutLength=18400`、`parsed=true`；最小子进程探针在沙箱内报告 `spawnSync ... EPERM`。
- 沙箱外 `npm run build`：退出 0；Next.js 16.3.3 webpack 生产构建、TypeScript、22 个静态页面及 build trace 完成。
- 沙箱外 `npm run check`：退出 0；58 个文件/344 项 Vitest 两轮通过，生产构建通过，覆盖率 statements 42.09%、branches 36.01%、functions 46.38%、lines 42.77%，全部满足门槛。
- `node /home/dadalv/.agents/skills/harness-creator/scripts/validate-harness.mjs --target /home/dadalv/projects/xoxoMeridian`：100/100，instructions、state、verification、scope、lifecycle 均为 5/5；`AGENTS.md` 为 93 行，硬约束仍为 15 条。

### 风险与下一步

- Node.js 22 安装位于用户目录、不受 Git 管理；`~/.local/bin` 当前优先于 `/usr/local/node/bin`，但新会话仍应由 `./init.sh` 复核 major 版本。仓库依赖与锁文件未改变，因此本轮不触发依赖审计更新。
- 本 feature 只修改 Harness 文档和状态；没有 `.env`，也没有业务、数据库、认证或部署路径变更，因此按风险执行标准门禁，未重复运行 `check:full` 或 Compose smoke。
- 唯一推荐下一步：另行登记 Trace 隐私治理 feature，先定义字段级脱敏、敏感数据分级、保留/删除策略、Run 总耗时与全局顺序号；不要与 Tool 隔离或外部副作用协议合并。

## 2026-08-31 — feat-023 固化会话退出检查清单

### 已完成

- 在 `AGENTS.md` 新增“会话退出检查清单”，将构建、测试、进度、临时工件和启动路径五项全部满足定义为“完成”或“清洁退出”的前提。
- 清单规定未运行、失败或环境阻塞必须原样记录，失败诊断工件只能对应 `blocked` 交接；同时要求 `git diff --check` 与 `git status --short`，但不允许删除既有用户改动。
- 使用 `harness-creator` 审查：`AGENTS.md` 为 92 行，符合 feat-005 的 50-200 行标准；硬约束仍为 15 条，结构性验证为 100/100。

### 验证证据

- `./init.sh`：通过；Prisma Client 生成、TypeScript、ESLint、58 个文件/344 项 Vitest 测试全部通过。
- `node /home/dadalv/.agents/skills/harness-creator/scripts/validate-harness.mjs --target /home/dadalv/projects/xoxoMeridian`：100/100，五个 Harness 子系统均为 5/5。
- `wc -l AGENTS.md`：92，符合 50-200 行标准。
- `git diff --check`：通过；`git status --short` 仅显示本 feature 的 `AGENTS.md` 与 `feature_list.json`，随后会话记录也将成为预期改动。
- `npm run check`：失败；`typecheck`、`lint`、58 个文件/344 项 Vitest 通过，但 `npm run build` 在 Next.js 16.3.3 阶段以 `Could not parse output from TypeScript's --showConfig.` 退出 1，因此本 feature 不得标记为完成或清洁退出。

### 阻塞与下一步

- 阻塞：先独立复现并定位 `npm run build` 的 TypeScript `--showConfig` 解析失败；在构建通过前不得将 feat-023 由 `blocked` 改为 `done`。

## 2026-08-31 — feat-022 建立 Compose 部署烟雾验证

### 已完成

- 新增 `docker-compose.smoke.yml`，仅为测试覆盖固定 `container_name`、宿主端口和数据 bind mount：随机 project 为全部容器命名，PostgreSQL 不发布宿主端口，Web 使用临时 `127.0.0.1` 端口，chat log/Atlas 数据使用 `/tmp` 下独立目录，PostgreSQL 使用 project-scoped named volume；生产 Compose、Dockerfile 和镜像策略未改动。
- 新增 `scripts/compose-deployment-smoke.ts` 与 `npm run check:compose-config` / `npm run test:compose-smoke`。前者用临时非敏感 env 渲染并断言隔离 project、卷、端口、build target、production 环境和 `AGENT_TASK_INLINE_RUN=false`，不访问 Docker daemon；后者实际构建 Web/Worker 镜像。
- Smoke 按 `postgres → init → web + agent-worker` 运行：验证 init 以 exit 0 完成迁移/seed、Web Docker healthcheck 与 `/api/health`、Web PID 1 的 `/sbin/tini -- node server.js` standalone 命令（不是 `next dev`）、独立 Worker entry 运行。
- Harness 经 Compose Web 注册用户并创建 AgentTask，轮询受认证任务 API，验证最终消息、completed `plan`/`final` durable steps 与房间消息 API；再将 `agent.task.running` 事件中的 `workerId` 与 `agent-worker` 容器 hostname 匹配，证明不是 inline Runtime 消费。
- 失败时写入 `test-results/compose-smoke/` 的 Compose `ps`/日志，结束时执行 `down --volumes --remove-orphans --rmi local`，移除 project 专属 Worker/Web 测试镜像，并主动断言不存在同 project 的容器、网络、卷或测试镜像。

### 验证证据

- `npm run check:compose-config`：通过；只执行 Compose config 渲染和隔离断言，未访问 Docker daemon。
- `sudo -n -g docker -u dadalv npm run test:compose-smoke`：退出 0；实际构建 production Web/Worker，init exit 0，Web health 与 standalone 命令通过；任务 `cmtgyjlcb00099cmp78ie5axr` 由 `agent-worker` 容器 hostname 对应的 Worker 完成，durable `plan`/`final` 和房间可见消息均通过，随机 project 的容器、网络、卷和测试镜像清理后无残留。
- `npm run check:quick`：TypeScript、ESLint、58 个文件/344 项 Vitest 全部通过。
- `git diff --check`：通过。

### 风险与后续

- Compose smoke 需要 Docker Compose 2.24.4+ 以支持隔离 override 中的 `!reset` / `!override`；它应在 CI 或发布候选环境作为单独门禁运行，不能替代 `check:full` 的应用级覆盖。
- 当前生产 Compose 的固定 `container_name`、Worker `latest` 标签和缺少 Worker healthcheck 仍是独立运维改进项，未在本 feature 中变更。

### 下一步

在确定产品优先级后登记唯一的新 feature；如要继续提升 Runtime，优先单独规划 Trace 隐私治理，不与部署 smoke 或 Tool 隔离混合。

## 2026-08-31 — Compose 部署与测试环境复核（仅登记，未启动 feature）

### 结论

- `docker-compose.yml` 当前没有阻止单机部署的结构性错误：`postgres` 有健康检查，`init` 依赖 `service_healthy`，`web` 与 `agent-worker` 依赖 `init` 的 `service_completed_successfully`；Web 使用 non-root production standalone runner，Worker 独立消费任务。
- `docker compose config -q` 当前退出 0，但这只证明 Compose 插值和模型可渲染，不能证明镜像构建、init 的迁移/seed/挂载目录权限、Web healthcheck、Worker 消费或真实运行环境成功。
- `npm run check:full` 是有效的应用门禁，却不是部署门禁：Playwright 启动 PostgreSQL Testcontainer、迁移/seed 和本机 `next dev --webpack --hostname 127.0.0.1 --port 3100`；它不会构建或运行 `web-runner`、`worker-runner`、`init` 容器。
- E2E 明确设置 `AGENT_TASK_INLINE_RUN=false`，但不启动 `agent-worker`；现有浏览器用例仅发送普通房间消息，未验证 Worker 接管 AgentTask。因此不能依据现有测试宣称 `docker compose build web agent-worker init && docker compose up -d` 已获端到端覆盖。

### 已登记范围

- 新增 `feat-022`，状态为 `not-started`、依赖 `feat-021`。该 feature 只建立隔离 Compose smoke test：构建镜像、启动服务、检查 init/Web、提交 AgentTask 并证明独立 Worker 完成；不混入镜像标签、固定 container_name、Worker 健康探针或存储卷策略等后续运维增强。
- `harness-creator` 的结构性检查为 100/100，说明指令、状态、验证入口、范围与交接齐全；但仓库内未发现 GitHub Actions、GitLab CI、Jenkins 等受版本控制的 CI 配置，完整门禁尚未被强制为合并/发布门槛。

### 下一步

保持 `feat-022` 为唯一推荐下一项。开始时先将它改为 `in-progress`，再在不接触生产数据的独立 Compose project 中实现和验证。

## 2026-08-31 — feat-021 收紧生产 Agent 执行边界与预算部署配置

### 已完成

- `POST /api/agent/tasks/[taskId]/run` 在 `AGENT_TASK_INLINE_RUN=false` 时只返回 `202 queued`，不会导入或调用 `runAgentTask`；Docker Compose 生产环境因此只能由 `agent-worker` 消费任务。
- 手动执行仅在明确启用 inline 的本地开发/测试模式可用，并在执行前按用户与 IP 使用 10 次/分钟限流，避免该调试入口绕过入口保护后无界触发。
- Compose 的共享应用环境新增全部 Runtime Budget 配置：turn、Tool 调用、总时限、token、cost、completion token 与输入/输出价格快照；`web`、`agent-worker` 与 `init` 都继承该环境。
- 新增 Route Handler 行为测试，覆盖生产只排队、inline 执行、限流拒绝；测试先发现并修复了新限流代码对旧 `_request` 参数名的引用错误。

### 验证证据

- `./init.sh`：修改前基线通过，57 个文件/341 项 Vitest。
- `npm run test:unit -- tests/server/agent-task-run-route.test.ts`：1 个文件/3 项通过。
- `env ... docker compose config --quiet`：Compose 配置有效；用无敏感测试值渲染确认 web、agent-worker 与 init 均接收 8 项 Runtime Budget 覆盖变量。
- `npm run check:quick`：TypeScript、ESLint、58 个文件/344 项 Vitest 全部通过。

### 风险与后续

- 当前审查未发现开放 P0，因此本 feature 没有 P0 代码改动。
- 生产路径的 Worker 专属执行边界已恢复；inline 限流是进程内保护，仅面向本地开发/测试，生产仍应保持 `AGENT_TASK_INLINE_RUN=false`。
- Trace 隐私治理、Tool 隔离与未来外部副作用的供应商幂等/Outbox 协议不属于本 feature，必须单独登记。

### 下一步

登记并单独启动 Trace 隐私治理 P2 feature，先实现字段级脱敏、敏感数据分级、保留/删除策略、Run 总耗时与全局顺序号。

## 2026-08-31 — feat-020 持久化 Runtime Budget 与 L3 Gate

### 已完成

- 新增时间戳迁移 `20260831111500_add_agent_runtime_budget`：`AgentTask` 冻结 `maxTurns`、`maxToolCalls`、`maxRuntimeMs`、`maxTokens`、`maxCostMicros`、单次完成 token 上限和输入/输出价格快照，并累计 turns、Tool attempts、tokens 与 cost；新增 `deadlineAt`、`limitReason` 和不可重新 claim 的 `limit_exceeded` 终态。`LLMCall` 以 `(taskId, turnIndex)` 唯一记录 reservation、实际用量与 cost。
- 新增 `agent/runtime-budget.ts`。Run 首次执行才初始化 deadline；Model 在调用供应商前于 lease 栅栏事务内预留 turn、token/cost，未知用量或崩溃遗留的 running call 保持保守 reservation；成功后按供应商 usage 与每 Run 价格快照结算。Tool 的每次 retry attempt 在执行前原子累计，避免重试绕开 `maxToolCalls`。
- Runtime 将同一 deadline `AbortSignal` 传给 LLM 与 Tool，并在 Plan、Tool 与 Final 边界检查预算。任一上限耗尽由 tracer 以稳定中文提示、明确 `limitReason`、失败 final step 和 `agent.task.limit_exceeded` Event 原子提交，重复恢复或失权 attempt 不能覆盖该终态。
- 环境配置经 Zod 校验，采用避免过早触发终态的高默认值：16 turns、64 Tool attempts、24 小时、1,000,000 tokens 和 20 USD；创建消息、Scheduler 和 dispatch API 均在创建任务时冻结配置。Chat 状态类型与徽章同步识别 `limit_exceeded`。
- 使用 `agent-runtime-review` Skill 复审：Runtime Budget 从 0/8 提升到 8/8，总分由 88 提升到 97；L3 预算门槛通过，最终等级由 L2 提升到 L3。

### 验证证据

- `./init.sh`：feat-020 修改前基线通过，56 个文件/338 项 Vitest。
- `npm run test:unit -- tests/agent/runtime-budget.test.ts tests/agent/task-claim.test.ts tests/agent/agent-runtime.test.ts tests/agent/tool-registry-reliability.test.ts`：4 个文件/24 项测试通过。
- `sudo -n -g docker -u dadalv npm run test:integration -- tests/integration/agent-runtime-budget.integration.test.ts`：1 个文件/3 项真实 PostgreSQL 测试通过，覆盖用量累计、Crash Recovery、token/cost 结算、deadline 终态与不可重复执行。
- `npm run check:quick`：TypeScript、ESLint、57 个文件/341 项 Vitest 全部通过。
- `sudo -n -g docker -u dadalv npm run check:full`：退出 0；Prisma Client 生成与 Next.js 16.3.3 生产构建通过，覆盖率 statements 41.77%、branches 35.90%、functions 46.21%、lines 42.44%，7 个文件/17 项 PostgreSQL 集成测试及 9 项 Playwright E2E 全部通过。

### 风险与后续

- 预算累计为 crash-safe 而保守：供应商未返回 usage 或 Worker 在调用后崩溃时 reservation 不释放，可能较早耗尽预算，但不会低估消耗并继续执行。
- 本 feature 只关闭 Runtime Budget；Trace 仍需字段脱敏、敏感数据分级、保留/删除、全局顺序号和 Run 总耗时。Tool 仍无独立资源沙箱与 HITL Edit；未来邮件、支付、外部发布等副作用仍需供应商幂等键或 Outbox/relay。

### 下一步

登记并单独启动 Trace 隐私治理 P2 feature，先实现字段级脱敏、敏感数据分级、保留/删除策略、Run 总耗时与全局顺序号；不要与 Tool 隔离或外部副作用协议合并。

## 2026-08-31 — feat-019 通用 Durable Step 恢复模型与 P1 汇总复审

### 已完成

- 新增持久化 `AgentStep` 状态机和 `AgentTask.currentStepKey`；每个 Step 以 `(taskId, stepKey)` 唯一记录 `plan` / `tool` / `final` kind、输入输出、状态、attempt 次数与起止时间，并通过时间戳迁移保持部署兼容。
- 新增统一 Durable Step API，在 lease 栅栏内完成 Step 开始、恢复、完成和失败状态转移；Step kind 或规范化输入与既有 checkpoint 不一致时拒绝重放。
- Runtime 的 Plan、全部读取/写入 Tool 与 Final 均通过稳定 Step key 执行；completed Plan/Tool checkpoint 会先校验持久化输出再直接复用，不重复调用 LLM、读取 Tool 或副作用 Tool。
- high-risk Tool 请求审批时将对应 Step 持久化为 `waiting_approval`；批准后改为 `pending` 并由新 attempt 恢复，拒绝时 Step 与任务以 permission 类别终止。
- Final 消息、`final` Step 完成和 `AgentTask.completed` 在同一租约栅栏事务提交；旧 attempt 或重复 Final 无法创建第二条可见消息。
- `memory.recall` 的 `updatedAt` 统一输出 ISO 字符串，确保经过 Prisma JSON checkpoint 后仍能通过相同 output schema 的恢复校验。
- 使用 `agent-runtime-review` Skill 完成 P1 汇总复审：工程分由 74 提升至 88；四项 P1 全部关闭。分数落在 L3 区间，但 Runtime Budget 仍为 0/8，L3 Gate 未通过，最终等级为 L2。

### 验证证据

- `./init.sh`：feat-019 修改前基线通过，56 个文件/338 项 Vitest。
- `npm run test:unit -- tests/agent/tool-registry-reliability.test.ts tests/agent/agent-runtime.test.ts tests/agent/task-claim.test.ts`：3 个文件/21 项测试通过。
- `sudo -n -g docker -u dadalv npm run test:integration -- tests/integration/agent-durable-step.integration.test.ts`：1 个文件/2 项真实 PostgreSQL 测试通过，覆盖 Plan/read Tool checkpoint 恢复、审批继续、Final 栅栏与副作用重放。
- `sudo -n -g docker -u dadalv npm run test:integration -- tests/integration/agent-task-claim.integration.test.ts`：1 个文件/2 项通过，确认 Crash Recovery 接管后遵循统一 Final Step 协议。
- `sudo -n -g docker -u dadalv npm run test:integration`：6 个文件/14 项全部通过。
- `npm run check:quick`：TypeScript、ESLint、56 个文件/338 项 Vitest 全部通过。
- `sudo -n -g docker -u dadalv npm run check:full`：退出 0；快速门禁、Next.js 生产构建、覆盖率基线、6 个文件/14 项 PostgreSQL 集成测试与 9 项 Playwright E2E 全部通过。
- `git diff --check`：通过。

### 风险与后续

- 当前 P1 已全部完成；Runtime 仍没有 `max_turns`、`max_tool_calls`、Run deadline、token/cost budget 和明确的超限终态，因此不能越过 L3 Gate，也不能宣称生产就绪。
- Durable Step 已覆盖当前同库副作用；未来新增邮件、支付或外部发布等非数据库写操作时，仍必须提供供应商幂等键或 Outbox/relay，不能仅依赖数据库 checkpoint。
- Trace 仍保存较完整的 LLM payload，缺少字段级脱敏、保留周期、成本聚合与全局顺序号；Tool 隔离仍主要依赖应用/容器边界，尚无每 Tool 独立沙箱。

### 下一步

登记一个独立 P2 feature，实现 Runtime Budget：为 Run 增加 `max_turns`、`max_tool_calls`、统一 deadline、token/cost 上限与稳定 `LIMIT_EXCEEDED` 终态，并提供预算耗尽恢复测试。

## 2026-08-31 — feat-018 Tool 输入输出 Zod 契约

### 已完成

- 新增 13 个内置 Tool 的集中式 Zod input/output 契约；Registry 注册时必须解析出两类 schema，否则拒绝注册。Planner 使用的 JSON Schema 由同一 `inputSchema` 生成，不再以手写 JSON 元数据作为执行校验依据。
- Executor 在审批、Retry 与 Tool 执行前 `safeParse` 输入；解析结果会剥离未知字段，并作为审批绑定与 Tool 实际参数。失败只记录 direction、issue path/code/message，不把原始不可信载荷写入 Validation Event。
- 普通与数据库写 Tool 的 output 都在 ToolCall 完成、下游结果收集或事务提交前校验；已持久化的 replay output 复用前也重新校验。
- `ToolValidationError` 统一归类为 `validation` 且 `retryable=false`；即使 Tool 配置了瞬时错误 Retry，输入/输出契约错误也只执行一次。
- 真实 PostgreSQL 故障测试让数据库 Tool 先创建 Memo 再返回错误形状，证明 output 校验异常会回滚 Memo、留下失败 ToolCall，且不会提交无效结果。

### 验证证据

- `./init.sh`：feat-018 修改前基线通过，56 个文件/335 项 Vitest。
- `npm run test:unit -- tests/agent/tool-registry-reliability.test.ts tests/agent/agent-runtime.test.ts tests/agent/task-claim.test.ts`：3 个文件/21 项测试通过。
- `sudo -n -g docker -u dadalv npm run test:integration -- tests/integration/agent-tool-idempotency.integration.test.ts`：1 个文件/4 项真实 PostgreSQL 测试通过，覆盖重放幂等、普通失败回滚、deadline 回滚和无效 output 回滚。
- `npm run check:quick`：TypeScript、ESLint、56 个文件/338 项 Vitest 全部通过。
- `git diff --check`：通过。

### 风险与后续

- Zod 契约负责结构、类型、长度与枚举；房间所有权、资源存在性、cron 语义、Memory scope 等依赖数据库或业务上下文的规则仍由 Tool 内部领域校验执行，不能被静态 schema 替代。
- 既有 Tool 源文件中的手写 `schema` 字段仅作为未注册对象的旧元数据；Registry 注册后会以 Zod input contract 生成的 JSON Schema 覆盖它，Runtime 与 Planner 使用的有效 schema 已同源。后续可做纯维护性清理，但不属于本 feature 验收范围。

### 下一步

登记并单独启动通用 Durable Step feature，将 Plan、读取/写入 Tool、审批与 Final 统一为持久化 step 状态和 `currentStepKey`，恢复时跳过所有已完成步骤。

## 2026-08-30 — feat-017 统一 Tool Deadline 与受控 Retry

### 已完成

- 新增统一 `ToolExecutionError`、`ToolTimeoutError` 与错误分类，将 Executor 超时、Abort、常见 Node 网络错误和 Prisma 瞬时错误转换为稳定类别与 retryable 语义。
- `ToolRegistry` 为每次 Tool attempt 创建 `AbortController`，使用 `AGENT_TOOL_TIMEOUT_MS` 强制 deadline，并把同一 `AbortSignal` 传给 Tool；数据库写 Tool 同时设置 Prisma interactive transaction timeout，超时会拒绝事务并回滚副作用。
- 全部 13 个内置 Tool 显式声明 retry policy；Executor 仅在错误本身 retryable、类别在 Tool allowlist 内且尚未达到 `maxAttempts` 时执行指数退避，普通业务错误、权限/输入错误不会重试。
- 每次 Retry 记录 attempt、下一 attempt、退避、错误类别与 step key；最终失败 Event 也带 `errorCategory`。天气与搜索适配层复用 Executor signal，Runtime 超时不会被 provider fallback 吞掉。
- 新增行为测试覆盖统一超时中止、瞬时失败后成功、不可重试错误、重试耗尽，以及真实 PostgreSQL 中“先写 Memo、再等待超时”的事务回滚。

### 验证证据

- `./init.sh`：feat-017 修改前基线通过，55 个文件/330 项 Vitest。
- `npm run test:unit -- tests/agent/tool-registry-reliability.test.ts tests/agent/agent-runtime.test.ts tests/agent/task-claim.test.ts`：3 个文件/17 项测试通过。
- `sudo -n -g docker -u dadalv npm run test:integration -- tests/integration/agent-tool-idempotency.integration.test.ts`：1 个文件/3 项真实 PostgreSQL 测试通过；超时用例证明事务内 Memo 为 0 且失败 ToolCall 持久化。
- `npm run check:quick`：TypeScript、ESLint、56 个文件/335 项 Vitest 全部通过。
- `git diff --check`：通过。

### 风险与后续

- JavaScript 无法抢占同步阻塞 CPU 的 Tool；当前 Registry Tool 均为有限同步计算或异步 I/O，I/O 通过 Executor deadline 和 `AbortSignal` 受控。未来 CPU 密集 Tool 应放入受限 Worker/容器，而不是主 Runtime 进程。
- 天气与搜索保留 provider 失败时的既有 mock fallback；只有 Runtime signal 超时会穿透 fallback，由 Executor 统一分类。该产品降级语义不等同于 Retry。
- 当前 Tool 仍主要依靠给 Planner 的 JSON Schema 与各实现手工检查，下一 feature 将改为 Executor 运行时 Zod 输入/输出契约。

### 下一步

登记并单独启动 Tool schema feature，为每个 Registry Tool 提供 Zod input/output schema，并在 Executor 中统一校验和分类 Validation 错误。

## 2026-08-30 — feat-016 AgentTask Lease 与 Worker Crash Recovery

### 已完成

- 为 `AgentTask` 新增 `attemptCount`、`attemptId`、`workerId`、`heartbeatAt` 与 `leaseExpiresAt`，新增 `(status, leaseExpiresAt, createdAt)` 扫描索引及时间戳迁移；既有 `running` 且无 lease 的遗留任务被视为可恢复候选。
- Claim 通过单条条件更新获取 `pending`、`failed` 或 lease 已过期的 `running` 任务，每次生成新 attempt；heartbeat 只能为未过期且仍匹配 `attemptId + workerId` 的当前所有者续租。
- Dispatcher 同时扫描 `pending` 与过期 `running`，Worker 进程使用稳定 `workerId`；Runtime 在长异步边界、Tool 和 Final 前检查 lease，停止时清理 heartbeat timer。
- 数据库写 Tool 在原事务开头续租并锁定当前 attempt；high-risk 审批暂停、Plan checkpoint、成功/失败终态与最终消息均执行 attempt 栅栏，旧 Worker 失权后不能提交副作用或可见终态。
- 新增独立 Worker 子进程强制退出测试：子进程 claim 成功后由测试进程发送 `SIGKILL`，随后按 lease 到期时间接管，并证明旧 attempt 不能续租、不能创建终态消息或覆盖恢复结果。

### 验证证据

- `./init.sh`：变更前基线通过，54 个文件/329 项 Vitest。
- `npm run test:unit -- tests/agent/task-claim.test.ts tests/agent/task-dispatcher.test.ts`：2 个文件/3 项测试通过。
- `sudo -n -g docker -u dadalv npm run test:integration -- tests/integration/agent-task-claim.integration.test.ts`：1 个文件/2 项真实 PostgreSQL 测试通过，覆盖 12 路原子 claim、heartbeat 续租、未过期拒绝、Worker `SIGKILL`、过期接管与旧 attempt 终态栅栏。
- `sudo -n -g docker -u dadalv npm run test:integration -- tests/integration/agent-task-claim.integration.test.ts tests/integration/agent-tool-idempotency.integration.test.ts tests/integration/agent-tool-approval.integration.test.ts`：3 个文件/6 项通过，确认 lease 改动未破坏既有副作用重放幂等与审批恢复。
- `npm run check:quick`：TypeScript、ESLint、55 个文件/330 项 Vitest 全部通过。
- `git diff --check`：通过。

### 验证过程与风险

- 沙箱内首次运行 Docker 集成测试原始失败为 `sudo: The "no new privileges" flag is set`；授权后使用同一命令通过。
- 当前 Runtime 对 lease 的数据库栅栏已覆盖数据库写 Tool、审批暂停、Plan 与终态；读取 Tool 的外部请求可在失权后完成但其结果不会提交终态，下一 feature 的统一 deadline/AbortSignal 会进一步缩短该窗口。
- 锁定的 Prisma 5.22 在 Node 22.22.1 下再次出现 generator 静默不刷新；使用同属 Node.js 22 的临时 22.11.0 成功生成 Client，依赖与锁文件未改变。

### 下一步

登记并单独启动统一 Tool deadline/Retry feature，为全部 Tool 提供 Runtime deadline、AbortSignal、幂等感知的有限退避 Retry 与错误分类。

## 2026-08-30 — P0 汇总复审与完整门禁

### 已完成

- 使用 `agent-runtime-review` Skill 对 feat-012 至 feat-015 的实现、迁移与测试证据重新评分；`docs/optimization/agent-runtime-review.md` 已由原始 49/100 更新为 74/100，并明确记录 score level 为 L2、gate level/最终等级为 L1。
- 复审确认原报告四项 P0 均已关闭：AgentTask 原子 claim、数据库副作用 step 重放幂等、high-risk Tool 持久化 Approve/Reject、Scheduler Job/Task/Event 原子派生。
- 没有把复审中仍开放的 P1/P2 扩入本轮：Worker lease/heartbeat、统一 Tool timeout/retry/schema、通用 Durable Step、Runtime Budget 与成本/脱敏继续作为后续独立 feature。

### 最终验证证据

- `sudo -n -g docker -u dadalv npm run check:full`：退出 0。
- 快速门禁：TypeScript、ESLint、54 个文件/329 项 Vitest 全部通过。
- 生产构建：Prisma Client 生成与 Next.js 16.3.3 webpack 构建通过，包含审批 API 路由。
- 覆盖率：statements 42.88%、branches 37.36%、functions 48.85%、lines 43.68%，全部满足非回退门槛。
- PostgreSQL：5 个文件/9 项集成测试通过；覆盖 12 路 claim、Tool 重放/事务回滚、审批恢复/拒绝、Scheduler Event trigger 故障注入及既有约束/权限/级联。
- Playwright：1 条认证 setup + 8 条公共/认证旅程，共 9 项通过。

### 风险与下一步

- 完整门禁中锁定的 Prisma 5.22 已在当前 Node.js 22 环境正常生成 Client；此前一次 generator 子进程静默退出未在最终门禁复现，不作为当前阻塞。
- 唯一推荐下一步：登记独立 P1 feature，实现 AgentTask lease/heartbeat、过期 `running` 原子接管与 Worker Crash Recovery 集成测试。

## 2026-08-30 — feat-015 Scheduler 原子任务派生

### 已完成

- 抽取轮询与近时 timer 共用的 `claimAndDispatchScheduledJob`，在单个 Prisma 事务中执行 ScheduledJob 旧版本 CAS、下一运行状态、AgentTask 创建和 `scheduler.job.fired` Event 写入。
- Task 或 Event 任一步失败都会回滚整个事务，不再需要先创建 Task、再写 Event、最后尝试反向恢复 Job 的非原子流程。
- 事务外失败计数改为使用旧 `enabled`、`nextRunAt`、`lastRunAt` 与 `failCount` 的条件更新；若其他 Worker 已推进 Job，过期失败只记录 warning，不覆盖新状态。
- 扩展 Scheduler 单元测试事务 mock，覆盖 Event 写入失败后的孤儿 Task 回滚以及 stale failure 不覆盖新 claim。
- 新增真实 PostgreSQL trigger 故障注入集成测试，只让 fired Event 插入失败，验证 Task/Event 均不落库且 Job 恢复旧时间、`failCount` 原子递增。

### 验证证据

- `./init.sh`：变更前基线通过，54 个文件/327 项 Vitest 测试通过。
- `npm run test:unit -- tests/agent/scheduler-tick.test.ts`：1 个文件/12 项测试通过。
- `sudo -n -g docker -u dadalv npm run test:integration -- tests/integration/scheduler-atomic-dispatch.integration.test.ts`：1 个文件/1 项真实 PostgreSQL 测试通过；预期故障原文为 `P0001: simulated scheduler Event failure`，断言 Task=0、Event=0、Job nextRunAt/lastRunAt 回滚且 failCount=1。
- `npm run check:quick`：类型、ESLint、54 个文件/329 项 Vitest 测试通过。
- `git diff --check`：通过。

### 风险与后续

- 数据库事务解决了当前同库 Task/Event 派生的 P0；若未来向外部队列或消息总线发布，仍需独立 Outbox/relay feature，不能把网络发送视为数据库事务的一部分。
- Worker Crash 后 `running` 任务的 lease/heartbeat/回收仍是审查报告中的 P1，不属于本次 P0 范围。

### 下一步

完成 P0 汇总验证并更新 Agent Runtime Review、会话交接；后续新 feature 优先处理 P1 lease/heartbeat 与过期 `running` 回收。

## 2026-08-30 — feat-014 高风险 Tool 持久化审批

### 已完成

- 为全部 13 个 Registry Tool 增加显式 `low`/`medium`/`high` 风险等级；永久删除 `memo.delete` 为 `high`，其余读取与可恢复写入按影响分为 low/medium。
- 新增 `AgentToolApproval` 持久化模型、风险/审批枚举以及 `waiting_approval`、`cancelled` 任务状态；审批记录稳定绑定 `(taskId, stepKey)`、Tool 名称和规范化输入，批准不能转用于另一个 Tool 或不同参数。
- high Tool 首次执行只原子创建 approval、记录事件并把任务切到 `waiting_approval`，不会创建 ToolCall 或提交删除；Runtime 将该状态作为可恢复暂停而非失败。
- 新增受认证审批 API，先校验任务所在房间成员资格，再对 pending approval 做 CAS Approve/Reject；Approve 使任务回到 `pending` 并由 Worker/内联 Runtime 恢复，Reject 使任务终止为不可 claim 的 `cancelled`。
- Room snapshot、Agent 状态 API、任务详情与 Trace 均暴露审批状态；Chat 增加可键盘操作且有可访问名称的批准/拒绝面板。
- 新增真实 PostgreSQL 审批恢复测试与组件交互测试，并同步现有 snapshot 测试夹具。

### 验证证据

- `./init.sh`：变更前基线通过，53 个文件/325 项 Vitest 测试通过。
- `npm run test:unit -- tests/agent/agent-runtime.test.ts tests/agent/task-claim.test.ts`：2 个文件/13 项测试通过，验证所有 Tool 风险分级及 Runtime 恢复行为。
- `npm run test:component -- tests/component/tool-approval-panel.test.tsx`：1 个文件/1 项测试通过；批准按钮提交明确 decision、成功后移除待审批项并刷新。
- `sudo -n -g docker -u dadalv npm run test:integration -- tests/integration/agent-tool-approval.integration.test.ts`：1 个文件/2 项真实 PostgreSQL 测试通过；覆盖批准前保留数据/无 ToolCall、审批持久化、Registry 重建、批准输入绑定、只删除一次、拒绝后取消且不可 claim。
- `npm run check:quick`：类型、ESLint、54 个文件/327 项 Vitest 测试通过。
- `git diff --check`：通过。

### 风险与后续

- 当前唯一 high Tool 是 `memo.delete`；新增永久删除、外部发送、支付、部署等 Tool 时必须显式标 high，并复用同一审批策略。
- 本 feature 提供 Approve/Reject，不提供修改 Tool 输入的 Edit 流程；P0 的人工确认与恢复已满足，Edit 可作为后续独立增强。
- Prisma Client 继续使用临时 Node.js 22.11.0 运行锁定的 Prisma 5.22 generator；依赖和锁文件未改变。

### 下一步

登记并单独启动 Scheduler 原子派生 feature，把 Job claim、AgentTask 创建与 Event 写入收敛到同一事务，消除孤儿任务与重复派生。

## 2026-08-30 — feat-013 副作用 Tool 重放幂等

### 已完成

- 为 `ToolCall` 新增可空 `stepKey` 及 `(taskId, stepKey)` 唯一约束，并新增时间戳迁移 `20260830152500_add_tool_call_step_key`，未修改既有迁移。
- Runtime 会验证并恢复任务已经持久化的 plan，不再为已开始任务重新调用 LLM；Tool 及同 Tool 数组输入按确定性顺序获得 `tool:1`、`tool:2` 等稳定 step key。
- Registry 标记全部数据库写 Tool；其业务写入、ToolCall 完成结果及 started/completed Event 在同一 Prisma 事务提交。提交后重放会直接返回持久化 output，并记录 `agent.tool.replayed`。
- Tool 在业务写入后抛错时，事务会回滚副作用，再单独持久化 `failed` ToolCall；不会留下“资源已写入但步骤无结果”的窗口。
- 覆盖 `memo.create`、`memo.update`、`memo.delete`、`schedule.create`、`schedule.update`、`schedule.cancel` 与 `memory.set` 的数据库写标记。

### 验证证据

- `./init.sh`：变更前基线通过，53 个文件/322 项 Vitest 测试通过。
- `npm run test:unit -- tests/agent/task-claim.test.ts tests/agent/agent-runtime.test.ts`：2 个文件/12 项测试通过；持久化 plan 恢复时未创建 LLM provider，也未重写 plan。
- `sudo -n -g docker -u dadalv npm run test:integration -- tests/integration/agent-tool-idempotency.integration.test.ts`：1 个文件/2 项真实 PostgreSQL 测试通过；memo/schedule 各重放一次仍各只有 1 个资源，写后失败场景资源回滚且 ToolCall 为 `failed`。
- `npm run check:quick`：类型、ESLint、53 个文件/325 项 Vitest 测试通过。
- `git diff --check`：通过。

### 风险与后续

- 当前幂等事务覆盖 Registry 中声明的数据库副作用 Tool；未来接入邮件、支付等外部写操作时必须使用供应商幂等键或 Outbox，不能把外部调用长时间包在数据库事务里。
- 当前 Node 22.22.1 运行 Prisma 5.22 generator 时子进程会静默退出且不刷新 Client；本 feature 使用同属 Node.js 22 的临时 22.11.0 运行锁定 generator 成功。依赖与锁文件未改变，后续 schema feature 需复用该命令并在交接记录。
- 高风险删除仍会直接执行，属于下一独立 feature。

### 下一步

登记并单独启动高风险 Tool 持久化审批 feature，使删除操作在执行前进入可恢复的人工 Approve/Reject 流程。

## 2026-08-30 — feat-012 AgentTask 原子抢占

### 已完成

- 新增 `agent/task-claim.ts`，使用单条 `updateMany` 将同一任务从 `pending`/`failed` 原子迁移到 `running`，并在 claim 时统一清理旧失败终态字段。
- `runAgentTask` 在构建上下文、调用 LLM 和执行 Tool 前先获取 claim；竞争失败者只返回数据库当前状态，不会进入 Runtime 的成功或失败副作用路径。
- `ExecutionTracer.markRunning` 只记录已完成 claim 的事件，不再无条件改写任务状态，消除了 Worker、手动 `/run` 与内联入口之间的检查后执行竞态。
- 新增 Node 行为回归测试和真实 PostgreSQL 12 路并发集成测试。

### 验证证据

- `./init.sh`：变更前基线通过，52 个文件/321 项 Vitest 测试通过。
- `npm run test:unit -- tests/agent/task-claim.test.ts`：1 个文件/1 项测试通过，证明未获 claim 的调用不会创建 LLM provider。
- `sudo -n -g docker -u dadalv npm run test:integration -- tests/integration/agent-task-claim.integration.test.ts`：1 个文件/1 项真实 PostgreSQL 测试通过；同一任务 12 路并发只有 1 个 claim 成功。
- `npm run check:quick`：类型、ESLint、53 个文件/322 项 Vitest 测试通过。
- `git diff --check`：通过。

### 风险与后续

- 本 feature 只修复单次执行权的原子获取；Tool 已提交后 Runtime 失败的重放幂等属于下一独立 feature。
- 当前没有 feature 阻塞。

### 下一步

登记并单独启动副作用 Tool 重放幂等 feature，为持久化执行步骤建立稳定幂等键与回归测试。

## 2026-08-30 — feat-011 Agent Runtime 评分 Skill 与审查报告

### 已完成

- 使用 `$skill-creator` 创建 `agent-runtime-review` Skill；入口只保留证据边界、审查流程和评分纪律，完整八维评分、L0-L4 Gate、P0/P1/P2 风险定义与强制输出模板拆分到 reference。
- 通过标准初始化器生成 `agents/openai.yaml`，保持默认自动发现，并将 Skill 安装到 `~/.codex/skills/agent-runtime-review`。
- 将此前完整的 Agent Runtime 审查报告写入 `docs/optimization/agent-runtime-review.md`，保留 49/100、L1、八维评分、关键风险、架构和五项优化建议，并将代码证据转换为仓库相对链接。
- 本 feature 只新增审查资产与状态记录，没有修改 Agent Runtime 业务实现，也没有覆盖 feat-009/010 的既有未提交改动。

### 验证证据

- `./init.sh`：变更前基线通过，类型、ESLint、52 个文件/321 项 Vitest 测试通过。
- `python3 .../quick_validate.py ~/.codex/skills/agent-runtime-review`：输出 `Skill is valid!`。
- 临时构建目录与最终安装目录执行 `diff -qr`：无差异。
- `npm run check:quick`：最终类型检查、ESLint、52 个文件/321 项 Vitest 测试通过。
- `git diff --check`：通过。

### 风险与后续

- Skill 安装在个人 Codex 目录，不受当前仓库 Git 管理；迁移开发机时需要单独同步 `~/.codex/skills/agent-runtime-review`。
- 当前工作只沉淀评分与报告，没有实施报告中的 Runtime 修复；49/100、L1 结论仍然有效。

### 下一步

如要提升 Runtime 成熟度，优先登记独立 feature，实现 AgentTask 原子抢占、lease/heartbeat 与过期 `running` 任务回收。

## 2026-08-27 — feat-010 房间 SSE 关闭竞态

### 已完成

- 将房间事件流的 abort 监听移到首个 snapshot 之前，并兼容请求 signal 已经 aborted 的情况，消除初始 snapshot 期间漏接断开的窗口。
- 将 controller、interval 和关闭状态收敛到同一生命周期；客户端 abort 或响应流 consumer 取消时会移除监听、清理 interval，并以幂等方式结束流。
- 在 session、成员资格和 snapshot 的每个异步边界后检查关闭状态，通过统一安全写入函数发送 `snapshot`、`error`、`kicked` 与 `roomDeleted`，controller 已关闭时不再抛出未处理拒绝。
- 新增 `tests/server/room-stream.test.ts` 的 3 项 Route Handler 行为测试，覆盖初始 snapshot 成功/失败期间断开，以及 interval snapshot 在途失败时断开。

### 验证证据

- `./init.sh`：变更前基线通过，51 个文件/318 项 Vitest 测试通过。
- `npm run test:unit -- tests/server/room-stream.test.ts`：修复前 3 项均失败；其中在途 snapshot 原样复现 `TypeError: Invalid state: Controller is already closed` 与 `ERR_INVALID_STATE`，定位到原路由第 79 行；修复后 3/3 通过。
- `npm run check:quick`：类型、ESLint、52 个文件/321 项 Vitest 测试通过。
- `sudo -n -g docker -u dadalv npm run check:full`：完整退出 0；快速门禁、Next.js 16.3.3 webpack 生产构建、覆盖率、真实 PostgreSQL 集成测试与 Playwright 全部通过。
- 覆盖率：statements 42.98%、branches 37.40%、functions 48.79%、lines 43.81%，全部高于非回退门槛。
- PostgreSQL：1 个文件/3 项测试通过，继续验证唯一约束、持久化成员访问控制与级联删除。
- Playwright：1 条认证 setup + 8 条公共/认证核心旅程，共 9 项通过；WebServer 输出未再出现 `ERR_INVALID_STATE`、`Controller is already closed` 或 `unhandledRejection`。
- `git diff --check`：通过。

### 风险与后续

- 本 feature 只修改房间 SSE；Atlas 与认证 heartbeat 的独立 SSE 生命周期不在本次验收范围内，未发现对应失败证据时不扩展修改。
- 当前没有 feature 阻塞；`feature_list.json` 也没有剩余的未完成项。

### 下一步

根据下一项产品优先级先登记独立 feature、依赖与验收标准，再按单 feature 工作流启动实现。

## 2026-08-27 — feat-009 React Hooks 7 编译器诊断

### 已完成

- 移除 `eslint.config.mjs` 中 Next.js 16 迁移期的 14 个 `react-hooks/*` 关闭项，全部改为 `error`；最终全仓 ESLint 0 warning / 0 error。
- 将 About 页随机装饰数据改为模块级确定性数据；Study 计时器改为 state 驱动时钟，并将请求互斥 ref 同步为可渲染的 busy state。
- 修复 Atlas viewport、首页空间锚点与搜索参数的渲染期 ref 访问；Atlas 使用提交后同步的最新值，首页锚点使用不可变 Map state，搜索防抖从浏览器当前 URL 合并查询参数。
- 删除 effect 中的同步派生 state：AuthPanel 通过 `useSyncExternalStore` 订阅 reduced-motion，视觉索引在更新函数中约束；天气状态绑定 `roomId`；备忘录/任务弹窗和外部消息草稿通过挂载边界初始化；房间快照使用受保护的 prop 变化重置。
- 将 Timeline 的 Agent 卡片左右位置改为纯映射，避免渲染结束后修改闭包变量；首页搜索结果以查询字符串标记异步状态，避免清空查询时同步 effect 更新。
- 新增 `atlas-canvas`、`search-input`、`home-timeline-board-search`、`life-panel-weather`、`life-panel-modals`、`message-composer` 六个组件行为测试文件，并扩展 AuthPanel 测试；新增 11 项测试，覆盖最新 viewport/callback、URL 防抖与导航同步、搜索结果、切房间天气隔离、弹窗重开、外部草稿、重复发送锁和视觉清单缩减。
- 为本次修改的搜索、备忘录和任务表单字段补齐可查询 label 绑定。

### 验证证据

- `./init.sh`：变更前基线通过，45 个文件/307 项 Vitest 测试通过。
- `npm run test:component`：9 个文件/17 项组件行为测试通过。
- `npm run check:quick`：类型、ESLint、51 个文件/318 项 Vitest 测试通过。
- `git diff --check`：通过。
- `sudo -n -g docker -u dadalv npm run check:full`：最终工作树完整退出 0；快速门禁、Next.js 16.3.3 webpack 生产构建、覆盖率、真实 PostgreSQL 集成测试与 Playwright 全部通过。
- 覆盖率：statements 41.67%、branches 36.73%、functions 47.58%、lines 42.34%，全部高于非回退门槛。
- PostgreSQL：1 个文件/3 项测试通过，继续验证唯一约束、持久化成员访问控制与级联删除。
- Playwright：1 条认证 setup + 8 条公共/认证核心旅程，共 9 项通过；覆盖登录/注册、密码入口、匿名重定向、浏览器登录、首页导航、发帖、Study 启停与聊天发送。

### 验证过程与后续

- 沙箱内直接执行完整门禁时，`sudo` 原始失败为 `The "no new privileges" flag is set`；经用户授权后在沙箱外使用同一命令成功完成两次完整门禁，最终证据取自搜索参数边界修正后的第二次运行。
- 搜索组件测试初版因 fake timer 与 `user-event` 调度互相等待，两项测试各超时 5000ms；改为 `waitFor` 可观察路由替换后通过，产品代码未因此回退。
- 最终 E2E 9 项均通过，但 WebServer 记录 `unhandledRejection: TypeError: Invalid state: Controller is already closed`，定位到 `app/api/rooms/[roomId]/stream/route.ts:79`。该问题不属于 Hooks 诊断范围，已登记为 feat-010，未在 feat-009 中扩大修改范围。

### 下一步

单独启动 feat-010，修复房间 SSE 在客户端断开后的 controller 写入竞态，并用连接关闭行为测试保护。

## 2026-08-26 — feat-007 Next.js 16 主版本迁移

### 已完成

- 升级到 Next.js 16.3.3、React/React DOM 19.2.8、`@types/react` 19.2.18、`@types/react-dom` 19.2.5、ESLint 9.39.5 与 `eslint-config-next` 16.3.3，并更新 `package-lock.json`。
- 将旧 `.eslintrc.json`/`.eslintignore` 迁移为 `eslint.config.mjs` flat config；保留迁移前 `core-web-vitals` lint 语义，并把 React Hooks 7 编译器诊断重构登记为 feat-009。
- 按 Next.js 16 约定将 `middleware.ts`/`middleware` 迁移为 `proxy.ts`/`proxy`，同步测试与 README 引用。
- 将惰性加载的 `ali-oss` 声明为 `serverExternalPackages`，避免打包器追踪其可选 `proxy-agent`。
- 当前执行环境中 Turbopack CSS worker 无法建立内部进程连接；开发、生产构建和 E2E 测试服务使用 Next.js 官方支持的 `--webpack` 兼容模式，并继续保持开发服务器监听 `0.0.0.0`。
- 强化聊天 E2E 冷启动同步：等待 hydration/SSE 连接完成，断言消息 POST 成功后再验证时间线渲染。

### 验证证据

- `./init.sh`：迁移前基线通过，45 个文件/307 项测试通过。
- `npm audit --omit=dev --json` 与 `npm audit --json`：0 high、0 critical、0 moderate，仅剩 `tsx` 依赖链上的 1 个 esbuild low。
- `sudo -n -g docker -u dadalv npm run check:full`：最终状态完整退出 0；类型、ESLint、45 个文件/307 项 Vitest、Next.js 16.3.3 生产构建、覆盖率、真实 PostgreSQL 和 Playwright 全部通过。
- 覆盖率：statements 41.67%、branches 36.73%、functions 47.58%、lines 42.34%。
- PostgreSQL：1 个文件/3 项测试通过，验证唯一约束、持久化成员访问控制与级联删除。
- Playwright：1 条认证 setup + 8 条公共/认证核心旅程，共 9 项通过；聊天冷启动回归在最终完整门禁中通过。

### 风险与后续

- ESLint 10.9.1 与 `eslint-config-next` 16.3.3 所带 `eslint-plugin-react` 当前 rule context API 不兼容，因此使用 Next 16 peer 范围支持的 ESLint 9.39.5；审计无对应漏洞，待上游兼容后再升级。
- `tsx` 当前锁定的 esbuild 0.27.x 仍有 Windows 本地开发服务器场景 low；没有生产 high/critical。
- React Hooks 7 新增编译器诊断的业务组件重构已登记为 feat-009，未在本 feature 中扩大范围。

### 下一步

单独启动 feat-009，在行为测试保护下逐项启用 React Hooks 7 编译器诊断。

## 2026-08-26 — 测试 Harness 与 Next.js 15 兼容性重构

### 已完成

- 修复 `ali-oss` 顶层导入导致本地存储测试和生产构建崩溃的问题，并添加导入回归测试。
- 将 Vitest 升级到 4.1.11，拆分 Node 与 jsdom 项目，引入 Testing Library、user-event、jest-dom 和 MSW。
- 将 AuthPanel、LoginForm、PostEditor 测试迁移为可访问行为测试；为相关表单和交互控件补齐 label/aria/键盘能力。
- 建立 PostgreSQL 16 Testcontainers 集成层和 Prisma 数据重置工具，覆盖唯一约束、访问控制和级联删除。
- 建立 Playwright setup/public/authenticated 项目与 8 条核心旅程，配置 trace、截图和视频产物。
- 建立 V8 覆盖率门槛；当前结果为 statements 41.67%、branches 36.68%、functions 47.58%、lines 42.34%。
- 升级 Next.js 15.5.24、Nodemailer 9.0.5、PostCSS 8.5.26，并迁移异步 cookies/headers/params/searchParams 与 ESLint CLI。
- 清理全部 ESLint error/warning，修复可选存储副作用、Hook 依赖和 Next Link 问题。
- 建立 `AGENTS.md`、测试专题文档、功能状态、初始化脚本和会话交接。
- 完成 Docker Desktop Ubuntu WSL integration 下的真实运行验证；修复 E2E setup 缺少同源 `Origin`、locator 歧义及双用户 session 相互失效问题。
- 将 `npm run dev` 默认启动参数改为 `next dev --hostname 0.0.0.0`，修复 WSL mirrored networking 下默认仅监听 IPv6、Windows localhost 无法访问的问题。

### 验证证据

- `npm run typecheck`：通过。
- `npm run lint`：通过，0 warning / 0 error。
- `npm test`：45 个文件、307 项测试通过。
- `npm run test:coverage`：通过四项非回退门槛。
- `npm run build`：Next.js 15.5.24 生产构建通过；沙箱内字体下载被限制，授权联网后通过。
- `sudo -n -g docker -u dadalv npm run test:integration`：1 个文件、3 项测试通过；Testcontainer 成功执行 Prisma migrations，验证唯一约束、持久化成员访问控制与级联删除。
- `sudo -n -g docker -u dadalv npm run test:e2e`：1 条 setup 与 8 条业务旅程全部通过；生成两份隔离 storage state。
- E2E 调试失败时保留了 screenshot、video 与 `error-context.md`，验证失败产物配置有效；最终运行状态为 `passed`、`failedTests: []`。
- `npm run check:quick`：类型检查、lint、45 个文件/307 项 Vitest 测试全部通过。
- `npm run dev -- --port 3101`：实际执行 `next dev --hostname 0.0.0.0 --port 3101`；`ss` 确认 `0.0.0.0:3101` IPv4 监听，Windows `localhost:3101/api/health` 返回 `ok=true`、`db=true`。
- `npm audit --omit=dev`：3 项（1 low、1 moderate、1 high、0 critical）；Next 内置 PostCSS 与 tsx/esbuild 等待上游或独立主版本迁移。
- `./init.sh`：按用户本次明确要求未运行；以 `npm run check:quick` 完成快速门禁。

### 阻塞

- 无当前 feature 阻塞。
- 当前用户 `dadalv` 不在 `docker` 组；本次使用 `sudo -n -g docker -u dadalv` 临时赋予单次命令组权限，未修改长期系统配置。
- 本地 `.env` 当前按用户选择连接遗留 PostgreSQL 容器发布的 `127.0.0.1:15432`；该容器不属于当前 Compose 项目，若未来重建为 Compose 服务需同步恢复为 `5432`。

### 下一步

该阶段推荐的 feat-007 已在后续会话完成；当前唯一推荐下一步见顶部 Current State。
