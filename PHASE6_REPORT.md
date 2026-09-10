# Phase 6 — 自动化、增量构建与部署

2026-09-10。自动化代码及本地验证完成；**Cloudflare 尚未配置，没有成功的线上部署或实际网站网址**。正式 Project 为 **0 published / 0 draft**，没有用预览选集代替正式内容。UI、Project schema、原生 Manifest v10、上游 HDR/色彩算法不变，照片仓库只读。

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
| Workflow | actionlint 1.7.12 通过；Actions 固定官方版本 SHA，Wrangler 4.130.0 已安装并验证参数；frozen-lockfile 安装通过 |

本机证据：`.cache/phase6-full-test.log`、`.cache/phase6-automation.log`、`.cache/phase6-clean-checks.log`、`.cache/phase6-real-verify.log`、`.cache/automation-test/report.json`、`.cache/phase6-real-{final,warm}.log` 和相应 run 的 `result.json` / `requests.json`。修改照片的测试只使用隔离 fixture；未创建正式摄影 Project。实体 HDR 显示、跨浏览器及 Phase 7 全面优化不在本阶段。

## 后台对接产物

稳定契约和命令见 [README.md](README.md)：`photos` artifact 保留 **14 天**，含原生全量索引、全部缩略图、源快照、处理结果和摘要，包含未公开照片；`website-release` 与 `execution-summary` 保留 **30 天**。完整照片产物不部署到 Pages，没有新增公开全图库 API。公共 GitHub 仓库 artifact **不是保密存储**；未来若要求保密需受控私有存储。过期后按原 `photo_commit` 重新 sync，源 commit 必须可读，cache 不是重建前提。

机器摘要分别记录照片处理、网站构建和网站部署状态，包括代码/照片 commit、实际处理/复用/总数、失败原因。只有实际验证的成功部署或已核实 unchanged 版本才带线上 URL、deployment UUID 和版本。显式复用照片 run 要核对源 commit、处理 fingerprint、完整索引/资源摘要，再绑定新的 Project digest 与网站 commit；网站失败不否定已成功上传的照片产物。未开发身份认证、GitHub App、后台、数据库或照片写入。

## 部署状态与待配置

已只读核实：`jason22016/jason-gallery` 为公开仓库，Actions 已启用，尚无 workflows、Actions Secrets、Repository Variables、Environment、GitHub Pages 或 homepage 配置（核查时）。已实际尝试推送独立 `codex/phase6-automation` 分支触发 Actions，但 GitHub 拒绝：当前 Git PAT 缺少 `workflow` scope。远程分支未创建，真实 Actions 未运行；更改已提交在本地分支。

**实际网站 URL：无。** 未进行线上首页、正式 Project、Viewer、地图资源或照片直达链接验收。已有本地 Chromium fixture 路径测试通过，但不能替代线上验收；正式项目为空也无法验收真实 Project 浏览。

需要先让 Git 推送凭据具备 workflow 更新权限（classic PAT 的 `workflow` scope，或 fine-grained token 的 Contents Write + Workflows Write），再推送本地分支。另需配置：Cloudflare Pages Direct Upload 项目（production branch `main`）；`production` Environment 限制 main；Secrets `CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_API_TOKEN`（指定账户 Pages Edit）；Repository Variables `CLOUDFLARE_PAGES_PROJECT`、`AUTO_DEPLOY_ENABLED=true`。可选照片专用 `JASON_PHOTOS_READ_TOKEN` 仅 Contents Read，否则使用短期 GITHUB_TOKEN 读取公共源。将 workflow 合入 main 后先 dispatch sync，再 publish，检查 `execution-summary` 中实际 URL 和版本。

回滚：先设 `AUTO_DEPLOY_ENABLED=false` 防止定时自动前滚，等待当前上传结束；运行 `gh workflow run automation.yml --ref main -f mode=rollback -f deployment_id=<成功production-deployment-UUID>`，检查摘要与 `/build-version.json`。也可在 Cloudflare Deployments 界面执行 Rollback。云端版本仍保留时不依赖 GitHub artifact 保留期；失败/网络不明确时检查 canonical deployment，不能推断一定未发布。
