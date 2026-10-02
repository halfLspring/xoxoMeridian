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
- `npm run check:quick`：类型检查、ESLint、Vitest。
- `npm run check`：快速门禁、生产构建和覆盖率。
- `npm run check:full`：标准门禁、集成测试和发布形态 E2E（即 `npm run test:e2e:production`）。

集成测试和本地 E2E 要求 Docker daemon 可用；缺少运行时必须失败并明确提示，不得自动 skip。若验证已在外部环境运行，可通过 `PLAYWRIGHT_BASE_URL` 让 Playwright 连接指定服务，此时服务的数据准备与隔离由该环境负责。

Vitest 的受支持并发配置由 `vitest.config.ts` 的 `maxWorkers` 声明：最多 8 个 worker，且不超过 `os.availableParallelism() - 1`。全量峰值内存近似线性于 worker 数（每 worker 约 160MB），默认的 `cpus - 1` 会让测试进程集占用宿主大部分内存，使首个"在测试体内动态导入 Route"的用例在默认 5000ms 单项超时下失败（见 `feature_list.json` 的 feat-066 条目）。不得靠放宽单项超时或跳过用例掩盖该边界；需要更宽并发时改配置并重新测量内存预算，不要在环境里长期导出 `VITEST_MAX_WORKERS`——该变量会覆盖包括集成配置 `maxWorkers: 1` 在内的所有项目设置，破坏集成测试的串行隔离。

浏览器层的应用模式同样由配置声明，而不是交给宿主余量决定。`tests/e2e/support/app-mode.ts` 的默认值是 `development`，`npm run test:e2e` 保留它，便于本地迭代免构建地拿到开发期诊断；`npm run check:full` 走 `test:e2e:production`。原因是开发模式的服务端占用既无上界又由宿主推导：`next dev` 在未显式给出 `--max-old-space-size` 时按 `os.totalmem() * 0.5` 推导堆上限，并按需编译每个访问到的路由且不卸载（Next 自身 memory-usage 文档说明：全部页面最终被请求后，占用与是否预加载无关）。实测一次完整开发浏览器序列把测试服务推到 RSS 约 2.8GB（堆 366MB→2039MB，上限 3939MB），叠加 Chromium 与 runner 后浏览器层需要约 3.5–4GB；在 7.8GB 宿主上与既有工作负载相加后换页被大量占用（已记录的轮次里 2GB swap 用满、available 低至 366MB），任何延迟有界的断言都可能失败，且每轮失败的用例不同、单独运行又通过（见 `feature_list.json` 的 feat-068、feat-069 条目）。开发模式另有两个只属于它的失败源：Next 的内存看门狗（`server/lib/utils.js` 的 `getMemoryRestartStats` 仅在 `isDev` 时安装，堆超过上限 80% 会以 `RESTART_EXIT_CODE` 原地重启服务）和 `react-dom-client.development.js` 的 User Timing 插桩——它对未记录起始时间的组件发出负时间戳的 `Performance.measure`，作为未捕获异常被 `observeEntry` 的 `pageerror` 断言捕获，而该代码只存在于开发包。生产形态下占用有界、错误面不含开发期插桩噪声，并且校验的是生产构建产物（由 E2E harness 自行构建，构建主题与启动主题故意不同，用于覆盖运行时主题切换）。不得用放宽断言、跳过用例或放大超时来掩盖开发模式的这道边界；需要开发期覆盖时显式运行 `npm run test:e2e` 或定向 `--grep`，并将其记为诊断结论而不是门禁结论。

本地 E2E harness 会把临时 Testcontainer 连接串以 `0600` 权限写入 `test-results/.e2e-database-url`，仅供浏览器生命周期用例推进隔离测试数据，并在测试服务关闭时删除。使用 `PLAYWRIGHT_BASE_URL` 连接外部隔离环境时，需同时通过 `E2E_DATABASE_URL` 提供该服务对应的测试数据库；不得指向开发、预发布或生产数据库。

`tests/e2e/blog-user-boundary.spec.ts` 用隔离账号的已知字段值检查 Blog、普通文章详情、新建、编辑和 Study 的首次 HTML，以及点击页面链接产生的真实 Flight 响应。用例关闭 trace、截图和视频，只把字段是否出现的布尔值交给断言；Flight 在浏览器的真实 `fetch` 响应上使用 `Response.clone()` 读取副本，原响应原样交还应用，避免依赖 Chromium 调试接口的响应缓存。只检查完整点击导航响应，预取不作为验收替代。不得把真实账号凭据或完整 HTML / Flight 写入测试日志、附件和报告。重放发布形态验证可运行 `npm run test:e2e:production -- tests/e2e/blog-user-boundary.spec.ts`，它也包含于 `check:full`。

`tests/e2e/blog-presentation.spec.ts` 用相同中英文、Markdown、作者快照和 352px 可用宽度比较普通 Post 与作品卡片的浏览器计算样式，验证 300 字符/4.875rem 摘要、键盘阅读全文、全文编辑、草稿发布、其他用户权限及窄屏刷新。三类连线读取实际 SVG 样式和屏幕端点，覆盖拖动、旋转、滚动、缩放、裁切相切与隐藏恢复；组内 SVG 在场景缩放外绘制，和页面连线共用屏幕 CSS 像素。卡片高度变化须触发真实布局更新，数据库中的全文、图片位置及场景几何不因摘要展示改写。重放使用 `npm run test:e2e:production -- tests/e2e/blog-presentation.spec.ts`；精确筛选时使用 `E2E_APP_MODE=production npx playwright test tests/e2e/blog-presentation.spec.ts --grep '用例名称'`，避免嵌套 npm 命令消耗筛选参数。

双标签页草稿冲突的 `draft-loading-events` 通过 `tests/e2e/support/response-diagnostics.ts` 同步记录请求、响应头、正文完成、网络失败、页面异常和清理时序。依据 [Playwright 请求生命周期](https://playwright.dev/docs/api/class-request)，正文完成使用 `requestfinished`；诊断监听不得异步等待 `response.finished()`，因为页面关闭会拒绝已经开始的等待，仅移除监听无法收束该 Promise。用例在 `finally` 中逐个移除自己的监听后保存附件，业务 HTTP 状态、JSON 与冲突断言仍直接等待并报告错误。`tests/e2e/response-diagnostics.spec.ts` 用真实 Chromium 和随机本机端口的 HTTP 流控制正文交付，覆盖关页、关闭上下文、先移除监听再关页，以及正常正文、409/503、网络截断和无效 JSON/页面异常。连续生产回归使用 `LANG=en_US.UTF-8 TZ=UTC E2E_APP_MODE=production E2E_SOFTWARE_WEBGL=true ./scripts/run-node22.sh npx playwright test tests/e2e/blog-drafts.spec.ts tests/e2e/response-diagnostics.spec.ts --project=authenticated --grep '双标签页同字段冲突|响应诊断' --repeat-each=3 --retries=0 --trace=on`，不以固定 sleep、重试或放宽超时代替事件同步。

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
