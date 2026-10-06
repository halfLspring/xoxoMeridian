# 测试标准

## 目标与技术选型

本项目使用分层测试，而不是让单一框架承担所有风险：

- Vitest 4（Node 项目）验证纯函数、Agent 行为、服务模块和带可控依赖的 Route Handler。它与 TypeScript/ESM 工具链一致，反馈最快。
- Vitest 4（jsdom 项目）配合 React Testing Library、`user-event` 和 MSW，验证组件的可访问交互与真实 HTTP 边界，不测试 React 内部状态。
- Testcontainers + PostgreSQL 16 + Prisma 验证唯一约束、外键级联、事务和访问控制等数据库语义。SQLite 或 Prisma mock 不能替代这一层。
- Playwright 验证真实浏览器中的注册/登录、鉴权跳转、发帖、专注计时和聊天等关键旅程。
- V8 coverage 作为非回退门禁；当前全量基线为 statements 40%、branches 35%、functions 45%、lines 40%，后续只能随有效覆盖提高。

Jest、Cypress、AVA、Mocha 都能完成部分工作，但引入它们会造成重复 runner、配置和 mock 语义。当前项目无需再增加第二套单元测试 runner；浏览器旅程选择 Playwright，是因为它与 Next.js Web Server、认证状态复用和多项目依赖直接配合。

## 测试目录

- `tests/agent/**/*.test.ts`：计划、调度、工具和 Agent Runtime 的 Node 测试。
- `tests/lib/**/*.test.ts`：纯函数、适配层、领域服务和存储边界的 Node 测试。
- `tests/server/**/*.test.ts`：认证、授权、API 和服务端渲染行为的 Node 测试。
- `tests/component/**/*.test.tsx`：jsdom + Testing Library 组件测试。
- `tests/integration/**/*.integration.test.ts`：真实临时 PostgreSQL 集成测试。
- `tests/e2e/**/*.spec.ts`：Playwright 用户旅程；`*.setup.ts` 只负责前置状态。
- `tests/mocks/` 与 `tests/setup/`：跨测试共享的网络替身和生命周期清理。

## 命令与门禁

项目以 `.node-version` 固定 Node.js 22.23.2，并以 `package.json#packageManager` 固定 npm 10.9.8；`.npmrc` 的 `engine-strict=true` 会拒绝不匹配的 npm 安装环境。常规 shell 可直接运行下列命令；若 `sudo -u`/临时 Docker group 清除了用户 PATH，统一使用：

```bash
sudo -n -g docker -u dadalv ./scripts/run-node22.sh npm run test:integration
```

`run-node22.sh` 本身不调用 sudo，也不扩大权限；它只从仓库版本契约恢复并校验 Node/npm PATH，再执行传入命令。

- `npm run test:unit`：Node 项目。
- `npm run test:component`：jsdom 组件项目。
- `npm test`：Node 与组件项目，共享默认快速反馈。
- `npm run test:watch`：本地迭代。
- `npm run test:coverage`：全量 Vitest + V8 门槛。
- `npm run test:integration`：启动 PostgreSQL 16 Testcontainer、执行迁移并运行 Prisma 集成测试。
- `npm run test:e2e`：启动 PostgreSQL Testcontainer、迁移和 seed、Next.js 测试服务，再运行全部 Playwright 项目。
- `npm run test:e2e:public`：只选择 public 项目；它仍依赖认证 setup。
- `npm run test:e2e:production`：同上，但以 `E2E_APP_MODE=production` 先 `next build`、再 `next start` 提供测试服务；这是 `check:full` 使用的发布门禁形态。
- `npm run test:e2e:dev-origins`：另启隔离 PostgreSQL 和绑定 `0.0.0.0` 的真实开发服务，分别通过 `localhost`、`127.0.0.1` 登录并验证 New Post 直接访问、站内进入、刷新、发布及返回导航；断言开发 WebSocket 的真实 101 握手。测试环境通过既有 `ALLOWED_ORIGINS` 配置这两个带端口的来源，每个主机独立建立 Cookie，不改变应用的 CSRF 策略。该命令补充 `check:full`，生产浏览器门禁不能替代开发 HMR 验证。
- `npm run check:compose-config`：用临时非敏感环境变量渲染 production + smoke Compose 配置，并校验 project、端口、卷、runner target 与 `AGENT_TASK_INLINE_RUN=false` 的隔离约束；不访问 Docker daemon。
- `npm run test:compose-smoke`：构建 production Web/Worker 镜像，在随机 Compose project 中启动 PostgreSQL、init、Web 与独立 Worker，通过真实 Web API 验证 Worker 完成 AgentTask；要求 Docker Compose 2.24.4+，失败日志保留在 `test-results/compose-smoke/`，结束后清理隔离资源。
- `npm run check:static`：Agent 入口资产检查、类型检查、ESLint；供快速与标准门禁复用。
- `npm run check:quick`：静态检查后运行普通 Vitest，保留本地快速反馈。
- `npm run check`：静态检查后运行一次完整 Node/组件覆盖率 Vitest，再做生产构建；测试或覆盖率失败即停止后续阶段。覆盖率测试承担标准门禁的完整 Vitest 集合，不再额外调用快速门禁重复执行普通 Vitest。
- `npm run check:full`：标准门禁、集成测试和发布形态 E2E（即 `npm run test:e2e:production`）。

Compose smoke 先用合成文件和仓库的 `.dockerignore` 调用真实 Docker 构建，验证生产入口保留，环境配置、测试认证状态、Playwright 报告与手动评估输入被排除；启动后另从不挂载数据卷的 Web/Worker 原始镜像验证相同隔离边界。三个手动入口 `scripts/eval-agent-answers.ts`、`scripts/eval-agent-workflow.ts`、`scripts/summarize-agent-eval.ts` 依赖 `tests/evals/agent-answer/`，仅从 Docker 上下文精确排除；本地 `typecheck`、评估脚本、fixture 和真实测试仍完整保留。新增脚本若依赖测试输入，须明确其部署边界并运行 Compose smoke，不放宽生产 TypeScript 检查。

集成测试和本地 E2E 要求 Docker daemon 可用；缺少运行时必须失败并明确提示，不得自动 skip。若验证已在外部环境运行，可通过 `PLAYWRIGHT_BASE_URL` 让 Playwright 连接指定服务，此时服务的数据准备与隔离由该环境负责。

Vitest 的受支持并发配置由 `vitest.config.ts` 的 `maxWorkers` 声明：最多 8 个 worker，且不超过 `os.availableParallelism() - 1`。全量峰值内存近似线性于 worker 数（每 worker 约 160MB），默认的 `cpus - 1` 会让测试进程集占用宿主大部分内存，使首个"在测试体内动态导入 Route"的用例在默认 5000ms 单项超时下失败（见 `feature_list.json` 的 feat-066 条目）。不得靠放宽单项超时或跳过用例掩盖该边界；需要更宽并发时改配置并重新测量内存预算，不要在环境里长期导出 `VITEST_MAX_WORKERS`——该变量会覆盖包括集成配置 `maxWorkers: 1` 在内的所有项目设置，破坏集成测试的串行隔离。

浏览器层的应用模式同样由配置声明，而不是交给宿主余量决定。`tests/e2e/support/app-mode.ts` 的默认值是 `development`，`npm run test:e2e` 保留它，便于本地迭代免构建地拿到开发期诊断；`npm run check:full` 走 `test:e2e:production`。原因是开发模式的服务端占用既无上界又由宿主推导：`next dev` 在未显式给出 `--max-old-space-size` 时按 `os.totalmem() * 0.5` 推导堆上限，并按需编译每个访问到的路由且不卸载（Next 自身 memory-usage 文档说明：全部页面最终被请求后，占用与是否预加载无关）。实测一次完整开发浏览器序列把测试服务推到 RSS 约 2.8GB（堆 366MB→2039MB，上限 3939MB），叠加 Chromium 与 runner 后浏览器层需要约 3.5–4GB；在 7.8GB 宿主上与既有工作负载相加后换页被大量占用（已记录的轮次里 2GB swap 用满、available 低至 366MB），任何延迟有界的断言都可能失败，且每轮失败的用例不同、单独运行又通过（见 `feature_list.json` 的 feat-068、feat-069 条目）。开发模式另有两个只属于它的失败源：Next 的内存看门狗（`server/lib/utils.js` 的 `getMemoryRestartStats` 仅在 `isDev` 时安装，堆超过上限 80% 会以 `RESTART_EXIT_CODE` 原地重启服务）和 `react-dom-client.development.js` 的 User Timing 插桩——它对未记录起始时间的组件发出负时间戳的 `Performance.measure`，作为未捕获异常被 `observeEntry` 的 `pageerror` 断言捕获，而该代码只存在于开发包。生产形态下占用有界、错误面不含开发期插桩噪声，并且校验的是生产构建产物（由 E2E harness 自行构建，构建主题与启动主题故意不同，用于覆盖运行时主题切换）。不得用放宽断言、跳过用例或放大超时来掩盖开发模式的这道边界；需要开发期覆盖时显式运行 `npm run test:e2e` 或定向 `--grep`，并将其记为诊断结论而不是门禁结论。

本地 E2E harness 会把临时 Testcontainer 连接串以 `0600` 权限写入 `test-results/.e2e-database-url`，仅供浏览器生命周期用例推进隔离测试数据，并在测试服务关闭时删除。使用 `PLAYWRIGHT_BASE_URL` 连接外部隔离环境时，需同时通过 `E2E_DATABASE_URL` 提供该服务对应的测试数据库；不得指向开发、预发布或生产数据库。

`tests/e2e/blog-user-boundary.spec.ts` 用隔离账号的已知字段值检查 Blog、普通文章详情、新建、编辑和 Study 的首次 HTML，以及点击页面链接产生的真实 Flight 响应。用例关闭 trace、截图和视频，只把字段是否出现的布尔值交给断言；Flight 在浏览器的真实 `fetch` 响应上使用 `Response.clone()` 读取副本，原响应原样交还应用，避免依赖 Chromium 调试接口的响应缓存。只检查完整点击导航响应，预取不作为验收替代。不得把真实账号凭据或完整 HTML / Flight 写入测试日志、附件和报告。重放发布形态验证可运行 `npm run test:e2e:production -- tests/e2e/blog-user-boundary.spec.ts`，它也包含于 `check:full`。

`tests/e2e/blog-presentation.spec.ts` 用相同中英文、Markdown、作者快照和 352px 可用宽度比较普通 Post 与作品卡片的浏览器计算样式，验证 300 字符/4.875rem 摘要、键盘阅读全文、全文编辑、草稿发布、其他用户权限及窄屏刷新。三类连线读取实际 SVG 样式和屏幕端点，覆盖拖动、旋转、滚动、缩放、裁切相切与隐藏恢复；组内 SVG 在场景缩放外绘制，和页面连线共用屏幕 CSS 像素。卡片高度变化须触发真实布局更新，数据库中的全文、图片位置及场景几何不因摘要展示改写。重放使用 `npm run test:e2e:production -- tests/e2e/blog-presentation.spec.ts`；精确筛选时使用 `E2E_APP_MODE=production npx playwright test tests/e2e/blog-presentation.spec.ts --grep '用例名称'`，避免嵌套 npm 命令消耗筛选参数。

双标签页草稿冲突的 `draft-loading-events` 通过 `tests/e2e/support/response-diagnostics.ts` 同步记录请求、响应头、正文完成、网络失败、页面异常和清理时序。依据 [Playwright 请求生命周期](https://playwright.dev/docs/api/class-request)，正文完成使用 `requestfinished`；诊断监听不得异步等待 `response.finished()`，因为页面关闭会拒绝已经开始的等待，仅移除监听无法收束该 Promise。用例在 `finally` 中逐个移除自己的监听后保存附件，业务 HTTP 状态、JSON 与冲突断言仍直接等待并报告错误。`tests/e2e/response-diagnostics.spec.ts` 用真实 Chromium 和随机本机端口的 HTTP 流控制正文交付，覆盖关页、关闭上下文、先移除监听再关页，以及正常正文、409/503、网络截断和无效 JSON/页面异常。连续生产回归使用 `LANG=en_US.UTF-8 TZ=UTC E2E_APP_MODE=production E2E_SOFTWARE_WEBGL=true ./scripts/run-node22.sh npx playwright test tests/e2e/blog-drafts.spec.ts tests/e2e/response-diagnostics.spec.ts --project=authenticated --grep '双标签页同字段冲突|响应诊断' --repeat-each=3 --retries=0 --trace=on`，不以固定 sleep、重试或放宽超时代替事件同步。

Playwright 1.62.1 的视频墙钟跳变会让 FFmpeg 补出数十分钟的恒定帧率视频，`page.close()` 等待录制，后续 `browserContext.close: Test ended` 可能只是收尾越过用例期限的结果。配置调用 `tests/e2e/support/playwright-video-clock.ts`，在新 worker 启动前校验锁定版本与唯一录制表达式，原子适配为单调时间；保留 retain-on-failure 视频、trace、截图和原超时。npm ci 后会再次适配；版本或源码变化明确失败，升级 Playwright 必须复核上游并移除此适配。`browser-context-close.spec.ts` 在独立驱动副本的真实 Chromium CDP 帧中注入前跳/后跳，检查真实可播放 WebM、两套登录 Cookie、Context 与 PG 资源回收；不改宿主时钟，不用 mock 关闭。原私聊旅程的 fixture 分别报告业务和清理错误，各清理步骤失败仍继续回收，附件仅记录单调阶段及成功布尔值。复验可运行 `E2E_APP_MODE=production E2E_SOFTWARE_WEBGL=true ./scripts/run-node22.sh npx playwright test tests/e2e/agent-entry-authenticated.spec.ts tests/e2e/browser-context-close.spec.ts --project=authenticated --grep '两位用户的私聊持久隔离|录制墙钟' --retries=0 --trace=on`；完整因果对照见 [feat-116 说明](plan/2026-10-04-browser-context-video-clock.md)。

Study 的 Focus 用例通过 `tests/e2e/support/study.ts` 为每次调用创建独立账号和房间，经真实登录接口建立会话；即使断言失败也会先关闭页面，再删除该账号和房间，避免迟到请求污染下一项用例。开始/停止操作先确认对应 HTTP 响应和 sessionKey，停止还须等待状态回读，再断言可见控件；保持默认用例和 UI 超时，不用固定等待替代同步。

首页搜索旅程分别确认输入/URL、HTTP 与列表渲染；只有首次真实查询结果已呈现，才进入失败保留/键盘重试阶段。用例结束先关闭自己的页面，再在 finally 中清理隔离数据；不让页面已关闭后的路由清理异常遮蔽原始失败或跳过数据库回收。

Linux/WSL 首次运行或 Playwright 浏览器版本升级后，应先以当前项目用户安装 Chromium，再通过 Playwright 官方入口安装系统运行库：

```bash
npx playwright install chromium
npx playwright install-deps chromium
```

第二条命令会在需要时自行请求 `sudo` 权限；不要用 root 身份执行第一条命令，否则浏览器会安装到 root 的缓存而不是当前项目用户的缓存。

精简系统若出现 `libnspr4.so`、NSS、ALSA 等动态库错误，不要逐个复制 `.so` 文件或把本机路径写入测试配置。用 `npx playwright install-deps --dry-run chromium` 检查完整依赖集合；安装后该命令应报告 `All system dependencies are installed.`。最后用不依赖应用服务的最小探针验证 Chromium 本身：

```bash
node --input-type=module -e 'import { chromium } from "@playwright/test"; const browser = await chromium.launch({ headless: true }); console.log(await browser.version()); await browser.close();'
```

## 如何选择测试层级

1. 无 I/O 的规则或格式化：写 `tests/lib` 或 `tests/agent` Node 测试。
2. Route Handler/服务编排，外部依赖可控：写 `tests/server`，只 mock 进程外边界或数据库适配入口。
3. 组件输入、提交、错误提示、键盘和 label：写 Testing Library 组件测试；HTTP 响应用 MSW。
4. 唯一约束、事务、级联、真实查询或数据库权限语义：写 Testcontainers 集成测试。
5. 跨页面、Cookie、重定向、浏览器渲染或核心用户旅程：写 Playwright。

一个缺陷可以同时需要低层回归测试和一条高层旅程，但不要重复断言相同实现细节。

低层测试覆盖规则组合、错误分支和边界输入；高层测试覆盖真实接线、关键旅程及该层独有的风险。例如首页过滤 Agent 日志，组件层验证列表与空态，真实 PostgreSQL 验证过滤发生在分页前且普通内容没有漏重，浏览器验证刷新、返回导航、搜索和加载更多后的实际呈现。它们保护不同边界，允许为同一个缺陷分别保留回归。

参数化可减少相同准备和断言模板，但每个参数场景应有可区分的标题和独立失败诊断。不要为压低测试数量把多个独立风险合成长流程；一个前置失败不应遮蔽本可独立验证的后续场景。

## 测试新增理由

新增或实质扩展测试时，在对应 feature 的验收或 evidence 中简短记录下列内容；文件较多时可链接该 feature 的长期证据。无需给全部历史用例补逐项登记表。

| 字段 | 应回答的问题 |
| --- | --- |
| 风险与期望 | 什么条件会失败，用户或调用方应观察到什么结果，影响哪个业务契约？ |
| 现有遗漏 | 哪个现有场景未覆盖该风险，本次扩展已有用例还是增加独立场景？ |
| 层级理由 | 为什么选择 Node、组件、真实 PostgreSQL 或浏览器；新增 E2E 还须说明浏览器或跨层独有风险？ |
| 位置与成本 | 覆盖文件/场景、实际验证命令与结果，以及新增执行成本和测量口径；未实测时写“待测”，不猜测增量？ |

新增理由示例：仅搜索到 Agent 日志时，首页应显示无匹配空态；已有混合列表测试遗漏纯日志结果，因此扩展组件场景验证空态。若新增 E2E，则另说明搜索输入、URL、真实 HTTP 和浏览器列表更新之间的接线风险，记录覆盖位置与命令；尚无可比前后采样时，成本写“待测”。该示例说明记录方式，不代表本轮新增了测试或测得性能。

## 测试迁移与删除

功能契约已移除、相同风险被可靠重复覆盖，或较低成本层级能完整承担原规则时，可以提出迁移或删除。长期通过、文件较长、耗时较高和数量增长本身不构成删除理由。正常契约变化应按新契约更新测试，不为维持数量保留失效断言。

每次变更需在对应 feature 的验收/evidence 中提供原风险到替代保护的映射：

| 字段 | 证明要求 |
| --- | --- |
| 原风险与用例 | 定位原文件、project 和完整参数化标题，列出触发条件、原期望及历史故障；契约移除时链接确认依据。 |
| 替代与保留边界 | 逐项指向替代用例及承担的风险，说明仍保留哪些高层旅程/真实边界；相同标题或断言数量不证明保护等价。 |
| 检测能力 | 历史回归应证明替代用例能捕获原故障，或用隔离故障注入证明它会失败、恢复后会通过；记录命令、结果和差异。 |
| 成本与门禁 | 记录可比执行成本变化或“待测”、相关定向测试及风险匹配门禁；证据不足时保留原用例并登记缺口。 |

先建立并验证替代保护，再调整原用例。故障注入只在一次性隔离副本中进行，恢复全部夹具和临时改动，不污染用户工作树或业务数据。实际迁移/删除按单 feature 验收；审查发现的新工作另行登记，不能顺带实施。

例如把浏览器里的分页参数组合迁移到真实 PostgreSQL：替代用例应在取消分页前过滤等原故障下失败，恢复后通过，并证明无漏重。浏览器仍覆盖实际搜索、加载更多和导航接线；这只支持迁移规则组合，不能证明可以删除整条旅程。数据库权限、事务、约束、级联或真实查询不能由 mock/源码扫描替代；Cookie、导航、水合、实际布局、SSE 重连、真实并发和关键用户旅程仍须有相应的真实浏览器保护。

不得以降低覆盖率门槛、扩大 exclude、skip、删除有效断言、固定 sleep、增加重试或放宽超时来实现减量或提速。用例替代与合并需证明风险保护保持，不能只对比数量。

## 耗时记录与软预算

预算是人工审查阈值，不新增硬超时或计时失败门禁。[测试治理计划](plan/2026-10-03-testing-governance.md) 定义 feat-111 的门禁初测和 feat-112 的生产 E2E 校准；采样与校准状态写入对应 feature 的长期证据，不足 3 份可比有效样本时预算保持待校准。

### 可比样本与记录口径

每份采样保留实际命令、退出码和下列脱敏信息，放入对应 feature 的长期证据；不要记录凭据、连接串或真实用户载荷。

| 类别 | 必需信息 |
| --- | --- |
| 环境 | OS/架构、Node/npm、实际浏览器与数据库版本、CPU/可用并行度、总内存及可获得的资源占用、其他负载、worker 配置。 |
| 源码与配置指纹 | Git revision 和包含未提交修改的待测源码内容摘要；锁文件、runner/config、scripts、fixture/support 的摘要，以及影响运行的非敏感环境配置。仅记录 HEAD 不足以识别当前工作树。 |
| 用例指纹 | runner 项目、选择范围、文件和完整参数化标题组成的集合摘要及文件/用例数；默认配置与 CLI 覆盖分别记录，不能仅用总数判断集合相同。 |
| 应用设置 | development/production、构建与启动主题、locale/timezone、软/硬件 WebGL、隔离数据库/上传目录的准备方式，以及缓存/准备是否包含在计时内。 |
| 结果与时长 | 样本 ID、时间、命令及退出码，各层/阶段和整轮墙钟耗时、可获得的单项耗时；应运行/通过/失败/跳过/重试数量、首次错误及后续诊断分别记录。 |

同组样本必须具有可核对的一致环境、待测源码、配置与用例集合；不同条件的数据分组展示。优化前后比较应保持无关条件和集合一致，单独指出本次有意变更及其指纹，不把两版混为一个基线。无法取得的资源或阶段细分写“未采集”，不能推断成本来源。

从命令启动到准备、构建、测试及清理完成统计整轮墙钟时间；runner 报告的阶段/单项时长另记。普通 Vitest、覆盖率 Vitest、check:quick、check、PostgreSQL、生产 E2E 分别统计，setup 与业务用例分开。并行用例耗时之和不能冒充整轮墙钟，只有 runner 业务时长时不得声称已经测得准备/构建/清理成本。

有效完整样本要求所有应运行用例通过、无 skip/retry，且隔离资源清理完成；性能采样轮显式关闭重试，生产 E2E 保留现有单 worker、隔离数据库、独立构建及构建/启动主题差异验证。当前 Playwright 的 CI 默认重试为 2、本地为 0，记录默认与采样覆盖的区别，不改默认配置。失败或环境受阻样本保留原命令与错误，计入可靠性记录，不计入通过样本中位数；重试后的通过不能覆盖首次失败。局部筛选或重复单项用于定向诊断，不替代全量有效样本。

### 初始审查阈值

B 是同一口径至少 3 个有效样本的中位数。记录样本数及最小/最大值；不足 3 个可比样本时只报告初测值并标为“待校准”，不报告稳定分位数。三个样本只支持初始中位数和范围，不证明长期零偶发失败。

| 对象（分别建基线） | 超过时触发人工审查 | 校准来源 |
| --- | --- | --- |
| 普通 Vitest / 覆盖率 Vitest | B + max(B × 20%, 5 秒) | feat-111 初测，后续正常验证积累 |
| check:quick / check | B + max(B × 20%, 30 秒) | feat-111 初测，后续正常验证积累 |
| PostgreSQL 集成测试 | B + max(B × 20%, 30 秒) | 可核对的正常完整门禁样本 |
| 全量生产 E2E | B + max(B × 20%, 60 秒) | feat-112 的 3 份完整样本 |
| E2E 单项 | B + max(B × 20%, 2 秒)，或进入业务项耗时前 10 名 | feat-112 按单项中位数排序；第 10 名并列纳入，setup 单列 |

示例：若 check 的有效样本中位数 B 为 100 秒，则超过 130 秒触发审查。这只是公式示例；表中的比例和缓冲是初始项目规则，不是实测结论。历史单次 14.4 分钟或 feat-109 的 13.9 分钟缺少足够可比样本，不能作为当前稳定预算。

超阈值后核对新增风险、准备/构建成本、等待方式和资源争用，记录保留理由、独立优化任务或重新校准预算的依据；不能据此自动删用例、更新基线掩盖退化或宣称固定提速比例。为解决明确对照问题才进行性能复测，不为凑统计重复整套完整门禁。

### 日常反馈与收尾门禁

日常迭代先运行相关定向测试，收尾仍按 [AGENTS.md](../AGENTS.md) 执行风险匹配门禁。`check:full` 已包含 `check`，在代码、环境和配置没有新增变化且没有未决失败时，无需再单独重复标准门禁；这不免除代码会话的 `init.sh` 快速基线和必要的失败复核。生产 E2E 的独立构建仍验证隔离环境与主题差异，不能把它视为普通 build 的重复而删除。

仅修改文档/状态、未修改代码、依赖、构建或运行配置时，采用 AGENTS.md 的纯文档例外：核验 JSON、单 feature 状态与全局依赖、计数、链接、归档完整性及 diff/status，更新证据并重写交接，清理本轮临时工件；记录未运行 `./init.sh` 和应用门禁的原因。文档核验不代表应用测试或构建通过。

## 编写规则

- 断言用户或调用方可观察的输入、输出、状态和副作用；不得读取源码字符串来证明行为存在。
- 优先使用角色、label 和可见文本查询组件；不要依赖 CSS class、组件实例或私有 state。
- `user-event` 模拟真实交互；仅在底层事件本身是被测对象时使用 `fireEvent`。
- MSW 负责 HTTP 边界；`vi.mock` 只用于时间、随机性、第三方 SDK、Prisma 入口等明确边界。
- 每个测试自行设置所需环境变量、时间和 mock，并在结束后恢复；禁止依赖文件执行顺序。
- 组件测试的全局替身（`vi.stubGlobal`）由共享收尾 `tests/setup/component.ts` 在 `cleanup()` 之后统一恢复；测试文件不要在自己的 `afterEach` 里调用 `vi.unstubAllGlobals()`。文件级 hook 先于共享 `cleanup()` 执行，卸载会同步冲刷待执行的被动效果，提前恢复会让卸载阶段（如 `useScrollReveal` 构造 `IntersectionObserver`）抛 `ReferenceError`。
- 集成测试在每项测试前清空业务表；E2E 使用临时数据库、临时上传目录和非敏感固定账号。
- 可选供应商 SDK 不得因模块导入而访问系统或网络；本地 provider 的导入必须能在 SDK 不可用时工作。
- 异步交互使用 `findBy*` 或 `waitFor`，不得用固定 sleep 掩盖竞态。
- 缺陷修复的测试名称应描述失败场景及期望行为，并确保它在修复前可失败。

## 覆盖率策略

覆盖率只阻止回退，不等同于测试质量。门槛统计 `agent/**/*.ts`、`app/api/**/*.ts` 和 `lib/**/*.ts`，排除声明文件、独立 Worker 入口和 Prisma 单例。提高门槛前先补关键风险路径，尤其是认证、权限、Agent Runtime 和尚未覆盖的 Route Handler；不得通过扩大 exclude、无意义断言或只调用不验证来刷覆盖率。

## 交接要求

在 `feature_list.json` 和 `session-handoff.md` 中记录实际运行的命令、测试数量、覆盖率和失败原文摘要。若 Docker、网络或外部服务导致某层未运行，应把该层标为未验证，而不是把静态检查或 mock 测试写成它的替代证据。
