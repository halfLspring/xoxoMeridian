# QAM-10 全局 3D Agent 入口与模型资产生命周期工程质量审查

## 元数据

| 项目 | 内容 |
| --- | --- |
| QAM | QAM-10 全局 3D Agent 入口与模型资产生命周期 |
| 快照日期 | 2026-09-13 |
| 审查 Skill | [`xoxo-qam-10-agent-entry-review`](../../.agents/skills/xoxo-qam-10-agent-entry-review/SKILL.md) |
| 标准版本 | [`module-quality-review-standard.md`](./module-quality-review-standard.md) v1.0.0 |
| 范围来源 | [`PROJECT_VIEW.md`](../../PROJECT_VIEW.md#L847-L936) 的 QAM-10、Cross-cutting、共享映射、BU-11～BU-14；[`AGENTS.md`](../../AGENTS.md) |
| 本轮 Delta | `+4`；feat-058 修复 QAM-10-003，只重算数据状态与健壮性两个维度 |
| 范围与工作树 | 只修复 Gate 身份重验和退出通知接缝；既有未提交改动保留。未改 Session 签发、Cookie/认证 API、Chat、GLB/Registry、依赖或部署配置；此前各报告与历史门禁不冒充本轮验证。 |
| 当前基线 | `E2E_APP_MODE=production E2E_SOFTWARE_WEBGL=true NEXT_PUBLIC_AGENT_ENTRY_THEME=default ./scripts/run-node22.sh npm run check:full` 单次 exit 0：77/623 Vitest、生产构建、覆盖率 50.16/44.69/54.71/50.77、27/97 PostgreSQL、39/39 Playwright（含默认入口全部 18 项）。`./scripts/run-node22.sh npm run test:e2e:agent-entry:production:birthday` exit 0、18/18（2.6 分钟）。两主题在反转运行时主题下仍只请求构建主题模型；原始失败与修正见 [任务验收证据](../../feature_list.json)。 |
| 本轮未运行 | 默认开发模式完整 `npm run check:full` 未运行，feat-063 的 Study 全量序列问题保持独立；未运行 `npm run test:compose-smoke`、Docker image build 或 Compose config：未改交付接缝，当前任务由生产浏览器和真实 PostgreSQL 完整门禁验收，QAM-10-005 的镜像证据缺口仍开放。未执行实体移动设备验证。 |
| 历史证据 | feat-040 的 default production 16/16、birthday 全量 26/26 和 Compose image 见 [历史进度](../harness/archive/progress-through-2026-09-12.md#L418-L440)、[完整 feature](../harness/archive/features-001-053.json)。2026-09-12 初审的资产/Node/组件/CSP/Compose config 与 hash 结果保留在评分历史，均仅作为历史 E3。 |

## Overall

| 指标 | 结果 |
| --- | --- |
| Score | **88 / 100** |
| Score Level | **L3** |
| Gate Level | **L2** |
| Final Level | **L2** |
| Trend | `+4` |
| Evidence Confidence | 中高：Gate/退出通知组件、真实 PostgreSQL Session 到期与两主题生产 Chromium 生命周期有本轮 E3；镜像与实体设备仍有明确证据缺口。 |
| 当前开放问题 | 4 项（P2×4；无开放 P0/P1） |

QAM-10-003 已解决：身份结果在离开 Chat、聚焦、重新可见、BFCache 恢复和明确退出时重新核对，退出先卸载，迟到响应不能复活入口。模型缓存保持独立，重新登录后的真实首帧和导航可恢复。两主题生产浏览器补齐本轮 WebGL/CSP/失败生命周期证据，但资产 provenance/Theme 多源、当前镜像集成及实体设备验证仍有开放项，Gate/Final 保持 L2。

## Score Breakdown

| 维度 | Score | Max | Finding / Evidence |
| --- | ---: | ---: | --- |
| 架构与责任边界 | 13 | 14 | Root Layout 装配、路由 Gate、认证显示状态、DOM/Scene 与资产工具分工保持；退出通知只提示失效，身份仍归 QAM-01。[Gate](../../components/agent-entry/AgentEntryGate.tsx#L13-L24)、[通知](../../lib/session-logout.ts#L1-L25)（E2/E3）。Theme/资产跨 runtime/CLI/交付重复仍扣分。 |
| 代码结构与复杂度 | 9 | 10 | Chat 通过卸载认证子组件结束状态生命周期；probe、失效、事件合并与 cleanup 集中在同一个 effect。既有 Scene 复杂度来自 R3F 异步初始化与真实释放需求。[Gate](../../components/agent-entry/AgentEntryGate.tsx#L24-L80)、[Scene](../../components/agent-entry/AgentEntryScene.tsx#L63-L116)（E2/E3）。 |
| 抽象与复用 | 6 | 8 | Registry 和资产解析复用保持；Theme allowlist 在 runtime、CLI、E2E 和 Compose 中仍多源，QAM-10-002 未变。[主题类型](../../components/agent-entry/agent-entry.types.ts#L1-L3)、[E2E 主题](../../tests/e2e/support/app-mode.ts#L1-L18)（E2）。 |
| 数据流与状态一致性 | 11 | 12 | **+2**：身份结果与 GLTF 缓存分离，Chat 返回须新 200，当前 401/403/500/network 隐藏；通知不授权，新 generation 作废旧结果。先 200 后失效、传输忽略 abort 的迟到 200 及恢复均有组件 E3，真实 Session/跨标签浏览器验证一致。[Gate 回归](../../tests/component/agent-entry-gate.test.tsx)、[浏览器](../../tests/e2e/agent-entry-authenticated.spec.ts)。QAM-10-001 的批准 hash 约束仍缺失。 |
| 接口与依赖关系 | 8 | 10 | 同源 no-store status-only probe、onReady/onError、DOM 到 Chat 与构建冻结契约保持；通知仅存随机标识，不传用户或 Session 信息。[通知](../../lib/session-logout.ts)、[MeForm](../../app/me/MeForm.tsx#L78-L103)（E2/E3）。资产与主题跨边界 contract 缺口保持。 |
| 健壮性、并发与生命周期 | 13 | 14 | **+2**：同批 focus/visibility 通知合并，abort+generation 拒绝旧响应；Chat/卸载清理定时器和全部监听，失败可在下一触发点恢复，无轮询。组件验证重复事件、Strict Mode、失效竞态与存储不可用；生产浏览器观察真实旧 context.isContextLost()、Canvas 卸载、重新登录与既有五类故障（E3）。镜像/实体设备边界仍未覆盖。 |
| 性能与资源使用 | 7 | 8 | 真实首帧、静止停止绘制、三次 Chat 往返单 Canvas、匿名/Chat 零 chunk/GLB 及重新登录仅一次模型请求有两主题生产 E3。正式 default/birthday 1,829,016/2,046,212 bytes、94,703/97,721 面、三张 2048 JPEG，通过当前资产检查；实体移动 GPU/内存未知（QAM-10-004）。[模型缓存](../../components/agent-entry/AgentEntryModel.tsx#L8-L15)。 |
| 安全与隐私 | 9 | 10 | Session/API/Chat 授权未变，Gate 不是静态 GLB 授权。初始非 200 不加载，通知只触发服务器重验；两主题生产 CSP/decoder/外联断言通过，JavaScript unsafe-eval 仍禁用。[CSP](../../proxy.ts#L112-L141)、[入口 E2E](../../tests/e2e/agent-entry-authenticated.spec.ts)（E2/E3）。 |
| 可测试性与验证可信度 | 7 | 8 | 旧 Gate 14 failed/10 passed→最终 Gate/DOM 36/36；真实 PostgreSQL 浏览器验证到期、退出/登录、原生焦点和 WebGL 释放。完整 Chromium 在导航后关闭 Playwright 强制聚焦，不用 JS 派发 focus 或 mock Session 替代。当前镜像 hash、实体设备与资产批准 hash 负向回归仍缺（QAM-10-001/004/005）。 |
| 可维护性、演进与技术债 | 5 | 6 | 修复落在 Gate 和轻量退出通知，Scene/Registry/资产流程不变；Theme allowlist 多源和 provenance 未闭合仍让资产变更跨边界同步（QAM-10-001/002）。 |
| **合计** | **88** | **100** | 13+9+6+11+8+13+7+9+7+5 = 88。 |

## Level Gate

| 门禁 | 结果 | 证据与原因 |
| --- | --- | --- |
| 开放 P0 | 通过 | 当前无开放 P0，Gate 显示状态不承担授权。 |
| 开放 P1 且涉及权限、不可恢复数据、重复副作用或启动路径 | 通过 | 当前四项均为 P2，未新增 Session、Chat 或交付行为。 |
| 最高风险不变量有风险匹配行为验证 | 部分通过 | 本轮两主题 production 已覆盖零下载、真实首帧、WebGL/CSP、故障、失效与恢复；当前 image 正式资产/hash 集成仍未执行（QAM-10-005），Gate 继续不高于 L2。 |
| L4 要求 | 未通过 | 当前镜像集成与实体设备边界仍有验证缺口。 |
| **最终判定** | **L2** | Score Level=L3；Gate Level=L2；Final=min(L3,L2)=L2。 |

## Critical Issues

### P0

当前无开放项。

### P1

当前无开放项。

### P2

#### QAM-10-001：正式资产门禁不强制已批准 selection/recipe hash

- **状态**：`open`
- **问题**：`check` action 只对固定正式路径执行 `inspectAsset()` 和 `assertAssetPromotable()`，不读取 `selection.json`、`optimization-recipes.json` 或 candidate report；只有 `promote` 当次校验候选路径/hash。Compose image 检查也只断言两条路径和 8 MiB 字节预算（[`agent-entry-assets.ts`](../../scripts/agent-entry-assets.ts#L25-L33)、[`agent-entry-assets.ts`](../../scripts/agent-entry-assets.ts#L43-L66)、[`compose-deployment-smoke.ts`](../../scripts/compose-deployment-smoke.ts#L433-L472)，E2）。2026-09-12 初审 `sha256sum` 与 checker 证明当前两份正式资产实际匹配记录并合格（E3），所以这是预防控制缺口，不是当前资产漂移。
- **质量影响**：合法、预算内但未经用户选择的 GLB 被手工替换后仍可通过 `check:quick` 和现有 image smoke；运行视觉、selection、recipe 与交付镜像会分成多个事实，审查者无法从绿色门禁证明“交付的正是已批准产物”。
- **最小修正**：让 `check` 对每个主题同时验证 source hash、selection candidate/hash、recipe report/hash、candidate report/hash 与正式 GLB hash 的精确一致性，并让 image smoke 比较同一批准 hash；保留现有预算、validator 和人工选型流程，不增加远程签名或新资产平台。
- **验收证据**：在隔离临时目录放入另一份结构/预算均合格但 hash 不同的 GLB，断言资产 gate 因 selection/recipe 不一致失败；恢复批准资产后两个主题通过。真实 Web image 中计算两份 GLB SHA-256，必须等于同一机器 contract。
- **影响范围**：QAM-10 资产 provenance/正式文件；关联 QAM-09 build/image 接缝（BU-12），不重复登记 QAM-09 总体镜像责任。

#### QAM-10-002：合法 Theme 集合跨 runtime、资产与验证脚本重复

- **状态**：`open`
- **问题**：runtime `agentEntryThemes`、asset `assetThemes`、E2E `E2EAgentEntryTheme`/parser、Compose config 循环和两个 production package scripts 分别硬编码 `default`/`birthday-2026`（[`agent-entry.types.ts`](../../components/agent-entry/agent-entry.types.ts#L1-L3)、[`agent-entry-assets.ts`](../../scripts/lib/agent-entry-assets.ts#L11-L15)、[`app-mode.ts`](../../tests/e2e/support/app-mode.ts#L1-L18)、[`compose-deployment-smoke.ts`](../../scripts/compose-deployment-smoke.ts#L750-L760)、[`package.json`](../../package.json#L36-L39)，E2）。Registry 的 `satisfies Record<AgentEntryTheme,...>` 只能约束 runtime 自己，不能阻止其他集合漂移。
- **质量影响**：新增或移除一个构建主题必须跨多个不相干文件同步；漏改一处可能使主题可构建却未受资产 gate/production E2E 覆盖，或有正式资产但 resolver 静默回退 default，局部主题改动扩大为交付回归。
- **最小修正**：把无副作用的 Theme ID 列表提为 runtime/asset/E2E/config checker 可共同读取的单一 contract，或至少增加一个 gate 精确比较 Registry key、asset theme、selection/recipe/formal directories 与 production matrix；Registry 继续只承载主题差异，不引入运行时主题切换。
- **验收证据**：在测试 fixture 中只向任一集合增加/删除主题时 gate 必须失败，并指出缺失边界；所有集合完全相等时，resolver fallback、两个正式资产和每主题 production command 仍通过。
- **影响范围**：QAM-10 Registry/resolver/asset/test contract；关联 QAM-09 build arg 与 production matrix（BU-12）。

#### QAM-10-004：实体移动 GPU、系统软键盘和非零 safe-area 尚无验证

- **状态**：`open`
- **问题**：CSS 使用 `env(safe-area-inset-right/bottom)`，E2E 使用 320/390/844 等软件 Chromium viewport、touch flag、缩短 viewport 和 SwiftShader；feat-040 记录明确说明没有实体手机性能、系统软键盘或非零 safe-area 实测（[`agent-entry.module.css`](../../components/agent-entry/agent-entry.module.css#L1-L45)、[`agent-entry-authenticated.spec.ts`](../../tests/e2e/agent-entry-authenticated.spec.ts#L160-L231)、[`agent-entry-review/README.md`](../spec/agent-entry-review/README.md#L28-L30)，E2 + 历史软件浏览器 E3）。
- **质量影响**：当前可证明 DOM 可达和模拟视口不越界，但不能确认真实 iOS/Android WebGL 驱动的首帧/内存、系统键盘改变 visual viewport 时的遮挡，或刘海/底部手势区域的非零 inset；把现有证据扩写为实体设备验收会掩盖发布风险。
- **最小修正**：不改入口功能；选择实际支持的至少一台 iOS Safari 与一台 Android Chrome，复用两个正式主题，记录匿名/Chat 零下载、登录首帧、触摸导航、输入法展开、旋转、非零 safe-area、context loss/返回及内存/崩溃观测。若产品明确不承诺这些设备，则将其写为 accepted-risk 而非伪装成已验证。
- **验收证据**：保留设备/OS/浏览器/GPU、主题、网络与视口条件，以及首帧、遮挡、触摸、旋转、键盘和多次往返的可观察结果；软件 Chromium 继续只作为自动功能回归。
- **影响范围**：QAM-10 性能、overlay 与 accessibility；宿主 QAM 只关联其关键表单旅程（BU-14）。

#### QAM-10-005：当前快照仍缺镜像资产/hash 集成 E3

- **状态**：`open`（生产浏览器部分已补齐）
- **问题与历史**：2026-09-12 初审同时缺两主题 production WebGL/CSP 和当前 image E3。本轮 feat-058 已执行两个构建主题的完整入口 specs，含首帧、零下载、五类故障、CSP、缓存、跨标签退出/重登和真实 Session 到期；没有改交付配置，未运行 Docker build/Compose smoke，镜像内正式 GLB/hash 的当前证据仍缺。[生产 specs](../../tests/e2e/agent-entry-authenticated.spec.ts)、[image 检查](../../scripts/compose-deployment-smoke.ts#L433-L472)（浏览器 E3、image E2/历史 E3）。
- **质量影响**：当前浏览器验证不能证明镜像含有相同批准资产，历史 Compose 通过也不证明当前 image 内容；因此保留问题和 Gate 限制。
- **最小修正**：在独立交付复核中构建 Web image，核对两份正式 GLB 的路径/批准 hash，确认不含 source/candidate；复用已有 production 入口矩阵，不改入口功能。
- **验收证据**：真实 image 内只有两个批准 hash 的 GLB 且不含 source/candidate，两主题 production decoder、CSP、生命周期和构建冻结继续通过；SwiftShader 不冒充实体 GPU。
- **影响范围**：QAM-10 production/runtime 验证；关联 QAM-09 image/build（BU-12/13）。

### 已解决问题

#### QAM-10-003：认证成功结果在 Root Layout 生命周期内不会重新验证

- **状态**：`resolved`（feat-058，2026-09-13）
- **原机制与影响**：旧 Gate 在 authenticated=true 后提前返回，Root Layout 长驻使 Chat 往返仍复用旧身份；Session 失效后入口持续显示并占用 WebGL。旧回归 14 failed/10 passed，直接失败包括从 Chat 返回挂载旧入口、聚焦/可见/退出后未重验；服务端授权始终存在，不属于权限绕过。
- **最小修正**：[Gate](../../components/agent-entry/AgentEntryGate.tsx) 以路由卸载独立认证显示状态；非 Chat 初始、focus/visibility、BFCache 恢复和 [logout 通知](../../lib/session-logout.ts)重验。通知由 [成功退出](../../app/me/MeForm.tsx#L78-L103)发出，同标签 Event、跨标签 storage 只传随机标识。logout 先隐藏；100ms 合并同批事件，abort+generation 保证仅最新响应生效；401/403/其他失败均卸载，后续 200 恢复；无周期轮询。
- **验收证据**：[Gate/DOM 组件](../../tests/component/agent-entry-gate.test.tsx) 36/36（其中 Gate 26 项），覆盖迟到响应、重复事件、Strict Mode、网络/500、存储不可用及 cleanup；[生产浏览器](../../tests/e2e/agent-entry-authenticated.spec.ts)在真实 API/PostgreSQL 下操作另一标签的退出/登录，并推进 Session.expiresAt，观察 /api/auth/me 401、原页面 Canvas 消失、旧 WebGL context 真正失效、真实焦点切换后恢复 ready/键盘进入 Chat，原页面只下载一次模型。详细门禁与调试原始失败见 [任务验收证据](../../feature_list.json)。

**开发浏览器调试与终态**：命令为 `E2E_SOFTWARE_WEBGL=true ./scripts/run-node22.sh npm run test:e2e -- tests/e2e/agent-entry-authenticated.spec.ts --grep '跨标签退出|真实 Session 到期'`。第 1 轮 exit 1、1 passed/2 failed，旧 WebGL 句柄报告 `Execution context was destroyed`，到期项 30000ms 超时，finally 的 POST 又报 Test ended；第 2 轮 exit 1、未执行用例，`Cannot use({ channel }) in a describe group`，将 worker 级 channel 放到文件顶层；第 3 轮 exit 1、1 passed/2 failed，两次 hasFocus 预期 false 实际 true；第 4 轮 exit 1、2 passed/1 failed，到期项通过，跨标签旧句柄仍因文档导航失效；第 5 轮 exit 1、2 passed/1 failed，先装配退出页再持有 About 场景后旧 WebGL 释放通过，后续登录按钮全局查询命中两个元素，改为 form 内查询。第 6 轮 exit 1、2 passed/1 failed，登录页停留且显示 Invalid request；以密码显隐的真实交互证明表单已可用，再验证实际登录载荷与 200。第 7 轮 exit 1、2 passed/1 failed，重登恢复、单次模型下载均通过，但 Chat 冷导航 5000ms 时仍在 /chat；改为等待真实目标房间 HTTP 响应再验证 URL/发送按钮。第 8 轮 exit 0、3/3（1.4 分钟，含 setup）：跨标签退出/重登/缓存/导航 52.5 秒，到期聚焦 10.1 秒。原页面仅一次 GLB 下载、旧 context 真正释放、真实焦点 false→true 与 401/200 均通过。

独立 Node/Chromium 对照确认 headless shell 不发原生 focus，完整 Chromium 在导航完成后取消 Playwright 的 Emulation.setFocusEmulationEnabled 覆盖，窗口切换得到可信 blur/focus，hasFocus=false→true；测试用此原生行为验证，而非 JavaScript 派发事件。开发路由预热与先装配退出页是文档/句柄生命周期的测试准备，生产矩阵没有开发预热。实体设备、BFCache 原生恢复和非零 safe-area 未作为浏览器结论；BFCache pageshow 分支仅有组件事件 E3。

- **保留边界**：GLTF 缓存、Scene、Session 签发/认证协议和运行时主题机制未改；浏览器为软件 Chromium，非实体移动设备验收。退出通知存储不可用时，其他标签在下一次聚焦/重新可见时重验。
- **影响范围**：QAM-10 Gate/client lifecycle；关联 QAM-01 HTTP/退出通知接缝（BU-11），不重复评价认证实现。

## Architecture and Data Flow

```text
Root Layout（Server Component）
  └─ resolveAgentEntryTheme() [server-only，build-time env]
       └─ Registry[Theme]（可序列化 config）
            └─ AgentEntryGate（client）
                 ├─ /chat* → 不探测、不挂载 dynamic Entry
                 ├─ 非 Chat 独立认证状态 → GET /api/auth/me
                 │    ├─ 非 200 / network error → 静默隐藏
                 │    └─ 200 → dynamic import AgentEntry
                 ├─ 返回 Chat 外 / 可见 / focus / BFCache 恢复 → 重验
                 ├─ 同标签事件 / 跨标签 storage 退出通知 → 先卸载再重验
                 └─ generation + AbortController + 100ms 事件合并 → 只接受最新结果，无轮询

AgentEntry
  ├─ DOM button（首帧前 hidden/disabled/tabIndex=-1）
  ├─ Suspense + DOM ErrorBoundary → useGLTF(model) shared cache
  │    └─ clone Object3D → 原生 canvas + R3F createRoot
  │         ├─ WebGLRenderer(low-power, DPR 1..1.5, demand)
  │         ├─ PMREM/RoomEnvironment + ResizeObserver/contextlost
  │         ├─ gl.render 成功后 queueMicrotask(onReady(model))
  │         └─ unmount → observer/listener/root/renderer/PMREM/canvas cleanup
  ├─ ready → accessible button/tooltip/clearance → router.push('/chat')
  └─ chunk/GLB/WebGL/render failure → 入口隐藏，宿主继续可操作

source.glb（固定 hash）
  └─ candidates: weld → simplify → resize → tangents → meshopt
       └─ candidate report（validator/decoded triangle/texture/budget/hash）
            └─ user selection（exact candidate + hash）
                 └─ promote → public/.../scene.glb + optimization recipe
                      ├─ check:quick：当前验证结构/预算，尚未强制批准 hash
                      └─ Docker Web image：历史 smoke 验证仅含两份正式 GLB
```

身份事实与 Session/Cookie 由 QAM-01 提供；QAM-10 的 `authenticated` 只是显示状态，静态 GLB URL 也不是资源授权边界。`/chat` 解析和聊天能力属于 QAM-02。Next/Docker/Compose 的总体构建与运行责任属于 QAM-09；QAM-10 只拥有合法主题、Registry、selection/recipe/hash、正式 GLB 和入口专属 production 证据。CSP 文件虽为 Cross-cutting，`wasm-unsafe-eval`/`blob:` 对 Meshopt/内嵌纹理的必要性及无外联证据归 QAM-10；全站策略最小化不在本报告重复计分。

## Verified Strengths

- 路由显示、身份结果、构建主题和模型缓存各自有清晰生命周期。Chat 冷启动与匿名页面不请求入口代码或 GLB；合法 Session 的 Chat 往返及重新登录复用模型缓存（当前两主题生产 E3）。
- 入口在真实 gl.render 后才变为 ready，DOM button 保留键盘/触摸、tooltip、reduced-motion 和导航锁；五种故障隐藏入口且宿主继续可操作。静止不持续绘制，旧 context 释放与 Canvas 数量有浏览器 E3；不把 DOM/jsdom 当作 GPU 证据。
- 当前正式资产检查实际解码并校验两个模型，validator 0 error/0 warning、预算合格；source、selection、recipe 和候选指标完整保留。初审四份 source/formal hash 核对及 feat-040 两轮可重复生成仍是历史 E3，当前没有改资产或扩大该证据。
- 两主题 production 启动器将运行时主题反转，浏览器仍只下载构建选定 GLB；无外部 decoder/HDR 或 CSP violation（当前 E3）。Compose config/image 仅保留初审/feat-040 历史证据，不当作本轮已执行。

## Recommended Improvements

1. **QAM-10-001**：闭合正式 GLB、selection、recipe、candidate report 与 image hash；保持模型、预算和人工选择。
2. **QAM-10-002**：统一 Theme ID 或以精确集合门禁约束 runtime/asset/production matrix，保持构建主题模式。
3. **QAM-10-005**：补真实 image 资产/hash 集成，复用本轮两主题 production 生命周期回归。
4. **QAM-10-004**：以目标实体 iOS/Android 补 GPU、键盘、旋转和非零 safe-area 观察；仍未获得产品接受该风险的明确约定。

## Sustainable Review Record

### 当前开放问题

| ID | Priority | 状态 | 首次发现 / 当前证据 | 直接责任 | 关联责任 |
| --- | --- | --- | --- | --- | --- |
| QAM-10-001 | P2 | `open` | 2026-09-12；checker 不强制批准 hash，当前预算通过但不能替代该约束 | QAM-10 asset provenance | QAM-09 image（BU-12） |
| QAM-10-002 | P2 | `open` | 2026-09-12；Theme allowlist 多源（E2） | QAM-10 theme contract | QAM-09 build matrix（BU-12） |
| QAM-10-004 | P2 | `open` | 2026-09-12；实体设备未验证，当前软件浏览器 E3 仍不替代它 | QAM-10 performance/overlay | 宿主表单（BU-14） |
| QAM-10-005 | P2 | `open` | 2026-09-12；本轮补齐两主题 production E3，仍缺当前 image/hash E3 | QAM-10 production verification | QAM-09 image/CSP（BU-12/13） |

### 已解决记录

| ID | 状态 | 首次发现 | 解决日期 | 证据 |
| --- | --- | --- | --- | --- |
| QAM-10-003 | `resolved` | 2026-09-12 | 2026-09-13 | feat-058；原实现负向组件对照、事件/竞态回归、真实 Session/原生聚焦/跨标签退出重登与两主题 production WebGL 释放、缓存和导航 |

### 关联但不重复登记的问题

- QAM-01 拥有 Session/Cookie 与 `/api/auth/me` 正确性；QAM-10-003 只登记成功状态缓存后的显示/资源生命周期，不把入口可见性写成授权缺陷。
- QAM-02 拥有 `/chat` 默认房间解析、Room/Message/SSE 与 Chat UI；QAM-10 只验证 DOM navigation 发起和 Chat 路由排除，不评价目标页业务。
- QAM-09 拥有 Docker build arg 传播、Web image 与 Compose 拓扑；QAM-10-001/002/005 只登记主题/正式资产领域 contract 和入口专属验证，image 总体问题通过 BU-12 关联。
- 全站 CSP 最小化属于 Cross-cutting；本报告只评价 Meshopt/blob 权限必要性、production decoder 可运行与不发生外联，不因单一 `proxy.ts` 重复建立跨模块缺陷。

### 复审触发条件

- 修改 `AgentEntryGate` 的路由/认证探测、缓存、AbortController/generation，或 QAM-01 的 `/api/auth/me`/logout contract。
- 修改 Registry/resolver、Theme ID、`NEXT_PUBLIC_AGENT_ENTRY_THEME`、Next/Docker/Compose build 传播，或新增/删除正式主题。
- 修改 `AgentEntry`/Scene/Model、Three/R3F/Drei/Meshopt 版本、首帧 ready、frame loop、DPR、clone/cache、renderer/PMREM/observer/listener/context cleanup 或故障边界。
- 修改 source/formal GLB、selection、optimization recipes、candidate reports、预算、validator/extension policy、candidate/promote/check 或 `.dockerignore`/image asset assertions。
- 修改入口 fixed overlay、z-index、clearance、safe-area、tooltip、keyboard/touch/focus/reduced-motion，或宿主关键表单/Modal 布局。
- 修复或重新验证 QAM-10-001～005；尤其在评分上调前重跑当前快照两主题 production browser，并区分软件 Chromium与实体设备证据。

### 只追加评分历史

| 日期 | Score | Score Level | Gate | Final | Delta | 变更证据 |
| --- | ---: | --- | --- | --- | --- | --- |
| 2026-09-12 | 84 | L3 | L2 | L2 | `baseline` | QAM-10 初审；本轮正式资产 checker、Node 31/31、组件 20/20、CSP 6/6、缺省/default/birthday Compose config 与四份文件 hash 核对通过。feat-040 两主题 production/Compose image 和 feat-046 总体 `check:full` 仅作为历史 E3；本轮未运行 production browser/Compose。开放 QAM-10-001～005，最高风险 WebGL/CSP/image 无当前 E3，故 Gate/Final=L2。 |
| 2026-09-13 | 88 | L3 | L2 | L2 | `+4` | feat-058 关闭 QAM-10-003：身份/模型缓存分离、路由卸载、focus/visibility/BFCache/退出重验、事件合并和迟到响应保护。旧 Gate 14 failed/10 passed→Gate/DOM 36/36，开发定向最终3/3；默认生产完整门禁77/623、构建/覆盖率、27/97 PostgreSQL、39/39 Playwright，生日production18/18。跨标签退出/重登/真实焦点/旧context释放及模型单次请求均有当前E3；QAM-10-005浏览器部分补齐，image与实体设备缺口仍开放，Gate/Final保持L2。 |

复审时保留上述问题 ID 和历史行；只在代码、资产或风险匹配证据变化时重算受影响维度，并重新核对 100 分合计、Gate 与 Final。问题状态只能使用 `open`、`resolved`、`accepted-risk`、`not-reproduced`。
