# Photography Stats — Phase 2

公开入口为 `/stats/`，默认 All Photos。首页和 Gallery 的共享导航增加 Stats。
页面按 Overview、Cameras & Lenses、Focal Length、Exposure、When、Media 展开；
Overview 是连续排版的数字与日期，没有 KPI 卡片墙。

## 数据与 URL

`loadPhotographyStatsPageData()` 在构建时从同一个 PublicPhotoCollection 快照调用
Step 1 的 `resolvePhotographyStats()`，生成 All Photos 和每个 published Project 的
聚合结果。浏览器只接收这些结果以及 Project 的 id、slug、title；没有逐照片记录、
照片 ID、坐标、图片 URL、EXIF、Manifest、draft memberships 或私有存储字段。
预载公开 scope 的聚合结果使切换同步、无需请求，并保留 Spring 过渡；payload 随各
scope 的 aggregate buckets 数量增长，而不是随完整照片元数据大小增长。

`statsResultFromSearch()` 复用 Step 1 的严格 scope parser，再在公开聚合目录中查找。
`?project=<slug>` 标识 Project；无参数标识 All Photos；空、重复、非法、未知、draft
参数显示 Project unavailable，不隐式扩大为 All Photos。界面内部按 scope 类型区分
All Photos 和 Project，允许名为 `all` 的合法 Project。

`statsScopeURL()` 与 `statsPeriodURL()` 保留其他查询参数及 hash。
Month 为默认，Year 使用 `?period=year`。切换通过 pushState 写入历史，页面通过
useSyncExternalStore 订阅 URL 变化和 popstate，direct entry、refresh、Back / Forward
都从同一个 URL 解析状态。静态页面在读取客户端 URL 前显示中性加载状态，避免先展示
错误 scope；禁用 JavaScript 时有明确的 All Photos overview 与启用交互的说明。

## 可视化与交互

`StatsVisualizations.tsx` 提供五个可复用组件：RankedBars、DistributionBars、
TimelineChart、TimeOfDayChart、ProportionBar。它们直接显示 Step 1 的 buckets、
count、percentage、sampleCount、missingCount、coveragePercentage；排名排序和
图形尺寸只是展示转换，不生成第二套统计结果。缺失数据单独显示，不伪造零值 EXIF。
日期和小时保留拍摄时钟，不转换为浏览器时区。焦距文案明确沿用 Gallery 的混合口径。

焦距图后续增加了展示区间：默认 10 mm，预设 1 / 5 / 10 / 20 / 50 mm，可输入
1–1000 mm 的整数自定义值，点击 Apply 或按 Enter 应用。`FocalLengthChart` 只合并
已有公开 aggregate buckets 的计数；覆盖率、缺失数量和引擎结果不变，也不读取照片。
区间从 0 对齐，左闭右开，仅展示有照片的区间，并在图表说明及详情中明确边界。
`focalInterval` 查询参数复用 Stats 的 URL 订阅及历史更新方式；默认值省略参数，
scope / period 切换、刷新、Back / Forward 均保留或恢复间隔。计算按输入聚合及间隔
记忆化，空区间不会随焦距跨度大量分配；触控目标至少 44px，保留键盘和 reduced motion。

每个 bucket 都有原生按钮、完整 accessible name、可见值和 count。hover / focus
显示玻璃详情区；tap、Enter、Space 固定选择；再次选择或 Escape 清除。方向键及
Home / End 移动焦点。切换 scope 清理旧选择。横向较长的分布在自己的图表内滚动，
不撑宽页面。百分比和尺寸防守非有限值，空集合及缺失字段均有文字 fallback。

Project selector 直接复用 Gallery Panel：desktop settings popover，mobile Vaul
drawer；继续使用现有 useMobile、焦点管理、dismiss 和 drag 逻辑。选项为 radio group，
支持方向键、Home / End、Enter 和 Space。

## 设计与加载边界

实现前阅读了 [Afilmory DESIGN.md](https://github.com/Afilmory/afilmory/blob/main/DESIGN.md)
及本仓库 Gallery、Panel、navigation、UI primitives 和 motion。复用 Geist、semantic
tokens、material + backdrop blur + hairline、LinearBlur、LinearDivider、Mingcute
icons 和现有 spacing / radius。图表只用中性色阶，accent 限于 selection / active /
focus；没有新增字体、配色或阴影体系，也没有引入 chart library。

数值和 bar 尺寸使用 `Spring.presets.smooth`，Panel 保持既有 snappy preset；颜色与
hover 微状态沿用 CSS transition。`prefers-reduced-motion` 让数字、图形和面板直接
到达最终状态，保留全部交互。

Stats 客户端没有 Viewer 本体、MapLibre、GPU image engine、照片或详细 EXIF 请求。
仅使用 React / Motion、Panel 所需的 Radix / Vaul 和既有轻量 UI primitives。
统计聚合引擎和服务端 loader 不进入客户端运行路径；客户端只保留 scope parser。

## Step 3 接口

继续保留 `PhotographyStatsScope`、`statsScopeURL()`、严格 URL resolver 和统一
`StatsBucket<T>`。图表的可选 `onSelectionChange(bucket | null)` 提供原始 bucket 值及
引擎计数，后续可由页面层结合 scope 映射到 Explore / Map 筛选。当前没有添加深度跳转，
没有改动 Gallery 的 filter / map URL 约定，也没有增加照片 ID 清单。

## 验证

新增 page-data、URL、production browser 与 bundle 边界测试，逐个图表比较引擎结果，
覆盖 Project 选择、URL 历史、非法 scope、桌面/触摸/键盘、tooltip、选中状态、
reduced motion、响应式、empty / missing metadata、隐私、无重模块请求和无 JS fallback。
运行 Statistics、Website、Project、Viewer、SEO、upstream checks、TypeScript 和
production build。测试 fixture 全部位于独立 `.cache` 目录，不替换正式内容。

当前 pnpm 会在脚本前自动校验并尝试重装依赖，因此命令使用
`pnpm --config.verify-deps-before-run=false <script>` 运行已安装版本，不改 lockfile。
浏览器测试需要允许仅监听 `127.0.0.1` 的本地 fixture 服务。

2026-09-20 最终结果：

| 检查 | 结果 |
| --- | --- |
| Statistics | 52/52，通过，无跳过 |
| Website（含 Project / Explore / Map / Viewer 回归） | 145/145，通过，无跳过 |
| Projects | 48/48，通过，无跳过 |
| Viewer | 66/66，通过，无跳过 |
| SEO | 4/4，通过，无跳过 |
| `pnpm check` / `pnpm check:upstream` | 通过；16 个核心 Viewer 源文件保持基线 |
| production build | 通过，161 个页面，含 `/stats/` |
| `git diff --check` | 通过 |

最终生产数据为 154 张公开照片、2 个 Projects；聚合 JSON 27,354 bytes / 3,142 gzip
bytes。Stats 专属 JS 为 18,787 bytes / 5,800 gzip bytes；实际首次进入页面的 5 个 JS
文件（含 React、Motion、Panel）合计 510,780 bytes / 163,374 gzip bytes。浏览器请求
检查与独立 Vite module graph 检查共同验证了重模块加载边界。桌面、移动端、曝光图及
移动 Project drawer 的生产截图已人工检查，移动页面无水平溢出。本地测试与截图保存在
`.cache/photography-stats-phase2-*` 和 `.cache/stats-production-*.png`，不进入公开产物。
