# 3D Agent Entry 设计

## 状态

- 日期：2026-09-09
- 状态：已通过头脑风暴评审
- 范围：为已登录用户在所有非 `/chat` 页面提供右下角固定悬浮的 3D Agent 入口

## 背景与现状

XOXO Meridian 当前使用 Next.js 16.3.3、React 19.2.8、Tailwind CSS 3.4 和 framer-motion 12.40。页面基于 App Router；本功能不会把 `app/layout.tsx` 或任何现有页面转换为 Client Component。Three.js、React Three Fiber 和 Drei 尚未安装。

认证后的首页是 `/home`，`/chat` 会在服务端把用户重定向到默认房间，因此入口只需导航到 `/chat`，无需在客户端查询或拼接 roomId。登录、注册与退出均使用整页导航，Root Layout 不会在这些身份切换后保留过期状态。

已有两个未优化的 Web 资产：

- `public/models/agent-entry/default/default_scene.glb`：约 57.93 MiB，969,982 个顶点、约 189 万个三角面。
- `public/models/agent-entry/birthday-2026/birthday_scene.glb`：约 59.36 MiB，1,011,768 个顶点、约 195 万个三角面。

两者当前都是单 Node、单 Mesh、单 Primitive，无 Camera、Skeleton、AnimationClip 或 Morph Target。它们适合作为原始资产源，但不适合由右下角小尺寸入口直接加载。

## 目标

1. 已登录用户在所有非 `/chat` 页面看到右下角固定悬浮的 3D 入口。
2. 当前主题通过 `NEXT_PUBLIC_AGENT_ENTRY_THEME` 在构建时选择，支持 `default` 和 `birthday-2026`。
3. 缺失、空白、拼写错误或未知主题统一回退到 `default`。
4. 一个主题对应一个完整 Scene GLB，不要求不同主题共享 Mesh、角色数量、Skeleton、动画或表情结构。
5. 模型完全加载后才显示并启用入口；点击 DOM button 后进入 `/chat`。
6. 页面布局使用 Tailwind，DOM 动效使用 framer-motion，R3F 只负责 3D 世界。
7. 保持配置驱动和最小 Client Component 边界，并建立可重复执行的离线 GLB 优化流程。

## 非目标

本次不实现或引入：

- `AgentChatAvatar` 或与 Chat 内 Agent 状态的联动。
- VRM、复杂 Avatar Runtime 或状态机。
- TTS、Lip Sync、LookAt、物理引擎。
- Mesh/Raycaster 主导航交互、OrbitControls。
- 持续漂浮、旋转、骨骼动画或 Morph Target 表情。
- Remote Config、Feature Flag、CMS、A/B Test 或日期自动切换。
- 每个动作一个 GLB 的资产组织方式。
- 可见的加载失败兜底、重试按钮或替代导航入口。

## 总体架构

```text
app/layout.tsx（Server Component）
  ├─ resolveAgentEntryTheme()
  ├─ agentEntryRegistry[theme]
  └─ AgentEntryGate（最小 Client Component）
       ├─ pathname 以 /chat 开头：返回 null
       └─ 其他 pathname：GET /api/auth/me
            ├─ 非 200：返回 null
            └─ 200：动态加载 AgentEntry
                 ├─ motion.button + Tooltip + Router
                 └─ AgentEntryScene
                      └─ Canvas + AgentEntryModel
```

`app/layout.tsx` 只解析构建期主题并传入可序列化的 Theme Config，不读取登录态，不把 Root Layout 变成依赖请求 Cookie 和数据库的认证布局。

`AgentEntryGate` 是唯一新增的 Client Component 边界。它先用 `usePathname()` 排除 `/chat` 及其子路由；只有在其他页面才以 `cache: "no-store"` 和 `credentials: "same-origin"` 请求现有 `/api/auth/me`。认证成功后再通过 `next/dynamic(..., { ssr: false })` 加载 `AgentEntry`，确保匿名页面和 Chat 路由不会下载 Three/R3F 代码或 GLB。

首次加载位于 `/chat` 时不执行认证探测。若随后离开 Chat，Gate 再发起探测。Gate 在同一 Root Layout 生命周期内保留成功结果，非 Chat 页面之间导航不重复请求。登录、注册和退出的现有整页导航负责刷新该状态。

## 组件职责

### `AgentEntryGate`

- 判断 `/chat` 前缀。
- 探测当前用户是否已登录。
- 在认证成功后动态加载 3D 入口代码。
- 用最小错误隔离边界捕获动态模块、WebGL 或模型加载异常；失败时静默返回 `null`，不显示兜底 UI，也不影响当前页面。

### `AgentEntry`

- 渲染右下角固定的 DOM `motion.button`。
- 管理模型 `ready`、Hover、Focus 和导航中状态。
- 模型 ready 前保持 `disabled`、不可聚焦、不可点击、视觉隐藏和 `pointer-events: none`。
- ready 后执行一次淡入，并启用 Pointer、Touch、Enter 与 Space 的原生 button 行为。
- Hover 时显示 Tooltip 并轻微缩放，Tap 时短暂压缩。
- 点击时先锁定重复触发，再执行 `router.push("/chat")`。
- 使用 `aria-label`、`aria-describedby` 和可聚焦 Tooltip 语义满足可访问性要求。
- 在 `prefers-reduced-motion` 下取消缩放和位移动画，只保留立即显示与功能反馈。

### `AgentEntryScene`

- 创建透明背景 Canvas。
- 从 Theme Config 设置 Perspective Camera 和观察目标。
- 提供公共的 Ambient/Directional Light 与只生成一次的程序化 Environment，不从外部 CDN 下载 HDR。
- 使用 `frameloop="demand"`、受限 DPR 和 `powerPreference: "low-power"`。
- Canvas 自身设置 `pointer-events: none`，不承担导航交互。
- 使用 `Suspense fallback={null}` 承接模型加载。

### `AgentEntryModel`

- 通过 `useGLTF` 只加载当前 Theme Config 的 `model`。
- 禁用 Draco 路径并启用 Meshopt decoder，不依赖外部 decoder CDN。
- 以统一的 `<primitive>` 装配任意主题 Scene，不读取具体节点名。
- 从 Registry 应用 `scale`、`position` 和 `rotation`。
- `useGLTF` 完整解析后向 `AgentEntry` 上报 ready。
- 当前不读取或播放 AnimationClip，也不操作 Morph Target。

## Theme Resolver 与 Registry

`resolve-agent-entry-theme.ts` 使用 `server-only`，是仓库中唯一读取 `process.env.NEXT_PUBLIC_AGENT_ENTRY_THEME` 的位置。Resolver 只返回受支持的 Theme ID；任何其他输入均返回 `default`。

Theme ID 在一个只读列表中定义：

```ts
type AgentEntryTheme = "default" | "birthday-2026";
```

Registry 使用纯数据配置，并通过 `as const satisfies Record<AgentEntryTheme, AgentEntryThemeConfig>` 保证每个主题完整实现稳定契约：

```ts
type Vector3Tuple = readonly [number, number, number];

interface AgentEntryThemeConfig {
  model: string;
  camera: {
    position: Vector3Tuple;
    target: Vector3Tuple;
    fov: number;
    near: number;
    far: number;
  };
  scale: number;
  position: Vector3Tuple;
  rotation: Vector3Tuple;
  layout: {
    mobileSize: number;
    desktopSize: number;
    mobileBottom: number;
    desktopBottom: number;
    mobileRight: number;
    desktopRight: number;
  };
  ui: {
    tooltip: string;
    ariaLabel: string;
    accent: string;
  };
  capabilities: {
    animationClips: readonly string[];
    morphTargets: readonly string[];
  };
}
```

约束：

- `model` 分别指向 `/models/agent-entry/default/scene.glb` 和 `/models/agent-entry/birthday-2026/scene.glb`。
- 两个当前主题的 `capabilities.animationClips` 与 `capabilities.morphTargets` 都是空数组，忠实反映实际资产。
- 默认 Tooltip 为“和 Agent 聊聊”，生日主题 Tooltip 为“来参加生日派对 🎂”；可访问名称均明确表达“打开 Agent 聊天”。
- `ui.accent` 通过 CSS variable 提供给 DOM 层，不在 Registry 中存放动态 Tailwind class。
- Core Component 不出现 Theme ID 判断、具体 GLB 路径或主题节点名。
- Camera、Transform 和 Layout 的精确数值在候选模型评审时校准后写入 Registry；移动尺寸限制在 144–176 px，桌面尺寸限制在 192–240 px。
- Light 和程序化 Environment 当前是公共配置。只有出现真实主题差异时才扩展 Registry。

## 布局与渲染行为

- Agent Entry 使用 `position: fixed` 固定在右下角，不进入首页 Timeline 或空间画布组件树。
- 移动端和桌面端尺寸、bottom/right 偏移都来自 Registry。
- bottom 叠加 `env(safe-area-inset-bottom)`。
- 使用 `z-30`，高于普通页面内容，低于现有 `z-40` 导航和 Modal/Toast。
- Canvas 只占 button 自身区域，不阻挡页面其他区域的点击、拖动或滚动。
- R3F 场景静止；Hover、Tap、Tooltip 和入口出现均由 framer-motion 在 DOM 层完成。
- 只请求当前主题的一个 Runtime GLB，不预加载另一个主题。
- 从非 Chat 页面进入 `/chat` 后卸载 Canvas；同一浏览器会话返回非 Chat 页面时可复用 `useGLTF` 缓存。

## 资产归档与优化

### 目录

```text
3d-source/
└── agent-entry/
    ├── default/source.glb
    └── birthday-2026/source.glb

public/models/agent-entry/
├── default/scene.glb
└── birthday-2026/scene.glb
```

当前两个原始文件原样移动到 `3d-source/`。`.dockerignore` 排除 `3d-source/`，避免约 120 MiB 原始资产进入部署镜像构建上下文。优化后的 Runtime GLB 提交到 `public/`。

### 工具与执行时机

- `@gltf-transform/cli` 以锁文件固定的 `devDependency` 提供离线处理。
- 优化只由开发者显式执行，不进入 `npm run build`、Docker 启动或浏览器 Runtime。
- 顺序为：`inspect → weld → simplify → texture resize/compress → quantize → meshopt → validate`。
- 不使用 Draco 或 KTX2，不加载外部 decoder/transcoder。
- 每个主题独立设置简化参数，不要求共享拓扑或比例。

### Runtime 预算

每个正式 `scene.glb` 必须满足：

- 文件不超过 8 MiB。
- 场景不超过约 150,000 个三角面。
- 纹理最长边不超过 2048 px。
- 所有 Buffer 和 Texture 内嵌在 GLB 中，不产生外部 `.bin` 或图片依赖。
- 通过 glTF 规范校验，且只声明 Runtime Loader 支持的扩展。

### 人工质量门禁

优化脚本先在临时评审目录生成 15%、10%、7.5% 和 5% 等候选比例，不覆盖正式 Runtime GLB。每个候选附带文件大小、顶点/三角面数、纹理尺寸和规范校验报告。

候选接入真实 Agent Entry 后启动本地开发服务器，并生成 Default/Birthday 的桌面与移动视口截图。人工在浏览器中检查最终 Camera、Light、构图、Hover 和实际显示尺寸，重点确认：

- 人物、蛋糕和礼物等主体仍容易辨认。
- 面部、手部和物体边缘无不可接受的塌陷。
- 无破面、孔洞、闪烁、异常阴影或明显纹理接缝。
- 两个主题均无主体裁切。
- 在实际显示尺寸下，更高面数不再带来可见收益。

人工选择满足预算且视觉质量最好的最低面数候选后，才将其提升为正式 `scene.glb`。若所有自动候选都不合格，则保留原始源文件，在 Blender 中 Decimate、局部修形或重新烘焙后重跑同一流程。未选择的候选在会话结束前清理。

## 测试策略

### Node 单元测试

- 合法的 `default` 与 `birthday-2026` 正确解析。
- 环境变量缺失、空白、拼写错误或未知值统一返回 `default`。
- Registry 对两个主题提供完整、可序列化的配置。
- Runtime GLB 存在、是有效 GLB、无外部资源、使用受支持扩展，并满足体积、三角面和纹理预算。

### jsdom 组件测试

`AgentEntryGate`：

- `/chat` 前缀不发起 `/api/auth/me`，也不渲染入口。
- 非 Chat 页面收到 401 或网络错误时不加载入口。
- `/api/auth/me` 返回 200 后才加载入口。

`AgentEntry`：

- 模型 ready 前 button 禁用且不能导航。
- ready 后 button 具有可访问名称，可通过鼠标、触摸、Enter 和 Space 激活。
- Hover 和 Focus 显示 Tooltip。
- 连续点击只触发一次 `/chat` 导航。
- reduced-motion 下不执行缩放或位移动效。

组件测试在 jsdom 中替换 WebGL/R3F 边界，只验证用户可观察行为，不断言源码字符串或 Three.js 内部实现。

### Playwright

- 已登录用户在 `/home` 等待真实 GLB ready 后，点击入口进入实际 `/chat/[roomId]`。
- `/chat` 路由不显示入口，也不请求 Agent Entry GLB。
- 未登录用户访问公共 `/about` 时不显示入口，也不请求 Agent Entry GLB。
- Default 与 Birthday 分别完成桌面和移动视口的人工预览；自动 E2E 不以脆弱的像素快照代替人工模型质量判断。

## 文件范围

预计新增或修改：

- `app/layout.tsx`
- `components/agent-entry/AgentEntryGate.tsx`
- `components/agent-entry/AgentEntry.tsx`
- `components/agent-entry/AgentEntryScene.tsx`
- `components/agent-entry/AgentEntryModel.tsx`
- `components/agent-entry/agent-entry.types.ts`
- `components/agent-entry/agent-entry.registry.ts`
- `components/agent-entry/resolve-agent-entry-theme.ts`
- `scripts/` 下的 Agent Entry 资产优化/检查脚本
- `3d-source/agent-entry/`
- `public/models/agent-entry/`
- `.dockerignore`
- `.env.example`
- `package.json` 与 `package-lock.json`
- `tests/lib/`、`tests/component/` 和 `tests/e2e/` 中的对应行为测试
- 实施阶段的 `feature_list.json` 与 `session-handoff.md`

不会修改数据库、Prisma migration、Agent Runtime、Chat 内部状态或 AgentChatAvatar。

## 验收标准

1. Root Layout 保持 Server Component，任何现有页面都不因 Agent Entry 被转换为 Client Component；只有 Agent Entry 子树进入新增的 Client Component 图。
2. 已登录用户在全部非 `/chat` 页面看到入口；匿名用户与 `/chat` 路由不加载 3D 代码或模型。
3. Theme Resolver 是唯一环境变量读取点，非法或缺失值稳定回退 `default`。
4. 所有主题差异由 Registry 提供，核心组件无 Theme ID 分支和具体 GLB 路径。
5. 两个主题各自加载单一、优化后的 Scene GLB，并通过资产预算与人工质量门禁。
6. 模型 ready 前入口不可见、不可聚焦、不可点击；ready 后 Hover、Focus、Tap 和键盘交互可观察且可访问。
7. 点击 DOM button 进入 `/chat`，不依赖 Three.js Mesh 点击。
8. Canvas 按需渲染，无持续 3D 动画、外部 HDR 或 decoder CDN 请求。
9. 3D/WebGL/GLB 异常不显示可见兜底，也不使宿主页面崩溃。
10. 相关单元、组件、资产和 Playwright 测试通过，`npm run check:full` 与最终 `./init.sh` 通过。

## 实施与交付顺序

1. 设计获批后编写详细实施计划。
2. 实施开始前登记唯一的新 feature、标记为 `in-progress`，运行 `./init.sh` 建立基线。
3. 先补 Resolver、Gate 和 AgentEntry 的失败测试，再实现最小组件与 Theme Registry。
4. 安装并锁定 Three/R3F/Drei 与离线优化依赖，复查 npm audit。
5. 移动原始资产，生成候选 Runtime GLB，并执行自动预算检查。
6. 启动真实页面预览，在人工确认候选前暂停，不提升或提交正式 Runtime GLB。
7. 人工确认后完成真实模型装配、Playwright 导航验证和风险匹配门禁。
8. 更新状态文件、清理候选和测试产物，记录唯一推荐下一步。
