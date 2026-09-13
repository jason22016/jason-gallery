# Jason Gallery Map Phase 3

Afilmory current main fetched and verified on 2026-09-13:
`1f65cde6672e5231599182620116ac904e39f548`. The complete upstream DESIGN.md
was read before changes and matches `docs/viewer/AFILMORY_DESIGN.md`.

## Reuse and architecture

- Exact reuse of `photo-marker-card-behavior.ts`, with both upstream behavior tests.
- Adapted `PhotoMarkerPin` HoverCard, `PhotoMarkerCardContent`, anchored entry,
  GlassButton close layers, and LazyImage's thumbhash/thumbnail lifecycle.
- Preserved 320px width, 128px crop, 16px content padding, title/arrow and compact
  optional date/camera/coordinates/altitude rows. DESIGN.md takes precedence over
  legacy colors, blur and shadows: semantic material, 40px panel blur, accent
  hairline, shared faint shadows, 16px radius and shared Spring presets.
- Native MapLibre markers and existing React portals remain. A nonmodal Radix
  Popover positions the selected card above its native button, outside map clipping;
  continuous positioning follows pans. Top-space sizing, scrolling and collision
  handling keep the same card usable on narrow/short viewports. Its sizing frame
  is canceled on unmount. No new dependency or MapLibre lifecycle change.
- The existing HoverCard accepts an optional reduced-motion preference. Map cards
  reuse their pin's reactive preference, avoiding Motion's permanent global media
  listener initialization on hover; Viewer default behavior remains the same.
- Dates preserve recorded EXIF calendar days. The existing camera projection
  supports Make-only/Model-only data. Signed coordinates derive N/S/E/W from the
  validated location. Optional numeric altitude preserves zero and sea-level sign;
  invalid/missing values disappear. Hover does not fetch detailed EXIF.

## State and accessibility

- Desktop ordinary marker: pointer hover or keyboard focus opens a Radix preview
  after 400ms; leave/blur closes after 100ms. Quick passes do not mount the card.
- Selected marker: the copied resolver chooses the anchored card. Hover is forced
  closed and its content is absent, preventing duplicate or stale previews.
- Selecting another photo replaces the single card and pushes `mapPhoto`; selecting
  the same photo remains a no-op. Close removes only `mapPhoto`, preserving the map
  panel. Back/Forward can restore or clear selection.
- Mobile uses the existing shared breakpoint and the same anchored card. Tap selects;
  no hover content is rendered, including focus after close.
- Existing marker button/pressed state and focus ring remain, with expanded/controls
  semantics. Card anchors and close button support keyboard operation. Escape from
  the selected card cancels selection and returns focus to its marker; subsequent
  Panel/Viewer Escape handling remains with those existing surfaces.
- A selected card preserves the combined map/card Tab boundary while Radix's
  nonmodal Popover pauses the parent FocusScope. Its temporary key listener is
  removed with the card, restoring the Panel's existing focus trap.
- Shared thumbnail rendering rejects original-equal URLs. Missing/failed previews
  retain a valid thumbhash and never fall back to the original.

## Viewer, URL and history

Image and title are real same-document `photo` anchors. Normal activation calls
ProjectGallery's existing `open` callback; modified-click uses the complete URL.
The existing Viewer history owner adds one `photo` entry, replaces that entry while
navigating photos, and returns to the map entry on close. `mapPhoto` continues to
identify map selection while `photo` identifies the Viewer slide. Both retain
Project/filter/sort/view/hash context without reloads or competing updates.

The Viewer sequence remains the existing visible Project sequence, including
photos without GPS. The map panel unmounts during Viewer display as before;
selection and viewport memory reconstruct its context on return. The existing
gallery map-action opener/focus fallback remains in use, rather than retaining a
detached card element as a transition target.

## Changed files

- `src/components/gallery/map/PhotoMarkerPin.tsx`
- `src/components/gallery/map/PhotoMarkerCard.tsx`
- `src/components/gallery/map/PhotoMarkerImage.tsx`
- `src/components/gallery/map/photo-marker-card-behavior.ts`
- `src/components/gallery/PhotoMap.tsx`
- `src/components/gallery/ProjectGallery.tsx`
- `src/components/gallery/GalleryIcons.css`
- `src/components/viewer/photos.ts`
- `src/components/viewer/metadata.ts`
- `src/components/viewer/HoverCard.tsx`
- `src/styles/gallery.css`
- `tests/website/photo-marker-card-behavior.test.ts`
- `tests/website/photo-marker-image.test.ts`
- `tests/website/metadata.test.ts`
- `tests/website/website.test.ts`
- `tests/website/gallery.test.ts`
- `tests/viewer/interactions.test.ts`
- `licenses/map-phase3-upstream.json`
- `licenses/map-phase1-upstream.json`, `licenses/map-phase2-upstream.json`,
  `licenses/gallery-upstream.json`, `licenses/viewer-interaction-upstream.json`
- `THIRD_PARTY_NOTICES.md`
- This report

## Validation

- `pnpm check`: PASS.
- `pnpm check:upstream`: PASS; pinned Viewer core remains unchanged.
- Viewer interaction provenance verifier: PASS (23 sources).
- `pnpm test:website`: **63/63 PASS**.
- `pnpm test:viewer`: **55/55 PASS**.
- `pnpm build`: PASS.
- `git diff --check` and Phase 3 local/upstream SHA-256 verification: PASS.

Browser tests cover delayed hover/focus and leave, rapid previews without growing
subscriptions, persistent selection, absence of duplicate cards, close/Escape/Tab
boundaries, marker switching, date/camera/coordinates/zero altitude, missing metadata,
correct image/title-to-Viewer activation, filter/sort sequence, mapPhoto retention,
Back/Forward, viewport restoration and 390px mobile/short-screen bounds. Failed
thumbnails retain thumbhash in pin and card; original-equal/missing sources have a
separate rendering guard test. Existing native cluster expansion, error fallback
and MiniMap URL/history tests pass.

The 480-photo browser test preserves fewer than 150 visible native markers,
deduplicates IDs during pans, releases retired card text subscriptions and returns
to the pre-map motion subscription count on close, with zero original requests.
The existing 1,000-candidate registry test passes unchanged.

Fixture improvements remain in tests: Carto font requests are stubbed locally,
and the reduced-motion Viewer swipe travels beyond the long-swipe threshold so
its expected result is independent of packet timing. No Viewer engine or MiniMap
implementation change was needed.

Final logs and desktop/mobile screenshots stay in `.cache/map-phase3-*`, without
changing production Projects/photos or tracked audit reports.

## Deferred to P4/P5

Cluster Marker visual redesign, Cluster Photo Grid and Cluster Hover Card remain
unimplemented. Map Controls, Map Info Panel, whole-map layout, clustering replacement
and MiniMap refactoring also remain outside Phase 3. Native clustering and click
expansion, P0 MiniMap, P1 map navigation/URL/history, P2 pin visuals/selection, filters,
viewport restore and error fallback are retained.
