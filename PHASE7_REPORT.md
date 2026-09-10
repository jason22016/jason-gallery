# Phase 7 — 轻量后台

2026-09-10。独立分支 `codex/phase7-admin`；用户确认 fixture UI 后全面接入。最新 main `9a41478` 已同步到本分支；未将后台合并到 main，未执行生产部署，未创建正式摄影 Project。Polish、SEO 和性能优化顺延 Phase 8。

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
- GitHub Actions：最终分支检查链接在提交后补充。

## 上线前仍需真实验收

Cloudflare 尚未配置。Access OTP 登录与非管理员拒绝、正式 Worker 的 GitHub 保存/冲突/dispatch、生产 Secrets、Pages 实际发布与线上版本探针均**未真实验收**；本地签名测试和 dry-run 不能替代这些环节。

上线配置：Worker Custom Domain、Access application/policy/AUD/issuer/管理员邮箱、仅网站仓库 Contents/Actions 的 GitHub PAT Worker Secret、现有 Pages production Environment。当前按 Workers Paid 额度配置；没有购买套餐。`PUBLISH_ENABLED=false`、`AUTO_DEPLOY_ENABLED=false`，后台分支须先获准合并，再同步新处理版本产物。

完整步骤、权限、容量上限和故障处理见 [ADMIN_SETUP.md](docs/ADMIN_SETUP.md)。架构见 [ARCHITECTURE.md](ARCHITECTURE.md)，Afilmory 实际源码与许可证核查见 [PHASE7_PLAN.md](docs/PHASE7_PLAN.md)。原生 Photo Engine、Manifest 和 HDR 算法未修改。
