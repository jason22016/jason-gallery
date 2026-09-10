# Jason Gallery

Astro 静态摄影网站：只读 Photo Engine → 本地 Project JSON → Website。架构及历史验收见 [ARCHITECTURE.md](ARCHITECTURE.md) 和 `PHASE1_REPORT.md`–`PHASE6_REPORT.md`。正式 Project 当前为空。

## 本地运行

```sh
# Node .node-version（24.19.0），pnpm 11.19.0
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm photos --export              # 可选环境变量 JASON_PHOTOS_READ_TOKEN
pnpm test                        # 包含生产 Astro build
pnpm dev
```

显式 `pnpm photos --git-credential --export` 可读取本机已有 Git 凭据；只读照片仓库，不把凭据写入文件。`pnpm photos --commits '{"jason-photos":"<40位照片commit>"}'` 固定所有启用来源的版本；没有 `--export` 时只生成 `.cache/photo-engine/output/`。该路径是指向完整一代产物的原子符号链接，不应手工修改、清理它所指向的 run 目录。缓存可删后重建；不要在运行期间删除 `sync.lock` 或来源 worker 的 `build.lock`。并发 CI 由 workflow 串行化，本地同一缓存根的第二个 writer 会失败。

`pnpm test:metadata-real` 单独审计已导出的真实 Manifest（自动化在正式网站构建后执行）；`pnpm test:checks` 不需要真实图库，使用隔离 fixture 检查类型、Project、Engine、Viewer、Website、自动化；`pnpm test:automation` 单独验证 Phase 6。`pnpm ui:preview` 只在 `.cache/ui-preview` 生成真实图片的临时选集，不能部署。运行浏览器测试需要允许回环 HTTP 服务和 Chromium；当前自动回归为 Chromium，不能代替实体 HDR 屏幕验收。

浏览器测试共用 `tests/browser.ts`：固定同版 Playwright Chromium，显式使用 SwiftShader；WebGPU/色彩测试使用 headless shell + Skia Graphite/Dawn，普通交互和 MapLibre 使用 headless shell + WebGL/GL 合成，不依赖 runner 的实体 GPU。Website 浏览器测试文件串行执行，避免多个独立浏览器在 CI 上争用同一个软件 GPU。`DEBUG=pw:browser pnpm test:viewer` 可输出浏览器进程错误，结构化诊断位于 `.cache/color-test/diagnostics/`；Actions 的 `viewer-diagnostics` artifact 保留 14 天，过期后重跑检查。GPU 适配器存在不代表画布可呈现，测试仍严格核对渲染器、HDR 状态与截图像素。

## 照片源与引用迁移

`config/photo-sources.json` 是版本化配置（`schemaVersion: 1`），每项有 `sourceId`、`name`、`owner`、`repo`、`branch`、`path`、`enabled`；未知字段、重复 ID、非法路径、非布尔 enabled 均失败。`path: ""` 表示仓库根目录。默认来源为 `jason-photos` → `jason22016/jason-photos` / `main` / `images`。可启用多个来源，也可全部停用（仍须通过全部 Project 引用校验）。来源必须允许匿名读取；构建 token 不会让私有源变成可发布源。

- 来源 `name` 只作显示；稳定 `sourceId` 不随名称改变。来源身份是规范化 owner/repo、branch、path 的 SHA-256。更换其中任一项形成新身份，旧 Project 引用必须显式迁移，不会自动重定向。
- 网站照片引用格式：`<sourceId>--<完整身份摘要>--<原生ID的完整摘要>`；`photo-index.json.entries` 同时保留 `sourceId`、`nativeId` 和 `reference`。每个来源的原生 v10 Manifest/8 位原生 ID/缩略图路径保持原样；网站投影使用带来源身份的引用及缩略图路径。不要手写摘要，从成功产物复制 `reference` 到 Project 的 `photoId` 和 `coverPhotoId`。
- 旧 bare native ID 仅作为固定默认来源（原 owner/repo/branch/path）的兼容别名，解析后使用 qualified reference。若默认来源停用、删除或身份变化，旧引用报错，即使别的来源恰好有相同原生 ID。别名和 canonical ID 同时指向同一照片也会报重复引用。新分享 URL/metadata 路由使用 qualified reference；旧 `?photo=<bare-id>` 链接需替换为新链接。
- `pnpm photos` 总是先固定所有来源，再在 `.cache/photo-engine/sources/<sourceId>/<identity>/` 中隔离缓存与 Builder worker。默认来源自动导入旧 `cache/blobs`（仍核对 Git blob SHA）；旧派生 metadata/缩略图需按新 fingerprint 重建。名称、enabled、Project 和页面变更不会自行使未变来源的照片内容处理失效。
- `--config <file>` 选择配置；`--commits '<JSON对象>'` 或 `--snapshot <已保存快照.json>` 固定版本；`--projects <目录>` 用于隔离验证，生产默认 `src/content/projects`。`--export` 仅导出本地 `src/data/photo-index.json`、逐来源 Manifest 和网站缩略图，索引绝不放入 public。旧 `--ref` 被显式拒绝；`scripts/photos/cli.ts` 是内部单源 worker/历史 Engine fixture 入口。

配置变化后重新同步。同步也校验 published 和 draft；任一来源失败或引用悬空，整体失败并保留上一完整 output，成功来源的已验证缓存可供重试。逐来源诊断在 run 目录，最近机器结果在 `.cache/photo-engine/last-sync-result.json`。复用 artifact 要匹配完整配置（包含停用项与名称）、全部 commit 和 fingerprint；旧 schemaVersion=1 照片 artifact 不接受，需重新 sync。

凭据仅从 `JASON_PHOTOS_READ_TOKEN` 读取；多个来源需不同凭据时使用环境变量/CI Secret `JASON_PHOTOS_READ_TOKENS`，JSON 对象按 sourceId 映射 token，未指定的来源回退到公共 token。仅授予对应仓库 Contents Read；配置文件不接受 token 字段。未来后台修改网站仓库配置并 dispatch 同一 workflow，不需要新的数据库、照片写接口或后台专用同步实现。`sync` 不读取 Cloudflare Secret。

## GitHub Actions / Cloudflare 配置

将本阶段代码提交并推送到网站仓库 main 后，启用以下配置。照片仓库不需要安装 workflow，也不需要任何写权限。

1. Cloudflare 创建 **Pages / Direct Upload** 项目，production branch 为 `main`。不配置另一条 Cloudflare Git 自动构建链路。通过命令创建的等价方式是 `pnpm exec wrangler pages project create <项目名> --production-branch main`。
2. 网站 GitHub 仓库创建 `production` Environment，限制部署来源为 main。创建 Actions Secrets：`CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_API_TOKEN`（指定账户的 **Cloudflare Pages / Edit**，不用全局 API key）。本阶段没有托管账户凭据，未创建远程项目。
3. Repository Variables：`CLOUDFLARE_PAGES_PROJECT` 填项目名；准备好自动发布后设 `AUTO_DEPLOY_ENABLED=true`。默认关闭自动部署，但 push/schedule 仍会处理照片、校验正式 Project 并构建网站。Environment 下的 Secret 在 `production` job 内可用，变量建议放 repository 层。
4. 可选 Secret `JASON_PHOTOS_READ_TOKEN`：fine-grained token，仅照片仓库 Contents Read（Metadata Read 隐含），无需写权限。公共照片仓库默认使用短期 `GITHUB_TOKEN`，网站 workflow 权限仅 `contents: read`、`actions: read`。若跨库公开读取受组织策略限制或额度不足，再设置专用只读 token。原图必须继续匿名可读。
5. workflow 需要 GitHub-hosted `ubuntu-24.04` runner、Actions 存储/执行额度、允许本文件固定 SHA 的官方 Actions。首次冷缓存会读取约 1.96 GB 原图。部署步骤才注入 Cloudflare 凭据；它们不进入照片构建、浏览器 bundle 或上传的索引。

选择 Cloudflare Pages 是因为本站全部为静态产物，现有 `/projects/`、`/thumbnails/` 等使用域名根路径。独立 `*.pages.dev` 域名无需改 UI/base path，支持 Direct Upload 和生产版本回滚。依据：[Direct Upload CI](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/)、[Pages rollback](https://developers.cloudflare.com/pages/configuration/rollbacks/)。没有实际创建项目之前，不能把候选 pages.dev 名称当作已上线网址。

## 触发与未来后台接口

`.github/workflows/automation.yml` 的稳定入口是 `workflow_dispatch`；push main 自动构建；UTC 每小时第 17、47 分钟轮询各启用来源配置的 branch（约 30 分钟，GitHub schedule 可能延迟或停用，非实时 SLA）。PR/其他分支运行 `checks.yml`，不读取真实源、不取得部署 Secret、不发布照片缓存。

| 输入 | 语义 |
| --- | --- |
| `mode=sync`（手动默认） | 验证并生成全量照片产物；不构建正式网站、不改线上 |
| `mode=publish` | 处理/导入照片产物 → 全部 Project 校验 → Astro → 摘要封存 → 部署；手动明确 publish 可越过自动部署开关 |
| `photo_commits` | JSON 对象，键为全部启用的 sourceId，值为完整小写 40 位 commit；空值一次性解析所有配置 branch |
| `photo_run_id` | 可选，复用本仓库已完成的 main automation run 的 `photos` artifact；必须同时填全部 `photo_commits`，必须匹配当前处理 fingerprint；不使用 “latest artifact” |
| `mode=rollback` + `deployment_id` | 恢复明确的 Cloudflare 成功 production deployment UUID，跳过照片/网站重建 |

例如（已安装并登录 GitHub CLI 后）：

```sh
gh workflow run automation.yml --ref main -f mode=sync
gh workflow run automation.yml --ref main -f mode=publish
# 使用先前成功处理的明确快照；不是 GitHub artifact 的数字 ID
gh workflow run automation.yml --ref main -f mode=publish \
  -f photo_run_id=123456789 -f photo_commits='{"jason-photos":"<40位照片commit>"}'
gh run watch <run-id>
gh run download <run-id> -n execution-summary -D ./run-summary
```

后续后台可用 GitHub Actions dispatch API 调用相同 inputs，并按 run ID 读取 artifact。触发凭据只需网站仓库 Actions Write（下载为 Actions Read）；不将它交给浏览器。本阶段没有登录、GitHub App、管理页面、数据库或照片仓库写入。

每次 `execution-summary/summary.json` 区分 `photos.status`、`website.status`、`deployment.status`，`schemaVersion=2`，包含网站 commit、完整 `photoSnapshot`、每个来源的 `sources[].status/commit/total/processed/reused/failureReason`、汇总处理/复用/总数、照片产物版本、网站版本、失败原因。失败时数量未知为 null。仅 Cloudflare 返回匹配的成功 production deployment 且线上版本探针通过后写入新网址、deployment UUID 和 version；`unchanged` 是核实过的已有线上版本，`disabled`/`not_requested` 不代表部署成功，网络不确定会标 `failure_or_unconfirmed`。安装/测试失败也用无依赖 summary 脚本记录；强制终止 runner 时 artifact 上传仍可能无法执行，需查询 Actions 本身的 conclusion。

| Artifact | 内容及保留 |
| --- | --- |
| `photos`，14 天 | `photo-index.json` 和 `sources/<sourceId>/` 下逐来源原生全量 Manifest/快照/结果、所有 `public/thumbnails/`（含没有公开 Project 引用的照片）、固定源 listing、处理结果、`artifact.json` 逐文件 SHA-256 与 fingerprint。无原图、无凭据；不部署 |
| `website-release`，30 天 | `dist/` 仅公开站点；外置 `release.json` 绑定代码、照片产物、Project 内容摘要及逐文件 SHA-256。只上传 dist 到 Pages |
| `execution-summary`，30 天 | 机器可读任务状态与实际成功部署信息 |

GitHub artifact 遵从仓库的访问和组织保留策略；**公共仓库 artifact 不是私密后台存储**，有相应 GitHub 访问能力的人可下载。这里仅保证不新增公开网站的全图库 API、不把全量索引部署到 Pages。若未来索引必须保密，需先迁移到受控私有产物存储。14 天后通过 `mode=sync` 和原 `photo_commits` 和相同来源配置重建（该 commit 必须仍可读取）；允许缓存命中，也能完全冷启动。导入旧产物时处理版本不兼容会报错，需重新 sync。旧快照可以处理和查看，但正常发布必须与当前网站 main 和全部照片 branch HEAD 一致；恢复旧线上版本使用 rollback。

## 缓存与发布约束

原图按 Git blob SHA 缓存，每次验证字节；metadata、缩略图按源 SHA、远端缩略图 SHA、处理 fingerprint、文件 SHA-256 校验。fingerprint 包含 lockfile、Node/平台/架构、Sharp 原生版本、配置、Builder/依赖本地源码及适配脚本。处理版本变化会重建派生数据；页面和 Project 不进入处理 fingerprint。旧远端缩略图没有处理版本记录，Phase 6 起保守重建。metadata 命中时刷新当前 listing 字段及固定 commit URL，并调用原生文件信息提取；EXIF/HDR/影调只在字节和处理版本一致时复用。无 EXIF 的原生构建时间仍不能当作拍摄时间，Phase 4 UI 规则不变。

Actions 将约 2 GB 原图 cache 与约 35 MB 派生 cache 分开，只保存成功处理的缓存；全部来源快照摘要/fingerprint 使用稳定 key，目录按来源 ID/身份隔离，避免每次 Project 变更复制一份大缓存。恢复前缀只是候选，实际数据仍逐项验证；cache 淘汰不影响完整冷重建。无变化自动轮询仍完成完整性检查，线上已有相同网站/照片 commit 时不重复上传。

每次构建交叉核对 Contents listing 与完整 Git tree，tree 截断即失败；检查数量、ID、所有 published/draft 引用、可解码缩略图和公开资产白名单。复用产物核对完整来源配置摘要、全部固定 commit、fingerprint、逐文件摘要；发布绑定当前 checkout/Project 内容/照片产物版本。原生 Manifest 不加业务字段。未通过任何检查都不调用上传；构建或上传失败不会用部分目录替换线上版本。检测发布后版本失败会尝试恢复上一 deployment；网络结果不明确必须查看 Cloudflare canonical deployment，不能以 CLI 错误推断线上一定没变。

## 回滚

1. 先将 Repository Variable `AUTO_DEPLOY_ENABLED` 设为 `false`（例如 `gh variable set AUTO_DEPLOY_ENABLED --body false`），避免下一次 push/定时运行又自动前滚。等待当前发布任务结束；不要在远程上传中途强制取消。后续构建仍可运行。
2. 从成功的 `execution-summary` 取 **Cloudflare deployment UUID**，不是 GitHub run ID：

```sh
gh workflow run automation.yml --ref main -f mode=rollback -f deployment_id=<成功production-deployment-UUID>
gh run watch <新的run-id>
```

3. 检查摘要、首页及 `/build-version.json`。也可以在 Cloudflare Pages 项目 → Deployments → 该成功 production 版本 → Rollback。回滚复用云端完整部署，不依赖 GitHub artifact 的 30 天保留期；不要删除需要回滚的 Cloudflare deployment。修复后先手动 publish，再重新开启自动部署。

所有发布和回滚使用同一 `gallery-production` concurrency group，不取消正在上传的任务；上传前再次核对网站 main 和全部照片 branch HEAD，并拒绝更小的 run number 覆盖较新的线上版本。GitHub 排队并非 FIFO，所以较旧或重跑的任务仍需通过这些检查。
