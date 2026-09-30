# 会话交接

## 当前进展

- [feat-090](feature_list.json) 用户验收后的复核修正已完成，状态 `done`。最终交互为 **±25°、单个角落旋转手柄**：拖动连续预览、松手保存，取消恢复原角度；方向键微调，单击可输入角度或恢复水平。旧滑杆已删除，角度读数不再改变输入几何；倾斜缩放按照片自身横轴计算，切换照片时关闭旧输入框。
- 原滑杆的抖动已在真实浏览器复现：连续移动 60 次产生 15 次反向跳动。根因、设计依据、前后截图及代码审查见 [审查记录](docs/reviews/feat-090/README.md)，长期验证记录见 [进度](progress.md#feat-090)。右键菜单定位与去除黑线的改动保留，用户根目录 JPG 原样保留；未改依赖、迁移或部署配置。

## 验证与边界

- `./scripts/run-node22.sh ./init.sh` exit 0（96 文件/923 项）。旋转组件回归 6/6，完整旋转旅程连续复跑 3 次通过（含 setup 4/4）。最终 `./scripts/run-node22.sh env E2E_SOFTWARE_WEBGL=true npm run check:full` **exit 0**：typecheck、lint、96 文件/928 项常规测试、生产构建、覆盖率 56.92/52.34/61.80/57.44、真实 PostgreSQL 39 文件/166 项、生产 Playwright **64/64**。
- 前两轮完整门禁各有 1 项触摸精度失败；原生事件确认测试取坐标时，延迟挂载的入场动画尚未结束。现明确等待动画挂载及完成后读取几何，没有禁用动画或放宽角度断言。修正后的连续复验及最终完整套件通过，原始失败命令和原因已保留在进度中。
- `next-env.d.ts` 已恢复原开发引用，恢复后 typecheck exit 0。测试报告目录和本轮临时日志/探针已清理，审查截图保留；Docker 仅保留原有健康开发 PostgreSQL。未运行 Compose smoke、Compose 构建、实体手机或 Safari 测试；触摸覆盖来自 Chromium 原生触摸事件模拟。
- 状态与结构核验通过：根 37 项、归档 53 项、全局 90 个唯一 ID，依赖、进度索引及 264 个本地链接有效。`featuresNumber=37`，跳过归档；`git diff --check` exit 0，status 已核对，生成文件无残留差异。

## 恢复路径与唯一下一步

- 依次阅读 AGENTS.md、feature_list.json、所选任务进度及本文件；新会话使用 `./scripts/run-node22.sh ./init.sh` 建立基线，本地预览使用 `./scripts/run-node22.sh npm run dev`。本轮未提交、未推送、未部署，保留当前工作区和用户 JPG。
- 唯一下一步：在 `/home` 页面验收新版单手柄的 ±25° 旋转体验及右键菜单外观。
