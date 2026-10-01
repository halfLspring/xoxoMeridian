# QAM-02 私密房间与实时消息质量审查

## 元数据

- QAM：QAM-02 私密房间与实时消息
- 快照日期：2026-09-13
- 审查 Skill：`xoxo-qam-02-room-message-review`
- 共享标准：`docs/optimization/module-quality-review-standard.md` v1.0.0
- 范围来源：`PROJECT_VIEW.md` QAM-02、Cross-cutting Concerns、共享映射、BU-02、BU-06
- 当前基线命令：`./init.sh`；Route 定向 `./scripts/run-node22.sh npm run test:unit -- tests/server/room-stream.test.ts`；真实服务器/浏览器定向 `./scripts/run-node22.sh npm run test:e2e -- tests/e2e/authenticated.spec.ts --grep '慢查询跨多个轮询周期'`；完整门禁见本轮验收记录。
- 本轮 Delta：`+2（QAM-02-006 resolved；94→96）`
- 工作区说明：本轮仅实施 feat-056，在 Room SSE 路由为每条连接增加执行中保护，并扩展 Route 与真实服务器/浏览器回归。消息窗口和字段投影、Atlas SSE、客户端 merge、Prisma schema 与 Agent Runtime 均保持；既有用户改动保留。

## Overall

- Score：96/100
- Score Level：L4
- Gate Level：L4
- Final Level：L4
- Trend：改善（本轮 Delta +2）
- Evidence Confidence：高（旧 Route 在慢 snapshot、慢 Session/成员复核下 4 项失败；真实 PostgreSQL 锁阻塞超过六秒后，一条 Chromium SSE 连接有 4 条在等待读取的 Memo 查询。修复后 Route 20/20、真实服务器单查询及消息/Agent 状态和重连回归通过）
- 当前开放问题：0 项；QAM-02-001/002/003/004/006 已解决，QAM-02-005 保留为 `not-reproduced` 历史记录，不计入开放项。

消息 GET、页面初始 snapshot 与 SSE 继续复用最新 80 条稳定窗口和展示字段白名单。SSE 现在把 Session 复核、成员复核和 snapshot 读取纳入同一条连接的执行中保护，慢查询时跳过重叠 tick，避免查询累积与旧结果迟到覆盖。真实 PostgreSQL 与 Chromium 验证慢查询期间只有一条阻塞的快照查询，恢复及重连后消息和 Agent 状态持续一致；查询失败和连接关闭语义保持。当前评分为 96/L4。

## Score Breakdown

| 维度 | Score | Max | Finding / Evidence |
| --- | ---: | ---: | --- |
| 架构与责任边界 | 13 | 14 | Route、`lib/access.ts`、消息服务和客户端 Hook 分层清楚；普通消息与显式 dispatch 复用独立 Task/Event 派生服务，Route 只保留 HTTP 编排，但 snapshot 仍承载 QAM-02/03/07/08。[task derivation](../../lib/agent-task-dispatch.ts#L21-L122)、[dispatch](../../app/api/agent/dispatch/route.ts#L10-L63)（E2/E3） |
| 代码结构与复杂度 | 9 | 10 | Task/Event 创建、预算快照与 created payload 已从两条入口收敛为一个局部函数；房间删除/清空和 SSE 仍保留各自的异步一致性分支。[task derivation](../../lib/agent-task-dispatch.ts#L21-L56)、[messages](../../lib/messages.ts#L20-L72)（E2/E3） |
| 抽象与复用 | 8 | 8 | `getChatMessages()` 统一消息 GET 与 Room snapshot（SSR/SSE/Study）的窗口、字段白名单和序列化；同时间记录及三个入口均有真实行为对照，既有权限/Task 派生复用保持。[消息读取](../../lib/chat-messages.ts)、[入口回归](../../tests/integration/chat-message-read-model.integration.test.ts)（E2/E3） |
| 数据流与状态一致性 | 12 | 12 | Message/Task/Event 事务事实与最新消息窗口保持；同一 SSE 连接不再并发执行 snapshot，deferred 回归验证事件顺序，真实浏览器验证消息和 Agent 状态在慢查询恢复与重连后的连续性。[路由](../../app/api/rooms/%5BroomId%5D/stream/route.ts#L60)、[Route 回归](../../tests/server/room-stream.test.ts#L119)、[浏览器](../../tests/e2e/authenticated.spec.ts#L1073)（E3） |
| 接口与依赖关系 | 10 | 10 | GET 与 snapshot 共用显式 Message/Task/Tool/LLM select，输出在编译期满足现有 ChatMessage contract；稳定顺序、日期序列化、可空关系与专门 Trace 的成员授权由 PostgreSQL 校验。没有改变 HTTP 写入或 SSE 事件协议。[查询与 contract](../../lib/chat-messages.ts)、[入口与授权回归](../../tests/integration/chat-message-read-model.integration.test.ts)（E2/E3） |
| 健壮性、并发与生命周期 | 14 | 14 | 每连接执行中保护覆盖 Session/成员复核与快照读取，finally 释放后按既有 2 秒节拍恢复；abort/cancel 后停止 timer、后续查询和 enqueue。20 项 Route 行为回归覆盖慢查询、交错成功/失败、终止事件、关闭竞态及连接间隔离，真实服务器锁等待由 4 条收敛为 1 条。[Route 回归](../../tests/server/room-stream.test.ts)、[浏览器](../../tests/e2e/authenticated.spec.ts#L1073)（E3） |
| 性能与资源使用 | 7 | 8 | 消息最多 80 条，GET/SSR/SSE 不再读取完整 Task、Tool input/output、LLM request/response 或消息 metadata；Tool/LLM 摘要也有稳定顺序。轮询节拍仍为 2 秒，慢查询跳过重叠 tick；snapshot 仍聚合多个模块，房间列表无上限，保留原有扣分。[消息 select](../../lib/chat-messages.ts)、[snapshot](../../lib/room-snapshot.ts)、[room list](../../lib/room-list.ts#L12-L31)（E2/E3） |
| 安全与隐私 | 10 | 10 | 消息根字段及 Task/Tool/LLM 子关系均为白名单，metadata.toolResults 也被排除；植入完整 prompt/输入/输出后的三个消息入口不含私有值。真实 PostgreSQL 证明 Trace 对成员仍返回详情、对非成员为 403，消息 GET/SSE/Page 同样拒绝非成员；Chromium 验证初始载荷、HTTP 与 SSE 无植入值。[PostgreSQL](../../tests/integration/chat-message-read-model.integration.test.ts#L102)、[浏览器](../../tests/e2e/authenticated.spec.ts#L918)（E3） |
| 可测试性与验证可信度 | 8 | 8 | 既有 PostgreSQL 持久化/权限/消息窗口回归保持；新增可控 deferred Route 测试与真实 Next.js/Chromium/PostgreSQL 锁等待对照。使用实际 pg_locks、查询年龄和原生 EventSource 事件验证慢查询，未引入生产测试开关或伪造 snapshot。[Route](../../tests/server/room-stream.test.ts)、[浏览器](../../tests/e2e/authenticated.spec.ts#L1073)（E3） |
| 可维护性、演进与技术债 | 5 | 6 | 消息读取规则有单一修改落点，稳定合并和既有 ChatMessage contract 保持；跨 QAM snapshot 聚合及 Study 反向依赖仍需按 BU-02 核对，未借本次扩大范围。[消息读取](../../lib/chat-messages.ts)、[PROJECT_VIEW BU-02](../../PROJECT_VIEW.md#L1005)（E2/E3） |
| **合计** | **96** | **100** | 算术核对：13+9+8+12+10+14+7+10+8+5 = 96；仅调整状态一致性 +1、健壮性/并发/生命周期 +1。 |

## Level Gate

- P0：通过。当前没有具备 E3 直接行为证据的开放 P0。
- 开放 P1：通过。QAM-02-001/003/004 均已由 E3 回归关闭；QAM-02-005 保持 `not-reproduced`，不计入开放项。
- 最高风险不变量行为验证：通过。成员访问、数据库级级联、Message/AgentTask/EventLog 原子派生，以及用户至少保留一个房间的并发删除语义均有真实 PostgreSQL E3；`/chat` 默认房间解析也在同一回归中执行。
- L4 条件：通过。当前没有开放 P0/P1，持久化一致性、权限和关键失败/并发路径均有 E3；QAM-02-006 的慢查询及 SSE 生命周期也已由 Route 与真实服务器/浏览器 E3 关闭。
- 结论：Score Level=L4，Gate Level=L4，因此 Final Level=min(L4,L4)=L4。

## Critical Issues

当前无开放项；以下保留已解决问题的机制与验收证据。

### P1

#### QAM-02-001：Room snapshot 将私有 UserProfile 字段带入浏览器（resolved）

- 状态：`resolved`
- 原问题：`getRoomSnapshot()` 对 participant 使用完整 User/Profile include 并展开对象，Chat 页面又把完整认证用户传给 Client Component。修复前真实 PostgreSQL 与 Playwright RSC/HTML 载荷直接观察到 `email`、`passwordHash`、`sessionVersion`、`lastGeoIp`、`preferences`、`profileNote` 及其私有值。
- 已实施修正：[`getRoomSnapshot()`](../../lib/room-snapshot.ts#L52) 以 Prisma `select` 只读取 Room `id/name`、用户 `id/displayName/avatarLabel` 和公开 `city/country/timezone`，并再构造显式 participant view model；[`ChatRoomPage`](../../app/chat/%5BroomId%5D/page.tsx#L21-L42) 与 [`StudyPage`](../../app/study/page.tsx#L15-L28) 只把各 Client Component 需要的公开 current-user 字段送入渲染上下文，`ChatUser` 不再声明 `preferences`（E2）。
- 验收证据：[`room-snapshot-privacy.integration.test.ts`](../../tests/integration/room-snapshot-privacy.integration.test.ts#L16-L126) 修复前 0/1，收到完整 User/Profile 和植入的两组私有值；修复后 1/1 精确匹配公开 view model。[`authenticated.spec.ts`](../../tests/e2e/authenticated.spec.ts#L18-L135) 修复前在 Chat 页面 RSC 载荷观察到密码 hash 与完整私有档案并失败，修复后定向 setup + 浏览器用例 2/2，Chat/Study 均保留双方显示名、头像、城市、国家和时区，且字段名及私有值均不出现在载荷（E3）。
- 影响范围：QAM-02；直接覆盖 QAM-01 的当前用户/伙伴档案隐私边界，以及 QAM-07 复用 `getRoomSnapshot()` 的 Study 页面。

#### QAM-02-003：显式 Agent dispatch 的 Task 与 EventLog 不是原子派生（resolved）

- 状态：`resolved`
- 原问题：`/api/agent/dispatch` 的 `sourceMessageId` 分支先 `agentTask.create`，再单独 `eventLog.create`；没有事务或幂等响应。修复前真实 PostgreSQL 回归直接观察到并发响应为 `201/500`，EventLog 注入失败后遗留 1 条孤儿 Task，清除故障后的相同请求也因唯一约束无法重试。
- 已实施修正：[`createAgentTaskWithCreatedEvent()`](../../lib/agent-task-dispatch.ts#L21-L56) 集中生成预算化 Task 与 `agent.task.created` Event；普通消息与显式 dispatch 均在各自单一 Prisma transaction 内复用。显式入口在事务中锁定同一 source Message，串行读取 `AgentTask.sourceMessageId @unique` 事实；首次创建返回 201，后续/并发命中返回同一 Task 的 200，唯一冲突捕获只作为跨入口兜底。[`dispatchAgentTaskForSourceMessage()`](../../lib/agent-task-dispatch.ts#L64-L122)、[`route`](../../app/api/agent/dispatch/route.ts#L36-L59)（E2）。
- 验收证据：[`agent-dispatch-atomicity.integration.test.ts`](../../tests/integration/agent-dispatch-atomicity.integration.test.ts#L85-L225) 修复前 0/2：并发得到 `201/500`，事件故障后 Task count=1；修复后扩展为 3/3，证明并发响应 `200/201` 且 Task ID 相同、数据库恰一 Task/一 created Event，事件 trigger 故障时二者均为 0、移除故障后同一请求 201 成功，并验证自动消息入口仍持久化相同预算/输入/Event 契约。最终完整门禁为 16 文件/44 项 PostgreSQL 与 11/11 Playwright（E3）。
- 影响范围：QAM-02；QAM-08 的 claim 后 Runtime/Trace 生命周期未修改，既有 lease、budget 与 durable step 集成回归保持通过。

#### QAM-02-004：删除最后房间的保护是 check-then-act，不能保持显式不变量

- 状态：`resolved`
- 原问题：删除 Route 在事务外先 count 当前用户其他房间，再执行 `room.delete`；真实 PostgreSQL 延迟 DELETE trigger 稳定证明两个请求可同时越过保护并返回 `[200,200]`，最终删除全部成员关系，使 `/chat` 无默认房间可解析。
- 已实施修正：[`deleteRoomPreservingUserMembership()`](../../lib/room-lifecycle.ts#L22-L50) 在 Prisma interactive transaction 中先锁定稳定的 User 行，再于同一临界区重新验证目标成员资格、统计该用户全部 RoomParticipant，并仅在数量大于 1 时删除 Room。Route 保留认证、事务外早期成员校验、按用户/IP 限流和 200/409 响应契约，只委托领域服务执行原子删除。[`room DELETE`](../../app/api/rooms/%5BroomId%5D/route.ts#L12-L35)（E2）。
- 验收证据：[`room-delete-invariant.integration.test.ts`](../../tests/integration/room-delete-invariant.integration.test.ts#L59-L108) 修复前 0/1，实际响应 `[200,200]`；修复后 1/1，响应稳定为 `[200,409]`，数据库恰一 RoomParticipant，409 保留原错误 contract，并直接执行 `ChatIndexPage` 证明重定向到剩余 `/chat/:roomId`。全量真实 PostgreSQL 为 17 文件/45 项通过（E3）。
- 影响范围：QAM-02；直接关联 QAM-01 注册创建的 RoomParticipant（BU-06）。

### P2

#### QAM-02-002：消息 GET 与 snapshot 的 ChatMessage read model 漂移（resolved）

- 状态：`resolved`
- 原问题：GET 按 createdAt desc 取最新 80 条并完整 include AgentTask/ToolCall/LLMCall，snapshot 按 asc 取最旧 80 条；两个入口都缺少 ID 第二排序键，消息 metadata 还会携带完整 toolResults。长对话中 refresh 与 SSR/SSE 持续显示不同窗口，完整内部载荷也被带入消息列表。
- 已实施修正：[`getChatMessages()`](../../lib/chat-messages.ts) 用显式根字段与子关系 select 读取展示摘要，按 `(createdAt desc,id desc)` 取最新 80 条，再反转为升序并序列化日期；Tool/LLM 摘要也按时间和 ID 稳定排序。GET 与 [`getRoomSnapshot()`](../../lib/room-snapshot.ts) 共用；现有 ChatMessage 类型、客户端合并、任务状态呈现与 Trace API 均保持。
- PostgreSQL 验收：[`chat-message-read-model.integration.test.ts`](../../tests/integration/chat-message-read-model.integration.test.ts) 在旧实现上 3/3 failed，HTTP 边界出现 message-014 而预期从 message-020 开始，页面/SSE 最旧窗口和完整 Trace/metadata 均与预期不符；修复后 3/3 passed。反向植入 100 条、每 7 条同时间且跨窗口边界，重复执行 GET、实际 Page 的 initialSnapshot 与真实 SSE Response，消息 ID/顺序/摘要完全一致；空房间、短窗口、其他房间隔离、成员 Trace 详情及非成员 GET/Trace 403、SSE 拒绝和 Page 重定向均通过（E3）。
- 浏览器验收：[`authenticated.spec.ts`](../../tests/e2e/authenticated.spec.ts#L918) 旧实现缺少“长对话消息 099”而失败；修复后 setup + 旅程 2/2 passed。真实 Chromium 检查 HTML/RSC、GET 与 SSE 的最新窗口和敏感值排除，保留已派发/Tool/LLM 摘要；发送后刷新，在请求边界注入 connectionreset，再读取真实服务器的重连 refresh 与 SSE，伙伴离线期间新消息及下一周期窗口均稳定。首次尝试 setOffline 未关闭已建立 SSE，未把它误记为产品缺陷；最终故障注入不替换 EventSource 或 snapshot 数据（E3）。
- 影响范围：QAM-02；QAM-07 Study 自动复用同一 Room snapshot，QAM-08 Trace 仅消费其摘要，未改变 Runtime/Trace 存储治理或代为改分。QAM-02-006 的慢查询重入由后续 feat-056 独立修复，见下节。

#### QAM-02-006：SSE interval 允许异步 snapshot 重入并乱序写出（resolved）

- 状态：`resolved`
- 原问题：初次 `sendSnapshot()` 完成后直接 `setInterval(sendSnapshot, 2000)`，没有执行中保护；慢查询期间反复启动 Session/成员复核及 snapshot，旧结果可能在新结果之后 enqueue，客户端完整列表与 Agent 状态因而可能回退。旧 Route 的 deferred 回归实际出现预期 2 次却有 5 次调用，真实服务器也出现 4 条同时等待 Memo 表锁的快照查询（E3）。
- 已实施修正：[`sendSnapshot()`](../../app/api/rooms/%5BroomId%5D/stream/route.ts#L60) 在每条连接内同步取得 `snapshotInFlight`，覆盖 Session 复核、成员复核和 `getRoomSnapshot()`；重叠 tick 直接跳过、不排队，finally 在成功、失败或早退时释放。既有 2 秒轮询节拍、error 事件与恢复策略、kicked/roomDeleted 终止协议保持；abort/cancel 清理 timer/listener，已在途 Promise 自然结束且不得 enqueue（E2/E3）。
- Route 验收：`./scripts/run-node22.sh npm run test:unit -- tests/server/room-stream.test.ts` 在旧实现 exit 1、4 failed/16 passed；修复后 exit 0、20/20。[行为回归](../../tests/server/room-stream.test.ts#L119) 推进 8 秒可控时间，验证慢 snapshot 与慢 Session/成员检查都不重入，成功/失败按协议顺序输出并按原节拍恢复；覆盖初始/轮询 × abort/cancel × 成功/失败、关闭时的权限查询、Session 删除/过期、roomDeleted、已中止请求与连接间隔离（E3）。
- 真实服务器/浏览器验收：`./scripts/run-node22.sh npm run test:e2e -- tests/e2e/authenticated.spec.ts --grep '慢查询跨多个轮询周期'` 在旧实现 exit 1、1 passed/1 failed（含 setup）：Memo SELECT 最旧查询年龄为 6.18 秒，实际 4 条等待查询而非预期 1 条；修复后 exit 0、2/2（44.6 秒）。[Chromium 旅程](../../tests/e2e/authenticated.spec.ts#L1073) 在隔离 PostgreSQL 事务中锁住 Memo 表，用 pg_locks 与查询年龄证明跨多个 tick 仍仅一条查询；释放锁后读取真实 SSE 与 UI，完成消息和 Agent completed 状态至少连续三个快照保持。请求边界注入 connectionreset 后恢复真实服务器，断线消息和新 running Task 连续三个快照保持；锁由事务提交/回滚释放，页面、房间和 Prisma 连接清理（E3）。
- 完整门禁：`E2E_APP_MODE=production ./scripts/run-node22.sh npm run check:full` 单次 exit 0：77 文件/593 项 Vitest、Next.js 16.3.3 production build、覆盖率 49.81/44.46/54.17/50.37、26 文件/96 项真实 PostgreSQL、36/36 Playwright（浏览器阶段 4.2 分钟），无跳过。
- 影响范围：QAM-02。没有修改消息窗口/投影、Atlas SSE、客户端 merge、QAM-07 Study 状态或 QAM-08 执行状态机；本次浏览器中的 Task/Message 是隔离测试夹具，不声称验证了 Runtime 的执行过程。

## Architecture and Data Flow

```text
页面/浏览器
  ├─ GET /chat/:roomId
  │    └─ requirePageUser + participant check
  │         └─ getRoomSnapshot(roomId, userId)
  │              ├─ Room/Participant/UserProfile
  │              ├─ getChatMessages → 最新 80 条 Message + AgentTask 摘要
  │              ├─ Memo/ScheduledJob/Focus/Approval fragments
  │              └─ Room list
  ├─ GET /api/rooms/:roomId/messages
  │    └─ requireCurrentUser + assertRoomAccess → getChatMessages
  ├─ POST /api/rooms/:roomId/messages
  │    └─ assertRoomAccess → createHumanMessage transaction
  │         └─ Message → shared Task/Event derivation
  ├─ POST /api/agent/dispatch（显式 UI/调用入口）
  │    └─ assertRoomAccess → source Message row lock → shared Task/Event transaction
  │         ├─ created → 201 + Task
  │         └─ existing → 200 + same Task
  └─ EventSource /api/rooms/:roomId/stream
       └─ initial auth/member check → per-connection in-flight guard
            └─ session/member recheck → snapshot → client merge/reconnect
```

普通消息与显式 dispatch 都通过同一 helper 创建预算化 Task/Event；前者与新 Message 同事务，后者锁定既有 source Message 后与 created Event 同事务，`sourceMessageId` 唯一键提供幂等事实。Room/Message 的成员资格仍在 Route 前置检查，Room participant/profile 只沿公开 allow-list 进入 Chat、SSE 和 Study。房间删除使用 User 行作为同一用户所有 DELETE 的稳定串行化事实源，在一个事务内重查成员资格、成员数并删除；Event 写入失败会回滚 Task，SSE 对 abort/controller close 也已有保护。wipe 的额外 barrier 语义尚未由产品定义，当前保持 `not-reproduced`。BU-02 的 snapshot 聚合同时被 Chat 和 Study 使用；本报告只登记其对 QAM-02 读取 contract、隐私和实时成本的直接影响，不把 AgentTask claim 后的 Runtime 规则移入本 QAM。

## Verified Strengths

- 所有主要 Room/Message/Stream Route 都先取得当前用户并对 `roomId` 执行成员资格检查；RoomParticipant 的复合唯一键和 Room 外键级联在真实 PostgreSQL 测试中通过。
- 普通消息创建在单一 Prisma 事务内完成 Message、可选 AgentTask 和 `agent.task.created` EventLog 派生，检测结果也写入持久化 metadata；这条主路径是当前较强的事实来源。
- 普通消息与显式 dispatch 复用 `createAgentTaskWithCreatedEvent()`；真实 PostgreSQL 延迟 trigger 证明相同 source Message 并发派发只返回一个稳定 Task，失败 trigger 证明 Task/Event 原子回滚且可清洁重试。
- 最后房间删除复用独立领域服务和稳定 User 行锁；真实 PostgreSQL 删除延迟 trigger 证明旧实现可双成功，修复后并发请求严格收敛为 200/409、成员关系保留为 1，且 `/chat` 可解析默认房间。
- Room participant 查询与输出 view model 使用双重 allow-list；真实 PostgreSQL 和 Playwright 证明当前用户与伙伴的完整 User/Profile 私有字段不会进入 Chat/Study 浏览器载荷，显示名、头像、城市、国家与时区保持可用。
- SSE 使用统一 `write`/`stop`，并在每连接的 `snapshotInFlight` 内串行执行权限复核与 snapshot；本轮 20 项 Node 行为回归覆盖初始/轮询中的 abort/cancel、成功/失败、慢权限复核、终止事件和连接隔离，关闭后不再启动查询或 enqueue。
- 客户端 `stableMergeBy` 按 ID 合并并保留无变化引用，optimistic 消息在响应/重连时有替换和去重路径；消息编辑器的键盘提交、重复发送禁用和成功清空行为测试通过。
- 本轮 `./init.sh` exit 0（77 文件/576 项）；Route 修复前 4 failed/16 passed，修复后 20/20；真实服务器/浏览器修复前 1 passed/1 failed，修复后 2/2（含 setup）。`E2E_APP_MODE=production ./scripts/run-node22.sh npm run check:full` 单次 exit 0：77 文件/593 项 Vitest、Next.js 16.3.3 production build、覆盖率 49.81/44.46/54.17/50.37、26 文件/96 项真实 PostgreSQL、36/36 Playwright（浏览器阶段 4.2 分钟），无跳过。

## Recommended Improvements

当前无开放问题。后续修改 Stream timer、snapshot 查询或客户端 merge 时，重跑 QAM-02-006 的 deferred 与真实慢查询/重连回归；QAM-02-005 仅在明确清空 barrier 语义或出现新行为证据时复审。

## Sustainable Review Record

### 当前开放问题

| ID | Priority | Status | 首次证据 | 下一次复审触发 |
| --- | --- | --- | --- | --- |
| QAM-02-005 | P1 | not-reproduced | Read Committed 交错分析未证明 wipe 后并发写违反既定语义；batch transaction 原子提交（E2） | 明确记录清空 barrier/线性化语义，或出现真实 PostgreSQL 交错导致清空集合被部分保留 |

### 已解决问题

| ID | Priority | Status | 解决证据 | 下一次复审触发 |
| --- | --- | --- | --- | --- |
| QAM-02-006 | P2 | resolved | 每连接执行中保护；旧 Route 4 failed/16 passed→20/20，真实 PostgreSQL Memo 锁跨六秒后等待查询 4→1，Chromium 消息/Agent 状态及重连后三个快照持续一致（E3） | Stream timer、snapshot 查询或客户端 merge 改动 |
| QAM-02-002 | P2 | resolved | 单一字段白名单/稳定最新 80 条查询；PostgreSQL 旧实现 3/3 failed→修复后 3/3 passed，真实 Chromium 初始缺少消息 099→发送/刷新/连接重置重连/下一周期窗口与摘要一致，完整 Trace 仍仅由成员授权入口返回（E3） | Message GET、snapshot、Trace API、ChatMessage 类型或消息窗口改动 |
| QAM-02-001 | P1 | resolved | Prisma `select` + 显式 Room participant/current-user view model；真实 PostgreSQL 修复前完整 User/Profile 暴露、修复后精确公开字段，Playwright Chat/Study RSC 载荷修复前失败、修复后通过（E2/E3） | snapshot、Chat/Study Client props 或 QAM-01 profile contract 改动 |
| QAM-02-003 | P1 | resolved | 共享预算化 Task/Event helper + source Message 行锁 + `sourceMessageId` 幂等响应；真实 PostgreSQL 修复前并发 201/500 与孤儿 Task，修复后并发 200/201 同 Task、Event 故障全回滚并可重试（E2/E3） | Agent dispatch、Task 创建、EventLog created 事件或 sourceMessageId 约束改动 |
| QAM-02-004 | P1 | resolved | User 行锁 + 事务内成员资格/count/delete；真实 PostgreSQL 修复前并发 `[200,200]` 删除全部房间，修复后 `[200,409]`、保留一个成员关系并由 `/chat` 解析默认房间（E2/E3） | Room DELETE、默认房间或成员生命周期改动 |

### 复审触发与证据规则

- 任一问题修复后必须保留原 ID，状态只可改为 `resolved`、`accepted-risk` 或 `not-reproduced`，并附修复提交/测试证据；不得删除历史结论。
- 下一次复审必须重新核对 QAM-01 profile 隐私、QAM-07 Study snapshot 使用方和 QAM-08 Task/Trace 所有权，避免把共享文件的改善重复计入多个 QAM。
- 本轮定向与完整命令、负向对照及归档记录见 [任务验收证据](../../feature_list.json)。默认开发模式的 Study 完整序列问题保留在 feat-063，生产验收不代表该问题已定位或恢复。未运行 Compose smoke：没有修改构建/部署/运行配置，本次风险由真实 PostgreSQL 与浏览器完整门禁覆盖。

### 评分历史（只追加）

| 日期 | Score | Score Level | Gate | Final | Delta | 变更证据 |
| --- | ---: | --- | --- | --- | --- | --- |
| 2026-09-06 | 70 | L2 | L1 | L1 | baseline | 初审：`check:quick`、QAM-02 定向测试、PostgreSQL 访问/级联测试；浏览器 E2E 因 `libnspr4.so` 未验证。 |
| 2026-09-06 | 71 | L2 | L1 | L1 | +1（证据纪律复核） | 复核 QAM-02-005：Read Committed 下并发 POST 在无文档 barrier 时可合法线性化到 wipe 前/后，未证明部分清空或孤儿写入；移除开放项并将其标为 `not-reproduced`。 |
| 2026-09-09 | 78 | L2 | L1 | L1 | +7（QAM-02-001 resolved） | Room participant/profile 与 Chat/Study current-user props 改为 Prisma `select` 和显式公开 view model；真实 PostgreSQL 回归修复前观察完整 User/Profile、修复后 1/1，Playwright Chat/Study 页面载荷修复前失败、修复后 2/2；完整门禁通过 15 文件/41 项 PostgreSQL 与 11/11 Playwright。QAM-02-003/004 仍开放，Gate 保持 L1。 |
| 2026-09-09 | 86 | L3 | L1 | L1 | +8（QAM-02-003 resolved） | 普通消息与显式 dispatch 复用预算化 Task/Event 原子派生；显式入口以 source Message 行锁和唯一键返回同一 Task。PostgreSQL 回归修复前 0/2（并发 201/500、Event 故障遗留 Task），修复后 3/3（并发 200/201、同 Task/单 Event、故障全回滚并可重试）；完整门禁通过 16 文件/44 项 PostgreSQL 与 11/11 Playwright。QAM-02-004 仍开放，Gate 保持 L1。 |
| 2026-09-09 | 90 | L4 | L4 | L4 | +4（QAM-02-004 resolved） | 最后房间删除以 User 行锁串行，并在同一事务内重查成员资格/count/delete；PostgreSQL 回归修复前 0/1（并发 `[200,200]` 删除全部房间），修复后 1/1（`[200,409]`、保留一个成员关系且 `/chat` 解析默认房间）；完整门禁通过 17 文件/45 项 PostgreSQL 与 11/11 Playwright。开放项仅余 P2×2。 |
| 2026-09-12 | 90 | L4 | L4 | L4 | 0（当前快照复审） | feat-044～046 只在 QAM-02 直接范围增加 `ChatApp` 向 LifePanel 传递当前用户 ID，未改变消息、授权、snapshot transport 或 SSE 协议；本轮定向 5 文件/17 项通过，根 `./init.sh` 为 72/472。重新核对 QAM-02-002 的两个消息查询后补全最新/最旧 80 条窗口漂移证据，但该根因已计入原有 contract/复用扣分，问题优先级、十维分数与 Gate 均不变。 |
| 2026-09-12 | 94 | L4 | L4 | L4 | +4（QAM-02-002 resolved） | feat-051 统一消息 GET/SSR/SSE 的最新 80 条、createdAt/id 稳定顺序与最小字段白名单，排除完整 Task/Tool/LLM 和 metadata.toolResults；真实 PostgreSQL 旧实现 3/3 failed→修复后 3/3 passed，Chromium 旧实现缺少消息 099→发送/刷新/连接重置后的重连及下一周期窗口与摘要一致。复用 +1、接口 +1、隐私 +2，其余维度与 Gate 不变。完整门禁单次 exit 0，72/482 Vitest、23/71 PostgreSQL 与 31/31 Playwright 全通过。 |
| 2026-09-13 | 96 | L4 | L4 | L4 | +2（QAM-02-006 resolved） | feat-056 每连接执行中保护覆盖权限复核与 snapshot，跳过重叠 tick；旧 Route 4 项失败→20/20，真实服务器 Memo 锁跨六秒后查询 4→1，Chromium 慢查询恢复和重连后的消息/Agent 状态连续快照保持。状态一致性 +1、并发/生命周期 +1，其余维度与 Gate 不变。`E2E_APP_MODE=production ./scripts/run-node22.sh npm run check:full` 单次 exit 0：77 文件/593 项 Vitest、Next.js 16.3.3 production build、覆盖率 49.81/44.46/54.17/50.37、26 文件/96 项真实 PostgreSQL、36/36 Playwright（浏览器阶段 4.2 分钟），无跳过。 |
