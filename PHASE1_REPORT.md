# Phase 1 — Photo Engine Bootstrap & Smoke Test

**最终结果：Phase 1 正式通过（包含真实图库 Final Gate）。** 2026-09-09，Node 24.19.0 / pnpm 11.19.0。唯一架构基准仍为 `ARCHITECTURE.md`。

## 实现

- Astro 7.3.2 + React 19.2.7 + TypeScript 6.0.3 strict workspace；只提供 `/health.txt` 构建探针，无首页或正式 UI。
- 提取锁定 Afilmory commit `a3db486b0a8f2572de3032eabdfce24e726e83f3` 的 builder、typing、utils、renderer（包名 og-renderer）、webgl-viewer。未引入完整应用。来源、逐文件哈希、许可与补丁见 `licenses/`、`patches/`。
- CLI 在加载 Builder 前设置绝对 workdir；使用上游并发工作池（并发 2）及 ExifTool。原生 GitHub provider 固定照片 commit、扫描 `images/`，照片列表排除 `.afilmory` 与非图片。
- `digestSuffixLength: 8`；旧 basename 缩略图仅在映射唯一且来源条件满足时预填。缩略图缺失、损坏或源版本失效时由 Builder 生成，不写回照片仓库。
- 缓存记录原图/远端缩略图 blob SHA、Builder/配置摘要及本地缩略图摘要。冷缓存采用同路径最后修改 commit 的保守匹配；原图更新而缩略图未更新时不会重新引入旧远端缩略图。
- 每次重建 metadata 与原生 **v10** Manifest，保持 schema 和 URL 字段；完整性检查通过后才导出结果。提供独立的只读 Photo Index 与浏览器入口。

## 验收结果

`pnpm test`：**全部通过**（strict、独立 Engine smoke、Viewer bundle/worker 隔离检查、Astro build）。

| 验收项 | 实际结果 |
| --- | --- |
| 普通 JPEG | 原生尺寸、metadata、ThumbHash、`isHDR: false` 正常 |
| 已有缩略图 | 复用远端测试缩略图，字节摘要完全一致；warm cache 复用本地文件 |
| 缺失/损坏缩略图 | 缺失、远端损坏、本地损坏均自动生成或恢复 |
| 重复 basename / ID | 不同目录同名照片有不同原生 ID；实际 8 位 SHA 前缀碰撞使构建失败 |
| 原图更新 | 缩略图摘要和宽度更新；清空缓存后仍拒绝旧远端缩略图；所有 URL 使用新 commit |
| HDR / gain-map JPEG | 自建双 JPEG + XMP fixture；主图/gain map 均可解码且比例一致，原生 `isHDR: true` |
| 无照片仓库写入 | fixture 源文件哈希不变；所有审计请求为 GET；上传/移动/删除接口禁用 |
| 失败保护 | ID 碰撞与坏原图均失败，之前成功的 Manifest 保持不变 |

## 真实图库 Final Gate（2026-09-09）

对真实 `jason22016/jason-photos` 完成了两次**无过滤的全量构建**。输入与结束时远端 main 均为 `6a7ae47d75dd71bc6874e8d3f222f25b2c05e27f`。每次均重新完整解码全部原图、运行原生 Builder 和完整性检查；没有跳过任何失败照片。

| 指标 | 冷缓存全量 | 已有缓存全量重跑 |
| --- | --- | --- |
| 原始 listing | 214：154 原图 + 59 远端缩略图 + 1 `.gitkeep` | 相同 |
| 有效原图 / Manifest / 缩略图 | **154 / 154 / 154** | **154 / 154 / 154** |
| 缩略图 | 95 缺失生成 + 59 来源未核实而重建 | **154 张有效本地缩略图复用** |
| 处理 / 跳过 / 失败 / ID 冲突 | 154 / 0 / 0 / 0 | 154 / 0 / 0 / 0 |
| HTTP 审计 | 430 次 GET，全部 200（276 API + 154 raw） | 4 次 GET，全部 200 |
| 重试 / 引擎警告 | 0 / 0 | 0 / 0 |
| 总耗时（含启动/导出） | 314.37 秒 | 44.14 秒 |
| 进程 maximum RSS | 786,792,448 字节 | 993,001,472 字节 |

59 张旧远端缩略图的路径最后修改 commit 均与对应原图不同，按既有架构的保守来源条件重建；**本次没有声称复用了这 59 张远端旧文件**。有效缩略图复用由第二次真实全量构建证明：154 张本地缩略图的字节 SHA-256 逐张与第一次一致。远端缩略图字节复用路径仍由原有 smoke fixture 验证。

独立 `photos:verify` 脚本逐项核对完整扫描 key 集合、原生 v10 顶层结构、唯一 ID、原图 Git blob SHA/字节数、metadata/ThumbHash、固定 commit URL、全部缩略图完整解码，以及 workdir、output、本站导出的一致性。最终 Astro `dist/thumbnails/` 也有相同的 154 个文件，全部 SHA-256 一致。

- 全量原图：**1,964,370,036 字节**；缩略图：**34,470,447 字节**；最终 Manifest：**587,526 字节**。
- 原生 `isHDR: true` 数量为 0；文件名含 HDR 不等同于含 gain map。先前合成 gain-map smoke 和浏览器 HDR 验证继续通过。
- 最终 Manifest SHA-256：`c342c50d25c39f301d4a9c00a1b8824ba706717ab6bb5946f25bd5425e3187d6`。两次 Manifest 的上游 listing `lastModified` 时间不同，因此不要求 Manifest 字节相同；照片集合、源字节和缩略图字节均已核对。
- 机器核验摘要及全部缩略图摘要提交在 `reports/phase1-final-gate.json`。原图、Manifest、缩略图与详细运行日志为可重建本地产物，不提交 Git。

### 遇到的问题及修复

首次无认证全量尝试在来源历史查询阶段遇到 **GitHub 403**，10.90 秒后失败，尚未处理原图、未写出 Manifest。随后读取匿名限额确认 **60/60 已使用，remaining=0**；这次尝试共 52 次只读请求，额度还包含此前其他匿名请求。

修复后增加显式 `--git-credential`，可在用户授权下复用已有 GitHub 认证；凭据仅存进程内。也可继续使用专用 `JASON_PHOTOS_READ_TOKEN`。上传、删除、移动及非 GET/HEAD 请求仍被禁止。补充了 60 秒请求超时、最多三次瞬时失败重试、状态/限额审计及相关测试；403 不无限重试。两个成功全量运行没有再发生 API/网络错误，最低 API 剩余额度分别为 4722 / 4718。

同时增加原图完整解码、逐张处理结果检查、metadata 完整性检查、源 listing 留档及独立全量核验，未放宽任何失败保护。源码库和 schema 未修改。最终 `pnpm test`（strict、含网络故障/只读用例的 smoke、Viewer bundle/worker 隔离检查、Astro build）全部通过。

磁盘开始约余 61 GiB，完成约余 59 GiB；Photo Engine 缓存目录约 2.0 GiB。未发生空间不足、缓存损坏、I/O 错误或 swap；完整原图缓存和三处缩略图输出均通过摘要核验。

浏览器实测：Codex 内置 **Chromium 152 / macOS**，`dynamic-range: high` 为 true。

| 浏览器路径 | 实际结果 |
| --- | --- |
| 独立导入及生产 bundle | 成功；WebGPU worker 单独输出并正常执行；未包含 Builder/ExifTool/Node 文件接口 |
| gain-map + WebGPU | `loaded: true`、`renderer: webgpu`、`onHDRChange(true)` |
| 注入 WebGPU 初始化失败 | 回退 WebGL 并加载成功，HDR 回调为 false；生产 bundle 同样通过 |
| GPU 全部不可用 | 测试外壳收到 `WebGL not supported`，普通 `<img>` 加载成功 |
| GitHub 原图 CORS | `DSC_0129.jpg` 匿名 fetch 200、响应类型 cors、11,600,230 字节，Canvas 像素可读，Viewer 加载成功 |

HDR 结果验证的是浏览器渲染路径和回调，未使用仪器测量屏幕亮度/色彩。普通图片回退代码只在独立测试外壳中，未开发正式 Viewer UI。

## 复现与产物

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm photos --git-credential --export
pnpm photos:verify --run .cache/photo-engine/<本次-run-目录> --exported
pnpm viewer:dev
```

浏览器打开 `http://127.0.0.1:4322/?mode=auto`，再分别使用 `mode=webgpu-failure`、`mode=no-gpu`；`src` 参数可指向固定 commit 的 GitHub 原图。`pnpm test` 自动验证浏览器打包；上述设备能力验证需浏览器单独运行。

- 自动验收记录：`.cache/smoke/report.json`；各轮日志和源 fixture 位于 `.cache/smoke/`。
- 最终全量 Manifest：`src/data/photos-manifest.json` 与 `.cache/photo-engine/output/photos-manifest.json`；每次 `run-*/requests.json` 记录只读网络请求。
- 全量冷/热运行目录：`.cache/photo-engine/run-lRgQDu/`、`run-vVqNTz/`；原始日志在 `.cache/final-gate/`。
- 全量执行：`pnpm photos --export`，仅导出本站 `src/data/photos-manifest.json` 与 `public/thumbnails/`。过滤样本禁止 `--export`。不涉及部署。

## 已知限制 / Phase 2 前事项

1. 真实全量构建与资源验收已完成。新环境建议配置仓库专用只读 `JASON_PHOTOS_READ_TOKEN`；显式 `--git-credential` 是复用既有认证的替代方式，程序仍只执行读取。不得在日志/静态产物中保存 token。
2. 旧远端缩略图没有源摘要，保守匹配可能重建原本可用的缩略图。后续可增加独立来源记录；不修改原生 Manifest schema。
3. 暂不优化 metadata 增量；不支持并发构建写同一缓存目录。cluster 模式、缓存清理及原子目录发布尚未验证，正式发布前处理。
4. HDR 使用自建 fixture 验证；更多真实相机、ISO/MPF gain-map、Safari/Firefox 与设备兼容性仍需扩展测试。
5. Phase 2 再实现 Project schema（含可选 `location`）及引用校验。尚无 Project 数据、正式 Viewer wrapper 或页面，因此本次不声称它们通过验收。
