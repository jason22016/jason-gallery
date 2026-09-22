# AI Search progressive result levels

The current UI defaults to a shared cosine cutoff of **0.07** for every query.
Users can expand to the next level that adds photos with each click:

| Level | Minimum score (inclusive) | UI label |
|---|---:|---|
| 1, default | 0.07 | 较相关的结果 |
| 2 | 0.05 | 更多结果 |
| 3 | 0.03 | 更广范围的结果 |
| 4 | No cutoff | 全部候选结果 |

These are display filters over the original Top-60 candidates within the current search scope, not per-query
thresholds or relevance probabilities. They apply to the current
`siglip2-base-v64k-uint4-b32-r1` release; changing the model requires recalibration.

## Behavior

- Search previews, the Explore/Project count/grid/list, and the Viewer sequence use the
  same selected results in their original rank order. Previews show at most five;
  neither previews nor the gallery fill empty slots with lower-scoring images.
- “显示更多” advances to the next populated level. When that next level is the
  unfiltered candidate set, the button reads “显示剩余候选”.
  The action in the search panel also opens the selected results in the current gallery.
- “只看较相关的结果” restores level 1. Editing, submitting, or retrying a query
  resets to level 1; expansion does not trigger inference or download assets.
- If every candidate is already visible, the expand button disappears, even if
  this happens before level 4. Actual candidate counts are used, including when
  there are fewer than 60 public photos/results.
- Levels that add no photos are skipped in the same click. An
  empty filtered result offers expansion when original candidates exist; a truly
  empty candidate list does not offer expansion.
- The original candidates remain in memory. Expanding only changes display state;
  it does not modify the photo collection, metadata filters, or model ranking.

## Project scope

Every published Project's Cmd+K offers AI Search alongside ordinary search.
Explore searches the entire public collection; a Project searches only its own
photos, with up to `min(60, project photo count)` candidates. Every display level,
including the final unfiltered level, stays inside that Project.

`Gallery.astro` obtains each Project photo's canonical `publicId` from the same
build-only public collection used by the semantic index. Project-local captions,
alt text, and detail URLs are retained. Pages without valid public identities do
not expose AI Search, and the global Map remains unchanged.

The shared runtime still loads the integrity-checked full public index and the
same cached text model. Explore supplies an exact catalog parity check at enable;
a Project supplies its IDs as a per-query `scopePhotoIds` restriction instead.
The runtime validates every scope ID against the loaded index, snapshots the
scope, and sends it to the Worker. The Worker filters eligible vector rows before
sorting and taking Top-K, so a Project photo below the global Top-60/100 is still
discoverable. Ranks are local to the selected scope. Unknown or empty scopes fail
without silently widening the search or invalidating the shared model session.

First use still requires explicit enable. Successful setup saves a device preference;
entering AI mode after refresh or navigation automatically restores the runtime using
the existing model cache. A complete cache from the previous UI also permits automatic
restoration without another opt-in. Cancelling setup disables automatic restoration,
and setup failures wait for a manual retry instead of retrying in a loop. Ordinary
gallery browsing and metadata search do not initialize the runtime. Only the enable
preference is saved, never query text or results.

Masonry treats column bottoms within one CSS pixel as tied and chooses the leftmost
column, retaining the exact photo dimensions. This keeps nearly identical landscape
ratios (such as the 云南 / 鸟 results) from leaving an interior hole in the last row.
Photos with genuinely different heights continue to fill the shortest column.

## Threshold rationale

The 2026-09-22 local experiment scored 186 queries against the current 154-photo
corpus. Of these, 148 were newly prepared queries grouped by concept into 93
calibration and 55 validation queries. For the 148-query set, the approximate
mean Top-60 result counts at the selected cutoffs were 7.5, 18.6, 40.4, and 60.
The 0.07 default retained 434/449 (96.7%) of the audited, definite positive
query–photo pairs; 0.03 retained 449/449. Labels were prepared by AI and corrected
after full-thumbnail review. These are exploratory local measurements, not
independent human ground truth or guarantees for unseen queries.

This policy follows the user's choice to balance clutter against missed matches
while retaining a progressive recovery path. It supersedes the display behavior
described in the historical Phase 3B/3C reports, without changing those reports'
recorded evaluation outcomes or fulfilling their independent-human release gate.

## Verification

`tests/semantic/ui.test.ts` covers inclusive boundaries, rank preservation, empty
filtered results, and recovering original candidates. The AI Search cases in
`tests/website/gallery.test.ts` exercise the production UI with deterministic
scores: 2 → 5 → 8 → 60 results, empty-band skipping (8 → 14), no extra inference, Viewer
sequence consistency, reset on a new query, 320px mobile layout, reload/navigation
restoration, cancellation, storage failures, and empty/fewer
candidate sets. Project tests also cover membership exclusion before Top-K,
Project-only Viewer navigation, and returning to saved metadata filters. Layout tests
use the actual 云南 bird-photo dimensions across 2–8 columns and widths of 120–500 px.
`tests/website/global-release.test.ts` checks canonical IDs on actual Astro-built
Project pages; `tests/semantic-browser/runtime.test.ts` runs scope isolation through
the real WebGPU and WASM Workers and verifies that subsequent global queries keep
the same model session. Run relevant checks with `pnpm check` and:

```sh
node --import tsx --test tests/semantic/ui.test.ts tests/website/gallery-filters.test.ts
node --import tsx --test --test-concurrency=1 --test-name-pattern='AI Search|Explore Cmd|Global Gallery' tests/website/gallery.test.ts
node_modules/.bin/vite build --config tests/semantic-browser/vite.config.ts
node --import tsx --test --test-concurrency=1 --test-name-pattern='Project scoped ranking' tests/semantic-browser/runtime.test.ts
node --import tsx --test --test-concurrency=1 --test-name-pattern='AI Search|ordinary Home' tests/website/global-release.test.ts
```
