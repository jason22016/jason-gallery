# Photography Stats — Integration & Release Gate

## 联动与网站结构

一级导航为 Projects / Explore / Map / Stats。Stats 与 Gallery 共用 SiteNavigation、
PageHeader 的 PageHeaderFrame（48px 固定页头、LinearBlur 和响应式 safe area），
Project selector 继续使用 Gallery Panel 的桌面浮层与移动抽屉。
页面仍为 Overview、Cameras & Lenses、Focal Length、Exposure、When、Media，
本阶段没有新增统计指标或 chart library。

Camera / Lens 的详情区提供一个轻量的 **View in Explore** 原生链接。hover / focus
查看数据，tap / Enter / Space 固定选择，方向键与 Home / End 移动焦点，Escape 清除。
移开鼠标后保留最近查看的设备详情，Tab 到链接时不会把目标重置为 most-used；链接
位于 tooltip 语义之外，支持原生新标签页操作。没有把每根柱体改成导航按钮。

设备链接在构建时使用 `galleryFilterOptions()`、`selectPhotos()` 和
`globalGalleryHref()` 验证与生成。Statistics 会压缩设备名称的空白，而 Explore
按原字符串精确匹配；链接保存原 filter 值。多个原值合并为同一个统计 bucket 时，
现有单值 filter 无法表达完整集合，因此该 bucket 不提供会遗漏照片的跳转。
未给焦距、曝光、时刻或媒体类型增加不受现有 filters 支持的条件。

Geotagged 下的 **View on Map** 使用 `globalGalleryHref('map', state)`：All Photos
为 `/map/`，Project scope 只携带当前 Project 条件；由原 Global Map 负责有效 GPS
过滤。没有新增地图或在 Stats island 嵌入 MapLibre。

Stats 的 `?project=<slug>` 与 Explore / Map 的 `?project=<Project ID>` 保持各自
既有契约。`statsGalleryState()` 只把已解析的公开 scope 转成共享 GalleryState；
例如 `/stats/?project=yunnan-2026-02` 的跳转使用云南的永久 ID。Explore 链接只包含
设备及可选 Project，Map 链接只包含可选 Project；不带入 Stats period、hash 或其他
页面状态，也不改变共享 filter system。Stats 导航中的 Explore / Map 同样保留 scope。

## UI 与性能

实现前阅读了 Phase 1 / 2、Explore / Global Map 共享 URL state，以及
[Afilmory DESIGN.md](https://github.com/Afilmory/afilmory/blob/main/DESIGN.md)。
保留 Geist、12/14px UI 层级、原有留白、semantic tokens、material + 40px panel blur、
hairline、分级 radius、LinearDivider、Mingcute 图标和 accent focus / selected 状态。
新增链接使用克制的文字与箭头，移动触摸区域至少 44px；没有 KPI 卡片墙或侧栏。

ranked 排序与 calendar positions 按 distribution 缓存；图表使用 memo 和稳定的
formatters，打开 selector 或切换 Month / Year 不重绘其他未变的图表。固定网格的
bar 不再逐项请求布局动画；柱体比例通过 transform 和既有 Spring preset 更新，
避免逐帧改 width / height。reduced motion 直接落到最终几何比例，保留全部操作。

真实页面为 154 张公开照片、2 个 Projects（云南 59、宜春 95），11 个图表共 142
个 bucket。8 个 Camera / Lens 链接全部与现有 Explore 筛选数量相符。320、390、768、
1440px 下的 All Photos / 云南均无页面横向溢出，桌面与手机的标题、设备、曝光、页尾
截图已检查；图表自己的横向滚动继续保留。

反复 resize、hover、键盘与 scope 切换后，window 的 popstate、stats-url-change、
resize listener 各保持 1 个，无新增资源请求或运行时错误。浏览器 module graph 与
实际网络请求共同确认没有 PhotoViewer、MapLibre、GPU image engine、照片、详细
EXIF、完整 PublicPhotoCollection 或浏览器聚合引擎。

最终生产数据为 28,322 bytes / 3,265 gzip bytes；Stats 专属 JS 为 19,650 bytes /
6,088 gzip bytes；首次实际请求的 5 个 JS 文件共 524,182 bytes / 167,621 gzip bytes。
记录见本地 `.cache/photography-stats-phase3-production-audit.json`。Stats island
仅传聚合结果、最小公开 Project 身份和设备 href。共享 React / Motion / Radix /
Vaul 属于既有交互依赖，没有新增依赖或照片数据缓存。

## 公开资格、隐私与 SEO

统计及设备链接都来自同一个 PublicPhotoCollection 快照。draft Project 不进入
selector，draft-only / unused 照片不进入 All Photos；共享照片按 canonical ID
计一次，Project 只收窄公开成员关系。未知、草稿、非法或重复 scope 参数继续显示
Project unavailable，不扩展到 All Photos。

Engine 输出不变；额外的只读 `explore.cameras` / `explore.lenses` 仅保存公开设备名
到共享筛选 URL 的映射。测试扫描实际 Stats HTML、island props 与 bundle，排除
照片 ID、Manifest、详细 EXIF、regions、digest、坐标、source/storage internals、
草稿身份、私有 caption / Artist / video storage 等字段与哨兵值。聚合与链接深只读，
可以安全 JSON 往返。

`/stats/` 使用正常公开页面的 SiteLayout：Photography Stats 标题、专属 description、
绝对 canonical / OG URL、默认品牌 JPEG 和 Twitter 大图卡片。All Photos、Project
和 period 共用 `/stats/` 的 canonical。sitemap 收录一次无参数 Stats，精确输出白名单
仅接纳 `stats/index.html`，拒绝额外 Stats JSON 或私有子路由。正式地址下可索引；
无 SITE_URL 的预览继续全站 noindex。Cloudflare 本地 Pages 验证真实响应头规则。

## 最终验证

`CI=1 pnpm test` 完整成功退出：448 项 Node tests 通过，0 失败、0 跳过、0 取消。
所有检查使用隔离 fixture，不替换正式照片内容。图表 transform / 布局收口后另完整
重跑 Statistics 60/60，包含真实条形几何比例断言；随后复核最终生产截图与加载边界。

| 检查 | 最终结果 |
| --- | --- |
| `pnpm check` | 通过 |
| `pnpm check:upstream` | 通过，16 个核心 Viewer 文件保持基线 |
| Projects | 48/48 |
| Statistics | 60/60 |
| Photo Engine / network smoke | 通过，包括 13 个照片流程场景 |
| Viewer | 66/66 |
| Website（Project / Explore / Map / Viewer / Share Photo Page） | 145/145 |
| SEO（含本地 Pages 真实响应头） | 4/4 |
| Automation / Release | 23/23 |
| Admin（含本地 Worker） | 101/101 |
| 真实元数据审计 | 1/1 |
| `pnpm build` | 通过，161 页，包含 `/stats/` |
| `git diff --check` / staged diff check | 通过 |

本机通过 `npm_config_verify_deps_before_run=false` 或对应 pnpm 配置参数使用已安装
的锁定依赖，不修改 lockfile；浏览器和本地 Pages / Worker 测试允许监听 127.0.0.1。

本地日志、截图和性能 trace 位于 `.cache/photography-stats-phase3-*`、
`.cache/stats-release-*`，不进入 commit 或公开产物。最终提交留在现有 main 分支，
不推送 GitHub，也不执行部署。

Release Gate：没有剩余发布阻塞项，Photography Stats 已具备发布条件。
