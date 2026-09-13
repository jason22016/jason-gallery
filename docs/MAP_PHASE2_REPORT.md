# Jason Gallery Map Phase 2

Upstream main verified on 2026-09-13: `1f65cde6672e5231599182620116ac904e39f548`.
The full upstream DESIGN.md was read before implementation and matches
`docs/viewer/AFILMORY_DESIGN.md`.

## Reuse and adaptation

- Migrated the PhotoMarkerPin pin subtree: circular thumbnail, 40×40 material surface,
  glass gradient, MingCute camera, inner depth layer and selected outer ring.
- Retained upstream scale-in `0 → 1`, hover `1.1`, tap `0.9`, image opacity `0.4`,
  selection ring inset `-8px`, and the 2s opacity pulse. Added keyboard focus at `1.1`.
- DESIGN.md takes precedence over legacy pin styles: existing semantic material/accent
  tokens replace neutral ramps, light/dark pairs, green wash and heavy shadows.
  `Spring.presets.snappy` replaces inline stiffness/damping. The material uses the
  existing 12px control blur, hairline border and faint shared shadows.
- Native buttons provide title-first accessible names and `aria-pressed`; reduced
  motion disables scale entry/gestures and the pulse, including media changes at runtime.
- LazyImage's thumbhash → thumbnail behavior uses Jason's existing validated hexadecimal
  Thumbhash component and native `loading="lazy"` / `decoding="async"`. Original-image
  fallback and HoverCard/anchored Card subtrees were omitted.

## Marker architecture and performance

- Native MapLibre HTML Markers hold React portals from the existing Gallery React tree,
  retaining its LazyMotion context. No new dependency or react-map-gl migration.
- Native source clustering, cluster visuals, click expansion, Project/visible-photo scope,
  MiniMap navigation, error fallback and viewport restoration remain in place.
- The selected ID is excluded from the clustered source and rendered independently, as
  in upstream's selected-marker pattern. It remains visible when nearby points cluster,
  without being counted twice.
- Map/source lifetime depends on photo IDs and coordinates, rather than selection or
  callback identity. Marker clicks push `mapPhoto` history and keep the map open; repeat
  selection does not add duplicate history entries. Back/Forward preserves instances.
- A keyed registry deduplicates loaded tile/world copies and mounts only unclustered
  photos within the viewport plus a 40px margin. It reuses existing markers during
  asynchronous source updates and removes retired markers and map listeners on teardown.
- Selected/hovered/ordinary marker layers use 30/20/10 within an isolated canvas stacking
  context, keeping existing controls clickable. Production CSS retains standard blur.
- Pin props contain only ID, title, thumbnail and thumbhash. A thumbnail equal to the
  original URL is rejected for marker backgrounds. Missing/failed images retain the hash
  and camera without requesting originals. The existing photo list still opens Viewer.

## Changed files

- `src/components/gallery/map/PhotoMarkerPin.tsx`
- `src/components/gallery/map/photo-marker-registry.ts`
- `src/components/gallery/PhotoMap.tsx`
- `src/components/gallery/ProjectGallery.tsx`
- `src/styles/gallery.css`
- `tests/website/photo-marker-registry.test.ts`
- `tests/website/website.test.ts`
- `tests/website/gallery.test.ts`
- `licenses/map-phase2-upstream.json`
- `licenses/map-phase1-upstream.json`
- `licenses/gallery-upstream.json`
- `THIRD_PARTY_NOTICES.md`
- `docs/MAP_PHASE2_REPORT.md`

Application derivatives retain AGPL-3.0-or-later + ANL §4, the existing full Afilmory
license and visible attribution. The new provenance record captures upstream references,
DESIGN.md and adapted file SHA-256 hashes; prior records update only affected files.

## Validation

- `pnpm check`: PASS.
- `pnpm check:upstream`: PASS; pinned viewer core and reviewed adaptations unchanged.
- `pnpm test:website`: **57/57 PASS**.
- `pnpm test:viewer`: **55/55 PASS**, including real WebGL MiniMap and source provenance.
- `pnpm build`: PASS.
- `git diff --check` and Phase 2 local/upstream SHA-256 verification: PASS.

Browser checks cover actual material/blur and thumbnail loading, selected accent/ring/z-order,
keyboard and touch selection, identical marker/map instances across selection and History,
upstream hover/focus/press scales, runtime reduced motion, failed thumbnail fallback without
original requests, initial/user viewport restoration, native cluster expansion, and P0/P1
MiniMap navigation/refresh/Back/Forward.

The 480-photo browser fixture retains fewer than 150 visible marker instances while panning,
deduplicates IDs, preserves selected visibility after zoom-out and restores motion listener
count to the pre-map baseline on close. It makes zero original-image requests. The registry
unit test covers 1,000 candidates with duplicate tile/world copies, 30 selection changes,
coordinate updates and exactly-once removal, including repeated teardown.

## Deferred to P3

- Hover Photo Card, including its reveal/dismiss delays and accessible interaction.
- Anchored Selected Photo Card with preview, title, date/camera/location and close action.
- Card action for entering Viewer.

Cluster Marker redesign, Cluster Photo Grid, Map Controls/Info Panel and whole-map/MiniMap
layout work remain outside Phase 2.
