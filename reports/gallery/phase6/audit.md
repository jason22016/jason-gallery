# Jason Gallery Map Phase 6 — Final Parity Audit & Stabilization

审计日期：2026-09-13。Jason 起始提交：`e48d25e36f2790c263c0c9223c9f9440377c6f41`。

重新通过 GitHub tree API 确认 Afilmory 当前 main：`1f65cde6672e5231599182620116ac904e39f548`，与 P0–P5 参考一致。开始前完整阅读 DESIGN.md；重新下载并阅读 metadata/MiniMap、modules/map、components/ui/map、lib/map、map-utils 的全部文件（包含测试、导出和完整 style JSON）。设计文档与仓库保存的规范一致；底图 JSON 逐字一致。全部上游参考的 SHA-256 见 `licenses/map-phase6-upstream.json`。

本地阅读范围包含整个 gallery/map、PhotoMap、map-state、MapNavigation、ProjectGallery、Panel、modal、photos、Viewer metadata/PhotoViewer、MiniMap、HoverCard、相关 CSS、semantic tokens、共享 primitives、useMobile/useReducedMotion 与所有 map/history/cluster 测试。视觉结论来自当前源码逐项比较及本地截图检查，未宣称上游与本地实时截图逐像素一致。

## A. 已与 Afilmory 基本对齐

| 对象 | 审计结论 |
| --- | --- |
| MiniMap 底图 / center / zoom | 同一个 CARTO Dark Matter 矢量 style、sprite、glyph、layers；经纬度居中，zoom 15，非交互小地图，160px 高。 |
| MiniMap marker / 状态 / material | 居中圆点、loading 覆盖层、8px radius、hairline 边框；Jason 使用 semantic accent，并额外保留坐标与错误状态。 |
| MiniMap attribution / 点击 | OSM/CARTO attribution 可访问；小地图和文字链接指向同一个地图上下文，普通点击走 history，修饰键保留原生链接行为。 |
| Photo Marker 默认 / hover / focus | 40px 圆形缩略图底、半透明玻璃、camera icon；hover/focus 放大 1.1、pressed .9、Spring entry；有显式 focus ring。 |
| Photo Marker selected / ring / z-order | 独立 selected marker、accent 填充、selection pulse；默认 10、hover/focus 20、selected 30，portal card 60。 |
| Photo Card 两种入口 | 延迟 hover/focus card（400/100ms）与持续 selected anchored card 分离；320px 宽、128px 图片、title/date/camera/GPS/altitude、close、Viewer link。 |
| Photo Card desktop / mobile | Radix 碰撞定位、视口内 max-height、可滚动；触摸点击选择直接打开 anchored card，图片及标题进入 Viewer。 |
| Cluster size / count / mosaic | 同样的 logarithmic size，40–64px；真实 point count、最多四张 mosaic、hover/focus 300/150ms 预览。 |
| Cluster grid / +N / metadata | 最多六张 thumbnail、三列 grid、+N 按总数计算；日期来自整簇聚合，GPS 四位精度；原生 expansion zoom。 |
| Map shell | 桌面 full-area map、左上 back、右上 info、左下 grouped zoom/compass/geolocation、loading、empty/error；移动端保留安全区域。 |
| DESIGN | chrome 消费 semantic tokens；material 与角色 blur 配对；16/12/8px radius 层级、共享淡阴影、Spring、表内 z-index、LinearDivider 和现有 primitives。未复制上游地图的 neutral ramp、硬阴影、120px 任意 blur 和 CSS 空间 tween。 |

## B. Jason Gallery 有意保留的差异

- **Project scoped map**：沿用 Project 路径、当前筛选、排序和 qualified photo identity；不引入全站 `/map` route 或全局 photoLoader。
- **原生 MapLibre clustering**：沿用 GeoJSONSource clustering、真实 leaves/expansion zoom、worker 与 viewport-bound HTML marker registry；不迁移 react-map-gl 或上游距离算法。
- **现有 history 模型**：`panel=map` / `mapPhoto` / Viewer `photo` 分工；选图 push、筛选 replace、Viewer 换图 replace、owned Viewer Close 返回前一条 history。与上游 replace selection / 新标签页 Viewer 不同。
- **同任务 Viewer**：Photo Card 图片和标题进入现有 Viewer；返回保留地图 viewport 和 selection，不使用 full reload / location.href 跳转。
- **更强 fallback / accessibility**：15s timeout、retry、module/network/WebGL error、可用的照片列表、有效零坐标、thumbhash、键盘 button、aria-pressed/expanded、Escape、焦点返回和 reduced motion。
- **移动端 Drawer**：沿用 Vaul、safe area、visual viewport 与 handle；无 hover 依赖。控件使用现有设计规范的 32px button，而非上游 48px 地图控件。
- **聚类预览只读**：六张 preview thumbnail 不直接打开 Viewer；先点击/键盘展开 cluster，再选择 marker/card，或使用照片列表。保留 P4 的 bounded leaves 路径。
- **底图统一入口**：getMapStyle 返回独立 clone，避免实例间修改共享配置；不添加上游站点级自定义 mapStyle / projection 配置。

## C. 本阶段发现并修复的问题

| 问题 / 根因 | 修改文件 | 验证 |
| --- | --- | --- |
| MiniMap error 被之后 idle 覆盖为 ready，导致缺失 sprite/tile 的地图被错误标成成功；canvas context-loss listener 未显式移除 | `src/components/viewer/MiniMap.tsx` | fail 标记与清除 timeout；idle 只能在未失败时 ready；removeEventListener 后 remove。新增 sprite 503 → 后续 idle 仍 error、无 marker、有地图入口的浏览器回归。 |
| Photo Card → Viewer 丢弃真实 trigger，Close 回地图只得到 Gallery 地图按钮焦点 | `src/components/gallery/ProjectGallery.tsx`, `PhotoMap.tsx` | 保留 card trigger；地图重新 ready 且对应 marker 挂载后仅恢复一次焦点。不改 selection / viewport，不重写 Viewer。selected 与 hover card 返回的键盘焦点回归。 |
| `panel=map&mapPhoto=visible&photo=filtered-out` 深链触发 Gallery 旧筛选清除逻辑，地图上下文和 URL 筛选不再一致 | `src/components/gallery/ProjectGallery.tsx` | 仅对 map-context Viewer 保留 filters；已有越界 Viewer sequence 处理仍可看图。新增 refresh、Close、Back/Forward、mapPhoto、filter/sort/view/columns/hash 全链路回归。 |
| MapLibre Marker.addTo 自动为宿主添加 role=button / aria-label=Map marker，与内部真实 button 形成嵌套及重复无意义名称 | `src/components/gallery/PhotoMap.tsx` | addTo 后移除宿主自动语义，保留内部照片/聚类按钮和 focus ring；真实混合 cluster/photo 地图回归断言无默认 Map marker 按钮。 |
| P5 全屏 shell 后仍保留旧半屏 photo-map height/radius/border/margin，全部被 MapExperience 覆盖 | `src/styles/gallery.css` | 查询所有调用确认 PhotoMap 仅在 map-panel 中使用；移除旧 layout 属性，保留 overflow 和 background。桌面/移动地图既有测试。 |

来源记录同步到 `THIRD_PARTY_NOTICES.md`、`licenses/map-phase6-upstream.json` 和 actively checked `viewer-visual-upstream.json`。未改 backend/photo pipeline、Viewer engine、clustering algorithm 或非地图 UI。

### 状态 / lifecycle / 性能 / 可访问性

- Gallery → Viewer → MiniMap → Map → selected Marker → Card → Viewer → Close → Map，含 Back/Forward、refresh、direct entry、无效/其他 Project/no-GPS/filtered mapPhoto 均有浏览器测试。
- 保留 Project、filters、sort/view/columns、hash；无效 mapPhoto 只清该参数。无 GPS 时无 MiniMap，地图展示 empty；无效 Viewer photo 仍走现有提示。
- viewport 是任务内暂态：Viewer/普通地图重开恢复用户 pan/zoom；MiniMap 明确重聚焦当前照片。刷新/新深链按 mapPhoto 重新 zoom 15，不声称 URL 持久化任意 camera。
- 单个地图 effect 在 dataset/retry 变化时创建，cleanup remove；普通 selection/pan/zoom 不重建实例。Observer disconnect、timeout 清除、context-loss listener 移除；其余 Map event listener 随 Map.remove 清理。
- photo registry 去重 tile/world copy、仅 loaded unclustered/selected viewport marker mount；cluster registry generation + identity + latest-request 防 stale leaves/expansion；请求数限制 4/6，缓存/在途去重。
- 不从地图 preview 请求原图；thumbnail 失败保留 thumbhash/camera。正常照片列表折叠，失败时打开，lazy thumbnails；浏览器缓存复用同 URL。
- render 查询仍跟随 MapLibre render，以确保 tile/source/viewport 变化同步；未为无实测问题重写。selected card 的测量 RAF 在 unmount 取消。
- Marker/Cluster 都是 keyboard button，有 focus ring；selected 使用 aria-pressed/expanded，card link/close 可聚焦。Escape 首次清 selection 并返回 marker，再退出地图；Card 的 Tab 与 Panel 焦点边界协作。mobile 点击可完整访问；CSS pulse 与空间 Spring 响应 reduced motion。
- 未发现旧可见 circle photo layer、旧 cluster UI、重复 map style/helper、废弃 URL adapter 或未调用 fallback。透明 `clusters` circle layer 仍让 GeoJSONSource 参与渲染/加载，是 marker registry 数据路径的一部分，**保留**；error list、mobile Drawer 与 accessibility fallback 同样保留。

### 边界验证与测试

已有与新增测试覆盖：无 GPS、单 GPS、同坐标多张（展开后逐张键盘选择）、跨洲/经度接近 ±180°、filter 后 0/1/多张、无效 mapPhoto、CARTO source 网络失败、sprite 503、loading timeout/retry、WebGL context lost、geolocation denied、快速开关地图、快速换照、快速 cluster zoom / stale Promise。

另用含真实 place/hamlet label 的 MVT fixture 触发 CARTO 字体请求 503，确认 MapLibre 内建 glyph 降级会保留底图、selected Marker、照片列表与 Viewer 入口。sprite 503 与 source 网络失败则走 error 状态。同坐标高 zoom 的 Marker 几何重叠与上游相同，全部照片可从键盘/列表访问；本轮不增加 spiderfy。覆盖面积沿用上游近似公式，不是跨日期线测地面积。真实服务 availability 与实机 Safari/GPU/移动浏览器仍应在 Preview 冒烟确认。

| 检查 | 最终结果 | 日志 |
| --- | --- | --- |
| pnpm check | PASS | `check.log` |
| pnpm test:website | 82 / 82 PASS | `website.log` |
| pnpm test:viewer | 55 / 55 PASS，包含 bundle/provenance 检查 | `viewer.log` |
| map / URL / cluster 单元回归 | 14 / 14 PASS（也包含于 Website 套件） | `map-unit.log` |
| pnpm check:upstream | PASS | `upstream.log` |
| pnpm build | PASS，4 pages | `build.log` |
| git diff --check / Phase 6 provenance hashes | PASS | 最终工作区检查 |

浏览器：Chromium 151.0.7922.34 / 软件 GPU fixture。初次受限沙箱运行无法监听本地 HTTP 端口，改用允许本地 fixture 服务的执行方式后完整通过。Viewer 首次运行发现 MiniMap 适配哈希未同步，补充适配说明及哈希后全套通过。新增同坐标测试首次未等待 MapLibre ready；改用已有 ready deadline 后通过。glyph 故障 fixture 使用 zoom15 实际读取的 name 字段，并验证库的内建标签降级，而非错误地要求整张地图失败。

## D. 仍未对齐的差异

| 差异 | 分类 | 收尾影响 |
| --- | --- | --- |
| Project map、native clustering、query history、同任务 Viewer、Drawer、readonly cluster preview、控件尺寸、semantic styling、额外 attribution/fallback | intentional | 见 B；应保留，不阻塞 Preview。 |
| MiniMap 圆点用静态 semantic accent ring，上游有 blue ping；marker/cluster glass 的 accent tint、阴影和 blur 不逐像素相同 | low priority / intentional | 遵循 DESIGN 与 reduced motion；无功能缺陷。 |
| 未提供上游 siteConfig 的自定义 mapStyle / projection 配置 | intentional / future optional | 继续使用已验证的 CARTO Mercator style；本轮不新增 provider/configuration 功能。 |
| 未选择照片的单 GPS 地图初始 zoom 9，上游 auto-fit 单点 zoom 13（MiniMap/deep-link 均为 15） | low priority | 不影响定位、选择或缩放；本轮保留现有初始视角。 |

**结论：地图体验已经可以结束本轮开发并进入 Preview Deployment。**

未发现阻塞收尾的已知地图 bug。P0–P5 核心行为、history、error/accessibility fallback 已保留并验证，本阶段不新增地图功能，不开始 P7。Preview 后进行真实 CARTO 可用性与目标设备浏览器冒烟即可；本阶段没有执行部署。
