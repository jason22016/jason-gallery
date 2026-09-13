# Jason Gallery 地图体验 Phase 1

## 上游依据与范围

2026-09-13 查询 Afilmory 当前 main，提交为
`1f65cde6672e5231599182620116ac904e39f548`。修改前完整阅读远端
[DESIGN.md](https://github.com/Afilmory/afilmory/blob/1f65cde6672e5231599182620116ac904e39f548/DESIGN.md)，
与仓库 `docs/viewer/AFILMORY_DESIGN.md` 的 SHA-256 一致。
研究 MiniMap、MapSection、GenericMap、MapLibre、map-utils、地图路由及照片路由。

复用上游模式：MiniMap 持有照片对应的站内地图链接；URL 照片 ID 解析为
GPS 和 zoom 15；显式初始视图优先于全图 fit；独立的 selectedMarkerId
传入地图。没有复制上游的全站 photoLoader、React Router、react-map-gl、
地图控件/marker/cluster UI，或 DESIGN.md 不允许的颜色、动效与层级。

适配：Astro Project URL 及原生 History API；已有的 `ViewerPhoto.location`
适配和 GPS 校验（包含 0 坐标）；只从 `visible` 中解析地图照片。
通过局部 React context 给现有 Inspector 的 MiniMap 与文字链接提供同一
href/导航回调，避免修改 Viewer 动画、手势和关闭流程。普通点击在当前页导航，
修饰键点击保留浏览器原生链接行为。

新增链接使用现有 `.viewer-minimap-link` / `.metadata-map-link` 以及 accent
focus-visible 样式，不新增 CSS、颜色、material、blur、圆角、motion 或 z-index。
上游与本地文件摘要见 `licenses/map-phase1-upstream.json`；许可证及修改说明
见 `THIRD_PARTY_NOTICES.md` 的 Map Phase 1 小节。

## URL 与 history

- 地图：`/projects/<slug>/?panel=map&mapPhoto=<id>`。
- Viewer：`photo=<id>` 仍只表示当前打开的照片。地图上打开 Viewer 时两者可共存，
  例如 `panel=map&mapPhoto=A&photo=B`；关闭 Viewer 后仍回到地图选中 A 的状态。
- MiniMap → Map：复制当前 URL，删除 `photo`，设置 `panel=map` 和 `mapPhoto`，
  一次 `pushState` 写入新条目并清空该条目的 `galleryViewer`，卸载 Viewer。
  保留前一个 Viewer 条目的 owner、filters、sort、view、columns 与 hash。
  Back 返回原 Viewer，Forward 返回地图；返回 Viewer 后点关闭仍遵守原 owner 逻辑。
- 刷新/直达/popstate 从 URL 恢复 Panel 与地图照片。不存在、跨 Project、无有效
  GPS 或被当前 filters 排除的 ID 以 `replaceState` 清除，保留地图和原筛选。
  没有 `panel=map` 的孤立 `mapPhoto` 同样清除。
- 关闭地图或切换其他 Panel 会清除 `panel`/`mapPhoto`；筛选仍按已有 replace
  机制更新，不新增历史条目。
- 明确通过 MiniMap 导航会重新定位 GPS、zoom 15、bearing/pitch 0。
  用户平移/缩放后从地图打开并关闭 Viewer，或关闭并重开普通地图，仍恢复已有
  viewport。缓存按当前 visible IDs 与选中照片区分，避免其他照片的旧视口覆盖
  新选中目标。刷新通过 mapPhoto 重建初始定位，不依赖内存缓存。

本阶段只建立选中状态并传到地图及现有照片列表的 `aria-current="location"`；
不添加新的 marker 视觉或卡片。Marker 点击仍按原行为打开 Viewer。

## 修改文件

- `src/components/gallery/map-state.ts`：Project/visible 范围解析、GPS 初始视图、URL 构造。
- `src/components/gallery/MapNavigation.tsx`：局部导航 context 和共用站内链接。
- `src/components/gallery/ProjectGallery.tsx`：独立地图照片状态、URL/history 和 viewport 适配。
- `src/components/gallery/PhotoMap.tsx`：接收选中照片，响应变化，保留原地图行为。
- `src/components/viewer/MiniMap.tsx`、`MetadataPanel.tsx`：站内主入口和 OSM 次级入口。
- `tests/website/map-state.test.ts`、`website.test.ts`：URL、联动及边界回归测试。
- `tests/viewer/visuals.test.ts`：把旧 OSM 主入口断言迁移至保留的次级入口。
  Website 加载测试的两处旧文案断言同步为仓库 HEAD 已使用的“加载中”，不改加载行为。
- `licenses/map-phase1-upstream.json`、`licenses/viewer-visual-upstream.json`、
  `THIRD_PARTY_NOTICES.md`：源代码与许可证记录；仅更新已审阅修改的本地摘要。

## 验证

定向测试：6/6 通过。真实 MapLibre/WebGL 画布验证照片 GPS 居中；通过两张
已知坐标照片的像素间距校验 zoom 15。地图服务使用确定性测试素材，避免外部
网络波动；P0 底图本地样式文件及加载/resize/fallback 代码保持原样。

覆盖 MiniMap 与文字入口一致、切换照片后重新定位、filters/sort/view/columns
保留、地图直达及刷新、Back/Forward、Viewer Close owner 行为、地图平移后恢复、
无效/跨项目/无 GPS/筛选外 ID、有效零坐标、手机无 WebGL 时仍可从 MiniMap
进入地图。最终验证结果：

| 命令 / 检查 | 结果 |
| --- | --- |
| `pnpm check` | 通过 |
| `pnpm test:viewer` | 55/55 通过；含 P0 MiniMap 本地样式、WebGL、resize 与 attribution |
| `pnpm test:website` | 50/50 通过；含新增 2 项 URL 单测和 4 项地图联动测试 |
| `pnpm build` | 通过 |
| `pnpm check:upstream` | 通过；Viewer 核心保持基线 |
| `git diff --check` | 通过 |
| 地图 Phase 1 来源记录 | 6 个修改文件的 SHA-256 全部匹配 |
| 离线截图验收 | 合成照片与虚构坐标；外部请求全部拦截/阻止；入口与地图聚焦正常 |

完整日志位于 `.cache/map-phase1-{check,viewer,website,build,upstream}.log`。
截图位于 `.cache/map-phase1-offline-{inspector,map}.png`。

补充的真实项目联网底图检查被自动审批拒绝：瓦片请求可能向外部服务透露照片
GPS。未执行该真实位置联网检查；已完成的底图验证使用合成坐标、本地/拦截的
测试素材与真实 MapLibre/WebGL，不能据此声称线上瓦片服务在当前网络可用。

## 留给 Phase 2

Photo Marker 视觉、Hover Photo Card、Cluster UI / clustering 算法、Map Controls、
Map Info Panel、大地图整体视觉。Viewer 大规模重构和无关 CSS 不在本次范围。
