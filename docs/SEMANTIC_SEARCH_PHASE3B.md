# Semantic Search Phase 3B

Phase 3B connects the Phase 3A on-device runtime to the public Explore gallery and its Cmd+K search surface. It adds explicit model consent, local semantic querying and ranked Gallery results without creating another photo browser or another inference runtime.

## Product boundary

Normal Project, tag, metadata and date search remains the default mode and does not depend on a model. AI Search is a distinct mode for natural-language visual retrieval over the Public Global Photo Collection. Entering and leaving the mode preserves the existing metadata filters, sort, view and Gallery state.

The query is React state only. It is never added to the URL, analytics, a server request or a remote log. Results reuse the existing Masonry/List Gallery and PhotoViewer. Returned public IDs are mapped back to the current public collection in model rank order; unknown and duplicate IDs are discarded rather than re-ranked.

## Explicit enable and shared ownership

`useSemanticSearch()` has a type-only dependency on the runtime. Its first runtime import occurs inside the user-initiated `enable()` or `retry()` action. Rendering Explore, opening Search/Cmd+K, entering AI mode and viewing the consent panel therefore load no semantic index, vectors, model, tokenizer, ORT runtime or Worker.

The hook obtains only `getSemanticSearchEngine()`. It never constructs an engine and does not dispose a ready runtime when a panel closes or AI mode exits. Explore and Cmd+K consequently share the document-scoped Worker, tokenizer cache and ONNX session. Cancel aborts an in-progress setup through the shared engine; retry reconstructs the same singleton after cancellation, corruption, a recoverable failure or an update-required state.

The enable panel states that visual search runs on-device, queries stay private and the one-time decoded payload is about 101 MB. `Download & Enable` is the only setup boundary. Progress comes directly from Phase 3A state and exposes decoded downloaded/total bytes, current file, verifying and initializing states. No simulated progress is used.

## Search interaction

The active mode provides five curated, deterministic suggestions with locale buckets in `semantic-suggestions.ts`. They issue no LLM or network request. A suggestion, Enter submission or a debounced input invokes the same semantic search path.

Input changes cancel the prior request immediately. A 350 ms debounce reduces redundant inference, an AbortSignal reaches the engine/Worker, and a monotonically increasing sequence prevents late results from publishing. Top-K is capped at 60 and semantic rank remains the primary and only result order. Empty, loading and recoverable error states are explicit.

Cmd+K keeps normal commands and filters immediately available. A typed metadata query offers `Search “…” with AI`; selection enters the same consent/ready surface. Once ready it shows up to five semantic photo results, opens them with the existing Viewer and offers `View all in Explore` to close the palette onto the already-ranked Gallery.

## Material and accessibility

The AI capsule uses the Gallery's semantic material, blur, hairline, radius and typography tokens. Hover/focus and active states expose a restrained gradient edge; only the active edge moves, on a slow seven-second cycle. Motion uses the existing spring preset and `prefers-reduced-motion` removes edge and spinner animation.

The mode control is a native button with pressed state, visible focus, a descriptive label and tooltip. Setup progress is a native progress element with live byte status; setup/search containers expose busy and live states. Suggestions and results are native keyboard-operable buttons. The panel reflows its actions at narrow widths and is covered at a 320 px touch viewport.

## Lazy output and verification

Production emits the semantic client and Worker as separate asynchronous chunks. Ordinary HTML does not preload either chunk, and ORT WASM remains an explicit immutable runtime asset rather than entering the Astro graph. A production-browser request audit covers Home, Project, Explore, Map, Stats, Cmd+K and Viewer before consent.

Coverage includes UI states, explicit enable, real progress, cancellation/retry, cache hit, update required, curated suggestions, public-ID mapping, Gallery/Viewer reuse, mode restoration, debounce/latest-query cancellation, empty/error recovery, Cmd+K entry/result/runtime reuse, keyboard focus, 320 px layout, reduced motion and ordinary-route asset isolation. Phase 3A browser coverage continues to exercise cold download, full integrity verification, corruption recovery, persistent cache, WebGPU/WASM fallback and Worker/session reuse.

## Phase 3C release blockers

Phase 3B is not a mobile production-readiness claim. Phase 3C still needs physical iOS, Android and Safari validation for memory pressure, storage quota/eviction, interrupted background downloads, WebGPU/WASM behavior, thermal impact and long-session lifecycle. It also needs an independent human relevance review on the published gallery and release acceptance thresholds for representative multilingual queries.
