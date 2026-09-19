# Global Gallery Phase 2 — Explore

## 实现

`src/pages/explore.astro` 是静态路由壳，唯一照片输入为 Step 1 的
`loadPublicPhotoCollection().listPhotos()`。同一照片的 published memberships
保留，canonical ID 去重；draft-only / unused 照片、草稿 membership 不进入页面。
构建继续验证全部 Project 引用，公开资产过滤与 metadata 白名单不变。

`Gallery.astro` 同时接受 Project 或公开照片集合，只向一个 React island 传递一次
Gallery 投影。`ProjectGallery` 的主体移为 `PhotoGallery`，Project 适配器仍保留。
Masonic、MasonryView、MasonryPhotoItem、ListView、PhotoThumbnail、FilterChip、
ViewPanel、ViewModeSegment 及全部 Viewer 源码直接复用，未创建 ExploreGallery。
SearchPanel 接受共享 facets 与类别，PageHeader 根据上下文显示项目专属操作。
Panel 在 Radix/Drawer 完成卸载时恢复显式触发按钮，修复移动端 reduced-motion
即时关闭时焦点落到 body 的情况。

阅读并延续 [Afilmory DESIGN.md](https://github.com/Afilmory/afilmory/blob/main/DESIGN.md)：
沿用 semantic tokens、深色材质、Spring presets、既有微状态过渡及 reduced motion。
首页不改变 Projects 布局，只加入导航；图库头部使用同一导航的紧凑菜单。
Map 标为尚未开放，不生成 `/map/`，Explore 也不开放 `panel=map`。
Project Gallery 地图以及 Viewer 内的 MiniMap 显示保留。

## 筛选与 URL

共享 `selectPhotos` / `galleryFilterOptions` / `readGalleryState` / `galleryStateURL`
处理 Search、Date、Camera、Lens、Tag、Project 和 Sort，不增加 Explore 专属逻辑。

| 参数 | 值 |
| --- | --- |
| `query` | 搜索词，沿用逐词匹配 |
| `project` | Project 永久 ID；选项和 chip 显示标题 |
| `start` / `end` | 拍摄日期 YYYY-MM-DD，包含边界 |
| `camera` / `lens` / `tag` | 共享 facets 的原值 |
| `sort` | `asc` / `desc`；省略为 `project` 编排顺序，未知日期最后 |
| `view` / `columns` | 保留既有视图与列数参数 |
| `photo` | 当前 canonical photo ID |

筛选与排序沿用 `replaceState`，避免每次输入创建历史条目；`popstate` 恢复完整
筛选快照。Viewer 打开时 push，切图 replace，关闭自有条目时 Back；刷新/直接进入
的 Viewer 关闭时只移除 `photo`。其余查询参数和 hash 保留。清除筛选保留排序与视图。

Explore Viewer 仅接收 `visible`，前后导航与 filmstrip 不会包含其他筛选结果或重复
membership。无效、未公开、与筛选不符的 photo URL 会移除 photo 并提示，保留原
筛选。Project Gallery 已有的外部 photo 深链接与地图 history 语义继续保持。
详情继续从每张照片的 `detailsUrl` 按需读取，不新增 Global Viewer 或详情副本。

## 性能与数据边界

- 沿用 Masonic 与 ListView 虚拟化、ThumbHash、lazy thumbnail 和按需原图加载。
- Explore 静态预览最多 24 张；禁用 JavaScript 时提示启用后浏览全部。避免每张照片
  再生成完整静态节点树；完整轻量公开数组仍传给原有客户端 selector，没有引入分页。
- Viewer 外壳保持现有预加载以避免首次打开闪烁；GPU/图片引擎、详细 metadata、
  MiniMap 的网络与重模块加载保留原边界。不修改 HDR / SDR、色彩或 motion pipeline。
- 480 张两重 membership 的浏览器 fixture 验证瀑布流 DOM 和首屏缩略图请求均少于
  100，列表 DOM 少于 30；筛选后的 240 张 Viewer 序列仍可恢复滚动和焦点。
- production fixture 逐文件检查 draft/unused ID 与草稿内容不进入 HTML/JS/JSON，
  其原图、缩略图和伪造 metadata URL 均为 404。island 不含原始 EXIF/Manifest 字段。
- 真实本地内容：2 个公开项目、154 张公开照片；1440×900 首屏挂载 50 张，单一 island
  序列化 props 为 271,151 bytes，静态预览 24 张；没有原图/详情请求、运行时错误或
  320px 移动端横向溢出。完整公开数组的体积仍随照片数线性增长。
- `/explore/` 纳入 sitemap、canonical/OG 与 release 精确输出白名单；不开放通用目录。

## Step 3 可复用接口

Global Map 可消费 `PublicPhotoCollection`、`GalleryPhoto.projects`、共享 facets、
`selectPhotos` 返回的同一照片引用及 URL helpers。坐标与 `detailsUrl` 已在公开投影中，
既有 `resolveMapPhoto`、map marker/cluster 和 Viewer 输入契约可以继续复用。
本阶段没有实现全站地图或新数据源。

## 验证

2026-09-20 最终验证：

| 检查 | 结果 |
| --- | --- |
| `pnpm check` | 通过 |
| Projects | 48/48 |
| Viewer | 65/65，含 bundle/worker 与上游来源检查 |
| Website / Gallery | 106/106，含新增 8 个 Explore 场景、480 张全局集合测试，以及 Step 1 visibility tests |
| SEO | 4/4 |
| Automation / Release | 23/23 |
| Admin | 101/101 |
| 真实 metadata | 1/1，154 张真实照片 |
| `CI=1 pnpm test` | 完整链通过，348 项测试，无失败、无跳过；照片 smoke 同时通过 |
| `pnpm build` | 通过，5 个页面，含 `/explore/` |
| `node --import tsx scripts/upstream/check-viewer-interactions.ts` | 23 个来源记录通过 |
| `git diff --check` | 通过 |

`CI=1` 只启用仓库已有的浏览器就绪超时倍率，不改变动画时序或测试断言。
第一轮回归发现 Panel 关闭后快速重开时的焦点竞争，修复后相关用例及完整链均通过。
公开数据测试检查 HTML/JS/JSON 和原图/缩略图/详情路径；交互测试覆盖所有 facets、
组合、重置/清除、日期排序、URL direct entry/refresh/Back/Forward、Viewer filtered
sequence、共享元素过渡、focus trap/restoration、mobile、reduced motion 和 empty state。
真实 production build 的桌面/手机截图已检查。测试日志与截图存于本地 `.cache/`，
不提交或发布；正式 Project、照片索引和缩略图未修改。
