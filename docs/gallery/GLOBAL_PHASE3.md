# Global Gallery Phase 3 — Global Map

`/map/` 是静态路由壳，只读取 `loadPublicPhotoCollection().listPhotos()`，再用
已有 `validLocation` 校验 GPS。canonical ID 去重、published memberships 和公开
详情 URL 继续由 Step 1 提供；draft-only、未引用、无 GPS、越界 GPS 不进入 Map
island、marker、cluster 或 Viewer 序列。没有扫描 Manifest 或建立第二份照片索引。

## 复用与最小扩展

- `Gallery.astro` / `PhotoGallery` 增加 `mapPage` 呈现模式，仍使用同一个 React island。
- 原 `PhotoMap` 继续提供 MapLibre worker/style/loading/retry/fallback、cluster registry、
  expansion、photo registry、marker、缩略图、hover/selected card、信息与地图控件。
  `collectionTitle` 取代 Project 专属命名；显式 Fit Results 模式允许原地更新 GeoJSON，
  非空结果变化时不重建地图、不强制 fit。初次进入自动适配，单张结果最大 zoom 13。
- 筛选暂时没有 GPS 结果时显示原地图空态。恢复结果、Viewer 返回时复用已保存的
  viewport。`mapPhoto` 直接链接仍使用现有 zoom 15 定位；Viewer 中 MiniMap 是明确
  的重新定位操作。Project Map 保留原本面板、重建/自动适配及选择行为。
- Global Map 页面打开筛选/设置面板时临时关闭 marker preview，避免 portal 覆盖
  筛选控件。地图实例和选择不受影响。
- `MapControls` 增加可选 Fit Results 按钮。其他材质、布局、控件、焦点、motion、
  reduced motion 和移动端 Drawer 均沿用既有组件与 semantic tokens，并参考
  [Afilmory DESIGN.md](https://github.com/Afilmory/afilmory/blob/main/DESIGN.md)。

## URL、筛选与 Viewer

继续使用 `selectPhotos`、`galleryFilterOptions`、`readGalleryState`、`galleryStateURL`、
`SearchPanel`、`FilterChip` 和排序面板。Project、start/end、Camera、Lens、Tag、Search、
Sort 的含义与 Explore 完全相同。Map 的 facets/count 只统计有有效 GPS 的公开照片。

`globalGalleryHref` 从共享 state 生成 Explore/Map 导航链接，保留 query/project/start/end/
camera/lens/tag/sort，不携带另一个页面的 Viewer 或 marker 选择。普通链接支持新标签页、
刷新与浏览器历史；筛选继续 replaceState，popstate 重放完整快照。

`mapPhotoURL` 支持 Global 路径，仍以 `mapPhoto` 与 Viewer `photo` 区分状态；Project
URL 保持 `panel=map`。Explore Viewer 的 MiniMap 可进入带相同筛选条件的 Global Map。
Viewer 使用当前地图筛选/排序后的完整 GPS 结果，而非视口内 marker 子集；不重复照片。
打开、切图、关闭、focus/viewport 恢复和按需详情请求复用原 Viewer。无效或筛选外的
Global photo/mapPhoto 链接移除选择，保留筛选。

`/map/` 加入共享网站导航、canonical/OG、sitemap 和 release 精确白名单。
未修改 Photo Engine、HDR pipeline、Admin，也未新增 Timeline / Stats。

## 验证

`tests/website/global-map.test.ts` 使用生产构建、原生 MapLibre worker 与本地瓦片 fixture，
覆盖 public/GPS 边界（含具有 GPS 的草稿与未引用照片）、全部筛选、导航历史、cluster/
marker/thumbnail、Viewer 唯一序列、视角保留与 Fit Results、无 GPS、module/network/GPU
失败、超时重试、context loss、320px touch 和 reduced motion。现有 Project Map、Viewer、
Explore、Website、SEO 与 release 测试同步回归。截图和运行日志保留在本地 `.cache/`。

2026-09-20 最终结果（浏览器测试使用仓库已有 CI/software-GPU 配置）：

| 检查 | 结果 |
| --- | --- |
| `pnpm check` | 通过 |
| `pnpm test:website` | 119/119，含 Global Map、Explore、Project Map、共享 filters 与 public collection |
| Global Map 最终专项复验 | 11/11，包含手机版权栏与 Fit Results 不重叠断言 |
| `pnpm test:viewer` | 65/65，bundle/worker 检查通过 |
| `pnpm test:seo` | 4/4 |
| `pnpm test:automation` | 23/23，release 精确白名单通过 |
| `pnpm build` | 通过，6 个页面，包含 `/map/` |
| 上游来源校验 | 16 个 Viewer core、23 个交互来源和 10 个本次适配记录通过 |
| `git diff --check` | 通过 |

以上测试无失败、无跳过。真实 production build 使用未 mock 的底图检查桌面 1440×900
和手机 320×568：154 张公开照片中 139 张有效 GPS，两种尺寸均为 map ready，无运行时
错误或页面溢出。实际瓦片与原有 cluster 缩略图正常显示。测试与预览未改动正式照片、
Project 内容或任何 Photo Engine / HDR / Admin 文件。
