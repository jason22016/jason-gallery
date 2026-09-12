# Phase 3 — Project Gallery / Masonry Parity

2026-09-12。本阶段只修改 Project 内 Gallery。参考
[Afilmory/Afilmory](https://github.com/Afilmory/Afilmory/tree/1f65cde6672e5231599182620116ac904e39f548)，
通过 `git ls-remote` 核实 HEAD 为 `1f65cde6672e5231599182620116ac904e39f548`。
已完整阅读 [DESIGN.md](../viewer/AFILMORY_DESIGN.md)，该本地副本与上游逐字一致。

所有运行源码都在仓库内。没有新增生产依赖、submodule、GitHub 源码导入、运行时源码下载或对外部 checkout 的依赖。
完整逐文件来源、adaptation 和许可证见 [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md)，
可核对的上游/本地 SHA-256 见 [gallery-upstream.json](../../licenses/gallery-upstream.json)。
应用代码沿用 AGPL-3.0-or-later + ANL §4；LinearBlur 为 MIT。

## 已迁移与适配

| 上游 | 本地实现与适配 |
| --- | --- |
| `MasonryView.tsx` | 移植列宽配置、手动列宽 clamp、4px 双向 gutter、400px estimate；复用 Viewer 的 `useMobile()`，以实际容器内宽计算 safe-area/padding。 |
| `Masonic.tsx` | 保留 `usePositioner` + `useMasonry` 组合，使用 masonic 的 12fps window scroller。提前填入所有 aspect-ratio 高度；resize 按实际宽度新建原生定位缓存，将每张照片加入最短列，避免继承零宽度/旧宽度的列分配；图片加载不会参与定位。稳定外层容器解决 masonic 初次挂载替换节点的问题。DOM 按 Project index 排序，并提供虚拟列表 `aria-posinset/aria-setsize`。 |
| `MasonryPhotoItem.tsx` | 全卡 gradient，1.05 hover scale，300ms 图片和信息 reveal，标题、说明、格式/尺寸/大小、tags、四类 EXIF chips。采用本地 scoped CSS 的 group-hover 等价选择器；普通 hover 不使用 React 状态。保留链接、键盘 focus 和 Jason/上游两种 shared-element trigger 标记。 |
| `PageHeader/{index,Left,Right}.tsx` | 48px 内容栏、60px LinearBlur band、12/16px 横向间距、Geist、dense typography、MingCute 和 dark semantic material。内容仍为返回首页、Project title 和照片数。 |
| `ViewModeSegment.tsx` | `LayoutGroup` + 共享 `layoutId` + `Spring.presets.snappy`，使用 `LazyMotion/domMax` 使 layout animation 实际生效。视图/列数保留本地偏好，并写入 URL。 |
| `FloatingActionButton.tsx` / `PageHeader/utils.tsx` | 提取按钮呈现和状态层级，保留 Jason 搜索、地图、设置、Project info 回调。32px 按钮、40px panel blur、material cluster、hairline 和轻阴影。 |
| `progressive-blur/index.tsx` | 本地化 mask、几何 blur progression 和 tint。补足 DESIGN.md 要求的 8 层，包括顶部 128px 强度；用 DOM 叠放代替非规范 z-index。 |
| `MasonryPhotoItem` 视频逻辑、`image-loader-manager.processVideo` | 提取到 `media/useLivePhoto.ts`；200ms desktop hover 延迟、ready/playing/loading/error、leave/end reset、AbortController、超时、Blob/事件/定时器清理。 |
| `motion-photo-extractor.ts` / `mp4-utils.ts` | 直接本地化 Range 提取、完整文件 fallback、ftyp 验证和 MOV 的 MP4 MIME Blob 交付；增加取消请求，替换 i18n 依赖。 |

`gallery/photos.ts` 从现有 Project 投影额外提供 aspectRatio、原生 video 元数据和四项 capture 值。
没有修改 Viewer 数据合约、完整 EXIF 的按需加载、photo manifest、sync 或 build pipeline。
`PhotoThumbnail.tsx` 保留原缩略图 URL、尺寸、质量和 native hexadecimal ThumbHash 解码，只增加 readiness 回调和错误图标。

## 布局与交互验收

自动 target width 为 mobile 150px / desktop 250px；手动 target width 限制为 mobile 120–250px / desktop 200–500px。
与上游相同，target width 由 masonic 换算为填满容器的整数像素实际列宽，手动选择的列数会因宽度限制而调整。
最多 8 列；overscan 为向前两个 viewport、向后一个 viewport。

| Viewport 宽度 | 自动列数 | 实测单列宽度（无额外 safe area） |
| --- | --- | --- |
| 390px | 2 | 189px |
| 768px | 4 | 187px |
| 1023px | 6 | 165px |
| 1024px | 3 | 328px |
| 1440px | 5 | 278px |
| 3000px | 8 | 367px |

480 张测试照片只挂载 overscan 内的卡片。独立最短列算法断言确认首次布局及每次 resize 均按 Project 顺序逐张加入最短列。图片请求被暂停时已建立完整几何；释放请求后逐卡位置和总高度不变。
跳到最后一张、回到顶部、跨 1024px resize、筛选和重新排序均通过，未出现图片加载后的 masonry reflow。

保留上游 `<200px` 隐藏 EXIF 的规则。为防止标题被长说明/多标签挤出卡片，小卡片额外缩减说明和标签行数；完整内容仍保存在原数据和 Viewer 信息面板中。
Gallery 的图片 hover scale 按本阶段明确要求使用 300ms CSS；空间移动的 segmented indicator 使用 spring。

Live Photo、嵌入 MP4 的 Motion Photo、真实 QuickTime `qt  ` MOV fixture 均能播放。
测试覆盖 200ms 延迟取消、播放结束/鼠标离开归零、加载失败、Range fallback、切换 List 时释放 Blob，以及 mobile/reduced-motion 不调用 `play()`。
Gallery 的 reactive media-query hook 支持运行中切换 reduced motion；避免已安装 Motion hook 只读取初始偏好造成的残余动画。

保留 Project 编排、筛选、时间排序、`?photo=`、Back/Forward、Viewer opening trigger、关闭时滚动和焦点恢复、跨源照片身份、地图 viewport 恢复及 HDR/WebGL 回退。
Project info 中复用已有 Afilmory attribution；无 JavaScript 的页面也能查看 attribution、Project 信息并打开原图。

## 有意保留的差异

- Jason 继续使用 window/document 滚动，以保留现有 Viewer 的滚动锁定、shared-element 和返回位置；没有引入 Afilmory 的 desktop ScrollArea/context 布局。
- 手机上的 segment 与四个操作入口浮动在底部，保留全部功能和 44px 可触区域。上游 mobile 通常把视图选择等放入更多菜单。
- Project title、返回首页、Project count、既有搜索/地图/设置/info 内容保持 Jason 架构；未引入 Afilmory 的站点身份、社交、登录、云端状态或 command palette。
- 本阶段未重做 List 内容和操作面板。长标题使用原生 title 提示与可访问文本；未新增整套 Radix Tooltip 系统。
- 视频 Blob 由当前卡片负责清理，没有移植全局转换结果 LRU。MOV 与上游一样只做 MIME/容器交付适配，不重编码不受浏览器支持的 codec；此类视频显示错误 badge，照片仍可正常打开。
- 多 Project 首页、Project Card、Viewer/Inspector、HDR/WebGL 实现、后台、Cloudflare、sync/build pipeline 均无源码改动。

## 证据

- `tests/website/gallery.test.ts`：8 项专项浏览器测试，使用 480 张合成照片和仓库内真实可解码视频。
- `tests/website/website.test.ts`：Project/Viewer/地图/原生触摸/HDR 集成回归；只将 Project 浅色外观断言更新为 DESIGN.md 的 dark-only 要求，首页仍随设备主题。
- [desktop hover](../../reports/gallery/desktop-hover.png)、[mobile](../../reports/gallery/mobile.png)：专项 fixture 截图。
- 另在真实照片预览中检查了 1280px 桌面与 390px 手机效果。
- 四项最终命令结果：见 [verification.json](../../reports/gallery/verification.json)。
