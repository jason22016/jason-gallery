# Jason Gallery 地图体验 Phase 5

设计来源为 Afilmory 当前 main `1f65cde6672e5231599182620116ac904e39f548`，已在实现前完整阅读 DESIGN.md；其内容与仓库现有设计规范副本一致。

- 复用 MapSection 的全区域地图及浮动布局、MapControls 的控件分组/相机操作/定位选项、MapInfoPanel 的展开结构/坐标卡片/近似覆盖面积公式、MapBackButton 的返回箭头与 glass 手势、MapLoadingState 的位置图标与加载层级。源码及 SHA-256 记录见 `licenses/map-phase5-upstream.json` 和 `THIRD_PARTY_NOTICES.md`。
- 沿用已迁移的 ActionButton、Spring、EllipsisWithTooltip、LinearDivider、semantic material/blur/shadow tokens、useMobile 和 useReducedMotion。已检查 LinearBlur；现有页面边缘继续使用它，地图没有新增固定滚动标题带。未复制第二套通用按钮 primitive。
- 桌面地图填满视口；返回位于左上、Project 信息位于右上、缩放/Compass/定位位于左下。照片列表正常时收起，地图失败时自动显示；右侧范围信息与列表纵向排布，展开后仍可分别操作。所有 chrome 使用 semantic glass、规范圆角、共享 Spring 与规范层级；返回按钮使用 control blur，浮动面板和控件组使用 panel blur。
- Astro/Project 架构适配保留 Radix Dialog、Vaul Drawer、移动端手柄、安全区域、visual viewport、焦点边界、ProjectGallery URL/history 与原生 MapLibre。信息数量和 bounds 基于 filtered visible photos 中的有效 GPS；GPS 为零及负坐标均有效。定位权限拒绝、缺少支持、同步异常及过期回调安全处理。
- MiniMap 与 PhotoMap 现在共用 `map/map-style.ts`，每次独立 clone 现有未改动的 MapLibreStyle.json。底图、sprite、glyph 来源保持一致。
- 保留 MapLibre error、WebGL context lost、15 秒 timeout、retry、无 GPS 空状态与照片列表 fallback。Marker、Card、Cluster、Viewer 和后台/pipeline 的实现没有改写。

## 修改文件

现有实现：`gallery/Panel.tsx`、`gallery/PhotoMap.tsx`、`gallery/ProjectGallery.tsx`、`gallery/GalleryIcons.css`、`viewer/MiniMap.tsx`。

新增地图组件/helper：`gallery/map/MapBackButton.tsx`、`MapControls.tsx`、`MapInfoPanel.tsx`、`MapLoadingState.tsx`、`MapPhotoList.tsx`、`MapExperience.css`、`map-bounds.ts`、`map-style.ts`（均在 `src/components/` 下）。

测试：`tests/website/gallery.test.ts`、`website.test.ts`、`multi-source.test.ts`、`map-fixture.ts`、`map-info.test.ts`。更新 `licenses/gallery-upstream.json`、`map-phase1–4-upstream.json`、`viewer-visual-upstream.json` 的重叠归属记录，并新增 Phase 5 记录。

## 与 Afilmory 保留的明确差异

地图仍属于 Project Panel；移动端继续使用 Drawer。使用原生 MapLibre，保留现有 native clustering、mapPhoto 参数及 Viewer history。信息显示 Project 标题与筛选后照片，而非全站数据；错误 fallback 与可展开照片列表比上游更完整。

上游地图组件中与 DESIGN.md 相冲突的 arbitrary blur、hard shadow、neutral ramp、空间 tween 和 intra-surface z-40/z-50 已按规范适配；控件采用规范的 32px 尺寸及 control radius。覆盖面积沿用上游矩形近似计算。

初始相机策略继续沿用 P0–P4：普通入口 zoom 9、多照片 fitBounds padding 60/maxZoom 13；没有改成上游 padding 200/maxZoom 15。mapPhoto/MiniMap 入口仍按上游 zoom 15 聚焦。

## 验证结果

2026-09-13 最终验证：

- `pnpm check`、`pnpm build`、`pnpm check:upstream` 均通过。Viewer core 的 16 个上游文件及已审查适配保持不变；33 条 Phase 5 / 重叠来源记录与当前文件 hash 一致。
- `pnpm test:website`：77/77 通过；`pnpm test:viewer`：55/55 通过。涵盖 MiniMap 联动、刷新/Back/Forward、筛选和 viewport 恢复、Marker/Card/Cluster、Viewer、移动手势与 fallback。
- 新增四项地图集成测试：缩放/方向与倾斜重置/定位且不更换 canvas 或 URL、Project 数量/bounds 与筛选同步、320×568 定位拒绝安全处理、loading timeout/retry/context loss 及范围信息与错误列表同时可用。两项 helper 测试覆盖 GPS 有效性、近似面积与 map style clone 隔离。
- Chromium 151.0.7922.34 软件 WebGL 实测生产页面：1440×900 桌面及 390×844 手机均成功读取真实 CARTO 底图，显示云南 Project 的 52 张 GPS 照片，页面异常为零。320×568 注入底图网络失败后，坐标面板和照片 fallback 分别可滚动操作，页面异常为零。
- 构建仍有大型 chunk 提示；本阶段没有扩大为 bundle 拆分重构。

截图：[桌面](../reports/gallery/phase5/desktop.png)、[手机](../reports/gallery/phase5/mobile.png)、[窄屏错误 fallback](../reports/gallery/phase5/mobile-error.png)。

日志：[类型检查](../reports/gallery/phase5/check.log)、[生产构建](../reports/gallery/phase5/build.log)、[网站测试](../reports/gallery/phase5/website.log)、[Viewer 测试](../reports/gallery/phase5/viewer.log)、[上游校验](../reports/gallery/phase5/upstream.log)、[来源记录校验](../reports/gallery/phase5/provenance.log)、[真实底图预览](../reports/gallery/phase5/live.log)。结构化结果见 [verification.json](../reports/gallery/phase5/verification.json)。
