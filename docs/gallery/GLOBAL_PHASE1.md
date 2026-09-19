# Global Gallery Phase 1

本阶段为未来 Explore 和全站 Map 建立共享能力；不生成新页面、路由或视觉组件。
开始前阅读现有 Project/Gallery/Viewer/Map、metadata、URL/history 实现与
[Afilmory DESIGN.md](https://github.com/Afilmory/afilmory/blob/main/DESIGN.md)，
延续 Jason Gallery 当前设计和三层数据边界。

## 公开集合

`src/website/public-photos.ts` 只在构建/服务端使用：

```ts
const collection = loadPublicPhotoCollection();
const photos = collection.listPhotos();
const photo = collection.getPhoto(photoId);
const details = collection.getPhotoDetails(photoId);
```

也可以向 `resolvePublicPhotoCollection(projectIndex)` 传入已经解析的 Project
索引，避免重复读取。公开入口仍调用 `loadProjects()`，包括所有 Project 的 schema、
引用和唯一性校验。resolver 额外检查 published 状态，防止误传 draft/mixed index。

- 资格来自至少一个 published Project 的引用；不扫描 Manifest 作为公开列表。
- 按 canonical photo ID 去重，兼容 resolver 已解析的 legacy alias / qualified ID。
- `projects` 仅含公开 Project 的 `id`、`slug`、`title`；没有草稿信息。
- 顺序按现有 Project order/slug，再按项目内编排首次出现决定。同一照片默认
  alt/caption 与详情 URL 使用首个公开 membership，其他项目里的本地说明不变。
- 每项直接复用 `galleryPhotos()` / `viewerPhotos()`；坐标、拍摄日期、HDR、
  video、capture 等字段沿用已有投影，不序列化完整 Manifest/EXIF/人物 regions。
- 返回只读冻结快照，不修改 Engine、Project 内容或生成新的持久数据源。

`getPhotoDetails(id)` 从集合中已确认的公开 membership 访问
`projectPhotoDetails()`。后者再次检查 Project 状态和照片归属，并使用原 Project
metadata route 的 EXIF 白名单；不存在、draft-only、未公开引用的 ID 返回
`undefined`。现有 `/projects/<slug>/photos/<id>.json` 使用同一投影，响应保持一致。
未来 `/photos/<id>.json` 可从此集合生成路径和响应，本阶段没有生成该路由。

## Gallery / Map 共用接口

`src/components/gallery/filters.ts` 是浏览器可用的共享逻辑：

```ts
const state = readGalleryState(url.searchParams);
const visible = selectPhotos(photos, state.filters, state.sort);
const options = galleryFilterOptions(photos, ['project', 'camera', 'lens', 'tag']);
const nextURL = galleryStateURL(url, state);
```

URL helpers 位于同目录的 `url-state.ts`。筛选为 query、project、start/end、
camera、lens、tag；project 值是永久 ID，不是标题或 slug。所有条件取交集；
query 保持原有逐词匹配语义。sort 保留 project/asc/desc：project 表示输入集合
顺序，未知日期始终排最后，日期规则不变。泛型 selector 保留原项类型和引用，
不会丢掉 memberships、video、capture 等 Gallery 字段。

ProjectGallery 直接使用这些函数；SearchPanel 复用 facet 统计，默认仍显示当前的
camera/lens/tag。未来可选择 Project facet；无需新建 exploreFilters/mapFilters。
URL 写入只变更 filters/sort，Viewer、Map、视图、hash 与额外参数保持。
history 写入时机、owner、焦点、滚动、地图 viewport 继续由调用方负责。
Map 可继续消费 `visible` 和既有坐标 resolver/marker/cluster，未新增另一套实现。

## Viewer

仅将 `projectTitle` 参数改为 `collectionTitle`。`photos`、`index`、`onIndex`、
`onClose`、`trigger` 原有契约足以承载任意当前集合。调用方把 current photo ID
定位为集合内的 index，再按回调维护自己的 URL/history。
Viewer 不需要原始 Project、Manifest 或全局 store；metadata 继续从当前照片的
`detailsUrl` 按需读取。视觉、HDR/图像算法、Live/Motion Photo、动画、手势、缩放、
Swiper、fallback 均未改写。

## 验证

新增测试覆盖公开资格、去重、memberships、canonical IDs、只读快照、详情访问
边界、原 Project route 响应兼容，以及共享过滤、facets、排序和 URL 往返。
现有 Website 浏览器测试继续覆盖 Gallery/List、搜索、URL/Back/Forward、Viewer、
Live/Motion Photo 和 Map；Viewer 独立测试验证交互、图像加载及 HDR/GPU fallback。

2026-09-20 验证结果：

| 命令 | 结果 |
| --- | --- |
| `pnpm check` | 通过 |
| `pnpm test:projects` | 48/48，通过，无跳过 |
| `pnpm test:website` | 97/97，通过，无跳过；包含新增 10 个集合/筛选单元测试与 1 个生产 metadata route 集成测试 |
| `pnpm test:viewer` | 65/65，通过，无跳过；bundle/worker 隔离检查同时通过 |
| `pnpm check:upstream` | 通过，16 个核心 Viewer 源文件保持固定基线 |
| `node --import tsx scripts/upstream/check-viewer-interactions.ts` | 23 个 interaction 来源记录通过 |
| `pnpm build` | 通过，仍生成 4 个页面 |
| `git diff --check` | 通过 |

浏览器测试在允许本地 127.0.0.1 监听的环境完成。运行日志保存在本地
`.cache/global-gallery-phase1/`，不进入网站产物或提交。
现有真实内容只读核对：2 个 published Projects、154 个公开引用对应 154 张公开
照片，139 张有有效坐标，全部公开 detail 可解析；正式 Project 和 Engine 数据未修改。
