# Smaller multilingual browser text encoders

Independent follow-up to Phase 2A. All outputs, model files, reports and additional dependencies stay in ignored `.cache/semantic-spike/`. No Explore, Actions, production build, branch or publishing changes.

## Reproduce

Requires completed Phase 1 and Phase 2A caches and their existing Python venv / browser runtime. Model downloads require network access; Chrome and the loopback server require local process/network permissions. Install only inside the experimental venv:

```bash
.cache/semantic-spike/venv/bin/pip install --cache-dir .cache/semantic-spike/pip-cache -r scripts/semantic-spike/smaller/requirements.txt
.cache/semantic-spike/venv/bin/python -B scripts/semantic-spike/smaller/download.py
.cache/semantic-spike/venv/bin/python -B scripts/semantic-spike/smaller/experiment.py freeze
.cache/semantic-spike/venv/bin/python -B scripts/semantic-spike/smaller/experiment.py trim
.cache/semantic-spike/venv/bin/python -B scripts/semantic-spike/smaller/experiment.py siglip
.cache/semantic-spike/venv/bin/python -B scripts/semantic-spike/smaller/experiment.py multiclip
.cache/semantic-spike/venv/bin/python -B scripts/semantic-spike/smaller/mobile.py
.cache/semantic-spike/venv/bin/python -B scripts/semantic-spike/smaller/manifest.py
node --test scripts/semantic-spike/smaller/test_tokenize.mjs
node scripts/semantic-spike/smaller/server.mjs
```

In a second terminal, run measurements sequentially with other inference jobs stopped:

```bash
export TMPDIR="$PWD/.cache/semantic-spike/tmp"
for candidate in baseline trim32k trim64k multiclip mobileclip2; do
  for backend in webgpu wasm; do
    node scripts/semantic-spike/smaller/run_browser.mjs "$candidate" "$backend"
  done
done
node scripts/semantic-spike/smaller/run_browser.mjs trim64k wasm trim64k-int8wo-wasm-single --single-thread
node scripts/semantic-spike/smaller/run_browser.mjs trim64k webgpu trim64k-int8wo-webgpu-100mbps --mbps 100
node scripts/semantic-spike/smaller/run_browser.mjs trim64k auto trim64k-int8wo-auto-fallback --simulate-no-webgpu
node scripts/semantic-spike/smaller/run_browser.mjs trim64k webgpu trim64k-profile --profile
.cache/semantic-spike/venv/bin/python -B scripts/semantic-spike/smaller/evaluate.py
.cache/semantic-spike/venv/bin/python -B scripts/semantic-spike/smaller/verify.py
.cache/semantic-spike/venv/bin/python -B scripts/semantic-spike/smaller/review_sheets.py
```

Default run labels overwrite previous runs; provide a third positional label to preserve separate runs. `--fp32` runs the optional FP32 control for the two new models. Results are measured from fresh headless Chrome processes, HTTP cache disabled, with the same caveats as Phase 2A: OS/driver caches are not cleared, localhost is not internet cold load, process RSS includes all Chrome processes and shared pages, WebGPU can include CPU-assigned nodes, four-thread WASM needs cross-origin isolation. All requests are restricted to the loopback origin. No unsafe GPU flag is used by default. Single-thread desktop WASM is not mobile hardware emulation.

## Candidates and contracts

- **Multilingual CLIP**: `sentence-transformers/clip-ViT-B-32-multilingual-v1@58edf8cada9e398793dca955574a48cbb7f18be2`. DistilBERT, 128-token input, attention-mask mean pooling, original bias-free 768→512 projection. Reuses original OpenAI CLIP ViT-B/32 image vectors from Phase 1, as explicitly supported by the official model card. Tests original PyTorch, exported FP32, official ARM64 dynamic INT8 with separate original pooling/head, and a self-exported weight-only INT8 browser graph. A different projection space is never compared by query cosine to SigLIP2.
- **Trimmed SigLIP2**: same Phase 2A ONNX, 32768 or 65536 vocabulary rows, 64-token input, original last-position pooling/head, 768-dimensional output. Only the quantized token table and its row scales change. Transformer/head initializers stay byte-identical. Original SigLIP2 image embeddings are reused.
- **MobileCLIP2-S0**: `apple/MobileCLIP2-S0@3136ea51c8ed56b9f9abfab04cb816735aaad6cb`, OpenCLIP 3.2.0 and timm 1.0.29. Generates all 154 paired image embeddings using official S0 identity normalization (`mean=0,std=1`), resize/center-crop 256. Checks eval-mode reparameterization equivalence. Text has 77 tokens, 49408 byte-BPE vocabulary, noncausal attention, original EOS/argmax pooling and 512-dimensional projection. Exports FP32 and weight-only INT8. Direct Chinese is evaluated without translation.

## Vocabulary policy

`trim()` takes only a target size and the original tokenizer/model. It never reads photos, queries, annotations, or their frequencies. Selection is deterministic:

1. Preserve every added/special token, all original byte fallback tokens (255 `<0x..>` entries plus the original literal tab token), and original single-character tokens in Han, ASCII, punctuation/numbers/symbols/separators.
2. Allocate 45% of remaining slots to Han compounds in original token-ID order, using recursive original BPE merge dependency closure. Fill the rest with ASCII/punctuation tokens in original ID order, then remaining allowed tokens if capacity remains.
3. Retain all original merges whose two inputs and output are retained, in original merge order. Reassign compact IDs and slice the corresponding existing INT8 rows/scales. Preserve the normalizer, decoder, EOS, padding and byte fallback.

The 64k result retains all 21810 allowed Han-containing tokens, including simplified/traditional forms; the policy does not distinguish writing systems by query membership. Original token-ID order is a deterministic heuristic, not a newly measured corpus frequency estimate. ASCII tokens also cover non-English Latin words; this is not a trained language classifier. Byte fallback prevents unknown IDs but does not guarantee semantic quality for rare characters, other languages, or changed segmentation.

`tokenizer-audit.json` records full versus trimmed mapped IDs, same-token status, decoded output, unknown count, pre-truncation token lengths, and query/probe cosine. 19 probes include unseen photography genres, simplified/traditional characters, mixed text, Unicode, empty/special-token strings and over-length inputs. Python explicitly clears saved low-level padding/truncation before applying the model contract; otherwise EOS positioning would differ. Browser inputs are encoded from actual text, not looked up in fixtures.

## Evaluation and review

`extra-queries.json` freezes 18 paraphrases before measuring: six traditional Chinese, six mixed, three conversational simplified Chinese and three conversational English. They reuse existing intent criteria/qrels, so they test robustness of phrasing, not novel relevance concepts. Original 48 queries and annotations are unchanged. Four original absent controls do not enter positive-query metrics; no no-result threshold is calibrated here.

`evaluate.py` uses the new full-vocabulary browser run as the reference for all 66 queries, asserting that its first 48 reproduce Phase 2A Top-10 exactly. It verifies all vectors and saved rankings, reports Hit@1/5/10, nDCG@5/10 and deltas by language, and separates native reference results from browser measurements. Frozen source hashes are checked on every evaluation. Primary output is `smaller/SMALLER_REPORT.md`, with `summary.json`, `metrics.md`, per-run raw JSON and `evaluation/` details.

`review.html` provides all candidates' Top-5 and Top-10 thumbnails for all 66 queries, with original qrel labels. `human-review.json` explicitly records whether independent human review exists. `review_sheets.py` also renders eight selected comparison sheets; written AI observations are saved separately in the cache report. Existing qrels are AI visual annotations, not independent human ground truth. Do not call an agent's visual inspection a human review or infer production-wide quality from this small, near-duplicate-rich corpus.

MobileCLIP2's JS tokenizer uses the same original CLIP byte-BPE with tested Unicode width cleaning. All 85 fixtures must match OpenCLIP exactly. It is not a full JavaScript implementation of ftfy's arbitrary mojibake/HTML repair, so equivalence is limited to the tested valid-Unicode input domain.

Official sources: [Multilingual CLIP model](https://huggingface.co/sentence-transformers/clip-ViT-B-32-multilingual-v1), [Apple MobileCLIP repository and S0 preprocessing](https://github.com/apple-aiml-research/ml-mobileclip), [MobileCLIP2-S0 checkpoint](https://huggingface.co/apple/MobileCLIP2-S0), [ORT WebGPU](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html).
