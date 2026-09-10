# Phase 7 — 轻量后台决策与实施顺序

2026-09-10，初始基线 main `bc54046`（全面接入时已同步最新 `9a41478`），开发分支 `codex/phase7-admin`。Phase 8 承接 Polish、SEO 和性能优化。

## 唯一选定方案

独立 **Cloudflare Worker + 静态后台资源 + Cloudflare Access 邮箱一次性验证码**。后台使用独立子域名；公开 Astro 网站继续使用现有 Pages Direct Upload。无需常驻服务器、数据库、自建密码或第二种登录方式。

Access 的 Allow policy 只包含明确管理员邮箱。Worker 对全部管理 API 校验 Access JWT 的签名、issuer、audience、时效及管理员邮箱，不信任单独的邮箱 header；未配置时拒绝访问。静态资源亦经过 Worker 认证（`run_worker_first`），关闭可绕过 Access 的 workers.dev/preview 地址。写请求另校验同源 Origin 与 JSON content type。JWT/JWKS 实现采用成熟 JOSE 库，不自写密码协议。

服务端 GitHub fine-grained token 仅选择网站仓库、Contents Read/Write 和 Actions Read/Write。服务端路径白名单只允许 `config/photo-sources.json` 与 `src/content/projects/<slug>.json`；禁止任意路径、仓库和 workflow 写入。照片仓库继续只读。Cloudflare 部署凭据只在现有 Actions production Environment，不需要交给后台。GitHub token 仅存 Worker Secret；浏览器不接收 token 或签名下载地址。

保存使用 GitHub 原子提交与 expected head 防冲突，复用现有来源 schema/身份与 Project schema/resolver。保存、同步、发布三个独立操作；后台模式下自动部署开关保持 false，保存不隐式发布。需要检查 main push 的自动构建与后台操作关系，显式展示任务来源。读取已验证 photos artifact 与 execution-summary，逐文件验证，完整索引与预览只经认证端点提供；不代理原图，不创建第二套 metadata。过期/不匹配禁止选图与发布，提供重新同步。触发返回 pending/queued，只有真实任务和部署摘要确认后展示成功。

官方依据：[Access OTP](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/)、[验证 JWT](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)、[Worker 静态资源路由](https://developers.cloudflare.com/workers/static-assets/routing/)。

## 视觉确认门

先完成独立 fixture UI（照片浏览、Project 编辑、照片源、任务状态），让用户确认视觉方向，再全面接入管理 API。预览不模拟管理员登录，不发送 GitHub 写请求，不触发任务、不部署。示例 Project 与虚构来源仅在测试目录/内存，正式 Project 目录保持空白。

已查看 Afilmory 锁定 commit `a3db486b0a8f2572de3032eabdfce24e726e83f3` 的真实 `be/apps/dashboard` 源码：

- `src/pages/(main)/layout.tsx`、`src/components/common/Header.tsx`：顶部导航、横向小屏滚动、居中内容区。
- `src/modules/photos/components/PhotoPageScaffold.tsx`、`library/PhotoLibraryGrid.tsx`：标题与操作、二级导航、照片瀑布流、选中边框与操作栏。
- `src/modules/storage-providers/components/{StorageProvidersManager,ProviderEditModal}.tsx`：来源卡片、分区表单、未保存状态。
- `src/modules/photos/components/sync/{PhotoSyncProgressPanel,PhotoSyncResultPanel}.tsx`：阶段状态、每源结果、失败原因。
- `src/styles/{index,tailwind}.css`、根 `LICENSE`：语义颜色与明暗主题；应用代码采用 ANL 的 AGPL + UI attribution 条款，不能当 MIT 搬用。

只参考布局与交互思路，本站独立实现 React/CSS；不复制应用代码、品牌、字体、示例照片或引入其 SaaS/数据库/存储业务。使用本站已有 React 和 lucide-react 依赖。上游源码：[精确版本](https://github.com/Afilmory/afilmory/tree/a3db486b0a8f2572de3032eabdfce24e726e83f3/be/apps/dashboard)。

## 前置 automation 问题

main 合并后 [Gallery automation 34449154936](https://github.com/jason22016/jason-gallery/actions/runs/34449154936) 的回归检查通过，resolve 失败。旧错误只有 “Photo repository must be anonymously readable”，丢失 HTTP 状态，无法据此确定历史请求是否限流。2026-09-10 实际查询照片仓库 `private=false / visibility=public`。

修复：元信息请求复用既有只读 token，显式校验 `private === false`；HTTP 失败保留状态和剩余额度，不能等同于私有仓库。匿名原图 URL 不变。隔离回归覆盖带/不带凭据、private/缺少字段、403/404/429/503 与凭据不泄漏。后续 main 已通过独立修复 PR 合入更完整的 API 公开性 + 每张原图匿名检查（`9a41478`），后台分支采用该上游实现。真实 sync run `34452182457` 已成功：154 张，0 处理 / 154 复用，deployment=not_requested。

## 全面接入与验收

用户已明确确认 UI，正式接口、鉴权与拒绝测试、配置影响分析、冲突提交、跨源引用及任务/过期状态已实现。详细配置与资源上限见 [ADMIN_SETUP.md](ADMIN_SETUP.md)。上线需用户配置 Cloudflare 域名/Worker/Access application AUD/issuer/管理员邮箱、Worker GitHub Secret、Pages production Environment 与部署 Secrets。真实 Access 登录、真实服务端 GitHub 保存/dispatch、Cloudflare 发布与线上浏览均未验收；初始阶段禁止生产部署与 main 合并；随后用户授权 Phase 7 合并，main 已到 `daee9bd`，生产部署仍未执行。

## 免费优先修正

移除 Paid CPU 假设；仍沿用 Worker + Access OTP。先运行完整认证的本地 workerd 请求剖析并优化重复 ZIP/Git 读取，真实 Free CPU/登录/发布仍未验收。当前冷请求与大列表无法证明满足免费限制，不把默认配置误称免费可部署。结果与继续免费上线所需工作见 [ADMIN_CPU_PROFILE.md](ADMIN_CPU_PROFILE.md)。
