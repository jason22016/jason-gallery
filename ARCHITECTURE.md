# Architecture Lock — Phase 1–6

状态：Phase 1（含真实图库 Final Gate）和 Phase 2 正式通过；2026-09-09。Phase 3 实现 Website MVP，继续保持 Photo Engine、Project System 和原生 Manifest 边界不变。本文是当前唯一架构基准，改变以下决策须先更新本文。2026-09-10 用户批准 UI Redesign：新增 Map、EXIF 信息面板、搜索筛选和看图动画；不加入账号、评论、点赞、后台或部署。当前 UI 约定见下方 UI Redesign 小节，Phase 3 描述保留为历史基线。验证记录见 `PHASE1_REPORT.md`、`PHASE2_REPORT.md`、`PHASE3_REPORT.md`。

## 1. 技术栈与运行方式

采用 **Astro 静态生成 + React 19 + TypeScript strict + pnpm**。Astro 负责路由、内容、HTML 与 SEO；React island 承载未来的照片交互和 Viewer。官方 [`@astrojs/react`](https://docs.astro.build/en/guides/integrations-guide/react/) 支持 React 渲染与客户端 hydration。

照片处理在 Node.js 构建进程完成，部署物只有 HTML、JS、CSS、JSON 和图片资源。已验证并固定 Node **24.19.0**（`.node-version`）、pnpm **11.19.0**、Astro **7.3.2**、`@astrojs/react` **6.0.5**、React/ReactDOM **19.2.7**、TypeScript **6.0.3**；依赖使用精确版本和 lockfile。TypeScript strict 覆盖本站 `src/`、构建脚本、配置及独立 Viewer 测试。无需 SSR adapter、API、CMS、认证或 Afilmory SaaS。

Viewer 经浏览器专用入口延迟加载（Astro `client:only="react"`），静态照片内容仍由 Astro 输出。同一交互区域共享一个 React 根的 Viewer 状态，避免跨 island 隐式共享 Context。浏览器不得导入 Builder、Sharp、ExifTool 或构建凭据。

## 2. 源码核查与版本基线

审阅的 [Afilmory commit](https://github.com/Afilmory/afilmory/tree/a3db486b0a8f2572de3032eabdfce24e726e83f3)：`a3db486b0a8f2572de3032eabdfce24e726e83f3`。以下路径均相对此 commit。

| 已读代码 | 对架构的影响 |
| --- | --- |
| `packages/builder/src/index.ts`、`builder/builder.ts`、`photo/{processor,image-pipeline,data-processors}.ts` | 复用扫描、增量处理、EXIF、尺寸、ThumbHash、色调分析和照片生成流水线；不重写图片引擎。 |
| `storage/providers/github-provider.ts`、`storage/manager.ts`、`plugins/storage/github.ts` | GitHub provider 按配置 path 返回相对 key；须显式排除派生图片目录。 |
| `plugins/thumbnail-storage/{index,shared}.ts`、`image/thumbnail.ts` | 默认远端目录是 `.afilmory/thumbnails`；插件会上传。已有缩略图复用逻辑检查本地 `public/thumbnails/<id>.jpg`。 |
| `packages/typing/src/{manifest,photo}.ts`、Builder `manifest/{version,manager,migrate}.ts` | 当前 schema 为 `v10`，顶层为 `{ version, data, cameras, lenses }`。保持原样。 |
| `photo/gainmap-detector.ts`、`photo/image-pipeline.ts` | `isHDR` 来自 EXIF 的 Gain Map/ISO 标记及 ContainerDirectory 检测。 |
| `packages/webgl-viewer/src/{ImageViewer,WebGPUImageViewerEngine,WebGLImageViewerEngine,jpeg-gainmap}.*` | 可独立复用 GPU Viewer；当前源码支持 WebGPU、gain map 和 WebGL 回退。 |
| `apps/web/src/modules/viewer/{PhotoViewer,ProgressiveImage}.tsx`、`modules/gallery/{MasonryView,Masonic,MasonryPhotoItem}.tsx` | 完整 Viewer/Gallery 与应用状态、路由、翻译、Inspector、社交功能耦合，不是独立组件包。 |
| `packages/ui/src/thumbhash/index.tsx`、各包 `package.json`、根 `LICENSE` | 小型 UI 可选择性抽取；不能把整个仓库当作 MIT。 |

**源码版本不等于 npm 同号版本。** 已检查 registry 元数据与发布 tarball：npm `@afilmory/builder@0.2.2` 仍生成 `v8`；npm `@afilmory/webgl-viewer@0.2.0` 的声明没有当前源码的 `onHDRChange`/WebGPU 接口。不得用 npm 同号包替代上述 commit 并假设功能一致。

因此锁定：Phase 1 从该 commit 提取所需 library packages，保留上游包名，通过 pnpm workspace package 依赖使用。只保留依赖闭包，不移植整个应用。将来改用 registry 发布包前，先核对 API、schema、worker 产物与许可证，再更新本文和 lockfile。

## 3. 三层边界

| 层 | 拥有的职责与接口 | 禁止的依赖 |
| --- | --- | --- |
| **Afilmory Photo Engine** | 上游 packages + 本站构建适配器；只读 GitHub 输入，生成原生 Manifest 和派生资产；提供 `PhotoManifestItem` 类型及只读 `getPhoto(id)` / `listPhotos()` 查询。 | 不知道 Project、页面、站点导航。 |
| **Project Layer** | 本地编辑内容、项目 schema、顺序、封面、发布状态；构建时按 ID 解析照片，生成临时 Project view model。 | 不处理图片、不读取 GitHub、不复制 EXIF/HDR 数据，不反向修改 Manifest。 |
| **Website UI** | Astro 页面与视觉系统；React Viewer wrapper；消费照片只读查询和已解析 Project。 | 不调用 Storage/Builder，不直接遍历仓库，不维护第二份照片事实库。 |

依赖方向：`Website UI → Project Layer → Photo Engine 的只读数据接口`；UI 也可直接读取照片查询。GPU Viewer 是 Photo Engine 的独立浏览器入口，由 UI wrapper 调用，与 Node 构建入口隔离。

## 4. Project 数据契约

每个项目一个 `src/content/projects/<slug>.json`，使用 Zod 在构建期校验；长文暂不引入 MDX。契约如下：

```ts
type PhotoId = PhotoManifestItem['id'];

interface Project {
  schemaVersion: 1;
  id: string;                    // 项目永久标识，独立于 slug
  slug: string;                  // 唯一路由片段
  title: string;
  summary?: string;
  location?: string;             // 可选地点描述
  description?: string;          // 纯文本
  coverPhotoId: PhotoId;
  photos: Array<{
    photoId: PhotoId;
    caption?: string;            // 仅在本项目生效
    alt?: string;
  }>;                           // 数组顺序就是展示顺序
  tags?: string[];               // 项目编辑标签，独立于照片 tags
  period?: { start: string; end?: string }; // ISO YYYY-MM-DD
  order: number;                // 项目列表顺序，升序，slug 打破平局
  status: 'draft' | 'published';
}
```

同一照片可以属于多个 Project；项目内不允许重复 photo ID。`id`、`slug` 必须唯一，项目照片不能为空，封面必须属于项目，日期区间须有效。所有引用必须在 Manifest 中存在；悬空引用或照片 ID 冲突使构建失败，不能静默丢图。草稿不进入公开路由和公开 Project 数据。

Project 不存文件路径、URL、尺寸、EXIF、HDR 或缩略图副本；不向 `PhotoManifestItem` 添加 `projectId`。解析结果只在构建/渲染中派生，不成为新的手工数据源。Manifest schema 升级仅走上游 migration，不引入本站扩展。

### Phase 2 校验与查询约定

- Zod 固定为已有依赖树中的 `4.5.4`，加入本站直接依赖。所有对象（含照片引用和 period）拒绝未知字段，不做类型强制转换。必填标识与 title 不可为空白；slug 使用小写 ASCII 字母/数字及单连字符分段，并要求 JSON 文件名与 slug 完全一致。`order` 为有限数字，允许负数和小数。日期为 `0001`–`9999` 年真实公历 `YYYY-MM-DD`，允许同日起止和仅 start。
- `src/projects/schema.ts` 定义原始契约；`resolver.ts` 对全部项目（包括 draft）检查集合唯一性与 Photo Index 引用，再派生 `cover` 和每个照片条目的 `photo`。保留引用 ID、项目内照片顺序和局部 caption/alt，照片信息只来自只读 `getPhoto`。
- `loadProjects()` 为公开入口，只返回 published 的 `listProjects()`、`getProject(id)`、`getProjectBySlug(slug)`。构建/编辑工具显式使用 `loadProjectCatalog()` 获取分离的 `published`、`drafts` 索引；公开索引没有切换到草稿的参数。两种索引均按 `order` 升序、slug ASCII 字典序排序，类型递归 readonly，运行时深度冻结，不暴露内部 Map。
- `astro:build:start` 无条件读取并验证整个 Project 目录与 Phase 1 Photo Index，直接 `astro build` 也无法绕过；失败带来源文件和字段路径。空目录合法且不创建正式内容；目录缺失、JSON 解析失败或不符合每项目一个顶层 JSON 的布局会报错。`.gitkeep` 仅用于保留空目录。
- 不持久化解析结果、不增加公开 JSON 或路由。`pnpm test:projects` 使用独立 fixture 验证契约、解析、只读接口与真实 Astro 构建拒绝路径，并加入完整 `pnpm test`。

## 5. 现有照片仓库兼容

实际输入是 [jason22016/jason-photos](https://github.com/jason22016/jason-photos/tree/6a7ae47d75dd71bc6874e8d3f222f25b2c05e27f)，不是另一个名为 `afilmory-photos` 的仓库。核查快照为 `6a7ae47d75dd71bc6874e8d3f222f25b2c05e27f`：154 张 `.jpg` 原图、59 张同名 `.jpg` 缩略图，95 张缺缩略图，无原图 basename 冲突；未发现 Photo Manifest。上述为文件树核查，未据此声称照片内容或 HDR 效果已验证。

```text
images/DSC_0129.jpg
images/.afilmory/thumbnails/DSC_0129.jpg
```

GitHub Storage 配置锁定为 `provider: 'github'`、`owner: 'jason22016'`、`repo: 'jason-photos'`、`path: 'images'`、`useRawUrl: true`。每次构建先把 `main` 解析为 commit SHA，再将该 SHA 用作 provider 的 `branch`/ref，保证扫描、原图 URL、缩略图来自同一快照。例如 key 为 `DSC_0129.jpg`，原图 URL 为 `https://raw.githubusercontent.com/jason22016/jason-photos/<sha>/images/DSC_0129.jpg`。

兼容步骤锁定为：

缩略图属于可重建派生资产；缺失或损坏时自动生成，Phase 1 暂不写回 `jason-photos`。

1. 本站薄适配插件在 `onInit` 调用 `builder.getStorageManager().addExcludePrefix('.afilmory')`。使用原生 GitHub provider 在固定 SHA 下扫描一次，缓存 listing；照片列表排除包含 `.afilmory` 路径段的文件，`.gitkeep` 等非照片由上游格式集合过滤。派生目录可单独读取用于 reconciliation，不进入 Manifest。
2. 本地缩略图只有在原图 blob SHA、远端缩略图 blob SHA、Builder commit/配置摘要均匹配，且本地字节摘要及完整解码通过时才复用。远端候选优先 `<photoId>.jpg`；兼容旧 `<basename>.jpg`，但 basename 不唯一时不得猜测映射。预填充文件名按上游公开源码规则预测，保存前逐项与 Builder **实际生成**的 ID 核对；不替换原生 ID 算法。
3. 旧远端缩略图不带源摘要；冷缓存时仅允许原图与缩略图的最后一次路径修改来自同一 commit 的配对复用。无法满足该保守条件时重新生成。这避免原图更新而远端缩略图未更新时，即使清空本站缓存也错误复用。此约定不验证图片语义配对；以后可增加独立来源摘要记录，不能往原生 Manifest 加字段。
4. 在每次独立 run workdir 中，先完整解码合格候选并预填 `public/thumbnails/<id>.jpg`。上游损坏缩略图的某条路径会吞掉解码错误并返回空 ThumbHash，故必须在适配器前置检查，不能只依赖“文件存在”。缺失/坏候选不预填，由原生 Builder 生成 SDR JPEG 和 ThumbHash。
5. Phase 1 固定使用 `isForceManifest: true`、`isForceMode: false`、`isForceThumbnails: false`。每次用原图重建 metadata、HDR 和原生 v10 Manifest；校验过的缩略图仍可复用。这样避开上游部分增量检查使用 basename、更新时可能保留旧 EXIF 的问题，同时自然刷新未变化照片的 commit 原图 URL。原图按 Git blob SHA 缓存且逐次校验字节；metadata 增量优化留待后续。
6. Final Gate 每次完整解码原图（Sharp failOn warning），保存固定快照 listing；任何单张失败都中止。保存前检查照片数量、逐张处理结果、key/ID 对应、实际 ID 唯一、尺寸、EXIF/影调结果、ThumbHash 及所有缩略图的可解码性。失败不替换上次成功的输出 Manifest。Manifest 保留 `{ version, data, cameras, lenses }` 与原生 `/thumbnails/<id>.jpg`；`pnpm photos --export` 仅将通过完整检查的未过滤结果复制到本站 `src/data/` 与 `public/thumbnails/`，不涉及网络发布。

**不启用**上游 `thumbnailStoragePlugin` 或 `githubRepoSyncPlugin`：两者有远端写入用途。本方案仅借用前者的目录约定，通过本地预填充使用后者之外的正常构建流程。可选的 `JASON_PHOTOS_READ_TOKEN` 仅在构建环境中使用，只应授予照片仓库只读权限，显式 `--git-credential` 可复用用户已有 GitHub 认证，仅在进程内使用，不保存凭据；本程序仍仅发送读取请求。入口拒绝非 GET/HEAD 网络请求，StorageManager 的上传、移动与删除接口均显式报错；读取请求限时 60 秒，网络异常/408/429/5xx 最多尝试三次并记录状态及限额响应；403 不循环重试；静态产物和请求审计日志不含 token；原图必须匿名可访问，不采用需代理才能浏览的私有源。

固定 `digestSuffixLength: 8`，ID 为 Builder 原生 basename 加 key 摘要后缀，以降低未来同名照片冲突风险。ID 由 Builder 生成，Project 只消费生成结果；不自行生成 UUID。允许不同 key 的同名原图；生成后的 ID 仍必须唯一，实际 ID 冲突使构建失败。改名会改变 ID，必须同步迁移 Project 引用；不得静默切换摘要后缀规则。目录不是 Project，不按目录自动创建项目。

## 6. 必需的构建适配与依赖

当前 `packages/builder/src/path.ts` 将 workdir 固定为相对包路径的 `../../../apps/web`，Manifest 固定写入 `src/data/photos-manifest.json`；发布包也保留该假设。仅更改 `cwd` 无法解决。

允许在提取的 Builder package 中维护一个有记录的最小补丁：通过本站命名环境变量 `JASON_GALLERY_PHOTO_WORKDIR` 指定绝对工作目录，并使 worker/子进程继承；未设置时保留上游默认值。本站统一使用 `.cache/photo-engine/`：`run-*/` 为独立 Builder workdir，`cache/` 保存 blob、缩略图摘要与状态，`output/` 为上次成功产物。CLI 在动态导入 Builder **之前**设置 workdir；构建完按原样复制 Manifest 与静态资产。Phase 1 补丁限于路径、打包、类型声明和依赖可移植性，不更改算法、ID、schema 或 HDR 判断；Phase 5 的 Viewer 生命周期补丁例外见下文。实际源码补丁仅为 workdir 和一处 EXIF 动态索引的类型断言；package manifest 展开 catalog、补齐根目录原先提供的运行依赖，并修正 renderer 的子路径入口。完整差异与逐文件摘要见 `patches/afilmory-portability.patch`、`licenses/afilmory-files.json`。

| 依赖/代码 | 使用决策 |
| --- | --- |
| `@afilmory/builder` | 构建期 package 依赖；按锁定 commit 提取并应用上述最小补丁。GitHub provider、metadata、thumbnail、HDR 检测留在包内。 |
| `@afilmory/typing`、`@afilmory/utils`、`@afilmory/og-renderer` | Builder 所需的同 commit 依赖闭包；上游为私有 workspace 包，不能假定可从 npm 安装。对外通过本站 facade 导出照片类型，前端仅 `import type`。OG 包是当前 Builder 的依赖，不代表本阶段开发 OG 页面。 |
| `@afilmory/webgl-viewer` | 浏览器运行期 package 依赖，锁定源码 commit；使用 `ImageViewer` 公开接口。 |
| `@afilmory/viewer-motion` | UI Redesign 已按相同 commit 引入，复用开合动画和移动手势；来源见 `licenses/viewer-motion-files.json`。 |
| `@afilmory/ui` | 私有 workspace 包；优先仅抽取 Thumbhash、基础按钮/对话框等实际需要的小组件及依赖，记录来源和许可证，不引入整个包 barrel。 |
| `apps/web` 的 PhotoViewer、ProgressiveImage、Gallery、HDRBadge、Inspector | 已审阅作为功能参考；默认不复制。本站自行实现外壳、布局、状态、可访问性和信息展示。确需复制时按第 8 节处理。 |
| Astro、`@astrojs/react`、React/ReactDOM 19、TypeScript、Zod | 本站直接依赖；Zod 4.5.4 用于 Phase 2 Project schema；基础样式用 CSS，按抽取组件需求再引入 Tailwind/Radix。 |
| Sharp、ExifTool、ThumbHash 等 | 保留 Builder 的传递依赖；原生工具仅在 Node 构建机运行。提取包时展开 `catalog:` 并补齐实际运行依赖，不能原样复制失效的 workspace 配置。 |

HDR 必须区分“照片含 HDR 信息”（Manifest `isHDR`）与“当前设备实际以 HDR 显示”（Viewer `onHDRChange`）。原图不经 Astro image optimizer 或会抹掉 gain map 的转码；缩略图可为 SDR。保留上游 WebGPU → WebGL 回退，GPU 全部失败时 wrapper 提供普通图片。Phase 1 已在 Chromium 152 的独立测试及生产 bundle 中验证 worker 加载、WebGPU `onHDRChange(true)`、WebGPU 故障 → WebGL，以及 GPU 全失效 → 普通 `<img>` 的测试外壳回退；GitHub 原图匿名 CORS/Canvas 读取通过。此处是 API/运行路径验证，不代表屏幕亮度或色彩的仪器测量；其他浏览器及实际相机 HDR 样本仍需扩展测试。

## 7. 目录与数据流

以下为当前目录约定（Project 正式内容目录保持空白）：

```text
ARCHITECTURE.md
astro.config.mjs / package.json / pnpm-workspace.yaml / pnpm-lock.yaml
builder.config.ts
scripts/photos/                 # 只读同步、缓存、执行 Builder、独立 smoke test
tests/viewer/                   # 独立浏览器验证 fixture，不进入网站路由
tests/projects/                 # Project fixture、契约/解析/构建集成测试
tests/website/                  # 隔离站点 fixture、生产构建与浏览器交互测试
packages/afilmory/              # 锁定 commit 的所需 library packages
patches/                       # 路径/可移植性补丁
src/
  photo-engine/                # types、只读 Manifest loader/index；浏览器入口分离
  projects/                    # schema、校验、ID 解析
  content/projects/            # 人工编辑 JSON
  data/photos-manifest.json    # 原生生成物，禁止手工编辑
  components/ui/               # 自写或有来源记录的小组件
  components/viewer/           # React wrapper，动态导入浏览器 GPU 入口
  pages/index.astro            # published Project 首页
  pages/projects/[slug].astro  # published Project 静态路由
  pages/404.astro              # 静态 404
  pages/health.txt.ts          # 保留 bootstrap 探针
  layouts/ / styles/           # 基础布局与响应式样式
public/thumbnails/             # 构建产物
.cache/photo-engine/           # Builder workdir、增量缓存，不提交
licenses/                      # 上游许可、版本、来源与修改记录
```

```text
GitHub main → 固定照片 commit → 原图 + 已有缩略图
  → Node 适配器（排除派生目录、预填充本地缩略图）
  → Afilmory Builder → 原生 Manifest + 缩略图
  → 只读 Photo Index ← Project JSON 校验/按 ID 解析
  → Astro build → 静态部署物
  → 浏览器 React Viewer → 直接读取该 commit 的原图
```

Project JSON 和上游来源/补丁提交 Git；Manifest、缩略图、缓存属于可重建产物。照片仓库提交只有在下一次构建后才体现在网站；触发方式后续配置。构建必须核对扫描原图与 Manifest 数量、唯一 ID、Project 引用、缩略图可用性；处理失败不得发布删图后的不完整 Manifest，保留上次成功部署。

### Phase 3 Website UI 约定

- 首页与 `getStaticPaths()` 只调用公开 `loadProjects()`；按公开索引顺序输出项目，Gallery 使用 `project.photos` 原顺序。静态页展示现有标题、summary、location、period、tags、description（纯文本），不推断或新增正式内容。空目录显示空状态；未知和 draft slug 不生成路由，使用静态 404。
- Astro 输出封面与 Gallery 的原生 `thumbnailUrl`、尺寸和原图链接；不用 image optimizer。单个 React `client:only="react"` island 在同一 Gallery 容器内接管普通点击，hydration 前或 JavaScript 不可用时仍可直接访问原图。传入 island 的照片仅投影 ID、原图 URL、尺寸、alt/caption 和 `isHDR` 等 UI 必需字段，不序列化完整 Manifest/EXIF 或 draft。
- 自写原生 modal dialog 外壳负责关闭、非循环前后切换、Escape/方向键/Home/End、焦点恢复、背景滚动锁定及 loading/error/retry。首次打开才动态导入 `photo-engine/browser`，复用上游 WebGPU → WebGL，GPU 全失败或模块加载失败时显示原始 URL 的普通 `<img>`。`isHDR` 仅说明源图片，实际 HDR 标志只来自 `onHDRChange`；切图卸载旧实例，取消旧状态影响。
- 缩略图有保留尺寸的加载背景与失败提示；移动端单列 Gallery、可触达按钮和动态视口 Viewer。没有另建图片处理或 Project 数据接口。测试在 `.cache/` 的独立 Astro root 中使用 fixture，不写正式 Project/Manifest/缩略图；包含静态构建、无 JavaScript 浏览、桌面/移动交互、资源失败和 GPU 回退。

### UI Redesign — 当前 Website UI 约定（2026-09-10）

用户批准首页采用 Light/空之塔截图风格，Project 内页对齐 Afilmory 作者图库（实际地址 `https://innei.afilmory.art/`）。以下替代 Phase 3 的视觉和浏览能力约定，三层数据边界保持不变。

实现和验收结果见 [UI_REDESIGN_REPORT.md](UI_REDESIGN_REPORT.md)；Metadata / Map 补齐与验收见 [PHASE4_REPORT.md](PHASE4_REPORT.md)。

- **首页**：白色底、灰色 Jason Gallery 字标和绿色句点；5:6 封面网格，>=1200px 四列、900–1199px 三列、600–899px 两列、<600px 单列。标题与 `period.start` 在桌面 hover/focus 时用 200ms 遮罩展示，日期缺失则隐藏。触屏第一次点击显示、第二次点击同一封面跳转，移动超过 10px 不触发跳转，点击外部/按 Escape 收起。所有封面保留原生链接，无 JS 时单击导航。
- **Project 浏览**：48px 深色顶栏、4px 间距 Masonic 瀑布流、列表、搜索/日期/相机/镜头/标签筛选。默认保留项目编排顺序，可临时按拍摄时间排序，未知时间排在最后。视图/列数在 `jason-gallery:view:v1` 保存，排序和筛选编码在当前项目 URL 中，以便分享、刷新与历史恢复；不写入 Project。项目信息收进面板。React island 与静态回退同处一页，hydration 完成才隐藏原图链接回退。
- **显示数据**：`viewerPhotos()` 只投影当前公开项目必需的字段，新增缩略图、ThumbHash、标题/文件名、日期、标签、相机/镜头、基本曝光、格式/大小和照片坐标。详细 EXIF/影调从构建产物 `/projects/<slug>/photos/<id>.json` 按需读取；此路由只生成公开项目引用的照片，EXIF 使用展示字段白名单，不输出存储键、人物区域或完整 Manifest。不改变原始 Manifest 或 Project schema。
- **看图**：动态加载 Viewer、GPU 引擎与详细元数据，使用同 commit 的 MIT viewer-motion 开合/手势库。模糊背景、两侧按钮、底部缩略图条、320px 桌面信息栏、手机底部信息抽屉；缩放时禁用切图手势。浏览器解码直方图在打开信息栏时计算，跨域失败尝试同源缩略图并标明来源。沿用 GPU 降级与真实 HDR 状态；普通图片降级也支持缩放/平移。原生 dialog 提供隔离，引用计数式滚动锁覆盖加载弹窗到灯箱的交接。
- **分享与历史**：`?photo=<id>` 表示当前项目照片，首开 push、切图 replace；支持直达、刷新、前进/后退与关闭后恢复位置/焦点。非法 ID 移除参数并显示提示。分享按钮使用 Web Share 或复制 URL，失败时显示可复制链接。静态分享链接不新增逐照片 OG 页面。
- **地图**：仅加载当前筛选结果中有效坐标；MapLibre + CARTO Dark Matter，保留地图 attribution，支持点和聚合。地图按需加载，不请求用户当前位置；无 GPS 显示空状态，底图或 GPU 失败时仍可用照片列表打开相应照片。
- **独立预览**：`pnpm ui:preview` 使用已导出的真实照片及缩略图，在 `.cache/ui-preview/` 生成四个临时选集并于 `127.0.0.1:4324` 提供预览。此内容不写入正式 Project、Manifest 或缩略图。`tests/website` 继续使用独立、合成且有确定元数据的 fixture，覆盖全部交互和失败分支。
- **明确差异**：保留 Jason Gallery 品牌及 Project 层级，首页使用用户给定白色封面风格；不包含 Afilmory 的账号、社交和后台服务；地图、EXIF 等仅展示现有照片数据。源站视觉对照不包含复制第三方应用代码。

### Phase 4 — Metadata / Map 补齐（2026-09-10）

- `src/components/viewer/metadata.ts` 是 UI 只读投影：拍摄时间仅取有效 EXIF `DateTimeOriginal`，无内嵌偏移时可使用已有 `OffsetTimeOriginal`；保留原始墙上时间、精度与偏移，不转成浏览器时区。原生 `dateTaken` 可能来自构建时钟，因此不能作为缺失 EXIF 的拍摄时间兜底。未知日期不参与日期范围筛选，排序时置末；无偏移日期使用固定墙上时间排序键，不宣称与带偏移记录能准确比较绝对时刻。
- GPS 优先使用有效原生 `location`，反向地理编码未启用时回退到 EXIF 数字坐标及南/西半球参考；保留零坐标，拒绝缺失、不完整、非有限或越界坐标，不补造地名。地图和 Metadata 共用此投影。曝光区优先显示实际焦距，等效焦距明确标注；秒、毫米、EV、海拔米与二进制文件大小单位分别处理，零值不当作缺失值。Engine 未保留分辨率单位时标为原始值。
- 详细元数据仍按信息面板需要加载，白名单增加拍摄偏移、时区来源和海拔参考；切图重置详情，旧请求取消，重试保留键盘焦点。
- URL 在 `photo` 外保存筛选字段、`sort` 和 `panel=map`。首开 push、切图 replace；同文档 Forward 后关闭回到原历史条目，直达/刷新关闭只移除 `photo`。照片与链接筛选冲突时显式清除筛选并提示。地图打开 Viewer 后返回相同筛选与地图视角；视角只在当前页面保留，分享链接不保存缩放/平移。
- 地图保留懒加载、真实点位与聚合，以及无 GPS、网络/GPU/模块失败的列表回退；加载超时给出可重试提示。验收同时包含真实 CARTO 网络路径和独立本地样式的 WebGL 点位交互测试，二者不互相替代。
- `src/website/public-assets.ts` 在 Astro 构建完成后只清理输出目录：保留 published Project 引用的本地照片资产，移除未引用/旧缩略图及 Manifest 中未公开的本地图片资产。源 `public/`、Manifest、Photo Engine 与 Project System 不变。正式项目为空时，公开产物无照片缩略图或详情 JSON。

### Phase 5 — HDR / Color（2026-09-10）

- 继续使用原图 URL 和原生 `isHDR`；SDR 缩略图不作为 GPU 原图输入。`HDR source` 仅说明 Engine 检测到源标记；`HDR active` 要求 Viewer 成功解析 gain map、配置 extended canvas、设备报告高动态范围且图片加载完成。普通 `<img>` 由浏览器自行色彩管理，其实际 HDR 状态不可由本 wrapper 证明，因此不标 active。
- 允许一项实证驱动的 Viewer 生命周期补丁：已加载的 WebGL 上下文丢失未触发上游错误回调，会留下空画布；在 `ImageViewer.tsx` 将该事件接入现有失败路径，清理时移除监听。继续锁定同一 commit；补丁及摘要记录在 `patches/afilmory-hdr-color.patch`、`licenses/afilmory-files.json`，不修改 HDR 判断或色彩算法。
- 格式、色彩与降级验证的支持范围和未验证项以 `PHASE5_REPORT.md` 为准；合成 fixture、软件 GPU 和浏览器截图不等于实体 HDR 屏幕验收。

## 8. 许可证边界

依据锁定 commit 的 [LICENSE](https://github.com/Afilmory/afilmory/blob/a3db486b0a8f2572de3032eabdfce24e726e83f3/LICENSE)：仓库采用 ANL 双轨，Library Code 为 MIT；Project Code 为 AGPL-3.0-or-later，并附 UI attribution 条款。Builder、GPU Viewer、viewer-motion 的 package 明示 MIT；typing/utils/ui 等复用库按根许可的用途分类判断，提取时仍须逐文件检查 SPDX、单独 LICENSE 与第三方代码，不可仅凭 `packages/` 路径判定。

MIT 复用须保留版权和许可文本。复制/改编 `apps/web` 的应用代码则须保留 AGPL 与修改记录，并为使用者提供对应版本的 Corresponding Source，以及显著位置的 Afilmory attribution、精确源码版本链接和许可说明；静态托管、改框架或拆分模块不会自动消除这些义务。默认路线是复用 library packages、自写网站 UI，若引入应用代码须先更新本文中的复用清单及许可策略。

上游文档和非代码媒体默认另有 CC BY 4.0 条款；不复制 Afilmory 品牌、示例照片或暗示官方背书。`jason-photos` 未见许可证文件；照片权利独立于程序许可，不将其自动纳入本站代码许可证。

## 9. 后续实现准入

Phase 1 的独立 Engine smoke test 已通过：用锁定源码包处理普通 JPEG、HDR / gain-map JPEG、已有/缺失/损坏缩略图、重复 basename / ID 和更新图片，核对原生 v10 schema、worker 输出路径及无远端写入；Viewer 包的独立生产构建、CORS 和回退也已实测通过。`pnpm test` 执行 strict 检查、Project 测试、Engine smoke、Viewer bundle/worker 隔离检查、Phase 3 Website 生产构建/浏览器测试和本站 Astro build。Website 测试使用固定 Playwright 1.62.1 与 Chromium（首次运行需 `pnpm exec playwright install chromium`）；Phase 1 的 HDR 设备能力测试仍可单独运行，边界见报告。技术验证发现不兼容时，先修订本文，不能在页面中绕过三层边界。


## 10. Phase 1 实测边界与当时的 Phase 2 准入事项

- 真实 GitHub 快照仍为 `6a7ae47d75dd71bc6874e8d3f222f25b2c05e27f`。实际 listing 为 214 个 `images/` 下文件（154 原图、59 缩略图、1 `.gitkeep`）；Builder 照片列表为 154。Final Gate 已无过滤处理全量 154 张、1,964,370,036 字节原图，原生 v10 与缩略图均为 154；冷缓存和完整 warm 重跑均通过。95 张缺失缩略图自动生成、59 张来源未核实的旧远端缩略图保守重建；第二次全部复用 154 张有效本地缩略图，逐张字节摘要一致。
- 离线 smoke 含 7 张自建原图。HDR fixture 有实际 SDR 主图、可解码 gain-map JPEG 和 XMP，不是只设置 `isHDR` 标志；两图比例一致。测试了 warm/cold cache、坏缩略图、更新 metadata/URL、真实 8 位摘要碰撞的拒绝，以及坏原图构建失败后保留上次成功 Manifest。
- 运行模式是上游 **in-process async worker pool**（并发 2）；cluster 子进程模式未启用、未验收，插件闭包不能直接序列化。ExifTool 子进程实际执行。未来启用 cluster 前必须设计可序列化插件配置并另行验证输出目录。
- 全量资源验收已完成：初次匿名请求因 60 次 API 额度耗尽而在处理前失败；认证后冷/热完整构建分别 314.37/44.14 秒，430/4 次 GET 全部为 200，无重试、坏图、丢图或警告。缓存约 2.0 GiB，磁盘余约 59 GiB。原生 provider 仍有逐文件 contents 与路径历史查询，新环境须准备足够的只读 API 额度；限额不足不能输出不完整 Manifest。
- 远端旧缩略图来源信息不足时可能重建更多图片；目前不追求最大复用率、不复用旧 metadata、不启用多次构建并发写同一缓存目录。缓存/旧 run 的清理和原子目录发布需在正式发布流程前处理。
- Phase 2 实现 Project schema（含可选 `location`）和引用校验后才能检查真实 Project 引用。本阶段没有 Project 数据。正式 Viewer wrapper、跨浏览器 HDR、真实相机 gain-map/ISO/MPF 多样性和屏幕视觉质量继续验证，不把本次合成 fixture 结果外推到全部设备。

Final Gate 的独立命令为 `pnpm photos:verify --run <completed-workdir> --exported`；它拒绝抽样结果，并核对扫描集合、Manifest、缓存原图和各处缩略图的完整性。最终机器摘要见 `reports/phase1-final-gate.json`，错误/资源与复现详情见 `PHASE1_REPORT.md`。该 Final Gate 仅验收 Phase 1；后续 Project System 实现与测试见 `PHASE2_REPORT.md`。

## Phase 6 — 自动化、增量产物与部署（2026-09-10）

以下替代 Phase 1 中“每次强制重新处理所有 metadata”“不支持并发”“远端 legacy 缩略图同 commit 即可复用”和“部署后续配置”的旧约定；三层边界、Manifest v10、Project schema、UI 和 HDR/色彩算法保持不变。详细操作见 [README.md](README.md)，验证与部署实况见 [PHASE6_REPORT.md](PHASE6_REPORT.md)。

- **输入与权限**：网站 main push / 手动 dispatch / 每小时 UTC 17、47 分钟 schedule。照片仓库只读，每次先解析一个 commit，所有 listing/原图 URL 均使用该 commit。保留原生 GitHub provider 扫描，再与该 commit 的 Git tree 交叉核对完整 key/blob/size；tree 截断或缺图失败。PR 和非 main 仅运行无秘密的隔离检查。短期 GITHUB_TOKEN 为网站 Contents Read、Actions Read；可选照片专用 token 仅 Contents Read。Cloudflare Secret 只在发布/回滚步骤注入。
- **浏览器检查环境**：`tests/browser.ts` 固定同版 Chromium 与显式 SwiftShader。WebGPU/色彩测试使用 headless shell 的 Skia Graphite/Dawn 软件合成，解决 Linux GaneshGL 无法创建 WebGPU canvas SharedImage 的问题；普通交互/地图测试使用 headless shell 与 WebGL/GL 合成。适配器探针仅作诊断，真正成功由 renderer、loaded、HDR/ICC 像素和故障路径断言决定；测试启动脚本避免序列化 tsx 辅助函数。CI 保留浏览器进程日志和独立 `viewer-diagnostics` artifact 14 天，不进入公开网站或完整照片产物。
- **缓存**：原图按 Git blob SHA 复用并逐次校验字节。派生 fingerprint 覆盖 config、精确 lockfile、Node/OS/架构、Sharp/native versions、锁定 Builder 及本地依赖源码和运行时适配脚本；不包含页面/Project。缩略图和 metadata 还绑定原图 SHA、远端缩略图 SHA、各自 SHA-256。缺失或失效时重新进入原生处理；未版本化的远端缩略图不再复用，避免配置变化后冷缓存又引入旧派生结果。已有的 Phase 1 原图缓存可直接复用；第一次升级会重建派生缓存。
- **metadata 新鲜度**：每次重新扫描。命中项校验原图字节与此前成功处理的相同，跳过 Sharp/ExifTool/影调处理；用原生 `extractPhotoInfo` 刷新时间 fallback（保留原生合并的 XMP tags），更新 listing 时间和固定 commit 的 `originalUrl`。EXIF/HDR/色彩 metadata 只在字节及处理版本不变时复用。通过 Builder 已有 `afterTasksPrepared` / `afterProcessTasks` 钩子移除已验证任务并回填结果，仍由上游生成相机/镜头集合、排序和保存 Manifest。未改上游源码、原生 ID 或 schema。
- **完整性与并发**：独立 run workdir；相同根目录用 `build.lock` 拒绝第二个 writer。成功产物封存到 run/artifact，`output` 原子切换符号链接。每代只有当前照片的缩略图，删除不会留下旧文件。核对数量、ID/key、完整 Manifest、固定 URL、可解码缩略图和逐文件摘要，单张失败即终止。CI 只缓存成功处理的 blobs 与派生状态，分别使用源 SHA / fingerprint 的稳定 keys；cache 是候选，不能绕过检查，丢失可冷重建。
- **网站发布**：`scripts/ci/release.ts` 验证照片产物与当前 fingerprint，校验全部 published/draft 引用；正式 Project 必须被 Git 跟踪，production checkout 必须干净且与代码 SHA 相符。Astro 先构建到独立 staging，保留 Phase 4 public-assets 过滤，并对路由/详情/thumbnail/静态 bundle 做输出白名单和摘要校验，拒绝预览、fixture、全量索引或临时文件。`release.json` 位于 dist 外，绑定代码 commit、照片 commit、照片 artifact version、Project digest、fingerprint、run number 及文件摘要；公开 `/build-version.json` 只有版本来源，没有图库内容。
- **托管**：选用 Cloudflare Pages Direct Upload，原图依旧浏览器匿名直读 GitHub，不通过 Pages 转码。独立域名根路径兼容现有 UI，无需 GitHub Pages 的仓库子路径改造。锁定 Wrangler 4.130.0，部署前验证 release、两个 main HEAD 和线上 run number；所有发布/回滚共享 `gallery-production` 串行组，禁止自动取消上传。仅上传验证完的 dist。相同代码/照片 commit 已在线时返回 unchanged，不重复部署。只在匹配的 Cloudflare production deployment 成功且版本探针通过后记录新 URL/UUID/version。原子部署失败保留上次成功；发布后验证异常尝试 rollback，网络不确定如实记录，不把 CLI 返回码当作远程事实。
- **开关与回滚**：`AUTO_DEPLOY_ENABLED` 默认为 false；push/schedule 仍完成真实照片和网站构建，配置账号后设 true 自动部署。手动 `mode=publish` 是明确发布指令。回滚前将此变量设 false 防止下次自动前滚，再 dispatch `mode=rollback` 和成功 production deployment UUID。复用 Cloudflare 已保留的完整部署，不依赖本地/Actions 缓存，不混入当前 Project 或照片快照。回滚和发布均在 main workflow 执行。

### 后续轻量后台的对接契约（本阶段不开发后台）

`workflow_dispatch` inputs 为 `mode: sync|publish|rollback`、`photo_commit?`、`photo_run_id?`、`deployment_id?`。`sync` 是手动默认，单独完成照片处理并上传完整照片产物，不更新线上。`publish` 可处理当前源或导入明确 run ID 的 `photos` artifact；导入要求来源为已结束的 main automation run、明确的同一 photo commit、兼容 fingerprint、完整索引及匹配的逐文件摘要。网站发布失败不否定照片处理成功；如果 `photos` 已成功上传，它仍可复用。正常 publish 拒绝旧代码/照片 main 快照；需要恢复旧版本走 rollback。后续触发服务只需网站 Actions Write，下载只需 Actions Read，不需要照片仓库写权限；本阶段没有 GitHub App、身份认证、管理页或数据库。

- `photos`（14 天）：原生完整 Manifest（包含未被公开 Project 引用的照片）、全部缩略图、源快照、result、artifact descriptor；只存在 Actions artifact，不能复制到公开 dist。
- `website-release`（30 天）：通过校验的 dist + 外置 release descriptor；只有 dist 发布到 Pages。
- `execution-summary`（30 天）：`schemaVersion=1`、任务结果、网站/照片 commit、photos.status/总数/实际处理数/复用数/artifact version、website.status/version、失败原因、deployment.status/实际 URL/UUID/version。未处理的数量为 null；not_requested/disabled 不代表部署成功，unchanged 指已核实的现有版本。总结脚本不依赖已安装包，安装失败也尽量保存摘要；硬终止时以上传可用性和 Actions conclusion 为准。

照片产物过期后用同一 `photo_commit` 重新 sync，缓存不存在也能重建；旧源 commit 必须可读取，处理版本变化需重新处理。Actions artifact 受仓库访问与保留策略约束，**公共网站仓库的 artifact 不是保密存储**；将来需要隐私时须引入受控私有产物存储，不能仅依赖“未部署到网站”。本阶段没有新增公开全图库接口，也没有正式摄影 Project。
