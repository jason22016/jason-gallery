# Production semantic image index

`pnpm semantic:build` reads the existing Public Global Photo Collection and only its files under `public/thumbnails/`. It never scans a Manifest to invent public membership and never downloads originals. The output is `public/semantic/index.json` plus row-major little-endian `vectors.f32`.

The frozen image/client alignment contract lives in `model.json`. The 64k tokenizer and UInt4 ONNX hashes form one indivisible client release even though Phase 2B does not publish either client file.

Install the pinned CPU runtime with Python 3.12:

```bash
python3 -m venv .cache/semantic/venv
.cache/semantic/venv/bin/python -m pip install -r scripts/semantic/requirements.txt
pnpm semantic:build
pnpm semantic:verify
```

The build cache is content-addressed under `.cache/semantic/embeddings/`. Its identity is the thumbnail SHA-256 plus image model ID/revision, preprocessing version, and embedding schema version. Project metadata and public membership are deliberately absent from that identity. `SEMANTIC_PYTHON`, `SEMANTIC_MODEL_CACHE`, `SEMANTIC_BATCH_SIZE`, `SEMANTIC_THREADS`, and `SEMANTIC_OFFLINE=1` are supported for controlled local/CI execution; inference remains CPU-only.

Phase 1/2A/2A.5/2A.6 benchmarks and browser harnesses remain under `scripts/semantic-spike/` for regression work. No spike cache or browser text model is part of this production path.
