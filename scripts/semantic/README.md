# Production semantic image index

`pnpm semantic:build` reads the existing Public Global Photo Collection and only its files under `public/thumbnails/`. It never scans a Manifest to invent public membership and never downloads originals. The output is `public/semantic/index.json` plus row-major little-endian `vectors.f32`.

The frozen image/client alignment contract lives in `model.json`. Phase 3A publishes the 64k tokenizer, model config and UInt4 ONNX as the immutable `siglip2-base-v64k-uint4-b32-r1` client release. Its manifest binds every decoded payload SHA-256 to the Phase 2B image/index contract. The ONNX is transported as independently Brotli-encoded parts below the Cloudflare Pages per-file limit, then reassembled and verified as one logical model before use. A separately versioned ONNX Runtime Web MJS/WASM release keeps the runtime out of the ordinary Astro asset graph.

Install the pinned CPU runtime with Python 3.12:

```bash
python3 -m venv .cache/semantic/venv
.cache/semantic/venv/bin/python -m pip install -r scripts/semantic/requirements.txt
pnpm semantic:build
pnpm semantic:verify
```

The build cache is content-addressed under `.cache/semantic/embeddings/`. Its identity is the thumbnail SHA-256 plus image model ID/revision, preprocessing version, and embedding schema version. Project metadata and public membership are deliberately absent from that identity. `SEMANTIC_PYTHON`, `SEMANTIC_MODEL_CACHE`, `SEMANTIC_BATCH_SIZE`, `SEMANTIC_THREADS`, and `SEMANTIC_OFFLINE=1` are supported for controlled local/CI execution; inference remains CPU-only.

`pnpm semantic:plan` validates every cached vector and reports whether the image encoder is needed without importing Python or loading the model. Production automation runs this preflight after the photo collection is exported. When every content hash is already cached, Actions skips Python setup, the pinned Torch runtime, and the SigLIP2 checkpoint restore; it still rebuilds and verifies the public index on every run. If any vector is missing or invalid, only those cache misses are inferred.

Phase 1/2A/2A.5/2A.6 benchmarks and browser harnesses remain under `scripts/semantic-spike/` for regression work. No spike cache or browser text model is part of this production path.

The browser runtime lives under `src/semantic-search/`. Importing it has no fetch side effects; only `getSemanticSearchEngine().enable()` may fetch the public index and client assets. `pnpm test:semantic-browser` exercises cold and cached startup, integrity and compatibility failures, WebGPU/WASM, cancellation, worker reuse and known semantic fixtures. See `docs/SEMANTIC_SEARCH_PHASE3A.md` for the release, cache and state-machine contract.
