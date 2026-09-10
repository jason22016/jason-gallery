# Phase 7 — 轻量后台

## 2026-09-11 部署准备补充

按用户选择准备默认 `jason-gallery-admin.<账户子域名>.workers.dev`，暂不绑定自定义域名，由用户手动完成 Cloudflare 账户与 Access 配置。新增正式 bundle/静态资源打包、非秘密设置模板与完整文件摘要核验；设置缺失时不生成部署配置。默认域名仍要求完整主机的 Access OTP、全部页面/API 的服务端 JWT/邮箱校验、预览 URL 关闭和发布禁用。具体页面操作及本地命令见 [部署准备](docs/ADMIN_DEPLOYMENT_PREP.md)。

新核对的官方限制是 **Access 前置 Worker 目前不能使用 Cache API**；因此下方历史本地热采样不是线上可用路径的证据，持续 miss/no-op 应作为真实 Free 验证基线。已补连续 no-op 的缓存恢复回归。此次仍未购买套餐、进行生产部署、创建正式摄影 Project 或进入 Phase 8。

部署准备的完整 `pnpm test` 已通过：Project 46、Viewer 5、Website 27、automation 21、后台 21、真实 metadata 1，以及 TypeScript、Engine/network smoke 与 Astro 生产构建。后台新增 5 项覆盖配置缺失、错误/预览主机、全入口鉴权开关、秘密混入配置、包文件损坏/缺失/多出和两种域名配置的正式 Wrangler dry-run。默认域名仅做本地准备，真实账号/OTP/Free CPU 验收仍未完成。

---

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


## Phase 7 免费方案优化（`codex/phase7-free-optimization`）

本轮保持完整照片库和现有交互，没有进入 Phase 8。主要改动：固定 blob OID 每批 25 个读取 Project/config、完整校验后的精简目录缓存、共享纯引用校验、64 KiB 请求内 ZIP 合并与减少重复缓存。修复真实并发预览暴露的 zip.js inline 队列跨 workerd 请求 Promise 问题。

- 当前 154 照片的热读取 / Project 保存 / publish V8 采样为 **9.7 / 8.7 / 6.2 ms**，本轮基线为 18.0 / 21.3 / 17.2 ms。40 Project 冷读取外部调用 **71 → 18**；计入 Cache API 后，冷读取 / 保存 / publish 为 **41 / 45 / 40** 次。此前仅统计 fetch 会低估 Free 总预算。
- **仍未通过 Free 上线验收**：154 照片相关冷路径约 46–75 ms；小 fixture 也存在冷 CPU 风险。热值接近限额且有波动，不能以本地样本证明线上 Free 可用。功能验证范围、全部样本、UI 延迟异常、剩余瓶颈和最小 CI 读取产物调整建议见 [ADMIN_CPU_PROFILE.md](docs/ADMIN_CPU_PROFILE.md)。
- 用户体验保留：全库搜索、跨来源选择、照片顺序、编辑内容/选择状态和未保存保护。缓存丢失/到期/故障自动回源，不要求用户手动同步；原产物失效仍拒绝过期数据。真实 154 照片 / 40 Project 的浏览器首屏、预览、选图和保存均重测；可比较的旧版 UI 基线仅补并发队列修复，原始旧版并发失败如实记录。
- 完整 `pnpm test` 通过：Project 46、Viewer 5、Website 27、automation 21、后台 16、真实 metadata 1、Engine/network smoke、TypeScript 和 Astro 生产构建。新增回归覆盖批次末尾 draft/published 悬空引用、部分/截断/OID/大小错误、派生缓存键绑定/损坏/过期/故障、配置/处理器变化、alias/canonical 重复、12 个全冷并发缩略图及正式 UI → 正式 workerd 流程。CI 不以毫秒采样作为通过标准。
- 新 GraphQL 接口已用现有 Git 凭据对真实网站 main 配置进行**只读** OID、字节数和 Git blob SHA-1 验证，无写入。正式 Access OTP、Worker Secret/fine-grained PAT、Cloudflare Free CPU/子请求限额和部署仍未验收。
- 没有购买套餐、生产部署或创建正式摄影 Project。`PUBLISH_ENABLED=false` 与现有生产保护保持不变。分支推送后的 [Gallery checks](https://github.com/jason22016/jason-gallery/actions/workflows/checks.yml?query=branch%3Acodex%2Fphase7-free-optimization) 对交付提交执行回归。
