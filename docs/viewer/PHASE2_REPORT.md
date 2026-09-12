# Phase 2 — Viewer Visual & Inspector Parity

已以完整的 `AFILMORY_DESIGN.md` 为规范完成 Viewer / Inspector 的视觉对齐。
上游 `Afilmory/Afilmory` HEAD 于 2026-09-12 核实为
`1f65cde6672e5231599182620116ac904e39f548`。

Viewer 现在固定为深色；控制、Inspector、Sheet、缩略图预览使用同一套
macOS material、角色对应的 blur、由照片提取并限制对比度的 accent、hairline
与多层低透明阴影。Geist 字体与 MingCute 图标资源均在仓库内。
桌面箭头与次要操作默认隐藏，hover 或键盘 focus 时显现；手机不显示左右箭头。
手机按钮外观为 32px，通过不可见边距保留 44px 点击区域。

迁移范围：

| 上游实现 | 本地结果 | 适配说明 |
| --- | --- | --- |
| `HistogramChart.tsx` | `src/components/viewer/HistogramChart.tsx` | 保留 128 bins、RGB + Rec.709 luminance、DPR canvas、gradient-strip renderer、screen 混合和 grid；加入语义材质、共享 Spring、ResizeObserver、reduced motion 与可访问的状态文本。 |
| `ExifSection.tsx` / `formatExifData.tsx` Row | `ExifSection.tsx` | 沿用 section / Row 结构，转为作用域 CSS 和语义化 dl/dt/dd；按照 DESIGN.md 使用 12px metadata，不截断完整值。 |
| `ExifPanel.tsx` / `InspectorPanel.tsx` | `MetadataPanel.tsx` / `DesktopInspector.tsx` | 320px shell、材质渐变、accent glow、header、独立滚动内容和 spring；数据读取仍使用 Jason 的独立 metadata JSON。 |
| `PhotoViewer.tsx` 背景 presence | `ViewerBackdrop.tsx` | 迁移 keyed ThumbHash crossfade；无有效 hash 时等待缩略图解码后交接，避免闪空白或被迟到请求覆盖。 |
| `MiniMap.tsx` / `MapLibreStyle.json` | 同名本地文件 | 160px 高、zoom 15、固定中心点、不拦截手势；样式 JSON 原样复制。使用现有 MapLibre，滚动进入可见区域后初始化；支持零坐标、失败状态、resize、清理及 OSM/CARTO attribution。 |
| `ActionButton.tsx` | `ActionButton.tsx` | 保留上游 props / DOM 结构，Tailwind utilities 转为本地 CSS。规范的 ActionButton 已满足实际 Viewer 控件需求，未迁入 GlassButton 中不符合 DESIGN.md 的 40px / 单层重阴影样式。 |
| `lib/color.ts` | `color.ts` | 直接移入平均颜色与 2.2–4.5 对比度 clamp；适配原生 hex ThumbHash，补非法输入检查。 |
| `icons/index.tsx` 前五个拍摄图标 | `CaptureIcons.tsx` | 直接移入源 SVG 并保留作者来源。 |
| `packages/ui` material / border / divider | `ViewerTokens.css` / `PhotoViewer.css` | 使用真实 UIKit dark token 数值；结构边线为淡出的 0.5px gradient，阴影为上游低透明多层组合。 |
| Phase 1 已迁入的 `GalleryThumbnail` / `HoverCard` / mobile Sheet | 原组件继续使用 | 精修材质、border、grayscale / opacity、圆角、safe-area；当前缩略图 scale 改用共享 Spring。 |

元数据排列为：基本信息 → 拍摄参数 → 照片说明 → 标签 → 影调分析 →
直方图 → 设备信息 → 拍摄模式 → 胶片模拟配方 → GPS / 拍摄位置 → 技术参数。
不存在数据的 section 自动省略。拍摄参数使用 compact chips，标签使用 pill，
影调统计使用两列密集行。配方先按上游顺序排列，未知/额外字段仍完整保留；
说明、原始技术数值、单位、时区和零值均保留，换图时不会展示上一张的详细信息。

与上游仍有的明确差异：

- 保留 Jason 的计数器、原图入口和桌面缩放工具；上游 cloud comments、regions
  和 raw-EXIF modal 不属于本阶段的 Jason 功能。
- 标签为完整可读的静态 pill；未引入上游的全站标签路由或改动 Jason 搜索页面。
- metadata 长值换行展示，不采用上游截断 + tooltip；桌面使用原生 thin scrollbar
  与边缘渐隐，未引入整套 Radix ScrollArea。
- 背景 ThumbHash 采用 60% wash；Sheet 打开时 opaque 基底保持完整，向下 dismiss
  时仍跟随 Phase 1 手势透明度。
- MiniMap 的点击入口为 OSM，marker 使用照片 accent 并去掉持续 ping。
  底图数据仍来自 CARTO / OSM；网络或 WebGL 不可用时显示坐标与外部链接。
- 直方图按上游基于缩略图采样，不是 HDR 辐射测量工具；主照片原图、ICC、HDR
  和 GPU 渲染路径保持原实现。动画使用规范的共享 Spring 取代上游局部手写 spring。
- 规范优先于 legacy deviation：不沿用 3xl / xl blur、light Viewer、magic z-index、
  大号 mobile 控件或 metadata 的非语义灰色。

必要的视觉衔接修正仅在 Viewer adapter：shared-element 读取实际 sidebar / thumbnail
高度，覆盖 Inspector 动画与 safe-area；跨越手机/桌面断点时不再清空已加载照片的
renderer readiness。Swiper、Virtual、gesture engine、history、URL、图像解码、HDR
shader 和同步/build pipeline 未修改。Viewer 测试分组串行运行，避免软件 GPU 竞争
影响原生触摸事件时序；取消触摸后保留浏览器处理该序列的短暂间隔。

所有迁移/适配的来源、commit、license 与哈希见 `THIRD_PARTY_NOTICES.md`、
`licenses/viewer-visual-upstream.json` 和更新后的
`licenses/viewer-interaction-upstream.json`。无 submodule、外部 checkout import、
runtime 源码下载或 GitHub 源码包依赖。

最终验收（2026-09-12）：

| 检查 | 结果 |
| --- | --- |
| `pnpm check` | 通过，无 TypeScript 错误。 |
| `pnpm test:viewer` | 53 / 53 通过，无跳过。 |
| `pnpm test:website` | 29 / 29 通过，无跳过。 |
| `pnpm build` | 通过，生成 4 个页面。 |
| `pnpm check:upstream` | 通过，核心图像渲染上游哈希保持一致。 |
| Phase 1 interaction provenance | 23 个迁移/适配文件验证通过。 |
| `git diff --check` | 通过。 |

回归覆盖键盘与 browser back/forward、Swiper、原生触摸、pinch/cancel、
shared-element、safe-area、reduced motion、响应式断点切换、原图缩放、
HDR 重建和 WebGL fallback；新增检查覆盖 Inspector 连续 spring、背景交叉淡化及
过期加载取消、128-bin RGB/luminance、metadata 额外字段与零 GPS、真实 WebGL
MiniMap、32px 外观 / 44px 点击区域以及迁移文件来源完整性。

已在隔离的本地预览中检查 1280×900 桌面和 390×844 手机布局。截图：

- [桌面 Viewer](../../.cache/phase2-desktop-viewer.png)
- [桌面直方图与技术参数](../../.cache/phase2-desktop-histogram.png)
- [手机 Inspector Sheet](../../.cache/phase2-mobile-inspector.png)

截图和检查日志存于本机 `.cache/`，不属于发布资源。
