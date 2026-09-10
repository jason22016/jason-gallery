# Phase 7 后台：配置与验收

已实现独立 Cloudflare Worker（后台静态资源 + Serverless API），唯一登录方式是 Cloudflare Access 邮箱一次性验证码。公开网站继续由现有 Actions 发布到 Cloudflare Pages Direct Upload。本地 fixture、签名 JWT 单元测试和 workerd 测试都不能替代真实 Access 登录或生产部署验收。

## 本地验证

Node 与 pnpm 版本以 `.node-version` / `package.json` 为准。

```sh
pnpm install --frozen-lockfile
pnpm admin:fixture        # 4325：生成图片 + 隔离 UI 预览，只有内存编辑
pnpm admin:preview        # 4325：使用既有本地缩略图，Project/来源仍为 fixture
pnpm admin:build          # .cache/admin-release，仅管理 UI，无 fixture 数据/照片产物
pnpm admin:types          # 根据配置重新生成 Env 类型
pnpm test:admin           # JWT、GitHub/ZIP 传输 fixture、正式 UI、真实本地 workerd
pnpm test                # 原有完整回归、真实 metadata 审计、公开网站构建
pnpm admin:dev            # 本地 Worker；没有有效 Access JWT 时拒绝访问
pnpm exec wrangler deploy --config admin/wrangler.jsonc --dry-run
```

本地不提供密码、万能 Token 或跳过认证的开关。未配置 Access/Secret 返回 503；配置后缺少/无效签名返回 401，页面和 API 一致。浏览器接口测试拦截的是隔离 API 响应；后端独立用临时 RSA 密钥验证 JOSE 校验和写入拒绝，生产入口不包含这些测试密钥或替代登录方式。

## 上线前配置（本阶段尚未执行上线）

1. 当前实现按 **Workers Paid** 的运行限制配置（30 秒 CPU 上限，ZIP/多源读取可能超过 Free 的 50 次子请求）；本阶段没有开通或购买套餐。[官方限制](https://developers.cloudflare.com/workers/platform/limits/)。网站 main 先包含 Phase 7 工作流与接口契约。本分支尚未合并；当前 main 不认识 `request_id` / `expected_website_commit` 输入，不能在合并前验收正式 dispatch。
2. Cloudflare 创建独立管理子域名，例如 `admin.your-domain.example`。将它作为 Worker Custom Domain 配置在 `admin/wrangler.jsonc` 的 `routes`，形如 `{"pattern":"admin.your-domain.example","custom_domain":true}`。**先创建 Access application 并覆盖整个主机**（包括 `/api/*` 与静态资源），再部署 Worker。不要给 API 或静态资源设置 Bypass；保留 `workers_dev:false`、`preview_urls:false`、`run_worker_first:true`。
3. Access 选择 Self-hosted application，启用 One-time PIN 身份提供者；唯一 Allow policy 列出明确管理员邮箱，不允许 Everyone/整域名。记录 team issuer `https://TEAM.cloudflareaccess.com` 与 application AUD。
4. 填写 Worker 非秘密配置：`ADMIN_ORIGIN`（无末尾斜线的 https origin）、`ACCESS_ISSUER`（无末尾斜线）、`ACCESS_AUD`、`ADMIN_EMAILS`（逗号分隔邮箱，与 Access policy 一致）、`GITHUB_REPOSITORY`（网站仓库）、`PUBLISH_ENABLED`（初始 `false`）。真实 Access/网站域名尚未配置时，仓库中的空值有意使服务拒绝访问。
5. 为网站仓库创建 fine-grained GitHub PAT，仅选择这一仓库，授予 **Contents Read/Write、Actions Read/Write**（Metadata Read 为必需权限）。通过 `pnpm exec wrangler secret put GITHUB_TOKEN --config admin/wrangler.jsonc` 交互写入 Worker Secret。不要放到 `vars`、前端环境变量、命令参数、提交文件或日志；不要选择照片仓库。Token 对 main 的提交还必须符合现有分支规则；若规则阻止直接提交，应配置被批准的专用自动化身份权限，不能把 API 的 403 当保存成功。
6. `AUTO_DEPLOY_ENABLED` 保持 `false`：后台保存提交使用固定消息 `[skip ci]`，不会触发 push workflow；定时 workflow 仍可能同步/构建，但此变量为 false 时不会自动部署。手动 publish 才表示明确发布意图。若想完全由后台发起同步，可另行停用定时调度；本阶段保留既有 schedule。
7. 配置现有 GitHub `production` Environment：`CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_API_TOKEN`（所需账户 Pages Edit）、`CLOUDFLARE_PAGES_PROJECT`，Pages production branch 为 main。已有照片源只读 Secret 按 Phase 6 规则使用（`JASON_PHOTOS_READ_TOKENS` / `JASON_PHOTOS_READ_TOKEN`，缺省 workflow token）；照片必须公开且原图匿名可读。Cloudflare 发布凭据只给 Actions，后台 Worker 不需要这些凭据。
8. 获准上线后构建并部署管理 Worker。先验证管理员 OTP 登录、非管理员拒绝、无 JWT 直接请求 API 拒绝、退出/过期登录重新认证、浏览器 Network 不含 GitHub/Cloudflare secret。将 GitHub 保存/冲突/触发验收安排在受控内容上，不用虚构正式摄影 Project 替代验收。新 processor inputs/锁文件使旧照片产物过期，需要先从后台 sync。
9. 实际 Pages 配置及发布权限准备好后才设 `PUBLISH_ENABLED=true`。先 sync 确认每源摘要，再明确确认 publish；检查 Actions deployment status、版本探针与线上内容。只有 `success/unchanged` + 版本/URL + 成功任务才会显示“网站发布已确认”。本阶段没有进行此生产验收。

## 操作与边界

- **保存**：来源配置或单个 Project JSON 写到网站 `main`；只能写 `config/photo-sources.json` / `src/content/projects/<slug>.json`。前端发送 expected head，服务端先检查，再创建以该 head 为唯一父提交的 Git commit，并非强制更新 main ref。中途出现并发提交也会拒绝，不重试覆盖。冲突保留编辑并提供检查/放弃后重新加载入口。已有 Project 的 slug 固定，其他 schema 字段原样保留。
- **来源影响**：仓库、分支、目录变更或停用/移除来源前检查全部 draft/published 引用；存在引用则拒绝。来源 identity / canonical reference、固定默认来源 legacy alias 都沿用 Phase 6；含双连字符的原生文件名也不会被当成 canonical 引用。先调整 Project 引用，再修改来源；新增源保存后需同步才能选图。
- **照片**：读取 main Gallery automation 的完整 `photos` 包与 `execution-summary`，核对来源配置/快照、原生和全量索引、文件摘要、生产来源、producer 处理代码及依赖。CI 仍校验全部文件和解码缩略图；Worker 复用共享 metadata 检查，每个取出的文件/缩略图再校验摘要。Worker 按字节范围读取 ZIP，不将约 70 MB 的整个包装进内存。浏览器只收到 UI 所需字段与已认证缩略图端点；不提供原图代理。
- **缓存**：Worker Cache API 可丢弃地缓存已验证缩略图摘要、ZIP 字节范围和已完成任务摘要，最多 1 小时且不超过 artifact 保留期。每个请求先认证；缓存不保存 token、cookie 或签名下载链接，不作为配置/metadata 来源或数据库。GitHub 产物仍受原仓库可见性/保留策略约束，公共仓库 artifact 不是秘密存储。
- **新鲜度**：项目文字修改不使照片过期；照片配置或 processor inputs/锁文件变化、缺失/过期 artifact、最近任务没有完整照片结果时禁止选图/保存引用/发布，提供同步入口。照片库展示的是已验证的固定快照，源 branch 后续变化由下一次 sync 处理；最终发布沿用 Phase 6 的实时网站/每源 HEAD 检查。
- **任务**：触发带唯一 request UUID 与 expected website SHA，按精确 run title 查找任务；工作流开始时拒绝竞态版本。API 返回 pending 不表示排队/成功。运行中展示 Actions steps，完成后停止轮询并读取每源 processed/reused/total、失败原因、构建与部署状态。网络超时/摘要丢失/取消不能认定部署成功；触发结果不确定时先查任务记录，避免重复触发。最近列表最多 30 个 run，界面展示最近 10 个或当前请求；更早任务在 Actions 查看。
- **资源限额**：最多 50 个来源（沿用 schema）、500 个 Project、Project slug 120 字符、单次保存 512 KB、单个 metadata/缩略图文件 8 MB、ZIP 1 GB / 30,000 entries、单请求 ZIP range 总量 32 MB / 解压总量 8 MB、全部 Project 内容 4 MB。超限明确拒绝，不能丢掉部分照片继续发布。需要更大规模时另行扩展读取分页/存储；本阶段不引入数据库、原图上传/删除、账号体系或图像代理。

## 依赖与依据

独立实现后台 UI，参考 Afilmory 实际后台导航/网格/表单/任务布局，未复制其 AGPL/ANL 应用代码、字体或品牌资产。具体源码版本与许可证判断见 [PHASE7_PLAN.md](PHASE7_PLAN.md)。JOSE 6.2.12 为 MIT（Filip Skokan），zip.js 2.14.0 为 BSD-3-Clause（Gildas Lormeau），保留依赖自身 LICENSE；新增库仅进入 Worker bundle，不进入浏览器。完整声明见 [ADMIN_THIRD_PARTY_NOTICES.txt](ADMIN_THIRD_PARTY_NOTICES.txt)。

官方依据：[Access JWT 校验](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)、[Worker 静态资源路由](https://developers.cloudflare.com/workers/static-assets/routing/)、[Git ref 非强制更新](https://docs.github.com/en/rest/git/refs#update-a-reference)、[跳过 push CI](https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-workflow-runs/skipping-workflow-runs)、[workflow dispatch](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event)。
