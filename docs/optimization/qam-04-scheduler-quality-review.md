# QAM-04 定时任务触发与派生工程质量审查

## 元数据

| 项目 | 内容 |
| --- | --- |
| QAM | QAM-04 定时任务触发与派生 |
| 快照日期 | 2026-09-20 |
| 审查 Skill | [`xoxo-qam-04-scheduler-review`](../../.agents/skills/xoxo-qam-04-scheduler-review/SKILL.md) |
| 标准版本 | [`module-quality-review-standard.md`](./module-quality-review-standard.md) v1.0.0 |
| 范围来源 | [`PROJECT_VIEW.md`](../../PROJECT_VIEW.md) 的 QAM-04、Cross-cutting Concerns、共享映射、BU-04/BU-07 与 Quality Tracking Index；[`AGENTS.md`](../../AGENTS.md) |
| 本轮 Delta | `+1`（QAM-04-003 resolved；87→88） |
| 当前基线命令 | 本轮 `./scripts/run-node22.sh npx vitest run tests/agent/worker-lifecycle.test.ts tests/agent/worker-shutdown.test.ts tests/agent/scheduler-tick.test.ts`：exit 0，3 文件/27 项通过；真实 PostgreSQL `npx vitest run --config vitest.integration.config.ts tests/integration/scheduler-atomic-dispatch.integration.test.ts`：exit 0，6/6。本轮 `npm run check:full` 单次 exit 0（87 文件/760 项 Vitest、production build、覆盖率 53.48/47.11/58.43/54.16、32 文件/128 项真实 PostgreSQL、44/44 production Playwright） |
| 未运行命令 | 本轮未运行 `npm run test:compose-smoke`、Compose 构建与实体设备；未改 Worker 启动路径的 Compose 拓扑（属于 QAM-09），也未改 schema/迁移/依赖/Next 配置，因此未触发对应风险门禁 |
| 证据纪律 | E3 为本轮实际重跑并做先红后绿的 27 项 Scheduler/Worker Node 行为测试、进程级 SIGTERM 退出测试、6 项真实 PostgreSQL 恢复测试与完整门禁；E2 仅剩 wall-clock forward 与 DST。未把同进程 mock 竞争冒充数据库并发证据，也未把「旧实现下同样通过」的重启恢复用例算作红灯证据 |

## Overall

| 指标 | 结果 |
| --- | --- |
| Score | **88 / 100** |
| Score Level | **L3** |
| Gate Level | **L3** |
| Final Level | **L3** |
| Trend | `+1`（QAM-04-003 resolved） |
| Evidence Confidence | 较高（timer 改期/重启用/clock backward、真实 PostgreSQL 旧版本拒绝、并发 CAS/事务回滚、run-once missed-window 禁用终态，以及本轮补齐的 timer 任务所有权/进程信号/重启恢复均有 E3；仅剩 wall-clock forward 与 DST 为 E2） |
| 当前开放问题 | 0 项 |

near-term timer 携带期望 `nextRunAt`，polling 与 timer 在进入共享 claim 后统一校验 wall-clock due 和旧字段 CAS；run-once Job 无论是否仍在 missed window 内，都在成功 claim 的事务中进入禁用终态。fake-clock 与真实 PostgreSQL 证明窗口外 fireAt Job 不创建 Task/Event，推进到下一合成 cron 周期也不会重放，同时周期 Job 继续推进。本轮关闭最后一项开放 P2：timer 回调创建的任务现在由模块持有并登记进 in-flight 集合，错误在最外层收敛；停止信号可唤醒循环 sleep，shutdown 在明确有界超时内排空已开始的任务。全部 P2 已关闭后，本模块仅剩 wall-clock forward 与 DST 两项没有定向 E3，不足以支撑 L4 的「全部风险不变量已有风险匹配验证」要求。

## Score Breakdown

| 维度 | Score | Max | Finding / Evidence |
| --- | ---: | ---: | --- |
| 架构与责任边界 | 11 | 14 | `scheduler-tick.ts` 集中承担扫描、CAS、派生、失败回写和 timer；Worker 仅负责 loop/lifecycle。BU-07 的 Worker 同时承载 dispatch、scheduler 与认证清理，BU-04 的 trigger/blocked-tools 常量由 Scheduler 提供、QAM-08 消费，边界可追踪但仍有共享生命周期/协议耦合（E2）。 |
| 代码结构与复杂度 | 9 | 10 | due、near-term、事务派生和 stale failure 分段清晰；timer 入口只负责版本重读，wall-clock due 与 missed-window 计算统一位于 `claimAndDispatchScheduledJob()`，两条路径不再平行表达时间条件（[`scheduler-tick.ts`](../../agent/scheduler-tick.ts#L64-L129)，E2/E3）。 |
| 抽象与复用 | 7 | 8 | `claimAndDispatchScheduledJob` 统一 timer/polling 的 enabled、due、旧版本 CAS、事务与派生语义；timer registry 以 `job.id + expectedNextRunAtMs` 表达缓存版本并由重复 tick 替换失效项。runtime budget 继续复用 QAM-08 helper；authoring/trigger 仍共享 Prisma Job（E2/E3）。 |
| 数据流与状态一致性 | 12 | 12 | `ScheduledJob.updateMany` 同时要求当前 enabled、期望 `nextRunAt`、`nextRunAt <= now`、lastRunAt 与 failCount，并在同一事务推进状态；run-once 统一写 `enabled=false`，窗口外在 Task/Event 前返回 skipped，窗口内派生仍与 Job claim 原子提交。fake-clock 与真实 PostgreSQL 已验证 missed-window 禁用终态及下一 cron 周期零副作用（[`scheduler-tick.ts`](../../agent/scheduler-tick.ts#L94-L124)，E3）。 |
| 接口与依赖关系 | 8 | 10 | `schedulerTick()`/`clearAllTimers()` 和 `SchedulerTickResult` 明确，Prisma 索引及 `TRIGGER_SCHEDULED_JOB` 契约可导航；`agent-runtime.ts`、`llm-provider.ts` 直接依赖 Scheduler 常量，协议改动需跨 QAM-04/QAM-08 同步（[`agent-runtime.ts`](../../agent/agent-runtime.ts#L20-L24)、[`llm-provider.ts`](../../agent/llm-provider.ts#L1-L1)，E2）。 |
| 健壮性、并发与生命周期 | 13 | 14 | 改期/重启用和 clock backward 不再让旧 timer 提前派生，真实 PostgreSQL 并发 tick 只有一个事务获得 claim；窗口外 run-once 安全终止，窗口内派生失败仍整事务回滚并保留既有 failCount/retry。timer callback 创建的任务进入 in-flight 集合并由最外层 catch 收敛，进程级 SIGTERM 在有界预算内退出，重启后的未提交 claim 可被重新扫描且不重复派生 Task/Event（[`scheduler-tick.ts`](../../agent/scheduler-tick.ts#L41-L100)、[`worker-lifecycle.ts`](../../agent/worker-lifecycle.ts#L1)，QAM-04-003，E3）。仍扣 1 分：wall-clock forward 与 DST 尚无定向 E3。 |
| 性能与资源使用 | 6 | 8 | enabled/nextRunAt 有索引，due 批次 20、near-term 查询最多 100，timer map 防止同一进程重复注册；每次 Worker tick 仍先查 `findFirst` 再查 due/near-term，且 due/job 派生串行执行，当前规模可控但无批次饥饿/规模实验（E2）。 |
| 安全与隐私 | 9 | 10 | 派生使用持久化 roomId/agentId 外键，任务只通过已注册的 scheduled trigger 进入 QAM-08，prompt 进入受控 AgentTask input；错误消息会写日志但未发现跨房间授权旁路。Scheduler 依赖 Job 已由 QAM-03 授权创建，非本模块重复评价（schema [`ScheduledJob`](../../prisma/schema.prisma#L435-L455)，E2）。 |
| 可测试性与验证可信度 | 8 | 8 | 本轮 18 项 Scheduler Node 测试通过，覆盖改期、clock backward、CAS race、窗口内 run-once 成功/失败、窗口外 run-once 终止与周期 Job 推进；当前快照 4 项真实 PostgreSQL 证据覆盖 fireAt 合成 cron missed-window 终态、旧 timer 隔离、并发单 Task/Event 与 Event 插入失败回滚。最高风险 CAS/原子派生已有风险匹配证据；wall-clock forward、DST、Worker 信号/重启仍缺定向 E3（E3/E2）。 |
| 可维护性、演进与技术债 | 5 | 6 | 主要变化点集中在 `scheduler-tick.ts`，问题修正可局部落点；trigger marker/blocked tools 被 QAM-08 多处直接引用，Worker 三种 lifecycle 共用 stopped 状态，未来修正需保持协议与关闭语义一致（BU-04/BU-07，E2）。 |
| **合计** | **88** | **100** | 算术核对：11+9+7+12+8+13+6+9+8+5 = 88。 |

## Level Gate

| 门禁 | 结果 | 证据与原因 |
| --- | --- | --- |
| 开放 P0 | 通过 | 未发现权限突破、不可恢复数据库损坏、已证明的重复高风险副作用或支持启动路径整体不可用。Job/Task/EventLog 事务回滚有真实 PostgreSQL 证据。 |
| 开放 P1 且涉及权限绕过、不可恢复数据错误、并发重复副作用或支持启动路径失效 | 通过 | 当前无开放 P1；QAM-04-001/002 均已有风险匹配 E3 并标为 resolved。 |
| 最高风险不变量有风险匹配行为验证 | 通过 | 正常时钟、改期/重启用/clock backward 下的时序、并发至多一次、Job/Task/Event 原子派生、run-once missed-window 终态，以及 timer 任务错误收敛/进程 shutdown 预算/重启恢复均有 Node、进程级或真实 PostgreSQL E3。 |
| L4 要求 | 未通过 | 已无开放 P0/P1/P2，但 wall-clock forward 与 DST 仍没有定向 E3，不满足 L4 的「全部风险不变量已有风险匹配验证」。 |
| **最终判定** | **L3** | Score Level=L3；Gate Level=L3；Final Level=min(L3,L3)=L3。 |

## Critical Issues

### P0

当前无开放项。

### P1

当前无开放项。

#### Resolved — QAM-04-001：near-term timer 使用旧 Job 快照并绕过 due 时间复核

- **状态**：`resolved`
- **修正**：`activeJobTimers` 保存 `expectedNextRunAtMs`；重复 tick 发现当前 Job 时间变化时清除旧 timer 并重建，callback 只把匹配期望时间的持久化版本交给共享 claim。`claimAndDispatchScheduledJob()` 同时做 wall-clock due 早期检查与 transaction 内 `enabled=true + nextRunAt equals/lte now + lastRunAt + failCount` CAS（[`scheduler-tick.ts`](../../agent/scheduler-tick.ts#L35)、[`scheduler-tick.ts`](../../agent/scheduler-tick.ts#L217)）。
- **回归证据**：修复前新增的三项 Node 交错回归均失败（1 文件/15 项中 3 failed）：改期、停用后按新时间重启用、clock backward 都在旧时刻创建 1 个 Task；修复后完整 Scheduler Node 测试 16/16，另覆盖改早时重复 tick 主动替换旧 timer。真实 PostgreSQL 3/3 证明旧 timer 不创建 Task/Event、不覆盖新 Job，并发 tick 只创建一个 Task 与 fired Event，Event 故障仍整事务回滚。完整门禁单次退出 0。
- **影响范围**：QAM-04 直接受影响；QAM-03 的 Job authoring/update 是触发条件；QAM-08 仅消费错误时间产生的 AgentTask，不重复登记执行器问题。

#### Resolved — QAM-04-002：run-once Job 错过窗口后仍按下一次 cron 保持启用

- **状态**：`resolved`
- **修正**：共享 claim 事务对所有 `runOnce` Job 写入 `enabled=false`；窗口外 claim 随后返回 skipped，不创建 AgentTask/EventLog，周期 Job 仍保持 enabled 并按 `computeNextRun` 推进。窗口内派生失败会回滚整个事务，因此原有 failCount/retry 语义不变（[`scheduler-tick.ts`](../../agent/scheduler-tick.ts#L94-L124)）。
- **回归证据**：修复前新增的 fake-clock 回归 1/17 失败、真实 PostgreSQL 回归 1/4 失败，二者都观察到下一日 tick 错误返回 `fired: 1`。修复后 Scheduler Node 18/18：窗口外 run-once 禁用且下一 cron 周期无派生，周期 Job 仍推进；PostgreSQL 4/4 使用 `resolveOneShotSchedule()` 生成 fireAt 日 cron，证明窗口外 Job disabled、Task/Event 为零且下一日无副作用（[`scheduler-tick.test.ts`](../../tests/agent/scheduler-tick.test.ts#L188)、[`scheduler-atomic-dispatch.integration.test.ts`](../../tests/integration/scheduler-atomic-dispatch.integration.test.ts#L27)，E3）。
- **影响范围**：QAM-04 的 missed-window/one-shot 状态；QAM-03 负责 fireAt/cron 定义，不重复登记定义入口；QAM-08 不拥有触发政策。

### P2

当前无开放项。

#### Resolved — QAM-04-003：detached timer promise 缺少可等待的 Worker 生命周期所有权

- **状态**：`resolved`
- **问题（原）**：SIGINT/SIGTERM handler 只设置模块级 `stopped=true` 并调用 `clearAllTimers()`。timer callback 一旦开始就以 `void fireJobNow(...)` 脱离 `activeJobTimers`，没有 in-flight 集合或 shutdown promise；`void` 只丢弃返回值、不收敛 rejection。本轮核实该路径比原报告更宽：`fireJobNow()` 顶部的 `prisma.scheduledJob.findUnique()` 同样无保护，因此**任意一次瞬时数据库错误**即可命中，而不只是「claim 失败且失败回写也拒绝」这一条路径。仓库内不存在任何 `process.on("unhandledRejection"/"uncaughtException")` 处理器，按 Node 默认 `--unhandled-rejections=throw` 语义直接终止进程。`schedulerLoop()`/`dispatchLoop()` 在当前操作后无条件 sleep，`main()` 等待两者，最长可等待 dispatch backoff 60 秒；Compose 仅有 `restart: unless-stopped`，未声明 stop grace（默认 10 秒）。
- **修正**：timer callback 创建的任务进入模块持有的 `inFlightTasks` 集合并由统一的最外层 catch 收敛错误、记录可观测日志；任务完成时自行出集合。新增 [`worker-lifecycle.ts`](../../agent/worker-lifecycle.ts#L1) 提供 `createStopController()` 与 `interruptibleSleep()`，后者在停止时清除挂起的定时器，使循环 sleep 可被唤醒（此前已停止的进程仍被 sleep 钉住）。Worker 的 `main()` 在两个 loop 结束后调用 `drainSchedulerTasks(SCHEDULER_DRAIN_TIMEOUT_MS)`，在明确的有界超时内等待已开始的任务，超时则记录仍 in-flight 的数量并继续退出。未引入新的进程托管系统：`clearAllTimers()`、loop 结构与 Compose 拓扑均未改动。
- **回归证据（先红后绿，未放宽断言、未加 skip、未改断言超时）**：
  1. **timer 任务所有权**——把 `trackTimerTask(fireJobNow(...))` 还原为 `void fireJobNow(...)` 后，`npx vitest run tests/agent/scheduler-tick.test.ts` 为 `4 failed | 18 passed (22)`，其中两条失败点正是 `expect(unhandled).toEqual([])`（分别复现「读取 job 失败」与「claim 失败后失败回写再次拒绝」的未处理拒绝），另两条是 drain 观察不到已开始的任务。修复后同文件 22/22。
  2. **进程级 shutdown**——用 `git show HEAD:agent/agent-worker.ts` 还原旧实现后，`tests/agent/worker-shutdown.test.ts` 失败于 `worker 未在 8000ms 内响应 SIGTERM`（退出码 1）；修复后同用例在约 1 秒内以 code 0 退出并输出 `[worker] stopped`。
  3. **重启恢复（语义未变）**——真实 PostgreSQL 新增两条 timer 路径用例（claim 回滚后可被下一次 tick 重新扫描、提交后不重复派生）；两条在旧实现下**同样通过**，属于防回归守卫而非红灯证据，已在模块总览与 feature_list.json 中如实标注。
- **验收结果**：定向 Node 3 文件/27 项、真实 PostgreSQL 6/6、`npm run typecheck` exit 0、`npm run lint` exit 0；`npm run check:full` 单次 exit 0（87 文件/760 项 Vitest、production build、覆盖率 53.48/47.11/58.43/54.16、32 文件/128 项真实 PostgreSQL、44/44 production Playwright）。
- **影响范围**：QAM-04 timer/shutdown；QAM-09 仍负责 Compose stop/restart 拓扑，QAM-08 仍负责 AgentTask lease/recovery，其执行器生命周期未重复归入本问题。关闭本项不改变 QAM-08 的 lease 语义。

## Architecture and Data Flow

```text
ScheduledJob (Prisma: enabled/nextRunAt/lastRunAt/failCount)
  ├─ Worker schedulerLoop (约 5 秒 jitter polling)
  │    └─ due <= now ───────────────────────────────┐
  └─ near-term <= 2 分钟 ──> timer(jobId, expected) ┤
             重复 tick 替换失效 timer；callback 重读版本 │
                                                    └─> 共享 enabled/due/旧字段 CAS
                                                        ├─> 窗口外 runOnce：disabled + skipped，无 Task/Event
                                                        └─> 窗口内：同一事务 AgentTask + fired EventLog

事务失败 ──> Job/Task/EventLog 回滚 ──> 外部 stale-failure CAS 增 failCount/达到 3 次禁用
成功提交 ──> AgentTask pending ──> QAM-08 Worker dispatch/lease/runtime
```

Prisma `ScheduledJob` 是 QAM-03 的定义输入和 QAM-04 的触发期状态事实源；`activeJobTimers` 只缓存 `jobId + expectedNextRunAt`，不替代数据库时间/CAS。due 与近时路径共用 `claimAndDispatchScheduledJob()` 的 wall-clock due、旧版本 CAS、任务派生与 fired EventLog 原子边界；失效 timer 最晚在 callback 重读时丢弃，重复 tick 还能在改早时主动替换。QAM-04 只负责发现、推进和派生；QAM-08 接管提交后的 AgentTask，QAM-03 负责 Job 创建/编辑，QAM-09 负责 Worker/Compose 托管。

## Verified Strengths

- Job claim 使用 `id + enabled + nextRunAt equals/lte now + lastRunAt + failCount` 的条件更新；两个并发 tick 在真实 PostgreSQL 独立事务中只派生一个 Task 和一个 fired Event（[`scheduler-atomic-dispatch.integration.test.ts`](../../tests/integration/scheduler-atomic-dispatch.integration.test.ts#L74)，E3）。
- Job 推进、AgentTask 创建和 `scheduler.job.fired` EventLog 写入位于同一 Prisma transaction；真实 PostgreSQL 触发器故障实验确认 EventLog 插入失败时 Job claim 与 AgentTask 一起回滚（[`scheduler-atomic-dispatch.integration.test.ts`](../../tests/integration/scheduler-atomic-dispatch.integration.test.ts#L160)，E3）。
- 失败路径保留旧 `nextRunAt`，以旧字段 stale CAS 回写 `failCount`，不会覆盖更新后的 Job；连续失败达到 3 次禁用，且对应单元测试通过（[`scheduler-tick.test.ts`](../../tests/agent/scheduler-tick.test.ts#L270)，E3）。
- due 批次按 `nextRunAt` 升序、near-term 只注册窗口内 timer；timer 以期望时间去重/替换并在 callback 重读。fake-clock 回归覆盖改晚、改早、停用后按新时间重启用和 wall-clock backward（[`scheduler-tick.test.ts`](../../tests/agent/scheduler-tick.test.ts#L366)，E3）。
- run-once 在共享 claim 中统一进入禁用终态；fake-clock 与真实 PostgreSQL fireAt 合成 cron 回归共同证明超过一小时的 Job 只 skipped 一次、Task/Event 为零且下一 cron 周期不重放，周期 Job 的推进策略保持不变（[`scheduler-tick.test.ts`](../../tests/agent/scheduler-tick.test.ts#L188)、[`scheduler-atomic-dispatch.integration.test.ts`](../../tests/integration/scheduler-atomic-dispatch.integration.test.ts#L27)，E3）。
- 任务 input 写入 `scheduled.job` trigger、jobId、原始/包裹 prompt，并给 QAM-08 过滤 schedule mutation tools，降低 Agent 自调度循环风险；budget create data 由共享 runtime helper 提供（E2）。
- timer callback 创建的任务不再脱离所有权：`inFlightTasks` 持有并在最外层收敛错误，停止信号可唤醒 loop sleep，shutdown 在 `SCHEDULER_DRAIN_TIMEOUT_MS`（5 秒，明显小于容器默认 10 秒宽限期）内有界排空。进程级用例证明旧实现 8 秒预算内不退出、修复后约 1 秒以 code 0 退出（[`worker-lifecycle.ts`](../../agent/worker-lifecycle.ts#L1)、[`agent-worker.ts`](../../agent/agent-worker.ts#L20-L87)，E3）。
- 重启恢复语义有真实 PostgreSQL 证据：timer 路径的 claim 在 fired Event 插入失败时整事务回滚，Job 保持启用且 `nextRunAt` 未推进，下一次 tick 能重新扫描并只产出 1 个 Task/Event；已提交的 timer 派生不被后续 tick 重复（[`scheduler-atomic-dispatch.integration.test.ts`](../../tests/integration/scheduler-atomic-dispatch.integration.test.ts#L227)，E3）。

## Recommended Improvements

1. 为 wall-clock forward 与 DST 补定向 E3（这是本模块剩余的唯一评分缺口，也是 L4 门禁未通过的直接原因）；两项都属于**验证缺口**而非已知缺陷，不应据推断登记为新问题。
2. 若要把 QAM-04 推向 L4，需要在 QAM-09 的 Compose 拓扑上补 `stop_grace_period` 与滚动重启的实测证据；本轮只保证 Worker 自身在有界预算内退出，未改动 Compose。

以上均为当前调度边界的最小修正，不增加新的调度能力、外部队列或监控平台；QAM-03 的计划定义、QAM-08 的任务执行和 QAM-09 的进程托管只通过直接影响范围关联。

## Sustainable Review Record

### 问题状态

| ID | Priority | 状态 | 首次发现 | 直接责任 | 关联责任 |
| --- | --- | --- | --- | --- | --- |
| QAM-04-001 | P1 | `resolved` | 2026-09-06；2026-09-12 以期望时间 timer、共享 due/CAS 和 Node/PostgreSQL E3 关闭 | QAM-04 Scheduler timer/claim boundary | QAM-03 Job update/cancel；QAM-08 消费错误时间 Task |
| QAM-04-002 | P1 | `resolved` | 2026-09-06；2026-09-12 以统一 run-once 禁用 claim、fake-clock 与 PostgreSQL fireAt E3 关闭 | QAM-04 missed-window policy | QAM-03 fireAt/cron 定义 |
| QAM-04-003 | P2 | `resolved` | 2026-09-06；本轮以 in-flight 任务所有权 + 可唤醒 sleep + 有界 drain，与 Node/进程级/真实 PostgreSQL E3 关闭 | QAM-04 scheduler lifecycle | QAM-09 Worker 托管；QAM-08 Task recovery |

### 复审触发条件

- 修改 `agent/scheduler-tick.ts`、Worker scheduler loop、`ScheduledJob` trigger fields、missed-window/failure policy 或 `clearAllTimers()` 生命周期。
- 修改 QAM-03 ScheduledJob PATCH/Tool update/cancel、fireAt/cron 计算，尤其会改变 `nextRunAt` 的时间或 enabled 语义。
- 修改 QAM-08 scheduled trigger/blocked-tools/budget initialization contract，或 QAM-09 Worker stop/restart/Compose 配置。
- 新增或重跑真实 PostgreSQL 多 Worker CAS、timer 改期/停用、DST/clock jump、长停机 missed-window、SIGTERM in-flight 和重启恢复证据。

### 只追加评分历史

| 日期 | Score | Score Level | Gate | Final | Delta | 变更证据 |
| --- | ---: | --- | --- | --- | --- | --- |
| 2026-09-06 | 75 | L2 | L2 | L2 | `baseline` | 初审；Scheduler 单元测试 1 文件/12 项通过；真实 PostgreSQL 原子派生失败回滚测试 1 文件/1 项通过；改期 timer、run-once missed-window、真实多 Worker、DST/clock、重启与 shutdown 生命周期仍未验证。 |
| 2026-09-12 | 84 | L3 | L2 | L2 | `+9（QAM-04-001 resolved）` | timer registry 携带期望 `nextRunAt`，callback 重读版本，timer/polling 共用 wall-clock due 与旧字段 CAS。修复前 Node 负向对照 3/15 失败，修复后 Scheduler 16/16；真实 PostgreSQL 3/3 覆盖旧 timer 隔离、并发单 Task/Event 和 Event 故障回滚；`check:full` 单次 exit 0：72 文件/470 项 Vitest、production build、覆盖率 48.22/43.18/53.42/49.15、19 文件/59 项 PostgreSQL、29/29 Playwright。QAM-04-002/003 仍开放。 |
| 2026-09-12 | 87 | L3 | L3 | L3 | `+3（QAM-04-002 resolved）` | run-once 在共享 claim 事务中无条件禁用，窗口外仍 skipped 且不创建 Task/Event；周期 Job 推进不变。修复前 Node 1/17 与 PostgreSQL 1/4 均因下一日错误 `fired: 1` 失败；修复后 Scheduler 18/18、PostgreSQL 4/4，`check:full` 单次 exit 0：72 文件/472 项 Vitest、production build、覆盖率 48.27/43.21/53.42/49.15、19 文件/60 项 PostgreSQL、29/29 Playwright。QAM-04-003 仍为开放 P2。 |
| 2026-09-12 | 87 | L3 | L3 | L3 | `0（全模块独立复审）` | 完整重读 Skill/标准/边界与当前工作树；定向 Scheduler Node 18/18、本任务根基线 72/472。重新核对 polling/timer、CAS、run-once/missed-window、失败回写与 Worker lifecycle 后，两项 resolved P1 证据仍有效；QAM-04-003 继续为唯一开放 P2，并明确 wall-clock forward、DST、信号/重启仍无定向 E3，不据无新行为证据制造评分波动。 |
| 2026-09-20 | 88 | L3 | L3 | L3 | `+1（QAM-04-003 resolved）` | timer 回调任务进入 `inFlightTasks` 并由最外层 catch 收敛；新增 `worker-lifecycle.ts`（可等待停止信号 + 可唤醒 sleep）；shutdown 在 5 秒有界超时内排空。核实原报告只列了双重失败一条路径，实际 `fireJobNow()` 首个 `findUnique()` 同样无保护，任意瞬时数据库错误即可终止进程。先红后绿：还原 `void fireJobNow(...)` → Node `4 failed \| 18 passed (22)`（两条失败点为 `expect(unhandled).toEqual([])`）→ 修复后 22/22；还原 HEAD worker → `worker 未在 8000ms 内响应 SIGTERM`（exit 1）→ 修复后约 1 秒 exit 0。真实 PostgreSQL 新增两条 timer 路径恢复用例（回滚后可重扫、提交后不重复），二者在旧实现下同样通过，如实记为防回归守卫而非红灯证据。健壮性 12→13（仍扣 1 分：wall-clock forward/DST 无定向 E3）；`check:full` 单次 exit 0：87 文件/760 项 Vitest、production build、覆盖率 53.48/47.11/58.43/54.16、32 文件/128 项真实 PostgreSQL、44/44 production Playwright。开放问题降为 0；Gate 仍 L3，未达 L4。 |

复审时保留上述问题 ID 和历史行；只在当前代码或风险匹配证据变化时重算受影响维度，并重新核对 100 分合计、Gate 与 Final。问题状态只能使用 `open`、`resolved`、`accepted-risk`、`not-reproduced`。
