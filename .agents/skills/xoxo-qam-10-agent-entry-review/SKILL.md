---
name: xoxo-qam-10-agent-entry-review
description: 审查 XOXO Meridian QAM-10 全局 3D Agent 入口与模型资产生命周期的既有实现质量并维护持续评分报告；用于路由/认证 Gate、构建主题、GLB 来源与预算、WebGL 首帧/失败/资源生命周期、可访问入口及 production 资产集成审查，不用于增加 3D、Avatar 或 Chat 功能。
---

# QAM-10 全局 3D Agent 入口与模型资产生命周期质量审查

## 目标与必读资料

在功能范围不变的前提下，判断全局 3D Chat 入口是否按身份和路由条件惰性装载、可访问、故障隔离，并确认源模型到正式 GLB 的选择与提升过程可重复、受预算和来源约束。不得因主题少、场景静态、没有 Avatar 动画或只提供导航而扣分。

完整读取 `AGENTS.md`、`docs/optimization/module-quality-review-standard.md`，以及 `PROJECT_VIEW.md` 的 QAM-10、Cross-cutting Concerns、共享映射、BU-11～BU-14。若报告已存在，读取并持续更新 `docs/optimization/qam-10-agent-entry-quality-review.md`，保留历史 ID 和评分。

## 模块证据范围

- 运行入口：`app/layout.tsx`、`components/agent-entry/`、主题 Registry/resolver 及相关 CSS。
- 资产事实与工具：`3d-source/agent-entry/`、`public/models/agent-entry/`、`scripts/agent-entry-assets.ts`、`scripts/lib/agent-entry-assets.ts`。
- 共享交付/安全接缝：`next.config.mjs`、`proxy.ts`、`.env.example`、`Dockerfile`、`docker-compose.yml`、`scripts/compose-deployment-smoke.ts`、`package.json` 中直接影响入口的部分。
- 验证：`tests/lib/agent-entry-*.test.ts`、`tests/component/agent-entry*.test.tsx`、`tests/e2e/agent-entry-*.spec.ts`、production 主题/Compose image 证据。

重点核对三条路径：匿名或 Chat 冷启动不下载入口 chunk/GLB；登录态非 Chat 经认证探测、dynamic import、GLB 解码、真实首帧、DOM 导航、卸载与返回缓存；chunk/404/损坏/WebGL/context-lost 及 source→candidate→selection→promote 失败路径。另核对构建主题冻结、Registry/正式文件/镜像一致性、CSP/decoder 外联、GPU/observer/listener/cache 生命周期、fixed overlay 遮挡、safe-area、键盘/触摸/tooltip/reduced-motion 和资产 provenance/预算。

## 证据纪律

- 本轮真实 asset check、Node/component、两个主题 production browser 和 Compose/image 检查才可作为当前 E3；[feat-040 历史验收证据](../../../docs/harness/archive/features-001-053.json)只能标为历史 E3。
- jsdom 不证明 WebGL、CSP、首帧或 GPU 释放；普通 dev 浏览器不替代 production 构建主题语义。
- 软件 Chromium 不得写成实体移动设备性能、系统软键盘或非零 safe-area 已验证。
- Gate 是显示条件而非静态 GLB 授权；认证事实归 QAM-01，Chat 目标归 QAM-02，构建/镜像传播归 QAM-09。

## 审查与交付

1. 先形成 E1～E3 证据，再按统一十维模型评分、计算 Gate，并使用稳定 `QAM-10-nnn` 问题 ID。
2. 每项问题写清机制、质量影响、保持当前入口功能的最小修正、风险匹配验收证据和直接关联 QAM。
3. 只建议降低加载、生命周期、资产、交付接缝或可访问风险；不增加 Avatar、动画、语音、远程主题、Chat 能力或通用 3D 平台。
4. 按固定格式创建或更新 `docs/optimization/qam-10-agent-entry-quality-review.md`；初审 Delta 为 `baseline`。
5. 只修改该报告。未经另行授权，不修改组件、GLB、Registry、资产记录、共享总览、`PROJECT_VIEW.md` 或 Harness 状态。

完成前确认十维精确合计 100、Gate/Final 与证据一致、链接可解析、临时浏览器/资产/镜像工件已说明，并避免把 QAM-01、QAM-02、QAM-09 或 Cross-cutting 的根因重复登记。
