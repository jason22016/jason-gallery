# Vocabulary and weight quantization follow-up

Standalone experimental code. Model files, vectors, compression artifacts, browser logs and reports go to ignored `.cache/semantic-spike/quantized/`. Existing Phase 1, Phase 2A and smaller-spike inputs remain unchanged. No production pages, Actions, site dependencies or build steps are modified.

## Scope and fixed inputs

Baseline is the existing 65536-vocabulary weight-only INT8 SigLIP2 text tower, with its original 768D image vectors. Reuse all 154 photos, original 48 queries, 18 previous expanded queries and existing AI qrels. `hard-queries.json` is frozen before inference: 12 harder semantic paraphrases reuse intent labels, and eight geography/equipment/rare-word diagnostics have no asserted qrels. The latter get actual Top-10 comparisons but do not contribute to Hit/nDCG. Arbitrary camera model or location metadata cannot be assumed to be retrievable from image content.

Vocabulary selection reuses the prior deterministic, query-independent Unicode/BPE policy for 64k/32k and applies it unchanged at 16k. It preserves all original allowed Han/ASCII single-character pieces, special tokens, byte fallback (255 byte tokens and literal tab), and merge closure, then apportions remaining capacity between Han compounds and ASCII/punctuation in original token-ID order. It covers inputs compositionally, not by injecting benchmark or hard-query tokens into the vocabulary. The policy is not a trained domain lexicon, and low UNK does not establish semantic coverage. Travel, equipment, urban scenes, nature, photography styles and relations are tested through frozen probes and hard queries. If small vocabularies fail, do not tune them to known benchmark words.

The initial decision thresholds are written to `decision-gates.json` before measurements: original zh/en nDCG losses <=.02, Hit@1 loss <=1/22, no Hit@5/10 loss; previous extension groups nDCG losses <=.03, no Hit@5/10 loss. These are practical small-sample screens, not a statistically powered noninferiority test. Inspect individual failures, hard queries and backend compatibility before selecting a candidate.

## Quantization contract

Use the already installed native ORT 1.23.2 quantizer and ORT Web 1.30.0 runtime, with ONNX 1.19.0. No custom kernel or patched runtime. Restore only the selected transformer linear weights from the original FP32 export before applying block-wise RTN quantization; never requantize the existing INT8 matrices to INT4. `MatMulNBits`, `com.microsoft` domain, bits=4, block size=32, accuracy_level=1 retains FP32 activation arithmetic. Symmetric INT4 and asymmetric UInt4 use the official packed-weight/packed-zero-point format. All 72 transformer linear matrices can be quantized; the optional MLP-only control changes 24. Attention activation×activation MatMul, LayerNorm, biases and the original projection head remain FP32.

Embedding INT8 retains the prior row-wise quantization and Gather-before-dequantize contract. Optional embedding INT4 restores selected original FP32 vocabulary rows and uses official `GatherBlockQuantized` along the feature axis, with block size 32. It upgrades the required standard ONNX opset for INT4 tensor types; keep the generated model/opset intact. Original tokenizer, compact row IDs, max length 64, EOS=1, pad=0, last-position pooling and no attention mask remain unchanged. No training or image re-encoding occurs.

`row-map.json` is offline provenance, not a client dependency: tokenizer IDs already index the compact table. Browser requests and byte accounting verify it is not downloaded. Model and tokenizer must be versioned together.

## Reproduce

Requires the completed previous experiment caches. Use the existing experiment venv and browser runtime:

```bash
.cache/semantic-spike/venv/bin/python -B scripts/semantic-spike/quantized/experiment.py prepare
.cache/semantic-spike/venv/bin/python -B scripts/semantic-spike/quantized/experiment.py export --name v64-int8 --size 64 --mode int8
.cache/semantic-spike/venv/bin/python -B scripts/semantic-spike/quantized/experiment.py export --name v64-int4 --size 64
.cache/semantic-spike/venv/bin/python -B scripts/semantic-spike/quantized/experiment.py export --name v32-int8 --size 32 --mode int8
.cache/semantic-spike/venv/bin/python -B scripts/semantic-spike/quantized/experiment.py export --name v32-int4 --size 32
.cache/semantic-spike/venv/bin/python -B scripts/semantic-spike/quantized/experiment.py export --name v16-int4 --size 16
# Optional controls, evaluated only after the required grid:
.cache/semantic-spike/venv/bin/python -B scripts/semantic-spike/quantized/experiment.py export --name v64-uint4 --uint4
.cache/semantic-spike/venv/bin/python -B scripts/semantic-spike/quantized/experiment.py export --name v64-int4-e4 --embedding4
.cache/semantic-spike/venv/bin/python -B scripts/semantic-spike/quantized/experiment.py export --name v64-uint4-e4 --uint4 --embedding4

for candidate in v64-int8 v64-int4 v32-int8 v32-int4 v16-int4; do
  .cache/semantic-spike/venv/bin/python -B scripts/semantic-spike/quantized/experiment.py native --name "$candidate"
done
node --test scripts/semantic-spike/quantized/test_tokenize.mjs
node scripts/semantic-spike/quantized/server.mjs
```

In a second terminal, after native inference/export/compression processes have stopped:

```bash
export TMPDIR="$PWD/.cache/semantic-spike/tmp"
for candidate in v64-int8 v64-int4 v32-int8 v32-int4 v16-int4; do
  for backend in webgpu wasm; do
    node scripts/semantic-spike/quantized/run_browser.mjs "$candidate" "$backend"
  done
done
.cache/semantic-spike/venv/bin/python -B scripts/semantic-spike/quantized/evaluate.py
.cache/semantic-spike/venv/bin/python -B scripts/semantic-spike/quantized/verify.py
```

Additional candidates use the same native/browser commands with their names. Optional runner arguments: `--single-thread`, `--mbps 100`, `--simulate-no-webgpu` with backend `auto`, `--profile`, `--brotli`. Supply a third positional run label to avoid overwriting earlier measurements. Profiling runs only one query and is excluded from quality/latency summaries. Normal runs use fresh stock Chrome, cache disabled, 3 warmups and 86×3 queries; tokenizer parity covers 105 fixtures. No unsafe GPU flag is needed.

The MLP-only control uses `--mode mlp4`. Embedding-INT4 block controls use `--embedding4 --block 16` (or 64 / 128); all affect Transformer and embedding block sizes together. Do not interpret those as isolated embedding block ablations. Default is block 32. Failed embedding INT4 browser WASM session creation is recorded, rather than substituted with native ORT timing.

For lossless HTTP transfer compression, run `node scripts/semantic-spike/quantized/compress.mjs <candidate> [<baseline>]`, then use a fresh labeled browser run with `--brotli`. The local server serves precompressed assets with standard `Content-Encoding: br`; ORT sees identical decoded model bytes. `compression.json` lists raw and compressed lengths/hashes. Model+tokenizer transfer and all-request transfer are reported separately. This modifies only the experimental loopback server.

Run `node scripts/semantic-spike/quantized/verify_compression.mjs` for exact decompression hashes. To test without isolation headers, stop the experimental server and restart with `SPIKE_NO_ISOLATION=1 node scripts/semantic-spike/quantized/server.mjs`, then run `v64-uint4 auto v64-uint4-auto-no-isolation --brotli --simulate-no-webgpu`. This genuinely removes COOP/COEP and verifies `crossOriginIsolated === false`; the adapter-unavailable condition is injected explicitly, not represented as a real unsupported device. The worker chooses one WASM thread automatically.

## Interpretation and artifacts

`QUANTIZATION_REPORT.md` contains the final recommendation. `summary.json` / `metrics.md` report actual file bytes, network transfer, latency, cold load, sampled Chrome process-tree RSS and language-specific relevance deltas. `native-evaluation.json` retains native screening results; `evaluation/` retains verified browser ranks. `review.html` contains every query's Top-5/10, with gray unlabelled diagnostic results. Independent human review is not implied by AI visual inspection.

The same Phase 2A caveats apply: localhost cold is not internet loading; warm latency is desktop-specific; COOP/COEP enables four-thread WASM; single-thread desktop WASM is not a phone measurement; RSS is not model-only memory or VRAM. WebGPU can assign some operators to CPU; use EP profiling rather than assuming all execution is GPU. No persistent caching or production deployment changes are part of this experiment.

Sources: [ORT INT4/UInt4 quantization](https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html), [WebGPU operator support](https://github.com/microsoft/onnxruntime/blob/main/js/web/docs/webgpu-operators.md), [MatMulNBits implementation](https://github.com/microsoft/onnxruntime/blob/main/js/web/lib/wasm/jsep/webgpu/ops/matmulnbits.ts). Installed runtime source is also inspected; actual browser success remains the compatibility evidence.
