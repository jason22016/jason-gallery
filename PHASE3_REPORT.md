# Phase 3 — Website MVP

**实现完成，完整自动测试通过。** 2026-09-10；Node 24.19.0 / pnpm 11.19.0；浏览器测试为 Playwright 1.62.1 / Chromium 151.0.7922.34（macOS）。

## 实现

- 基础 Astro 布局与全局 CSS：站点导航、响应式网格、移动端单列、语义标题、跳转正文链接、可见键盘焦点。
- `/` 只消费 `loadProjects().listProjects()`，按 Project System 顺序展示 published Projects 的封面、标题、summary、location、年份和照片数；无公开内容时显示空状态。
- `/projects/[slug]/` 只为 published Projects 生成静态页；显示已有项目字段，Gallery 严格保留 `project.photos` 顺序，直接使用 Phase 1 的 `thumbnailUrl`。description/caption 为转义的纯文本。draft 和未知 slug 不生成页面，使用 `/404.html`。
- Gallery 静态 HTML 自带原图链接；JavaScript 不可用或尚未 hydration 时仍能浏览。每个 Gallery 仅一个 React island，传入最小照片展示字段，不序列化完整 Manifest/EXIF 或草稿数据。
- Viewer 首次打开才动态导入原有 `photo-engine/browser`，复用 Afilmory `ImageViewer`。支持关闭、非循环前后切换、Escape、左右方向键、Home/End、Tab/Shift+Tab 焦点循环、关闭后的焦点恢复和背景滚动锁定。
- 保留 WebGPU → WebGL → 原图 `<img>` 路径；GPU 模块下载失败也能回退。`HDR source` 来自 Manifest，`HDR active` 仅由 `onHDRChange(true)` 驱动。包含加载提示、缩略图失败提示、原图失败/重试、切图与关闭时的旧实例清理。

## 验证

执行 **`pnpm test`，退出码 0**：

| 检查 | 结果 |
| --- | --- |
| TypeScript strict 与既有 readonly 编译期检查 | 通过 |
| Project System 测试（含非法 draft 导致 Astro 构建失败） | 46 / 46，无跳过 |
| Phase 1 网络 / Photo Engine smoke | 通过，含原生 HDR fixture、缩略图复用、冲突与失败保护 |
| 独立 Viewer bundle / worker 隔离检查 | 通过 |
| Website 生产构建与真实 Chromium 测试 | 10 / 10，无跳过 |
| 正式站点 Astro build | 通过：空首页、404、原有 health；0 published / 0 draft |

Website 用例覆盖公开路由/项目排序、独立封面、Gallery 顺序、无 JavaScript 原图浏览、draft/未知路由 404 与数据隔离、按需加载、Viewer 全部基础交互及焦点、等待中切图/关闭、资源失败与重试、GPU 模块失败、实际 Afilmory WebGPU 故障 → WebGL、GPU 全失败 → `<img>`、单图边界及 320/390/844px 视口。已检查桌面首页、Gallery、Viewer 和移动端截图。

测试位于 `tests/website/`；独立 `.cache/website-fixture/` 使用合成照片，通过**未修改的 Phase 1 CLI**生成原生 Manifest 与缩略图，仅在测试 Manifest 中改为本地原图 URL。生产 Project、Manifest 和全部缩略图在测试前后逐文件 SHA-256 一致。完整日志：`.cache/phase3-full-test.log`；截图及 fixture 构建日志位于 `.cache/website-fixture/`，均不提交。

## 边界与复现

- `ARCHITECTURE.md` 已增加 Website UI 约定；Photo Engine、Project System、上游 packages、Manifest schema、许可与前两阶段报告均未修改。正式 Project 目录仍只有 `.gitkeep`。
- 真实 Manifest SHA-256 仍为 `c342c50d25c39f301d4a9c00a1b8824ba706717ab6bb5946f25bd5425e3187d6`。
- 本次没有重下真实图库或重新验收屏幕 HDR 亮度/色彩；Phase 1 的 WebGPU/gain-map 设备验证结论与限制保持不变。Safari/Firefox、实体手机与更多真实 HDR 样本仍需后续验证。
- 未实现 Map、完整 EXIF 面板、搜索、后台管理、部署自动化或高级动画。静态托管时需由宿主正确返回生成的 `404.html`，本阶段未部署。

```sh
# 使用 .node-version 中的 Node 24.19.0
pnpm install --frozen-lockfile
pnpm exec playwright install chromium  # 首次浏览器测试前
pnpm test

# 单独重跑 Website；不依赖正式摄影 Project
pnpm test:website

# 独立测试内容预览，不写入正式内容目录
pnpm website:fixture
pnpm website:preview  # http://127.0.0.1:4323
```

完整 `pnpm test` 的最终正式站点 build 沿用 Phase 1 已导出的本地 Manifest/缩略图；新环境需先按 Phase 1 流程准备。`test:website` 与 fixture 预览自行生成测试资产。可用 `JASON_TEST_CHROMIUM` 显式指定测试浏览器；fixture 构建/测试不要并发运行或与其预览重建重叠。
