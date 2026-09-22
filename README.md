Jason Gallery is a static photography portfolio built with Astro, featuring curated projects, HDR viewing, and automated photo synchronization from multiple GitHub repositories.

架构采用 Astro 静态网站、Project 内容层和 Afilmory Photo Engine；独立 Cloudflare Worker Admin 使用 Cloudflare Access 邮箱 OTP，管理照片源、Project 和独立的同步/发布操作。边界与历史变更见 [ARCHITECTURE.md](ARCHITECTURE.md)。

## 部署与验收状态

- **已部署**：公开网站使用 Cloudflare Pages Direct Upload，地址为 [jason-gallery.pages.dev](https://jason-gallery.pages.dev/)。Admin 已部署到 [管理入口](https://jason-gallery-admin.jiasheng22016.workers.dev)，仍受 Access 和服务端身份校验保护。主站上线后的后台手动发布接入见 [提交记录](https://github.com/jason22016/jason-gallery/commit/5e1e01fcd1d05aad6adf8cc59eaa1f0de78a9266)及 [Admin 配置说明](docs/ADMIN_SETUP.md#已上线主站与后台发布入口)。
- **已验证的范围**：仓库已有本地回归、真实 Actions 同步和部署记录。2026-09-11 的 [Admin 部署短测](docs/ADMIN_DEPLOYED_2026-09-11.md)记录了 1 次真实保存成功并回读 GitHub、154/154 张缩略图最终解码成功；这是该次部署的证据，不代表当前分支所有改动均已部署。
- **仍待真实环境验收**：Admin 整体 Workers Free 验收仍未通过。该次短测的 `/api/state` CPU 为 42 ms，保存成功样本仅 1 次；不能用本地测试或成功上传替代完整的平台 CPU、并发和保存验收。紧凑读取修复已有部署，剩余门槛见 [实现与验收状态](docs/ADMIN_COMPACT_READ.md)和 [真实 Free 测量](docs/ADMIN_COMPACT_LIVE_2026-09-11.md)。当前代码的线上功能、SEO 与实体 HDR 显示效果也须按实际发布版本另行验收。

网站版本以成功的 Actions 执行摘要和线上 `/build-version.json` 为准。`PUBLISH_ENABLED` 只控制后台发布入口，`AUTO_DEPLOY_ENABLED` 控制 Actions 自动部署，两者不表示主站是否已经部署；保存、删除、同步也不等于发布。早期 [Phase 6](PHASE6_REPORT.md)、[Phase 7](PHASE7_REPORT.md)及部署准备文档中的“未配置/未部署”是当时的历史状态。

## Fresh clone 后运行

在仓库根目录使用 Node **24.19.0**（[.node-version](.node-version)）和 pnpm **11.19.0**（[package.json](package.json)）。照片 Manifest、统一索引和缩略图不提交 Git；首次开发、真实数据测试和构建前必须生成并导出它们。

首次照片同步需要联网访问 GitHub，并有足够的只读 API 额度。在 shell 中提供 `JASON_PHOTOS_READ_TOKEN`；多来源可用 `JASON_PHOTOS_READ_TOKENS`（sourceId → token 的 JSON 对象）。若已有 GitHub Git credential，可将下方照片命令替换为 `pnpm photos --export --git-credential`。公共来源允许匿名读取，但冷启动可能耗尽匿名 API 额度；照片原图仍须匿名可读。

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install --with-deps chromium firefox webkit chrome
pnpm photos --export
pnpm test
```

`pnpm photos --export` 按 [config/photo-sources.json](config/photo-sources.json) 固定各来源快照，验证全部照片与 Project 引用后，导出 `src/data/photo-index.json`、`src/data/sources/*/photos-manifest.json` 和 `public/thumbnails/`。它只读取远端照片，不写照片仓库，也不发布网站。省略 `--export` 只生成 `.cache/photo-engine/output` 产物，不能替代网站所需的本地导出。

`pnpm test` 依次运行 `pnpm test:checks`、真实导出数据检查 `pnpm test:metadata-real` 和生产构建 `pnpm build`，成功后网站位于 `dist/`。`test:checks` 包含上游校验、TypeScript、Projects、Statistics、照片 smoke、Viewer、Website、SEO、automation/release 和 Admin 测试；测试使用隔离 fixture 与本地运行时，不执行线上发布。GitHub Actions 在相互隔离的 runner 上并行执行这些同一组检查，任一分组失败都会阻止后续构建或发布。

Website 在 Actions 中按耗时分为 Gallery、Project、Pages 三组，每组使用独立 runner，组内仍串行执行全部原有用例。`pnpm test:website` 保留本地全量入口；`pnpm test:website:group gallery`、`project` 或 `pages` 可单独运行一组，追加 `--list` 可查看文件清单。新增 `tests/website/*.test.ts` 自动进入 Pages 组，分组覆盖检查确保完整且不重复；失败诊断按组单独保存。

开发预览运行 `pnpm dev`；仅重新构建运行 `pnpm build`。浏览器测试需要前述 Chrome、Chromium、Firefox 和 WebKit 安装；只运行隔离回归可用 `pnpm test:checks`，但这不能替代真实数据检查和生产构建。

公开导航为 Projects / Explore / Map / Stats：`/` 继续展示项目，`/explore/` 汇集所有 published Projects 引用的公开照片，按照片 ID 去重；`/map/` 使用其中有有效 GPS 的照片。Explore、Map 与 Project 共用 Gallery、filters 和 Viewer；Explore ↔ Map 保留搜索、日期、相机、镜头、标签、项目筛选及排序。地图复用 PhotoMap，首次适配结果，筛选后保留视角，可用 Fit Results 重新定位。实现与验证见 [Global Gallery Phase 2](docs/gallery/GLOBAL_PHASE2.md)、[Phase 3](docs/gallery/GLOBAL_PHASE3.md) 和 [最终整合 / Release Gate](docs/gallery/GLOBAL_PHASE4.md)。

Explore 和每个 Project 的 Cmd+K 均提供 AI Search：Explore 搜索全部公开照片，Project 只搜索当前项目内的照片，共用本机模型与缓存。默认展示余弦分数 ≥ 0.07 的结果；“显示更多”按 0.05 → 0.03 → 当前范围内原始最多 60 张候选逐步放宽，自动跳过没有新增照片的档位。可一键恢复第一档，换词时自动重置。启用成功后，此设备在刷新或切换页面后进入 AI Search 会自动恢复；已有完整模型缓存也可直接恢复。搜索栏、图库和 Viewer 使用同一份结果，详见 [AI Search 分级展示](docs/SEMANTIC_SEARCH_RESULT_LEVELS.md)。

`/stats/` 显示 All Photos 的公开聚合统计，`?project=<slug>` 选择 published Project。设备详情可打开对应 Explore 筛选，Geotagged 的 View on Map 打开同一 scope 的 Global Map；跳转复用现有 helpers，将 Stats slug 转为 Explore / Map 约定的 Project 永久 ID。浏览器仅接收聚合结果、公开 Project 身份和精确设备链接，不加载照片集合、Viewer、MapLibre 或完整 EXIF。见 [Photography Stats Release Gate](docs/statistics/PHASE3.md)。

普通 `pnpm build` 与自动发布共用公开输出白名单。只把 favicon 和 Photo Engine 输出放入 `public/`；Manifest、私有 metadata、预览和 Admin 数据不能放在其中。构建清理未公开及过期照片资产，只修改输出，不修改本地照片输入。新增 release 回归已包含在 `test:website` / `test:checks` 中，无需另行配置自动化。

## 常用验证与配置

- `pnpm check` — TypeScript 检查。
- `pnpm test:website`、`pnpm test:seo`、`pnpm test:automation` — 网站交互、SEO 和 release 白名单/完整性及发布事务的隔离回归。
- `pnpm admin:fixture` — `http://127.0.0.1:4325/` 的内存 UI 预览；`pnpm admin:preview` 使用已有本地缩略图。
- `pnpm admin:build` — 构建真实 Admin UI；`pnpm admin:dev` 启动受保护的本地 Worker，配置前提见 [Admin 设置](docs/ADMIN_SETUP.md)。`pnpm test:admin` 检查 API/UI 和本地 workerd。
- `pnpm check:upstream` — 离线核对固定 Afilmory 核心；`pnpm check:upstream --remote` 另核对远端版本和固定提交源码摘要。见 [上游对齐与验证](docs/AFILMORY_VIEWER_ALIGNMENT.md)。

公开 SEO 与分享默认使用 `https://jason-gallery.pages.dev/`。换域名时设置 `SITE_URL` 环境/仓库变量，再重新构建和发布；canonical、Open Graph、Twitter 和 sitemap 共用该地址，草稿与 Admin 不进入 sitemap，404/Admin 禁止索引。配置与验收见 [SEO_AND_SHARING.md](docs/SEO_AND_SHARING.md)。favicon 为单个静态 `public/favicon.svg`，随生产构建进入 release 文件摘要。
