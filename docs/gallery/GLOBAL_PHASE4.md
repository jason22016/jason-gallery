# Global Gallery Phase 4 — Integration & Release Gate

2026-09-20，在现有 `main` 上核对 Step 1–3（`b91d23c`、`bacd923`、`dca0d37`）并完成整合审计。
本阶段不增加产品功能，参考 [Afilmory DESIGN.md](https://github.com/Afilmory/afilmory/blob/main/DESIGN.md)，保留 Jason Gallery 现有视觉与交互。

## 最终共享架构

| 职责 | 唯一实现 / 复用关系 |
| --- | --- |
| 公开资格 | `loadProjects()` / `resolvePublicPhotoCollection()`：只从 published 引用派生，canonical ID 去重 |
| 照片投影 | `viewerPhotos()` → `galleryPhotos()`；Global Collection 追加公开 memberships，保留首个公开 Project 的说明和 detail URL |
| 路由 | Project、Explore、Map 为 Astro 壳，进入 `Gallery.astro` 的同一个 React island；`ProjectGallery` 保留薄适配器 |
| filters / sorting | `filters.ts` 的 `selectPhotos()` / `galleryFilterOptions()`；Map 再限制有效 GPS |
| URL | `url-state.ts` 处理 filters、sort、view、columns；`map-state.ts` 处理 marker 与 Viewer 到地图的定位链接 |
| Viewer / history | `PhotoGallery` 提供当前序列、index、trigger、onIndex/onClose；原 `PhotoViewer` 和图片引擎不变 |
| Gallery UI | 原 Masonic、MasonryView、ListView、Thumbnail、ThumbHash、SearchPanel、ViewPanel 与 PageHeader |
| Map UI | 原 PhotoMap、MapLibre worker、marker/cluster registry、preview、fallback、controls；Project 面板和 Global 页面只是上下文不同 |
| metadata | 原 `projectPhotoDetails()` 白名单和 `/projects/<slug>/photos/<id>.json`；Global 不生成额外 JSON |
| 导航 / SEO | SiteNavigation / globalGalleryHref，原 canonical、sitemap、robots 与 noindex headers |
| 公开产物 | 新的 `publicOutputPaths()` / `assertPublicOutput()` 同时服务普通构建与 Release |

没有可安全消除的第二套 Explore Gallery / Global Viewer / Map 引擎。Project 的外部 photo 深链接兼容规则、项目内编排说明及 Global 的严格筛选序列继续分别保留，没有为了统一外观或函数数量改变语义。

## 本次修复

- `view` / `columns` 曾在初始化、popstate 和写 URL 处各自处理；统一解析/序列化，并在首次渲染应用 URL，避免先显示默认视图。Back 遇到缺省参数重新解析偏好，不沿用上一条记录的显式参数。
- 连续激活同一照片或 marker 曾重复 push 同一个 URL。重复激活现在只保留一个条目；筛选/切图仍 replace，Viewer Close/Back/Forward 保留原 owner、序列和焦点契约。
- 原 Gallery 初始化把内部 `0` 滚动值写回页面；仅移除该操作仍会让浏览器在静态 24 张预览高度上截断深层位置。共享 `scroll-restoration.ts` 在 pagehide 保存底层位置，只于 reload/back_forward 等待虚拟布局后恢复；新导航不恢复旧位置，用户输入会取消待执行的恢复，不增加 history 条目。sessionStorage 不可用时仍可浏览，并保留浏览器原生恢复。
- 普通 `pnpm build` 曾只清理照片候选和过期缩略图，误放入 `public/` 的 Manifest/metadata 要到自动 Release 才被拒绝。现在普通构建也在复制前拒绝意外文件，输出再经过共享精确白名单；Release 额外检查所有必需产物及摘要。公开 Live Photo 的本地配套视频也使用相同资产资格。
- 导航菜单补齐与现有浮层一致的 WebKit backdrop-filter。真实桌面/手机截图复核 spacing、radius、材质、semantic tokens、48px header、safe area、焦点与 reduced motion，保留现有设计。
- SEO 文档更新为 Projects / Explore / Map 三入口。现有 sitemap 和导航实现已正确，无须另建一份路由配置。

## 公开边界

- draft-only、未被 published 引用的 Manifest 照片不进入 Explore；它们的 GPS 不进入 Global Map。
- 多项目共享照片只占一个 Global ID；公开 memberships 不包含草稿说明或标题。
- Map island / marker / cluster / Viewer 仅包含有效 GPS 的公开结果；筛选外或未公开的 photo/mapPhoto 深链接不扩大集合。
- `getPhotoDetails()` 与现有 Project metadata route 均检查公开归属。伪造 `/photos/<id>.json` 或其他 Project 的详情路径返回 404；没有通用 Manifest 查询入口。
- fixture 给公开照片加入私有 EXIF、digest、人物 regions，并扫描全部 HTML/JS/JSON；它们不进入产物。真实构建的 154 个详情响应逐个与公开投影一致。
- 资产清理只操作 `dist/`；没有修改 Engine 输入、Manifest、正式 Project、Admin 或 HDR/color pipeline。

## 性能与视觉证据

真实本地生产内容为 2 个 published Projects、154 张唯一公开照片、139 张有效 GPS。浏览器使用 Chromium；地图额外以真实底图、未 mock 的公开瓦片验证。

| 首屏 | Explore 1440×900 | Explore 320×568 | Map 1440×900 | Map 320×568 |
| --- | ---: | ---: | ---: | ---: |
| React islands | 1 | 1 | 1 | 1 |
| 静态预览照片 | 24 | 24 | 24 | 24 |
| 挂载 Gallery cards | 50 | 22 | 0 | 0 |
| 缩略图请求 | 50 | 24 | 30 | 28 |
| 原图 / 详情请求 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| 页面横向溢出 / 运行时错误 | 无 / 无 | 无 / 无 | 无 / 无 | 无 / 无 |

Explore 未请求 PhotoMap、MapLibre、GPU 原图引擎或 HEIC 模块；Map 仅按需加载原地图模块和 worker。Viewer 外壳保持既有预加载，原图/GPU、metadata 网络和 MiniMap 的加载时机未改动。真实产物只有原有 154 个 Project metadata JSON，没有新增 Global JSON 文件。

Explore island props 为 271,171 bytes（gzip 23,026），Map 为 246,387 bytes（gzip 20,980）。这是每个页面各自的一份轻量投影，没有同页双重序列化；仍随公开照片数量线性增长。当前 480 张 fixture 继续验证 masonry <100 个挂载项、list <30 个挂载项、缩略图窗口、marker/cluster 视口上限、叶子缓存/请求去重及资源释放。没有引入一次性加载全部原图或遍历全部 cluster leaves 的策略。

截图、日志及逐文件尺寸报告保存在本地 `.cache/global-gallery-release/`，不进入提交或网站产物。

## 回归与发布判断

新增回归覆盖实际 Astro 页面深层滚动 refresh / 跨页 Back/Forward、手机 masonry 的 Viewer refresh/close、缺省视图重放、筛选不增 history、Viewer/marker 重复激活、公开详情与无重复 JSON、私有字段产物扫描、public-assets 清理和误放文件拒绝。

| 检查 | 最终结果 |
| --- | --- |
| `pnpm check` | 通过 |
| Projects | 48/48 |
| Viewer | 65/65；bundle/worker 与上游来源校验通过 |
| Website / Gallery / Global Collection | 128/128 |
| SEO / Pages runtime | 4/4 |
| Automation / Release | 23/23 |
| Admin 回归 | 101/101；未修改 Admin |
| 真实 metadata | 1/1，逐个检查 154 张真实照片 |
| `CI=1 pnpm test` | 完整链成功，370 项测试，无失败、无跳过；包含照片 smoke 和最终 build |
| Global Map 最终专项复验 | 11/11，包含 Viewer → Map / marker 连续激活只增加一个 history entry |
| `pnpm build` | 通过，6 个页面，包含 Explore / Global Map |
| 真实生产浏览器审计 | 1440×900、320×568 均通过；真实底图 ready，0 页面错误 |
| `git diff --check` | 通过 |

`CI=1` 使用仓库现有的浏览器就绪超时倍率，不关闭动画、缩小测试范围或跳过断言。最初在沙箱内运行浏览器测试遇到本地端口 `EPERM`，随后在允许本地服务器/Chromium 的环境完成全部验证。新增回归先复现滚动、视图和重复 history 问题，再确认修复。

Release readiness：本阶段没有未解决的发布阻塞项，Global Explore + Global Map 已具备合并发布条件。当前操作只在原分支提交；没有 push、触发线上发布或修改部署配置。后续真正发布仍由原 automation 的快照、摘要、版本与部署检查约束。
