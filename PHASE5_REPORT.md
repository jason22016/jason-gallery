# Phase 5 — HDR / Color

2026-09-10。完成链路核对、必要修复和回归；**实体 HDR 屏幕的亮度、色准与观感仍未验收**。保持现有 UI、Project System、原生 Manifest v10 和锁定 Afilmory commit；未修改照片仓库、创建正式 Project、部署或开展 Phase 6/7。

## 支持范围与链路

- **原图 → Engine**：GitHub 固定快照 `6a7ae47d75dd71bc6874e8d3f222f25b2c05e27f`；原图缓存按 Git blob SHA 校验。JPEG 原始字节进入现有 EXIF/gain-map 检测，缩略图独立生成。`originalUrl` 仍指向原始文件，无 Astro 图片优化、代理转码、`srcset` 替换或缩略图冒充原图。
- **Engine → Manifest → Viewer**：原生 `isHDR` 来自 `MPImageType=Gain Map Image`、ISO URN 或有效 ContainerDirectory GainMap 标记，表示源标记，**不保证 gain map 完整可解码**。UI 只读传递该字段与原图 URL；GPU worker 再独立解析实际响应字节。
- **运行状态**：只有解析成功、WebGPU extended canvas 成功、`dynamic-range: high` 且照片加载完成才显示 `HDR active`。其余已标记照片为 `HDR source`。WebGPU 不可用/失败 → WebGL；GPU 全失败 → 原图 `<img>`。普通图片可能被浏览器原生以 HDR 显示，但本站无法证实其状态，不标 active。

| 格式 / 环境 | 当前范围与限制 |
| --- | --- |
| JPEG SDR 主图 + Adobe XMP gain-map 辅图 | 已验证现有串接 JPEG fixture；解析器也可经 MPF 定位辅图。XMP 需有可解析的 gain 参数；不是所有品牌的“HDR JPEG”均保证兼容。 |
| JPEG + ISO 21496-1 / MPF | 新增独立、可解码的 v0 / 单通道 / 共用分母 fixture，完整 Engine 与 Viewer 路径通过。解析器还有三通道、独立分母分支，本次未验证其真实样本。 |
| ICC / P3 | SDR 交给浏览器解码及色彩管理；WebGPU 上传至 Display-P3，HDR 重建前线性化，重建后编码。HDR 主图的 ICC 保留，RGB matrix profile 用于 gain 空间变换；gain 数据移除色彩/EXIF 标记避免作为照片再次校色。无 RGB matrix 的 HDR ICC、HDR base rendition、非法参数不受支持，会退出 gain 重建。 |
| WebGPU HDR 输出 | 需要浏览器/GPU 支持 `rgba16float`、Display-P3、extended tone mapping，以及高动态范围能力；HTTPS 或 localhost、原图匿名 CORS 可读。extended 配置失败时仍可用 WebGPU SDR。当前使用上游完整 gain 重建及浏览器输出映射，没有新增屏幕 headroom 自适应算法。 |
| WebGL / 普通图片 / 缩略图 | WebGL 是 SDR 路径，可有正常的广色域收缩；普通图片由浏览器管理。Sharp 生成 8-bit sRGB JPEG 缩略图，完成转换后不保留 ICC/gain map；HDR 原图与 SDR 缩略图亮度不必相同。 |
| HEIC/HEIF、AVIF PQ/HLG、JPEG XL 等 | 本阶段不承诺 HDR 重建支持。Viewer 的专用 gain 重建入口仅处理 JPEG；HEIC/HEIF 的 Engine 派生预处理也不等于浏览器支持其原图。其他格式取决于现有 Engine/浏览器解码能力，未新增转码器或支持声明。 |

输出配置与输入色彩空间依据 [WebGPU 规范](https://www.w3.org/TR/2026/CRD-webgpu-20260812/) 核对；扩展输出能力不等于屏幕测量结果。

## 实际修复

**已加载的 WebGL 上下文丢失后留下空画布**：用真实 `WEBGL_lose_context` 复现，上游的加载 Promise 已完成，故没有错误回调，wrapper 无法回退。现在 `ImageViewer.tsx` 将 `webglcontextlost` 接入已有失败路径，销毁时移除监听；正式网站会回到普通原图，清除 active 状态并可继续切图。

这是锁定 `a3db486b0a8f2572de3032eabdfce24e726e83f3` 上的本地六行生命周期补丁；来源与 SHA-256 更新见 `licenses/README.md`、`licenses/afilmory-files.json`，完整补丁为 `patches/afilmory-hdr-color.patch`。未修改检测、shader、色彩转换、ID 或 schema。

## 验证结果

| 层次 | 证据与结论 |
| --- | --- |
| 真实源数据 | 154 张、1,964,370,036 字节逐张 Git blob 校验通过；全部为带同一份 `sRGB IEC61966-2.1` ICC 的 JPEG，Manifest HDR 和解析到 gain map 均为 **0**。154 个现有缩略图摘要匹配缓存；没有合适的真实 HDR 样本。 |
| 真实加载 | Chrome 152 对 `DSC_0129.jpg`、`result_final_01.jpg` 的固定 commit 原图匿名 CORS 200、Canvas 可读；响应分别为 11,600,230 / 9,581,607 字节，SHA-256 与本地原图一致。WebGPU、WebGL、普通图片均加载成功；有 HDR 能力的环境中这两张 SDR 仍不标 active。 |
| 格式 / Engine | 7 张隔离 fixture 通过原生 CLI；XMP、P3 gain-map、ISO/MPF 检测为 HDR，普通/ICC SDR 为 false。损坏辅图仍可能有源标记，但 Viewer 不启用 HDR。检查源字节不变、原生 URL/schema、主图 ICC 保留、缩略图 SDR 解码与颜色。 |
| 自动 GPU / 网站 | Chromium 151.0.7922.34 + SwiftShader 使用真实 worker、GPU API 和 shader。验证 SDR 与 HDR 重建像素差异；仅高动态范围媒体条件被模拟，不能当作设备验收。包括能力变化、extended 配置拒绝、WebGPU 故障、GPU 全失败、WebGL 加载后丢失、坏 gain map、切图清除状态。 |
| SDR 色彩 | 6 组控制样本含 ICC sRGB、超出 sRGB 的 P3 色块、HDR 的 SDR 主图及对应 Engine 缩略图；三条路径固定 sRGB 截图的中心色块差异最多 1/255（回归容差 3/255）。真实蓝天照片固定 sRGB 对照，WebGPU / WebGL 对普通图平均通道差为 1.88 / 2.05（满量程 255，包含缩放/锐度差异）；截图目视未见明显整体偏色。 |
| 原生设备路径 | 本机 Chrome 152、未模拟的 `dynamic-range: high=true` / P3 环境，XMP、P3 gain-map、ISO/MPF 均走 WebGPU 并回调 HDR=true；真实浮点纹理蓝通道约 1.052 / 1.070 / 1.052，证明有扩展输出。三种 SDR 控制样本的 P3 输出与普通图片解码每通道差 <0.005；坏辅图不启用 HDR。可复现脚本为 `native-check.ts`，这些均不等于屏幕亮度测量。 |

**截图与屏幕边界**：原生 HDR 桌面、未固定色彩空间时，真实 SDR 蓝天的 WebGPU 截图曾偏青（平均通道差约 9.03/255）。进一步检查发现控制色块的实际 WebGPU P3 输出与普通图片 P3 解码浮点值一致，固定 sRGB 后差异消退。这使截图/显示合成路径成为待核查因素，尚不足以认定网站色彩算法错误，因此没有加入补偿转换。原生 HDR 桌面上的实体观感、系统合成与截图转换的最终归因仍需现场复核；不能用这些截图替代屏幕验收。

完整 **`pnpm test` 退出码 0**：TypeScript strict；Project **46/46**；既有网络/Photo Engine smoke；Viewer bundle/worker 隔离及新增 Color **5/5**；Website **27/27**（23 浏览器 + 4 metadata）；正式 Astro 生产构建通过，0 published / 0 draft。保留已有大 chunk 构建提示，未开展性能拆包。`git diff --check` 通过。

Website 测试前后正式 Project、Manifest、缩略图逐文件摘要一致。真实 Manifest SHA-256 仍为 `c342c50d25c39f301d4a9c00a1b8824ba706717ab6bb5946f25bd5425e3187d6`。

## 未验证项与复现

未验证实体 HDR 屏幕亮度/色准、Safari/Firefox、实体手机、真实相机 gain-map 多样性、复杂 ICC/LUT 及全部 ISO 参数组合。已有真实 SDR 照片仅两张作浏览器抽查，不是全图库逐张视觉验收。格式检测通过、渲染路径通过、实体屏幕验收是三个独立结论。

```sh
# Node 24.19.0 / pnpm 11.19.0；测试使用已有 Playwright Chromium
pnpm test
pnpm test:viewer
pnpm test:website
node --import tsx tests/viewer/audit-real.ts   # 只读核对既有真实缓存，不下载/导出
node --import tsx tests/viewer/native-check.ts # 在 test:viewer 后运行；需已安装本机 Chrome
```

本机证据：`.cache/phase5-full-test.log`、`.cache/phase5-source-audit.json`、`.cache/color-test/{engine.log,sdr-pixels.json}`、`.cache/phase5-native-check.json`、`.cache/phase5-real-browser.json`、`.cache/phase5-srgb-capture-browser.json` 和 `phase5-real-*` / `phase5-srgb-capture-*` 截图。真实网络抽查与截图诊断脚本保留于 `.cache/phase5-real.mjs` 等本机文件；可重复的格式/色彩回归和只读源审计脚本在 `tests/viewer/`。所有 fixture 与临时选集均未进入正式内容。
