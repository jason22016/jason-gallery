# Share Photo Page · Step 1

`/photos/<short-public-id>/` 是静态分享落地页。开始前阅读了现有 Public Global Photo Collection、Project、Viewer、SEO、public-output 实现及 [Afilmory DESIGN.md](https://github.com/Afilmory/afilmory/blob/main/DESIGN.md)。本阶段沿用 Jason Gallery 的布局和设计系统。

## URL 身份

`shortPublicPhotoId(canonicalPhotoId)` 位于 `src/website/public-photo-id.ts`：

1. 对 UTF-8 的 `jason-gallery:public-photo:v1\0` 与完整 canonical 内部 `photoId` 拼接做 SHA-256。
2. 取摘要前 12 bytes（96 bits），编码为无 padding 的 base64url，固定 16 个字符。
3. 固定命名空间、长度和编码；例如 `source:photo` → `3VS8e-Z5g0wzOlbr`。

不使用时间、运行时随机值、Project slug/title/order 或照片文案。重建、输入排序变化和 Project 改名不改变 URL；跨来源照片使用完整 canonical ID，legacy alias 先由现有 Project resolver 解析。算法不改写内部身份，内部 ID 改变时对应的是新的 URL 身份。

集合建立反向索引时检测不同内部 ID 是否碰撞；冲突直接使构建失败，不覆盖、不随机补后缀。短 ID 只用于公开 URL，不是权限或保密机制。

## 数据与公开边界

继续使用 `loadPublicPhotoCollection()` / `resolvePublicPhotoCollection()`，资格只来自至少一个 published Project 的引用；按 canonical ID 去重。Primary Project 沿用现有顺序：`order` 升序，再按 `slug` 排序，选择首个公开 membership。其 alt/caption 与 Viewer 链接保持一致；draft membership 不参与选择。

`getPhotoPage(publicId)` 返回冻结的最小投影：标题、caption（无项目 caption 时使用已有照片 description）、thumbnail/alt/尺寸、原有 captureDate 投影、camera/lens、primary Project 与 Viewer href。缺少标题或基础信息时不显示对应项，不使用 Viewer 的文件名回退来伪造标题。未公开和未知 ID 返回 `undefined`。路由只枚举集合中的照片，没有按 Manifest 查找猜测 URL 的运行时端点。

普通 build 和 release 共用 `publicOutputPaths()`：只允许集合中确切的 `photos/<publicId>/index.html`。继续拒绝 Manifest、完整 EXIF、额外 JSON、draft/unused 资产及未知页面；release 必须包含全部合法页面。最后一个公开引用改为 draft 后，重建不再产生该页面或专属资产，旧 URL 返回现有 404。

## 页面与 SEO

- 复用 SiteLayout、SiteNavigation、LinearBlur、Thumbnail、Gallery tokens / Geist、primary button、focus 和 reduced-motion 规则。
- 仅显示照片、可选 Title/Caption、日期/Camera/Lens、primary Project，以及 `查看原图 · Open in Viewer`。按钮链接到 `/projects/<primary-slug>/?photo=<encoded-internal-id>`。
- 页面不挂载 Viewer island，不加载详情 JSON 或原始照片，不包含完整 EXIF、地图、Histogram、Filmstrip 或照片切换。照片和分享图均使用当前照片的公开 JPEG thumbnail；非 JPEG 缩略图使页面构建失败。
- 沿用 SEO helpers 与 SiteLayout，独立 canonical、title/description、Open Graph / Twitter。`shareable` 与 `noindex` 分开控制，404 和无 SITE_URL 预览保持原有行为。HTML robots 和 `/photos/*` 的 X-Robots-Tag 均为 `noindex, nofollow`；不加入 sitemap。

## Step 2 接口

```ts
const collection = loadPublicPhotoCollection();
const photo = collection.getPhoto(internalPhotoId);
photo?.publicId;  // 稳定公开 URL 身份
photo?.sharePath; // /photos/<publicId>/
collection.getPhotoByPublicId(publicId);
collection.getPhotoPage(publicId); // 含 primaryProject、viewerHref、image
```

以上入口均在构建端。Step 2 可以把已经确认公开的 `sharePath` 投影给 Viewer，再按站点 origin 组成分享 URL；浏览器不需要导入 Node crypto、Manifest 或重新判断公开资格。本阶段未修改 Viewer Share，也未增加 Gallery / Explore / Map 的 Photo Page 入口；Admin、Photo Engine、Manifest、Project schema、HDR/color pipeline 均未修改。

## 验证

新增单元测试固定 ID 向量、10,000 个不同 ID、碰撞拒绝、primary Project 稳定性、空字段、编码、非 JPEG 拒绝及最小投影。生产 fixture / 浏览器测试检查一图一页、当前 JPEG 分享图、canonical/noindex/sitemap、私有/猜测 URL 的 404、实际 Viewer 跳转、HTML 转义、桌面/手机比例与布局、键盘焦点及无 Viewer 资源加载。SEO 测试覆盖本地 Cloudflare Pages 响应头、无 origin 预览和撤销所有公开引用后的页面清除；跨来源和 release 测试覆盖同一白名单。

测试日志和截图保存在 `.cache/`，不进入提交或网站输出。此次本机 pnpm 的自动依赖重装检查与既有 node_modules 状态不一致，验证命令使用 `--config.verify-deps-before-run=false` 运行现有依赖，不改动 lockfile 或依赖版本。

2026-09-20 本地验证结果：

| 验证 | 结果 |
| --- | --- |
| `node --import tsx --test --test-concurrency=1 tests/website/*.test.ts tests/seo/*.test.ts tests/ci/*.test.ts tests/projects/*.test.ts` | 211/211 通过，无跳过 |
| `pnpm --config.verify-deps-before-run=false check` | 通过 |
| `pnpm --config.verify-deps-before-run=false check:upstream` | 通过，16 个 Viewer 核心源文件保持固定基线 |
| `pnpm --config.verify-deps-before-run=false build` | 通过，160 个 HTML 页面，其中 154 个 Photo Page |
| 真实 production 输出精确白名单 / ID / sitemap 核对 | 154 张公开照片、154 个唯一短 ID、154 个照片页；全部输出路径合法，sitemap 无 Photo Page |
| `git diff --check` / staged diff 检查 | 通过 |
