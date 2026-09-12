# Phase 4 — Secondary Gallery UI & Final Design-System Parity

本阶段以 `Afilmory/Afilmory@1f65cde6672e5231599182620116ac904e39f548` 为基准。
2026-09-12 下载当前 main 并确认提交未变化；完整阅读的
[DESIGN.md](../viewer/AFILMORY_DESIGN.md) 与远端字节一致，SHA-256 为
`12643e2c980ac021da63ffafaf76c6f2d06d8c479c7da25832da7bbb68b265ab`。
DESIGN.md 优先于组件内的旧样式。

## 逐项差异审计

| 要求 / 上游基准 | 本地结果与保留的适配 | 证据 |
| --- | --- | --- |
| Desktop ListView 虚拟化、176px 高、8px 间距、max-w-6xl、py-8 | 迁移 ListView / PhotoCard 结构；`useWindowVirtualizer` 对接现有 document 滚动，overscan 5，key 为照片身份。桌面只渲染可视范围与预取行。 | `ListView.tsx`；480 张列表的末页、返回和 DOM 数量测试；`list-desktop.png` |
| 左侧缩略图 | 桌面宽 224px、填满卡片高度、object-cover；图片上保留 tags 和 HDR。缩略图保留本地 ThumbHash→JPEG 渐进加载。 | 桌面尺寸 / crop 断言与截图 |
| title / location / date / camera / lens / EXIF | 按上游顺序展示标题、可用位置、日期、相机、镜头、尺寸和 EXIF；EXIF 为 ISO、光圈、快门、焦距、可用曝光补偿。日期使用 Jason 已有拍摄日期，缺失时不伪造修改日期。长信息通过本地 EllipsisWithTooltip 展开。 | `ListView.tsx` / `photos.ts`；真实云南 Project 预览；列表测试 |
| ListView card material / border / hover / active | 规范优先：material-ultra-thin + 40px blur + accent/20 hairline；12px 卡片与 8px 图片圆角。1.05 图片 hover、按压反馈使用共享 spring，响应 reduced motion。没有迁移上游 white UI、lucide、sm blur 和 transform CSS tween。 | CSS / 源码审计；`list-desktop.png` |
| Mobile ListView | 上图下 metadata，图片保留原始 aspect ratio 和 contain；虚拟行在宽度 / 内容变化时测量，图片比例预留防止 load reflow。横竖 / 长图不裁成固定横幅。 | 390px 与 768px 测量、切回桌面、延迟图片加载测试；`list-mobile.png` |
| 保留 Project ordering / filters / Viewer trigger | 使用同一个 `items` 和未修改的 `selectPhotos`；List 的图片容器提供 Viewer trigger，整卡可点击及键盘打开。保留 photo URL、关闭焦点、滚动位置。 | 列表最后一张打开 / 关闭；Project 集成与 URL / Back / Forward 测试 |
| Search / Command Palette material、层级、selected state | 迁移 command rows、28px icon 容器、类别与副标题、数量、selected check、可移除 FilterChip。搜索主输入保留原关键词语义；相机、镜头、标签单选，日期起止仍使用原字段。 | `SearchPanel.tsx` / `FilterChip.tsx`；`search-desktop.png` / `search-mobile.png` |
| 不重写过滤算法与 URL 状态 | `src/components/viewer/photos.ts` 无差异；query/start/end/camera/lens/tag/sort/view/columns 使用既有 URL 约定，replaceState 不新增筛选历史。重置、移除单个条件、刷新、分享链接均保留。 | `source-audit.json`；组合日期/标签/相机测试；filtered/sorted share 回归 |
| keyboard / focus / mobile search | Cmd/Ctrl+K、非输入区 `/` 打开；输入自动聚焦，↑↓ / Enter 操作 command，IME composition 受保护，Tab trap、Escape 与焦点返回。手机是 Vaul 抽屉，适配 visualViewport 和安全区，短屏内容可滚动。搜索中还提供设置、地图、信息和两种视图入口。 | keyboard / 320×568 手机 / focus trap 测试；`search-mobile.png` |
| ViewPanel desktop dropdown / mobile drawer | 桌面锚定在触发按钮，Radix collision placement、z60、12px radius；手机 Vaul shell，z40 scrim / z50 drawer、48×6 handle、safe-area。共享 smooth/snappy spring 驱动 entry/exit 和拖动，关闭过程中快速重开生成新实例。 | `Panel.tsx`；settings 分支、位置与 drag 测试；桌面 / 手机 settings 截图 |
| 保留全部 settings | 项目编排 / 新到旧 / 旧到新；自动及 1–8 列；masonry/list segment。排序用键盘可操作 radio，列数保留拖动 preview→提交，原生 range 增加 Home/End/方向键；范围未收缩为上游手机 3–5。 | `ViewPanel.tsx`；列数、排序、segment、URL / localStorage 测试 |
| Project Info | 保留 title / summary / location / period / count / description / tags / attribution；统一 material-thick、40px blur、accent border、16px radius、semantic typography、pill tags、32px close。桌面居中、手机抽屉。 | Project 信息与无 JS 回归；真实云南 Project 预览；`info-mobile.png` |
| Map 入口、容器、列表、状态 | 入口沿用本地 MingCute 按钮。面板、地图圆角、navigation controls、attribution、缩略列表、空状态 / retry 使用同一 token；聚合与单点使用 accent。MapLibre source、cluster、viewport 保存、点击逻辑保留。 | 实际 WebGL 像素识别聚合 / 单点、展开与返回恢复测试；署名深色材质与展开 / 收起回归；网络与模块失败、无 GPS 测试 |
| Geist / semantic colors / material / blur | `photo-tokens.css` 成为 Gallery 与 Viewer 的唯一字体与 token 定义；保留本地 OFL 字体和 mono stack。默认 accent 为 DESIGN 的 #007aff；Viewer photo-derived accent 逻辑未改。仅允许 40/12/4px 三种 blur role，固定边缘保留 LinearBlur。 | `photo-tokens.css`；Viewer typography / accent / material 测试；源码审计 |
| radius / z / icon / motion / focus / safe-area | 大面板16、菜单/卡片12、输入/segment8、子项6、chips/icon圆形；图标按钮32或28。无新增 lucide，所有 glyph 本地化。Gallery/Viewer 的 CSS z 值均落在规范表内。瀑布流之前的 300ms CSS scale 已换成 spring；普通颜色/透明度保持 200/300ms。 | `source-audit.json`；hover / reduced-motion / mobile controls 测试 |
| Theme / 首页范围 | Project Gallery 与 Viewer 均 dark-only，无 light 分叉或主题入口。共享 token 只匹配 `.gallery-page` / `.photo-dialog`。多 Project 首页的源码、设备主题与两步触摸交互不变。 | source audit 中 homepageDiff 为空；Light home 和设备 theme 整站测试 |
| 全部运行源码本地化 | 所有迁移源码均在 `src/`；必要的本地 primitive 及精确版本 Radix/Vaul 依赖已落库。没有 submodule、临时目录源码 import 或 GitHub 源码 runtime download。照片原有外部 URL 和地图服务不是源码依赖。 | [来源和适配说明](../../licenses/gallery-upstream.json)、[第三方声明](../../THIRD_PARTY_NOTICES.md)、source audit |

## 有意保留的差异

- 保留 Jason 的 Project 标题、返回首页、顺序、单值筛选和 `?photo=` Viewer 约定；不引入 Afilmory 的站点身份、登录、rating、多标签关系和路由架构。
- Desktop Gallery/List 继续读取 document/window 的滚动位置，保留原有 Viewer transition 与 scroll-lock 契约；没有为了样式引入另一个 desktop ScrollArea。
- 桌面设置外观采用上游 dropdown surface，但内部是包含 range / radio / segment 的设置表单，因此使用 Radix Popover 的 dialog 语义，而不是给非 menuitem 表单套用 menu 语义。
- Vaul shell 的默认 CSS cubic-bezier 被关闭，使用共享 Motion spring；这优先满足 DESIGN 的空间运动要求。列数滑杆保留原生键盘和可访问性行为，不复制上游 pointer-only 控件的缺陷。
- ListView 的圆角、玻璃材质、语义文字、图标、blur 与 motion 按 DESIGN 修正，故不会逐像素复制上游 ListView 中尚未迁移的旧样式。
- MapLibre 的功能和服务保持原样；没有把 Project 地图改成上游独立地图路由。

## 验证与视觉证据

最终命令结果记录于 [verification.json](../../reports/gallery/phase4/verification.json)，各日志在同目录。
[源码审计](../../reports/gallery/phase4/source-audit.json)扫描 Gallery + Viewer 的 54 个源码文件；同时核对首页与过滤算法 diff、来源摘要、submodule。

Viewer 53/53、整站 43/43 全部通过；署名修复后再次通过地图专项回归 1/1、类型检查、来源校验和生产构建。最后一次修复仅提高 Project 地图署名选择器的优先级，使其在 MapLibre 延迟加载后仍使用深色材质与可读文字。

视觉检查包括真实云南 Project 的桌面 List / Info、真实伊春 Project 的地图（87 张定位照片、聚合和 CARTO / OpenStreetMap 署名），以及 fixture 的桌面 hover / List / Search / Settings 和手机 List / Search / Settings / Info。
截图保存在 [Phase 4 reports](../../reports/gallery/phase4/)。这些是本地渲染证据；没有声称与上游旧样式逐像素相等。
既有 HDR / GPU / 手势代码未修改；软件 GPU 的测试证明浏览器行为，不作为物理 HDR 屏幕认证。

Phase 3 报告中“Gallery 图片 scale 使用 300ms CSS”和“未引入 command palette / tooltip”的描述是当时状态；本阶段已由上述实现取代。
