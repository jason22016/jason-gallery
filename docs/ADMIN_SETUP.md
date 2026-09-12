# Phase 7 后台：配置与验收

> 2026-09-11 更新：原部署已实际复现 Free CPU 超限。新版改为 CI 封存紧凑产物、Worker 无 Cache API 读取；实现与本地回归正在验证，迁移及真实 Free 验收尚未完成。当前状态和新版契约见 [ADMIN_COMPACT_READ.md](ADMIN_COMPACT_READ.md)。下文旧路径与旧测量保留为历史基线。

已实现独立 Cloudflare Worker（后台静态资源 + Serverless API），唯一登录方式是 Cloudflare Access 邮箱一次性验证码。公开网站继续由现有 Actions 发布到 Cloudflare Pages Direct Upload。本地 fixture、签名 JWT 单元测试和 workerd 测试都不能替代真实 Access 登录或生产部署验收。

## 本地验证

Node 与 pnpm 版本以 `.node-version` / `package.json` 为准。

```sh
pnpm install --frozen-lockfile
pnpm admin:fixture        # 4325：生成图片 + 隔离 UI 预览，只有内存编辑
pnpm admin:preview        # 4325：使用既有本地缩略图，Project/来源仍为 fixture
pnpm admin:build          # .cache/admin-release，仅管理 UI，无 fixture 数据/照片产物
pnpm admin:prepare        # 本地部署包、配置完整性与 SHA-256 清单；不会上传
pnpm admin:verify-package # 检查已生成包是否被改动；不代表线上验收
pnpm admin:profile        # 完整认证请求的本地 CPU 采样；不等于 Free 验收
pnpm admin:types          # 根据配置重新生成 Env 类型
pnpm test:admin           # JWT、GitHub/ZIP 传输 fixture、正式 UI、真实本地 workerd
pnpm test                # 原有完整回归、真实 metadata 审计、公开网站构建
pnpm admin:dev            # 本地 Worker；没有有效 Access JWT 时拒绝访问
pnpm exec wrangler deploy --config admin/wrangler.jsonc --dry-run
```

本地不提供密码、万能 Token 或跳过认证的开关。未配置 Access/Secret 返回 503；配置后缺少/无效签名返回 401，页面和 API 一致。浏览器接口测试拦截的是隔离 API 响应；后端独立用临时 RSA 密钥验证 JOSE 校验和写入拒绝，生产入口不包含这些测试密钥或替代登录方式。

## 上线前配置（本阶段尚未执行上线）

1. **优先 Workers Free，但尚未通过免费上线验收**。未配置 Paid CPU override。Free 每请求 10 ms CPU、50 次子请求；Cache API 调用也共享该预算，不能只看外部 fetch 次数。Phase 7 已优化完整目录读取、不可变缓存、批量 Project 校验与并发预览，但冷路径仍有 CPU 风险，适用规模和测量结果见 [免费额度评估](ADMIN_CPU_PROFILE.md)。必须在实际 Free 账户完成验收后再考虑上线，不默认购买 Paid。[官方限制](https://developers.cloudflare.com/workers/platform/limits/)。
2. 用户选择先使用 `https://jason-gallery-admin.<账户子域名>.workers.dev`，暂不配置自定义域名。按 [部署准备说明](ADMIN_DEPLOYMENT_PREP.md) 填写 `admin/deployment.local.json`；准备命令为该默认域名显式开启 `workers_dev`，不生成自定义 routes，保留 `preview_urls:false` 与 `run_worker_first:true`。**先创建 Access application 并覆盖整个主机**（包括 `/api/*` 与静态资源），再部署 Worker。不能设置 Bypass 或只保护预览。以后切换自定义域名时生成唯一 Custom Domain route 并关闭 workers.dev。
3. Access 选择 Self-hosted application，启用 One-time PIN 身份提供者；唯一 Allow policy 列出明确管理员邮箱，不允许 Everyone/整域名。记录 team issuer `https://TEAM.cloudflareaccess.com` 与 application AUD。
4. 填写 Worker 非秘密配置：`ADMIN_ORIGIN`（无末尾斜线的 https origin）、`ACCESS_ISSUER`（无末尾斜线）、`ACCESS_AUD`、`ADMIN_EMAILS`（逗号分隔邮箱，与 Access policy 一致）、`GITHUB_REPOSITORY`（网站仓库）、`PUBLISH_ENABLED`（初始 `false`）。真实 Access/网站域名尚未配置时，仓库中的空值有意使服务拒绝访问。
5. 为网站仓库创建 fine-grained GitHub PAT，仅选择这一仓库，授予 **Contents Read/Write、Actions Read/Write**（Metadata Read 为必需权限）。获准远端配置后，通过 `pnpm exec wrangler secret put GITHUB_TOKEN --config .cache/admin-deploy/wrangler.json` 交互写入 Worker Secret（使用准备命令生成的完整配置；此操作会写远端）。不要放到 `vars`、前端环境变量、命令参数、提交文件或日志；不要选择照片仓库。Token 对 main 的提交还必须符合现有分支规则；若规则阻止直接提交，应配置被批准的专用自动化身份权限，不能把 API 的 403 当保存成功。
6. `AUTO_DEPLOY_ENABLED` 保持 `false`：后台保存提交使用固定消息 `[skip ci]`，不会触发 push workflow；定时 workflow 仍可能同步/构建，但此变量为 false 时不会自动部署。手动 publish 才表示明确发布意图。若想完全由后台发起同步，可另行停用定时调度；本阶段保留既有 schedule。
7. 配置现有 GitHub `production` Environment：`CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_API_TOKEN`（所需账户 Pages Edit）、`CLOUDFLARE_PAGES_PROJECT`，Pages production branch 为 main。已有照片源只读 Secret 按 Phase 6 规则使用（`JASON_PHOTOS_READ_TOKENS` / `JASON_PHOTOS_READ_TOKEN`，缺省 workflow token）；照片必须公开且原图匿名可读。Cloudflare 发布凭据只给 Actions，后台 Worker 不需要这些凭据。
8. 获准上线后构建并部署管理 Worker。先验证管理员 OTP 登录、非管理员拒绝、无 JWT 直接请求 API 拒绝、退出/过期登录重新认证、浏览器 Network 不含 GitHub/Cloudflare secret。将 GitHub 保存/冲突/触发验收安排在受控内容上，不用虚构正式摄影 Project 替代验收。只有 processor inputs/锁文件或来源配置发生变化才需同步新产物；缓存淘汰本身不要求 sync。
9. 实际 Pages 配置及发布权限准备好后才设 `PUBLISH_ENABLED=true`。先 sync 确认每源摘要，再明确确认 publish；检查 Actions deployment status、版本探针与线上内容。只有 `success/unchanged` + 版本/URL + 成功任务才会显示“网站发布已确认”。本阶段没有进行此生产验收。

## 操作与边界

- **未保存编辑**：从照片库加入新/其他 Project、切换编辑对象或放弃当前修改前，统一提供保留编辑、显式放弃、保存后继续。校验失败、网络失败或版本冲突时不切换，编辑和选图仍保留。继续向当前 Project 加图不会替换其编辑。
- **保存**：来源配置或单个 Project JSON 写到网站 `main`；只能写 `config/photo-sources.json` / `src/content/projects/<slug>.json`。前端发送 expected head，服务端先检查，复用共享引用校验验证全部 draft/published（无需构造/冻结页面照片对象），再创建以该 head 为唯一父提交的 Git commit，并非强制更新 main ref。中途出现并发提交也会拒绝，不重试覆盖。冲突保留编辑并提供检查/放弃后重新加载入口。已有 Project 的 slug 固定，其他 schema 字段原样保留。
- **来源影响**：仓库、分支、目录变更或停用/移除来源前检查全部 draft/published 引用；存在引用则拒绝。来源 identity / canonical reference、固定默认来源 legacy alias 都沿用 Phase 6；含双连字符的原生文件名也不会被当成 canonical 引用。先调整 Project 引用，再修改来源；新增源保存后需同步才能选图。
- **照片**：读取 main Gallery automation 的完整 `photos` 包与 `execution-summary`，核对来源配置/快照、原生和全量索引、文件摘要、生产来源、producer 处理代码及依赖。CI 仍校验全部文件和解码缩略图；Worker 复用共享 metadata 检查，每个取出的文件/缩略图再校验摘要。Worker 按字节范围读取 ZIP，不将约 70 MB 的整个包装进内存。浏览器只收到 UI 所需字段与已认证缩略图端点；不提供原图代理。
- **读取与缓存**：当前照片库一次返回完整轻量目录，搜索覆盖全部照片，跨来源选择、顺序、编辑和选择状态保持不变。Project/config 按当前 Git tree 的不可变 blob SHA，每批最多 25 个通过 GraphQL 读取；逐项核对 OID、字节数、Git blob SHA-1，拒绝截断或部分返回。现有同一个网站 PAT 用于 GraphQL（不增加认证方案）。Worker Cache API 缓存完整验证后派生的精简目录、内容批次、缩略图摘要、ZIP 尾部目录/解压文件及任务摘要，最多 1 小时且不超过 artifact 保留期；派生记录的校验和绑定仓库、键、到期时间与内容。正文 ZIP 窗口仅在单请求内合并，避免重复消耗缓存调用额度。缓存丢失、到期或不可用会自动重新读取当前 GitHub/原产物，不要求用户手动 sync；只有原产物失效或配置/处理版本不符才需要同步。每个请求先认证；不缓存 token、cookie、签名下载链接或认证决定，缓存不是独立数据库。GitHub 产物仍受原仓库可见性/保留策略约束，公共仓库 artifact 不是秘密存储。
- **新鲜度**：项目文字修改不使照片过期；照片配置或 processor inputs/锁文件变化、缺失/过期 artifact、最近任务没有完整照片结果时禁止选图/保存引用/发布，提供同步入口。照片库展示的是已验证的固定快照，源 branch 后续变化由下一次 sync 处理；最终发布沿用 Phase 6 的实时网站/每源 HEAD 检查。
- **任务**：触发带唯一 request UUID 与 expected website SHA，按精确 run title 查找任务；工作流开始时拒绝竞态版本。API 返回 pending 不表示排队/成功。运行中展示 Actions steps，完成后停止轮询并读取每源 processed/reused/total、失败原因、构建与部署状态。网络超时/摘要丢失/取消不能认定部署成功；触发结果不确定时先查任务记录，避免重复触发。最近列表最多 30 个 run，界面展示最近 10 个或当前请求；更早任务在 Actions 查看。
- **资源限额**：最多 50 个来源（沿用 schema）、500 个 Project、Project slug 120 字符、单次保存 512 KB、单个 metadata/缩略图文件 8 MB、ZIP 1 GB / 30,000 entries、单请求 ZIP range 总量 32 MB / 解压总量 8 MB、全部 Project 内容 4 MB。超限明确拒绝，不能丢掉部分照片继续发布。这些是安全容量上限，并非 Free 可用规模承诺。需要扩大规模时须重新评估 CPU、fetch + Cache API 总预算和完整搜索/编辑体验；本阶段不引入数据库、原图上传/删除、账号体系或图像代理。

## 依赖与依据

独立实现后台 UI，参考 Afilmory 实际后台导航/网格/表单/任务布局，未复制其 AGPL/ANL 应用代码、字体或品牌资产。具体源码版本与许可证判断见 [PHASE7_PLAN.md](PHASE7_PLAN.md)。JOSE 6.2.12 为 MIT（Filip Skokan），zip.js 2.14.0 为 BSD-3-Clause（Gildas Lormeau），保留依赖自身 LICENSE；新增库仅进入 Worker bundle，不进入浏览器。完整声明见 [ADMIN_THIRD_PARTY_NOTICES.txt](ADMIN_THIRD_PARTY_NOTICES.txt)。

官方依据：[Access JWT 校验](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)、[Worker 静态资源路由](https://developers.cloudflare.com/workers/static-assets/routing/)、[Git ref 非强制更新](https://docs.github.com/en/rest/git/refs#update-a-reference)、[跳过 push CI](https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-workflow-runs/skipping-workflow-runs)、[workflow dispatch](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event)。

### 已上线主站与后台发布入口

主站的部署状态与后台 `PUBLISH_ENABLED` 是两个独立状态。后台关闭发布入口时显示“后台发布入口未启用”，不能据此判断 Cloudflare 未配置或主站未部署。

确认主站已通过 GitHub Actions 成功发布后，在 `admin/deployment.local.json` 设置 `"publishEnabled": true`，重新准备并部署后台。该设置默认 false；准备脚本将其显式写入 Worker 的 `PUBLISH_ENABLED`，避免后续部署意外关闭入口。它不会修改 Actions 的 `AUTO_DEPLOY_ENABLED`。

后台操作顺序：保存内容 → 如照片源变化则同步照片并刷新产物 → 发布与记录 → 查看发布步骤 → 确认发布已保存版本。仅公开 `published` Project；保存、删除和同步本身不会自动发布。已成功部署的结果仍以 Actions 执行记录里的验证摘要为准，开启入口不是部署成功证明。

同步操作统一在“照片 → 同步照片”：选择来源、预览变化后执行同步。照片不可用或发布前缺少产物时，快捷入口仅导航到同一面板，不直接触发任务。“发布与记录”负责确认主站发布和查看记录；“刷新后台数据”只重新读取已保存内容和产物，不启动同步或发布。
