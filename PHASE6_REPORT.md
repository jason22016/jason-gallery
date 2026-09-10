# Phase 6 — 自动化、增量构建与部署

2026-09-10。自动化代码、本地验证及真实 Gallery checks 已通过；**Cloudflare 尚未配置，没有成功的线上部署或实际网站网址**。正式 Project 为 **0 published / 0 draft**，没有用预览选集代替正式内容。UI、Project schema、原生 Manifest v10、上游 HDR/色彩算法不变，照片仓库只读。

## 实现

- `automation.yml`：网站 main push、UTC 每小时 17/47 分轮询照片源、手动 dispatch。`mode=sync` 只生成照片产物；`publish` 构建并发布；`rollback` 恢复成功生产版本。手动参数另有 `photo_commit`、`photo_run_id`、`deployment_id`。PR/非 main 运行隔离 `checks.yml`。触发器及 Secrets 不需要写入照片仓库。
- 每次固定照片 commit，Contents/Git tree 交叉核对；原图 blob SHA、照片数量、原生 ID、Project 全部引用、缩略图解码及产物逐文件 SHA-256 必须通过。失败不导出不完整产物，不调用网站上传。
- 原图 cache 与派生 cache 分开。fingerprint 包含配置、lockfile、Node/平台、Sharp native versions、Builder/依赖源码和运行时适配器；未变照片复用 metadata/缩略图，刷新 commit URL 和原生时间 fallback，保留 XMP tags。页面/Project 不触发图片处理；不再信任没有处理版本记录的远端旧缩略图。缓存丢失可以冷重建。
- 原子切换完整照片产物，避免删除残留；CI 串行发布与回滚、不自动取消上传；发布前检查两个 main HEAD、run number 和封存 release，防止旧构建覆盖新版本。生产 build 拒绝脏 checkout、未跟踪 Project、fixture 或额外公开文件，保留 Phase 4 过滤。
- Cloudflare Pages Direct Upload 使用根域名路径，不需改变 UI 资源 URL；只上传通过验证的 dist。默认 `AUTO_DEPLOY_ENABLED=false`，配置后开启自动部署。Cloudflare 失败保留上版；版本检查失败尝试回滚，网络不确定如实报 `failure_or_unconfirmed`。

## 验证结果

| 验证 | 实际结果 |
| --- | --- |
| 全量本地 `pnpm test` | 退出码 0：strict、Project 46/46、网络/Engine smoke、Viewer/Color 5/5、Website 27/27、自动化场景、正式 Astro build |
| 无真实数据的新 CI 环境 | 干净源码副本无 Manifest/缩略图/照片缓存，复用已安装依赖；`test:checks` 退出码 0，无跳过。真实投影审计拆为导出后单独执行的 1 项，仍通过 |
| 最终增量/发布隔离回归 | 冷缓存、热缓存 0 处理、XMP tags 保留、commit URL 刷新、新增/更新/删除、处理版本失效、metadata 损坏、缓存全失、坏原图/并发 writer 拒绝，全部通过 |
| Project 与公开产物 | Project-only 0 处理；所有照片索引含未公开照片，公开 dist 仅引用照片；悬空引用、临时预览文件、fixture 发布、篡改 release 均拒绝，保留上次成功产物 |
| 发布/回滚控制 | 注入隔离托管接口，验证旧代码/旧照片/旧 run 拒绝、上传失败不替换线上、成功版本记录、不变版本跳过、验证失败恢复上一版本和显式 rollback；没有把模拟接口当作真实 Cloudflare 验收 |
| 真实照片 | 固定 `6a7ae47d75dd71bc6874e8d3f222f25b2c05e27f`，154 张完整处理和热缓存复用；热缓存 0 张重新处理、154 张复用、154 张缩略图，5 次 GET 均 200，无原图下载，无照片仓库写入 |
| 真实 GitHub Actions 修复验收 | [run 34443483110](https://github.com/jason22016/jason-gallery/actions/runs/34443483110)，代码 commit `ab62cb4dfa70a196d6181e36fc4a521f3f339b06`：Gallery checks **success**。strict、Project 46/46、网络/Engine smoke、Viewer/Color 5/5、Website 26/26、自动化 1/1，全部零失败、零跳过；fixture Astro 生产构建及发布隔离场景通过，诊断 artifact 上传成功。不是正式网站部署 |
| Workflow | actionlint 1.7.12 通过；Actions 固定官方版本 SHA，Wrangler 4.130.0 已安装并验证参数；frozen-lockfile 安装通过 |

本机证据：`.cache/phase6-full-test.log`、`.cache/phase6-automation.log`、`.cache/phase6-clean-checks.log`、`.cache/phase6-real-verify.log`、`.cache/automation-test/report.json`、`.cache/phase6-real-{final,warm}.log` 和相应 run 的 `result.json` / `requests.json`。修改照片的测试只使用隔离 fixture；未创建正式摄影 Project。实体 HDR 显示、跨浏览器及 Phase 7 全面优化不在本阶段。

## 后台对接产物

稳定契约和命令见 [README.md](README.md)：`photos` artifact 保留 **14 天**，含原生全量索引、全部缩略图、源快照、处理结果和摘要，包含未公开照片；`website-release` 与 `execution-summary` 保留 **30 天**。完整照片产物不部署到 Pages，没有新增公开全图库 API。公共 GitHub 仓库 artifact **不是保密存储**；未来若要求保密需受控私有存储。过期后按原 `photo_commit` 重新 sync，源 commit 必须可读，cache 不是重建前提。

机器摘要分别记录照片处理、网站构建和网站部署状态，包括代码/照片 commit、实际处理/复用/总数、失败原因。只有实际验证的成功部署或已核实 unchanged 版本才带线上 URL、deployment UUID 和版本。显式复用照片 run 要核对源 commit、处理 fingerprint、完整索引/资源摘要，再绑定新的 Project digest 与网站 commit；网站失败不否定已成功上传的照片产物。未开发身份认证、GitHub App、后台、数据库或照片写入。

## 部署状态与待配置

`codex/phase6-automation` 已成功推送，GitHub Actions 已实际执行。初次 Gallery checks [run 34439213192](https://github.com/jason22016/jason-gallery/actions/runs/34439213192) 失败；后续修复与真实检查结果见下方。此前推送凭据缺少 workflow 权限的问题已解除。Cloudflare 仍未配置，未触发生产部署。

**实际网站 URL：无。** 未进行线上首页、正式 Project、Viewer、地图资源或照片直达链接验收。已有本地 Chromium fixture 路径测试通过，但不能替代线上验收；正式项目为空也无法验收真实 Project 浏览。

仍需配置：Cloudflare Pages Direct Upload 项目（production branch `main`）；`production` Environment 限制 main；Secrets `CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_API_TOKEN`（指定账户 Pages Edit）；Repository Variables `CLOUDFLARE_PAGES_PROJECT`、`AUTO_DEPLOY_ENABLED=true`。可选照片专用 `JASON_PHOTOS_READ_TOKEN` 仅 Contents Read，否则使用短期 GITHUB_TOKEN 读取公共源。将 workflow 合入 main 后先 dispatch sync，再 publish，检查 `execution-summary` 中实际 URL 和版本。

回滚：先设 `AUTO_DEPLOY_ENABLED=false` 防止定时自动前滚，等待当前上传结束；运行 `gh workflow run automation.yml --ref main -f mode=rollback -f deployment_id=<成功production-deployment-UUID>`，检查摘要与 `/build-version.json`。也可在 Cloudflare Deployments 界面执行 Rollback。云端版本仍保留时不依赖 GitHub artifact 保留期；失败/网络不明确时检查 canonical deployment，不能推断一定未发布。

## CI Chromium 修复（2026-09-10）

- 初始 run 的 3 个 `webgpu` / `undefined` 失败，在仅增加诊断的 [run 34439788436](https://github.com/jason22016/jason-gallery/actions/runs/34439788436) 原样复现。Ubuntu 24.04 / Playwright 1.62.1 / Chromium 151.0.7922.34 的 GaneshGL + SwANGLE 无法创建 WebGPU 画布 SharedImage（RGBA_F16 和 RGBA_8888），设备丢失后 WebGL 也失败，fixture 最终 `fallbackLoaded=true`、`viewerError="WebGL not supported"`。不是照片下载错误，也不是缺少等待。
- `tests/browser.ts` 统一固定同版 Chromium 的两种配置：WebGPU/色彩测试在 headless shell 显式指定 ANGLE、WebGPU SwiftShader 与 Skia Graphite/Dawn；普通交互/地图在 headless shell 使用 WebGL/GL 合成，专用 Website HDR 测试仍运行真实 WebGPU。仅指定适配器的 run 34440038424 仍失败，证明 `requestDevice` 成功不等于画布可用。CDP 的 `webgpu=unavailable_software` 本身也不能判定失败，需结合 fallback adapter 与真实呈现断言。产品 Viewer、HDR 算法、Manifest 和公开资产路径未改。
- Website 的旧故障注入含被 tsx 序列化进浏览器的 `__name` 辅助函数，产生 ReferenceError；改用独立浏览器脚本，并断言 Viewer 实际调用了故障适配器。Color 每次加载核对真正的 renderer/loaded 状态及无未捕获异常；原有 HDR、ICC、像素容差、回退和 context-loss 断言保留，补充 SDR canvas 配置断言。
- 完整检查还明确设置剪贴板不可用前提；原生滑动按实际时间发送并在松手前停留，面板出现后等待展开动画最终位置再 tap；核对实际命中、原生触摸及恰好一次关闭 click，metadata 使用具体原生 ID 的 URL 拦截并核对拦截次数，保留原有交互/加载状态断言。
- 排查时完整 Chromium 请求 favicon 暴露了测试服务器问题；独立 Viewer fixture 没有 Astro `404.html`，测试服务器现以完整的普通 404 响应结束缺失请求，避免 async handler 未处理 rejection。
- 两个 workflows 在检查步骤启用 `DEBUG=pw:browser`；`viewer-diagnostics` artifact 无论检查成功失败均尝试上传，保留 **14 天**。包含浏览器版本/启动参数、CDP GPU 状态、WebGPU 适配器及设备创建结果、逐次加载状态/控制台/请求错误、SDR 像素数据；仅为隔离 fixture 诊断，独立于照片产物和公开 dist。到期后重新运行检查生成。

修复后的本地完整 `pnpm test:checks` 同样退出码 0（`.cache/phase6-paced-checks.log`），actionlint 与 `git diff --check` 通过。真实 CI 使用仓库固定的 Node 24.19.0、pnpm 11.19.0 和 frozen lockfile；没有跳过测试、重试掩盖失败、放宽像素容差或把 WebGPU 预期改为 fallback。

## Phase 6 补充：多照片源（2026-09-10）

独立分支 `codex/phase6-multi-source`，基于已同步的 main `f6243bb`。本补充不合并 main、不配置或执行 Cloudflare 部署，正式 Project 仍为 **0 published / 0 draft**。

- 新增网站仓库的严格版本化 `config/photo-sources.json`，默认来源保持 jason22016/jason-photos/main/images。稳定 sourceId 与 repo/branch/path 身份摘要隔离引用；名称变更不改引用。每源保留原生 v10 Manifest、8 位原生 ID；网站独立 photo-index 生成 qualified reference，用于 Project、thumbnail、metadata 和 Viewer 分享链接，不改原生 schema/HDR/UI。
- bare 原生 ID 仅兼容原默认来源的固定身份；停用/删除/替换该来源时失败，不能匹配到其他仓库。published/draft 全部校验，跨源同原生 ID 可属于同一 Project；别名和 canonical 重复引用也拒绝。新分享链接统一 qualified ID，旧 bare-ID 链接需替换。
- 所有来源先固定 commit，再按 sourceId/identity 隔离 worker、原图/派生 cache。任何来源失败或引用悬空都保留上一完整 output，已成功来源缓存可用于重试。默认来源导入旧 Git blob cache，派生缓存按新 fingerprint 重建。无 Cloudflare 依赖的 sync 输出每源状态/数量/失败原因；invocationId 防止失败任务误读旧摘要。
- dispatch 改为 `photo_commits`（全部启用 sourceId→commit JSON），保留 mode=sync/publish/rollback、photo_run_id、deployment_id。PhotoSnapshot 绑定完整配置、身份、全部 commit/configDigest；照片 artifact 和 release 升级 schemaVersion=2，旧产物显式拒绝。发布前核对当前网站 main、全部来源 branch、Project 和处理版本，不能混用不同来源集合。
- 后台继续通过修改配置并触发同一脚本接入；photos artifact 的全量索引/逐源原生 Manifest/全部预览保留 14 天，网站 release 和执行摘要 30 天。过期用原配置及 photo_commits 重建。配置不含凭据；可用 JASON_PHOTOS_READ_TOKENS Secret 按 sourceId 提供只读 token。完整索引不进入公开 dist；本阶段没有后台、认证、私有图片代理、上传/删除或数据库。

| 补充验证 | 实际结果 |
| --- | --- |
| 两源隔离 fixture | 同 key/原生 ID 冲突、跨源 Project、热缓存、名称变化、配置/旧产物不匹配、published/draft 停用拒绝、单源解析失败、处理失败、目录替换、照片/来源删除、全部停用及固定默认别名测试通过 |
| 跨源浏览器 | 通过真实 Astro 生产构建、Chromium 首页/Gallery、逐源 Artist/GPS metadata、Viewer 前后切换、刷新/分享、真实 MapLibre ready 与跨源照片选择；第二来源 commit 或来源集合变化在部署 API 前拒绝；所有照片仓库均为隔离 fixture |
| 完整本地 `pnpm test` | 退出码 0：Project 46/46、网络/Engine smoke、Color 5/5、Website 27/27、自动化 3/3、真实 metadata 审计 1/1、正式 Astro 构建；零失败、零跳过 |
| 默认真实图库 | 固定 `6a7ae47d75dd71bc6874e8d3f222f25b2c05e27f`，154 张和缩略图全部通过；新处理版本首次 154 处理；同版本热缓存 0 处理/154 复用；原图仓库未修改 |
| GitHub Actions | [run 34447691951](https://github.com/jason22016/jason-gallery/actions/runs/34447691951)，提交 `a81c8fdf94a92df3d8a25e46f63b4f7447c8ded0`，Gallery checks **success**：strict、Project 46/46、网络/Engine smoke、Color 5/5、Website 27/27、自动化/多源 3/3；零失败、零跳过，诊断产物上传成功 |

本地证据：`.cache/phase6-multi-full.log`、`.cache/phase6-multi-browser.log`、`.cache/phase6-multi-automation.log`、`.cache/multi-source-test/report.json`、`.cache/phase6-multi-real.log`、`.cache/phase6-multi-real-warm.log`。多源机器产物/配置/迁移操作见 README 与架构补充。实际网站 URL 仍为 **无**；回滚方式沿用前文，需已有成功生产部署，本次未执行。

最终真实兼容性审计：网站代码 `b480394`，快照 `b92dcd3e72712d83032ce0a4e85159ca60f056087b3db6dc4581b62b2d14914c`；154 个原生 ID 与迁移前完全一致，154 个固定默认来源旧别名逐一核对，热缓存 0 处理/154 复用，公开产物 0 照片缩略图。证据：`.cache/phase6-multi-real-verified.log`、`.cache/phase6-multi-real-verified-warm.log`、`.cache/phase6-multi-real-compatibility.json`。

多源首次完整 CI run `34447331610` 的新增地图测试停在 loading，原有测试通过；Website 浏览器套件改为串行运行后，上述完整 run 通过。保持地图 ready 断言与 5 秒超时、全部 GPU/色彩断言，无跳过或放宽。双源发布测试还验证：仅第二源 commit 改变或来源集合变化，在调用托管 API 前拒绝发布。代码已推送到独立分支，main 仍为 `f6243bb`，本补充未合并、未部署。

## 公开照片源解析修复（2026-09-10）

- **已确认原因与证据边界**：Gallery automation #2 [run 34449154936](https://github.com/jason22016/jason-gallery/actions/runs/34449154936) 的检查步骤成功，`Resolve immutable photo snapshot` 在仓库 API 请求后报 `Photo repository must be anonymously readable`。旧代码把所有非 2xx 响应及非明确公开结果合并成此错误，并对仓库信息强制匿名查询，忽略本步骤已有来源 Token。历史日志/摘要没有 HTTP 状态、响应头或正文，因此**无法确定该次底层 API 拒绝的具体原因，不能声称已证实限流或私有仓库**。
- **修复**：仓库信息、commit、Git tree 使用该来源的 `JASON_PHOTOS_READ_TOKENS[sourceId]`，回退 `JASON_PHOTOS_READ_TOKEN`；无 Token 仍可匿名查询。必须明确 `private:false`；`private:true` 拒绝，缺字段/错误响应不能放行。401、404（不存在或不可访问，GitHub 无法区分）、无明确限流证据的 403、有证据的限流、临时服务/网络错误分别诊断，保留 HTTP、quota/reset/retry-after/request-id。响应正文、认证头、原始网络异常不写日志。
- **独立原图检查**：从固定 SHA 的完整 tree 筛选所有实际照片（排除 `.afilmory`），通过现有原图 URL 规则逐张匿名 GET Range；不携带 Authorization/Cookie，禁止重定向，要求 200/206 且确有可读取字节，再取消剩余响应。缓存命中也不绕过公开可读检查。API 公开状态与真实原图可读性必须同时通过，任何失败均不进入照片处理/封存/发布；来源隔离和上一完整输出保留不变。
- **超时/重试**：抽取现有只读 fetch 包装器为可局部调用的工厂；沿用每请求 60 秒、最多 3 次、有界退避/Retry-After。已包装请求不再嵌套重试；独立调用 resolve（含发布新鲜度检查）也有相同保护。403 保持原有不自动重试策略，仅在证据支持时标为限流。
- **真实只读网络验证**：最终修复代码在本地现有 Git 凭据下确认 API `private:false`，固定来源 commit `6a7ae47d75dd71bc6874e8d3f222f25b2c05e27f`，154/154 张原图匿名 GET Range 均成功读取到字节。另一次当前本地匿名 API 请求为 HTTP 200 / private=false / remaining=59；这不代表历史 runner 的状态。本地使用的是现有 Git credential，不是无法在本地读取的 production CI Secret；未执行真实照片处理或网站发布。
- **验证与 CI**：本地完整 `pnpm test` 通过：TypeScript、Project 46/46、Engine/网络 smoke、Viewer 5/5、Website 27/27、automation 21/21（含新增可见性/匿名原图测试）、真实 metadata 1/1、Astro 生产构建；最终网络/事务修改再次通过 TypeScript 与 automation 21/21。修复代码 commit `3900371` 的真实 [Gallery checks run 34450646951](https://github.com/jason22016/jason-gallery/actions/runs/34450646951) 全部通过（Ubuntu 24.04；无跳过/放宽断言）。所有照片变更/故障测试使用隔离 fixture；没有修改真实照片仓库、正式 Project、UI、HDR 路径或 Cloudflare 配置。
- **合并后真实图库验收（尚待执行）**：GitHub → Actions → Gallery automation → Run workflow，branch=`main`、mode=`sync`，首次 `photo_commits` 与 `photo_run_id` 留空。亦可运行 `gh workflow run automation.yml --repo jason22016/jason-gallery --ref main -f mode=sync`。使用 production 环境既有只读 Secret（多来源按 ID 映射；默认来源回退单 Token 或 workflow 的 github.token）。确认 resolve 输出 private=false/固定 SHA/匿名原图数量，处理成功后下载 `photos`（14 天）和 `execution-summary`（30 天），核对同一网站 commit、所有来源 commit、照片数量/状态及 `photos.status=success`，部署仍为 `not_requested`。可用摘要中的完整 `photo_commits` 再次 sync 检查缓存复用。若失败按新诊断排查并重试，上一完整产物不被替换。**分支 fixture CI 和本地真实网络读取不能替代 main + production Secrets 的这一步。** 本次仅推送修复分支并创建 PR，不合并、不部署；无新增线上网址。
