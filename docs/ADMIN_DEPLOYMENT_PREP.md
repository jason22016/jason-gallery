# 后台 Worker 部署准备

> 2026-09-11 更新：原部署已实际复现 Free CPU 超限。新版改为 CI 封存紧凑产物、Worker 无 Cache API 读取；实现与本地回归正在验证，迁移及真实 Free 验收尚未完成。当前状态和新版契约见 [ADMIN_COMPACT_READ.md](ADMIN_COMPACT_READ.md)。下文旧路径与旧测量保留为历史基线。

2026-09-11：准备对象为 `jason-gallery-admin`。用户选择先使用 `https://jason-gallery-admin.<账户子域名>.workers.dev`，由用户在 Cloudflare 网页手动配置；暂不绑定自定义域名。公开网站继续使用已有 Pages Direct Upload。此文和 `admin:prepare` 均不执行上传、Secret 写入、域名变更、套餐购买或生产部署。

## 当前状态

| 项目 | 证据与状态 |
| --- | --- |
| Phase 7 代码 | `main` 的 `1d2e12c` 已合并；[checks](https://github.com/jason22016/jason-gallery/actions/runs/34496837930) 与 [main automation](https://github.com/jason22016/jason-gallery/actions/runs/34498963352) 成功，后者部署步骤 skipped。 |
| Cloudflare 账户 | 用户已有账户及正在使用的自有域名；本机 Wrangler 4.130.0 的 `whoami` 返回未登录。尚未取得账户 ID 与 workers.dev 子域名；此次不需要修改自有域名。 |
| Access | 用户尚未配置；需团队域名、覆盖后台整个主机的 OTP application、AUD 和准确的邮箱 Allow policy。 |
| Worker 配置 | 非秘密设置模板、正式 bundle 的本地打包命令和文件摘要检查已提供；空设置不会产生部署配置。 |
| GitHub 凭据 | 尚未安装后台专用 Secret。不能把开发机已有个人 Git 凭据自动复制成部署凭据。 |
| Workers Free | **未通过**。154 照片 / 40 Project 的本地冷照片操作约 46–75 ms；线上计费 CPU 尚无证据。官方还明确 Access 前置 Worker 目前不能使用 Cache API，不能依赖本地热缓存结果。详见 [CPU 评估](ADMIN_CPU_PROFILE.md)。 |

## 用户需要完成的账户操作

1. 打开 Cloudflare 的 **Workers & Pages**，查看账户的 workers.dev 子域名（首次使用按页面提示选定）。记下账户 ID，以及将来的地址 `https://jason-gallery-admin.<账户子域名>.workers.dev`。不需要将自有域名转入 Cloudflare，也不要改现有网站的 DNS、NS、根域名或 `www`。[默认域名格式](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)
2. 打开 **Zero Trust / Cloudflare One**，首次进入时完成组织设置，选择免费方案并记录团队名称。团队域名 `https://<team>.cloudflareaccess.com` 与 workers.dev 账户子域名是两回事。
3. 在 **Zero Trust → Integrations → Identity providers → Add new identity provider** 添加 **One-time PIN**。新组织不一定默认启用 OTP，不能把默认 Cloudflare 身份提供者误认为邮箱验证码。[OTP 官方步骤](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/)
4. 在 **Zero Trust → Access controls → Applications → Create new application** 创建 Self-hosted 应用。添加 public hostname，完整填写 `jason-gallery-admin.<账户子域名>.workers.dev`（必要时使用自定义输入）；路径留空，使保护覆盖页面、资源与 `/api/*`。登录方式只选 One-time PIN。创建 Allow policy：Include 的选择器为 **Emails**，值为管理员的完整邮箱。不能选 Everyone、邮箱整域名、Bypass 或仅预览流量。记录该应用的 AUD tag。[Workers 的主机名 Access 保护](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)
5. 如果管理 Worker 已存在，也可以从该 Worker 的 **Access → Protect this Worker behind Access → All traffic** 设置同样的精确邮箱/OTP policy，并使用该应用的 AUD。不要启用账户级 Protect all Workers，以免影响已有网站。本次不要求先创建或发布一个演示 Worker。
6. 之后创建仅针对 `jason22016/jason-gallery` 的 fine-grained PAT，Contents / Actions 为 Read and Write，Metadata 为 Read；不选择照片仓库。凭据留在密码管理器，后续获准部署时才安装为 Worker 的 `GITHUB_TOKEN` Secret。Cloudflare Pages 发布凭据继续仅保存在 Actions，不放入后台。

Access policy 写入和 Secret 安装是用户后续真实配置操作；目前尚未执行。账号登录或验证码由账号持有人完成。后续若由本地 Wrangler 上传，再运行 `pnpm exec wrangler login`，在浏览器完成授权，用 `pnpm exec wrangler whoami` 核对账户；这不是后台的登录方式，也不是本次手动配置的前置条件。

## 本地生成与核验

使用仓库锁定的 Node / pnpm。复制模板，填写非秘密参数：

```sh
cp -n admin/deployment.example.json admin/deployment.local.json
```

| 字段 | 内容 |
| --- | --- |
| `accountId` | Cloudflare 控制台或 `wrangler whoami` 中正确账户的 32 位 ID |
| `adminOrigin` | `https://jason-gallery-admin.<账户子域名>.workers.dev`，不含末尾 `/` 或路径 |
| `accessIssuer` | `https://<team>.cloudflareaccess.com`，不含末尾 `/` |
| `accessAud` | Access 应用的 AUD tag，64 位十六进制 |
| `adminEmails` | 管理员邮箱字符串数组，与 Access Allow policy 一致 |

`deployment.local.json` 和 `.cache/` 均被 Git 忽略。此文件只允许这五个字段，不能加入 token。`admin/wrangler.jsonc` 保留为运行配置基准；真实参数统一放在 local 文件，避免两处设置不一致。

```sh
pnpm admin:prepare
pnpm admin:verify-package
```

准备命令重新构建正式 UI，调用 Wrangler `deploy --dry-run` 生成正式服务端 bundle，再复制管理 UI 的 HTML/JS/CSS。输出 `.cache/admin-deploy/`：

- `bundle/worker.js` 及 source map：正式编译结果。
- `assets/`：仅管理 UI，无 fixture、照片包、完整索引或公开网站 dist。
- `wrangler.json`：仅在所有参数填写且本地格式检查通过后生成。绑定刚生成的 bundle/资源，使用 `no_bundle:true`，再以此配置执行一次 dry-run，避免正式部署时重编译不同代码。
- `manifest.json`：时间、代码 commit、工作区是否有未提交变更、输入配置 hash、逐文件字节数/SHA-256、缺少参数和未完成的远端检查。

按用户选择，生成配置仅为匹配 `jason-gallery-admin` 名称的默认域名设 `workers_dev:true`，不生成 Custom Domain routes；继续保留 `preview_urls:false`、`run_worker_first:true`、`PUBLISH_ENABLED=false`、Access 的 issuer/AUD/独立邮箱名单及原网站仓库限制。配置基准中的未配置入口仍关闭；准备命令显式生成本次入口。若以后填自定义域名，将生成唯一 Custom Domain route 并关闭 workers.dev。未知基础配置字段要求复核，不能静默忽略新 binding/route。

`admin:prepare` 成功表示**本地包已生成**；`configurationReady` 仅表示配置格式完整，不证明域名或 Access 已生效。`admin:verify-package` 比较完整文件集合及摘要，文件缺失、多出、改变或出现 symlink 都失败；这用于检测意外改动，并非签名或远端新鲜度证明。两者都不会报告生产就绪。准备失败时原来的成功包可能保留，必须检查退出码、manifest 时间及 commit，不能把旧包当成本次结果。源码或配置变化后应重新准备。

## 获准远端验证后的顺序

先核对正确的 workers.dev 账户子域名、Access 实际 policy、账户 Free 套餐、Worker Secret 与专用 PAT 的权限。`wrangler secret put` 会写远端，并可能在首次使用时创建 Worker；它不属于本地准备。安装 Secret 后，正式上传只能使用本次核验的包配置：

```sh
# 仅在另行获得部署授权并完成前置检查后运行；本次未执行。
pnpm exec wrangler secret put GITHUB_TOKEN --config .cache/admin-deploy/wrangler.json
pnpm exec wrangler deploy --config .cache/admin-deploy/wrangler.json
```

此 Worker 初始禁止网站发布，但已登录管理员的保存会写网站 `main`，sync 会触发真实 Actions；不能把真实后台当成内存预览。远端功能验证应使用经批准的受控测试内容，不创建正式摄影 Project。Pages 仍保持自动部署关闭，不手动 dispatch `publish`。

真实验收需记录确切代码/Worker version、Cloudflare plan、照片/来源/Project 数量，覆盖 OTP、未登录及非管理员拒绝、JWT 过期、跨来源完整搜索/选图与编辑保护、所有 draft/published 引用、保存冲突、产物过期/缓存淘汰自动重取及冷并发预览。测量实际 `cpuTime`、1102 / `exceededCpu`、请求和 Cache API 总开销，以及首屏、选图、保存的 P50/P95；不能用本地 V8 或 dry-run 成功代替。[Free 官方限制](https://developers.cloudflare.com/workers/platform/limits/)

现有冷 CPU 风险尚未消除。[Cache API 官方说明](https://developers.cloudflare.com/workers/runtime-apis/cache/) 明确指出 Access 前置 Worker 目前不能使用 Cache API；这不是更换自定义域名就能解决的问题。部署验收应包含连续 miss / no-op 的运行情况，本地 warm 结果不能外推。现有回归验证缓存不可用时自动读取，不要求手动同步；功能正确不等于 Free 限额内成功。

下一步最小性能调整仍是由现有完整 CI verifier 封存紧凑后台读取产物，移出大 ZIP 目录与完整 EXIF 的冷解析，同时保留全部引用/完整性/新鲜度检查及完整搜索体验，并以无持久 Cache API 的路径为验收基线。此部署准备没有实施这项新契约，也没有据此声称 Free 达标；无需为本次准备默认升级 Paid。
