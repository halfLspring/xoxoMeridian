# QAM-07 专注学习与伙伴状态工程质量审查

## 元数据

| 项目 | 内容 |
| --- | --- |
| QAM | QAM-07 专注学习与伙伴状态 |
| 快照日期 | 2026-09-13 |
| 审查 Skill | [`xoxo-qam-07-study-review`](../../.agents/skills/xoxo-qam-07-study-review/SKILL.md) |
| 标准版本 | [`module-quality-review-standard.md`](./module-quality-review-standard.md) v1.0.0 |
| 范围来源 | [`PROJECT_VIEW.md`](../../PROJECT_VIEW.md) 的 QAM-07、Cross-cutting Concerns、共享映射、BU-02 与 Quality Tracking Index；[`AGENTS.md`](../../AGENTS.md) |
| 本轮 Delta | `+2（feat-060，QAM-07-003 resolved）` |
| 当前基线命令 | `VITEST_MAX_WORKERS=1 ./init.sh` 收尾 exit 0，Prisma generate、类型、lint、79 文件/679 项通过 |
| 风险匹配命令 | `VITEST_MAX_WORKERS=1 E2E_APP_MODE=production E2E_SOFTWARE_WEBGL=true NEXT_PUBLIC_AGENT_ENTRY_THEME=default ./scripts/run-node22.sh npm run check:full` exit 0：79/679、production build/coverage、29/109 PostgreSQL、40/40 Playwright；定向 UTC 日历/Focus 18 项通过，详见 [feat-060 验收证据](../../feature_list.json) |
| 证据纪律 | E3：本轮固定日期、三个独立进程 TZ、真实 PostgreSQL 读取/Focus 事务、组件 HTTP 刷新及 production 浏览器旅程；未单独模拟浏览器/服务端 DST 时钟，未运行开发模式完整门禁、Compose smoke 或实体设备，较低层测试不冒充这些证据 |
| 工作区说明 | 保留会话开始前所有范围外未提交改动；本轮修改 Study 统计服务/纯日历模块、回归、QAM-07 报告/总览及状态记录。未修改 Focus 状态机、Goal 排序、schema/迁移或依赖 |

## Overall

| 指标 | 结果 |
| --- | --- |
| Score | **87 / 100** |
| Score Level | **L3** |
| Gate Level | **L2** |
| Final Level | **L2** |
| Trend | `+2` |
| Evidence Confidence | 高（日期矩阵、三种进程 TZ、真实 PostgreSQL、组件与 production Playwright 已验证；Goal 并发和默认验证配置问题仍有明确边界） |
| 当前开放问题 | 1 项（P2×1） |

feat-060 将本地日期与绝对时长分离：连续天数逐个日期计数，成员查询使用当天首个时刻至次日首个时刻的半开区间，近期窗口也读取完整本地日期。纽约/伦敦的春秋切换、哈瓦那午夜重复/跳过、上海普通日期及三个服务器 TZ 的行为证据关闭 QAM-07-003；Focus 状态机未改，事务与到期恢复回归通过。数据一致性和健壮性各加 1 分；QAM-07-004 的 Goal 排序仍开放，Gate/Final 保持 L2。

## Score Breakdown

| 维度 | Score | Max | Finding / Evidence |
| --- | ---: | ---: | --- |
| 架构与责任边界 | 11 | 14 | Focus 写入和到期恢复均收敛到 [`lib/study-transitions.ts`](../../lib/study-transitions.ts)，Route/页面读服务只负责调用统一边界；Study↔Room snapshot 的循环装配和重复读模型仍未拆分（E2/E3）。 |
| 代码结构与复杂度 | 10 | 10 | start/pause/resume/stop/reconcile 共用事务、锁、结算与冲突语义；GET/页面入口在读取统计前执行 reconciliation，Route 控制流保持短小（E2/E3）。 |
| 抽象与复用 | 7 | 8 | [`lib/study-calendar.ts`](../../lib/study-calendar.ts) 独立承载日期键、日界与统计，原 Study 导出兼容调用方；纯模块不再加载数据库/Room 装配，transition 与序列化边界保持。Study/Room projection 的重复仍在（E2/E3）。 |
| 数据流与状态一致性 | 11 | 12 | 本人统计与成员分钟统一按查看者时区的 startedAt 日期读取，真实 PostgreSQL 证明 DST、午夜前后和窗口首日一致；Session 唯一键/原子结算继续通过。Goal sortOrder 仍不稳定（QAM-07-004，E2/E3）。 |
| 接口与依赖关系 | 8 | 10 | pause/resume/stop 的 Zod contract 要求客户端提交当前 session key，旧标签页命令稳定 409；认证与 Goal ownership 保持不变。Study 与 Chat snapshot contract 的循环依赖仍在（E2/E3）。 |
| 健壮性、并发与生命周期 | 13 | 14 | streak 按日历日期递减；日界定位本地日期首次出现的时刻，纽约/伦敦春秋、哈瓦那重复/跳过午夜及上海对照通过；Focus 并发、重放、回滚和到期恢复 10 项 PostgreSQL 本轮通过。Goal 并发仍待补齐（E3/E2）。 |
| 性能与资源使用 | 6 | 8 | Study 查询有近期 Session 上限，FocusState/Session/Goal 有用户、房间和时间索引；但页面先执行 6 路 Study 查询，再执行成员 Session 查询和 Room snapshot（后者还含 Room list），重复读取 FocusState/participants 会放大请求成本（[`lib/study.ts`](../../lib/study.ts#L54)、[`lib/room-snapshot.ts`](../../lib/room-snapshot.ts#L5-L99)、[`lib/room-list.ts`](../../lib/room-list.ts#L15-L30)）（E2）。 |
| 安全与隐私 | 8 | 10 | Study 入口统一 `requireCurrentUser`，Goal 资源按 userId 检查，FocusState 以 userId 唯一；Room snapshot 已显式只选 Chat/Study 所需公共档案字段，但 FocusState 查询仍仅按参与者 userId 而未带 roomId，若用户加入多个房间，可能把另一房间的专注状态投影到当前房间，该共享边界由 QAM-02 snapshot 负责复核（[`lib/room-snapshot.ts`](../../lib/room-snapshot.ts#L67-L147)、[`room-snapshot-privacy.integration.test.ts`](../../tests/integration/room-snapshot-privacy.integration.test.ts)、[`prisma/schema.prisma`](../../prisma/schema.prisma#L559-L580)）（E2，关联观察不另记 QAM-07 问题）。 |
| 可测试性与验证可信度 | 7 | 8 | 新增纯日期/进程 TZ、真实 PostgreSQL 和组件刷新证据；本模块目标行为可独立验证，Focus 原子结算保持风险匹配覆盖。Goal 并发与专用组件 timer/presence 生命周期仍有验证缺口（E3/E2）。 |
| 可维护性、演进与技术债 | 6 | 6 | session key schema、统一 settlement helper、reconciliation 入口和公开序列化均可追踪；新增时间戳迁移使 FocusState/FocusSession 的 `updatedAt` 数据库默认值与 Prisma `@updatedAt` contract 对齐，新入口没有复制第二套完成事实源（[`20260911111600_drop_focus_updatedat_default/migration.sql`](../../prisma/migrations/20260911111600_drop_focus_updatedat_default/migration.sql)）（E2/E3）。 |
| **合计** | **87** | **100** | 算术核对：11+10+7+11+8+13+6+8+7+6 = 87。 |

## Level Gate

| 门禁 | 结果 | 证据与原因 |
| --- | --- | --- |
| 开放 P0 | 通过 | 未发现权限突破、不可恢复数据库损坏、重复高风险外部副作用或支持启动路径整体不可用。 |
| 开放 P1 且涉及权限、不可恢复错误、并发重复副作用或持续故障 | 通过 | QAM-07-001/002 均由风险匹配 E3 证明关闭，当前没有开放 P1。 |
| 最高风险不变量有风险匹配行为验证 | 通过至 L2 | 本轮真实 PostgreSQL 覆盖手动状态转移、到期结算及日历边界；QAM-07-003 已关闭。Goal 并发顺序仍主要依赖 E2，保守保持 Gate L2。 |
| L4 要求 | 未通过 | QAM-07-004 的 Goal 并发排序仍缺风险匹配验证，Study↔Room snapshot 的共享读模型债务仍在；日期修复不消除这些边界。 |
| **最终判定** | **L2** | Score Level=L3；Gate Level=L2；Final Level=min(L3,L2)=L2。 |

## Critical Issues

### P0

当前无开放项。

### P1

#### QAM-07-001：Focus 状态转移与 stop 完成记录不是原子或幂等的（resolved）

- **原问题**：四个 Route 分别执行 check-then-write，stop 的 completed Session 与 idle state 不在同一事务，`currentSessionKey` 没有进入状态机或去重约束；并发 stop、pause/stop 交错和中途失败会制造重复或矛盾事实。
- **已实施修正**：[`lib/study-transitions.ts`](../../lib/study-transitions.ts) 统一 start/pause/resume/stop，在交互事务内先锁定当前 `User` 行，再以 status + `currentSessionKey` 条件更新。start 生成 UUID，API/客户端在后续命令中绑定该 key；[`FocusSession`](../../prisma/schema.prisma#L582-L603) 新增不可空 `sessionKey` 与 `(userId, sessionKey)` 唯一约束。stop 在同一事务内 upsert Session 并写 idle，重复 stop 返回既有 Session，旧 key 命令稳定 409（E2）。
- **验收证据**：[`study-focus-transitions.integration.test.ts`](../../tests/integration/study-focus-transitions.integration.test.ts) 修复前 0/3，分别观察到并发 stop 返回不同 Session、stop 后 pause 仍为 200、结算写状态失败后遗留 Session；修复后扩展为 5/5，覆盖完整 key 生命周期、旧命令隔离、并发重放、pause/stop 交错和 trigger 故障整体回滚。全量 PostgreSQL 14 文件/35 项与 Playwright 9/9 通过（E3）。
- **影响范围**：QAM-07 直接受影响；QAM-02 继续只消费 FocusState 投影。本修复没有实现到期 reconciliation、修改统计/Goal 或扩大 Room snapshot 责任。

#### QAM-07-002：完成结算只由挂载中的客户端 auto-stop 触发（resolved）

- **原问题**：服务端只保存 `expectedEndAt`，FocusSession 仅由显式 stop 创建；页面关闭、网络失败、后台冻结或浏览器崩溃会跳过客户端 auto-stop，留下过期 running state、漏记 Session 并阻塞下一次 start。
- **已实施修正**：[`lib/study-transitions.ts`](../../lib/study-transitions.ts) 抽取统一 settlement helper，并新增受用户行锁保护的 `reconcileExpiredFocusTimer()`；过期 running state 以持久化 `expectedEndAt` 作为完成时间，在同一事务 upsert `(userId, sessionKey)` Session 并写 idle。GET/服务端页面在查询统计前触发 reconciliation，start 在同一事务先结算旧计时再启动新 key，stop 对过期计时复用计划截止时间；未到期 running 与 paused 保持不变。活动 legacy state 缺 key 时会先修复稳定旧 key，不与新 start key 混用（E2）。
- **验收证据**：[`study-focus-transitions.integration.test.ts`](../../tests/integration/study-focus-transitions.integration.test.ts) 修复前 4/10 失败，分别观察到 GET 仍返回 running、start 仍保留旧 key、过期 stop 使用请求时间且 GET 故障回滚用例未触发；修复后 10/10，覆盖 GET 重访幂等、GET/start 并发、stop 重放、未到期/paused 不变及 trigger 故障整体回滚。Playwright 离开 Study 后由隔离数据库推进到期，再重访和刷新均只显示一条完成记录；数据库确认同 key 恰一条 Session。完整门禁为 14 文件/40 项 PostgreSQL 与 10/10 Playwright（E3）。
- **影响范围**：QAM-07 直接受影响；QAM-02 继续只消费 FocusState 投影。本修复没有修改 DST/Goal、Room snapshot、通知或离线学习产品语义。

### P2

#### QAM-07-003：时区统计在 DST 回退和本地午夜边界使用了不稳定的日期运算（resolved）

- **状态**：`resolved`
- **原问题与证据**：streak 对绝对时刻使用服务器 `Date.setDate`，秋季重复同一天、春季跳过一天；成员读取用当前 offset 拼午夜且没有次日上界。修复前 Node 为 7 passed/5 failed，纽约/伦敦两天记录得到 streakDays=3；真实 PostgreSQL 五个场景均失败，春季应为 60 分钟却为 70，秋季为 0（E3，原始命令和夹具失败区分见 [feat-060 验收证据](../../feature_list.json)）。
- **已实施修正**：[`study-calendar.ts`](../../lib/study-calendar.ts#L41) 独立承载纯日历规则，streak 在目标时区日期键上使用 UTC 日历递减；复用 Intl formatter，以有界二分查找该日期第一次出现的时刻作为日界，处理重复或不存在的午夜，不拼接当前 offset。[`getStudyPageData`](../../lib/study.ts#L54) 使用同一日期窗口，成员查询为 `startedAt >= todayStartUtc && startedAt < tomorrowStartUtc`；八天回看从完整本地日期起点读取。继续按 startedAt、周日周界、completed focus 和查看者传入时区统计，不改状态机、Goal 或窗口长度定义（E2/E3）。
- **边界对照**：直接 CronDate 探针在 `America/Havana` 回退日给出第二个午夜 `2026-11-01T05:00:00Z`；Intl 证明第一个午夜为 `04:00Z`。最终日期算法不依赖该库的午夜歧义选择，未增加依赖（E3）。
- **验收证据**：[`study.test.ts`](../../tests/lib/study.test.ts) 26 项包含报告原始两条记录、纽约/伦敦春秋、上海、哈瓦那午夜重复/跳过、跨午夜、周日周界和 UTC/洛杉矶/上海三个独立进程 TZ，统计与日界一致；[`study-calendar.integration.test.ts`](../../tests/integration/study-calendar.integration.test.ts) 8 项真实 PostgreSQL 覆盖成员分钟、下一天排除、非成员隔离、查看者时区与八天窗口首日。原 [`study-focus-transitions.integration.test.ts`](../../tests/integration/study-focus-transitions.integration.test.ts) 10 项继续通过（E3）。
- **呈现证据**：[`study-calendar-stats.test.tsx`](../../tests/component/study-calendar-stats.test.tsx) 通过真实组件和 MSW HTTP 边界验证概览/伙伴起始均为 1h，stop 成功后 GET 刷新均变为 45m，连续天数同步更新；不把该组件场景写成真实浏览器 DST 时钟测试（E3）。
- **影响范围**：QAM-07 直接负责统计算法；QAM-01 仍只提供档案时区，QAM-02 继续消费 Focus projection，不重复登记。开放的 QAM-07-004 保持独立。

#### QAM-07-004：StudyGoal sortOrder 是非原子、跨房间计数且无稳定 tie-breaker

- **状态**：`open`
- **问题**：Goal POST 先按 `{ userId, localDate }` count，再把结果作为 `sortOrder` create，没有 `roomId` 条件；两个标签页可得到同一 count，多个房间还会互相污染当前房间的初始序号。GET 只按 `sortOrder asc`，数据库既无 `(userId, roomId, localDate, sortOrder)` 唯一约束，也没有第二排序键（[`goals/route.ts`](../../app/api/study/goals/route.ts#L7-L35)、[`lib/study.ts`](../../lib/study.ts#L79)、[`schema.prisma`](../../prisma/schema.prisma#L604-L620)）（E2）。
- **证据**：同一浏览器的 `busyRef` 只保护当前组件，不能覆盖多标签页/重放；现有测试 mock `count` 返回 2 并断言一次 create，没有真实 PostgreSQL 并发或相同 sortOrder 的读取顺序测试（[`study-product-api.test.ts`](../../tests/server/study-product-api.test.ts#L220-L243)、[`StudyDashboard.tsx`](../../components/study/StudyDashboard.tsx#L364-L385)）（E2/E3）。Goal PATCH/DELETE 按 `userId` 检查，因此本问题不是跨用户 ownership 绕过。
- **质量影响**：同日新增清单在并发下可能出现并列且顺序不稳定，重载后项目位置抖动；多房间用户的序号会产生空洞。它不越过用户 ownership 边界，但增加用户可见顺序与持久值不一致的修改成本。
- **最小修正**：在现有 Goal 写入 service 中按 `userId + roomId + localDate` 事务化分配下一个序号，并让读取使用 `sortOrder` 加稳定 `id` tie-breaker；保留现有可编辑 `sortOrder` 和 Goal 数量/文本规则，不新增排序产品能力。
- **验收证据**：真实 PostgreSQL 并发创建同一用户/房间/本地日的 Goal，读取顺序稳定且每条只出现一次；多房间同日创建互不影响；PATCH/DELETE 仍只允许 owner。补 Route 行为和数据库并发测试。
- **影响范围**：QAM-07 直接受影响；QAM-02 不拥有 Goal 排序，QAM-01 仅提供用户 timezone/身份。

## Architecture and Data Flow

```text
当前用户 / profile.timezone
  ├─ Study page/API
  │    └─ reconcileExpiredFocusTimer（User 行锁 + keyed settlement）
  │         └─ getStudyRoomForUser → FocusState / StudyGoal / FocusSession / members
  │         └─ buildStudyStats(local timezone) + presence projection
  │
  ├─ POST start/pause/resume/stop
  │    └─ study-transitions（User 行锁 + status/sessionKey 条件）
  │         ├─ FocusState（单 user 当前事实 + currentSessionKey）
  │         └─ stop/reconcile 单事务 ──> FocusSession（userId + sessionKey 唯一）+ idle
  │
  └─ StudyDashboard
       ├─ client countdown / auto-stop（仅挂载时）
       ├─ 15s presence heartbeat → FocusState.lastStudySeenAt
       └─ MiniRoomChat → useRoomChat(initial RoomSnapshot)
                              └─ RoomSnapshot 聚合 Chat/Life/Agent/Focus status
```

FocusState 是当前计时事实，FocusSession 是完成历史，StudyGoal 是用户/房间/本地日清单，`lastStudySeenAt` 是 Study 页面 presence 事实。手动状态转移与服务端到期恢复共享受锁保护的 session identity 和 settlement helper，完成历史与 idle state 始终由同一事务提交或回滚。Room snapshot 仍是共享派生读模型：`getStudyPageData()` 直接查询 members/member FocusState 后再调用完整 snapshot，形成重复查询和 Study↔QAM-02 循环依赖。另有一个应由 QAM-02 负责的共享观察：snapshot 的 FocusState 查询按 participant userId 而未按 roomId 过滤，Study 不重复登记该责任。

## Verified Strengths

- 主要 Study Route 都先调用 `requireCurrentUser()`；Goal PATCH/DELETE 用 `{ id, userId }` 查找 owner，未发现跨用户 Goal 更新/删除路径（E2；ownership 行为测试 E3）。
- `FocusState.userId` 有数据库唯一键；每次 start 写入 `currentSessionKey`，pause/resume/stop 必须携带相同 key，延迟到新 Session 的旧命令会稳定返回 409（E2/E3）。
- 同一用户 transition 先取得 PostgreSQL `User` 行锁，状态写入再带 prior status/key 条件；`FocusSession(userId, sessionKey)` 唯一且 stop 单事务结算。并发 stop 返回同一 Session，pause/stop 不会让 idle 倒退，故障注入证明 Session 与 state 同时回滚（E3）。
- GET/服务端页面、start 与 stop 会在同一 transition 边界识别过期 running state；结算时间固定为持久化 deadline，重复、并发、离开后重访和刷新都不会重复 Session，客户端 auto-stop 只保留为及时 UI 路径（E3）。
- `serializeFocusState` 统一 ISO/null 字段；纯日历模块让 today/week/streak 与成员读取按同一本地日期定义计算，春秋切换、午夜重复/跳过、startedAt 归属、休息/取消过滤及三个服务器 TZ 对照通过（E3）。
- Dashboard 的 countdown 使用 `expectedEndAt`/`remainingSeconds` 重新计算而非单纯递减本地计数，running interval 和 15 秒 presence interval 都在 effect cleanup 中清理；同一标签页 busy guard 也能抑制重复点击（E2）。
- Study page 的 Room 成员与 FocusState 直接按 roomId 聚合；Mini Room Chat 复用现有 `useRoomChat`，本报告不把 Chat/SSE 基础协议问题移入 QAM-07（E2）。
- Room snapshot 现以显式 `select` 只投影参与者公共身份与 city/country/timezone；对应真实数据库隐私测试和 Study 浏览器载荷测试已进入仓库，降低 Mini Chat 把完整 Profile 带入页面的风险。其 FocusState room scope 仍按 QAM-02 关联观察处理（E2；测试实现已核对，本轮未执行 PostgreSQL/Playwright）。
- [`20260911111600_drop_focus_updatedat_default`](../../prisma/migrations/20260911111600_drop_focus_updatedat_default/migration.sql) 移除了 FocusState/FocusSession 与 Prisma schema 不一致的 `updatedAt` 数据库默认值，迁移只对齐持久化 contract，不改变计时状态语义（E2）。

## Recommended Improvements

1. **修复 QAM-07-004（P2）**：将 Goal 序号分配限定到 user/room/localDate 并加入稳定 tie-breaker，先补真实 PostgreSQL 并发证据；独立登记后实施，不与已完成的日历修复合并。
2. **关联复审 BU-02**：由 QAM-02 owner 统一 Room snapshot 的 FocusState room scope/allow-list；QAM-07 只提供明确的 Focus projection contract，避免继续扩大循环依赖和重复查询。

以上均为既有 Focus/Session/Goal/presence 语义的最小修正，不新增通知、离线学习、计时模式或聊天能力。

## Sustainable Review Record

### 当前问题跟踪

| ID | Priority | 状态 | 首次发现 | 直接责任 | 关联责任 |
| --- | --- | --- | --- | --- | --- |
| QAM-07-001 | P1 | `resolved` | 2026-09-06 | Study transition/stop service 与 FocusState/Session 事务 | QAM-02 snapshot 状态投影 |
| QAM-07-002 | P1 | `resolved` | 2026-09-06 | Study 到期结算与 Dashboard 生命周期 | QAM-02 snapshot 过期状态显示 |
| QAM-07-003 | P2 | `resolved` | 2026-09-06 | Study timezone stats/member aggregation | QAM-01 profile timezone 来源 |
| QAM-07-004 | P2 | `open` | 2026-09-06 | StudyGoal 序号分配与读取排序 | QAM-01 用户身份；QAM-02 不拥有 Goal 排序 |

### 复审触发条件

- 修改 `app/api/study/*`、`lib/study.ts`、FocusState/FocusSession/StudyGoal schema/migration 或 StudyDashboard 的 timer/presence effect。
- 新增 transition service、`currentSessionKey`/Session 幂等约束、过期 state reconciliation，或对 stop/页面刷新/浏览器关闭行为增加真实 PostgreSQL/Playwright 证据。
- 修改 profile timezone contract、统计窗口、Goal sortOrder 或 Study 与 `lib/room-snapshot.ts` 的边界；同时复核 QAM-01 timezone ownership 与 QAM-02 snapshot scope，不把同一根因重复登记。
- 新增 DST spring/fall、跨午夜/周界、Goal 并发和多标签页行为测试，或 Playwright 环境恢复后重跑 Study 关键旅程。

### 验证记录

- 2026-09-06 初审实际执行：`npm run test:unit -- tests/lib/study.test.ts tests/lib/study-productization.test.ts tests/server/study-api.test.ts tests/server/study-product-api.test.ts`（4 文件/24 项通过）；`npm run test:unit -- tests/server/study-dashboard.test.ts tests/server/chat-left-rail-study-status.test.ts`（2 文件/11 项通过）。
- 2026-09-06 `npm run test:component -- tests/component/study*.test.tsx`：component 项目没有 Study 测试文件，原始结果为 `No test files found, exiting with code 1`；不视为代码失败，也不替代缺失的 component 行为证据。
- 2026-09-06 `node --import tsx --input-type=module -e '…buildStudyStats…'`：DST 回退实验复现 `streakDays: 3`；该命令只验证 helper 可复现实验，不是数据库或浏览器证据。
- 2026-09-06 未运行 `npm run check:quick`、`npm run check`、真实 PostgreSQL integration 或完整 Playwright E2E；交接文件记录的 quick 基线仍为通过。由于本轮只写审查报告，不运行 Compose smoke。
- 2026-09-08 修复前 `npm run test:integration -- tests/integration/study-focus-transitions.integration.test.ts` 为 0/3：并发 stop 生成不同 Session、pause/stop 状态倒退、state 写失败遗留 Session；修复后扩展为 5/5，覆盖 start→刷新→pause→resume→stop→重放、旧 key 隔离、并发结算、确定性交错和故障回滚。
- transition service 单元行为 8/8；Study 定向 Node 回归 6 文件/36 项通过；`npm run check:quick` 最终随完整门禁为 60 文件/355 项通过。
- 首次 `npm run check:full` 在新增服务未纳入单元覆盖率时失败于 branches `34.61% < 35%`；补充服务行为测试后为 statements 42.42%、branches 36.38%、functions 47.68%、lines 43.17%。
- 随后完整门禁首次 Playwright 为 8/9：冷编译时停止请求仍 pending，旧用例在响应前执行 5 秒 UI 断言；用例改为等待并校验 stop 响应后，定向 2/2，最终单次 `npm run check:full` 退出 0：14 文件/35 项 PostgreSQL、9/9 Playwright 与生产构建全部通过。
- 2026-09-09 到期 reconciliation 修复前定向 PostgreSQL 为 6/10，通过原有 keyed transition 与不变状态对照；4 项失败分别为过期 GET 未结算、过期后 start 未换新 key、过期 stop 结束时间偏移、GET 故障回滚路径未触发。修复后定向 10/10，Study 定向 Node 4 文件/31 项、`npm run check:quick` 60 文件/360 项、全量 integration 14 文件/40 项、全量 Playwright 10/10 均通过。
- 2026-09-09 受限权限边界直接执行 `npm run check` 时 quick 全通过，但 production build 原始失败为 `Error: Could not parse output from TypeScript's --showConfig.`；依 AGENTS.md 使用相同 Node 22 命令在获准正常权限边界复核后退出 0。最终 `sudo -n -g docker -u dadalv ./scripts/run-node22.sh npm run check:full` 单次退出 0，覆盖率 statements 42.67%、branches 36.71%、functions 48.17%、lines 43.40%。
- 2026-09-12 根会话 `./init.sh` 通过：Prisma generate、typecheck、lint 与 72 个文件/472 项 Vitest；这是共享快速基线，不代表本模块的真实 PostgreSQL 或 Playwright 已在本轮重跑。
- 2026-09-12 本模块执行 `./scripts/run-node22.sh npm run test:unit -- tests/lib/study.test.ts tests/lib/study-productization.test.ts tests/lib/study-transitions.test.ts tests/server/study-api.test.ts tests/server/study-product-api.test.ts tests/server/study-dashboard.test.ts tests/server/study-page-productized.test.ts tests/server/chat-left-rail-study-status.test.ts`，8 文件/52 项通过。
- 2026-09-12 再次执行 `buildStudyStats` DST 回退实验：`America/New_York`、now=`2026-11-02T04:30:00Z`、Nov 1 与 Oct 31 各一条 completed focus session，仍得到 `streakDays: 3`，QAM-07-003 可复现且状态保持 `open`。
- 2026-09-12 未运行 Docker、真实 PostgreSQL integration、Playwright E2E、`npm run check` 或 `npm run check:full`；transition/Goal/timer/presence 实现与 2026-09-09 风险匹配 E3 基线相同，当前新增的 Room snapshot 公共字段投影和 Focus `updatedAt` 漂移迁移按源码/测试实现记为 E2，不把历史执行写成本轮 E3。

- 2026-09-13 feat-060：修复前 Node 7 passed/5 failed；PostgreSQL 五个日历场景均失败。最终定向日期/组件 2 文件/27 项、UTC 进程 PostgreSQL 2 文件/18 项通过；其中 8 项日历、10 项 Focus 原子/到期回归。初始正常权限 `./init.sh` 78/653 通过，收尾 `VITEST_MAX_WORKERS=1 ./init.sh` 79/679 exit 0；最终单 worker 的 production `npm run check:full` exit 0，79/679、生产构建、覆盖率 50.50/45.07/55.09/51.07、29/109 PostgreSQL、40/40 Playwright（4.1 分钟），Focus 启停及离开后到期恢复均通过。首次沙箱子进程空 stdout、两次夹具错误、组件动画等待、全量验证前次失败和复跑命令均保留在 [feat-060 验收证据](../../feature_list.json)；范围外全量首页组件/上传 Route 门禁问题独立登记 feat-065/066，不关闭其默认配置风险。

### 只追加评分历史

| 日期 | Score | Score Level | Gate | Final | Delta | 变更证据 |
| --- | ---: | --- | --- | --- | --- | --- |
| 2026-09-06 | 62 | L1 | L1 | L1 | `baseline` | 初审；Study 定向 Node 测试 6 文件/35 项通过，DST helper 实验复现回退日 streak 错误；Focus 并发/事务、过期结算、Goal 并发、DST 页面聚合和浏览器生命周期未验证。 |
| 2026-09-08 | 77 | L2 | L1 | L1 | `+15（QAM-07-001 resolved）` | keyed transition service、User 行锁、条件状态写与 `(userId, sessionKey)` 唯一约束使 stop 原子可重放；修复前 PostgreSQL 0/3、修复后 5/5，完整门禁为 14 文件/35 项 PostgreSQL 与 Playwright 9/9。QAM-07-002 仍开放，Gate 保持 L1。 |
| 2026-09-09 | 85 | L3 | L2 | L2 | `+8（QAM-07-002 resolved）` | GET/页面、start、stop 复用 keyed reconciliation 与统一 settlement；修复前 PostgreSQL 6/10、修复后 10/10，Playwright 离开/重访/刷新证明同 key 只结算一次，完整门禁为 14 文件/40 项 PostgreSQL 与 10/10 Playwright。当前仅余 P2×2。 |
| 2026-09-12 | 85 | L3 | L2 | L2 | `0（复审）` | transition/Goal/timer/presence 实现未变；定向 Node 8 文件/52 项与根 `./init.sh` 72 文件/472 项通过，DST 回退实验继续复现。Room snapshot 公共字段 allow-list 与 Focus `updatedAt` 漂移迁移改善边界/一致性证据，但未关闭 QAM-07-003/004，且本轮未重跑 PostgreSQL/Playwright，故分数与 Gate 均不变。 |
| 2026-09-13 | 87 | L3 | L2 | L2 | `+2（QAM-07-003 resolved）` | feat-060：本地日期键递减、真实日界半开查询与完整日期回看；修复前 DST/streak/成员读取失败，最终日期/组件 27 项和 PostgreSQL 18 项通过。仅数据一致性/健壮性各 +1，Goal 排序仍开放；完整门禁单次 exit 0：79/679、build/coverage、29/109 PostgreSQL、40/40 production Playwright；收尾 init 79/679 通过。 |

复审时保留上述 ID 和历史行；仅在当前代码或风险匹配证据变化时重算受影响维度，并重新核对 100 分合计、Gate、Final 与问题状态。
