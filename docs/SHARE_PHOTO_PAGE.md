# Share Photo Page

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

## 公开 URL 接口

```ts
const collection = loadPublicPhotoCollection();
const photo = collection.getPhoto(internalPhotoId);
photo?.publicId;  // 稳定公开 URL 身份
photo?.sharePath; // /photos/<publicId>/
collection.getPhotoByPublicId(publicId);
collection.getPhotoPage(publicId); // 含 primaryProject、viewerHref、image
```

以上入口均在构建端。浏览器只消费已经确认公开的 `sharePath`，不导入 Node crypto、Manifest 或重新判断公开资格。Step 1 建立这些接口和静态页面时，未修改 Viewer Share。

## Step 2 · Viewer 分享与返回

Project 的 `Gallery.astro` 保留原有 `galleryPhotos(project)` 投影，并用 `loadPublicPhotoCollection().getPhoto(photo.id)?.sharePath` 补充分享路径。项目内 alt/caption、编排和 metadata URL 不变；Explore / Map 已经消费同一公开集合，直接使用其 `sharePath`。`ViewerPhoto.sharePath` 可选，未解析或非公开照片没有此字段。

Viewer 点击分享时，通过 `new URL(photo.sharePath, location.origin)` 得到绝对 Photo Page URL。桌面复制、移动端 Web Share、API 不可用和失败时显示的链接完全一致，均无 `photo`、filter、sort、mapPhoto、tracking 或 hash。标题继续使用原来的照片标题与当前集合标题，用户取消仍静默处理。缺少公开路径时只提示不可分享，既不在浏览器计算 ID，也不回退到当前浏览 URL。

`PhotoGallery` / Project / Explore / Map 的 URL state、筛选、history owner、push/replace、Close、Back/Forward 和 metadata 逻辑均未修改。站内点击卡片仍直接打开 Viewer，没有新增 Photo Page 入口。`?photo=<internal-id>` 继续是当前 Viewer 状态，分享动作只读取公开路径和当前 origin，不写地址栏或历史记录。

Photo Page 的主按钮继续正常导航到 `primaryProject` 的 `/projects/<slug>/?photo=<encoded-internal-id>`，复用现有 Project Viewer。浏览器添加一个 Project 页面记录；Viewer 初次读取有效照片深链不会再 push，前后切图只替换该记录。因此直接 Back 返回原 Photo Page，Forward 恢复最后选中的照片。Close 保持既有深链行为，留在 Project Gallery；之后 Back 仍能返回 Photo Page。

页面信息与视觉设计、Admin、Photo Engine、Manifest、Project schema、HDR/color pipeline 均未修改。新增测试覆盖两个 Project / Explore / Map 下相同照片的剪贴板和 Web Share URL、取消/失败/fallback、无公开路径拒绝分享、Photo Page 的桌面/手机 Back/Forward、primary Project、切图、zoom、EXIF/MiniMap、HDR source，以及关闭 Viewer 后原有 Live Photo 预览。

## 验证

新增单元测试固定 ID 向量、10,000 个不同 ID、碰撞拒绝、primary Project 稳定性、空字段、编码、非 JPEG 拒绝及最小投影。生产 fixture / 浏览器测试检查一图一页、当前 JPEG 分享图、canonical/noindex/sitemap、私有/猜测 URL 的 404、实际 Viewer 跳转、HTML 转义、桌面/手机比例与布局、键盘焦点及无 Viewer 资源加载。SEO 测试覆盖本地 Cloudflare Pages 响应头、无 origin 预览和撤销所有公开引用后的页面清除；跨来源和 release 测试覆盖同一白名单。

测试日志和截图保存在 `.cache/`，不进入提交或网站输出。此次本机 pnpm 的自动依赖重装检查与既有 node_modules 状态不一致，验证命令使用 `--config.verify-deps-before-run=false` 运行现有依赖，不改动 lockfile 或依赖版本。

Step 1（2026-09-20）本地验证结果：

| 验证 | 结果 |
| --- | --- |
| `node --import tsx --test --test-concurrency=1 tests/website/*.test.ts tests/seo/*.test.ts tests/ci/*.test.ts tests/projects/*.test.ts` | 211/211 通过，无跳过 |
| `pnpm --config.verify-deps-before-run=false check` | 通过 |
| `pnpm --config.verify-deps-before-run=false check:upstream` | 通过，16 个 Viewer 核心源文件保持固定基线 |
| `pnpm --config.verify-deps-before-run=false build` | 通过，160 个 HTML 页面，其中 154 个 Photo Page |
| 真实 production 输出精确白名单 / ID / sitemap 核对 | 154 张公开照片、154 个唯一短 ID、154 个照片页；全部输出路径合法，sitemap 无 Photo Page |
| `git diff --check` / staged diff 检查 | 通过 |

Step 2（2026-09-20）本地验证结果：

| 验证 | 结果 |
| --- | --- |
| `pnpm --config.verify-deps-before-run=false test:viewer` | 66/66 通过，无跳过，包含真实 WebGPU / WebGL 与 native fallback、HDR / ICC、手势与来源记录校验 |
| `node --import tsx --test --test-concurrency=1 tests/website/*.test.ts tests/seo/*.test.ts` | 144/144 通过，无跳过，包含四种分享上下文、Photo Page 联动、原有 filter / URL / history 和公开输出边界 |
| `pnpm --config.verify-deps-before-run=false check` / `check:upstream` | 通过，Viewer 核心基线未修改 |
| `pnpm --config.verify-deps-before-run=false build` | 通过，160 个 HTML 页面，其中 154 个 Photo Page |
| 真实 production 输出精确白名单 / ID / noindex / sitemap 核对 | 通过，154 张公开照片与 154 个唯一照片页一一对应；浏览器 bundle 无 Manifest / Node crypto |
| `git diff --check` / staged diff 检查 | 通过 |
