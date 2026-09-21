# Semantic Search Phase 3C Release Gate

Date: 2026-09-22 (Asia/Hong_Kong)

Release under test:

- semantic client: `siglip2-base-v64k-uint4-b32-r1`
- semantic index: `e771594e842fe295759ae028862c18348d9adb50895d51efae19dfed14d1f64a`
- public corpus: 154 photos
- network transport: 100,655,930 bytes (100.7 MB decimal, shown as “约 101 MB”)
- decoded/verified client payload: 111,166,042 bytes (111.2 MB decimal, shown as “约 111 MB”)

## Decision

**Final decision: NO-GO for an unconditional production rollout. Do not label this release “production ready” yet.**

No automated release blocker was found in the code, production build, desktop Chrome runtime, simulated Firefox/WebKit engines, storage-failure matrix, or repository-wide regression suite. The release remains held by evidence that this environment cannot honestly provide:

1. the new holdout has not received the required independent human visual review;
2. real Safari was not exercised (Safari 18.1.1 is installed, but computer-use permission for Safari was denied);
3. no physical iOS Safari or Android Chrome device was available;
4. no Windows environment was available.

Playwright WebKit is reported only as simulated WebKit evidence, never as Safari evidence. Chromium mobile viewports are reported only as emulated layout/touch evidence, never as physical-phone evidence.

The implementation and automated evidence are ready for those final manual gates. `pnpm semantic:phase3c:score` currently exits non-zero with `Independent human review is still pending`, which is the intended fail-closed release behavior.

## Evidence classification

### Automated PASS

- `pnpm check`
- `pnpm semantic:verify`
- `pnpm test` including the production build
- semantic runtime/unit tests: 20/20
- semantic browser tests: 8/8
- Projects: 48/48
- Stats: 68/68
- Viewer: 66/66
- Website (Explore, Cmd+K, Gallery, Viewer, Map and global release/privacy): 160/160
- SEO: 4/4
- automation: 25/25
- admin/publication safety: 101/101
- real metadata audit: 1/1
- total reported `node:test` cases in the full run: 501/501
- production build: 161 pages, exit 0

### Real-device / real-browser PASS

Test host: MacBook Pro (Apple M1 Pro, 8 cores, 16 GB), macOS 15.1.1 (arm64).

- Installed Google Chrome 153.0.8010.53, headless on the real macOS host: PASS.
- WebGPU exposed and initialized successfully.
- Brotli tokenizer/model assets decoded and SHA-verified.
- cold initialization, persistent-cache reload, queries, cancellation, retry, navigation/reload and background-tab recovery passed.
- one Worker and one ONNX session were retained throughout the tested document lifecycle.

This is real desktop-browser evidence, but headless execution is not evidence for display rendering, touch, thermal behavior, mobile memory pressure, or background suspension on a phone.

### Simulated/emulated PASS

| Surface | Evidence | Result | Important observation |
|---|---|---|---|
| Playwright Firefox 153.0 | Playwright engine on macOS, not an installed end-user Firefox app | PASS | `navigator.gpu` existed but no adapter was available; automatic WASM fallback worked. Queries took about 6.2–6.3 s in this harness, so real Firefox performance remains a manual check. |
| Playwright WebKit 26.5 | Playwright engine on macOS, **not Safari** | PASS | WebGPU was not exposed; WASM fallback worked. The engine evicted the large Cache Storage generation between reloads, so all eight payload files were safely downloaded again. |
| Chromium 320 px/touch viewport | browser emulation, not a phone | PASS | keyboard/focus, touch targets, no horizontal overflow, reduced motion and mobile panel layout passed. |
| Desktop background tab | browser lifecycle simulation, not mobile OS suspension | PASS | a query completed while another tab was foreground, and the same Worker recovered when brought back. |

### Manual verification still required

- Safari 18.1.1 on this macOS host: normal and private modes, WebGPU availability, WASM fallback, Cache Storage eviction/quota, reload, download interruption, background/foreground and VoiceOver.
- Physical iPhone/iPad Safari: memory pressure, OS suspension during download/query, storage eviction, orientation, touch, safe areas, thermal/battery impact and resume/retry behavior.
- Physical Android Chrome: the same lifecycle/storage/touch/thermal matrix.
- Windows Chrome and Firefox; Edge if it is a supported release target.
- Installed stable Firefox on a user profile, especially WASM latency and caching.
- Independent human relevance review of all holdout queries and candidates.
- A final human visual audit that the active AI edge animation remains subordinate to the photographs on calibrated desktop and mobile displays.

## Browser and performance measurements

All timing numbers below are single-host observations, not product SLAs. Assets were served from localhost and a warm filesystem; “cold” includes fetch, Brotli decode, SHA verification, Cache Storage write plus readback, Worker creation and ONNX session creation, but not real internet latency. Desktop numbers must not be extrapolated to mobile.

| Browser/path | Backend | Cold ready | Second ready | Representative query latency | Cache behavior |
|---|---:|---:|---:|---:|---|
| Google Chrome 153 real binary | WebGPU | 1,799 ms | 748 ms | 95.9 ms first, 27.0 ms warm | persistent; zero model/tokenizer payload requests on reload |
| Playwright Firefox 153 | WASM | 2,840 ms | 1,543 ms | 6,336 ms, 6,237 ms | persistent; zero payload requests on reload |
| Playwright WebKit 26.5 | WASM | 1,621 ms | 1,475 ms | 604 ms, 510 ms | prior generation evicted; eight payload requests and a complete safe re-download |
| Chrome explicit no-WebGPU path | WASM | measured in the runtime harness | n/a | 517.8 ms, 488.2 ms | storage-unavailable memory fallback also passed |

The independent-holdout Chrome run measured 38 queries at mean 26.618 ms, min 24.0 ms and max 88.9 ms after a 1,897 ms cold initialization.

The 30-query sustained Chrome run stayed mostly between 23.8 and 25.2 ms. After explicit garbage collection, the page JS heap moved from 2,695,396 to 2,754,396 bytes (+59,000 bytes), comfortably inside the 16 MiB leak guard. This is only the page heap exposed by Chromium; it excludes Worker/WASM/GPU/native process memory and is not a mobile-memory conclusion. A separate post-holdout page snapshot reported 112,758,309 bytes used JS heap after the full client load, also not total-process memory.

## Compatibility and lifecycle audit

The browser harness verifies each available engine against the production client release and real public index, not a toy model. It checks:

- WebGPU detection and actual adapter/session initialization;
- automatic WebGPU → WASM fallback;
- Cache Storage round-trip and complete-release cache semantics;
- Brotli transport decoding and decoded SHA-256 verification;
- Worker creation, one-session reuse and query cancellation;
- cold load, page reload, cached load or safe eviction recovery;
- navigation/reload during a slow download;
- foreground/background desktop-tab recovery;
- multilingual golden-result identity.

Repeated AI-mode activation was exercised eight times through Explore/Cmd+K while retaining one Worker and one session. The runtime stress path issued 30 sequential queries, 20 repeated aborts, and 100 temporary subscribe/unsubscribe cycles; the permanent listener count returned to one and Worker/session counts remained one.

Viewer open/close, Gallery navigation, history restoration, Explore ↔ Cmd+K result flow and ordinary site navigation are included in the website regression suite. No semantic failure is allowed to replace or disable ordinary metadata search, filters, Gallery or Viewer.

## Storage and failure recovery

| Failure | Evidence class | Result / fail-safe behavior |
|---|---|---|
| Cache Storage absent or security-blocked | unit + browser simulation | PASS; ready session uses memory cache and ordinary site remains available |
| quota / `Cache.put` failure | unit + browser simulation | PASS; incomplete cache name is deleted and ready session continues in memory |
| cache eviction | unit + Playwright WebKit observation | PASS; clean miss and complete redownload, never partial reuse |
| silent eviction after apparently successful writes | unit simulation; motivated by WebKit behavior | PASS; new post-commit readback verifies marker, length and SHA for every file before reporting `persistent` |
| incomplete/truncated model download | unit + browser fault injection | PASS; fails closed as model download error |
| corrupted Brotli chunk / SHA mismatch | unit + browser fault injection | PASS; indivisible release is rejected and retry recovers |
| vector truncation / vector SHA mismatch | browser fault injection | PASS; stops before model download |
| model/index/runtime version mismatch | unit + browser fault injection | PASS; `update-required`, no model download and ordinary search remains usable |
| interrupted initialization | unit simulation | PASS; returns to disabled, publishes no stale ready state and leaks no listener/Worker |
| reload during download | browser fault injection | PASS; no completion marker survives; clean retry succeeds |
| reload after ready | real Chrome + simulated engines | PASS; persistent hit where retained, otherwise complete safe redownload |
| semantic release upgrade | unit simulation | PASS; obsolete release cache names are removed only after current release handling |
| repeated cancel/retry | unit + browser | PASS; stale query results are discarded and a later query wins |

Cancellation/retry is safe but is not byte-range resume. An interrupted first download discards the incomplete generation and starts the indivisible release again. The UI now says this explicitly. True cross-navigation partial-download resume is a non-blocking follow-up unless physical-device testing shows that restart-only behavior is unacceptable for the supported network conditions.

## Relevance release gate

### Independent holdout preparation

`semantic-evaluation/phase3c/holdout-queries.json` contains 38 new post-model-selection query strings. Validation rejects an exact normalized-text reuse of any Phase 1/2, extra-paraphrase or hard-query input.

Coverage:

- language: 9 Simplified Chinese, 7 Traditional Chinese, 15 English, 7 mixed Chinese/English;
- intent: 7 object, 7 scene, 4 action, 7 relation, 4 difficult paraphrase, 3 near-match and 6 no-match;
- expected class: 29 present, 3 near-match and 6 no-match.

`reports/semantic/phase3c/review.html` presents Top-5 first and ranks 6–10 separately, starts with prepared expectations, AI labels and cosine diagnostics hidden, saves local decisions and exports JSON. `corpus.html` is an unranked sheet of all 154 public thumbnails so the reviewer can decide corpus answerability without inferring it from the ranking.

The scorer requires:

- all 38 answerability decisions;
- all 380 Top-10 relevance judgements;
- no `unsure` decisions;
- reviewer identity and an explicit declaration of independence from model selection;
- matching query-set and index versions.

The practical positive-ranking screen in `release-gates.json` was frozen before independent human review (but after AI-assisted preparation, so it is not claimed as a statistically preregistered study): at least 24 answerable queries, Hit@1 ≥ 0.60, Hit@5 ≥ 0.90, Hit@10 ≥ 0.95, MRR ≥ 0.72, and Hit@5 ≥ 0.80 for each language bucket with at least four answerable queries.

### Automated metrics — PASS as diagnostics only

The AI-assisted labels were frozen before candidate generation and are explicitly marked `ai-assisted-not-independent-human`. They produced, over 32 labelled positive/near-match queries:

| Metric | Value |
|---|---:|
| Hit@1 | 0.8125 |
| Hit@5 | 1.0000 |
| Hit@10 | 1.0000 |
| MRR | 0.8880 |
| Recall@5 | 0.9635 |
| Recall@10 | 0.9896 |
| nDCG@5 | 0.8896 |
| nDCG@10 | 0.9003 |

AI-assisted Hit@5 was 1.0 in every language bucket. These values are useful automated diagnostics, **not independent human evidence and not the final relevance PASS**.

### No-result policy

No production abstention threshold is enabled. Cosine is presented only as an opaque ranking signal, never a probability. Six AI-labelled no-match controls had a lower top-1 range than the AI-labelled positives in this sample, but that observation is too small and too non-independent to set a threshold.

The released UI therefore says “图库中的相近结果” and “相似度只用于排序，不代表匹配概率”; an empty mapped result says “没有可显示的结果” rather than claiming that the corpus has no match.

Before adding a no-result threshold, collect at least 100 independently labelled queries including at least 30 no-match queries across languages and hard paraphrases; split calibration from untouched validation; lock score/margin rules on calibration; and report false-accept/false-reject rates with Wilson confidence intervals on validation. If that gate fails, keep the honest nearest-results behavior.

### AI-assisted review — prepared, not a release PASS

- Candidate generation, AI-assisted qrels and descriptive metrics are complete.
- The full-corpus sheet and blind Top-10 review tool are complete.
- The independent reviewer has not completed or signed the review.
- `semantic-evaluation/phase3c/human-review.json` remains `pending`.

## UX release audit

Automated DOM/CSS/browser checks pass for Explore and Cmd+K:

- first-download wording distinguishes approximately 101 MB network transport from approximately 111 MB decoded verification data;
- privacy text limits the claim to query text, vectors and ranking computation staying on device, while disclosing download of the model and public gallery index;
- progress uses actual decoded bytes emitted by the loader, identifies the current file, and labels the transport estimate separately;
- cancel, retry, update-required, error and cache-eviction behavior are explicit;
- keyboard entry/submission, focus trap/restoration, pressed state, live regions, native progress semantics and result buttons pass;
- 320 px layout, touch targets and no-overflow behavior pass under Chromium emulation;
- `prefers-reduced-motion` removes the animated edge/spinner behavior;
- the active AI edge remains a slow seven-second, restrained Gallery-token animation; physical-display visual judgement remains manual;
- Gallery/Viewer result flow preserves semantic rank and existing navigation behavior.

No repository-root `DESIGN.md` exists in this checkout. The audit used the checked-in `docs/viewer/AFILMORY_DESIGN.md` plus the existing Jason Gallery material, motion and focus tokens.

## Lazy-load and public-output audit

Production emits separate asynchronous semantic chunks:

- client chunk: 26,419 bytes;
- Worker chunk: 106,013 bytes;
- index: 5,496 bytes;
- vectors: 473,088 bytes.

The model/tokenizer/ORT assets exist in production output for on-demand use, but ordinary HTML does not preload them. A production-browser request audit visits Home, Project, Explore, Map, Stats, Cmd+K and Viewer, then enters AI mode without pressing Download. It observes zero requests for:

- semantic client chunk;
- semantic Worker;
- index and vectors;
- tokenizer;
- ONNX Brotli chunks;
- ORT MJS/WASM.

Only the explicit `Download & Enable` action crosses the dynamic-import/download boundary.

## Regression commands and results

```text
pnpm check                 PASS
pnpm semantic:verify       PASS (154 photos; release/index hashes match)
pnpm semantic:phase3c      PASS (38 candidates generated in real Chrome/WebGPU)
pnpm test:semantic         PASS 20/20
pnpm test:semantic-browser PASS 8/8
pnpm test                  PASS; complete feasible matrix and production build
```

`pnpm test` covers Projects, Semantic runtime/UI, Explore, Cmd+K, Gallery, Viewer, Map, Stats, SEO, public-output/privacy, automation, admin, real metadata and production build. The only expected non-zero command is `pnpm semantic:phase3c:score` while the independent review artifact is pending.

## Release blockers

1. Complete the independent blind relevance review and obtain a passing `pnpm semantic:phase3c:score` result.
2. Complete real Safari validation; Playwright WebKit cannot close this gate.
3. Complete physical iOS Safari and Android Chrome lifecycle/storage/memory/touch validation.
4. If Windows is part of the promised support matrix, complete Windows Chrome/Firefox (and Edge, if supported) validation.

## Non-blocking follow-ups

- Investigate whether Playwright Firefox's 6.2–6.3 s WASM query time reproduces in installed stable Firefox.
- Monitor Safari/WebKit Cache Storage eviction; safe redownload is correct but repeated 101 MB downloads may be poor UX.
- Consider part-level persistent resume only if physical-device/network testing makes restart-only retry unacceptable.
- Capture whole-process and Worker memory with platform tooling; `performance.memory` is only a leak signal.
- Calibrate a no-result threshold only after the larger independent negative/validation protocol is complete.

## Manual handoff

1. Open `reports/semantic/phase3c/review.html` and keep diagnostics/AI labels hidden while reviewing.
2. Use its linked `corpus.html` to decide whether each query is answerable in the full corpus.
3. Export JSON, replace `semantic-evaluation/phase3c/human-review.json`, fill reviewer identity, and set `independentFromModelSelection` to `true` only when accurate.
4. Run `pnpm semantic:phase3c:score`; archive `reports/semantic/phase3c/human-metrics.json` only if the command passes.
5. Attach the real-device/browser checklist results to this report and change the decision only when every required manual gate is closed.
