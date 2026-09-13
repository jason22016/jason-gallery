# Jason Gallery Map Phase 4

Upstream main verified on 2026-09-13 at
`1f65cde6672e5231599182620116ac904e39f548`. The complete
[Afilmory DESIGN.md](https://github.com/Afilmory/Afilmory/blob/1f65cde6672e5231599182620116ac904e39f548/DESIGN.md)
was read before implementation and matches the existing local design authority.

## Afilmory reuse

- Adapted ClusterMarker's exact `min(64, max(40, 32 + log(count) * 8))` sizing,
  circular 2×2 photo mosaic, 30% image opacity, count, 6px ring, glass/inner
  layers, 1.05 hover/focus and .95 press gestures, and 300/150ms HoverCard delays.
- Adapted ClusterPhotoGrid's three-column square grid, six-photo sample, +N tile,
  compact location/date metadata, 8px gaps and staggered smooth spring entry.
- Reused existing P2/P3 PhotoMarkerImage and HoverCard adapters of upstream
  LazyImage/Radix primitives, shared Spring presets, material/blur/accent/shadow
  tokens and opacity pulse. DESIGN.md overrides legacy upstream styling that
  conflicts with its semantic color, blur, spring and shadow rules.

## Native MapLibre adaptation and data

Native GeoJSON clustering, radius and selected-photo exclusion remain. Native
HTML Marker hosts with React portals replace react-map-gl only for rendering.
Visible source-tile/world copies are deduplicated by cluster ID and normalized
to the world nearest the viewport. The invisible source-consumer layer keeps
native tiles active; the previous circle/count UI is replaced by accessible
photo mosaic buttons.

On marker creation, `getClusterLeaves(id, min(4, count), 0)` supplies the mosaic.
The delayed desktop hover/focus preview requests at most six leaves. IDs resolve
against current visible Project photos; images use only lazy thumbnails and
thumbhash, with the existing original-equal/missing-thumbnail guards. The count
and `max(0, count - 6)` remainder come from the native cluster, not sample length.

Native `clusterProperties` min/max aggregate validated recorded capture days for
every member. Invalid dates use neutral sentinels; absent dates omit the row.
The full range remains accurate when extrema are outside the six-photo sample,
without fetching all leaves or adding another clustering algorithm. Coordinates
describe the native cluster center and normalize signed hemispheres/world copies.

Data stays only with active viewport markers. Repeated renders do not re-query
leaves; pending requests deduplicate and a late four-photo result cannot replace
six preview photos. Cluster retirement drops retained data. Zoom, selected-source
updates, filters/map replacement and teardown clear entries and invalidate prior
requests. Native promises have no cancellation API; generation and entry identity
discard their late results/rejections and clear retained pending state.

## Expansion and P0–P3

Click, Enter/Space and mobile tap close preview and call the native
`getClusterExpansionZoom()` → `easeTo()` path. Latest-click and lifecycle guards
prevent stale expansion after zoom/source changes. Preview failures remain local;
valid expansion errors retain the map's existing fallback. Mobile renders no
cluster hover card and tap starts expansion immediately.

Selected mapPhoto remains excluded from clustering and rendered independently.
After expansion, P2 PhotoMarker and P3 hover/selected Card → Viewer behavior,
MiniMap navigation, URL/history, visible filters, viewport memory and map fallback
remain unchanged. Reduced motion disables cluster entry/gestures and ring pulse.

## Files

- `src/components/gallery/PhotoMap.tsx`
- `src/components/gallery/map/ClusterMarker.tsx`, `ClusterPhotoGrid.tsx`,
  `ClusterMarker.css`, `cluster-marker-registry.ts`, `cluster-preview.ts`
- `tests/website/cluster-preview.test.ts`, `gallery.test.ts`, `website.test.ts`
- `licenses/map-phase4-upstream.json`; overlapping Phase 1–3 provenance records
- `THIRD_PARTY_NOTICES.md`; this report

## Validation

- `pnpm check`: PASS.
- `pnpm check:upstream`: PASS; pinned Viewer core unchanged.
- `pnpm test:website`: **71/71 PASS**, no skips.
- `pnpm build`: PASS.
- `git diff --check` and Phase 1–4 local provenance hash verification: PASS.

Browser checks cover actual native cluster members/counts, bounded mosaic/preview thumbnails,
+N, complete date range, quick hover/focus switching, zoom dismissal, direct
desktop/touch expansion, P2/P3 after expansion and visible-filter membership.
Six bridge tests cover pending/cached requests, identity/generation invalidation,
retirement, stale success/rejection, larger-sample preservation and native expansion.

Production-photo visual check: the Yichun Project has 87 located photos. Its
50-photo cluster renders six real thumbnails, +44 and 2026-08-09–2026-08-11,
with zero original-image requests and zero page errors. A local empty basemap
isolates cluster rendering from external tile availability. Screenshots/logs
remain in `.cache/map-phase4-*` and `/tmp/jason-phase4-*`.

## Deferred to P5

Map Controls, Map Info Panel, whole-map layout/fullscreen changes and MiniMap
refactoring. Viewer refactoring remains outside this phase. Native clustering
and its expansion semantics are retained; no algorithm replacement is included.
