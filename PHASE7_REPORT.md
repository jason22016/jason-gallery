# Phase 7 — 轻量后台

2026-09-10。独立分支 `codex/phase7-admin`；用户确认 fixture UI 后全面接入。最新 main `9a41478` 已同步到本分支；后续按用户授权合并 main（`daee9bd`），[合并后 automation](https://github.com/jason22016/jason-gallery/actions/runs/34483846044) 成功；未执行生产部署，未创建正式摄影 Project。Polish、SEO 和性能优化顺延 Phase 8。

## 交付

- 独立 Cloudflare Worker 管理入口 + Access 邮箱 OTP。所有页面/API 服务端验证签名、issuer/AUD/时效及管理员邮箱；同源 JSON 写入。没有模拟登录或跳过认证模式。
- 已确认的响应式 UI 接通真实管理 API：照片源新增/编辑/启停与全部 Project 引用影响检查；按来源浏览与跨源选图；Project 创建/编辑、封面、顺序、draft/published。
- 配置/Project 仍保存在网站 GitHub 仓库。复用 Phase 6 来源身份与 Project schema/resolver，限定可写路径；expected head + 非强制原子 ref 更新拒绝并发覆盖，冲突保留编辑。保存、sync、publish 分开，保存提交不触发 push CI。
- 读取原生 Manifest/完整索引及执行摘要，复用产物校验；按范围读取 ZIP，认证后才读取缓存和缩略图。缺失/过期/不匹配/同步失败提供明确状态和重试入口，不建立第二套 metadata，不代理原图。
- Actions request UUID/预期网站 SHA 关联具体任务；展示 steps、每源处理/复用/总数、失败原因与部署状态。pending 不等于成功，摘要缺失/失败/取消不显示发布已确认。

## 验证

- 本地完整 `pnpm test` 通过：TypeScript、Project 46、Engine/网络 smoke、Viewer 5、Website 27、automation 21、后台 11、真实 metadata 1、Astro 生产构建。后台覆盖缺失/伪造/过期/错误 AUD/邮箱身份、写入拒绝、schema/路径、两个冲突窗口、跨源引用、来源影响、缓存鉴权/过期、同步失败、产物损坏/过期/处理器变化、pending 与真实发布状态；正式 UI 接口测试和实际本地 workerd 测试均使用隔离 fixture。
- Worker `wrangler deploy --dry-run` 打包通过，没有上传/部署。真实 UI bundle 无服务端凭据/代码、fixture 数据；正式 Project 目录仍只有 `.gitkeep`。
- 已确认最新 main 的真实 [Gallery sync 34452182457](https://github.com/jason22016/jason-gallery/actions/runs/34452182457) 成功：来源 `jason-photos` commit `6a7ae47d75dd71bc6874e8d3f222f25b2c05e27f`，154 张、0 处理 / 154 复用、无失败；deployment=`not_requested`。这是上游修复合并后的真实任务，不是本阶段模拟或新部署。
- 本地用正式后台读取代码和已有 Git 凭据**只读**读取该任务的真实摘要、154 张完整索引和抽样缩略图，文件摘要通过；快照 `b92dcd3e72712d83032ce0a4e85159ca60f056087b3db6dc4581b62b2d14914c`。凭据只在进程内，未输出或写入文件。证据 `.cache/admin-read-real.json`；全回归 `.cache/phase7-final-regression.log`。
- GitHub Actions：[本分支 Gallery checks](https://github.com/jason22016/jason-gallery/actions/workflows/checks.yml?query=branch%3Acodex%2Fphase7-admin) 执行完整回归（含正式后台 build、本地 workerd 和所有后台测试）；具体提交与结果以该运行记录为准。

## 上线前仍需真实验收

Cloudflare 尚未配置。Access OTP 登录与非管理员拒绝、正式 Worker 的 GitHub 保存/冲突/dispatch、生产 Secrets、Pages 实际发布与线上版本探针均**未真实验收**；本地签名测试和 dry-run 不能替代这些环节。

上线配置：Worker Custom Domain、Access application/policy/AUD/issuer/管理员邮箱、仅网站仓库 Contents/Actions 的 GitHub PAT Worker Secret、现有 Pages production Environment。已移除 Paid CPU 配置，优先免费；[本地测量](docs/ADMIN_CPU_PROFILE.md)显示冷请求/批量内容仍不满足免费目标，不能作为免费部署验收。没有购买套餐。`PUBLISH_ENABLED=false`、`AUTO_DEPLOY_ENABLED=false`，正式部署前仍需同步与当前处理版本一致的照片产物。

完整步骤、权限、容量上限和故障处理见 [ADMIN_SETUP.md](docs/ADMIN_SETUP.md)。架构见 [ARCHITECTURE.md](ARCHITECTURE.md)，Afilmory 实际源码与许可证核查见 [PHASE7_PLAN.md](docs/PHASE7_PLAN.md)。原生 Photo Engine、Manifest 和 HDR 算法未修改。

## 后续修复（独立分支 `codex/admin-drafts-free-profile`）

- 未保存 Project 在加入新建/其他 Project 前统一询问保留、放弃或保存后继续。新增生产 UI 浏览器回归覆盖取消、顺序/字段/选图保留、校验失败、HTTP 500、409 冲突及成功切换。
- 增加正式 Worker 完整认证请求的本地 workerd 回归，发现并修复原生 fetch 接收者和 redirect 模式兼容性。此前仅未登录 workerd 测试及 Node 传输 fixture 不足以证明这些路径兼容。
- 本地 CPU 采样重放双源 fixture 与 154 照片产物，覆盖来源/Project 保存、照片库/缩略图、sync/publish 触发、任务、40 Project。增加解压文件缓存与单请求重复读取合并，仍保留认证、摘要、新鲜度和两个冲突窗口。移除 Paid CPU override，明确免费上线仍未通过；详情见 [评估报告](docs/ADMIN_CPU_PROFILE.md)。
- 所有保存/dispatch 为隔离 fixture；真实 Access、Cloudflare Free CPU 与正式发布仍未验收。本轮未合并 main、未生产部署。
- 本轮完整 `pnpm test` 通过：后台扩展到 13 项（含新增浏览器与认证 workerd 回归），原有 Project/Engine/Viewer/Website/automation/真实 metadata 和生产构建通过；`admin:types` 及 Worker dry-run 通过。GitHub 分支检查结果见交付提交对应的 Gallery checks。
