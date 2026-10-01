# QAM-03 双人生活信息与计划管理工程质量审查

## 元数据

| 项目 | 内容 |
| --- | --- |
| QAM | QAM-03 双人生活信息与计划管理 |
| 快照日期 | 2026-09-19 |
| 审查 Skill | [`xoxo-qam-03-life-plan-review`](../../.agents/skills/xoxo-qam-03-life-plan-review/SKILL.md) |
| 标准版本 | [`module-quality-review-standard.md`](./module-quality-review-standard.md) v1.0.0 |
| 范围来源 | [`PROJECT_VIEW.md`](../../PROJECT_VIEW.md) 的 QAM-03、Cross-cutting Concerns、共享映射、BU-03/BU-04 与 Quality Tracking Index；[`AGENTS.md`](../../AGENTS.md) |
| 本轮 Delta | `+1`（QAM-03-007 resolved；93→94；两地时间不再于渲染期读取两端各自挂钟，SSR 与 hydration 取自同一服务端时刻） |
| 当前基线命令 | `VITEST_MAX_WORKERS=1 ./scripts/run-node22.sh npm run check` exit 0：80 文件/687 项 Vitest、production build（4.4s）、覆盖率 51.58/45.39/56.06/52.25。完整开发序列 `VITEST_MAX_WORKERS=1 E2E_APP_MODE=development ... npm run check:full` 的 PostgreSQL 29 文件/110 项通过，Playwright 41/42，最后一项搜索用例在宿主机 available 490MB、2GB swap 用满、`next-server` RSS 2.7GB 时 90000ms 超时；单独运行同一用例 9.5s 通过，属宿主机容量边界，详见 [任务验收证据](../../feature_list.json) 的 feat-068 |
| 风险匹配命令 | 组件 [`life-panel-world-clock`](../../tests/component/life-panel-world-clock.test.tsx) 2/2（负向对照下 2 项均失败）；两地时间身份旅程 `--grep 'resolves life panel identity for the second room participant'` 2/2（含 setup）；集成 `room-snapshot-privacy` 1/1（夹具改为 `joinedAt` 全序）。原始命令、负向对照与完整门禁进展见 [任务验收证据](../../feature_list.json) |
| 证据纪律 | E3 为本轮实际执行的测试/可复现实验；E2 为源码、schema、迁移与测试交叉证据；未把 mock 结果写成真实 PostgreSQL 或浏览器验证 |

## Overall

| 指标 | 结果 |
| --- | --- |
| Score | **94 / 100** |
| Score Level | **L4** |
| Gate Level | **L4** |
| Final Level | **L4** |
| Trend | `+1`（QAM-03-007 resolved，93→94） |
| Evidence Confidence | 高（本轮 E3 由真实 Chromium 固定浏览器时钟复现两地时间 hydration mismatch，并以组件级 SSR/hydration 双向断言证明修复；真实 PostgreSQL 与既有边界证据保持） |

QAM-03-007 已关闭：两地时间不再在渲染期读取两端各自的挂钟。首帧沿用服务端渲染时刻，挂载后才切换为浏览器时钟，SSR 文字与 hydration 文字必然一致。修复前组件级回归以固定时钟复现 `+21:05 / -18:05` mismatch 并失败，修复后通过；真实 Chromium 下原 `LifePanel` 世界时钟 hydration mismatch 消失。此前的 QAM-03-005 结论（Memo/Schedule 共享字段 contract）保持不变；QAM-03 当前无开放 P0/P1/P2。

## Score Breakdown

| 维度 | Score | Max | Finding / Evidence |
| --- | ---: | ---: | --- |
| 架构与责任边界 | 14 | 14 | cap、trigger、参与者与 Memo/Schedule 字段各有 QAM-03 的 `lib/` 事实源；新增 `life-authoring-contract.ts` 不依赖 Route、Agent 或数据库，可被 HTTP、Tool 与客户端单向复用；仅服务端组装 Zod 对象 schema，客户端基础字段解析不触发 eval 探测（E2/E3）。 |
| 代码结构与复杂度 | 8 | 10 | CRUD、cron、天气和客户端交互均可定位；主要复杂度来自 Route/Tool 平行分支，而非业务本身（E2）。 |
| 抽象与复用 | 8 | 8 | 字段上限、trim、默认标题、Memo 必填/可选与 nullable 描述统一为共享 schema；Registry 从同一 contract 导出 JSON schema，表单引用相同 schema/常量；26 项入口行为与导出回归通过（E3）。 |
| 数据流与状态一致性 | 12 | 12 | Room scope、active count/write transaction、显式参与者身份与 one-shot 绝对时刻一致；跨进程 TZ 和 PostgreSQL parity 证明合法 offset 不漂移，非法 trigger 不进入持久化（E3）。 |
| 接口与依赖关系 | 10 | 10 | Memo/Schedule 字段的 create/update 契约已统一；Agent 边界长度记录可被 HTTP 原样保存，nullable 描述新建/清空/省略有相同持久化结果。沿用较大上限与部分 PATCH 保护旧记录，不需要迁移（E3）。 |
| 健壮性、并发与生命周期 | 13 | 14 | Room 行锁、29→30 竞争、非法 cron/时区/过期或无 offset `fireAt`、`fireAt+cron`、参与者缺失和天气 timeout/fallback 均有失败控制；run-once 触发终态由 QAM-04 独立保护。新增：两地时间的 SSR/hydration 生命周期不再依赖渲染期挂钟读数，固定时钟下由服务端时刻驱动首帧、挂载后交给浏览器时钟（E3）。 |
| 性能与资源使用 | 7 | 8 | Memo/Job 的 snapshot/Tool 查询有 room/index 与 take 边界，天气 cache 有 `MAX_CACHE_SIZE=500` 淘汰阈值；`who=both` 顺序请求天气是局部延迟成本（E2）。 |
| 安全与隐私 | 9 | 10 | 生活 Route 统一认证、成员校验和 roomId 归属检查；Memo/Job Tool 也检查资源所属房间，天气只读取房间参与者档案（E2）。 |
| 可测试性与验证可信度 | 8 | 8 | 本轮新增契约、组件、真实 PostgreSQL 与 Chromium 字段往返 E3，并有旧 contract 25/26 failed、旧 Modal 5/6 failed 的负向对照；原 one-shot/cap 定向回归 14/14 保持。QAM-03-007 的固定时钟 SSR/hydration 回归同样计入本维度，但本维度已满分，不再额外加分。 |
| 可维护性、演进与技术债 | 5 | 6 | 字段 contract 与旧值兼容策略已有单一修改入口；ScheduledJob 更新矩阵及非本轮字段的平行入口仍需在相关变更时一起复核（E2）。本轮不扩大为其他输入或调度治理。 |
| **合计** | **94** | **100** | 算术精确合计（14+8+8+12+10+13+7+9+8+5=94）。 |

## Level Gate

| 门禁 | 结果 | 证据与原因 |
| --- | --- | --- |
| 开放 P0 | 通过 | 未发现权限突破、不可恢复数据损坏、重复高风险副作用或支持启动路径整体失效。 |
| 开放 P1 且涉及权限、不可恢复错误、并发重复副作用或支持启动失效 | 通过 | 当前无开放 P1；QAM-03-004 已按原 ID 标为 resolved。 |
| 最高风险不变量有风险匹配行为验证 | 通过 | active cap、one-shot 绝对时刻与 Route/Agent parity 有真实 PostgreSQL E3；非法 trigger 有 Registry 前置拒绝，参与者身份有 Chromium E3。 |
| L4 要求 | 通过 | 无开放 P0/P1；最高风险边界具备失败路径、跨进程 TZ、真实数据库和完整浏览器门禁证据。 |
| **最终判定** | **L4** | Score Level=L4；Gate Level=L4；Final Level=min(L4,L4)=L4。 |

## Critical Issues

### P0

当前无开放项。

### P1

当前无开放项。

### P2

当前无开放项。

### Resolved — QAM-03-007：两地时间在渲染期读取挂钟，SSR 与 hydration 文字不一致

- **状态**：`resolved`（首次发现 2026-09-19；由 feat-068 在真实浏览器下复核高开销开发门禁时定位）。
- **现象**：Chat 冷启动的 `observed.errors` 收到 `Hydration failed because the server rendered text didn't match the client.`，组件栈终止于 `LifePanel (components/chat/LifePanel.tsx:135)` / `formatTime`（`LifePanel.tsx:141`），差异文字为 `+13:05 / -10:05`。React 随即在客户端重建整棵树。
- **根因**：`LifePanel` 是会被服务端渲染的客户端组件，其 `now` 状态在渲染期以 `new Date()` 初始化。服务端与浏览器各自读取本机挂钟，只要两次读数跨过分钟边界，`formatTime` 输出的 `HH:MM` 就不同。常规时机下该窗口只有毫秒级，通常不跨分钟；开发模式叠加高负载时 hydration 窗口被拉长到秒级，跨分钟概率随之上升，因此在完整开发门禁中才稳定暴露。
- **修正**：首帧改由服务端时刻驱动 —— [`app/chat/[roomId]/page.tsx`](../../app/chat/[roomId]/page.tsx) 传入 `serverNow={Date.now()}`，经 [`ChatApp`](../../components/chat/ChatApp.tsx) 透传到 [`LifePanel`](../../components/chat/LifePanel.tsx)，`useState(() => new Date(serverNow))` 使 SSR 与 hydration 取自同一份读数；挂载后的 `useEffect` 仍切回浏览器时钟并保持 30 秒刷新。未改动 `formatTime` 的时区语义、天气加载或任何既有断言。
- **负向对照与回归**：[`tests/component/life-panel-world-clock.test.tsx`](../../tests/component/life-panel-world-clock.test.tsx) 用 `toFake: ["Date"]` 固定挂钟、保留真实定时器；服务端 10:05Z 与浏览器 13:05Z 相差 3 小时。回退被修正的初始化式后两项均失败，hydration 症状为 `+21:05 / -18:05`（与线上 `+13:05 / -10:05` 同形）；修复后 SSR 取自 `serverNow`、`hydrateRoot` 的 `onRecoverableError` 为空、挂载后仍更新为浏览器时钟。
- **边界说明**：本次未以 skip、mock、关闭错误断言或不设依据地放大全局超时来消除失败；修正落在产品边界的时序来源上。

### Resolved — QAM-03-005：Memo/Schedule 的 Route 与 Agent 字段约束漂移

- **状态**：`resolved`。
- **原问题与影响**：HTTP/UI 的 Memo title/content 与 Schedule description 上限为 200/8000/200，Agent 分别允许 500/20000/500；Agent 已创建的合法较长记录在 UI 中不能原样修改保存。另有空白、默认标题与 nullable 描述的差异，UI 新建空描述会发送原 HTTP create schema 不接受的 null。
- **共享 contract**：[`life-authoring-contract.ts`](../../lib/life-authoring-contract.ts) 统一 trim 后的 500/20000/500 上限（按 JavaScript 字符串长度）；[`validation.ts`](../../lib/validation.ts) 的 HTTP create/patch、[`tool-contracts.ts`](../../agent/tool-contracts.ts) 的 Agent create/update 与 [`LifePanelModals.tsx`](../../components/chat/LifePanelModals.tsx) 共同引用。Memo 创建省略标题使用“新的备忘录”，UI 预填相同默认值；显式空白/null 标题或正文被拒绝。更新省略字段不改写；描述 null、空字符串和空白均清空为 null，undefined 表示省略。
- **已有记录兼容**：采用原 Agent 已允许的较大上限，无迁移、不批量改写或截断数据。UI 仅发送实际修改的 Memo title/content 和 Schedule description；即使旧字段超过现行上限，改置顶或其他字段仍可完整保留原文及首尾空白。超限旧字段通过 `aria-describedby` 说明“未修改时完整保留，修改需缩短至上限”；修改后的超限值明确报错，用户草稿保留在弹窗中。
- **Node/组件 E3**：[`life-authoring-contract.test.ts`](../../tests/lib/life-authoring-contract.test.ts) 旧 contract 25/26 失败→26/26 通过，覆盖四入口边界、边界加一、trim、空白/null/非字符串、省略/default 及 Tool JSON schema 导出。[`life-authoring-fields.test.tsx`](../../tests/component/life-authoring-fields.test.tsx) 旧 Modal + 新 contract 5/6 失败，修复后与既有 Modal 共 11/11；用键盘替换边界字段末字、粘贴新建边界值、清空描述、仅改置顶/指令保留超限旧字段，MSW 用实际 HTTP schema 验证请求。
- **PostgreSQL E3**：[`life-authoring-fields.integration.test.ts`](../../tests/integration/life-authoring-fields.integration.test.ts) 新增 9/9。实际 Registry/ToolCall 事务创建和更新，HTTP POST/PATCH 后回读 Prisma，确认 500/20000/500 边界值往返无损；501/20001/501 的 create/update 被两入口拒绝、原记录和 ToolCall 数量不变；null/空白清空、省略保留及超限旧字段首尾空白完整保留。连同既有 one-shot 11 项、active cap 3 项定向合计 23/23，nextRunAt、cron、runOnce 与 cap 竞争语义保持。
- **Chromium E3**：[`authenticated.spec.ts`](../../tests/e2e/authenticated.spec.ts) 的“Agent 创建的较长备忘录和计划可在 UI 编辑保存并刷新回读”在隔离房间预置计划，经独立 Agent Runtime 进程与真实 Registry 消费，持久化 300/9000/300 字符记录、2 条 completed ToolCall。浏览器键盘替换末字后两个 PATCH 均 200，真实 DB 回读和刷新重开表单一致，计划 nextRunAt/cron 未移位；定向 2/2（含 setup）。不把预置计划称为真实 LLM 规划验证。
- **生产 CSP 迭代 E3**：初版把 Zod 对象 schema 带入客户端，生产完整门禁在 Agent Entry Chat 往返观察到 `script-src` violation（34 passed/1 failed，Study 两项通过）；源码定位到对象构造时 `allowsEval` 的动态代码探测。修正为客户端仅消费基础字段 schema，HTTP/Agent 使用共享 field shape 组装对象；未改 CSP 或全局 Zod 配置。Node/组件/Agent 定向 67/67、生产入口/长记录旅程 3/3（含 setup）通过，长记录用例新增跨导航和表单提交的 CSP 事件断言。完整门禁最终终态见基线与进度。
- **影响范围**：QAM-03 直接负责字段与旧值兼容；QAM-08 继续消费共享 contract，未修改通用 Registry/Planner，QAM-04 Scheduler 未改。完整命令、门禁终态与清理见 [任务验收证据](../../feature_list.json)。

### Resolved — QAM-03-006：Cron 与时区表单控件缺少可访问名称

- **状态**：`resolved`。
- **原问题与影响**：Cron 的小时、分钟和时区控件没有 label 关联，可见文字无法成为辅助技术可识别的名称；原时区测试使用无 name 的角色查询，掩盖了缺口。
- **修正**：[`CronBuilder.tsx`](../../components/chat/CronBuilder.tsx) 使用 `fieldset/legend` 表达“执行时间”，为小时、分钟分别提供 `sr-only` label 与 `id/htmlFor`；[`TimezoneSelector.tsx`](../../components/chat/TimezoneSelector.tsx) 绑定可见 label 与 select。两者的 ID 均由 `useId` 生成，多实例不会共享同一个标签目标；原有样式、cron 生成和默认时区解析保持。
- **组件 E3**：[`cron-timezone-controls.test.tsx`](../../tests/component/cron-timezone-controls.test.tsx) 用带 name 的 `group`、`spinbutton`、`combobox` 查询，验证双 Cron 实例、默认/自定义时区标签各自的关联和聚焦，并以 Tab/键盘把工作日 09:00 改为 18:45，输出仍为 `45 18 * * 1-5`。[`life-panel-modals.test.tsx`](../../tests/component/life-panel-modals.test.tsx) 的既有时区默认值/one-shot 回归改用名称查询；旧组件定向 5/8 失败（无名输入及缺失分组），修复后 8/8。
- **浏览器 E3**：[`authenticated.spec.ts`](../../tests/e2e/authenticated.spec.ts) 的“仅用键盘创建计划”从入口到提交全程使用 Tab/Enter/文本键与原生 select 的 ArrowDown；真实 PostgreSQL 回读 `45 18 * * *`、`Europe/London` 及原始 prompt/description，刷新后键盘重开编辑表单，按名称读回 18、45、Europe/London。定向 Chromium 2/2（含 setup）；第二参与者默认时区旅程也已通过名称查询。jsdom 时区值变化仍用 `selectOptions` 模拟原生选择，不把它称作真实方向键验证。
- **影响范围**：仅 QAM-03 UI 语义和对应测试；没有改动 QAM-04 调度、one-shot trigger、active cap、schema 或字段长度。完整门禁与测试迭代记录见 [feat-054 验收证据](../../feature_list.json)。

### Resolved — QAM-03-004：Agent Schedule 接受无 offset 的 `fireAt` 并按 Worker 时区持久化错误时刻

- **状态**：`resolved`。
- **修正**：[`lib/scheduled-job-one-shot.ts`](../../lib/scheduled-job-one-shot.ts) 导出 offset datetime schema 与 trigger 组合谓词；[`lib/validation.ts`](../../lib/validation.ts) 和 [`agent/tool-contracts.ts`](../../agent/tool-contracts.ts) 共同引用，create 要求 `fireAt`/`cron` 恰一，update 禁止二者同时出现。resolver 自身也先校验 offset，再构造 `Date`，不会依赖 Worker `TZ` 猜测业务时刻。合法 offset、五分钟宽限、cron 合成与 QAM-04 触发策略未改。
- **验收证据**：修复前新增的 resolver/Registry 定向套件 2 文件/50 项中 6 项失败：Asia/Shanghai 与 America/Los_Angeles 子进程把无 offset 值解释为不同绝对时刻，四组 Agent create/update 非法 trigger 越过 validation；修复后 50/50。合法 `2030-05-09T20:40:00+01:00` 在两个进程均解析为 `19:40Z`，无 offset 均抛 `ScheduledJobFireAtError`；Registry 对 create/update 的无 offset 与 `fireAt+cron` 均抛 `ToolValidationError`，execute 未调用且无 `ScheduledJob` 写入（E3）。真实 PostgreSQL [`scheduled-job-one-shot-fireat.integration.test.ts`](../../tests/integration/scheduled-job-one-shot-fireat.integration.test.ts) 11/11，回读 Agent create/update 与 Route POST/PATCH 的 `nextRunAt`、`cron`、`payload.runOnce` 一致，并确认四组非法 Agent 输入不改变原 Job、无 ToolCall（E3）。
- **完整门禁**：`check:full` 单次退出 0，含 72 文件/480 项 Vitest、Next.js production build、覆盖率 48.26/42.98/53.55/49.14、20 文件/63 项真实 PostgreSQL 与 30/30 Playwright。QAM-03-005/006 保持独立开放。
- **影响范围**：QAM-03 负责 trigger 输入与持久化语义；QAM-08 Registry 继续只负责通用 validation/execution，QAM-04 继续消费已验证 Job，未修改其 CAS、missed-window 或派生策略。

### Resolved — QAM-03-003：UI 与 Agent 以参与者数组位置推断本人/伙伴

- **状态**：`resolved`。
- **修正**：新增 [`lib/participant-resolution.ts`](../../lib/participant-resolution.ts) 作为无框架依赖的身份解析事实源；ID 缺失或无法匹配时同时返回空 self/partner，不以数组顺序猜测。[`ChatApp.tsx`](../../components/chat/ChatApp.tsx) 将 `currentUser.id` 传入 LifePanel，LifePanel 与 ScheduledJobModal 按 ID 排列本人/伙伴并选择本人的默认时区；Agent weather/timezone/schedule Tool 用 `requestedById` 调用同一 helper，显式 city/timezone/label 仍优先。
- **验收证据**：未修复组件负向对照 2/5，第二参与者仍显示 Alice/Bob 且计划默认 Asia/Shanghai；未修复 Agent 负向对照 2/6，伙伴天气错误取 London、timezone.compare 错把 Alice/Shanghai 当本人。修复后相关组件 7/7、Agent/Server 4 文件/35 项通过；[`weather-participant-resolution.test.ts`](../../tests/server/weather-participant-resolution.test.ts) 证明 Route 与 Tool 对第二参与者的伙伴均解析为 Alice/Shanghai。真实 Chromium [`authenticated.spec.ts`](../../tests/e2e/authenticated.spec.ts) 以第二参与者独立登录，验证伙伴天气为第一参与者 Tokyo、本人时间排在伙伴之前、计划默认 Europe/London；空 Cookie request context 防止单活 Session 污染后续用例，完整 Playwright 29/29（E3）。
- **影响范围**：QAM-03 直接受影响；参与者排序、QAM-02 RoomSnapshot transport、QAM-04 调度触发、schema/migration 均未改。

### Resolved — QAM-03-001：一次性任务编辑的 `fireAt` 被 PATCH 契约静默丢弃

- **状态**：`resolved`。
- **修正**：[`lib/scheduled-job-one-shot.ts`](../../lib/scheduled-job-one-shot.ts) 成为一次性时间语义的单一来源（`fireAt` 解析、五分钟宽限、`nextRunAt`、合成 cron、合法 cron 优先），[`lib/zoned-time.ts`](../../lib/zoned-time.ts) 提供墙上时间与时刻的双向换算；[`scheduledJobPatchSchema`](../../lib/validation.ts#L84) 增加 `fireAt` 与"不可与 cron 同时提供"的 refine，[`[jobId]/route.ts`](../../app/api/rooms/%5BroomId%5D/scheduled-jobs/%5BjobId%5D/route.ts) 按显式状态转移矩阵写入，Agent `schedule.update` 的 [`tool-contracts.ts`](../../agent/tool-contracts.ts) 契约与 [`schedule-tool.ts`](../../agent/tools/schedule-tool.ts) 同步增加 `fireAt`，编辑弹窗按任务时区显示与提交墙上时间。Route 不再从 `agent/tools` 导入，分层倒置一并消除。
- **验收证据**：真实 PostgreSQL [`scheduled-job-one-shot-fireat.integration.test.ts`](../../tests/integration/scheduled-job-one-shot-fireat.integration.test.ts) 9/9，断言 PATCH 后 `nextRunAt`/`cron`/`payload.runOnce` 持久化回读、仅改 prompt 不移位、once→recurring 按 cron 重算、过期与非法输入 400，并断言 Route 与 Agent `schedule.update` 在同一 `fireAt` 上得到相同 `nextRunAt`/`cron`（E3）。组件层 [`life-panel-modals.test.tsx`](../../tests/component/life-panel-modals.test.tsx) 以 MSW 捕获 PATCH body：负向对照在未修复组件上 3/4 失败（显示 `2026-08-28T01:30` 而应为 `09:30`，保存后时刻偏移 −480 分钟），修复后 4/4（E3）。`tests/lib` 覆盖墙上时间往返、DST 歧义与缺口、宽限/非法/合法分支（E3）。
- **影响范围**：QAM-03 直接受影响；QAM-04 只获得语义自洽的触发输入，claim/CAS 与派生未改。
- **遗留核对**：合成 cron 描述用户请求的时刻而非宽限后推的 `nextRunAt`，两者在“已过期但仍在五分钟宽限内”时相差数秒；Job 为 `runOnce`，触发时即禁用，不影响结果。原关联的 QAM-04-002 已在 feat-046 解决超出 missed window 后次日重放问题，本轮没有把 Scheduler 责任重新登记到 QAM-03。

### Resolved — QAM-03-002：计划数量上限非原子且跨入口不一致

- **状态**：`resolved`。
- **修正**：[`scheduled-job-authoring.ts`](../../lib/scheduled-job-authoring.ts) 将 30 条 cap、Room `FOR UPDATE` 锁、active count、create 以及 disabled→enabled 判定收敛为单一事务服务。Route POST/PATCH 显式开启 Prisma interactive transaction，Agent `schedule.create/update` 复用 Tool Registry 已有的副作用事务；Agent update 不再可绕过 cap。
- **验收证据**：[`scheduled-job-active-cap.integration.test.ts`](../../tests/integration/scheduled-job-active-cap.integration.test.ts) 在真实 PostgreSQL 中对 enabled INSERT/UPDATE 注入延迟。去掉 Room 行锁的负向对照 0/2，Route/Agent create 与 re-enable 都同时成功；恢复锁后 3/3，两类竞争均恰一成功/恰一冲突、active count=30、无孤儿 Job，已启用 Job 在满额时仍可由 Route/Agent 编辑（E3）。全量 PostgreSQL 18 文件/48 项及 `check:full` 通过，QAM-04 Scheduler 回归未变。
- **影响范围**：QAM-03 直接受影响；QAM-04 只获得受 cap 保护的扫描输入，触发 CAS/派生未改；QAM-08 只复用现有 Tool 事务边界。

## Architecture and Data Flow

```text
当前用户
  ├─ ChatApp(initial RoomSnapshot)
  │    └─ LifePanel / Modal ──HTTP──> Memo/Job/Weather Routes ──> Prisma / weather adapter
  └─ AgentTask Runtime
       └─ buildAgentContext ──> memo/schedule/timezone/weather Tool ──> Prisma / weather adapter

ScheduledJob definition (QAM-03) ──> scheduler-tick CAS/dispatch (QAM-04)
Tool registration/deadline/retry/approval (QAM-08) 包裹生活 Tool，但不拥有生活规则。
```

字段输入事实源为 `lib/life-authoring-contract.ts`：HTTP schema、Agent schema 与表单共享，Agent Registry 导出的 JSON schema 同步反映长度和 nullable；UI PATCH 省略未编辑文本以保留旧值。持久化事实源是 Prisma `Memo` 与 `ScheduledJob`；RoomSnapshot、Agent context 和客户端 modal 是派生视图/输入。Route 在入口处认证并 `assertRoomAccess`，资源 Route 和生活 Tool 再校验目标记录的 `roomId`；天气使用进程内 location/weather TTL cache，并在 QWeather 失败时返回标识为 mock 的降级结果。ScheduledJob 的 offset datetime schema、create XOR、update at-most-one 与正常时间派生由 `lib/scheduled-job-one-shot.ts` 共享；HTTP/Agent 在入口复用 contract，resolver 再防御性校验，随后 create/re-enable 经 authoring service 进入 Room 行锁串行化的 count-and-write。Route 自己开启 transaction，Agent Tool 使用 QAM-08 Executor 已有 transaction。LifePanel/Modal 的 `currentUserId` 与 Tool context 的 `requestedById` 均进入 `lib/participant-resolution.ts`，数组排序只用于稳定展示/上下文，不承担身份协议。ScheduledJob 到期 claim、任务派生和触发失败计数留给 QAM-04；Tool 通用 executor/审批/trace 留给 QAM-08。

## Verified Strengths

- Cron/Timezone 使用原生 label 与 fieldset/legend；同屏多实例、标签聚焦、小时/分钟键盘输入、浏览器原生时区选择和保存后刷新一致性已有 E3。视觉名称和实际提交值一致，默认时区与 one-shot 既有回归继续通过。
- Memo、ScheduledJob、Weather Route 都先调用 `requireCurrentUser` 与 `assertRoomAccess`；Memo/Job 单记录 Route 和对应 Agent Tool 都再次核对 `roomId`，形成房间隔离的双重边界（E2）。
- ScheduledJob active cap 已由共享 service 统一应用于 Route POST/PATCH 和 Agent create/update；真实 PostgreSQL 延迟触发器将原竞争窗口稳定放大，修复后证明 30 条上限、冲突语义和非 re-enable 编辑行为（E3）。
- Memo 输入、计划 body 和 Agent Tool 输入都有 Zod/运行时契约；计划 trigger 的 offset datetime 与组合谓词由 HTTP/Agent 共享，cron-parser 按 IANA timezone 解析，合法 offset `fireAt` 有五分钟宽限并强制 one-shot（E2/E3）。Memo/Schedule 字段 contract 也已共享，QAM-03-005 resolved。
- 一次性计划的 trigger contract、`fireAt` 解析、宽限、`nextRunAt` 与合成 cron 只由 `lib/scheduled-job-one-shot.ts` 实现，Route POST/PATCH 与 Agent `schedule.create/update` 共用；跨进程 TZ 和真实 PostgreSQL 断言合法 offset 产生同一绝对时刻与 `cron`，避免入口或 Worker 环境再次漂移（E3）。
- HTTP 对不可解析/无 offset/超出宽限的 `fireAt`、`fireAt+cron`、非法 cron 和未知 IANA 时区有稳定 400；Agent Registry 对对应 contract 错误在 execute 前抛 `ToolValidationError`，不产生 `ScheduledJob` 写入（E3）。
- 客户端编辑弹窗的 `datetime-local` 墙面时间按任务时区的双向换算显示与提交，未改动字段直接保存不会移动触发时刻；组件回归在未修复组件上有 3/4 失败的负向对照（E3）。
- 参与者身份由 `currentUserId`/`requestedById` 驱动并复用纯函数解析；第二参与者的 UI 时间顺序、伙伴天气、计划默认时区以及 Agent weather/timezone 默认对象均有负向对照和修复后回归，Weather Route/Tool 结果一致，真实 Chromium 旅程覆盖后续 Session 隔离（E3）。
- Weather adapter 有 QWeather location/weather cache 与 `MAX_CACHE_SIZE=500` 淘汰阈值、8 秒无外部 signal 时 timeout；Agent signal 会传播，fallback 明确返回 `provider=mock` 和 `fallbackReason`（E2/E3）。
- LifePanel 的天气刷新在切房间时取消旧请求并清除 interval，且只接受当前 roomId 的结果；对应组件测试通过（E3）。
- QAM-04 的 Scheduler 已有独立 CAS/事务集成证据，本报告不把 scheduler 的触发执行问题重复登记为 QAM-03；QAM-08 的 Tool Executor/审批也不作为本模块缺陷。

## Recommended Improvements

当前无开放修正项。后续修改 QAM-03 字段或入口时，以 QAM-03-005 的参数化 contract、PostgreSQL 往返和 UI 编辑回归作为验证入口；触发时间或数量限制变更仍按 QAM-03-001/002/004 的独立回归验收，不新增生活实体或产品能力。

## Sustainable Review Record

### 问题登记

| ID | Priority | 状态 | 首次发现 | 直接责任 | 关联责任 |
| --- | --- | --- | --- | --- | --- |
| QAM-03-001 | P1 | `resolved` | 2026-09-06 | QAM-03 UI/Job authoring/Route contract | QAM-04 触发时间输入 |
| QAM-03-002 | P1 | `resolved` | 2026-09-06 | QAM-03 Job authoring boundary | QAM-04 扫描输入；QAM-08 schedule Tool 入口 |
| QAM-03-003 | P1 | `resolved` | 2026-09-06 | QAM-03 UI/Tool participant resolution | QAM-01 profile source、QAM-02 snapshot transport |
| QAM-03-004 | P1 | `resolved` | 2026-09-12 | QAM-03 Schedule input/time semantics | QAM-08 Tool contract；QAM-04 触发输入 |
| QAM-03-005 | P2 | `resolved` | 2026-09-12 | QAM-03 Memo/Schedule field contracts | QAM-08 Tool contract |
| QAM-03-006 | P2 | `resolved` | 2026-09-12 | QAM-03 LifePanel form accessibility | Cross-cutting accessibility |
| QAM-03-007 | P2 | `resolved` | 2026-09-19 | QAM-03 LifePanel world clock SSR/hydration | feat-068 高开销开发门禁复核 |

### 复审触发条件

- 修改 Memo/ScheduledJob/Weather Route、LifePanel/Cron/Timezone UI、`schedule-tool`/`weather-tool`/`timezone-tool`、`tool-contracts.ts` 或相关 validation/schema。
- 修改 LifePanel 的渲染期数据来源、`serverNow` 透传链路或 `formatTime`/`formatDateTime` 的时区语义（QAM-03-007 回归入口为固定时钟的 SSR/hydration 断言）。
- QAM-04 修改 ScheduledJob trigger fields、timer/CAS，或 QAM-08 修改生活 Tool contract/执行边界。
- 新增真实 PostgreSQL 并发 cap、one-shot fireAt 和双人第二参与者浏览器旅程证据，或 Playwright 环境恢复后重跑生活旅程。

### 只追加评分历史

| 日期 | Score | Score Level | Gate | Final | Delta | 变更证据 |
| --- | ---: | --- | --- | --- | --- | --- |
| 2026-09-06 | 69 | L1 | L1 | L1 | `baseline` | 初审；定向 Agent/组件测试通过，`npm run check:quick` 通过；`npm run check:full` 的构建/真实 PostgreSQL 集成通过，Playwright 因 `libnspr4.so` 缺失未完成。 |
| 2026-09-10 | 81 | L3 | L2 | L2 | +12（QAM-03-002 resolved） | ScheduledJob authoring service 以 Room 行锁和单 transaction 统一 Route/Agent create/re-enable；真实 PostgreSQL 负向对照 0/2（无锁时均 `success/success`），修复后 3/3（恰一成功/冲突、active=30、无孤儿且 active edit 可用）；`check:full` 通过 18 文件/48 项 PostgreSQL 和 11/11 Playwright。QAM-03-001/003 仍开放，Gate/Final 为 L2。 |
| 2026-09-11 | 88 | L3 | L2 | L2 | +7（QAM-03-001 resolved） | 一次性时间语义收敛为单一事实来源 `lib/scheduled-job-one-shot.ts`（`fireAt` 解析、5 分钟宽限、`nextRunAt`、合成 cron）与 `lib/zoned-time.ts`（墙上时间双向换算），Route POST/PATCH 与 Agent `schedule.create/update` 共用同一实现，`fireAt` 一并进入 `scheduledJobPatchSchema` 与 `schedule.update` 契约（后者此前被 `.strict()` 契约静默剥离）；PATCH 新增 once→recurring 重算与状态转移矩阵。负向对照：未修复组件上 3/4 失败（显示 UTC `01:30`、未改动字段直接保存偏移 −480 分钟），修复后 4/4；真实 PostgreSQL 9/9，含 Route 与 Agent 在同一 `fireAt` 上产出相同 `nextRunAt`/`cron` 的防漂移断言。`check:full` 单次 exit 0：70 文件/457 项 Vitest、production build、覆盖率、19 文件/57 项 PostgreSQL 与 26/26 Playwright。QAM-03-003 仍开放，Gate/Final 为 L2。 |
| 2026-09-12 | 92 | L4 | L4 | L4 | +4（QAM-03-003 resolved） | `lib/participant-resolution.ts` 以显式 ID 统一 UI/Agent 的 self/partner，缺失或不匹配时不猜数组位置；LifePanel/Modal 使用 `currentUserId`，weather/timezone/schedule Tool 使用 `requestedById`。未修复组件 2/5、Agent 2/6 失败，修复后组件 7/7、Agent/Server 4 文件/35 项；Route/Tool 对第二参与者的伙伴结果一致，真实 Chromium 验证伙伴天气、时间顺序与本人默认时区。独立依赖隔离副本的 `check:full` 单次 exit 0：72 文件/466 项 Vitest、production build、覆盖率 48.18/42.99/53.42/49.10、19 文件/57 项 PostgreSQL 与 29/29 Playwright。 |
| 2026-09-12 | 85 | L3 | L2 | L2 | -7（全范围复审纠正遗漏） | feat-044 参与者实现与 9 文件/77 项定向回归仍通过，QAM-03-003 保持 resolved；可复现实验确认 Agent contract 接受无 offset `fireAt`，并在 Worker TZ 与业务 timezone 不同时把 London 20:40 错存为 12:40Z（应为 19:40Z），新增 QAM-03-004。create/update contract 对照另确认 Memo 300/9000 与 Schedule description 300 的 Route/Tool 接受范围分叉，新增 QAM-03-005；源码复核确认 Cron/Timezone 表单缺可访问名称，新增 QAM-03-006。本轮未改业务代码，未重复运行 Docker/全量门禁；根基线 `./init.sh` 72/472 已通过。 |
| 2026-09-12 | 90 | L4 | L4 | L4 | +5（QAM-03-004 resolved） | HTTP/Agent 共用 offset datetime 与 trigger 组合谓词，resolver 防御性拒绝无 offset。修复前 resolver/Registry 2 文件/50 项中 6 项失败，修复后 50/50；两个不同进程 TZ 对合法 offset 均得到 19:40Z，对无 offset 均拒绝。真实 PostgreSQL 11/11 回读 Route/Agent create/update 的 `nextRunAt`、`cron`、`runOnce` parity，并确认非法 Agent trigger 无 Job/ToolCall 副作用；`check:full` 单次 exit 0：72/480 Vitest、production build、覆盖率 48.26/42.98/53.55/49.14、20/63 PostgreSQL 与 30/30 Playwright。QAM-03-005/006 仍开放。 |

| 2026-09-13 | 90 | L4 | L4 | L4 | 0（QAM-03-006 resolved） | feat-054：`useId` 绑定独立小时/分钟 label 与时区 select，fieldset/legend 表达执行时间；旧组件 5/8 失败→修复后 8/8，多实例关联和键盘输入通过。Chromium 原生方向键选择时区、键盘提交、真实 DB 回读与刷新重开一致。完整门禁各项通过：75/544 Vitest、production build、覆盖率 48.95/43.58/53.54/49.68、25/87 PostgreSQL；保留的 Playwright 报告确认 34 expected/0 unexpected/0 flaky/0 skipped、ok=true，`.last-run.json` 为 passed。原 shell 退出句柄在环境切换后不可用，不补造退出码。字段 contract 的 QAM-03-005 保持开放，原满分验证维度不再额外加分。 |

| 2026-09-13 | 93 | L4 | L4 | L4 | +3（QAM-03-005 resolved） | feat-055：HTTP/Agent/UI 共享 Memo 500/20000 与 description 500、trim/default/nullable/省略规则，部分 PATCH 无损保留旧值。旧 contract 25/26 failed→26/26 passed，旧 Modal 5/6 failed→组件 11/11；PostgreSQL 定向 23/23、Agent 创建后 UI 编辑/刷新 E3。初版客户端 Zod 对象构造触发 CSP，改为客户端仅用基础字段 schema 后生产入口/编辑 3/3 无违规；最终生产 check:full exit 0：77/576、build、覆盖率 49.32/43.91/54.03/50.00、26/96 PostgreSQL、35/35 Playwright。默认开发完整门禁两次 Study 超时为独立 feat-063，未将生产通过写成开发通过；原失败与清理见 feature_list.json。 |

| 2026-09-19 | 94 | L4 | L4 | L4 | +1（QAM-03-007 resolved） | feat-068：真实 Chromium 固定浏览器时钟（`page.clock.setFixedTime` +3 小时）在未修复的 `LifePanel` 上复现 `+13:05 / -10:05` 的 `Hydration failed because the server rendered text didn't match the client.`，组件栈终止于 `LifePanel.tsx:141`/`formatTime`。根因为渲染期 `new Date()` 让服务端与浏览器各读本机挂钟；修正后首帧由外部挂钟 store 的常量服务端快照驱动，挂载后才切换为浏览器时钟。负向对照：把服务端快照改回读挂钟，组件回归两项均失败（SSR 渲染出宿主挂钟 `21:05`），修复后 2/2；真实浏览器同一诊断 `[diag:clock:errors] []` 且 `afterHydration=["13:14","13:14"]`，两地时间旅程 E2E 通过。`npm run check` exit 0：80 文件/687 项、production build、覆盖率 51.58/45.39/56.06/52.25。完整开发序列另见 feature_list.json 的 feat-068 条目。 |
