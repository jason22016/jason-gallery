# Semantic Search Phase 3A

Phase 3A provides the local-only client runtime shared by future Explore and Cmd+K integrations. It does not add an AI Search control, modify Cmd+K, render semantic results, call an inference service, upload queries, or start any semantic work during an ordinary page load.

## Public API and ownership

`src/semantic-search/index.ts` exports `getSemanticSearchEngine()`, a document-scoped singleton stored under `Symbol.for('jason-gallery.semantic-search-engine')`. Product consumers must use this getter so Explore and Cmd+K share one Worker, tokenizer and ONNX session. `createSemanticSearchEngine()` exists only for isolated tests and diagnostics.

Import is side-effect free. The explicit `enable()` boundary performs all index/model I/O and session creation; `search()` is rejected until the state is `ready`. A ready engine reuses its Worker/session for every query. `dispose()` aborts initialization and active work, terminates the Worker and returns to `disabled`; `retry()` reconstructs the runtime after a recoverable failure.

Queries and embeddings never leave the browser. Tokenization, inference, L2 normalization, cosine ranking and Top-K all execute inside the dedicated Worker.

## Immutable releases and compatibility

The model release is `siglip2-base-v64k-uint4-b32-r1` under `semantic-releases/`. Its exact manifest binds:

- SigLIP2 Base revision `75de2d55ec2d0b4efc50b3e9ad70dba96a7b2fa2`;
- Phase 2B semantic model contract, client model contract and public model hashes;
- 64k tokenizer and tokenizer config;
- UInt4 block-32 text transformer, INT8 token embedding and FP32 projection/LayerNorm/activation config;
- full decoded ONNX SHA-256 `f53300d16d35648582bec83452e8f49272158556268b2dac369ca73037e466a8`;
- 768-dimensional, Float32, L2-normalized Phase 2B index format;
- exact ONNX Runtime Web and tokenizer package versions.

The four logical payloads total 111,166,042 decoded bytes and 100,655,930 Brotli transport bytes. The ONNX is split into six independently compressed transport parts so every deployed asset is below the Cloudflare Pages 25 MiB file limit. Parts are not independently usable: the loader verifies each decoded part, reconstructs the logical ONNX at its declared offset, verifies the complete ONNX hash, and only then commits the release to cache or initializes inference. The exact directory and manifest are verified during semantic verification and every production build.

ONNX Runtime Web uses separate immutable runtime release `onnxruntime-web-1.30.0-asyncify-r1` under `semantic-runtimes/`. Its external MJS and Brotli-encoded asyncify WASM are hash-verified at build time. The compressed WASM is 3,866,678 bytes rather than emitting the 26,781,914-byte raw WASM into Astro/Vite output. Both files load only when the semantic Worker initializes.

## Index gate

Before any model payload download, the engine loads the Phase 2B `semantic/index.json` and `vectors.f32` and fails closed unless all of the following hold:

- exact schema/kind/field allowlists and canonical index-version digest;
- public model hash equals the client release's compatible image-space contract;
- bytewise-sorted, unique 16-character public IDs;
- declared photo count equals ID count;
- dimension is 768 and vector byte length is exactly `count × 768 × 4`;
- vector file SHA-256 matches;
- every Float32 value is finite and every row is unit normalized within the fixed tolerance;
- when the caller already owns the active public catalog, `enable({ publicPhotoIds })` requires exact membership parity.

Model/index incompatibility becomes `update-required`; malformed or corrupt index data becomes a closed integrity error. An incompatible index never triggers model download.

## Persistent cache

Large decoded logical model assets use Cache Storage, not the normal HTTP/Vite bundle and not an unbounded localStorage value. The cache name contains both release ID and bundle hash. A release is considered durable only after all four logical files are written and an exact completion marker is committed last.

On every reuse, the marker, file presence, byte length and SHA-256 of every logical payload are revalidated. Missing, partial or corrupt generations are deleted as a unit and downloaded again. A new release/bundle receives a different cache name; after a valid current generation is available, obsolete semantic cache generations are explicitly removed.

Cache Storage is treated as an optimization, never a guarantee. API absence, privacy restrictions, quota errors and write failures fall back to an in-memory session for the current document. The state reports `memory` rather than claiming persistence. Immutable HTTP caching still applies to the separate ORT runtime assets.

## State machine

The UI-facing state is deliberately independent of ONNX internals:

`disabled → not-downloaded → verifying → downloading → verifying → initializing → ready ↔ searching`

Failures enter `error`; incompatible release/index contracts enter `update-required`. State includes release/model/index versions, decoded verified bytes, expected decoded/transport totals, current file, cache mode, selected backend, fallback reason and a stable error code/message/recoverability flag.

Only the newest query is allowed to publish results. A newer query or AbortSignal cancels the prior request, asks ONNX Runtime to terminate an active run when possible, rejects the stale promise with `AbortError`, and discards any late result. Worker/session counters in diagnostics support reuse tests without exposing ONNX objects to UI code.

## Backend and failure recovery

The Worker requests WebGPU first. Missing adapters and WebGPU session failures fall back to the matching asyncify WASM runtime and expose the fallback reason. Non-cross-origin-isolated pages use one WASM thread; the architecture can raise that count when isolation is available. Safari/iOS/Android remain later validation targets, but no engine API or storage contract assumes permanent cache availability or a WebGPU-only browser.

Manifest, part, full-model, index and vector integrity errors fail closed. Model integrity failures clear the current incomplete/corrupt cache generation. `retry()` re-fetches and revalidates; a successful cached model is never trusted without its full hash checks after refresh.

## Load boundary and Phase 3B handoff

Home, Project, Explore, Map, Stats, Cmd+K and Viewer do not import or invoke this runtime today, so they fetch neither semantic index/model assets nor ORT runtime files. Browser release tests assert this boundary and ensure no semantic Worker/raw ORT WASM enters the ordinary Astro graph.

Phase 3B still needs to design the explicit consent/download UI, translate engine states and progress into accessible copy, pass the active public photo IDs into `enable()`, map returned public IDs back to the current catalog, define query/result interaction analytics that remain local/private, and validate real-device memory, storage eviction and thermal behavior on Safari/iOS/Android.
