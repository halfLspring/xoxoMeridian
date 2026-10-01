# QAM-08 Agent 任务执行与工具治理工程质量审查

## 元数据

| 项目 | 内容 |
| --- | --- |
| QAM | QAM-08 Agent 任务执行与工具治理 |
| 快照日期 | 2026-09-13 |
| 审查 Skill | [`xoxo-qam-08-agent-runtime-review`](../../.agents/skills/xoxo-qam-08-agent-runtime-review/SKILL.md) |
| 标准版本 | [`module-quality-review-standard.md`](./module-quality-review-standard.md) v1.0.0 |
| 范围来源 | [`PROJECT_VIEW.md`](../../PROJECT_VIEW.md) 的 QAM-08、Cross-cutting Concerns、共享映射、BU-03/BU-04/BU-07/BU-08 与 Quality Tracking Index；[`AGENTS.md`](../../AGENTS.md) |
| 本轮 Delta | `+1`（82→83；QAM-08-007 澄清文案与执行事实一致性已解决） |
| 历史口径说明 | 旧专项报告 `docs/optimization/agent-runtime-review.md` 的 97/100 属于旧评分口径，不能与统一标准 v1.0.0 计算 Delta；该文件在当前工作树中处于用户既有删除状态，本轮没有恢复或链接到不存在的快照。本报告历史首行 74/100 才是统一十维评分 baseline。 |
| 当前基线命令 | 启动 `VITEST_MAX_WORKERS=1 ./init.sh` exit 0（79 文件/679 项）；最终 `VITEST_MAX_WORKERS=1 E2E_APP_MODE=production E2E_SOFTWARE_WEBGL=true NEXT_PUBLIC_AGENT_ENTRY_THEME=default ./scripts/run-node22.sh npm run check:full` exit 0：79 文件/682 项 Node/组件、生产构建、覆盖率 51.58/45.39/56.06/52.25、29 文件/110 项真实 PostgreSQL、41/41 production Playwright（4.8 分钟）；收尾 `VITEST_MAX_WORKERS=1 ./init.sh` exit 0（79 文件/682 项）。 |
| 异常与未运行命令 | 修复前 Node 2 failed/11 passed，真实 PostgreSQL 1 failed/12 passed：零 ToolCall、原 Job 整行未变，但最终回复声称已取消。原始命令与证据见 [feat-061 验收证据](../../feature_list.json)。未另跑默认 worker、开发模式完整门禁、Compose smoke、镜像或实体设备；沿用上轮单 worker/production 配置，feat-063～066 保持独立。 |
| 证据纪律 | QAM-08-007 由 Node/真实 PostgreSQL 的修复前失败与修复后回归、Chromium 实时/刷新一致性提升为 E3。结构校验、Durable Step、claim、审批、预算与请求者/Memory 回归在完整门禁中继续通过；QAM-08-001～004 的 crash、后处理、Trace 和 adapter 缺口保持既有证据边界。 |

## Overall

| 指标 | 结果 |
| --- | --- |
| Score | **83 / 100** |
| Score Level | **L3** |
| Gate Level | **L2** |
| Final Level | **L2** |
| Trend | `+1`；Gate/Final 保持 L2（QAM-08-007 resolved） |
| Evidence Confidence | 较高（计划结构与语义澄清、真实 Job/Message 一致性、Durable Step 重放和请求者身份具有 E3；完整 Worker 生命周期、非写 Tool crash、post-task 并发和 Trace 隐私仍有验证缺口） |
| 当前开放问题 | 4 项（P2×4）：QAM-08-001～004；QAM-08-005～007 已解决，不计入开放项 |

语义校验和自动修复仍无法补全一次性计划时，澄清只请求确认具体日期、时间和时区，不再声称尚未执行的取消、创建或更新已经完成。Node 和真实 PostgreSQL 先复现“零取消记录但回复已取消”，修复后 Chromium 证明实时消息、有效计划卡片和刷新结果一致，关闭 QAM-08-007。数据流与状态一致性提升 1 分，总分 83；执行顺序、Scheduler、Tool 集合和后处理机制保持，其他维度及 Gate/Final 不变。

## Score Breakdown

| 维度 | Score | Max | Finding / Evidence |
| --- | ---: | ---: | --- |
| 架构与责任边界 | 12 | 14 | Runtime、claim、Step、预算、Tool Registry 和 tracer 的主边界清楚；请求者成员解析复用共享 participant resolver，Memory 身份/相对投影收敛在单一 owner helper（[`agent/context-builder.ts#L12-L39`](../../agent/context-builder.ts#L12-L39)、[`agent/memory-identity.ts#L33-L89`](../../agent/memory-identity.ts#L33-L89)）（E2/E3）。Worker 仍同时承载 dispatch、Scheduler 和账号清理，摘要/记忆 hooks 另走 `lib/llm.ts`，对应 BU-04/BU-07/BU-08（E2）。 |
| 代码结构与复杂度 | 8 | 10 | `agent-runtime.ts` 对 claim→context→plan→tool→final 具有可追踪的线性控制流，错误分支集中；Tool Registry 同时处理校验、审批、retry、事务和 JSONL 记录，`ExecutionTracer` 又承担终态事务与 Post 投影，局部变化需同时理解多个生命周期（[`agent/agent-runtime.ts#L51-L480`](../../agent/agent-runtime.ts#L51-L480)、[`agent/tool-registry.ts#L48-L365`](../../agent/tool-registry.ts#L48-L365)）（E2）。 |
| 抽象与复用 | 7 | 8 | [`plan-contract.ts`](../../agent/plan-contract.ts) 统一外部 snake_case 映射后的结构、persisted plan 和 repair 结果校验；Provider 与 Runtime 共用同一个 Registry 实例及其实际 input schema，Node 覆盖 Registry 契约替换，避免复制内置 Tool 名单或字段规则（E3）。非写 Tool tracer 和后处理 LLM adapter 仍为独立路径（E2）。 |
| 数据流与状态一致性 | 11 | 12 | Plan checkpoint、Tool 与 Final 的恢复事实源保持；无法补全的语义计划在 Tool loop 前替换为零 Tool 澄清，不从丢弃的模型输出或待执行动作推断副作用。真实 PostgreSQL 核对原 Job 整行不变、零 ToolCall/Step 和单条澄清 Message，Chromium 验证实时/刷新后的消息与有效计划一致（[`plan-repair.ts`](../../agent/plan-repair.ts)、[`agent-plan-validation.integration.test.ts`](../../tests/integration/agent-plan-validation.integration.test.ts)、[`authenticated.spec.ts`](../../tests/e2e/authenticated.spec.ts)，E3）；post-task 派生状态仍开放。 |
| 接口与依赖关系 | 9 | 10 | `StructuredRoomContext` 显式携带稳定 userId、`requestedById/self/partner`；Runtime 把 Task 请求者传入 context，mock 与真实 Planner 都以该 contract 为权威，不再从参与者顺序猜测（[`agent/types.ts#L22-L64`](../../agent/types.ts#L22-L64)、[`agent/context-builder.ts#L87-L107`](../../agent/context-builder.ts#L87-L107)、[`agent/llm-provider.ts#L61-L99`](../../agent/llm-provider.ts#L61-L99)）（E2/E3）。QAM-03 生活 Tool、QAM-04 scheduler trigger、QAM-05 agent-log 投影和两个 LLM adapter 仍有直接跨边界依赖（E2）。 |
| 健壮性、并发与生命周期 | 12 | 14 | 既有 CAS/lease/审批/预算恢复继续通过；结构非法、未知 Tool、缺失/无效输入、空调用数组、Registry 或 trigger 漂移在任何新 Tool Step 前拒绝，语义重试返回结构非法结果时直接失败，不重用旧计划。类型化 validation 错误的摘要最多 512 字符、8 项固定路径/错误码，Task/Message/活动 Step 明确失败且保留原因（[`agent-runtime.ts`](../../agent/agent-runtime.ts)、[`execution-tracer.ts`](../../agent/execution-tracer.ts)，E3）。旧 attempt 非写 Trace、post-task 和完整 Worker shutdown 仍缺 E3。 |
| 性能与资源使用 | 6 | 8 | Context、Tool list、消息和 memory 查询有数量上限，AgentTask 关键扫描有索引；每次完成任务仍可能并发触发两次 LLM 后处理，Trace/API 可返回完整子记录且没有分页/保留策略，Worker dispatch 也按任务串行等待，当前规模可控但增长成本可见（[`agent/context-builder.ts#L4-L40`](../../agent/context-builder.ts#L4-L40)、[`app/api/agent/tasks/%5BtaskId%5D/trace/route.ts#L6-L28`](../../app/api/agent/tasks/%5BtaskId%5D/trace/route.ts#L6-L28)）（E2）。 |
| 安全与隐私 | 6 | 10 | 受保护 Agent API 具备认证和房间成员检查，Tool input 在执行/审批前解析；Memory 查询、recall、投影与去重只接受当前请求者可见的绝对 owner，未知请求者看不到个人事实（[`agent/context-builder.ts#L35-L59`](../../agent/context-builder.ts#L35-L59)、[`agent/memory-identity.ts#L91-L177`](../../agent/memory-identity.ts#L91-L177)）（E2/E3）。但 LLMCall、EventLog、Task result、Message metadata 和 JSONL/Trace API 仍可保存或返回完整 room context、Tool payload 和错误，缺字段级脱敏与保留策略（E2）。 |
| 可测试性与验证可信度 | 7 | 8 | Node 定向 3 文件/22 项覆盖重复无效 Planner、澄清无虚假完成声明、合法 runOnce 修复与普通零 Tool 对话；PostgreSQL 在原 Job 不变和零取消执行前提下检查真实 Message。浏览器仅以本地 HTTP 替换外部 LLM，实际运行 Provider/Runtime/数据库与页面（[`task-claim.test.ts`](../../tests/agent/task-claim.test.ts)、[`plan-repair.test.ts`](../../tests/agent/plan-repair.test.ts)、[`agent-plan-validation.integration.test.ts`](../../tests/integration/agent-plan-validation.integration.test.ts)，E3）。完整门禁见元数据；非写 crash、post-task、Trace 和完整 shutdown 的缺口仍在，分数保持。 |
| 可维护性、演进与技术债 | 5 | 6 | 当前功能变化大多能落在 Runtime/Registry/Step/预算文件，稳定问题可局部追踪；长期演进仍需同步 scheduler trigger、生活 Tool adapter、两个 LLM provider、Worker 三类生命周期和未来外部副作用协议，旧的 `lib/llm.ts` 后处理路径没有预算/Trace 共用接口（BU-03/BU-04/BU-07/BU-08）（E2）。 |
| **合计** | **83** | **100** | 算术核对：12+8+7+11+9+12+6+6+7+5 = 83。 |

## Level Gate

| 门禁 | 结果 | 证据与原因 |
| --- | --- | --- |
| 开放 P0 | 通过 | 未发现已由当前实现和本轮测试证明的权限突破、不可恢复数据库损坏、重复高风险副作用或支持启动路径整体不可用。高风险 `memo.delete` 在批准前不写入，数据库副作用和 Final 有真实 PostgreSQL 回滚/重放证据。 |
| 开放 P1 且涉及权限绕过、不可恢复数据错误、并发重复副作用或支持启动路径失效 | 通过 | QAM-08-006 已关闭：绝对 owner、复合唯一键、owner 内去重和请求者相对投影由真实 PostgreSQL 双成员回归保护；迁移对已知 owner 规范化，并保留可审计的冲突/歧义 legacy 行。当前无开放 P0/P1。 |
| 模块最高风险不变量有风险匹配行为验证 | 未通过 | 核心 Task claim/recovery、数据库副作用幂等、Final 原子性及本轮请求者/个人 Memory 隔离已有 E3；但非写 Tool in-flight crash、post-task 并发/恢复和完整 Worker shutdown 仍缺风险匹配行为验证，因此 Gate 不高于 L2。 |
| L4 要求 | 未通过 | Trace 隐私治理、完整跨进程生命周期和上述并发路径没有强 E3，且仍存在开放 P2。 |
| **最终判定** | **L2** | Score Level=L3；Gate Level=L2；Final Level=min(L3,L2)=L2。 |

## Critical Issues

### P0

当前无开放项。

### P1

当前无开放项。

### Resolved — QAM-08-006：请求者相对的 Planner/Memory 上下文没有稳定成员身份

- **状态**：`resolved`（2026-09-12）；**优先级**：P1
- **原问题与负向证据**：Planner context 缺少请求者身份，mock 按 `participants[0]/[1]` 猜本人/伙伴；个人 `me.*`/`her.*` 又以房间级 `(roomId,key)` upsert/跨 owner 去重。新增回归在旧实现上得到 Node 2 failed/13 passed：第二位请求者仍被规划成第一位成员，`requestedById=null` 也从数组位置猜值；真实 PostgreSQL 3/3 failed：双成员个人事实发生覆盖/删除、context/recall 错投影且空请求者可写个人事实（E3）。
- **修正**：`buildAgentContext(roomId, requestedById)` 通过稳定 userId 派生显式 self/partner，Task、mock/真实 Planner 与 Tool 共用该 contract（[`agent/context-builder.ts#L12-L39`](../../agent/context-builder.ts#L12-L39)、[`agent/context-builder.ts#L87-L107`](../../agent/context-builder.ts#L87-L107)、[`agent/agent-runtime.ts`](../../agent/agent-runtime.ts)、[`agent/llm-provider.ts`](../../agent/llm-provider.ts)）。个人 Memory 写入规范化为 `user:<id>` owner + `person.*` key；shared/system 使用稳定 room scope，唯一、upsert、相似值去重、recall 和 context 投影均按 owner 隔离（[`agent/memory-identity.ts#L33-L187`](../../agent/memory-identity.ts#L33-L187)、[`agent/memory-dedup.ts#L7-L60`](../../agent/memory-dedup.ts#L7-L60)、[`agent/tools/memory-tool.ts#L49-L153`](../../agent/tools/memory-tool.ts#L49-L153)）（E2）。
- **迁移与验收证据**：时间戳迁移新增 `ownerKey`、复合唯一键与 owner/user/key 一致性约束；已知 owner 无损规范化，规范化冲突、缺 owner 和未知 key 的行保留为带 `ownerMigration` 原因的 `legacy:<id>`（[`prisma/migrations/20260912175500_add_memory_owner_key/migration.sql`](../../prisma/migrations/20260912175500_add_memory_owner_key/migration.sql)）。独立临时数据库从全部旧迁移部署后植入 8 行，再部署新迁移，证明 8/8 保留且唯一/check 约束拒绝非法写；双成员 PostgreSQL 回归证明同名/相似 key 互不覆盖或删除、双方 context/recall 正确投影、空请求者只看 shared；Runtime 全链路证明第二位请求者 Bob/London 正确计划到 Alice/Shanghai，空请求者的 Tool input 为 `{}`（[`tests/integration/memory-owner-migration.integration.test.ts#L29-L170`](../../tests/integration/memory-owner-migration.integration.test.ts#L29-L170)、[`tests/integration/agent-requester-memory.integration.test.ts`](../../tests/integration/agent-requester-memory.integration.test.ts)、[`tests/agent/agent-runtime.test.ts`](../../tests/agent/agent-runtime.test.ts)）（E3）。
- **影响范围**：只关闭 QAM-08 context/provider/memory/task contract 根因；QAM-03 的生活 Tool 能力保持不变，QAM-08-001～005 与 QAM-03-005/006 未并入。


### Resolved — QAM-08-005：持久化/外部 Planner 结果没有完整的结构化计划校验

- **状态**：`resolved`（2026-09-12）；**优先级**：P2。
- **原问题与负向证据**：外部 `coercePlan` 静默过滤未知 Tool/补默认字段，恢复只验部分顶层类型。初版 Node 回归在旧实现上 25 failed/4 passed；真实 PostgreSQL 的 10 项缺陷场景失败，含空调用数组误报 completed、未知或后续非法调用导致合法前缀先写入、失效恢复触发重新规划或通用冲突。另 1 项合法恢复用例只是预期原模型文案、实际得到已有 Memo renderer 文案，已修正测试断言（E3）。
- **修正**：[`plan-contract.ts`](../../agent/plan-contract.ts) 统一结构、有限 confidence、Registry Tool/schema、允许集合、必需输入及所有批次；拒绝重复/空调用和未列入动作的输入。Provider 仅转换字段名，Runtime 在完成 checkpoint 前与恢复时使用相同解析器；已存在的非法计划不会静默转为重新规划。完成的旧 Step 不被重写，任何本次 Tool 执行前先校验整份计划（[`llm-provider.ts`](../../agent/llm-provider.ts)、[`agent-runtime.ts`](../../agent/agent-runtime.ts)，E3）。
- **结果与 Trace**：`AgentPlanValidationError` 的固定错误码/调用位置最多 8 项，不复制任意工具名、参数值或 Zod 错误正文；错误字符串最多 512 字符。最终 Task/Message 为 failed，活动 Step 为 validation 失败，记录 `agent.plan.validation.failed`，不使用原模型的完成声明（[`execution-tracer.ts`](../../agent/execution-tracer.ts)，E3）。
- **验收证据**：Node 新增 45/45、定向 79/79；PostgreSQL 新增 12/12，真实重验移除的 Tool、旧参数名、scheduled.job trigger、权威 checkpoint、非法 live/retry 与合法批次重放。Chromium 通过受认证 API 入队、独立进程执行真实 Runtime、真实 SSE/刷新显示失败并核对 DB/Trace，专项 2/2；最终完整门禁 74/541、25/87 PostgreSQL、33/33 Playwright 全通过（E3）。
- **边界**：只保证结构/契约非法计划不会产生新的 Tool 执行，不回滚历史 attempt 已提交的合法副作用；未扩展 Tool、后处理、LLM transport 或 Trace 保留治理。语义澄清回复的独立误报记为 QAM-08-007；影响 QAM-08 planner/Step/Registry，关联 QAM-03 Tool contract、QAM-04 trigger。

### Resolved — QAM-08-007：语义澄清分支没有执行取消却回复旧任务已取消

- **状态**：`resolved`（2026-09-13）；**优先级**：P2；对应 [feat-061 验收证据](../../feature_list.json)。
- **原问题与负向证据**：两次 Planner 都仅要求 `schedule.cancel` 却承诺一次性执行，语义校验/repair 留下 `one_shot_promise_without_create`，Runtime 在 Tool loop 前改用零 Tool 澄清。修复前 Node 2 项和真实 PostgreSQL 1 项失败；后者已断言原 Job 整行不变、ToolCall/Tool Step 为空和 fallback 事件存在，最终 Message 仍写“之前那个已经帮你取消了”（E3）。
- **最小修正**：[`buildClarifyPlan()`](../../agent/plan-repair.ts#L68) 仅返回“请再确认这次一次性任务的具体日期、时间和时区。”，不引用模型原文或待执行计划确认已完成动作。
- **验收证据**：Node 定向 22/22，覆盖重复冲突、真实 Runtime 澄清、合法 runOnce 自动修复和普通零 Tool 对话；真实 PostgreSQL 计划校验文件 13/13，旧 Job 整行/数量、零 ToolCall/Step 和单条 Message 一致；Chromium 通过受认证 API 入队、本地 LLM HTTP 与独立 Runtime 进程执行，验证实时/刷新后澄清可见、旧计划仍可停用且没有已取消声明。完整门禁及失败原文摘要见 [feat-061 验收证据](../../feature_list.json)（E3）。
- **影响范围**：只关闭 QAM-08 plan repair/final response 的真实性问题，关联 QAM-03 计划用户预期；QAM-04 Scheduler 触发、Tool 集合与后处理机制未改。

### P2

#### QAM-08-001：非写 Tool 的 ToolCall 绕过稳定 Step/lease 栅栏

- **状态**：`open`；**优先级**：P2
- **问题**：`executeDurableToolStep()` 为所有 Tool 建立 `AgentStep`，但非数据库 Tool 进入 `executeNonWrite()` 后调用 `ExecutionTracer.startToolCall()`；该方法只写 `taskId/toolName`，没有传入或保存 `stepKey`，也没有在创建、完成、失败更新时以当前 `attemptId/workerId` 做原子 lease 栅栏（[`agent/durable-step.ts#L220-L271`](../../agent/durable-step.ts#L220-L271)、[`agent/tool-registry.ts#L167-L210`](../../agent/tool-registry.ts#L167-L210)、[`agent/execution-tracer.ts#L259-L335`](../../agent/execution-tracer.ts#L259-L335)）。数据库 Tool 走另一条带 `(taskId, stepKey)` 的事务路径，因此两类 Tool 的 Durable Step/ToolCall 语义并不相同（E2）。
- **质量影响**：旧 Worker 在 lease 刚过期、但已通过前置 assert 后可能创建新的 `running` ToolCall；它在外部读取返回后又可能在 lease 丢失窗口更新该行，接管 Worker 会重新执行该 Step 并创建另一条 `stepKey=NULL` 的 ToolCall。当前内置 non-write Tool 仅为天气、搜索、时区读取，Durable AgentStep 已控制任务层的业务重放，尚未证明存在重复业务写入或跨用户影响；直接后果是 crash 窗口下 Trace 多行、永久 `running` 或旧 attempt completed 状态，降低执行历史、耗时和恢复审计可信度。因此这是需要计划治理的 P2 审计一致性债务，而不是当前 P1 错误状态（[`tests/integration/agent-durable-step.integration.test.ts#L111-L152`](../../tests/integration/agent-durable-step.integration.test.ts#L111-L152)，E2/E3）。
- **最小修正**：将稳定 `stepKey` 传入 ToolCall，并让非写 ToolCall 的 start/complete/fail 使用与当前 lease 同一事务栅栏；恢复时对 `running` 的未知读取调用明确记录为 abandoned/重试结果，保证一个 `(taskId, stepKey)` 只有一个可解释的 ToolCall 事实。保留当前天气、搜索和时区能力，不引入外部 Tool。
- **验收证据**：真实 PostgreSQL + 可控 deferred read Tool 在“外部调用已返回、Step 尚未完成”窗口杀死 Worker，接管后断言业务读取按既定 replay policy 执行、`taskId+stepKey` 只有一个最终 ToolCall，旧 attempt 不能写入新状态；另测 lease 在 start/complete/fail 之间失效时无永久 `running` 行。
- **影响范围**：QAM-08 Runtime/Tool trace；直接关联 QAM-09 Worker crash 生命周期和未来外部 Tool adapter，不重复登记 QAM-03 的天气/搜索业务规则。

#### QAM-08-002：post-task fire-and-forget hooks 可跨任务重叠并重复派生

- **状态**：`open`；**优先级**：P2
- **问题**：Final 事务完成后直接调用同步包装的 `runPostTaskHooks(task.roomId)`，其用 `void Promise.allSettled([checkAndSummarize, checkAndExtractMemories])` 脱离 AgentTask lease、attempt、预算、Trace 和 Worker shutdown 等待（[`agent/agent-runtime.ts#L336-L347`](../../agent/agent-runtime.ts#L336-L347)、[`agent/post-task.ts#L5-L17`](../../agent/post-task.ts#L5-L17)）。虽然当前 Worker 的 `dispatchPendingAgentTasks()` 对任务逐个 `await runAgentTask()`，但 `runAgentTask()` 在启动 hooks 后即返回；同一批后续任务、其他 Worker 或并发 inline 请求仍可在前一批 hooks 完成前启动。因此 Worker 的任务执行串行不等于 post-task hooks 串行。`checkAndSummarize()` 通过“最近 summary + message count”检查后直接 `MessageSummary.create()`，没有针对同一 range 的唯一键或 CAS；`checkAndExtractMemories()` 读取同一 `_system.extraction_state` 后执行多次 Memory 写入/删除，也没有 room 级 claim（[`agent/task-dispatcher.ts#L7-L34`](../../agent/task-dispatcher.ts#L7-L34)、[`agent/summarizer.ts#L11-L109`](../../agent/summarizer.ts#L11-L109)、[`agent/memory-extractor.ts#L25-L139`](../../agent/memory-extractor.ts#L25-L139)、[`prisma/schema.prisma#L386-L417`](../../prisma/schema.prisma#L386-L417)）（E2）。
- **质量影响**：该风险需要同时满足：LLM provider 可用、同一房间有两个以上任务的完成/inline 调用重叠，且房间达到摘要的 `>40` 条未摘要消息阈值（Memory 抽取则需达到其 cadence）；满足时两个 summarizer 可读到同一 `rangeEndId` 并各创建重复的持久 `MessageSummary`，后续上下文会看到重复摘要，并额外消耗 LLM/merge 资源。Memory 的 `(roomId,ownerKey,key)` 唯一键通常会把同一 owner/key 合并为更新，但无 watermark CAS 时仍可能重复调用、在同一 owner 内交错覆盖或删除并把抽取状态推进到不确定顺序。Worker 单线程轮询降低了常规重叠概率，却不能消除 detached hooks 的跨任务重叠；进程在 hook 完成前重启时也没有可恢复工作项。当前证据显示这是受条件触发的派生数据/资源治理缺口，未达到高概率核心 Task 错误状态或不可恢复业务副作用的 P1 门槛，故归为 P2（E2）。
- **最小修正**：为每个 room 的摘要/记忆后处理增加持久化、可抢占的单次工作标识（或同等唯一/CAS），令同一范围只产生一个 summary、同一 extraction watermark 只推进一次；Worker 结束前不要求同步等待全部 LLM，但必须让未完成 hook 可由后续 Worker/任务安全重试。后处理的 LLM 调用至少记录关联 run/工作项并受独立上限约束，保持现有摘要和 Memory 能力不变。
- **验收证据**：真实 PostgreSQL 并发触发两个完成任务，断言同一 `rangeStartId/rangeEndId` 只有一条 range summary、Memory watermark 单调且无交错删除；在提交 Final 后立即终止 Worker，再由新 Worker 执行恢复扫描，断言未完成 hook 可重试且不会重复摘要/Memory。Node 行为测试还应确认 hook rejection 不改变已提交 Final。
- **影响范围**：QAM-08 post-task summary/memory；`lib/llm.ts` 是直接关联的共享 LLM adapter；QAM-02 仅消费摘要结果，QAM-03 不拥有摘要/Memory 一致性。

#### QAM-08-003：Trace 与错误 payload 缺少字段级隐私治理和生命周期

- **状态**：`open`
- **问题**：Planner 将 `roomContext`、prompt 和 available tools 作为 `requestPayload` 保存到 `LLMCall`，完成结果保存 `rawResponse`；错误路径把 provider/body 或 Tool error message 写入 AgentTask、AgentStep、ToolCall、EventLog 和失败消息 metadata。成功/失败 JSONL 也保存完整 request/response/input/output，Trace API 直接整体返回任务及所有子记录（[`agent/agent-runtime.ts#L161-L219`](../../agent/agent-runtime.ts#L161-L219)、[`agent/runtime-budget.ts#L243-L277`](../../agent/runtime-budget.ts#L243-L277)、[`agent/agent-runtime.ts#L423-L475`](../../agent/agent-runtime.ts#L423-L475)、[`lib/chat-log-file.ts#L37-L61`](../../lib/chat-log-file.ts#L37-L61)、[`app/api/agent/tasks/%5BtaskId%5D/trace/route.ts#L10-L28`](../../app/api/agent/tasks/%5BtaskId%5D/trace/route.ts#L10-L28)）（E2）。
- **质量影响**：Room context 中的近期消息、档案备注和 Memory 可能在多个存储副本、debug volume 与客户端响应中长期保留；外部 provider 的错误文本/完整响应还可能扩大载荷或带回不应进入 Trace 的内容。当前房间成员授权限制了跨房间读取，但没有字段最小化、敏感数据分级、保留/删除或全局顺序语义，排查与合规删除成本随 Run 数量增长。
- **最小修正**：定义 QAM-08 的 Trace view model 和字段分级：默认只持久化摘要、长度受限错误和结构化 usage/IDs；对 profile/message/memory/Tool payload 做字段级 allow-list/脱敏，并为 DB Trace 与 JSONL debug log 提供一致保留/删除边界。保持专门 Trace API 的现有可观察状态查询，不扩大用户能力。
- **验收证据**：带敏感 profile/message、无效 Tool payload 和 provider 超长错误的 Route/Node 行为测试，断言 DB、Trace API、JSONL 均不出现被禁止字段/未截断错误；真实房间成员仍可读取允许的状态和 usage，并验证达到保留期限后可删除。
- **影响范围**：QAM-08 Trace/LLM/Tool log；直接关联 QAM-01 档案隐私、QAM-02 消息投影和 QAM-09 debug volume，不重复登记各模块的授权规则。

#### QAM-08-004：LLM planner 与摘要/记忆 adapter 的治理契约分叉

- **状态**：`open`
- **问题**：Agent planner 使用 `agent/llm-provider.ts`，后处理摘要/记忆使用 `lib/llm.ts`；后者没有接收 `AbortSignal`、AgentTask/attempt、预算 reservation、统一 usage/Trace 或运行时 deadline，且由 fire-and-forget hooks 直接调用（[`agent/llm-provider.ts#L143-L293`](../../agent/llm-provider.ts#L143-L293)、[`lib/llm.ts#L3-L95`](../../lib/llm.ts#L3-L95)、[`agent/post-task.ts#L5-L17`](../../agent/post-task.ts#L5-L17)）（E2）。
- **质量影响**：同一环境的 LLM timeout、错误分类、成本统计和取消语义按调用路径漂移；将来修改 provider、价格或敏感字段时需要手动同步两套 adapter，后处理请求可能在任务 deadline 或 Worker stop 后继续占用资源。它是当前已有摘要/记忆路径的治理缺口，不是要求统一所有未来 LLM 用例。
- **最小修正**：抽取最小共享的 LLM transport/调用契约（signal、timeout、受限错误、usage），由 planner 和 post-task use case 各自保留 prompt/输出 schema；为 post-task 工作项设置独立的可观测 budget/取消边界。不要把摘要/记忆变成 Agent plan Tool 或扩展产品能力。
- **验收证据**：Node adapter 行为测试覆盖相同 timeout/abort、HTTP 错误截断和 usage 映射；post-task 工作项在 Worker stop/超时后不再产生未治理的 fetch，planner 既有 E3 流程不回归。
- **影响范围**：QAM-08 LLM/post-task；QAM-09 Worker shutdown 和配置传播为关联责任，QAM-01 profile refine 的直接调用路径不在本次报告范围内。


## Architecture and Data Flow

```text
Message / explicit dispatch / Scheduler atomic dispatch
  └─ AgentTask(pending) + source input + frozen budget
       └─ Worker or local inline → CAS claim(attemptId, workerId, lease)
            ├─ heartbeat + lease fence
            ├─ room context(requestedById + stable userId self/partner)
            │    └─ Memory(roomId + absolute owner + canonical key)
            │         └─ requester-aware projection → aboutMe/aboutHer/shared
            ├─ Durable plan Step → 外部/恢复计划统一结构与 Registry/trigger 校验 → 语义检查
            ├─ each Durable tool Step
            │    └─ Zod input → approval/risk → budget → deadline/retry
            │         ├─ database write: business row + ToolCall + EventLog transaction
            │         └─ non-write: ToolCall/tracer side writes outside a step-level transaction
            └─ Durable final Step → Message + final Step + AgentTask + EventLog transaction
                 └─ post-task hooks (摘要/Memory)
                      └─ fire-and-forget lib/llm.ts；无 lease/checkpoint/CAS/恢复队列

Scheduler：ScheduledJob due → QAM-04 Job CAS + AgentTask/EventLog transaction → 上述 Worker
Trace：AgentTask/Step/ToolCall/LLMCall/Approval/EventLog + JSONL debug log → room-member Trace API
```

`AgentTask` 是执行状态事实源，`AgentStep(taskId, stepKey)` 是 Plan/Tool/Final 的恢复事实源，数据库写 Tool 还以 `(taskId, stepKey)` 的 ToolCall 唯一键和事务保护业务副作用。claim/heartbeat/终态使用当前 attempt 栅栏，历史真实 PostgreSQL 已证明并发 claim、SIGKILL 接管、旧终态拒绝和数据库副作用 replay。请求者身份现由 Task 的 `requestedById` 进入同一个 context contract；Memory 的持久事实源是绝对 owner 与 canonical key，相对 `me/her` 只在当前请求者边界投影，空请求者不会猜测个人归属。非写 ToolCall 与 post-task hooks 仍位于核心事实链之外；Trace API 和 JSONL 又输出完整子记录，形成执行可靠性、隐私和资源生命周期风险。未来邮件、支付、发布等外部写操作不作为当前缺陷；若新增，必须另行建立供应商幂等或 Outbox/relay 协议。

## Verified Strengths

- 无法补全的语义计划只请求澄清，真实 PostgreSQL 与 Chromium 已证明零取消执行时旧 Job 保持有效、消息不误报完成；合法语义修复与普通零 Tool 对话继续通过（本轮 E3）。

- 外部、恢复与 repair 计划共用当前 Registry 的结构化输入边界，非法后续动作不会让合法前缀先写入；真实 PostgreSQL 和 Chromium 证明明确失败、零新 Tool 副作用及刷新一致性。合法零 Tool、批次与 Durable Step 重放保持（本轮 E3）。

- `claimAgentTask()` 用单条条件 `updateMany` 从 pending/failed 或过期 running 迁移到 running，生成新 attempt 并绑定 worker/lease；本轮真实 PostgreSQL 并发与 SIGKILL 接管测试通过（[`agent/task-claim.ts#L34-L80`](../../agent/task-claim.ts#L34-L80)、[`tests/integration/agent-task-claim.integration.test.ts#L73-L165`](../../tests/integration/agent-task-claim.integration.test.ts#L73-L165)，E3）。
- `withAgentTaskLease()` 在事务内续租并在续租失败时拒绝 operation；Final Message、Final Step 和 completed Task/EventLog 位于同一事务，旧 attempt 不能覆盖结果（[`agent/task-claim.ts#L132-L145`](../../agent/task-claim.ts#L132-L145)、[`agent/execution-tracer.ts#L40-L100`](../../agent/execution-tracer.ts#L40-L100)，E2；Final/旧 attempt E3）。
- Durable Step 对 Plan、Tool、审批和 Final 使用 `(taskId, stepKey)` 唯一记录，恢复会校验 kind/input 并复用 completed output；真实 PostgreSQL 已证明 completed Plan/read Tool 不重跑、审批可恢复和 Final 不重复（[`agent/durable-step.ts#L28-L159`](../../agent/durable-step.ts#L28-L159)、[`tests/integration/agent-durable-step.integration.test.ts#L38-L205`](../../tests/integration/agent-durable-step.integration.test.ts#L38-L205)，E3）。
- Tool Registry 是执行 allowlist，所有内置 Tool 有 Zod input/output contract、风险级别、deadline、AbortSignal 和显式 retry policy；Validation 错误不会调用 Tool 或重试，数据库写 Tool 的 output 失败会回滚副作用（[`agent/tool-registry.ts#L48-L165`](../../agent/tool-registry.ts#L48-L165)、[`agent/tool-contracts.ts#L25-L170`](../../agent/tool-contracts.ts#L25-L170)、[`tests/agent/tool-registry-reliability.test.ts#L39-L182`](../../tests/agent/tool-registry-reliability.test.ts#L39-L182)，E3）。
- high-risk Tool 进入持久化 `waiting_approval`，认证且房间成员可通过受校验 API Approve/Reject；真实 PostgreSQL 已证明拒绝保留 Memo、批准后只删除一次并可重建 Registry 恢复（[`agent/tool-approval.ts#L26-L139`](../../agent/tool-approval.ts#L26-L139)、[`tests/integration/agent-tool-approval.integration.test.ts#L27-L145`](../../tests/integration/agent-tool-approval.integration.test.ts#L27-L145)，E3）。
- Runtime Budget 在 Model 调用前 reservation、Tool retry attempt 前累计，并在 Crash Recovery 后继续计数；deadline、token/cost/turn/tool 上限以稳定 `limit_exceeded` 终态结束，真实 PostgreSQL 预算测试通过（[`agent/runtime-budget.ts#L160-L287`](../../agent/runtime-budget.ts#L160-L287)、[`tests/integration/agent-runtime-budget.integration.test.ts#L26-L220`](../../tests/integration/agent-runtime-budget.integration.test.ts#L26-L220)，E3）。
- Planner、Tool 与 Memory 现在共用请求者身份：第二位成员及空请求者的 Node/Runtime 行为、双成员 Memory owner 隔离/投影和旧数据迁移均有 E3；集成环境显式固定 mock LLM，避免测试读取开发机真实 provider/凭据并触发网络（[`tests/integration/global-setup.ts#L25-L42`](../../tests/integration/global-setup.ts#L25-L42)）。

## Recommended Improvements

1. **修复 QAM-08-002（P2）**：给摘要/Memory 后处理增加持久化 room 级 CAS/唯一工作项和恢复扫描，补真实 PostgreSQL 并发、进程终止和重试证据。
2. **修复 QAM-08-001（P2）**：统一非写 ToolCall 的稳定 `stepKey`、attempt/lease 栅栏和 crash 中间态，补 deferred Tool + Worker 接管测试；不改变天气、搜索、时区的功能边界。
3. **治理 QAM-08-003（P2）**：定义 Trace allow-list、错误截断、字段脱敏和 DB/JSONL 保留删除策略，补带敏感载荷的 Route/Node 行为证据。
4. **收敛 QAM-08-004（P2）**：为 planner 与 post-task 保留各自 use-case schema，但共享 timeout/signal/usage/error transport；将后处理放进可观测且可取消的工作边界。

以上修正均保持当前 Agent 能力和 Tool 集合不变；未来外部写操作的供应商幂等键/Outbox 只作为新增能力时的协议前提，不在本基线中虚构缺陷。

## Sustainable Review Record

### 当前开放问题

| ID | Priority | 状态 | 首次证据 | 直接责任 | 关联责任 |
| --- | --- | --- | --- | --- | --- |
| QAM-08-001 | P2 | `open` | 2026-09-06 复核；非写 ToolCall 未保存 stepKey，start/complete/fail 没有 lease 原子栅栏；当前内置 Tool 仅为读取类，直接后果是 crash 窗口 Trace/状态不一致（E2；in-flight crash 未验证） | QAM-08 non-write Tool executor/tracer | QAM-09 Worker crash 生命周期 |
| QAM-08-002 | P2 | `open` | 2026-09-06 复核；Worker 任务循环虽串行，但 detached hooks 可跨任务重叠；需 LLM 可用、同房间任务重叠且达到 summary/extraction 阈值才会重复持久化派生结果（E2） | QAM-08 post-task hooks | `lib/llm.ts` 共享 adapter、QAM-09 Worker lifecycle |
| QAM-08-003 | P2 | `open` | 2026-09-06；LLM/Tool/Event/JSONL/Trace API 保存并返回完整 payload，无脱敏/保留 contract（E2） | QAM-08 Trace/privacy | QAM-01 profile、QAM-02 message projection、QAM-09 debug volume |
| QAM-08-004 | P2 | `open` | 2026-09-06；planner 与 `lib/llm.ts` adapter 的 timeout/signal/usage/Trace 契约分叉（E2） | QAM-08 LLM transport boundary | QAM-09 config/shutdown |

### 已解决问题

| ID | Priority | 状态 | 解决证据 | 直接责任 | 关联责任 |
| --- | --- | --- | --- | --- | --- |
| QAM-08-007 | P2 | `resolved` | 2026-09-13；澄清仅请求时间，不确认待执行动作。修复前 Node 2 项/PostgreSQL 1 项失败；修复后 22 项定向 Node、13 项 PostgreSQL 及 Chromium 实时/刷新均通过，零取消记录、旧 Job 有效与 Message 一致（E3） | QAM-08 plan repair/final response | QAM-03 计划用户预期 |
| QAM-08-005 | P2 | `resolved` | 2026-09-12；同源结构/Registry/trigger 预检、受限 validation Trace；Node 45 项、PostgreSQL 12 项、Chromium 失败/刷新回归及完整门禁通过（E3） | QAM-08 planner/Step contract | QAM-03 Tool domain、QAM-04 trigger protocol |
| QAM-08-006 | P1 | `resolved` | 显式 requester/self/partner contract、绝对 Memory owner 与复合唯一/去重、保留歧义/冲突行的时间戳迁移；修复前 Node 2 项与 PostgreSQL 3 项失败，修复后双成员 owner/投影、Planner→Tool、空请求者和旧数据 8/8 保留均有 E3 | QAM-08 context/provider/memory | QAM-03 participant Tool、QAM-02 task intake、QAM-01 profile privacy |

### 复审触发条件

- 修改 `agent/task-claim.ts`、`agent/durable-step.ts`、`agent/tool-registry.ts`、`agent/execution-tracer.ts`、AgentTask/AgentStep/ToolCall/LLMCall 迁移，或改变 lease/attempt/replay/终态事务。
- 修改 post-task summarizer、memory extractor、`runPostTaskHooks`、`lib/llm.ts` 或 Worker stop/restart/dispatch 生命周期。
- 修改 Trace API、EventLog/LLMCall/ToolCall/JSONL payload、日志目录或房间成员可见的执行数据。
- 修改 planner output schema、plan repair/validation、scheduler trigger blocked tools 或 Tool contract/risk/retry/deadline。
- 修改 `StructuredRoomContext`、`buildAgentContext()`、`requestedById` 传播、participant self/partner 解析、Memory key/owner/去重/schema 或 mock/real Planner 身份语义。
- 新增风险匹配证据：真实 PostgreSQL 多 Worker claim/recovery、deferred non-write crash、post-task 并发/重启、Trace 脱敏/保留删除和 adapter abort/usage 行为。

### 只追加评分历史

| 日期 | Score | Score Level | Gate | Final | Delta | 变更证据 |
| --- | ---: | --- | --- | --- | --- | --- |
| 2026-09-06 | 74 | L2 | L1 | L1 | `baseline` | 独立初审；Node 5 文件/25 项和真实 PostgreSQL 5 文件/13 项通过，证明 claim/recovery、数据库 Tool 幂等、审批、Durable Step 与预算；非写 Tool in-flight crash、post-task 并发/恢复、Trace 隐私和完整 Worker shutdown 未验证，登记 P1×2/P2×3。 |
| 2026-09-06 | 74 | L2 | L2 | L2 | `re-review`（优先级复核） | 将 QAM-08-001 从 P1 调整为 P2：当前 non-write Tool 仅为读取类，Durable AgentStep 已控制任务层重放，直接后果是 crash 窗口 Trace 多行/旧状态；QAM-08-002 明确 Worker 串行 dispatch 仍因 detached hooks 跨任务重叠，但需 LLM 可用、同房间任务重叠及 summary/extraction 阈值，重复 Summary/Memory 是条件触发的派生数据治理缺口，调整为 P2；Gate 由 L1 上调为 L2。 |
| 2026-09-12 | 70 | L2 | L1 | L1 | `-4`（完整范围复审） | 新增 QAM-08-006 P1：第二请求者身份没有进入 Planner context，个人 `me.*`/`her.*` Memory 又按房间级相对 key 唯一并跨 owner 去重，造成稳定错配及不可恢复覆盖/删除；本轮 15 文件/124 项 Node 通过，但只读 mock Planner 实验实际输出第一参与者为第二请求者的 `from`，双成员 Memory PostgreSQL 证据缺失。既有 QAM-08-001～005 均保持 open；近期 QAM-03 Tool participant resolver 与 QAM-04 Scheduler 修正不关闭 Runtime context 根因。 |
| 2026-09-12 | 80 | L3 | L2 | L2 | `+10`（QAM-08-006 resolved） | feat-050 以 Task 请求者驱动显式 self/partner，个人 Memory 改为绝对 owner/canonical key 并约束唯一/去重/recall/context；旧实现负向对照 Node 2 failed、PostgreSQL 3/3 failed，修复后迁移临时库保留 8/8 旧行、双成员与 Planner→Tool 回归通过。最终 `check:full` 72/482、22 文件/68 项 PostgreSQL、30/30 Playwright；QAM-08-001～005 保持 open。 |
| 2026-09-12 | 82 | L3 | L2 | L2 | `+2`（QAM-08-005 resolved） | feat-053 统一外部/恢复计划的 Zod、Registry/schema 与 trigger 预检；错误最多 8 项/512 字符，非法计划不执行新 Tool、不沿用完成声明。Node 新增 45 项、PostgreSQL 新增 12 项、Chromium 失败与刷新一致性；完整门禁 74/541、25/87 PostgreSQL、33/33 Playwright。抽象/健壮性各 +1；独立登记 E2 的 QAM-08-007（feat-061），开放 P2 仍为 5；其他维度/Gate 保持。 |

| 2026-09-13 | 83 | L3 | L2 | L2 | `+1`（QAM-08-007 resolved） | feat-061 仅修正 Tool loop 前的澄清输出；Node/PostgreSQL 先复现零执行却回复已取消，修复后真实 Job 整行、ToolCall/Step 和 Message 一致，Chromium 实时/刷新回归通过。数据流与状态一致性 +1，其他维度及 Gate 保持；完整门禁 exit 0：79 文件/682 项 Node/组件、生产构建、覆盖率 51.58/45.39/56.06/52.25、29 文件/110 项真实 PostgreSQL、41/41 production Playwright（4.8 分钟）。 |

复审时保留稳定问题 ID 和历史行；仅在当前代码或风险匹配证据变化时重算受影响维度，并重新核对十维合计 100、Gate 与 Final。问题状态只能使用 `open`、`resolved`、`accepted-risk`、`not-reproduced`。
