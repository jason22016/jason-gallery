# Semantic Search Phase 2B

日期：2026-09-21（Asia/Hong_Kong）

## 结果

Phase 2B 已把 SigLIP2 image embedding 从 spike 提升为正式构建阶段：

```text
verified photo artifact
  → export existing Photo Sync thumbnails
  → resolve Public Global Photo Collection from published Projects
  → content-addressed incremental CPU embeddings
  → verified public semantic index
  → normal Astro build/release verification
```

没有新增照片事实源。公开 membership 仍唯一来自 `loadPublicPhotoCollection()`；image input 唯一来自 `public/thumbnails/*.jpg`，不会请求原图。Explore UI 和浏览器 text model bundle 都未接入。

## 固定模型与版本契约

正式契约位于 `scripts/semantic/model.json`，并在 Node orchestration、Python encoder、public index 和 release verifier 四处校验：

- image model：`google/siglip2-base-patch16-224`
- revision：`75de2d55ec2d0b4efc50b3e9ad70dba96a7b2fa2`
- preprocessing：`siglip2-thumbnail-official-v1`，固定 checkpoint 的官方 `SiglipImageProcessor`（Pillow EXIF transpose、RGB、224×224 bilinear、1/255、mean/std 0.5）
- embedding：768D、Float32 little-endian、L2 normalized、schema v1
- client release：`siglip2-base-v64k-uint4-b32-r1`
- 64k tokenizer SHA-256：`5a52aa9696e48ec6fd9efb7182a1f7f5da5b683354d30be70b7690102a844811`
- UInt4 ONNX SHA-256：`f53300d16d35648582bec83452e8f49272158556268b2dac369ca73037e466a8`
- client release contract SHA-256：`f8c900f897db83c47083ccfccd3e4cec2913b0b0072c6977082dc78871f5b5a6`
- semantic model contract SHA-256：`8084ea0fd9642e2d18dfe5832c0467be77c2b4d3c27f31e9ba7542aa6fe97390`

ONNX 与 tokenizer 被同一个 release contract 绑定并标为 indivisible；改变任一 hash 都会改变 release contract，旧 index 会 fail fast。Phase 2B 只公开这些对齐 metadata，不复制 ONNX/tokenizer 文件到网站。

## Cache key 与 invalidation

每个 cache entry 的 identity 是以下字段的 canonical hash：

1. thumbnail 内容 SHA-256；
2. image model ID；
3. image model revision；
4. preprocessing version；
5. embedding schema version。

cache 文件保存在 ignored 的 `.cache/semantic/embeddings/<prefix>/<key>.{json,f32}`。每次读取都会复核 identity、vector SHA-256、字节长度、dimension、finite 和 unit norm。相同 thumbnail 内容可跨 photo membership 复用同一个 cache entry。

因此只有新 thumbnail、thumbnail 字节变化，或 model/preprocessing/embedding schema 变化会重新推理。Project、caption、tags、排序和 published/draft membership 不进入 key；这些变化只重新组装公开 index。一个 photo 同时属于多个 published Projects 时，Public Global Photo Collection 先按 photo identity 去重，index 只有一行。

## Public semantic index

正式输出只有：

- `public/semantic/index.json`
- `public/semantic/vectors.f32`

`index.json` 保存公开 photo ID、确定性 bytewise 升序、模型/客户端 release 契约、vector 文件的 dtype/dimension/normalization/count/bytes/SHA-256 和 index version。`vectors.f32` 按同一顺序保存 row-major 768D Float32 LE。

当前真实集合：154 张公开照片。文件大小：index JSON 5,496 bytes，vectors 473,088 bytes，总计 478,584 bytes。index version 为 `e771594e842fe295759ae028862c18348d9adb50895d51efae19dfed14d1f64a`。

公开 schema 是 exact allowlist，不包含 draft-only photo ID、qualified/internal photo ID、Project/caption/tags、Manifest、source/storage URL、EXIF 或 thumbnail/content hash。photo content hash 只出现在 ignored cache metadata。release allowlist 也只接受上述两个 semantic 文件，客户端模型文件不能被顺带发布。

## CPU 性能与数值对齐

本地正式命令使用 Apple M1 Pro、4 CPU threads、batch 8；固定 checkpoint 已在本地缓存，因此以下数据不包含首次 1.5 GB checkpoint 下载：

| 场景 | computed / hit | wall time |
|---|---:|---:|
| 首次 154 张全量正式 cache | 154 / 0 | 16.190 s |
| 仅一项 miss、其余 153 项 hit | 1 / 153 | 7.662 s |
| 第二次无变化 | 0 / 154 | 0.129 s |

首次 Python backend 内部记录：model load 0.439 s，batched inference 8.045 s，backend total 15.242 s；其余 wall time 包含 thumbnail hashing、cache sealing、index write/verification。增量测试确认新增或改变一张只计算一个 unique content。

单项真实增量在隔离复制的正式 cache 上测量，checkpoint 已缓存且不含网络下载：model load 0.411 s、单图 inference 0.151 s、backend total 6.900 s。固定 checkpoint 文件摘要复核和 Python/runtime 启动占该路径的大部分时间；即使如此，新照片增量仍只执行一次 image forward，而不是重算其余 153 张。

与 Phase 1/2A 沿用的 154 张 MPS image vectors 按 public photo ID 对齐后，CPU 正式 vectors 的 cosine 最低 `0.99999976`、平均值在 Float32 显示为 `1.0`，最大逐元素差 `2.80e-6`，保持同一 768D shared space。

## GitHub Actions / production

Automation 新顺序为：

```text
pnpm automation photos
  → pnpm automation semantic
  → pnpm automation build
```

Actions 使用 Python 3.12 和 pinned CPU-only Torch/Transformers runtime，显式设置 `SEMANTIC_DEVICE=cpu`。两个独立 cache 分别保存固定 SigLIP2 checkpoint 与 content-addressed embeddings；embedding cache key 同时按 image-side contract、photo snapshot 和 website commit 分代，并用较宽 restore prefix 增量继承旧内容。sync mode 也会生成/验证 index 并预热 cache；publish 的 release build 再以全 cache-hit 路径复核相同 index。

本地和 CI 共用 `pnpm semantic:build`；正常 `pnpm build` 先执行它再运行 Astro。release provenance 升级到 schema v3，记录 semantic model contract 与 index version，部署前后 verification 都会复核公开 vector 文件。

## Promotion / cleanup

正式需要的代码已提升到 `scripts/semantic/`：

- frozen model/client config；
- official image preprocessing encoder；
- CPU embedding backend；
- content-addressed cache；
- binary index schema/verifier；
- canonical version/hash helpers；
- shared CLI 和 pinned Python requirements。

`scripts/semantic-spike/` 的 Phase 1 / 2A / 2A.5 / 2A.6 benchmark、browser harness、量化和模型比较代码原样保留作 regression；production workflow 不引用它。`.cache/semantic-spike/` 继续 ignored。

## 测试

新增 semantic tests 覆盖：首次全量、第二次全 hit、新增单项、thumbnail 单项 invalidation、Project/caption 不失效、published/draft membership、shared photo dedup、768D/finite/unit norm、确定性 ID/vector ordering、model/index mismatch fail-fast、public privacy exact schema、以及 Actions CPU-only command/cache/order。

Release integration tests 使用可注入的 deterministic CPU fake backend，验证 draft 不进入 index、Project-only release 不触发 image recompute、release tamper detection 与原有 deployment transaction。真实 154 张图另用正式 Python backend 完成全量和 warm build。

最终结果：

- `pnpm --config.verify-deps-before-run=false check`：通过；
- Projects 48、Semantic 3、Statistics 68、Viewer 66、Website 156、SEO 4、Automation 25、Admin 101，共 471 项通过，无跳过；
- real metadata audit 1 项通过，Photo Sync transport/smoke 全部通过；
- pinned Python runtime/model contract 自检通过；
- production `pnpm --config.verify-deps-before-run=false build`：通过，semantic 154/154 cache hit，Astro 输出 161 个页面；
- `pnpm --config.verify-deps-before-run=false semantic:verify`：通过；
- 最终 `dist/semantic/` 只有 `index.json` 和 `vectors.f32`，整个 `dist/` 不含 ONNX、tokenizer 或 safetensors。

## Phase 3 前仍需解决

- 决定约 100.65 MB Brotli client release 的显式加载 UX、持久缓存、断点/失败恢复和版本切换策略；
- 在 Safari、Firefox、Windows 和真实 Android/iOS 设备复核 WebGPU/WASM、内存和下载行为；
- 完成独立人工 relevance review，扩展未见 query/photo holdout，并校准 no-result threshold；
- 设计 Explore 的 Worker 生命周期、query cancellation、index/model integrity check 和 accessibility；
- 为 ONNX/tokenizer 配置生产 Brotli headers、immutable caching、range/回退策略，但仍把两者作为不可拆分 release；
- 明确 Phase 3 index compatibility/migration 与旧客户端的 fail-closed UX；
- 当前 UInt4 候选已有已知中文 Top-1 小幅退化；若质量门槛改变，应发布新的完整 client release，而不是单独替换 tokenizer 或 ONNX。
