# 原图加载与 Afilmory 同步记录

同步日期：2026-09-12。基准：[Afilmory `1f65cde6672e5231599182620116ac904e39f548`](https://github.com/Afilmory/Afilmory/tree/1f65cde6672e5231599182620116ac904e39f548)。在线查询 main、固定 commit 下载哈希和独立上游 checkout 均用于验证基准。

## 加载与显示

```
ViewerPhoto.src (= manifest.originalUrl)
  → useImageLoader（每张照片/重试独立生命周期）
  → ImageLoaderManager（300ms 延迟、XHR 取消与字节进度、LRU）
  → file-type magic number 检测
  → 必要时 HEIC/HEIF、TIFF 转换（最多并发 2 个）
  → 受使用期保护的 Blob URL
  → ImageViewer：WebGPU → WebGL → native <img>
```

下载/转换成功只设置 `highResLoaded`；`PhotoMedia` 继续显示缩略图。WebGPU 的上游引擎在首帧 draw 后等待 `queue.onSubmittedWorkDone()`。WebGL 的上游引擎只保证提交 draw，故本地 React 包装层在首次加载后执行一次 `gl.finish()`；两者均经过两次 requestAnimationFrame 的交接后才触发 `onLoad`、显示 canvas 并移除缩略图。这提供 GPU 工作完成与浏览器绘制机会，不宣称验证物理显示器扫描输出。

设备丢失/renderer 重新初始化会重新显示缩略图并暂时禁用缩放按钮。加载取消覆盖延迟、XHR、检测与转换期间；CPU 解码器本身不能中途停止，但取消立即结算加载 Promise、跳过尚未执行的队列任务，已开始的结果不会发布或分配 Blob URL。源变化和卸载后的回调不能覆盖当前照片。

普通与已转换照片各使用容量 10 的 LRU。缓存命中避免再次下载；缓存持有权与 viewer 使用权分开计数，淘汰/清空后等最后一个使用者释放才 revoke。卸载释放使用权；缓存中的 URL 可供回访复用。重试会使该原图 URL 的缓存失效。相同原图的进行中转换复用任务。

GPU 导入、WebGPU、WebGL/context loss 的容错均保留。native 优先使用同一个 Blob，避免重复网络请求且能显示已转换格式；若下载/CORS/格式识别失败，仍尝试直接 `<img src=originalUrl>`。完整失败保留原来的错误、重试和打开原图操作。外部原图链接一直指向 originalUrl。

## 显式配置与剩余差异

| 配置 | 当前值 |
| --- | --- |
| initialScale / minScale / maxScale | 1 / 1 / 20 |
| pinch | step 0.5，disabled false |
| doubleClick | step 2，toggle，200ms，disabled false |
| panning | disabled false，velocityDisabled true |
| wheel | step 0.1，wheelDisabled/touchPadDisabled false |
| limitToBounds / centerOnInit | true / true |
| smooth | true；保留 reduced-motion 时 false |
| alignmentAnimation | sizeX/sizeY 0，velocityAlignmentTime 0.2 |
| velocityAnimation | sensitivity 1，animationTime 0.2 |

这些是上游 ProgressiveImage 与 viewer 默认配置合并后的有效值。网站保持原有弹窗、工具栏、侧栏、缩略图条、手势和焦点管理，不加入上游的数字进度面板、调试叠层、Live Photo、区域标注或右键菜单。下载和转换状态通过现有 loading 生命周期及 data 属性管理，页面文案和布局不变。native 容错仍保留原来的手势实现和 1–10 倍范围。

与上游的有意差异：

- `ImageViewer.tsx` 保留本地 context-loss 容错，并新增 `onLoadStart` 与首帧交接。其余 **15 个 viewer 源文件逐字节一致**，包括引擎、shader、tile worker、HDR Gain Map；未改动核心算法。
- loader/hook 是供本网站调用的独立适配层；没有上游 Jotai/i18n/视频处理依赖。取消后 Promise 结算、缓存使用期保护、缓存命中避免网络下载及重试失效比当前上游更严格。
- 转换输出由统一缓存管理，上游 TIFF 转换不缓存，本实现也缓存 TIFF。HEIC 使用相同 `heic-to 1.5.2`、JPEG quality=1；TIFF 使用相同 `tiff 7.1.3`、首个页面、全尺寸 JPEG quality=1，并补足灰度及 alpha=0 的处理。Safari 原生格式选择逻辑与上游一致（HEIC 需 Safari 17+；TIFF Safari）。
- `smooth=false` 的无障碍例外、native fallback、错误重试、原图外链及本网站 UI 均保留；debug 固定 false。

## 画质边界

普通 JPEG/PNG/WebP 等格式不重采样、不重新编码。纠正错误 MIME 时只使用 Blob.slice，字节不变；JPEG ICC、EXIF、HDR Gain Map 均完整到达既有 worker。特殊格式仅在浏览器需要时转为全尺寸 JPEG，行为对齐上游：JPEG quality=1 仍不是无损格式，TIFF 高位深归一到 8 位，转换过程可能丢失原始 ICC/HDR/元数据。这不是原始文件修改，原图外链保留原始文件。native fallback 的 HDR 能力取决于浏览器，未添加自定义 HDR 算法。

HEIC 解码包约 3MB（gzip 约 752KB），只在需要转换时动态加载；TIFF 也动态加载。`file-type 22` 的浏览器入口含未调用的 Node `fromFile` 兼容方法，bundle 检查只允许该核实方法中的 `node:fs/promises` 字符串，仍拒绝其他 Node/Builder/私密配置泄漏。

## 同步检测

- `pnpm check:upstream`：离线检查全部本地 viewer 源文件、增删及 SHA-256；已审阅包装层差异也必须精确匹配。已纳入 `pnpm test:checks`。
- `pnpm check:upstream --upstream-dir /path/to/Afilmory`：额外检查 checkout commit、对应源码、上游新增文件与参考实现哈希。
- `pnpm check:upstream --remote`：查询当前 main 是否推进，并逐文件验证固定 commit 的源码哈希；上游推进、网络验证失败或源码不匹配均非零退出。

`licenses/viewer-upstream.json` 是本次 viewer 的权威版本记录；旧 `afilmory-files.json` 保留初次引入其他库的来源。同步工具不会自动更新 manifest 或覆盖本地源文件。未来升级应先读 diff、验证核心是否变化、保留必要容错、运行测试，再显式更新哈希/commit 与文档；不要用重新生成哈希掩盖未审阅差异。

## 验证

| 命令 | 结果 |
| --- | --- |
| `pnpm check` | 通过（TypeScript） |
| `pnpm test:viewer` | 21/21 通过，包含原有 5 项颜色/HDR 回归 |
| `pnpm test:website` | 28/28 通过 |
| `pnpm build` | 通过，4 个页面 |
| `pnpm check:upstream` | 通过，16 个源文件 |
| `pnpm check:upstream --upstream-dir /private/tmp/jason-afilmory-upstream` | 通过，独立 checkout 与固定 commit/参考文件一致 |
| `pnpm check:upstream --remote` | 通过，main 未推进，固定 commit 的远程哈希一致 |
| `git diff --check` | 通过 |

测试覆盖：GPU/原图色彩与 HDR、真实 HEIC/TIFF 解码、首帧等待、LRU 使用期、取消、错误与失败缓存重试、真实 WebGPU device.destroy 后切至 WebGL 再 context loss 切至 native，以及网站桌面/移动端/多来源交互。Blob URL 不具备文件名，原有网站断言升级为检查 originalUrl 外链及实际图片字节，而不是要求 img.src 等于网络 URL。HDR 替换数据测试使用新页面清除内存缓存，避免错误地把命中旧内容当成重新下载。

浏览器 GPU 测试使用 Chromium 151.0.7922.34 / SwiftShader；不等同于实体 HDR 显示器认证。构建报告 HEIC 动态 chunk 超过 500KB 的体积提示，非错误；普通格式浏览不会请求它。初次运行遇到测试服务器沙箱权限限制，随后在获准的本地执行环境中完成全部浏览器验证。

## 修改文件

| 文件 | 用途 |
| --- | --- |
| `src/lib/image-loader-manager.ts` | XHR、magic 检测、取消、缓存、Blob 使用期及重试失效 |
| `src/lib/image-convert/index.ts`、`pipeline.ts` | HEIC/TIFF 转换、并发队列、任务复用 |
| `src/components/viewer/useImageLoader.ts` | 每张图片的加载生命周期 |
| `src/components/viewer/image-viewer-config.ts` | 上游有效配置显式化 |
| `src/components/viewer/PhotoViewer.tsx` | Blob 输入、缩略图交接、保留 native/原图外链与重试 |
| `packages/afilmory/webgl-viewer/src/ImageViewer.tsx` | 保留 context-loss 容错，增加首帧完成交接与重新加载通知 |
| `scripts/upstream/check-viewer.ts`、`licenses/viewer-upstream.json` | 固定版本、离线/checkout/远程差异检测 |
| `patches/afilmory-viewer-lifecycle.patch` | 完整包装层差异的可审阅补丁 |
| `package.json`、`pnpm-lock.yaml` | 3 个精确版本依赖、同步检测与 viewer 测试入口 |
| `tests/viewer/{loader-unit,loading,upstream}.test.ts` | 生命周期、格式、画质、设备丢失、同步检测回归 |
| `tests/viewer/loader.{html,tsx}`、`fixtures/`、`prepare.ts`、`vite.config.ts` | 使用真实 PhotoMedia 的浏览器测试及合成特殊格式素材 |
| `tests/viewer/bundle-audit.ts`、`check-bundle.ts` | 保留隔离扫描并精确识别 file-type 的未调用兼容分支 |
| `tests/website/{website,multi-source}.test.ts`、`viewer-assertions.ts` | 网站原图字节/身份断言适配 Blob；保留全部交互回归 |
| `README.md`、`licenses/README.md`、本文件 | 同步命令、来源、行为差异与验证记录 |

