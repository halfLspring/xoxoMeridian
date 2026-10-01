# 全局 Agent 私聊弹窗与轻量互动修改计划

## 1. 状态与目标

- 日期：2026-09-22。
- 关联任务：`feat-080`，实现状态为 `done`；已按本计划完成实现与门禁，执行证据见 [feat-080 验收证据](../../feature_list.json)。
- 用户已确认反馈形式：**3D 弹跳／前倾＋头顶表情符号＋HTML 台词气泡**，脸部资产以后再补。
- 目标：点击页面小人时，就地打开只有当前用户与 Agent 的专属对话弹窗；页面 URL 保持不变，小人保持显示，点击动作和台词完整呈现。
- `/chat` 与 `/chat/[roomId]` 继续承载现有双人共享聊天。私聊拥有独立消息、任务上下文与记忆，不通过隐藏另一位成员来伪装隔离。
- 本文是实施设计；第 9–10 节列出验证要求，实际执行证据以 `feature_list.json` 的 feat-080 条目 为准。第 12 节记录本轮计划复核。

## 2. 实施范围与边界

弹窗、保留小人及反馈形式已由用户确认。每用户一个持久会话、专属 Room 和轮询方式是本计划提出的实现选择。

### 本次交付

1. 独立的当前用户—Agent 私聊弹窗，包括历史消息、发送、Agent 回复、处理中／失败提示及工具审批。
2. 每个用户一条持久的默认 Agent 私聊会话；刷新或关闭后重新打开，读取同一会话。
3. 复用 `life-assistant`、既有 `AgentTask`、工具注册表、预算、租约、审批和 Worker，不另建 LLM 调用链。
4. 默认模型的欢迎、关注、点击三种短动作，以及本地台词和情绪符号；默认待机静止。
5. 弹窗打开／关闭时保留同一个模型实例与 Canvas，不通过切路由或重新挂载播放反馈。
6. 键盘、触摸、窄屏、减少动态效果、身份失效和加载失败等完整入口行为。

### 范围边界

- 生日主题不新增动作或表情资产；共用入口的点击目的地改为私聊弹窗，现有主题配置及静态模型继续兼容。
- 保留非 `/chat` 页显示入口的现有 Gate；访问 `/chat` 时仍卸载入口，不在双人聊天内再叠加第二个聊天入口。
- 本轮不增加拖拽定位、静态姿态库、骨骼蒙皮、脸部变形、语音或口型同步。
- 不增加多人私聊、会话列表、会话重命名、清空历史、旧消息分页或人设编辑页面。首版读取最近 80 条，完整历史仍持久化。
- 头顶情绪符号明确属于界面反馈，不称为模型脸部表情变化。
- 不导入共享房间的消息、记忆或伙伴档案。私聊产生的备忘录、计划和记忆属于该私聊范围；共享房间现有数据继续由 `/chat` 管理。

### 资源与职责

- 本轮无需用户补充模型资产，直接复用当前默认 GLB；程序化动作、情绪符号、台词、私聊服务与弹窗均由编码助手实现并验证。
- 用户可调整台词和角色语气，但不作为实现前置条件；先采用本计划中的短句。
- 真实脸部表情留待独立任务：届时再明确脸部结构与资产交付要求，本轮不预设已有可切换的脸部能力。

## 3. 实施前基线（计划阶段）

| 位置 | 当前事实 | 修改含义 |
| --- | --- | --- |
| [AgentEntry](../../components/agent-entry/AgentEntry.tsx) | 点击调用 `router.push("/chat")`，只有悬停／按下缩放和 tooltip | 改为本地开窗，同时派发点击反馈 |
| [AgentEntryGate](../../components/agent-entry/AgentEntryGate.tsx) | 非 Chat 页面认证后动态加载，只保存认证布尔值；失败时卸载 | 改为绑定用户 ID，覆盖 Cookie 换号仍返回 200 的情况 |
| [AgentEntryScene](../../components/agent-entry/AgentEntryScene.tsx) | `createRoot`、按需渲染、手动首帧确认；effect 依赖模型实例与配置 | 行为更新不能改变初始化依赖或重建 WebGL |
| [AgentEntryModel](../../components/agent-entry/AgentEntryModel.tsx) | 在 R3F 根外加载并克隆模型 | 加载层保持职责，帧动作控制放在 Scene 内 |
| [主题注册表](../../components/agent-entry/agent-entry.registry.ts) | default／birthday 各一份 GLB，动画和形态键能力为空 | 默认主题补动作／台词配置，保留现有 GLB |
| [消息服务](../../lib/messages.ts) | 人类消息、AgentTask 与 created 事件在事务内派生 | 私聊发送复用此原子边界，服务端强制触发 Agent |
| [房间列表](../../lib/room-list.ts)、[访问控制](../../lib/access.ts) | 当前所有成员关系都被当作共享房间 | 增加房间用途后，显式区分列表、默认选择与授权 |
| [Study 房间选择](../../lib/study.ts) | `getStudyRoomForUser()` 独立选择最早成员关系 | 必须单独增加共享筛选，不能只修改通用默认房间函数 |
| [房间生命周期](../../lib/room-lifecycle.ts) | 删除前在用户行锁下统计成员关系，禁止删除最后一个房间 | 计数必须只包含共享房间，私聊不能解除该限制 |
| [Agent 上下文](../../agent/context-builder.ts) | 按 roomId 读取消息、记忆、备忘录、计划和参与者档案 | 私有 Room 可以复用现有上下文，但必须保证只有 owner |
| [身份配对](../../lib/participant-resolution.ts) | 单一参与者时 `partner` 为 null | 不虚构第二位人类参与者 |
| [时间线投影](../../lib/agent-posts.ts) | 有工具调用的已完成任务可能派生 `agent_log` | 私聊需跳过自动投影并记录投影决策已完成 |
| [Post 可见性](../../lib/post-visibility.ts) | Agent 日志当前按房间成员过滤 | 既有规则不意味着伙伴可读私聊；跳过投影是进一步分离产品入口 |

实际依赖为 Next.js 16.3.3、React 19.2.8、Fiber 9.7.0、Drei 10.7.8、Three.js 0.185.1 和 Motion 12.40.0。无需新增渲染、状态机或对话框依赖。旧设计文档中的历史安装状态以当前源码和锁文件为准。

## 4. 数据隔离与后端设计

### 4.1 使用专属私有 Room 复用 Runtime

在现有 `Room` 上增加用途和唯一所有者，而不是新建一套与 AgentTask 脱节的消息表。

```text
用户 A ── 专属 Room A（agent_private）── A 的消息／任务／记忆
用户 B ── 专属 Room B（agent_private）── B 的消息／任务／记忆
A 与 B ── 既有 Room（shared）──────── 双人消息／任务／记忆
                    │
        共用 life-assistant 与同一 Agent Worker
```

拟新增的数据契约：

| 模型／字段 | 约束 |
| --- | --- |
| `RoomKind` | `shared`、`agent_private` |
| `Room.kind` | 默认 `shared`，既有记录保持共享语义 |
| `Room.privateOwnerId` | 可空、唯一、关联 User；共享房间必须为空，私聊必须存在 |
| `Room.maxHumanUsers` | 私聊固定为 1；只作为辅助约束，不能替代所有权校验 |
| `User.agentConversation` | 对应唯一专属 Room 的反向关系 |
| `Message.clientMessageId` | 可空；私聊发送使用客户端生成并经 Zod 校验的请求标识 |
| 消息唯一约束 | `(roomId, senderId, clientMessageId)`；兼容未提供标识的既有消息 |

新增时间戳迁移：保留既有迁移；对房间用途、owner 和人数上限增加 CHECK 约束，owner 采用外键。owner 删除时级联删除其私聊及既有 Room 子数据，shared 数据沿用原有规则。迁移需同时验证旧数据升级与空库部署。

私聊首次发送时，在事务中建立 Room 与唯一 owner 成员关系；以 owner 唯一键处理多标签并发，冲突后在失败事务退出后读取或重试，不能在已被 PostgreSQL 中止的事务内继续查询。读取及上下文构建校验私聊成员与 owner 一致；异常成员集合拒绝使用，不能把非 owner 的资料带入模型。普通房间创建逻辑不得创建或增加私聊成员。

### 4.2 专用接口

| 接口 | 行为 |
| --- | --- |
| `GET /api/agent/conversation` | 从当前会话用户解析专属 Room，返回私聊快照；不存在时返回空状态，GET 不创建数据库记录 |
| `POST /api/agent/conversation/messages` | 校验 `{ content, clientMessageId }`，确保专属 Room，原子创建消息＋AgentTask＋事件，返回接受结果 |
| 既有 `.../tasks/[taskId]/approvals` | 沿用审批入口，由任务所属私聊 Room 校验 owner；弹窗内完成批准或拒绝 |

接口统一使用 `requireCurrentUser()`、同域 Zod schema、`lib/prisma.ts`、既有限流和 `errorToResponse()`。私聊接口不接收用于选择资源的 `userId`、`roomId`、`agentId` 或 `forceAgent`，这些全部由服务端确定。内容沿用现有 4000 字符上限，空白和异常类型在写库前拒绝。

私聊读取、发送以及私聊任务审批携带经 schema 校验的 `X-Agent-Viewer-Id` 身份前置条件。服务端只将其与本次 `requireCurrentUser()` 得到的用户 ID 比较，不用它选择用户或房间；缺失则拒绝私聊请求，不匹配返回 401 且不写数据。比较必须先于建房、幂等接受、任务派生与审批决策。这样另一标签把 Cookie 从 A 换成 B 时，A 的旧草稿也不能写入 B 的会话。共享任务审批保持现有兼容契约。客户端收到不匹配后清空并重验入口，不调用注销接口破坏 B 的有效会话。

私聊 API 的成功与错误响应均调用现有 `lib/api.ts` 的 `applyNoStoreHeaders(response.headers)`，明确包含 `private, no-store`、CDN 禁缓存和 `Vary: Cookie`；弹窗消费的任务／审批响应同样禁止缓存。客户端读取显式使用 `cache: "no-store"`。不依赖 Next.js 默认行为或当前未覆盖 `/api/agent/` 的 Proxy 路径规则来提供隐私缓存契约。

返回专用、最小化的快照：当前用户 ID 与展示资料、Agent 名称／可用状态、最近 80 条按 `(createdAt, id)` 排序的消息、任务状态和待审批项。消息与接受结果提供消息 ID、`clientMessageId` 和关联 task ID，供客户端合并和重试。只包含当前用户和 Agent 两种消息角色；系统错误以状态提示呈现，不增加第三种聊天参与者。不要直接返回整个共享 `RoomSnapshot`、所有房间列表、完整 User、原始任务错误或 LLM／工具 Trace。

同一 `clientMessageId` 的重试先核对已接受记录，返回原消息与原任务，不重复触发 Agent；相同标识却提交不同内容返回 409。共享聊天未传入该字段时保持原语义。新请求遇到 Agent 不存在或禁用时返回稳定的不可用响应，不写入一条永远不会得到处理的请求。

### 4.3 共享入口的隔离修正

以下查询必须显式按用途收敛：

- `listRoomsForUser()`、`getDefaultRoomForUser()` 只返回 `shared`；同时修改 `lib/study.ts` 的独立 `getStudyRoomForUser()`，让 Study 页面、presence、start 和 goals 也只选择共享房间。
- `/api/rooms` 创建时寻找伙伴，只依据共享房间成员关系。
- `/chat/[roomId]` 服务端拒绝把私聊渲染为 `ChatApp`，跳回合法共享入口。
- `deleteRoomPreservingUserMembership()` 在既有用户行锁内只统计共享成员关系；拥有私聊也不能删除最后一个共享房间。共享房间删除入口不承担私聊删除功能。
- 共享聊天的房间、消息、SSE 和生活数据入口明确限定共享用途；专属快照走私聊服务。复用底层领域函数，不直接复用整个双人 Chat 页面。
- `assertRoomAccess()` 等底层授权入口识别私聊 owner；任务详情、dispatch、trace、run、approval 等路径必须覆盖私聊越权测试，不能仅依靠 UI 隐藏。
- `/api/agent/status` 当前聚合用户所有房间；保留其共享入口语义，排除私聊，私聊状态由专用快照返回。

### 4.4 Runtime、工具与派生副作用

- 私聊消息采用独立触发模式，由服务端强制派生任务，用户无需输入 `@小助手`。不能直接沿用 `forceAgent: true` 的文本清洗：其当前实现会删触发词并折叠换行。私聊 `normalizedContent` 使用校验后仅按约定 trim 的原文，保留 `@agent` 字样、段落和代码缩进；共享聊天的触发解析保持原样。
- 生产继续由 `agent-worker` 消费；只有显式 `AGENT_TASK_INLINE_RUN=true` 的本地／测试配置沿用内联执行。不得在弹窗接口旁路 Worker 直接请求 LLM。
- 私聊 Context 校验唯一 owner 成员后，以 `privateOwnerId` 推导有效 `requestedById`，`self` 为 owner，`partner` 为 null。允许 Scheduler 派生任务的空请求者；非空但不是 owner 时拒绝构建上下文。工具沿用有效身份，因此定时任务也能读取本人的 `me.*` 记忆。共享房的空请求者语义保持。读写记忆、摘要、备忘录和计划都限定专属 roomId。
- 复用现有工具注册、审批、租约和预算。私聊不提升权限，也不新增跨共享房间访问能力。
- 自动摘要／记忆提取仍使用私聊 roomId；其中 `shared.*` 只表示该会话范围的事实，不代表跨 Room 共享。
- 主上下文与摘要 prompt 均使用正确的会话用途；调整 `agent/summarizer.ts` 当前固定的“两人私聊+AI助手”描述。自动摘要／记忆仍继承既有异步维护方式，不承诺其已获得主任务相同的预算、租约和恢复保障；相关既有债务不并入本轮。
- `projectAgentTaskTimeline()` 对私聊任务跳过建 Post，并推进 `timelineProjectedAt`，使恢复扫描收敛；共享任务原投影规则保持。
- 私聊快照从任务持久状态得出等待、完成、失败和审批，不以本地计时器猜测执行结果。
- 可选 debug 日志沿用服务端诊断边界，不作为弹窗数据源，不将聊天载荷加入新增通用错误日志。

## 5. 弹窗交互与客户端状态

### 5.1 持续存在的入口层

```text
AgentEntryGate（路由／当前用户 ID）
  └─ AgentEntryShell（轻量 DOM；固定 Portal；不静态依赖 Three）
       ├─ 普通入口按钮＋情绪符号＋台词
       ├─ 动态 3D 视觉子树＋局部错误边界
       │    └─ AgentEntryScene（同一 Canvas 与模型实例）
       └─ AgentConversationDialog（可开关的对话面板）
            └─ 专属快照、消息输入、任务状态、工具审批
```

入口点击一次同步完成两件事：打开面板、触发点击反馈。网络读取在后台进行，弹窗开启动作不等待 API 或 3D 动作播放结束。重复点击不创建第二个弹窗，也不产生聊天消息或额外 AgentTask。

采用从入口挂载起固定在 `document.body` 下的 Portal shell，弹窗、小人、台词处于同一个持久容器；开窗只切换面板和模态属性，不搬动 Canvas。shell 持有草稿、开窗与请求状态；Three／R3F 只在认证通过且非 Chat 路由时动态加载，错误边界仅覆盖视觉子树。现有把整个 Entry 动态导入、边界出错返回 null 的结构需要拆分。模态容器涵盖面板及小人，不能直接用关闭时返回 null 的现有 `BaseModal` 包住 Canvas。

### 5.2 布局与可访问性

- 桌面端在小人上方／侧上方展开面板，保留小人及台词的独立区域，遮罩不得覆盖小人。
- 移动端采用紧凑面板，优先按 `visualViewport.height/offsetTop` 布局，并监听其 resize／scroll；不支持时回退到动态视口单位和安全区。消息区设置 `min-height: 0` 且只在自身滚动；极短视口先缩小模型展示区、减少非必要文案，再压缩消息区，优先保留输入、关闭按钮及小人。卸载时移除视口监听。
- 对话框有可查询标题与 `role="dialog"`／`aria-modal="true"`；输入框绑定 label。
- 打开后聚焦输入框；Tab／Shift+Tab 在共同模态区域内循环，并处理程序性焦点逃逸；Escape、关闭按钮和遮罩可关闭。关闭后焦点回到小人按钮；若入口已因身份失效卸载，则不聚焦失效节点。
- 仅对 Portal shell 之外的页面区域设置 inert，不能把包含 shell 的 body 设为 inert。保存并恢复原 inert、滚动锁和滚动位置，卸载也必须清理；不覆盖宿主页面原有设置。
- 背景页面 URL 与滚动位置不因开关弹窗改变。关闭面板后，通过站点导航进入 `/chat` 时，仍按原 Gate 卸载入口并清理客户端请求；模态打开时背景导航不可操作，程序性路由变化仍须立即清理。
- 输入时检查 IME composition，避免 Enter 提交中文候选词；自动滚动只操作弹窗的消息容器并服从减少动态效果偏好，不直接复用会滚动整个页面的 `scrollIntoView` 行为。

### 5.3 数据生命周期

- Gate 从 `/api/auth/me` 读取实际用户 ID。会话数据、草稿、待发送记录、审批与请求代次均绑定该 ID；200(A) → 200(B) 也必须清空旧状态。重验可复用现有 `?expect=` 一致性检查；不能只判断 HTTP 是否 200。
- 面板首次打开立即读快照；空会话显示引导文案，不创建虚假的历史消息。响应用户 ID 与当前身份不一致时拒绝合并。
- 首版采用可见且打开时的串行轮询，不新增一条 SSE。初始建议 2 秒刷新一次；首次读取、轮询、恢复可见、发送后与审批后刷新统一进入同一个读取调度器，上一请求结束后才发下一次；异常采用有界退避。
- 关闭面板或页面隐藏时停止轮询，以 AbortController 尽力取消传输，并用身份及请求代次检查拒绝迟到结果；恢复可见／重新打开时立即刷新。
- 可编辑草稿与不可变的待发送记录 `{ principalId, clientMessageId, content }` 分离。发送失败保留原记录供重试；原请求重试必须使用原内容和原 ID，编辑后发送使用新 ID。迟到的成功只能确认对应记录，不能清空用户随后输入的新草稿；合并时按消息 ID／clientMessageId 去重。
- 关闭面板不取消已入库的 AgentTask；再次打开可见已完成回复。取消 HTTP 请求不能被解释为取消服务端任务。
- 401／403、用户 ID 改变或 logout 通知清空旧会话状态；所有读取、发送、审批响应都执行身份及代次校验，不能仅依靠取消传输。身份探测的网络／500 失败沿用现有卸载策略，本轮接受未发送草稿随之清空；“草稿保留”只覆盖同一身份且入口未卸载时的关窗和发送失败。恢复验证后重新读取已持久化历史。
- 审批成功后由统一调度器刷新私聊快照。通用审批组件增加可选完成、身份失效回调及私聊请求前置条件，处理取消与迟到响应；双人 Chat 继续保留原默认行为。弹窗不得依赖整页跳转才能继续任务。

## 6. 默认小人的轻量反馈

| 事件 | 3D 动作 | HTML 情绪／台词 | 结束规则 |
| --- | --- | --- | --- |
| 首帧就绪 | 轻弹一次 | 小星星；“我在这里，有事叫我。” | 短暂显示后恢复静止 |
| 鼠标靠近／键盘聚焦 | 小幅前倾 | 注意符号；“有什么想聊的吗？” | 退焦后平滑回位，避免重复播报 |
| 点击打开面板 | 短促弹跳与回弹 | 开心符号；“在呢，我们聊聊。” | 面板打开后继续完整播放 |
| 私聊请求已受理 | 可选一次轻摆 | 省略号；等待状态 | 随真实任务状态更新；不无限摇晃 |
| 收到新回复／任务失败 | 短暂状态提示 | 回复就绪／失败文案 | 同一任务只反馈一次，避免轮询重复触发 |

采用小型 reducer 区分开窗状态、短动作和对话状态。点击动作优先于 hover／welcome；打开面板引起的输入焦点变化不能提前中断点击动作。动作不无限排队；一次性动作结束后重新计算当前表现，任务等待状态不能被错误清空。首次读取旧历史不触发“新回复”庆祝。

模型未就绪时先提供 HTML 反馈，DOM 开窗照常执行；模型就绪后不补播加载期间已过期的点击动作。

3D 帧更新放在 Scene 内，React 状态仅处理事件。DOM shell 与独立 R3F root 通过稳定 ref／小型 controller 传递动作，并持有该 root 的 invalidate；不能假设 DOM 状态自动更新只调用过一次 `root.render()` 的场景 props。动作在默认 priority=0 的 `useFrame` 更新，先于现有 priority=1 的手动 render，保留真实首帧提交后的 ready 通知。

保留 `frameloop="demand"`。事件发起时主动请求首帧；每个新动作建立独立时间基准，不把空闲后的大 delta 累加进新动作，必要时限幅。进行中续帧，结束提交归位帧后停止。开窗、输入聚焦和反馈更新不能改变初始化依赖，也不能重新创建 Canvas、renderer、PMREM 或模型。registry 明确 default 的反馈模式，birthday 保持静态，避免默认动作误作用于生日模型。

`prefers-reduced-motion` 同时约束 DOM 和 3D：停止弹跳、缩放和持续位移，保留文本与功能状态。页面隐藏时暂停帧调度，恢复时不补播过期的欢迎或点击动作。装饰符号不重复向屏幕阅读器朗读，必要状态使用克制的 live region。

## 7. 加载与故障行为

- 只有 3D 视觉子树按认证和路由动态加载；匿名与 Chat 冷启动维持零入口专属 3D chunk／模型请求，轻量 shell 代码不计为 3D 专属资源。
- 加载期间即可使用普通“与小助手聊天”按钮；GLB pending／失败、3D chunk 下载失败或 WebGL 失败都不能禁用、卸载 DOM 私聊入口。开窗不等待首帧 ready。
- 开窗期间发生 context loss 时，只将视觉层降级，已输入草稿、对话和服务端任务继续保留。
- 新降级策略会替代旧的“故障时整入口消失”契约，相关既有测试必须按新行为重写，同时保留宿主可操作和资源释放断言。
- 无新的 GLB、骨骼、纹理序列或 LLM 动作请求；HTML 台词在本地选择，带去重和冷却。
- 降级保证覆盖 3D 资源失败；应用主 shell 或私聊自身代码尚未下载成功的整体故障不在可恢复承诺内。

## 8. 文件改动地图

表中新增文件名为拟定名称，实现时保持同等职责即可。

| 范围 | 现有／拟新增位置 | 主要职责 |
| --- | --- | --- |
| 数据模型 | `prisma/schema.prisma`、新增时间戳迁移 | Room 用途／owner、发送幂等约束、旧数据兼容 |
| 私聊服务 | 新增 `lib/agent-conversation.ts`、`lib/agent-conversation-types.ts` | 会话获取、快照投影、所有权与发送编排 |
| 私聊 API | 新增 `app/api/agent/conversation/route.ts`、`.../messages/route.ts` | 认证、校验、限流、领域服务调用 |
| 校验与消息 | `lib/validation.ts`、`lib/messages.ts`、`lib/agent-detection.ts`、必要时 `lib/agent-task-dispatch.ts` | 私聊原文触发、幂等与身份前置条件，保持消息／任务原子性 |
| 共享入口 | `lib/access.ts`、`lib/room-list.ts`、`lib/room-lifecycle.ts`、`lib/study.ts`、相关 rooms API 和 Chat 页面 | 共享筛选、owner 授权、Chat／Study 默认选择和删除计数 |
| Runtime 边界 | `agent/context-builder.ts`、`agent/types.ts`、`agent/summarizer.ts`、必要的 prompt 上下文与 `lib/agent-posts.ts` | 单用户及 Scheduler 的 owner 身份、摘要语义、跳过私聊时间线投影 |
| 状态与审批 | `app/api/agent/status/route.ts`、任务／审批路由、`components/chat/ToolApprovalPanel.tsx` | 共享聚合隔离、私聊身份前置条件与禁缓存、审批刷新 |
| 入口与弹窗 | `components/agent-entry/AgentEntry*.tsx`、新增 `AgentEntryShell.tsx`／`AgentConversationDialog.tsx`／请求 hook | 按用户隔离状态，稳定 Portal 与动态视觉边界，统一请求调度 |
| 动作与样式 | 新增行为控制模块、`agent-entry.types.ts`、registry、CSS module | 默认主题反馈、稳定帧控制、响应式布局 |
| 测试 | Node／组件／integration；既有 `tests/e2e/agent-entry-{public,authenticated}.spec.ts`、`tests/e2e/support/agent-entry.ts`、`scripts/compose-deployment-smoke.ts` | 使用已被门禁发现的入口 spec，更新动态资源定位 helper，补私聊 Worker smoke |
| 文档与状态 | `PROJECT_VIEW.md`、本计划、feature／handoff | 实现完成后更新当前模块边界与实际证据 |

原 [3D 入口设计](2026-09-09-agent-entry-design.md) 作为历史保留；本计划在实施后替代其中“点击跳转 Chat”“出错隐藏入口”“不提供持续入口反馈”的相关行为。现阶段不修改质量评分或声称历史门禁覆盖新功能。

模块职责继续按领域划分：私聊 Room／Message 与授权归 QAM-02，任务／上下文／工具归 QAM-08，小人表现与入口生命周期归 QAM-10；不把数据库和 Runtime 逻辑塞进入口组件。

## 9. 单任务实施顺序

保持 `feat-080` 为一个完整用户旅程，按以下步骤串行实施；不并行打开其他 feature。

1. **启动**：复核用户既有改动与依赖，将 feat-080 标为 `in-progress`，运行 `./scripts/run-node22.sh ./init.sh`。先核对本地 Next.js 指南和数据库／测试边界。
2. **隔离与迁移**：新增用途、owner 与发送幂等约束；运行 `./scripts/run-node22.sh npm run db:generate` 生成与新 schema 匹配的 Prisma Client，再进行依赖新字段的类型／集成验证。实现私聊服务和共享筛选修正；用真实 PostgreSQL 验证旧库升级、并发创建、越权与最后共享房间约束。
3. **API 与 Runtime**：接入私聊读写、AgentTask 原子派生、审批、单用户上下文及私聊投影跳过；验证 Worker 和显式 inline 两条配置路径。
4. **对话弹窗**：实现同页开关、消息往返、串行轮询、错误重试、焦点管理及窄屏布局，确认双人 Chat 数据不混入。
5. **点击反馈与降级**：接入默认模型短动作、情绪符号和台词；确保开窗不重建 Canvas、不截断动作，增加 DOM 降级入口。
6. **完整验证与记录**：运行风险匹配门禁；更新模块边界、feature 验收证据，重写交接；仅全部验收完成才标 done。

所有数据库测试使用隔离的 PostgreSQL/Testcontainers。迁移命令必须显式指定目标 `DATABASE_URL`，不得隐式读取开发库连接执行探针。本计划阶段不执行迁移、启动服务或部署。

## 10. 验证矩阵

| 层级 | 核心验收 |
| --- | --- |
| Node／Route | 身份失效、非法输入、Agent 禁用、成功／错误响应禁缓存、稳定错误契约；私聊保留触发词／换行／缩进；任务状态到表现状态的去重／优先级 |
| 组件 | 点击／Enter／Space 立即开窗且不导航；点击反馈不被输入 autofocus 截断；关闭、Escape、焦点恢复、表单 label、IME 不误发；失败重试的内容／ID 固定，发送 A 的迟到成功不清空新草稿 B |
| 组件 | 首次读取、轮询、发送和审批刷新不重入；关闭／隐藏停止读取；200(A)→200(B) 无 logout 通知也清空；旧读取／发送／审批响应迟到均不污染新身份 |
| 真实 PostgreSQL | A/B 各自唯一会话；同用户并发首次发送不重复建房；同幂等键恰一条消息／任务；同键异文 409；另一用户猜到 roomId／taskId 仍不能读写／审批／trace |
| 真实 PostgreSQL | Cookie=B、请求头=A 时，私聊读取／发送／审批拒绝，数据库零写入且 B 会话仍有效；身份前置条件不替代 owner 授权 |
| 真实 PostgreSQL | A 私聊、B 私聊及共享房分别放置消息、记忆、全局／范围摘要、备忘录、计划标记，A Context 只含 A 私聊数据及 owner 档案；私聊 schedule→scheduler→Runtime 仍识别本人及 `me.*` 记忆 |
| 真实 PostgreSQL | 私聊不进入共享列表；私聊成员关系早于剩余共享房时，Chat／Study 默认选择仍正确；拥有私聊时仍不能删除最后共享房间 |
| 真实 PostgreSQL | 含已完成 ToolCall 的私聊任务不生成 Post 且推进 `timelineProjectedAt`，对应 shared 任务生成一条 Post；重复投影及恢复扫描稳定收敛 |
| 真实迁移 | 先部署此前迁移集、写旧 Room／成员／消息，再部署新增迁移；旧房为 shared、旧数据保持；非法用途／owner／人数约束被数据库拒绝；owner 删除级联其私聊，共享房间与其他用户数据遵守原规则 |
| Production Playwright | 保留开窗前 Canvas／WebGL context 句柄，开关后严格同一对象且旧 context 未丢失；实际模型轮廓／位置随点击帧变化，autofocus 后继续，结束归位并停止绘制；URL／背景滚动不变且 GLB 不重复下载 |
| Production Playwright | 长时间静止后首次点击、欢迎中点击、隐藏后恢复；正常动画实际发生，reduced-motion 保留功能与台词且无位移 |
| Production Playwright | 两个真实身份分别发送并得到受控 Runtime 回复，审批后可继续；对方不可见，刷新恢复历史，关窗不取消任务；关闭弹窗后站点 Chat 仍进入共享房间且不出现私聊记录 |
| Production Playwright | 320／390 px、触摸、Shift+Tab、程序性焦点逃逸、极短视口、原 inert／滚动锁恢复及卸载清理；Cookie 换号、登录失效；GLB pending／失败、3D chunk 失败、开窗后 context loss 的普通入口仍可私聊 |
| Compose smoke | 隔离真实 Web 接口发送私聊，由独立 Worker 完成并从快照返回回复；保留共享任务 smoke；核对任务 `workerId` 与 Worker 容器 hostname，`AGENT_TASK_INLINE_RUN=false`，init 可部署迁移 |

更新既有入口测试中“点击必须跳到 /chat”“开窗导致 Canvas 为 0”“故障时入口消失”等被需求替代的断言；保留直接导航到 Chat 时的卸载／零下载、退出后的资源释放和真实首帧守卫。欢迎短动画结束后再验证静止场景停止绘制。

执行接线明确如下：

1. 新浏览器旅程直接加入已被 Playwright 和两主题 npm 脚本选中的 `agent-entry-authenticated.spec.ts`，匿名守卫保留在 `agent-entry-public.spec.ts`；不另放到未被白名单匹配的文件。若实施时确需拆分，必须同步 `playwright.config.ts` 的 `testMatch` 与两主题脚本，并检查测试实际被收集。动态 3D 边界改变后，同步修正 `support/agent-entry.ts` 的 manifest 定位，不继续假设 `AgentEntryGate -> ./AgentEntry`。
2. 当前 production E2E launcher 只启动 Next，且固定 inline=false。浏览器从真实发送结果取 taskId，再复用 `tests/e2e/support/run-agent-task.ts`；该子进程显式设置 `NODE_ENV=test`，`DATABASE_URL` 与 `DIRECT_URL` 同指隔离测试库，并采用受控模型配置驱动 Runtime，审批后再驱动恢复。不得调用真实 LLM。该证据只证明浏览器／API／Runtime 闭环；独立生产 Worker 证据由扩展后的 Compose smoke 提供。
3. 旧库升级参考既有 `agent-timeline-projection-migration.integration.test.ts` 的隔离数据库流程；空库全量 migrate deploy 不能替代升级夹具。新增迁移测试还要验证旧消息没有 clientMessageId 时仍可按原规则写入。
4. 时间线夹具必须含 ToolCall，并配共享任务正对照，防止原有“无工具调用则不投影”规则掩盖漏实现。上下文夹具也必须包含其他作用域的数据，不能用空房间证明隔离。
5. 3D 验收除严格对象同一性和 draw 次数外，还应通过真实 Canvas 帧截图／读回验证可见轮廓或位置发生变化，不能用 DOM 气泡或 mock Scene 代替模型动作。记录浏览器与 WebGL 模式，避免脆弱的逐像素黄金图比较。
6. 欢迎／点击位移、长时间静止后启动动作等断言仅对 `default` 执行；birthday 验证静态模型、同一私聊弹窗、资源与身份生命周期，不要求其跳动。两主题共用 spec 时按明确的反馈能力分别断言，不跳过共用私聊旅程。

建议的实施期命令顺序：

```bash
./scripts/run-node22.sh ./init.sh
# 以下从 schema 与迁移完成后执行
./scripts/run-node22.sh npm run db:generate
./scripts/run-node22.sh npx vitest run tests/component/agent-entry.test.tsx tests/component/agent-conversation-dialog.test.tsx
./scripts/run-node22.sh npm run test:integration -- tests/integration/agent-private-conversation.integration.test.ts tests/integration/agent-private-conversation-migration.integration.test.ts
E2E_SOFTWARE_WEBGL=true NEXT_PUBLIC_AGENT_ENTRY_THEME=default ./scripts/run-node22.sh npm run check:full
./scripts/run-node22.sh npm run test:e2e:agent-entry:production:birthday
./scripts/run-node22.sh npm run test:compose-smoke
git diff --check
git status --short
```

新增测试文件名以最终实现为准；定向命令不替代完整门禁。Docker 不可用、权限差异或既有无关失败须记录原命令与结果，按仓库规则复核，不放宽断言或扩大修复范围。软件 Chromium 的结果不能写成实体手机性能、系统软键盘或安全区已验证。

## 11. 完成条件与交付边界

- 用户在原页面点击小人，得到独立可用的私聊弹窗，并能看完点击动作、情绪符号和台词。
- 另一人无法读取或写入该会话；共享 Chat、默认房间和现有 Agent 工具治理保持其原有边界。
- 消息、任务、审批和错误可完成闭环，关闭面板后的任务仍可恢复观察。
- 入口和网络生命周期稳定，符合键盘、减少动态效果和窄屏可用性要求。
- 风险匹配门禁有真实证据，状态记录同步；清理本轮测试资源，不删除用户已有工件。
- 计划阶段结论只验收文档；实施完成依据进度中的实际门禁与补充浏览器证据。

## 12. 计划复核记录（2026-09-22）

按用户要求，分发给三个使用 **`gpt-6-astra`／`ultra`** 的子 agent，只读复核后端隔离、前端交互、实施与验证。主 agent 交叉核对关键源码并修订本文，再由各子 agent 定向复核对应修订。发现的实质缺口已纳入设计，定向复核未留下阻断性设计问题；最后两处主题断言和 helper 环境说明已补齐。

| 复核面 | 修订结果 | 对应章节 |
| --- | --- | --- |
| 共享入口隔离 | 补上 Study 独立房间查询及“私聊早于剩余共享房”的反例 | 4.3、8、10 |
| 身份与缓存 | 按用户 ID 隔离客户端状态；写入前校验预期身份；成功／错误响应明确禁缓存 | 4.2、5.3、10 |
| Runtime 语义 | 私聊保留原文；Scheduler 从 owner 恢复有效身份；摘要使用单用户语义，注明既有异步维护限制 | 4.4、10 |
| 3D 故障边界 | 固定 DOM shell 持有私聊状态；只有视觉子树动态加载与降级 | 5.1、7 |
| 动作与请求生命周期 | 新动作独立计时、首帧主动 invalidate、渲染顺序固定；统一读取调度，重试记录与新草稿分离 | 5.3、6 |
| 模态操作 | 明确 Portal／inert 边界、焦点管理、视觉视口、IME 和局部滚动 | 5.1–5.2、10 |
| 测试接线 | 使用已发现的 spec，修正 chunk helper；浏览器受控 Runtime 与 Compose 独立 Worker 分别取证 | 8–10 |
| 有效验收夹具 | 旧库升级与数据库约束、含 ToolCall 的私聊／共享投影对照、多作用域 Context 标记、真实模型位移及 Canvas 对象同一性 | 10 |

结论是**设计与实施路径可行**，并非功能已经通过运行验证。计划复核阶段未运行应用测试、迁移、浏览器或 Compose；当时只核验文档结构、引用和状态一致性，不新增模型资产或应用依赖。实施验证结果另见进度记录，不以静态复核代替运行验收。


## 13. 原生隐藏验证接线说明

Playwright 的内部 CDP 会启用 focus emulation，直接切标签或使用另一个 CDP Session 关闭 emulation 仍可能保持 `document.visibilityState=visible`。实施时已通过独立 Chrome＋原生 CDP 取得真实 `isTrusted=true` 的隐藏/恢复事件，避免用伪造事件冒充浏览器验证。

可复现探针为 [probe-agent-entry-visibility.ts](../../tests/e2e/support/probe-agent-entry-visibility.ts)。在默认主题 production E2E 服务和 auth setup 已就绪、尚未结束的窗口运行：

```bash
./scripts/run-node22.sh node --import tsx tests/e2e/support/probe-agent-entry-visibility.ts
```

脚本只接受本机隔离 E2E metadata/数据库标记，沿用测试 Cookie 仅读页面和快照，不登录、退出或发送；验证隐藏停绘、同 Canvas/context 恢复归位和再次点击，并清理独立 Chrome/profile。它是默认 production Playwright 门禁的额外真实浏览器证据；实体手机 GPU、系统软键盘和安全区仍需目标设备另行体验。
