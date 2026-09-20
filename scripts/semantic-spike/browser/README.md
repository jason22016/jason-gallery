# Phase 2A: browser text encoder

独立的 ONNX Runtime Web harness。所有网站页面、Actions 和 production build 保持不变。代码位于此目录；模型、依赖安装、浏览器产物和报告均位于 `.cache/semantic-spike/phase2a/`。复用 Phase 1 cache，**不修改**其 image/text embeddings、queries 或 annotations。

## 复现

前提：已完成 Phase 1，存在实验 venv、固定 SigLIP2 snapshot、`siglip2/results.json`、image/text `.npy` 和 `annotations.json`。使用 Phase 1 支持的 Python。自动浏览器测试复用项目已有 Playwright，需要本机安装 Google Chrome；手动 harness 可在其他浏览器打开，但实际支持应另测。

```bash
bash scripts/semantic-spike/browser/prepare.sh
node scripts/semantic-spike/browser/server.mjs
# 浏览器打开 http://127.0.0.1:8767
```

服务只绑定 loopback，并对可访问资源作路径限制；不会服务 Phase 1 完整 checkpoint、原图或仓库其他文件。需允许本机 loopback server 和浏览器进程/GPU 执行。服务器默认发送 COOP/COEP headers，使 WASM 可以使用多线程。该 header 策略只用于实验，未写入生产配置。

在另一终端依次运行，避免 CPU/GPU 争用：

```bash
export TMPDIR="$PWD/.cache/semantic-spike/tmp"
for variant in fp32 fp16 int8 int8wo; do
  for backend in webgpu wasm; do
    node scripts/semantic-spike/browser/run_browser.mjs "$variant" "$backend"
  done
done

# 推荐候选的正常 Chrome、单线程、网络限速和 fallback 分支
node scripts/semantic-spike/browser/run_browser.mjs int8wo webgpu int8wo-webgpu-stock
node scripts/semantic-spike/browser/run_browser.mjs int8wo wasm int8wo-wasm-single --single-thread
node scripts/semantic-spike/browser/run_browser.mjs int8wo webgpu int8wo-webgpu-100mbps --mbps 100
node scripts/semantic-spike/browser/run_browser.mjs int8wo auto int8wo-auto-fallback --simulate-no-webgpu

# 单独诊断 EP placement，不纳入热查询统计
node scripts/semantic-spike/browser/run_browser.mjs int8wo webgpu int8wo-profile --profile
.cache/semantic-spike/venv/bin/python -B scripts/semantic-spike/browser/evaluate.py
```

`--simulate-no-webgpu` 只模拟 capability probe 返回不可用，以覆盖自动 fallback 分支；后续模型真实使用浏览器 WASM 推理。**这不是实机移动端测试，也不是浏览器本身没有 WebGPU 的实测。** 普通 `wasm` 运行同样显式使用真实 WASM。`auto` 在 probe 不可用或 WebGPU session 创建失败后复用同一模型转向 WASM，并记录原因；显式 `webgpu` 模式会报出失败，避免静默将整次 CPU 运行标记为 GPU。

默认不启用 unsafe WebGPU。如需复现最初的探索性运行，可加 `--unsafe-webgpu`；推荐候选另有不带该 flag 的验证。每次启动独立 Chrome process/context，禁用 HTTP cache；结果记录 launch args、浏览器版本、adapter、EP 日志、资源请求与进程 RSS。默认 run label 为 `<variant>-<backend>`，重复运行会覆盖同名结果；比较不同实验时提供第三参数 label。

## 导出和格式

固定 `google/siglip2-base-patch16-224` revision `75de2d55ec2d0b4efc50b3e9ad70dba96a7b2fa2`。导出器在本机读取已有完整 snapshot，但仅导出 `model.text_model`。图中没有 vision tower，也没有下载完整 checkpoint 的浏览器代码路径。

- ONNX opset 17，静态 `int64 input_ids [1,64]` → FP32 `text_embeds [1,768]`。
- 保留原始 token/position embeddings、12 层 encoder、final layernorm、**最后一个位置（可能是 pad）的 pooling** 和训练好的 projection head。
- 不添加 attention mask，不换成 mean/EOS-index pooling，不翻译，不换文本模型。输出在浏览器做 L2 normalization，然后直接与 Phase 1 thumbnail image vectors 做 cosine search。
- tokenizer 使用固定 snapshot 的完整 `tokenizer.json` / `tokenizer_config.json`，通过 Transformers.js 同源的独立 `@huggingface/tokenizers` 运行；不需要整个 Transformers.js 模型装载层。保留原词表；未按测试 query 裁词表。
- 57 条 tokenizer fixtures：原 48 条双语 query，加 Unicode、空白、空串、special tokens 和超过长度上限的输入。逐条要求 token IDs 与原 PyTorch processor 完全一致。浏览器实际编码文本，fixtures 仅用于检查，不是 query 查表。

四种导出：

| Variant | 权重/计算 | 目的 |
|---|---|---|
| `fp32` | 全 text tower FP32 | 检查导出数值与 Phase 1 完整对齐 |
| `fp16` | FP16 内部权重/张量，FP32 输出 | 标准半精度候选；CPU runtime 可能内部扩展精度 |
| `int8` | ORT dynamic quantization；MatMul + Gather，per-channel linear weights | 标准 INT8 对照，激活也会动态量化 |
| `int8wo` | INT8 权重、FP32 激活/LayerNorm/head | 避免动态激活量化误差的候选 |

`int8wo` 的 token table 按 **每个 token row** 计算 `max(abs(weight))/127`，linear MatMul 权重按 **每个 output channel** 缩放，round-to-nearest 后 clip 到 [-127,127]。无校准数据、无训练。token table 先 Gather 所需行再 Cast/Mul 解量化；linear weights 使用标准 `DequantizeLinear`，原 projection head 保留 FP32。减少的是存储精度；embedding space 和 768 维投影语义保持原模型定义。实际对齐是否可接受仍由 benchmark 判断。

导出器会检查没有 vision initializer、输入输出契约、ONNX checker，生成每个模型的 byte size、SHA-256、operator histogram。完整 FP32 text tower 提取后先与 Phase 1 向量对比。已存在的导出文件会复用；若修改导出或量化逻辑，请删除 **phase2a/assets 下对应的 ONNX 文件**再重导，不要删除 Phase 1 cache。

## 计时、内存与质量

- cold：从 Worker 内 benchmark 开始，依次记录 runtime/data/tokenizer、模型 fetch、session 创建、首 query。它不包含 Chrome 启动和 Worker 初始静态 JS imports；每次均为新的页面/runtime，未测刷新后的持久缓存加载。
- 本地服务器不做压缩、禁用 HTTP cache。下载体积包含完整模型与 tokenizer；`transfers` 另记录 harness、runtime 和测试资源。localhost cold 是本机传输，不代表互联网下载体验；`--mbps` 明确做 CDP 限速并保留实测 model-fetch 时长，可核对它确实覆盖 Worker 请求。
- warm：3 次 warmup 后，48 条 query × 3 轮，记录 tokenizer + inference/readback + normalize + 154 张 exact cosine/ranking。仅 text embedding 段另有 latency。正常运行不启用 verbose profiling。
- WebGPU adapter 必须记录 vendor/architecture/fallback 属性。ORT 可以将部分算子放 CPU；`--profile` 的原生 runtime verbose log 给出 EP placement 和 GPU program 执行，不能把“请求 WebGPU”写成“所有计算都在 GPU”。
- Chrome RSS：每 500 ms 采样该 browser process tree 的 RSS，包含 browser/renderer/GPU/utility。共享页可能重复计数、采样可能漏过瞬时峰值，不能当成 GPU VRAM 或模型独占内存。Worker JS heap API 不可用时记 null，不填猜测值。
- 使用原 image embeddings、queries、annotations，hash 验证未变化。报告 query-vector cosine、Top-1 identity、Top-5/10 set overlap 和 exact order、按语言的 Hit@1/5/10、nDCG delta。原有正例 22/语言；无结果控制不进入质量分母。
- 标注仍是 Phase 1 的初步 AI 视觉标注，没有新增独立人工 ground truth。Top-K 一致性不等于相关性；量化后的质量结论仅覆盖当前样本。

## 产物与检查

- `.cache/semantic-spike/phase2a/PHASE2A_REPORT.md`：本次报告（手写，重跑后需复核）。
- `phase2a/metrics.md` / `summary.json`：自动汇总性能与质量。
- `phase2a/evaluation/<run>.json`：逐 query 对齐与排序变化。
- `phase2a/<run>.json`：原始浏览器测量、embedding、请求、memory samples。
- `phase2a/assets/manifest.json` / `provenance.json`：模型大小/hash、导出契约、Phase 1 输入 hash。
- `phase2a/environment-lock.txt` / `runtime/package-lock.json`：实测 Python/JS 环境。

```bash
node --test scripts/semantic-spike/browser/test_tokenize.mjs
.cache/semantic-spike/venv/bin/python -B scripts/semantic-spike/browser/evaluate.py
.cache/semantic-spike/venv/bin/python -B -m unittest discover -s scripts/semantic-spike -p 'test_*.py'
git check-ignore .cache/semantic-spike/phase2a/assets/manifest.json
```

浏览器 harness 在后台 Worker 运行，支持自由输入中英文 query。推荐格式/是否继续下一阶段应以 cache 中完整报告为准。未连接正式 Explore、生产构建或 Actions。

参考：[ORT WebGPU](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html)、[浏览器大模型限制](https://onnxruntime.ai/docs/tutorials/web/large-models.html)、[量化](https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html)、[FP16 转换](https://onnxruntime.ai/docs/performance/model-optimizations/float16.html)、[Tokenizers.js](https://github.com/huggingface/tokenizers.js)。
