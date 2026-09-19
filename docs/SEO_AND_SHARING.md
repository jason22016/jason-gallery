# SEO 与分享

当前正式地址是 `https://jason-gallery.pages.dev/`。站点默认值位于 `src/website/site-url.ts`；Astro 构建、发布记录和部署判断使用同一地址解析函数。

## 地址与换域名

- 本地默认构建：`pnpm build`，生成当前 Pages 正式地址的元数据。
- 换域名：先在 Cloudflare Pages 绑定并验证新域名，再设置 GitHub 仓库或 production environment 的 **变量 `SITE_URL`** 为新的 HTTPS origin，重新执行 publish。工作流未设置变量时使用当前 Pages 地址。
- 本地核对新域名：`SITE_URL=https://你的真实域名 pnpm build`。这是进程环境变量，不会自动读取 `.env` 文件。
- origin 可以带一个末尾 `/`，构建统一规范化；不支持子路径部署、凭据、非默认端口、query、hash、HTTP、localhost、IP 或示例域名。网站的导航和资源本来就使用根路径，不能只给 canonical 加上子路径。
- 显式 `SITE_URL='' pnpm build` 可生成无正式地址的本地预览：所有 HTML/响应头 noindex，无 canonical/OG URL/图片绝对地址，sitemap 没有条目，robots 禁止抓取。正式发布会拒绝这种产物。
- 不读取 `CF_PAGES_URL`、请求 Host 或浏览器地址作为正式地址，避免把临时部署网址写入索引。

`release.json` 和公开的 `build-version.json` 记录规范化后的 `siteURL`。部署的 unchanged 判断同时比较代码、照片快照与站点地址，所以只更改域名也会重新发布。部署结果返回配置的公开地址；Cloudflare 部署地址仍单独保留并用于版本验证。旧版 release 没有该字段时仍兼容既有校验与回滚。

换域名后，可在 Cloudflare 配置旧主机到新主机的永久跳转；应用不会擅自修改 DNS 或重定向规则。发布后应核对线上首页、项目 canonical、robots/sitemap 和一个不存在的路径；本地测试不代表线上部署已经更新。

## 页面与分享

首页、Explore、Global Map 及所有 published Project 的 HTML 在构建时输出：

- 独立标题和描述；Project 优先 summary，其次 description，最后使用包含标题的默认描述。描述压缩空白、按 Unicode 字符截断至 160 字以内，交给 Astro 正常转义。
- 自身的绝对 canonical 与 `og:url`，页面地址统一末尾 `/`。`photo`、筛选、排序、地图参数与 hash 都属于当前 Gallery 页面，不产生独立索引页。
- Open Graph 的网站名、类型、语言、标题、描述、绝对图片 URL/替代文字，以及 Twitter 大图卡片。
- Project 分享图使用该项目已发布的 JPEG 封面缩略图；首页使用排序第一的公开项目封面。Explore、Global Map 和空站点使用构建生成的 `1200×630` 品牌 JPEG，地址为 `/social/default.jpg`。不依赖原始 HDR/HEIC 或后台图片接口。

Viewer 浏览状态仍使用 Project / Explore / Map 页面的 `?photo=<internal-id>` 和现有筛选参数。点击分享时，Web Share、复制链接及失败时显示的地址统一使用当前照片的 `/photos/<short-public-id>/`，不会修改浏览 URL 或 history，也不携带筛选与 hash。

Share Photo Page 第一阶段新增 `/photos/<short-public-id>/` 静态分享落地页，只从 Public Global Photo Collection 生成。每页使用当前照片自己的公开 JPEG thumbnail，并有独立 canonical、title/description、OG/Twitter 卡片；HTML 与 `/photos/*` 响应头均为 noindex，sitemap 不收录。`SiteLayout` 的 `shareable` 可以为 noindex 落地页保留分享元数据，404 和无正式地址预览继续省略 canonical/绝对分享地址。第二阶段接入 Viewer Share；Gallery / Explore / Map 中仍没有 Photo Page 导航入口。落地页通过 primary published Project 的原有深链打开 Viewer，浏览器 Back 返回落地页。规则与接口见 [Share Photo Page](SHARE_PHOTO_PAGE.md)。

## 索引边界与 404

`/sitemap.xml` 只列首页、`/explore/`、`/map/` 与 `loadProjects().listProjects()` 返回的 published 项目，不包含 Photo Page、draft、后台、404、照片 JSON、构建信息或 Viewer 参数。不伪造 lastmod。

`/robots.txt` 指向相同正式地址下的 sitemap，允许公开网站，限制 `/admin` 与 `/api/`。不列出草稿 slug。构建生成的 Cloudflare Pages `_headers` 给照片元数据 JSON、health/build-version、后台路径和 404 加 `X-Robots-Tag: noindex, nofollow`。

草稿继续不生成公开页面、项目数据和专属图片资产；已发布项目共享的图片可正常公开。不存在或未公开的地址由顶层 `404.html` 返回 404 状态，页面带 noindex、返回项目链接，并省略 canonical/OG URL，避免把错误页指向首页。

独立后台继续对全部页面、静态资源和 API 验证 Cloudflare Access JWT 与管理员邮箱，`run_worker_first: true` 不变。所有 Worker 成功/失败响应增加 `X-Robots-Tag: noindex, nofollow`，HTML 保留原有 robots meta；没有为爬虫开放 robots 或 sitemap 认证例外。robots/noindex 只管理索引，**不能替代身份认证**。

## 验证

`pnpm test:seo` 使用独立合成图库检查实际 HTML/XML、图片解码、域名覆盖、无地址预览、空项目、草稿和未知页面，并启动本地 Cloudflare Pages 验证真实 404 与 `_headers`。测试已接入 `pnpm test:checks`。

另由现有 website、automation 与 admin 测试覆盖照片分享、发布产物白名单、只变更域名的部署，以及未认证访问仍被拒绝。所有测试均不部署真实站点。

Global Gallery 的普通构建和 Release 共用 `src/website/public-output.ts` 的精确路径白名单；`public/` 中意外放入的 Manifest、metadata 或额外页面在复制前被拒绝，未公开和过期缩略图从输出清理。Global 页面使用现有公开 Project metadata URL，没有额外 `/photos/` JSON 路由。当前完整发布验收见 [Global Gallery Release Gate](gallery/GLOBAL_PHASE4.md)。

2026-09-16 本地验证：`pnpm check`、`pnpm build`、`pnpm check:upstream` 通过；SEO 4/4、Website 84/84、Projects 48/48、Automation 23/23、后台 backend/runtime 10/10，共 169 项通过。真实构建的 sitemap 包含首页和两个公开项目，三个页面的 canonical 与 JPEG 分享图地址均使用当前 Pages origin。没有执行线上部署。

依据：[Astro site 配置](https://docs.astro.build/en/reference/configuration-reference/#site)、[Open Graph](https://ogp.me/)、[Google noindex](https://developers.google.com/search/docs/crawling-indexing/block-indexing)、[Cloudflare Pages 404](https://developers.cloudflare.com/pages/configuration/serving-pages/)、[Pages 响应头](https://developers.cloudflare.com/pages/configuration/headers/)。
