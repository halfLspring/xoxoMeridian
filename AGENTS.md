# AGENTS.md

## 项目概览

XOXO Meridian 是一个面向私密双人空间的 Next.js 15 全栈应用，提供认证、聊天、博客、空间画布、专注学习和独立 Agent Runtime。
应用采用 TypeScript、App Router、Prisma 与 PostgreSQL；Web、数据库初始化器和 Agent Worker 可通过 Docker Compose 协同部署。

## 快速开始

### Startup Workflow（首次运行）

- 前置环境：Node.js 22、npm、Docker 与 Docker Compose。
- 版本契约：`.node-version` 固定 Node.js 22.23.2，`package.json` 固定 npm 10.9.8；PATH 被权限边界清理时通过 `./scripts/run-node22.sh <command>` 恢复并校验工具链。
- 安装锁定依赖：`npm ci`
- 创建本地配置：`cp .env.example .env`，填写必需配置且不得保留生产用占位密钥。
- 启动数据库：`docker compose up -d postgres`
- 应用迁移并写入初始数据：`npm run db:deploy && npm run db:seed`
- 建立快速验证基线：`./init.sh`
- 启动 Web：`npm run dev`
- 当 `AGENT_TASK_INLINE_RUN=false` 时，在另一终端运行：`npm run agent:worker`

开始工作前依次阅读 `AGENTS.md`、`feature_list.json` 和 `session-handoff.md`；状态文件按需提取当前总览、未完成任务和所选任务的完整验收/证据，不把当前批次所有 done 正文或历史归档批量载入上下文。确认所选 feature 的依赖与验收标准后，只把它标为 `in-progress`，再运行 `./init.sh`；纯文档/状态整理适用下述门禁例外。

### 状态文件与批量归档

- `feature_list.json`：保留全部未完成项和当前批次的全部 `done`，含状态、依赖、优先级、完整验收与简短证据。顶层 `featuresNumber` 始终等于根 `features` 数组长度，包含全部状态、不包含归档；新增任务或将条目移入/移出根列表时同步更新，只变更状态时不变。`archivedFeatureFiles` 指向此前批次，查询旧 ID 或依赖时只提取目标条目。
- `session-handoff.md`：仅服务相邻两次会话，每轮任务结束均重写，只保留下一会话需要的当前进展、风险、验证摘要、恢复路径与唯一下一步；不追加、不归档、不保留历史版本。长期证据和约定写入 `feature_list.json` 或项目文档，不依赖交接文件追踪。
- 归档先看 `featuresNumber`：不超过 40 时直接跳过；超过 40 时才统计根列表的 done，仍须 **超过 40 个 done（即至少 41 个）** 才触发。一次归档本批全部 done 条目及其验收证据，未完成任务及其必要证据留在根文件；同步将 `featuresNumber` 更新为剩余条目数，不强制归零。交接文件不参与归档。
- 取消按字节数设置的归档限制与文件预算；不因文件体积、单次任务完成、会话次数或日期创建零散归档。收尾按上述计数字段判断是否归档，并核对记录完整性与引用；不得丢弃未完成验收、失败证据或未决约定。格式、检索和批量归档步骤见 [Harness 维护说明](docs/harness/README.md)，仅在维护或查历史时读取。

### 验证门禁

- 快速门禁：`npm run check:quick`（类型、lint、Node/组件测试）。
- 标准门禁：`npm run check`（快速门禁、生产构建、覆盖率基线）。
- 完整门禁：`npm run check:full`（标准门禁、真实 PostgreSQL 集成测试、Playwright E2E；要求 Docker）。
- 纯文档/状态整理沿用用户约定：未修改代码、依赖、构建或运行配置时，不必运行 `./init.sh` 或应用测试/构建；只核验 JSON、状态/依赖、链接、归档完整性、涉及变更的计数字段及 diff/status，并记录未运行命令和原因。此例外只验收文档工作，不代表应用门禁通过。
- 权限型复核：若受限沙箱中的 Node 子进程出现 `EPERM`、空 stdout 或 Next.js `Could not parse output from TypeScript's --showConfig`，须用同一 Node 版本在获准的正常权限边界重跑原命令；仅当对照仍失败时才视为代码阻塞，并记录两次原始结果。
- Docker 组复核：需通过临时 `docker` group 执行 npm 命令时使用 `sudo -n -g docker -u dadalv ./scripts/run-node22.sh npm ...`，不得依赖 sudo 的 `secure_path` 或逐次手写 PATH。
- 部署重启：先运行 `docker compose build web agent-worker init`，再运行 `docker compose up -d`。

### Stay in Scope（范围边界）

- One feature at a time：一次只实现一个 feature，不隐式扩大其验收标准；新发现的工作必须登记为独立 feature。
- 状态只允许 `not-started`、`in-progress`、`blocked`、`done`；依赖未完成时不得开始下游 feature。
- 全量 feature = 根列表与 `archivedFeatureFiles` 中的条目；ID 全局唯一且不复用，新 ID 取两者最大编号加一。根列表是当前状态入口；归档只含 `done`，历史日志中的状态/下一步不覆盖它。开始实现前核对跨归档依赖；重新打开旧项时须先移回根列表，不能双份登记。

### Definition of Done（完成定义）

- Feature 只有在验收标准满足、相关门禁通过、验证范围与证据写入 `feature_list.json` 后才能标记为 `done`；文档例外按上述结构核验验收。证据写命令、结果与详情路径，归档时保留完整记录。
- 无关的既有检查失败时，记录原始失败并保持当前范围，不得用扩大改动范围换取“全绿”。

### End of Session（会话结束）

- Before ending，更新 feature 状态、改动/验证/阻塞证据和 `featuresNumber`，并重写 session-handoff 为面向下一会话的恢复说明；长期证据在 `feature_list.json` 或项目文档中保留。归档只处理 feature，先写历史并核验再缩减根文件，不备份旧交接。
- 保持仓库 restartable：不得留下半写入状态；交接中的 clean restart 路径必须能由下一会话直接执行。

## 会话退出检查清单

代码会话只有以下五项全部满足，才可称为“完成”或“清洁退出”；未运行、失败或因环境受阻的项目必须在 `feature_list.json` 和 `session-handoff.md` 中记录原始命令、结果与原因，并不得称为完成。纯文档/状态会话按门禁例外验收，仍须完成状态记录、归档核验与工件清理。

- [ ] 构建通过：至少执行 `npm run check`；涉及数据库、认证、关键旅程或部署时执行风险匹配的 `npm run check:full` 或 `npm run test:compose-smoke`。
- [ ] 测试通过：相关 Node、组件、集成和 E2E 测试均已通过；不得以低层 mock 替代应有的真实 PostgreSQL 或浏览器验证。
- [ ] 状态已记录：`feature_list.json` 和 `session-handoff.md` 已写入状态、改动、验证证据、阻塞与唯一推荐下一步。
- [ ] 临时工件已清理：清除本会话创建且不需交接的临时目录、测试数据、隔离容器/网络/卷/镜像和测试报告；运行 `git diff --check` 并检查 `git status --short`，但不得删除既有用户改动。为诊断保留的失败日志意味着会话应标为 `blocked`，不属于清洁退出。
- [ ] 启动路径可用：`./init.sh` 成功建立快速基线；如改动启动或部署路径，还须验证相应的 `npm run dev` 健康端点或 Compose 启动路径。

## 硬约束

1. 所有仓库相关的助手回复、进度记录和交接说明必须使用中文；代码标识符、协议字段和第三方专有名词除外。
2. 统一使用 Node.js 22 与 npm；安装必须以 `package-lock.json` 为准，依赖变更必须更新锁文件并复查 `npm audit`，生产 high/critical 漏洞必须修复或在交接中记录风险、原因和升级计划。
3. 使用严格 TypeScript、ES Modules 和 `@/*` 路径别名；沿用两空格缩进、双引号和分号，不新增无必要的 JavaScript 文件。
4. `app/` 只承载页面、布局和路由入口，`components/` 承载 UI，`lib/` 承载共享领域/服务逻辑，`agent/` 承载 Agent 编排与工具；路由处理器不得成为业务逻辑百科全书，`cookies()`、`headers()`、动态 `params` 与 `searchParams` 必须异步读取。
5. 受保护页面和 API 必须通过 `lib/auth.ts` 的认证入口；房间、任务和用户资源还必须执行成员资格或所有权校验。
6. 所有不可信输入必须先经过 `lib/validation.ts` 或同域 Zod schema 校验，不得把原始请求体、查询参数或工具输入直接交给 Prisma 或外部服务。
7. 数据库访问统一复用 `lib/prisma.ts`；模型变更必须同时更新 schema 和新增时间戳迁移，不得修改或删除已应用迁移，并保持 `prisma migrate deploy` 与 `init` 容器兼容。
8. 密钥和环境差异只能通过环境变量提供；不得提交 `.env`、凭据、令牌、真实用户数据或包含敏感载荷的日志。
9. 对象存储、邮件、天气、搜索和 LLM 必须通过适配层访问；可选供应商 SDK 必须惰性加载，测试不得依赖真实网络、真实凭据或开发机状态。
10. Agent 只能执行 `agent/tool-registry.ts` 注册且经过输入校验和 tracer 记录的工具；Docker 部署必须由 `agent-worker` 消费任务，内联执行仅限明确配置的本地开发或测试。
11. 新增或修改的交互控件必须可由键盘操作并具有可访问名称；表单字段必须绑定可查询的 label，lint 例外必须局部说明原因。
12. 测试必须验证可观察行为而非源码字符串或内部实现细节；Node、组件、集成和 E2E 测试必须按目录分层，并隔离 mock、时间、环境变量和数据库状态。
13. 缺陷修复必须带回归测试；数据库约束/级联/权限语义使用真实 PostgreSQL 集成测试，关键用户旅程使用 Playwright，不能用 mock 或源码扫描替代对应层级。
14. 声明完成前必须运行与风险匹配的门禁并记录证据；失败或因 Docker、网络等环境条件未运行的检查必须写明原始命令与原因，不得声称“全部通过”。
15. 保留与当前任务无关的用户改动；不得擅自恢复删除文件、覆盖未提交内容、删除已应用迁移或执行破坏性 Git 操作。

## 专题入口

- [产品与总体架构](README.md) — 首次理解产品边界、主要数据流或本地运行方式时阅读；若与代码冲突，以当前代码和配置为准。
- [项目模块视图](PROJECT_VIEW.md) — 划分 QAM 模块质量责任边界、定位代码归属或审查跨模块耦合与边界不确定项时必读。
- [脚本与依赖](package.json) — 运行命令、添加依赖或调整 Node 工具链时查阅。
- [环境变量模板](.env.example) — 新增配置、接入外部服务或准备本地/生产环境时必读。
- [Docker Compose 拓扑](docker-compose.yml) — 修改 PostgreSQL、初始化器、Web、Worker、卷或部署顺序时必读。
- [容器构建定义](Dockerfile) — 修改 Node 版本、构建产物、运行用户或 Web/Worker 镜像时必读。
- [数据模型](prisma/schema.prisma) — 修改持久化模型、关系、索引或枚举时必读。
- [数据库迁移](prisma/migrations/) — 设计 schema 变更、检查部署兼容性或排查迁移问题时必读。
- [API 路由](app/api/) — 添加或修改端点、认证、权限、缓存、SSE 或错误响应时查阅。
- [认证与访问控制](lib/auth.ts) — 修改会话、Cookie、登录态或受保护资源访问时必读；房间权限同时查阅 `lib/access.ts`。
- [输入校验](lib/validation.ts) — 新增请求字段、表单、路由参数或工具输入时必读。
- [Agent Runtime](agent/) — 修改计划、任务调度、上下文、追踪、Worker 或模型调用时查阅。
- [Agent 工具注册表](agent/tool-registry.ts) — 添加、删除或授权 Agent 工具时必读。
- [测试标准](docs/testing-standards.md) — 选择测试层级、编写测试、调整覆盖率或排查 Testcontainers/Playwright 时必读。
- [Vitest 配置](vitest.config.ts) — 修改 Node/jsdom 项目、setup、别名或覆盖率门槛时必读。
- [Playwright 配置](playwright.config.ts) — 修改浏览器项目、认证状态、Web Server 或 E2E 产物时必读。
- [功能状态](feature_list.json) — 开始工作前选择一个未完成特性并核对依赖与验收标准。
- [会话交接](session-handoff.md) — 恢复工作时查看当前状态、可复现命令和唯一推荐下一步。

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
