# Photography Stats — Phase 1

本阶段提供统计引擎与 All Photos / Project scope，不生成 `/stats` 页面、路由或新组件。
实现前已阅读 Public Global Photo Collection、Project resolver、Gallery/metadata、
[Afilmory DESIGN.md](https://github.com/Afilmory/afilmory/blob/main/DESIGN.md) 和当前
Jason Gallery 的 semantic tokens、spacing、typography、material/blur/hairline、Spring
与 micro-state transition 实现。Step 2 应复用这些 UI 约定和现有组件。

## 稳定入口

`src/statistics/index.ts` 是纯数据、浏览器可用的入口：

```ts
import {
  buildPhotographyStats,
  readPhotographyStatsScope,
  resolvePhotographyStats,
  allPhotographyStatsScope,
} from './src/statistics';

// publicPhotos 必须来自现有 PublicPhotoCollection 的 listPhotos()。
const stats = buildPhotographyStats(publicPhotos);
const all = resolvePhotographyStats(publicPhotos, allPhotographyStatsScope);
const scope = readPhotographyStatsScope(new URL(url).searchParams);
const selected = resolvePhotographyStats(publicPhotos, scope);
// selected === undefined 时展示无效/不存在的 scope，不得回退到 all。
```

构建/服务端入口单独放在 `src/website/photography-stats.ts`：

```ts
import { loadPhotographyStats } from './src/website/photography-stats';
const result = loadPhotographyStats(scope);
```

`loadPhotographyStats(scope, projectLoadOptions?)` 只调用现有
`loadPublicPhotoCollection()`，不读取第二份照片事实、不新增缓存或数据库。
`scope` 必须显式提供；传入解析失败的 `undefined` 仍返回 `undefined`。
已经持有公开集合的页面/构建逻辑应调用 `resolvePhotographyStats()`，避免重复读取。
浏览器只导入纯入口，不导入 filesystem loader。

导出类型包括 `PhotographyStatsPhoto`、`PhotographyStats`、`StatsCount`、
`StatsCoverage`、`StatsBucket`、`StatsDistribution`、`NumericStatsDistribution`、
`PhotographyStatsScope` 和 `ScopedPhotographyStats`。不输出 HTML、图表配置、颜色、
本地化文案或布局信息。所有结果及嵌套数组/对象均具有 TypeScript readonly 约束并在
运行时冻结，不修改或冻结调用方输入。

## Scope 与公开资格

| Scope | URL 查询约定（供 Step 2 使用） | 行为 |
| --- | --- | --- |
| `{ type: 'all' }` | 无 `project` 参数 | 现有公开集合的全部照片 |
| `{ type: 'project', slug }` | `?project=<slug>` | 仅公开 memberships 中匹配 slug 的照片 |

- All Photos 的公开资格完全继承 Public Global Photo Collection：只有至少被一个
  published Project 引用的照片。draft-only、未引用 Manifest 照片和 draft memberships
  不进入该集合，即使 collection resolver 被误传 mixed Project index。
- Project resolver 已将 legacy alias / qualified ID 解析成 canonical ID。引擎再按
  `photo.id` 去重，不使用 URL、filename 或短 public ID 作为照片身份。
- 对来自同一公开快照的重复照片，指标只读首次出现的事实字段，公开 memberships
  按 Project ID 合并计数。同一 canonical ID 应始终描述同一组照片事实。
- Project scope 取当前 Project 的照片交集，并将传给引擎的 memberships 收窄至该
  Project；因此共享照片只计一次，`projectCount` 为 1。
- 空参数、重复 `project` 参数、非 lowercase kebab-case slug 解析为 `undefined`；
  未知、draft 或非 slug 的 Project ID 在 resolve 时返回 `undefined`。二者均不会变成 all。
- 空公开集合的 all 返回零值统计；不存在的 Project scope 返回 `undefined`。当前
  Project schema 要求至少一张照片，因此无需从私有 Project catalog 推断空项目。
- 成功的 scope 结果只包含 `{ scope, project, stats }`；`project` 为选定公开项目的
  `{ id, slug, title }`，all 时为 `null`，不会返回照片记录或其他项目详情。

## 统计口径

每个分布包含 `sampleCount`、`missingCount`、`coveragePercentage`、`buckets` 和
`mostUsed`。`sampleCount` 为该指标有效样本数，`missingCount = photoCount - sampleCount`。
`coveragePercentage` 以去重后的全部照片为分母；bucket 的 `percentage` 以该指标
`sampleCount` 为分母，范围 0–100，不预先舍入。这样缺失 EXIF 不会被当作零值或假设备。

bucket 仅包含观察到的有效值，按数字或字符串的确定性升序排列，不依赖 locale。
`mostUsed` 并列时选升序第一个 bucket。数值分布另含 `min`、`max`、按照片频数计算的
`median`；偶数样本取中间两个数的平均，避免大数相加溢出。

| 指标 | 数据来源与计算规则 |
| --- | --- |
| Photo count | canonical `id` 的唯一数量 |
| Project count | 输入公开 memberships 的唯一 Project ID 数量；Project scope 仅为当前项目 |
| Geotagged | 复用 `validLocation(photo.location)`；经纬度必须有限且分别位于 ±90 / ±180 内，0 有效；百分比以 photoCount 为分母 |
| Capture date range | 合法公开 `date` 的 capture wall-clock 最小/最大值，保留小数秒，移除时区后缀与无意义的小数尾零 |
| Camera | 复用 Gallery/Viewer 由 Make + Model 生成的公开 `camera`；压缩空白、保留原拼写，不另建品牌映射 |
| Lens | 复用 LensModel 的公开 `lens`；同样压缩空白；空值、非字符串及 Unknown / N/A / null 等缺失标记不计入 |
| Focal length | 解析 `capture.focalLength` 为正数 mm；沿用 Gallery 的 FocalLengthIn35mmFormat 优先、FocalLength 回退规则 |
| Aperture | 解析 `capture.aperture` 为正 f-number；支持公开 `ƒ/2.8`、`f/2.8` 以及数值形式，不从 APEX 或最大光圈推算 |
| ISO | 解析 `capture.iso`，接受 ISO 前缀；仅正的 safe integer，不接受 Auto、0 或小数 ISO |
| Shutter speed | 解析 `capture.shutter`，接受正数、分数及 s / sec / second(s) 后缀；统一为秒，不从 ShutterSpeedValue/APEX 猜测 |
| Year | 拍摄墙上时间字符串的 YYYY，返回数字 |
| Month | 拍摄墙上时间字符串的 YYYY-MM，跨年月份分开计数 |
| Shooting hour | 拍摄墙上时间的 HH，返回 0–23，不额外推断日出/夜晚等时段 |
| HDR / SDR | 仅公开 `isHDR` 的 true / false；不根据扩展名、色彩空间或额外 EXIF 推测 |
| Live / Motion Photo | 仅公开 `video.type` 的 live-photo / motion-photo；无 video 为 still；未知类型不参与 |
| Orientation | 仅有限且大于 0 的公开 width / height；大于、小于、等于分别为 landscape / portrait / square，不使用 EXIF Orientation 或 aspectRatio |

焦距的 `basis: 'gallery-preferred'` 明确表示现有 Gallery 口径，**不是**全都为实际
焦距或全都为 35mm 等效焦距；当前 projection 无法逐张区分来源。Step 2 不能将该分布
标成“纯实际焦距”或“纯 35mm 等效焦距”。没有为统计新增 EXIF 字段。

曝光解析接受完整十进制（含科学计数法）或正数有理数，支持现有单位格式；拒绝尾随
垃圾、未知单位、负数、0、零分母、NaN、Infinity、溢出与下溢为 0 的结果。数值输出
保持数值，不带展示标签；焦距、光圈、快门的 unit 分别为 mm、f-number、seconds。

空分布的 bucket 数组为空，mostUsed/min/max/median 为 `null`；空日期范围 start/end
为 `null`；空集合所有计数和百分比为 0。结果没有 `undefined`、NaN 或 Infinity，
可以直接 JSON 序列化。

## 时间可信边界

公开 `date` 原本就来自 `captureDate(exif)`，只信任 `DateTimeOriginal`。统计重新使用
该校验函数验证公开字符串，包括日历、小时、分钟、秒和已有 offset 格式。
Engine 的 `dateTaken`、构建时钟、lastModified、文件名、Project period 及原始 EXIF
均不是统计日期的 fallback。

聚合只读取记录的年/月/日/小时，**没有 timezone 转换**。例如
`2024-01-01T00:15:00+14:00` 仍归入 2024 年、2024-01、0 点；不会被 UTC 转换到前一年。
未记录 offset 的日期同样保持原钟面值。日期范围的 start/end 是无时区的墙上时间，
调用方不得将它们当作 UTC instant 再换算成浏览器时区。

## 数据边界与性能

引擎只接受现有公开 projection 的必要字段，不读取详情 API，也不访问完整 Manifest
或 EXIF。GPS 使用已经投影好的 location；既有 photoLocation 的 EXIF GPS 回退仍由
公开 projection 完成，统计不另做回退。HDR/color、Viewer、Map、Admin 均无改动。

结果显式构造，仅包含聚合值与选定公开项目的基础信息；不透传 photo、EXIF、regions、
digest、source/storage 字段、坐标、video URL 或 draft memberships。纯入口的浏览器
bundle 测试确认没有 filesystem、Project resolver、Manifest、Builder 运行时依赖。

遍历照片及 memberships 一次，每项分布用 Map 累计，再排序唯一 buckets。中位数直接
在 bucket 频数上计算，不另存一份逐照片数值数组。复杂度为 O(N + memberships +
Σ K log K)，K 为各指标唯一值数量，内存为去重 ID / Project ID 集合与分布计数。
没有新增依赖、生成照片事实文件或修改现有 public projection。

## 验证

`pnpm test:statistics` 已接入 `test:checks`，覆盖 canonical 去重、共享照片、所有
scope 与公开边界、每项分布、数值解析、缺失/非法 EXIF、空集合、确定性、深只读、
无 NaN/Infinity、JSON 往返以及纯入口浏览器打包。额外以 UTC、香港、洛杉矶和
Kiritimati 四个进程时区验证统计输出完全一致。

本机 pnpm 默认在运行脚本前检查并重装依赖；本次只新增脚本而无依赖变化，因此验证
命令使用 `pnpm --config.verify-deps-before-run=false <script>` 运行现有已安装依赖，
不修改 lockfile。Website 浏览器测试需要允许 127.0.0.1 本地 fixture 服务的环境。

2026-09-20 验证结果：

| 检查 | 结果 |
| --- | --- |
| `pnpm test:statistics` | 28/28，通过，无跳过 |
| `pnpm test:projects` | 48/48，通过，无跳过 |
| `pnpm test:website` | 145/145，通过，无跳过；包含 Gallery、Viewer、Map、HDR fallback、分享与公开边界回归 |
| `pnpm check` | 通过，包含深只读类型契约 |
| `pnpm check:upstream` | 通过，16 个核心 Viewer 源文件保持原基线 |
| `pnpm build` | 通过，160 个页面，未增加 Stats 路由 |
| `git diff --check` / `git diff --cached --check` | 通过 |

现有生产数据只读核对：154 张公开照片、2 个 published Projects、139 张有效 GPS、
153 张有效拍摄时间；Project scopes 分别为 59 / 95 张，与现有公开成员关系一致。
正式 Project、Engine 和 public projection 均未修改。完整测试日志位于本地
`.cache/photography-stats-*.log`，不进入提交或公开产物。
