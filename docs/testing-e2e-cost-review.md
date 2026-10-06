# 生产 E2E 耗时基线与逐项审查（feat-112）

2026-10-05：**最终581份输入、133项用例的三份完整有效样本已采齐，均133/133、0 skip/retry。** 命令耗时分别为 751.273 / 742.022 / 772.620 秒，中位数 **751.273 秒**；全量软审查阈值 **901.528 秒**。这只是本环境的初始中位数与范围，不证明长期零偶发失败，也不与旧版本混算提速。

唯一推荐下一步：**feat-122「空间作品截图等待成本的定向诊断」**，已独立登记为not-started。本轮只采样、审查和登记，未修改应用、测试断言、fixture、依赖或默认配置；保留全部浏览器保护。feat-112已完成本项验收；状态与脱敏数据见根账本和[采样JSON](plan/evidence/feat-112/e2e-cost-baseline.json)。

## 固定条件与测量边界

输入逐字节匹配[feat-118最终输入](plan/evidence/feat-118/source-inputs.json)：581份源码/配置/资源，清单摘要 `fd59b5c0a26c81654a63520779008686103c0fa39c49d70a5f779f9ab8db85e3`；含用户既有未提交内容。133项project/文件/完整参数化标题逐项一致，11个测试文件，1 setup / 8 public / 124 authenticated。每轮前恢复原next-env并清除副本.next、test-results和独占Playwright transform缓存；仅副本的Next生成next-env路径发生变化，工作区输入保持。

独立/var/tmp源码与node_modules，锁定npm ci exit0（1016包/18秒），安装在轮外；不复制真实.env。Node22.23.2/npm10.9.8/Next16.3.8/Playwright1.62.1；实际headless shell及原生焦点用例完整Chromium均151.0.7922.34，每轮新PG16.15。Linux x64/WSL2、i9-13900HX、32可用CPU、8161816576字节内存；Next实际3构建worker，浏览器1 worker、fullyParallel=false。宿主其他负载未控制，观察器开销纳入本组；只读汇总可能与下一轮准备重叠，开销未独立量化，不能依据小幅差值或与历史组直接比较提速。

LANG=en_US.UTF-8、TZ=UTC、CIRCLE_NODE_TOTAL=4、production、软件WebGL、CI unset，CLI --retries=0；默认CI retry2/本地0不改。每轮app-info实测default构建/birthday-2026运行；保留逐用例locale/timezone/reducedMotion与完整Chromium覆盖。邮件/天气mock，LLM决策受控，真实Runtime子进程仍执行；不代表真实供应商或Docker Worker验证。

每轮独立PG、上传目录，顺序执行；旧112的五份完整尝试（含失败）与定向保留在历史组；118门禁单独保留在118证据中，全部排除本组。JSON schema5的currentSampling只包含本组；historicalSampling及previousSamplingGroups保留旧对象原值，下文保留全部旧报告。

## 原命令与阶段

每轮替换XX及输出名，命令完整值和可重建观察器/驱动在JSON：

```bash
env -u CI -u VITEST_MAX_WORKERS -u PLAYWRIGHT_BASE_URL -u E2E_DATABASE_URL \
  -u E2E_EXTERNAL_ISOLATED -u E2E_DEV_ORIGINS -u NODE_OPTIONS -u NODE_ENV \
  LANG=en_US.UTF-8 TZ=UTC CIRCLE_NODE_TOTAL=4 \
  E2E_APP_MODE=production E2E_SOFTWARE_WEBGL=true NEXT_PUBLIC_AGENT_ENTRY_THEME=default \
  PWTEST_CACHE_DIR=<sampler>/pw-cache \
  PLAYWRIGHT_JSON_OUTPUT_NAME=<sampler>/post118-full-XX-report.json \
  PLAYWRIGHT_HTML_OUTPUT_DIR=<sampler>/post118-full-XX-html PLAYWRIGHT_HTML_OPEN=never \
  E2E_COST_EVENTS=<sampler>/post118-full-XX-events.jsonl \
  npm_config_script_shell=<sampler>/script-shell.py \
  ./scripts/run-node22.sh npx --no-install playwright test --retries=0 \
  --reporter=list,json,html,<sampler>/observer.ts
```

| 指标（秒） | 第1轮 | 第2轮 | 第3轮 |
| --- | ---: | ---: | ---: |
| CLI单调总耗时 | 751.273 | 742.022 | 772.620 |
| runner报告 | 750.390 | 740.970 | 771.580 |
| PG/迁移/seed等构建前准备 | 9.808 | 9.573 | 8.863 |
| 生产构建 | 48.900 | 47.348 | 48.691 |
| 服务就绪与收集 | 1.287 | 2.565 | 1.328 |
| setup调度 | 0.286 | 0.300 | 0.290 |
| setup观察窗口 | 0.262 | 0.243 | 0.260 |
| 业务调度 | 0.289 | 0.283 | 0.299 |
| 全部业务窗口 | 689.627 | 680.798 | 712.144 |
| 报告与服务/PG清理 | 0.815 | 0.913 | 0.745 |
| setup runner单项 | 0.239 | 0.222 | 0.238 |
| 业务runner单项之和 | 686.824 | 676.389 | 707.295 |
| CLI后异步资源确认上界 | 10.650 | 10.697 | 10.674 |

八个连续阶段相加等于CLI总耗时；setup runner值与业务单项之和另列，不叠加到窗口中。CLI从Popen前至wait捕获退出，包含PG准备、独立构建及服务/PG清理；Ryuk异步自退出的资源确认另列，不计入CLI预算。确认值含1秒轮询和末端摘要提取开销，不是精确的Ryuk执行时间。

每秒资源观察的最小MemAvailable分别为 3321491456, 3361939456, 3341672448 字节；最大进程树RSS分别为 2895790080, 2830970880, 2830233600 字节。RSS不含容器PG或宿主其他服务，离散采样不是精确峰值；不据此归因快慢。

UTC经过时间与单调时间差分别为 12.307 / 165.836 / -0.056 秒；时钟跳变位置在JSON。单项runner与步骤观察使用单调时间，跨跳变的wall步骤不用于成本判断；步骤事件有投递/I/O误差，嵌套窗口不能相加冒充单项总耗时。

首轮采样器最初把observer标题路径中的文件层级与118摘要直接比较，判定集合不同并停止自动后续。规范化仅去掉与文件basename严格相等的首项，133项完整describe/参数化标题逐项相同；首轮runner exit0、133/133及计时原值不变，因此收为有效样本。随后只执行第2/3轮，未重跑首轮或增加retry；原判定及纠正证据保留。

## 排名与软预算

全量B为三份CLI中位数751.273秒，B+max(20%×B,60秒)=901.528秒；每项B为三轮runner单项中位数，阈值B+max(20%×B,2秒)。全部133项的三份值、范围和预算在JSON。setup单列，业务按中位数降序；第10名11.942秒，无并列，纳入10项。第11名390px用例11.934秒，仅差8毫秒；这不是长期稳定名次。下表占比分母为132项业务中位数之和679.179秒，前列合计27.80%，不是CLI占比。

| 排名 | project / 文件:行 / 完整标题 | 三轮秒 | 中位数秒（范围） | 业务占比 | 单项软阈值秒 | 判断 |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| 1 | authenticated / [tests/e2e/agent-entry-authenticated.spec.ts](../tests/e2e/agent-entry-authenticated.spec.ts#L204)<br>默认模型长时间静止后点击仍有可见位移，autofocus 后完成回位并停止绘制 | 36.394 / 36.057 / 36.146 | 36.146（36.057–36.394） | 5.322% | 43.375 | 保留 |
| 2 | authenticated / [tests/e2e/authenticated.spec.ts](../tests/e2e/authenticated.spec.ts#L1674)<br>慢查询跨多个轮询周期时聊天快照保持串行，消息和 Agent 状态在重连后稳定 | 21.255 / 21.332 / 21.114 | 21.255（21.114–21.332） | 3.130% | 25.506 | 保留 |
| 3 | authenticated / [tests/e2e/blog-drafts.spec.ts](../tests/e2e/blog-drafts.spec.ts#L657)<br>草稿各尺寸只有一层蒙版，精简工具栏贴底且已移除辅助入口 | 20.998 / 19.468 / 20.839 | 20.839（19.468–20.998） | 3.068% | 25.007 | 优化准备/等待（先定向诊断，全部保护保留） |
| 4 | authenticated / [tests/e2e/blog-drafts.spec.ts](../tests/e2e/blog-drafts.spec.ts#L847)<br>草稿自动保存、恢复、私密字节与整组发布协作 | 21.020 / 18.980 / 20.376 | 20.376（18.980–21.020） | 3.000% | 24.451 | 优化准备/等待（先定向诊断，全部保护保留） |
| 5 | authenticated / [tests/e2e/agent-entry-authenticated.spec.ts](../tests/e2e/agent-entry-authenticated.spec.ts#L828)<br>两位用户的私聊持久隔离，关闭后任务完成、重新打开回复，审批后继续且 Chat 保持共享 | 19.594 / 19.373 / 19.795 | 19.594（19.373–19.795） | 2.885% | 23.513 | 保留 |
| 6 | authenticated / [tests/e2e/authenticated.spec.ts](../tests/e2e/authenticated.spec.ts#L471)<br>rotates a Home photo smoothly with a handle, keyboard and touch, and persists the final angle | 16.653 / 16.346 / 20.450 | 16.653（16.346–20.450） | 2.452% | 19.984 | 保留 |
| 7 | authenticated / [tests/e2e/agent-entry-authenticated.spec.ts](../tests/e2e/agent-entry-authenticated.spec.ts#L403)<br>拖拽超过阈值才移动，真实模型反馈原地回稳且刷新和 Chat 回返记住放置点 | 16.598 / 15.279 / 15.857 | 15.857（15.279–16.598） | 2.335% | 19.028 | 保留 |
| 8 | authenticated / [tests/e2e/blog-user-boundary.spec.ts](../tests/e2e/blog-user-boundary.spec.ts#L145)<br>不向编辑器传用户对象时，普通博文新建、取消、修改、删除及非作者保护仍成立 | 13.093 / 13.150 / 13.181 | 13.150（13.093–13.181） | 1.936% | 15.780 | 保留 |
| 9 | authenticated / [tests/e2e/agent-entry-authenticated.spec.ts](../tests/e2e/agent-entry-authenticated.spec.ts#L695)<br>入口身份生命周期 › 跨标签退出卸载公开页入口与 WebGL，重新登录并聚焦后复用模型恢复私聊 | 12.755 / 12.983 / 13.291 | 12.983（12.755–13.291） | 1.912% | 15.580 | 保留 |
| 10 | authenticated / [tests/e2e/agent-entry-authenticated.spec.ts](../tests/e2e/agent-entry-authenticated.spec.ts#L604)<br>320px 页面表单、Study 与 Post 控件可操作 | 11.942 / 12.010 / 11.860 | 11.942（11.860–12.010） | 1.758% | 14.330 | 保留 |

预算仅触发人工审查，不新增计时失败门禁；不调整超时/重试/并发，不降低覆盖率或用skip凑样本。

## 校准样本中的超软预算复核

9项用例有一轮超过新软阈值，全部仍通过。它们触发人工审查，不是计时失败；不修改公式以覆盖最大值，以下步骤窗口也不当作内部根因。

| project / 文件:行 / 完整标题 | 三轮秒 | 软阈值秒 | 可观察成本与判断 |
| --- | ---: | ---: | --- |
| authenticated / [tests/e2e/authenticated.spec.ts](../tests/e2e/authenticated.spec.ts#L1470)<br>Focus 用例失败后清理运行状态，下一次使用从 idle 开始 | 8.705 / 6.521 / 6.494 | 8.521 | 第1轮事件等待3.581秒与点击3.556秒重叠，保护失败后的Focus真实清理/重用；没有内部成本因果分解，保留，不缩减清理或制造整改。 |
| authenticated / [tests/e2e/authenticated.spec.ts](../tests/e2e/authenticated.spec.ts#L471)<br>rotates a Home photo smoothly with a handle, keyboard and touch, and persists the final angle | 16.653 / 16.346 / 20.450 | 19.984 | 第3轮真实旋转轮询3.422秒、hover2.785秒、截图合计4.062秒；连续手势/取消/PG持久化仍需浏览器。第6名已逐项审查，缺少可安全减量证明，保留。 |
| authenticated / [tests/e2e/blog-drafts.spec.ts](../tests/e2e/blog-drafts.spec.ts#L554)<br>My Draft 保留未保存修改的离开守卫，确认保存后再打开列表 | 3.908 / 1.265 / 1.557 | 3.557 | 第1轮Wait for event窗口2.714秒；未保存离开守卫及确认保存是有效风险，窗口尚未细分，保留。 |
| authenticated / [tests/e2e/blog-drafts.spec.ts](../tests/e2e/blog-drafts.spec.ts#L523)<br>My Draft 首次点击可靠打开，关闭后可再次选择并转到右键新建 | 1.219 / 3.360 / 1.160 | 3.219 | 第2轮After Hooks1.590秒含Context关闭1.583秒；完整资源回收成功，没有原116的关闭超时或可避免等待证据，保留。 |
| authenticated / [tests/e2e/blog-drafts.spec.ts](../tests/e2e/blog-drafts.spec.ts#L593)<br>draft 深链首次加载进入编辑器，退出后不会重新打开 | 1.408 / 3.468 / 1.368 | 3.408 | 第2轮Reload窗口2.251秒；深链首次加载/退出后不重开仍需真实导航，缺少迁移/删除或优化因果证据，保留。 |
| authenticated / [tests/e2e/blog-drafts.spec.ts](../tests/e2e/blog-drafts.spec.ts#L131)<br>作品发布时间仅在框外悬停查看，无时钟按钮，两态均不改变占位 | 5.025 / 4.617 / 22.955 | 7.025 | 第3轮两张Screenshot合计17.099秒；前两轮该用例4.6至5秒。只能定位到截图调用窗口，连同两项前10截图候选登记122逐入口诊断；保留框外hover、两态几何、日期与零写入。 |
| authenticated / [tests/e2e/blog-drafts.spec.ts](../tests/e2e/blog-drafts.spec.ts#L1498)<br>最大窗口的边框手柄不能越界，裁切外的图片数据仍保留 | 6.589 / 4.157 / 4.170 | 6.170 | 第1轮After Hooks2.002秒含Context关闭1.995秒；保留边框越界/裁切数据保护与完整清理，未证实可避免成本，不另建任务。 |
| authenticated / [tests/e2e/blog-presentation.spec.ts](../tests/e2e/blog-presentation.spec.ts#L501)<br>博文共享展示 › 窄屏刷新在脚本交付及首次适配后才启用标题，首次点击打开只读全文 | 3.257 / 3.393 / 5.504 | 5.393 | 第3轮Reload1.804秒、Context关闭1.575秒；这是118真实脚本/首次适配门闩回归，保留原故障检测和清理，不凭一次111ms超软预算削弱保护。 |
| authenticated / [tests/e2e/blog-user-boundary.spec.ts](../tests/e2e/blog-user-boundary.spec.ts#L97)<br>Blog Flight 只传递必要用户数据并保留共享导航 | 0.967 / 3.061 / 1.030 | 3.030 | 第2轮After Hooks2.143秒含Context关闭2.136秒，超过软预算31ms；保留Flight隐私边界，现有证据不支持改动。 |

## 逐项保护与判断

**1. 默认模型长时间静止后点击仍有可见位移，autofocus 后完成回位并停止绘制**

原风险与历史：真实 demand 渲染在长时间静止后第一帧出现大 delta，点击动作被跳完；autofocus/关注事件抢占点击，或动画回位后继续绘制。 feat-080明确要求长静止后完整动作、同Canvas、低动态/隐藏停止；本用例实测实际静止30秒、轮廓可见位移、autofocus之后多帧、最终回位及停止绘制。

低层覆盖：[tests/lib/agent-entry-behavior.test.ts](../tests/lib/agent-entry-behavior.test.ts)、[tests/component/agent-entry.test.tsx](../tests/component/agent-entry.test.tsx)。Node直接输入30000/30475/30950等时间验证控制器归位、抢占与停帧；组件验证低动态、可见性和Canvas接线。均不能制造实际浏览器demand clock/真实WebGL轮廓。

浏览器独有边界：真实30秒静止后的WebGL首个动作、DOM autofocus接线及透明像素轮廓读回；headless软件WebGL不能代表实体手机性能。

成本证据：截图次数[0, 0, 0]，单调窗口合计0.000 / 0.000 / 0.000秒；导航/重载合计0.193 / 0.178 / 0.200秒。显式等待30.004 / 30.000 / 30.024秒。30秒实际静止是大delta回归触发条件；保留真实demand渲染、轮廓位移及autofocus接线。虚拟时间的控制器测试不能证明相同浏览器风险。

结论：保留。

**2. 慢查询跨多个轮询周期时聊天快照保持串行，消息和 Agent 状态在重连后稳定**

原风险与历史：数据库慢查询跨2秒tick时重复启动snapshot，旧结果覆盖新的消息与Agent终态；断线重连后状态回退。 feat-056真实PostgreSQL Memo锁超过六秒，旧实现出现4条等待查询、修复后1条；恢复和重连各连续三个快照稳定。

低层覆盖：[tests/server/room-stream.test.ts](../tests/server/room-stream.test.ts)、[tests/integration/room-snapshot-privacy.integration.test.ts](../tests/integration/room-snapshot-privacy.integration.test.ts)。Route用deferred/fake timers验证重叠tick、错误恢复、abort/cancel；PG集成验证公开投影。没有覆盖真实查询等待、原生EventSource/CDP、重连及页面状态的组合。

浏览器独有边界：实际PostgreSQL锁/pg_locks/pg_stat_activity、原生SSE、客户端消息和工具状态UI；mock快照不能替代。

成本证据：截图次数[0, 0, 0]，单调窗口合计0.000 / 0.000 / 0.000秒；导航/重载合计0.248 / 0.260 / 0.278秒。真实PG锁等待年龄达到6秒、恢复与重连后的连续三份SSE快照共同构成触发和稳定性证明。轮询等待是可观察条件，不削减轮询周期或快照数。

结论：保留。

**3. 草稿各尺寸只有一层蒙版，精简工具栏贴底且已移除辅助入口**

原风险与历史：480px附近旧分叉造成双蒙版/控件错位；小窗口工具栏不可达，已移除辅助入口复活。 feat-091边框修复和feat-095：479/480/481、240及160×120五种尺寸保留同一几何和底部/外置操作。

低层覆盖：[tests/lib/blog-work-geometry.test.ts](../tests/lib/blog-work-geometry.test.ts)、[tests/component/blog-workspace-lifecycle.test.tsx](../tests/component/blog-workspace-lifecycle.test.tsx)、[tests/integration/blog-work-lifecycle.integration.test.ts](../tests/integration/blog-work-lifecycle.integration.test.ts)。Node几何/组件生命周期和PG窗口上限不渲染实际CSS；没有五个尺寸的toolbar布局/真实点击可达性。

浏览器独有边界：五个边界尺寸的真实蒙版/工具栏几何与trial点击。自动断言检查尺寸/位置/入口；单层蒙版视觉还依赖五张人工复核截图，不是像素黄金图自动断言。

成本证据：截图次数[5, 5, 5]，单调窗口合计10.422 / 11.633 / 13.002秒；导航/重载合计0.457 / 0.449 / 0.460秒。五个边界尺寸与25次trial点击分别保护480px分叉、极小窗口和工具栏可达性。多轮截图窗口占用明显，但尚无证据区分字体、渲染稳定等待、捕获或I/O；登记feat-122先诊断。五张视觉工件及全部几何/命中断言先保留。

结论：优化准备/等待（先定向诊断，全部保护保留）。

**4. 草稿自动保存、恢复、私密字节与整组发布协作**

原风险与历史：自动保存/恢复丢失内容，私密字节通过缓存或其他用户泄露，发布不完整，非作者越权，整组删除误删外部内容。 feat-091整组发布、作者私密草稿、媒体协作与删除；feat-101整组删除入口。 feat-114/115保留原取消零写入保护并校正响应交叠和非精确比例；feat-118覆盖水合/首次适配后的标题首次点击。

低层覆盖：[tests/component/blog-work-save.test.tsx](../tests/component/blog-work-save.test.tsx)、[tests/integration/blog-work-authorization.integration.test.ts](../tests/integration/blog-work-authorization.integration.test.ts)、[tests/integration/blog-work-lifecycle.integration.test.ts](../tests/integration/blog-work-lifecycle.integration.test.ts)、[tests/component/blog-work-photo-save.test.tsx](../tests/component/blog-work-photo-save.test.tsx)、[tests/lib/blog-work-photo-patch.test.ts](../tests/lib/blog-work-photo-patch.test.ts)。组件保护队列/幂等/迟到版本，PG保护字节授权、原子发布/级联、协作权限；缺真实上传拖动、刷新恢复、两用户编辑及手机阅读接线。

浏览器独有边界：真实上传/拖动与保存禁用、私密到公开的HTTP字节、双Context协作、窄屏阅读、键盘删除、刷新后消失及外部归属不变。

成本证据：截图次数[3, 3, 3]，单调窗口合计6.498 / 6.075 / 6.436秒；导航/重载合计2.128 / 2.244 / 1.904秒。上传、刷新恢复、公开发布、双用户协作和外部归属分别跨越真实HTTP/PG与界面。截图窗口值得与五尺寸用例一起定向定位，纳入feat-122；不将低层授权/保存队列覆盖当作可删除整条旅程的证明。

结论：优化准备/等待（先定向诊断，全部保护保留）。

**5. 两位用户的私聊持久隔离，关闭后任务完成、重新打开回复，审批后继续且 Chat 保持共享**

原风险与历史：两用户私聊串入共享Chat或互相泄露；关窗丢失任务完成提醒；高风险删除未经审批执行或恢复后回复虚构。 feat-080专属owner会话/审批/共享隔离；feat-089关窗后继续观察并提醒终态。 feat-116已证明录制墙钟补帧会拖住关闭，改用单调输入；新增真实录制器/Context/PG收尾回归仍在完整集合中。

低层覆盖：[tests/integration/agent-private-conversation.integration.test.ts](../tests/integration/agent-private-conversation.integration.test.ts)、[tests/component/agent-conversation-dialog.test.tsx](../tests/component/agent-conversation-dialog.test.tsx)。PG覆盖owner/任务访问、上下文和投影隔离，组件覆盖关窗后台终态、迟到读取栅栏；没有真实两Context与审批按钮、刷新历史及共享Chat导航组合。

浏览器独有边界：双用户真实Cookie/API/数据库、关窗继续完成、重新打开回复、审批后继续、刷新隔离及Chat选择。LLM仅控制决策，外部测试子进程执行真实Runtime；不代表Docker Worker或真实供应商测试。

成本证据：截图次数[0, 0, 0]，单调窗口合计0.000 / 0.000 / 0.000秒；导航/重载合计0.636 / 0.666 / 0.661秒。保留两Context的发送、关窗后台完成、审批、刷新与共享Chat组合。可观察步骤包含多次交互和终态等待，Runtime/PG内部子成本未单独量化；通过不能宣称长期零偶发或真实供应商/Docker Worker验证。

结论：保留。

**6. rotates a Home photo smoothly with a handle, keyboard and touch, and persists the final angle**

原风险与历史：连续旋转反向跳动、屏幕轴与局部轴混淆、边界反向不连续、手势未完成就多次保存；键盘/触摸与刷新持久角度不一致。 feat-090旧滑杆连续移动60次出现15次反向跳动；新角落手柄±25°，真实入场动画/触摸时序曾失败后修正。

低层覆盖：[tests/component/home-photo-rotation.test.tsx](../tests/component/home-photo-rotation.test.tsx)、[tests/integration/home-board-authorization.integration.test.ts](../tests/integration/home-board-authorization.integration.test.ts)。组件验证键盘±25°/180°边界与取消，但用假DOMRect/合成事件；PG权限不验证实际滚动坐标、CSS矩阵、触摸capture和保存节拍。

浏览器独有边界：真实每度连续移动与边界反向、CSS矩阵角度、仅松手PATCH、真实PG行、刷新/导航恢复、取消与局部轴resize及触摸。

成本证据：截图次数[2, 2, 2]，单调窗口合计3.508 / 0.819 / 4.062秒；导航/重载合计0.710 / 0.686 / 0.854秒。保留逐度连续鼠标、原生触摸、旋转后缩放、取消零写入及刷新恢复。Node/组件只覆盖公式和离散事件；目前没有等价检测证明可迁移连续手势，截图和轮询的具体内部成本不作推测。

结论：保留。

**7. 拖拽超过阈值才移动，真实模型反馈原地回稳且刷新和 Chat 回返记住放置点**

原风险与历史：小幅抖动误拖拽/开窗；拖动保存中间点、模型被重建、松手不回稳；刷新或Chat回返丢失放置点。 feat-082拖拽阈值、只在松手保存、同Canvas、原位回稳和持久点；feat-084加强实际倾摆。

低层覆盖：[tests/component/agent-entry-drag.test.tsx](../tests/component/agent-entry-drag.test.tsx)、[tests/lib/agent-entry-behavior.test.ts](../tests/lib/agent-entry-behavior.test.ts)。组件模拟pointer和localStorage，Node验证有界倾摆与450ms归位；不证明真实指针捕获、WebGL轮廓、浏览器返回缓存或刷新位置。

浏览器独有边界：原生连续鼠标移动、透明轮廓可见位移、Canvas身份与GLB请求数、真实历史导航/localStorage恢复。

成本证据：截图次数[0, 0, 0]，单调窗口合计0.000 / 0.000 / 0.000秒；导航/重载合计0.438 / 0.404 / 0.397秒。真实指针捕获、同一Canvas/GLB、连续轮廓反馈和导航后位置恢复无法由控制器测试替代。没有30秒等待；就绪/停绘条件与交互窗口可见，缺少可安全缩减的独立证据。

结论：保留。

**8. 不向编辑器传用户对象时，普通博文新建、取消、修改、删除及非作者保护仍成立**

原风险与历史：删除currentUser传参后普通文章发布/取消/修改/删除或非作者保护失效，发文作者快照丢失。 feat-105收紧客户端用户数据边界，必须保留编辑写入旅程；私密HTML/Flight缺失另有专门用例，本条保护行为不是重复载荷扫描。

低层覆盖：[tests/component/post-editor.test.tsx](../tests/component/post-editor.test.tsx)、[tests/integration/post-write-contract.integration.test.ts](../tests/integration/post-write-contract.integration.test.ts)、[tests/integration/post-visibility.integration.test.ts](../tests/integration/post-visibility.integration.test.ts)。组件保护无用户prop的提交/取消/确认状态，PG保护写入/权限；缺App Router导航、水合表单、作者快照、另用户Edit不可见/受保护页跳转与真实Cookie。

浏览器独有边界：真实作者表单及导航、取消零写入、另一用户页面/403写入拒绝、删除确认与刷新持久结果。

成本证据：截图次数[0, 0, 0]，单调窗口合计0.000 / 0.000 / 0.000秒；导航/重载合计0.445 / 0.510 / 0.495秒。保留真实Server Action/HTTP、原生表单、两用户Cookie与取消/保存/删除导航。组件与PG层分别保护局部规则，未证明整个旅程失效或与其他入口等价。

结论：保留。

**9. 入口身份生命周期 › 跨标签退出卸载公开页入口与 WebGL，重新登录并聚焦后复用模型恢复私聊**

原风险与历史：公开About无SessionHeartbeat而跨标签退出仍保留入口或WebGL；重新登录/真实窗口聚焦后没有重验，或重复下载模型。 feat-080身份范围Gate在公开页面也须正确；本用例使用第二用户Session、原生焦点及实际401/200重验。

低层覆盖：[tests/component/agent-entry-gate.test.tsx](../tests/component/agent-entry-gate.test.tsx)、[tests/integration/session-issuance.integration.test.ts](../tests/integration/session-issuance.integration.test.ts)。组件模拟storage/focus事件和迟到200，PG保护Session签发；都不证明原生跨标签事件、真实document.hasFocus或WebGL context释放。

浏览器独有边界：完整Chromium channel的原生焦点、storage退出通知、About不导航即卸载/contextLost、登录表单水合和单次GLB下载。

成本证据：截图次数[0, 0, 0]，单调窗口合计0.000 / 0.000 / 0.000秒；导航/重载合计0.283 / 0.313 / 0.311秒。原生跨标签通知、401/200身份重验、真实窗口焦点和WebGL资源释放构成独有边界；保留完整Chromium用例，不以模拟storage/focus事件替代。

结论：保留。

**10. 320px 页面表单、Study 与 Post 控件可操作**

原风险与历史：悬浮3D入口遮挡表单底部按钮、Study控件或长博文编辑/删除入口；窄屏缩短可用视口后控件无法操作。 feat-080/109保留320/390/1280三种实际视口的宿主控件可操作保护；同源浏览器创建夹具替代曾出现socket hang up的Node请求，未减少真实认证/HTTP/PG保护。

低层覆盖：[tests/component/agent-entry.test.tsx](../tests/component/agent-entry.test.tsx)、[tests/component/agent-entry-drag.test.tsx](../tests/component/agent-entry-drag.test.tsx)、[tests/component/post-editor.test.tsx](../tests/component/post-editor.test.tsx)。组件验证模态释放、入口位置与编辑器提交/取消；jsdom不计算真实CSS命中，也没有跨页面滚动与悬浮入口的实际叠层。

浏览器独有边界：320px真实视口下/me、/study、长博文详情及编辑页面的点击命中、表单输入、删除确认与清理。窄屏用例另覆盖400px高视口，不能宣称实体软键盘验证。

成本证据：截图次数[0, 0, 0]，单调窗口合计0.000 / 0.000 / 0.000秒；导航/重载合计0.502 / 0.532 / 0.660秒。不同视口保护真实响应式布局、滚动、悬浮入口叠层与宿主控件命中；多次expectReady及导航属于实际接线。没有低层等价证明，保留原参数化宽度，不能只因共享测试体合并。

结论：保留。

## 后续与验证范围

仅登记feat-122，先定位五尺寸布局、自动保存/整组发布及发布时间悬停用例的截图等待；保留479/480/481/240/160×120的几何、工具栏命中、真实上传/恢复/双用户权限，以及发布时间的框外hover、两态占位、作者日期和零写入保护。三个入口分别对照，不预设相同根因；全部视觉工件继续保留。没有字体/动画/捕获/I/O的因果分解前不预设优化方案；如无法证明安全缩减，保留原覆盖并解释成本。任何实际改动须独立给出替代检测证明、真实PG/浏览器和风险门禁，不在112内实施。

其余候选保留，未发现足以证明完整迁移或删除的等价覆盖，不为了减量新增任务。此次未修改代码、依赖、构建或默认运行配置，依AGENTS与112验收的文档例外，不额外运行./init.sh、check:quick/check/check:full、独立PG集成或Compose smoke；三轮真实生产构建/浏览器结果单列，不代表上述门禁本轮通过。

JSON/跨归档依赖/状态/计数/链接/采样算术/历史保留/输入和范围摘要、git diff --check已通过，git status已检查。临时副本/依赖/构建、原始报告/截图/视频/trace/auth、观察器和驱动已删除，另清53份专属tsx缓存、8份专属npm日志；Docker回到原1容器/3卷/4网络/5镜像集合，3100关闭，测试进程/上传/视频探针目录0。673份范围外文件与其他26项原feature保持，根28项不触发归档；详细清理证据写入JSON与交接。未提交、推送、部署或操作用户开发库。

---

# 历史报告（以下状态与下一步只描述当时）

# 生产 E2E 耗时审查（feat-112，114后恢复采样受阻）

2026-10-04：**113/114 已 done；114最终版本的首轮125通过、1失败，本组有效样本0/3，112保持blocked。** 失败在双用户私聊用例的浏览器context关闭收尾，尚未定位机制。停止第二、三轮；软预算及最终三份中位数前10继续待校准。

唯一推荐下一步：实施 **feat-116「生产 E2E 双用户私聊用例 browserContext.close 超时的定向诊断与修复」**。本轮只登记，not-started，独立依赖已done的080；不在112内修复。116完成后以最终源码/配置/集合重新采三份完整有效样本。092/115仍not-started。

长期证据：[脱敏采样数据](plan/evidence/feat-112/e2e-cost-baseline.json)。schema4顶层计数对应currentSampling（114后550/126）；旧post113组完整移至previousSamplingGroups，最初旧组仍在historicalSampling。根source保留历史恢复引用，当前输入见currentSampling.source。下文历次原报告明确标为历史，不覆盖当前状态。

## 本轮固定条件与结果

独立源码与独立node_modules，锁定 `./scripts/run-node22.sh npm ci` exit0、1037包/18秒，不复制真实.env。550份输入SHA-256 `e946a2aa9f1235e92377d9149f8dc401e103dd28b69345f39a31e2876cca1509` 与114最终版逐字节一致；126项project/文件/完整参数化标题集合逐项一致：10文件、setup1/public7/authenticated118。前后仅副本的Next生成next-env路径变化，工作区输入保持。

Node22.23.2/npm10.9.8/Playwright1.62.1/Next16.3.3、实际完整Chromium及headless shell151.0.7922.34、每轮PG16.15；Linux x64/WSL2、i9-13900HX/32可用CPU/8161816576字节内存。LANG=en_US.UTF-8、TZ=UTC、CIRCLE_NODE_TOTAL=4、CI unset、production软件WebGL；CLI retries0，单worker/fullyParallel=false，Next cpus3/memoryBasedWorkersCount=false。实际app-info确认default构建/birthday-2026运行；所有既有主题、浏览器locale/timezone/reducedMotion及完整Chromium焦点覆盖保留。

每轮独立PG/上传/日志，顺序执行；清除副本.next、test-results及独占PWTEST_CACHE_DIR并恢复next-env原输入。安装/浏览器缓存及宿主页缓存不清。观察器增加步骤单调窗口，脚本shell只把原npm原子命令交给/bin/sh；wait线程捕获进程退出，消除旧组1秒退出观察延迟。I/O与资源观察开销纳入本组，不能与旧组作提速比较。1秒离散观测max进程树RSS2876743680字节、minMemAvailable1234874368字节，容器PG和其他宿主进程RSS不在其中；宿主其他负载未控制，不凭内存或CPU数值归因。

## 原命令与计时

```bash
LANG=en_US.UTF-8 TZ=UTC CIRCLE_NODE_TOTAL=4 \
E2E_APP_MODE=production E2E_SOFTWARE_WEBGL=true NEXT_PUBLIC_AGENT_ENTRY_THEME=default \
PWTEST_CACHE_DIR=<sampler>/pw-cache PLAYWRIGHT_JSON_OUTPUT_NAME=<sampler>/final-full-01-report.json \
PLAYWRIGHT_HTML_OUTPUT_DIR=<sampler>/final-full-01-html PLAYWRIGHT_HTML_OPEN=never \
E2E_COST_EVENTS=<sampler>/final-full-01-events.jsonl npm_config_script_shell=<sampler>/script-shell.py \
./scripts/run-node22.sh npx --no-install playwright test --retries=0 \
  --reporter=list,json,html,<sampler>/observer.ts
```

| 执行 | CLI单调秒 | runner秒 | 结果 | 基线资格 |
| --- | ---: | ---: | --- | --- |
| final-full-01 | 875.120 | 873.422 | exit1；125通过/1超时，0 skip/retry | 排除 |
| 正确定向（trace on） | 81.990 | 81.053 | exit0；2/2含setup，0 skip/retry，目标21.591秒 | 定向排除 |
| 首次定向筛选错误 | 63.349 | 未执行业务 | exit1；No tests found，0项；observer读已收尾app-info报ENOENT | 命令错误排除 |

安装在轮外；PG启动/迁移/seed、生产build、健康就绪/收集、setup、业务及报告/服务回收在CLI内；Ryuk异步资源确认另列（完整轮约10.585秒，正确定向约11.441秒），不计预算。阶段八个连续单调窗口之和等于CLI总耗时，command-start事件与Popen前起点仅约微秒差由末阶段吸收。

| 完整轮连续阶段 | 单调秒 |
| --- | ---: |
| prepareBeforeBuild | 9.006 |
| build | 48.967 |
| serverReadinessAndCollection | 2.810 |
| runnerToSetup | 0.284 |
| setupObserverWindow | 0.253 |
| setupToBusiness | 0.286 |
| businessWindow | 811.957 |
| reportAndServerCleanup | 1.557 |

setup runner单项0.227秒、业务单项之和808.398秒另列，不能与窗口相加当整轮墙钟。因失败，不据此生成最终占比、排名或预算。

## 新失败与局限

唯一失败：`authenticated / tests/e2e/agent-entry-authenticated.spec.ts:804 / 两位用户的私聊持久隔离，关闭后任务完成、重新打开回复，审批后继续且 Chat 保持共享`。原 `Test timeout of 120000ms exceeded`；附加 `Error: browserContext.close: Test ended` 指向第880行 `await second.close()`，在finally的page.close、logout之后。目标runner时长148.379秒，含after hooks约28.384秒；末业务expect单调约20.855秒完成。原失败默认trace策略没有trace，完整关闭调用也缺少end事件，不能用源码位置或定向通过宣称唯一根因。

UTC起止不用于预算：本轮实际UTC经过4976.785秒，比单调钟多4101.665秒。私聊内两次明显前跳约4024686.544/77017.445ms；其中toContainText原wall4025977ms、reporter单调1291.475ms。跨跳变wall作废，单调步骤窗口含事件投递/I/O且嵌套重叠，不能相加。没有受控因果证据，不把UTC跳变当关闭超时原因。

正确原样定向在完整CLI后追加 `tests/e2e/agent-entry-authenticated.spec.ts --project=authenticated --grep='两位用户的私聊持久隔离，关闭后任务完成、重新打开回复，审批后继续且 Chat 保持共享' --trace=on`，保留源码/断言，2/2通过，末业务断言约20.794秒。成功trace只有close前事件，无对应after；该缺口也不能解释完整序列中的挂起。错误的首次^标题$筛选对完整project/file/title串不匹配，0项，不当作目标失败或Playwright retry。

114原窄屏手势与新增响应交叠、113发布Edit与准备回归在完整序列均通过；不宣称长期零偶发。发布时间截图仍观测到约16.873秒单调合计，但这是失败轮，缺少有效可比样本，不登记截图优化或减少保护。

## 待完成与退出范围

新组0/3，全部全量/单项median和softReviewBudget为空，最终前10含并列未生成。保留历史单样本十项风险/覆盖审查，不用失败轮通过项、旧组或114门禁凑基线；规则仍为全量B+max(20%×B,60秒)，单项B+max(20%×B,2秒)，仅人工审查。

本轮只更新本报告、脱敏JSON、112状态/116登记及交接。应用/测试/fixture/依赖/默认配置、超时/重试/断言和覆盖率未改。按AGENTS/112文档例外，未额外运行init、quick/check/full、独立PG集成或Compose smoke；真实采样构建/浏览器另记，不代表其他门禁通过。112受阻，不称完成或清洁退出。

清理与最终结构核验结果已写入JSON及交接；raw报告、截图/视频/trace/auth、独立副本/依赖/构建/观察器及明确归属本轮的临时缓存已清理，仅保留脱敏结构证据与用户既有内容。116需独立定位并证明回归检测能力，不提高timeout、循环凑通过或顺带修115。未提交、推送、部署或操作用户开发库。

---

# 2026-10-04 113后采样报告（历史，不覆盖当前状态）

以下整段保留恢复前原报告；其中114“not-started”等状态仅描述当时。114现已done，当前唯一下一步116及550/126新组以上文和根账本为准。

# 生产 E2E 耗时审查（feat-112，恢复采样后受阻）

2026-10-04：**113 已 done；新版本首轮 124 通过、1 失败，新组有效样本 0/3，112 继续 blocked。** 新失败是草稿窄屏图片取消手势后的 revision 零写入断言，原样定向复核通过仍不足以定位或证明修复。首轮失败后停止第二、三轮；软预算和最终中位数前10继续待校准。

唯一推荐下一步：实施 **feat-114「草稿窄屏图片取消手势零写入失败的定向诊断与修复」**。114 仅登记、not-started，独立依赖已 done 的091；本轮不实现它。114完成后按最终源码/配置/用例集合重新采三份完整有效样本；不能拼旧112的单份有效样本、113门禁、失败轮已通过项或定向结果。

长期证据：[脱敏采样数据](plan/evidence/feat-112/e2e-cost-baseline.json)。schema3 顶层状态/计数对应 `currentSampling`；旧证据完整保留在 `historicalSampling`。根 `source` 仅兼容113历史输入恢复引用，当前549份输入在 `currentSampling.source`。旧版本报告在本页后半部分明确标为历史，不能覆盖当前下一步或校准状态。

## 本轮固定条件与范围

新的 `/tmp` 独立源码/独立node_modules 副本，`./scripts/run-node22.sh npm ci` exit0、1037包、18秒；不复制真实.env。Node22.23.2/npm10.9.8/Playwright1.62.1/实际Chromium及headless shell151.0.7922.34/Next16.3.3/真实PG16.15；Linux x64/WSL2，i9-13900HX、32个可用CPU、8161816576字节总内存。

全部549份源码/配置/资源包含既有未提交内容，与工作区逐字节一致；相较旧112仅 `tests/e2e/blog-presentation.spec.ts` 变化。每轮前恢复原next-env并清除本轮.next/test-results/独占Playwright transform缓存；前后仅Next生成next-env的production类型路径变化，工作区原输入保持。完整集合10文件/125项：setup1/public7/authenticated117，逐项project/文件/完整标题和集合指纹保存在JSON。

保留 `LANG=en_US.UTF-8 TZ=UTC CIRCLE_NODE_TOTAL=4 E2E_APP_MODE=production E2E_SOFTWARE_WEBGL=true NEXT_PUBLIC_AGENT_ENTRY_THEME=default`，CI unset，本地默认retry0且CLI `--retries=0`；单worker/fullyParallel=false，实际Next cpus3、memoryBasedWorkersCount=false。每次实际读取app-info确认default构建/birthday-2026运行；既有逐用例locale/timezone/reducedMotion及完整Chromium channel覆盖保持。新独立PG与上传目录，每次顺序执行，原开发库/用户服务未动。

临时reporter增补step begin/end的单调窗口，避免UTC跳变污染步骤成本；`PWTEST_CACHE_DIR=<sampler>/pw-cache`与每秒RSS/内存、每5秒资源观察开销纳入本组。它们未独立测量，不能与旧组直接比较提速。1秒资源采样的进程树已观察最大RSS为2625396736字节，不含容器PG或宿主其他服务；宿主MemAvailable最小912044032字节，SwapFree最小1071833088字节，load1范围0.449–13.167。未控制宿主其他负载，不凭这些数值归因失败。

只更新报告、证据、状态/114登记和交接；应用、测试动作与断言、fixture、依赖、默认运行配置均未改。按AGENTS和112验收的文档例外，不额外运行init/quick/check/full/独立PG集成/Compose smoke；本轮真实生产build/浏览器另记，不能宣称其他门禁通过或112完成。

## 原命令、结果与计时

实际命令（外部计时驱动及脚本shell不改原子命令；观察器源码可由JSON重建）：

```bash
LANG=en_US.UTF-8 TZ=UTC CIRCLE_NODE_TOTAL=4 \
E2E_APP_MODE=production E2E_SOFTWARE_WEBGL=true NEXT_PUBLIC_AGENT_ENTRY_THEME=default \
PWTEST_CACHE_DIR=<sampler>/pw-cache PLAYWRIGHT_JSON_OUTPUT_NAME=<sampler>/new-full-01-report.json \
PLAYWRIGHT_HTML_OUTPUT_DIR=<sampler>/new-full-01-html PLAYWRIGHT_HTML_OPEN=never \
E2E_COST_EVENTS=<sampler>/new-full-01-events.jsonl npm_config_script_shell=<sampler>/script-shell.py \
./scripts/run-node22.sh npx --no-install playwright test --retries=0 \
  --reporter=list,json,html,<sampler>/observer.ts
```

| 执行 | CLI单调秒 | UTC起止秒 | runner秒 | 结果 | 基线资格 |
| --- | ---: | ---: | ---: | --- | --- |
| new-full-01 | 716.301 | 1260.840 | 714.343 | exit1；124通过/1失败，0 skip/retry | 排除 |
| 原样定向（trace on） | 218.748 | 218.737 | 217.524 | exit0；2/2含setup，0 skip/retry | 定向排除 |

全量CLI末边界来自1秒轮询观察，含0至约1秒退出检测延迟；本失败轮不用来校准预算。定向以wait线程捕获真实进程退出。未来有效样本驱动应采用精确退出观察，保持整组三轮统一口径。安装在各轮外；独立PG/迁移/seed、build、健康就绪、setup、业务和服务回收在CLI内；Ryuk异步自退出/资源集合确认分别约10.010秒和9.924秒，不计入CLI预算。

| new-full-01 连续阶段 | 单调秒 |
| --- | ---: |
| 构建前准备 | 8.007 |
| 生产构建 | 47.922 |
| 服务就绪与收集 | 1.164 |
| runner到setup调度 | 0.281 |
| setup外部观察窗口 | 0.273 |
| setup到业务调度 | 0.309 |
| 全部业务窗口 | 656.669 |
| 报告与服务回收 | 1.677 |

八个连续窗口之和等于CLI退出观察总耗时。setup的runner单项0.251秒、业务单项之和653.129秒另列，不与窗口相加冒充总耗时。定向构建198.156秒，期间记录 `Client network socket disconnected before secure TLS connection was established` 9次及构建内 `Retrying 1/3...`，最终build/runner exit0；这些不是Playwright重试，不能把定向耗时当作正常全量成本。

## 新失败与证据局限

唯一失败：`authenticated / tests/e2e/blog-drafts.spec.ts:1008 / 窄屏缩放下图片鼠标和触摸位移逆变换，Escape 与 pointercancel 不写入`。原第1039行，在真实CDP `touchCancel` 后读取作品revision，`Expected: 1 / Received: 2`；此前鼠标位移及Escape后的即时断言通过。没有PATCH提交时序足以区分取消动作写入和早先动作迟到提交，根因尚未定位。不能仅凭失败位置宣称触摸取消导致写入。

同场景观察UTC前跳约544575ms；`Press Escape`原wall步骤546986ms，而runner接收事件的单调窗口约2411.644ms。单调窗口包含事件投递/I/O误差，嵌套步骤重叠不能求和；跨跳变的wall步骤不用来归因。没有因果对照，不把时钟跳变当作revision失败原因。

原样定向追加 `tests/e2e/blog-drafts.spec.ts --project=authenticated --grep='窄屏缩放下图片鼠标和触摸位移逆变换，Escape 与 pointercancel 不写入' --trace=on`；源码/动作/原断言不变，目标7.996秒通过。一次定向通过不替代全量失败或修复证明，未执行故障注入/实际修复。本轮完整序列中的113发布Edit7.532秒/新增准备回归3.284秒通过，保留其既有done，不宣称长期零偶发。

旧发布时间候选本轮4.711秒，两张截图合计0.635秒，未复现旧单样本的高截图成本；完整有效样本不足，暂不登记截图优化或删除任务。新组不按失败轮生成最终排名或占比；旧初步十项保护审查仅为历史背景。

## 收尾与恢复

本轮独立PG、上传目录及Ryuk已回收；临时副本、独立依赖、构建、全部raw成功/失败报告/error-context/截图/视频/trace/auth与独占transform缓存已删除，另清理51份含本轮路径的tsx缓存、5份本轮npm日志，保留其他缓存/浏览器。采样端口3100已关闭，进程/上传目录为0；Docker前后保留原1容器/3卷/4网络/5镜像集合。其他18项原feature、615份范围外原文件和549份输入保持，JSON/依赖/ID/计数/链接/算术/hash及diff/status核验通过。只保留脱敏长期证据和可重建观察器，112仍blocked，不称完成或清洁退出。

114须用真实浏览器/PG观察pointer/capture、显示比例、取消与PATCH/revision提交时序，确定机制后带回归及init/check:full修复；不放宽超时、增加retry、固定sleep、skip或删除有效保护。其完成后112按最终版本重新采三份有效完整样本，再校准预算和逐项审查；不能靠循环采样掩盖当前失败。

---

以下为2026-10-03旧版本原始报告，保留原命令、失败和初步候选。状态、下一步和数据仅指当时；当前状态以上文及根账本为准。

# 2026-10-03 旧版本报告（历史，不能覆盖当前状态）

2026-10-03：**完整有效样本只有 1/3，feat-112 保持 blocked，软预算和最终中位数排名待校准。** 三次完整执行中，两次在同一已发布作品 Edit 悬停断言失败；不修改源码的定向复核通过，不能证明故障已修复。本报告交付可复核的初步数据和逐项候选审查，不作为最终验收。

唯一建议下一步：执行 **feat-113「已发布作品 Edit 悬停样式失败的定向诊断与修复」**。它独立依赖已完成的 feat-107，保持 not-started，不依赖受阻的112。113验收后恢复112；如源码、测试或配置改变，重新采集新版本的三份完整样本，不能与本轮旧样本混算。

长期数据：[脱敏基线与原失败](plan/evidence/feat-112/e2e-cost-baseline.json)；规范：[测试标准](testing-standards.md)、[治理计划](plan/2026-10-03-testing-governance.md)；状态：[功能账本](../feature_list.json)。未修改应用、测试断言、fixture、依赖、默认并发/重试/超时、覆盖率或运行配置。

## 固定条件与测量边界

在 /var/tmp 的独立源码与独立 node_modules 中用锁文件执行 npm ci（exit 0，1037包），不复制真实 .env。Node.js 22.23.2、npm 10.9.8、Playwright 1.62.1、实际 Chromium/headless shell 151.0.7922.34、Next.js 16.3.3；Linux x64/WSL2，i9-13900HX，32个可用CPU，总内存约7.60 GiB。每轮准备/结束的 MemAvailable、SwapFree 在JSON中；未采集CPU/内存峰值、宿主其他程序负载或网络耗时分解。用户原有PostgreSQL一直保留，没有其他本轮构建/测试并行。

LANG=en_US.UTF-8、TZ=UTC、CIRCLE_NODE_TOTAL=4、E2E_SOFTWARE_WEBGL=true、production；实际Next experimental.cpus=3，memoryBasedWorkersCount=false，浏览器单worker/fullyParallel=false。软件WebGL和完整Chromium channel均沿用原配置。空白浏览器在同环境复核 locale=en-US、timezone=UTC；既有 zh-CN/America/Los_Angeles 和 Europe/London 的用例覆盖保留，不改为统一浏览器时区。

每轮使用真实PostgreSQL 16.15的新Testcontainer和独立临时上传/日志目录，顺序执行。构建主题default、运行主题birthday-2026，每轮实际读取安全的app-info和resolved build配置，原主题断言保留。邮件/天气为mock，LLM决策受控；私聊测试执行真实Runtime子进程，不能据此宣称Docker Worker或真实供应商验证。每轮删除本轮构建/transform缓存，固定已安装依赖；浏览器安装缓存和宿主OS页缓存不清除，其命中未采集。

包含dirty内容的549份源码/配置/资源SHA-256与feat-111最终版本全部相同，Git revision与逐文件摘要在JSON。逐轮前后采集536份，额外13份配置/类型只读核对。full-02重启临时采样器时next-env沿用上轮生产引用；full-03从原仓库恢复首轮相同输入，仍重复失败。此差异已记录，不推断它是故障原因。

完整集合为10个文件、124项：setup 1、public 7、authenticated 116。三个全量runner集合指纹相同，每项身份包含project、文件、完整describe/参数化标题；无skip/retry。失败轮不计入有效样本。111的历史样本未复用：UTC/单调差值约21秒，准备与清理未完整分开；仅作当前低层覆盖通过的历史背景。

实际命令（每轮更换JSON输出文件；临时观察器源码保存在证据JSON，可在新副本重建）：

```bash
LANG=en_US.UTF-8 TZ=UTC CIRCLE_NODE_TOTAL=4 \
E2E_APP_MODE=production E2E_SOFTWARE_WEBGL=true NEXT_PUBLIC_AGENT_ENTRY_THEME=default \
PLAYWRIGHT_JSON_OUTPUT_NAME=<sampler>/sample-01.json \
PLAYWRIGHT_HTML_OUTPUT_DIR=<sampler>/html-01 PLAYWRIGHT_HTML_OPEN=never \
E2E_COST_EVENTS=<sampler>/events-01.jsonl npm_config_script_shell=<sampler>/script-shell.py \
./scripts/run-node22.sh npx --no-install playwright test --retries=0 \
  --reporter=list,json,html,<sampler>/observer.ts
```

临时npm script-shell原样交给/bin/sh执行，仅计时；附加reporter观察真实runner事件。CLI计时从启动到进程退出，包括PG/迁移/seed、构建、健康就绪/收集、setup、业务、报告和服务的数据库/上传清理。安装在各轮外；异步Ryuk自退出另列。观察器I/O纳入条件，开销未独立测量，不能当作默认runner性能或提速比例。

Python perf_counter_ns与Node hrtime.bigint共同单调基准已核对。三轮均观察到UTC跳变：99、170、291秒量级，原因未定位。单调经过时间与真实Playwright总/单项计时口径相符，UTC起止差另列；它们不等同于稳定的日历等待。Playwright TestStep.duration使用UTC，跨跳变的步骤不能用于归因。本轮不将这些时钟观察作为Edit失败的原因。

## 全量结果、准备与清理

| 样本 | CLI单调秒 | UTC起止秒 | runner秒 | 结果 | 基线资格 |
| --- | ---: | ---: | ---: | --- | --- |
| full-01 | 704.289 | 803.197 | 702.887 | exit 0；124通过/0失败；0 skip/retry | 有效1份 |
| full-02 | 704.799 | 875.084 | 703.752 | exit 1；123通过/1失败；0 skip/retry | 失败排除 |
| full-03 | 714.801 | 1005.498 | 713.636 | exit 1；123通过/1失败；0 skip/retry | 失败排除 |

下表的窗口都来自事件时间边界。准备含CLI启动、Docker、迁移/seed；启动/收集含健康等待和测试加载；清理含最后业务结束后的报告与Web Server回收，未进一步拆成数据库/文件/HTML成本。业务窗口包含业务之间的调度，不用单项相加冒充整轮。

| 样本 | 构建前准备秒 | 构建秒 | 启动/收集秒 | setup报告秒 | 业务窗口秒 | 测试后清理/报告秒 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| full-01 | 10.064 | 48.927 | 1.633 | 0.234 | 641.582 | 1.282 |
| full-02 | 9.613 | 47.344 | 1.303 | 0.230 | 644.964 | 0.754 |
| full-03 | 9.188 | 47.020 | 1.206 | 0.231 | 655.531 | 1.028 |

setup的外部观察窗口及前后worker调度间隙另在JSON，8个连续窗口之和等于CLI单调总耗时；表中setup列是runner单项值，因此表列之和不冒充总耗时。首轮业务单项之和638.623秒、业务窗口641.582秒、整条CLI704.289秒各自保留。

首轮CLI exit 0后，采样器即时资源集合断言exit 1，额外容器随后退出；Docker事件确认它是testcontainers/ryuk:0.14.0，约在CLI退出10.008秒后destroy。原AssertionError保留，后续Docker集合和上传目录复核已恢复；这不是Playwright失败，也没有因此假装资源清理即时完成。以后临时观察器加入最多15秒的有界资源复核；未改应用harness，CLI计时边界一致。所有全量/定向轮的测试数据库、上传目录和Ryuk已回收，原有容器/卷/网络/镜像保留。

## 重复失败与独立整改

full-02和full-03均在 `authenticated / tests/e2e/blog-presentation.spec.ts:49 / 博文共享展示 › 已发布作品 Edit 与 home 样式一致，仅编辑态可见并保存恢复` 的第93行失败：hover已返回，原 expect.poll 5000ms 内颜色仍 `rgba(0, 0, 0, 0.4)`，预期 `rgb(0, 0, 0)`，其他样式一致。两个完整轮各123通过/1失败，无重试；首次失败的原命令、错误及单项结果均在JSON。

定向诊断在相同资源环境下追加 `tests/e2e/blog-presentation.spec.ts --project=authenticated --grep="已发布作品 Edit 与 home 样式一致，仅编辑态可见并保存恢复" --trace=on`，原样断言2/2通过（含setup），CLI66.034秒。trace配置与选集不同，它不是全量样本。没有隔离故障注入或实际命中/几何失败时观察足以定位根因；不凭CSS规则或复跑通过归因，不声称已修复。

feat-113仅登记：真实浏览器观察pointer命中、:hover、几何/布局变化、CSS和准备状态，按需复核前置序列；确定原因后带可观察回归修复。保留草稿/发布两态、键盘、端点选择、保存恢复及非作者保护，以真实PG/浏览器和init/check:full验收。不得通过放宽timeout、增加retry、skip、固定sleep或重复hover掩盖失败。本轮不顺带实施113，也不重新打开已完成107。

## 初步前10候选（仅full-01，不是最终中位数排名）

候选从唯一完整有效样本的123项业务时长排序；setup单列。第10名12.470秒无并列。完成基线时必须重新按三份中位数排名并纳入第10名并列项；当前不能把失败轮的已通过单项拼成完整成功样本。占比分母为本轮业务报告时长之和638.623秒，不是整轮墙钟。所有候选project均为authenticated。

| 初步序号 | 文件:行及完整标题 | 单样本秒 | 业务占比 | 当前判断 |
| --- | --- | ---: | ---: | --- |
| 1 | [tests/e2e/agent-entry-authenticated.spec.ts:203](../tests/e2e/agent-entry-authenticated.spec.ts#L203)<br>默认模型长时间静止后点击仍有可见位移，autofocus 后完成回位并停止绘制 | 36.060 | 5.647% | 保留 |
| 2 | [tests/e2e/blog-drafts.spec.ts:657](../tests/e2e/blog-drafts.spec.ts#L657)<br>草稿各尺寸只有一层蒙版，精简工具栏贴底且已移除辅助入口 | 23.845 | 3.734% | 保留 |
| 3 | [tests/e2e/blog-drafts.spec.ts:131](../tests/e2e/blog-drafts.spec.ts#L131)<br>作品发布时间仅在框外悬停查看，无时钟按钮，两态均不改变占位 | 21.585 | 3.380% | 证据不足（保留，完整基线后再决定截图等待诊断） |
| 4 | [tests/e2e/authenticated.spec.ts:1674](../tests/e2e/authenticated.spec.ts#L1674)<br>慢查询跨多个轮询周期时聊天快照保持串行，消息和 Agent 状态在重连后稳定 | 21.054 | 3.297% | 保留 |
| 5 | [tests/e2e/agent-entry-authenticated.spec.ts:804](../tests/e2e/agent-entry-authenticated.spec.ts#L804)<br>两位用户的私聊持久隔离，关闭后任务完成、重新打开回复，审批后继续且 Chat 保持共享 | 19.871 | 3.112% | 保留 |
| 6 | [tests/e2e/blog-drafts.spec.ts:847](../tests/e2e/blog-drafts.spec.ts#L847)<br>草稿自动保存、恢复、私密字节与整组发布协作 | 18.567 | 2.907% | 保留 |
| 7 | [tests/e2e/agent-entry-authenticated.spec.ts:402](../tests/e2e/agent-entry-authenticated.spec.ts#L402)<br>拖拽超过阈值才移动，真实模型反馈原地回稳且刷新和 Chat 回返记住放置点 | 15.472 | 2.423% | 保留 |
| 8 | [tests/e2e/agent-entry-authenticated.spec.ts:694](../tests/e2e/agent-entry-authenticated.spec.ts#L694)<br>入口身份生命周期 › 跨标签退出卸载公开页入口与 WebGL，重新登录并聚焦后复用模型恢复私聊 | 12.984 | 2.033% | 保留 |
| 9 | [tests/e2e/authenticated.spec.ts:471](../tests/e2e/authenticated.spec.ts#L471)<br>rotates a Home photo smoothly with a handle, keyboard and touch, and persists the final angle | 12.827 | 2.009% | 保留 |
| 10 | [tests/e2e/blog-user-boundary.spec.ts:145](../tests/e2e/blog-user-boundary.spec.ts#L145)<br>不向编辑器传用户对象时，普通博文新建、取消、修改、删除及非作者保护仍成立 | 12.470 | 1.953% | 保留 |

### 逐项保护与成本证据

**1. 默认模型长时间静止后点击仍有可见位移，autofocus 后完成回位并停止绘制**

原风险：真实 demand 渲染在长时间静止后第一帧出现大 delta，点击动作被跳完；autofocus/关注事件抢占点击，或动画回位后继续绘制。 历史依据：feat-080明确要求长静止后完整动作、同Canvas、低动态/隐藏停止；本用例实测实际静止30秒、轮廓可见位移、autofocus之后多帧、最终回位及停止绘制。 对应ID feat-080，旧条目按[归档索引](harness/README.md)精确检索。

低层覆盖：[tests/lib/agent-entry-behavior.test.ts:5](../tests/lib/agent-entry-behavior.test.ts#L5)、[tests/component/agent-entry.test.tsx:165](../tests/component/agent-entry.test.tsx#L165)。Node直接输入30000/30475/30950等时间验证控制器归位、抢占与停帧；组件验证低动态、可见性和Canvas接线。均不能制造实际浏览器demand clock/真实WebGL轮廓。

浏览器独有边界：真实30秒静止后的WebGL首个动作、DOM autofocus接线及透明像素轮廓读回；headless软件WebGL不能代表实体手机性能。

成本与判断：观察到导航/重载1次、合计0.154秒；截图0次、合计0.000秒。显式等待实际30.016秒。最长步骤为Wait for timeout 30.016秒、toBeVisible 2.297秒。 显式等待30秒是回归触发条件；其余就绪、停绘轮询和读回已用可观察条件。保留这一等待，不能用虚拟时钟的纯控制器证明替代真实渲染。

结论：保留。缺少完整有效基线和等价检测证明，本轮不迁移/删除；数据库、网络、动画/字体及渲染内部子成本未采集时保持未知。

**2. 草稿各尺寸只有一层蒙版，精简工具栏贴底且已移除辅助入口**

原风险：480px附近旧分叉造成双蒙版/控件错位；小窗口工具栏不可达，已移除辅助入口复活。 历史依据：feat-091边框修复和feat-095：479/480/481、240及160×120五种尺寸保留同一几何和底部/外置操作。 对应ID feat-091, feat-095，旧条目按[归档索引](harness/README.md)精确检索。

低层覆盖：[tests/lib/blog-work-geometry.test.ts](../tests/lib/blog-work-geometry.test.ts)、[tests/component/blog-workspace-lifecycle.test.tsx](../tests/component/blog-workspace-lifecycle.test.tsx)、[tests/integration/blog-work-lifecycle.integration.test.ts:78](../tests/integration/blog-work-lifecycle.integration.test.ts#L78)。Node几何/组件生命周期和PG窗口上限不渲染实际CSS；没有五个尺寸的toolbar布局/真实点击可达性。

浏览器独有边界：五个边界尺寸的真实蒙版/工具栏几何与trial点击。自动断言检查尺寸/位置/入口；单层蒙版视觉还依赖五张人工复核截图，不是像素黄金图自动断言。

成本与判断：本条发生UTC跳变，单条Screenshot报告101.602秒而整项单调23.845秒；全部跨段步骤成本不作归因。只保留动作计数：5次导航、5次截图，来源包含25次trial点击。 五次导航、五次截图和25次trial点击均有实测步骤；不能按导航次数认定导航主导。首轮本条发生UTC跳变，步骤时长作废，但整条单调时长仍有效。不同尺寸保护未等价迁移，截图同源成本尚未证实，先保留。

结论：保留。缺少完整有效基线和等价检测证明，本轮不迁移/删除；数据库、网络、动画/字体及渲染内部子成本未采集时保持未知。

**3. 作品发布时间仅在框外悬停查看，无时钟按钮，两态均不改变占位**

原风险：发布时间浮层遮挡/失去hover、框内时钟按钮复活、浏览和编辑两态占位变化，或显示作者日期错误。 历史依据：feat-102/103要求两态同几何、移出框外的悬停时间浮层及移除时钟按钮；本条检查两态反复hover、浮层实际命中、离开/Escape、作者日期和零写入。 对应ID feat-102, feat-103，旧条目按[归档索引](harness/README.md)精确检索。

低层覆盖：[tests/integration/blog-work-time.integration.test.ts:11](../tests/integration/blog-work-time.integration.test.ts#L11)、[tests/lib/blog-work-geometry.test.ts:4](../tests/lib/blog-work-geometry.test.ts#L4)、[tests/lib/post-time.test.ts](../tests/lib/post-time.test.ts)。PG保护作者快照和读取顺序，Node保护几何/时间格式；没有真实浮层布局、elementFromPoint、hover宽限期和两态占位。

浏览器独有边界：真实DOMRect、hover/浮层命中、两态几何、实际字体布局和浏览器截图；page.clock仅控制关闭宽限期。

成本与判断：观察到导航/重载1次、合计0.196秒；截图2次、合计15.772秒。最长步骤为Screenshot 12.442秒、Screenshot 3.330秒。 两次截图动作在完整样本中耗时较多，截图动作包含等待和捕获，不能把它全部归因于GPU、字体或页面时钟。截图是人工视觉复核工件，现无证明可以直接删掉；独立诊断并保留全部几何/命中/零写入保护。

结论：证据不足（保留，完整基线后再决定截图等待诊断）。缺少完整有效基线和等价检测证明，本轮不迁移/删除；数据库、网络、动画/字体及渲染内部子成本未采集时保持未知。

**4. 慢查询跨多个轮询周期时聊天快照保持串行，消息和 Agent 状态在重连后稳定**

原风险：数据库慢查询跨2秒tick时重复启动snapshot，旧结果覆盖新的消息与Agent终态；断线重连后状态回退。 历史依据：feat-056真实PostgreSQL Memo锁超过六秒，旧实现出现4条等待查询、修复后1条；恢复和重连各连续三个快照稳定。 对应ID feat-056，旧条目按[归档索引](harness/README.md)精确检索。

低层覆盖：[tests/server/room-stream.test.ts:121](../tests/server/room-stream.test.ts#L121)、[tests/integration/room-snapshot-privacy.integration.test.ts:20](../tests/integration/room-snapshot-privacy.integration.test.ts#L20)。Route用deferred/fake timers验证重叠tick、错误恢复、abort/cancel；PG集成验证公开投影。没有覆盖真实查询等待、原生EventSource/CDP、重连及页面状态的组合。

浏览器独有边界：实际PostgreSQL锁/pg_locks/pg_stat_activity、原生SSE、客户端消息和工具状态UI；mock快照不能替代。

成本与判断：观察到导航/重载3次、合计0.233秒；截图0次、合计0.000秒。最长步骤为poll toBeGreaterThanOrEqual 7.967秒、poll toBeGreaterThanOrEqual 3.857秒。 锁等待年龄>=6秒以及两段各三个真实快照需要跨轮询周期；expect.poll实测等待，不是用静态120秒超时推成本。降低周期或减少稳定快照会改变原检测条件。

结论：保留。缺少完整有效基线和等价检测证明，本轮不迁移/删除；数据库、网络、动画/字体及渲染内部子成本未采集时保持未知。

**5. 两位用户的私聊持久隔离，关闭后任务完成、重新打开回复，审批后继续且 Chat 保持共享**

原风险：两用户私聊串入共享Chat或互相泄露；关窗丢失任务完成提醒；高风险删除未经审批执行或恢复后回复虚构。 历史依据：feat-080专属owner会话/审批/共享隔离；feat-089关窗后继续观察并提醒终态。 对应ID feat-080, feat-089，旧条目按[归档索引](harness/README.md)精确检索。

低层覆盖：[tests/integration/agent-private-conversation.integration.test.ts:109](../tests/integration/agent-private-conversation.integration.test.ts#L109)、[tests/integration/agent-private-conversation.integration.test.ts:342](../tests/integration/agent-private-conversation.integration.test.ts#L342)、[tests/integration/agent-private-conversation.integration.test.ts:436](../tests/integration/agent-private-conversation.integration.test.ts#L436)、[tests/component/agent-conversation-dialog.test.tsx:366](../tests/component/agent-conversation-dialog.test.tsx#L366)。PG覆盖owner/任务访问、上下文和投影隔离，组件覆盖关窗后台终态、迟到读取栅栏；没有真实两Context与审批按钮、刷新历史及共享Chat导航组合。

浏览器独有边界：双用户真实Cookie/API/数据库、关窗继续完成、重新打开回复、审批后继续、刷新隔离及Chat选择。LLM仅控制决策，外部测试子进程执行真实Runtime；不代表Docker Worker或真实供应商测试。

成本与判断：观察到导航/重载3次、合计0.599秒；截图0次、合计0.000秒。最长步骤为Click 3.003秒、pw:api 2.810秒。 串行发送/任务完成/审批/刷新与多个轮询可见条件都在场景内；Runtime子进程和数据库部分未单独计时，不能声称全部成本来自某个工具或轮询。

结论：保留。缺少完整有效基线和等价检测证明，本轮不迁移/删除；数据库、网络、动画/字体及渲染内部子成本未采集时保持未知。

**6. 草稿自动保存、恢复、私密字节与整组发布协作**

原风险：自动保存/恢复丢失内容，私密字节通过缓存或其他用户泄露，发布不完整，非作者越权，整组删除误删外部内容。 历史依据：feat-091整组发布、作者私密草稿、媒体协作与删除；feat-101整组删除入口。 对应ID feat-091, feat-101，旧条目按[归档索引](harness/README.md)精确检索。

低层覆盖：[tests/component/blog-work-save.test.tsx](../tests/component/blog-work-save.test.tsx)、[tests/integration/blog-work-authorization.integration.test.ts:20](../tests/integration/blog-work-authorization.integration.test.ts#L20)、[tests/integration/blog-work-lifecycle.integration.test.ts:31](../tests/integration/blog-work-lifecycle.integration.test.ts#L31)、[tests/integration/blog-work-lifecycle.integration.test.ts:66](../tests/integration/blog-work-lifecycle.integration.test.ts#L66)、[tests/integration/blog-work-lifecycle.integration.test.ts:94](../tests/integration/blog-work-lifecycle.integration.test.ts#L94)。组件保护队列/幂等/迟到版本，PG保护字节授权、原子发布/级联、协作权限；缺真实上传拖动、刷新恢复、两用户编辑及手机阅读接线。

浏览器独有边界：真实上传/拖动与保存禁用、私密到公开的HTTP字节、双Context协作、窄屏阅读、键盘删除、刷新后消失及外部归属不变。

成本与判断：观察到导航/重载5次、合计1.951秒；截图3次、合计5.804秒。最长步骤为Screenshot 3.186秒、toHaveCount 2.904秒。 长旅程的导航、截图和交互可分别观测，但数据库与网络/渲染进一步细分未采集。低层覆盖重叠不证明能删跨层旅程；保留有效断言。

结论：保留。缺少完整有效基线和等价检测证明，本轮不迁移/删除；数据库、网络、动画/字体及渲染内部子成本未采集时保持未知。

**7. 拖拽超过阈值才移动，真实模型反馈原地回稳且刷新和 Chat 回返记住放置点**

原风险：小幅抖动误拖拽/开窗；拖动保存中间点、模型被重建、松手不回稳；刷新或Chat回返丢失放置点。 历史依据：feat-082拖拽阈值、只在松手保存、同Canvas、原位回稳和持久点；feat-084加强实际倾摆。 对应ID feat-082, feat-084，旧条目按[归档索引](harness/README.md)精确检索。

低层覆盖：[tests/component/agent-entry-drag.test.tsx:200](../tests/component/agent-entry-drag.test.tsx#L200)、[tests/component/agent-entry-drag.test.tsx:212](../tests/component/agent-entry-drag.test.tsx#L212)、[tests/lib/agent-entry-behavior.test.ts:55](../tests/lib/agent-entry-behavior.test.ts#L55)、[tests/lib/agent-entry-behavior.test.ts:104](../tests/lib/agent-entry-behavior.test.ts#L104)。组件模拟pointer和localStorage，Node验证有界倾摆与450ms归位；不证明真实指针捕获、WebGL轮廓、浏览器返回缓存或刷新位置。

浏览器独有边界：原生连续鼠标移动、透明轮廓可见位移、Canvas身份与GLB请求数、真实历史导航/localStorage恢复。

成本与判断：观察到导航/重载3次、合计0.364秒；截图0次、合计0.000秒。最长步骤为toBeVisible 3.126秒、toBeVisible 2.613秒。 多次就绪/停绘轮询和真实导航承担独有边界；本条没有30秒静止等待。不能用同一控制器Node测试替代GLB/Canvas真实接线。

结论：保留。缺少完整有效基线和等价检测证明，本轮不迁移/删除；数据库、网络、动画/字体及渲染内部子成本未采集时保持未知。

**8. 入口身份生命周期 › 跨标签退出卸载公开页入口与 WebGL，重新登录并聚焦后复用模型恢复私聊**

原风险：公开About无SessionHeartbeat而跨标签退出仍保留入口或WebGL；重新登录/真实窗口聚焦后没有重验，或重复下载模型。 历史依据：feat-080身份范围Gate在公开页面也须正确；本用例使用第二用户Session、原生焦点及实际401/200重验。 对应ID feat-080，旧条目按[归档索引](harness/README.md)精确检索。

低层覆盖：[tests/component/agent-entry-gate.test.tsx:214](../tests/component/agent-entry-gate.test.tsx#L214)、[tests/component/agent-entry-gate.test.tsx:254](../tests/component/agent-entry-gate.test.tsx#L254)、[tests/integration/session-issuance.integration.test.ts](../tests/integration/session-issuance.integration.test.ts)。组件模拟storage/focus事件和迟到200，PG保护Session签发；都不证明原生跨标签事件、真实document.hasFocus或WebGL context释放。

浏览器独有边界：完整Chromium channel的原生焦点、storage退出通知、About不导航即卸载/contextLost、登录表单水合和单次GLB下载。

成本与判断：观察到导航/重载2次、合计0.333秒；截图0次、合计0.000秒。最长步骤为toBeVisible 3.462秒、toBeVisible 2.851秒。 多页就绪、真实认证/401/200与聚焦的步骤必要；三次样本不证明今后无焦点偶发问题，也不能只把成本归结为登录请求。

结论：保留。缺少完整有效基线和等价检测证明，本轮不迁移/删除；数据库、网络、动画/字体及渲染内部子成本未采集时保持未知。

**9. rotates a Home photo smoothly with a handle, keyboard and touch, and persists the final angle**

原风险：连续旋转反向跳动、屏幕轴与局部轴混淆、边界反向不连续、手势未完成就多次保存；键盘/触摸与刷新持久角度不一致。 历史依据：feat-090旧滑杆连续移动60次出现15次反向跳动；新角落手柄±25°，真实入场动画/触摸时序曾失败后修正。 对应ID feat-090，旧条目按[归档索引](harness/README.md)精确检索。

低层覆盖：[tests/component/home-photo-rotation.test.tsx:84](../tests/component/home-photo-rotation.test.tsx#L84)、[tests/component/home-photo-rotation.test.tsx:128](../tests/component/home-photo-rotation.test.tsx#L128)、[tests/integration/home-board-authorization.integration.test.ts](../tests/integration/home-board-authorization.integration.test.ts)。组件验证键盘±25°/180°边界与取消，但用假DOMRect/合成事件；PG权限不验证实际滚动坐标、CSS矩阵、触摸capture和保存节拍。

浏览器独有边界：真实每度连续移动与边界反向、CSS矩阵角度、仅松手PATCH、真实PG行、刷新/导航恢复、取消与局部轴resize及触摸。

成本与判断：观察到导航/重载5次、合计0.734秒；截图2次、合计0.757秒。最长步骤为Hover 2.539秒、poll toBeCloseTo 1.682秒。 连续动作/可见轮询/触摸/截图都有成本；低层已有参数组合仍不足以证明简化真实连续手势能捕获历史跳动，当前保留。

结论：保留。缺少完整有效基线和等价检测证明，本轮不迁移/删除；数据库、网络、动画/字体及渲染内部子成本未采集时保持未知。

**10. 不向编辑器传用户对象时，普通博文新建、取消、修改、删除及非作者保护仍成立**

原风险：删除currentUser传参后普通文章发布/取消/修改/删除或非作者保护失效，发文作者快照丢失。 历史依据：feat-105收紧客户端用户数据边界，必须保留编辑写入旅程；私密HTML/Flight缺失另有专门用例，本条保护行为不是重复载荷扫描。 对应ID feat-105，旧条目按[归档索引](harness/README.md)精确检索。

低层覆盖：[tests/component/post-editor.test.tsx:74](../tests/component/post-editor.test.tsx#L74)、[tests/component/post-editor.test.tsx:92](../tests/component/post-editor.test.tsx#L92)、[tests/component/post-editor.test.tsx:104](../tests/component/post-editor.test.tsx#L104)、[tests/integration/post-write-contract.integration.test.ts](../tests/integration/post-write-contract.integration.test.ts)、[tests/integration/post-visibility.integration.test.ts](../tests/integration/post-visibility.integration.test.ts)。组件保护无用户prop的提交/取消/确认状态，PG保护写入/权限；缺App Router导航、水合表单、作者快照、另用户Edit不可见/受保护页跳转与真实Cookie。

浏览器独有边界：真实作者表单及导航、取消零写入、另一用户页面/403写入拒绝、删除确认与刷新持久结果。

成本与判断：观察到导航/重载2次、合计0.561秒；截图0次、合计0.000秒。最长步骤为Click 2.394秒、Close context 2.244秒。 长编辑旅程包含多次导航与双用户夹具；目前没有等价证明可删除，不能因组件同名断言而迁移整个旅程。

结论：保留。缺少完整有效基线和等价检测证明，本轮不迁移/删除；数据库、网络、动画/字体及渲染内部子成本未采集时保持未知。

## 软预算与退出范围

全量和全部单项预算均为 **待校准（1/3）**，JSON中的中位数/预算阈值为空，不报告稳定分位数或长期零偶发失败。完成后沿用110规则：全量 B + max(20%×B, 60秒)；单项 B + max(20%×B, 2秒)，或进入耗时前10。只触发人工审查，不新增硬超时，不减少保护条件。本轮没有足够数据登记截图优化任务；完成可靠性整改和完整基线后再决定，不能为了减量制造工作。

本轮仅写报告、脱敏JSON、112状态、113登记及相邻会话交接。按AGENTS/112文档例外未额外运行init、check:quick/check/check:full、独立PostgreSQL集成或Compose smoke；三个采样内的真实production build和浏览器结果如实单列。未运行的应用门禁不能说已通过，112受阻不能称完成或清洁退出。

收尾核验和清理结果写入证据与交接：核验JSON、ID/依赖/状态/计数、链接、归档完整性、范围摘要及git diff/status；删除本轮副本、观察器、node_modules、构建、认证状态、成功/失败raw报告/视频/trace和临时缓存，保留必要脱敏结果及用户已有工作。根列表不超过40，跳过归档。未提交、推送、部署或改动用户开发库。
