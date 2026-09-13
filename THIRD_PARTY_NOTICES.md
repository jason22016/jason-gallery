# Afilmory Viewer interaction sources

Source: https://github.com/Afilmory/Afilmory

Pinned and checked against upstream HEAD on 2026-09-12:
`1f65cde6672e5231599182620116ac904e39f548`.

Copyright (c) 2025 Afilmory Team. The complete upstream Attribution Network
License (ANL) v1.0, including MIT, AGPLv3 and the §4 attribution terms, is
preserved in [licenses/AFILMORY-LICENSE](licenses/AFILMORY-LICENSE).
The public copy is bundled from `src/assets/licenses/afilmory.txt` into a hashed `_astro` asset. Photographs retain their
owners' separate rights.

Application code from `apps/web` is Project Code under **AGPL-3.0-or-later
with ANL §4 additional terms**. It is not represented as MIT. Reusable
`viewer-motion` and UI library source remains MIT Library Code. The Viewer
information panel displays the upstream attribution, source and license links.
Changes below were made on 2026-09-12. Exact upstream/local hashes are in
[licenses/viewer-interaction-upstream.json](licenses/viewer-interaction-upstream.json).

| Local file | Original upstream path | Adaptation |
| --- | --- | --- |
| `src/components/viewer/PhotoViewer.tsx` | `apps/web/src/modules/viewer/PhotoViewer.tsx` | Swiper + Virtual, all mobile MotionValues, projected exit, entry state and slide animation structure transplanted into Jason's native dialog and Project callbacks. Retains keyboard/focus/scroll/URL integration. Defers publication of Virtual's mid-drag index until native touchend so the active renderer's DOM target survives. Replaces cloud social/regions/inspector UI with Jason metadata and controls. |
| `src/components/viewer/GalleryThumbnail.tsx` | `apps/web/src/modules/viewer/GalleryThumbnail.tsx` | Direct component migration: local photo fields and CSS classes, preserved virtualizer/centering/wheel/spring/HoverCard behavior. ResizeObserver replaces element resize listener; cancels pending frame; avoids recentering on unrelated wheel scroll; reduced-motion and accessible button labels/tab stops. |
| `src/components/viewer/MobilePhotoInspectorSheet.tsx` | `apps/web/src/modules/viewer/MobilePhotoInspectorSheet.tsx` | Copies presentation transforms, viewport height, focus handling and shell. Jason MetadataPanel replaces cloud EXIF/comments tabs; local icons/CSS; closed sheet stays mounted and inert. |
| `src/components/viewer/ProgressiveImage.tsx` | `apps/web/src/modules/viewer/ProgressiveImage.tsx` | Extracts active/neighbor and thumbnail visual-readiness lifecycle, retaining Jason PhotoMedia for GPU/HDR/converted-Blob/native fallback. Only active slides load originals/own GPU. Thumbnail error releases catch-up so retry remains reachable. |
| `src/components/viewer/entry-animation-state.ts` | `apps/web/src/modules/viewer/entry-animation-state.ts` | Byte-for-byte copy. |
| `src/components/viewer/PhotoViewer.css` | `apps/web/src/modules/viewer/PhotoViewer.css` | Copied and scoped to native dialog. Responsive Viewer cutoff aligned to 1024px. Appends plain CSS equivalents for upstream utility classes and Jason's existing color treatment. Thumbnail backdrop blur uses a separate pseudo-element to avoid Graphite/SwiftShader GPU initialization stalls. |
| `src/hooks/useMobile.ts` | `apps/web/src/hooks/useMobile.ts` | Same `width < 1024 && width !== 0` decision; local viewer-motion viewport hook replaces app store. No coarse-pointer or iPad exception. |
| `src/components/viewer/HoverCard.tsx` | `packages/ui/src/hover-card/index.tsx` | Radix/Motion component; portal explicitly targets the native dialog top layer; local CSS and reduced motion. |
| `src/components/viewer/Thumbhash.tsx` | `packages/ui/src/thumbhash/index.tsx` | Uses Jason's validated native hex decoder, catches malformed hashes, decorative alt text. |
| `packages/afilmory/viewer-motion/src/*` | `packages/viewer-motion/src/*` | All 11 production files and 3 upstream tests copied. Production sources were already byte-identical to current upstream. Added optional reducedMotion support and unmount animation cleanup to mobile hook/types; one type annotation in upstream test for Jason strict TS. |

`packages/afilmory/viewer-motion/LICENSE` preserves the complete upstream license;
the package manifest's MIT designation and TypeScript source exports are retained.
`licenses/viewer-motion-files.json` records the package separately.

`PhotoMedia.tsx` is the extracted existing Jason renderer integration, not a copy
of upstream ProgressiveImage. New inputs update GPU panning while unzoomed on
mobile, disable double-click animation under reduced motion, and report Blob
source to the shared transition. Renderer algorithms/shaders, image loader,
conversion, metadata extraction and photo build/sync are unchanged.

Previously localized `webgl-viewer`, utils, typing, builder and renderer packages
retain their existing notices and source records in `licenses/README.md` and
`licenses/viewer-upstream.json`. Swiper 12.2.0, TanStack React Virtual 3.14.3 and
Radix HoverCard 1.1.23 are pinned registry dependencies with their distributed
licenses. There is no runtime dependency on an Afilmory checkout, GitHub package,
submodule or downloaded source.

## Phase 2 — Viewer Visual & Inspector Parity

Upstream HEAD was reverified on 2026-09-12 as
`1f65cde6672e5231599182620116ac904e39f548`.
The complete normative design document is localized at
`docs/viewer/AFILMORY_DESIGN.md`. All application source below is
**AGPL-3.0-or-later + ANL §4**, with the same Afilmory Team copyright and
full license above, except the explicitly identified MIT UI primitives.

| Local file | Upstream source | Migration / adaptation |
| --- | --- | --- |
| `src/components/viewer/HistogramChart.tsx` | `apps/web/src/modules/metadata/HistogramChart.tsx` | Migrates 128 bins, Rec.709 luminance, DPR canvas, cached gradient strips, grid and screen-composited RGB renderer. Uses semantic material tokens, the normative Spring preset, ResizeObserver, reduced motion, accessible Chinese loading/error/legend text and thumbnail sampling. No full-resolution/HDR renderer changes. |
| `src/components/viewer/ExifSection.tsx` | `apps/web/src/modules/metadata/ExifSection.tsx`; `formatExifData.tsx` (Row) | Section/row structure translated to scoped CSS, semantic `dl/dt/dd`, 12px values per DESIGN.md. Long values wrap without losing information. |
| `src/components/viewer/MetadataPanel.tsx` | `apps/web/src/modules/metadata/ExifPanel.tsx` | Section ordering, capture chips, tags, tone grid and film recipe order. Retains Jason metadata fetch/cache, source units, descriptions, all recipe extras and raw technical fields. |
| `src/components/viewer/DesktopInspector.tsx` | `apps/web/src/modules/inspector/InspectorPanel.tsx`; `metadata/ExifPanel.tsx` | 320px panel, material gradient/glow, faint layered shadows, header and smooth spring entry/exit. Native scroll viewport; animated width; exit subtree inert. Jason has no cloud comments tab. |
| `src/components/viewer/ViewerBackdrop.tsx` | `apps/web/src/modules/viewer/PhotoViewer.tsx` (backdrop/thumbhash presence blocks) | Keyed concurrent ThumbHash fades over opaque material. Native hexadecimal hash decoding; decoded thumbnail fallback holds the prior background while loading; late loads cancelled. Jason uses a 60% hash wash. The opaque base stays solid during inspector presentation; dismiss opacity still follows the original gesture. |
| `src/components/viewer/MiniMap.tsx` | `apps/web/src/modules/metadata/MiniMap.tsx` | Same 160px, zoom-15, noninteractive MapLibre map and centered marker. Reuses installed MapLibre directly instead of react-map-gl/router; local style JSON; initializes when scrolled into view, handles resize/failure/unmount, accepts valid zero coordinates, retains OSM/CARTO attribution and external OSM links. |
| `src/components/viewer/MapLibreStyle.json` | `apps/web/src/components/ui/map/MapLibreStyle.json` | Byte-for-byte local copy of the built-in Dark Matter style. Remote URLs deliver map data, glyphs and sprite assets, never application source. |
| `src/components/viewer/CaptureIcons.tsx` | `apps/web/src/icons/index.tsx` | Direct copy of the first five capture-parameter icons, retaining embedded source credits. Tabler (Paweł Kuna, MIT), Carbon (IBM, Apache-2.0), Material Symbols (Google, Apache-2.0), Streamline (Streamline, CC BY 4.0: https://creativecommons.org/licenses/by/4.0/). |
| `src/components/viewer/color.ts` | `apps/web/src/lib/color.ts` | Copies average-color extraction and 2.2–4.5 contrast clamp; uses Jason's validated hexadecimal ThumbHash decoder. |
| `src/components/viewer/ActionButton.tsx` | `packages/ui/src/button/ActionButton.tsx` (MIT) | Preserves props/structure; utility styles translated to scoped CSS. Accent focus ring follows DESIGN.md instead of the legacy blue focus helper. |
| `src/components/viewer/PhotoViewer.css`, `ViewerTokens.css` | `PhotoViewer.css`, `ExifPanel.tsx`, `InspectorPanel.tsx`, `GalleryThumbnail.tsx`, `apps/web/src/styles/tailwind.css`, `packages/ui/src/container/LinearBorderContainer.tsx`, `packages/ui/src/divider/LinearDivider.tsx` (last two MIT) | Local semantic CSS; dark-only chrome, normative blur/radius/layering, fading 0.5px structural edges, faint accent shadows. No unassigned blur sizes, light theme branch or spatial CSS tweens. |

Phase 1's previously localized `PhotoViewer`, `MobilePhotoInspectorSheet`,
`GalleryThumbnail`, `HoverCard` and `Thumbhash` remain in use. The thumbnail
selection scale now uses Spring, mobile chrome has 32px circles with invisible
44px hit targets, and the existing shared-frame calculator reads the actual
strip height/sidebar width to include safe areas and an Inspector mid-animation.
The Swiper/gesture/history engine and all HDR/WebGL rendering source are unchanged.
Updated local hashes and separate Phase 2 provenance are recorded in
`licenses/viewer-interaction-upstream.json` and `licenses/viewer-visual-upstream.json`.

### Additional localized assets

- `ViewerTokens.css`: dark macOS values from `tailwindcss-uikit-colors@1.0.0`,
  `src/v4/macos.css`, by Innei. The distributed readme states “2025 © Innei,
  Released under the MIT License.” Package metadata and the standard MIT grant
  are retained in `licenses/UIKIT-PACKAGE.json` and `licenses/UIKIT-LICENSE`.
- `ViewerIcons.css`: selected, unmodified MingCute SVG bodies from
  `@iconify-json/mingcute@1.2.8`, baked into CSS masks for the upstream
  `i-mingcute-*` icon system. MingCute Design, Apache-2.0;
  `licenses/MINGCUTE-LICENSE`, source https://github.com/Richard9394/MingCute.
  No runtime icon fetch or extra lucide dependency.
- `src/assets/fonts/geist-*-wght-normal.woff2`: Geist Latin and Latin Extended
  variable fonts, copied from `@fontsource-variable/geist@5.3.0`.
  SIL Open Font License 1.1 retained in `licenses/GEIST-OFL.txt`.
  Loaded locally and applied only to Viewer/Inspector.

## Phase 3 — Project Gallery / Masonry Parity

Source repository: **https://github.com/Afilmory/Afilmory**.
HEAD checked with `git ls-remote` on 2026-09-12:
**`1f65cde6672e5231599182620116ac904e39f548`**.
Copyright (c) 2025 Afilmory Team. The existing complete license is
[licenses/AFILMORY-LICENSE](licenses/AFILMORY-LICENSE).
Application source below is **AGPL-3.0-or-later + ANL §4**; the LinearBlur
primitive is **MIT**. The authoritative DESIGN.md was read in full and is
preserved unchanged at `docs/viewer/AFILMORY_DESIGN.md` (CC BY 4.0).
The Project information panel and its no-JavaScript equivalent now reuse the
existing legal notice, source links and public license. Changes made 2026-09-12.

| Local file | Upstream path | Adaptation |
| --- | --- | --- |
| `src/components/gallery/MasonryView.tsx` | `apps/web/src/modules/gallery/MasonryView.tsx` | Migrates 150/250px automatic target widths, 120–250 / 200–500px manual target bounds, max 8 columns, 4px gutters, 400px estimate. Uses the existing 1024px `useMobile`, Project settings and measured inner container width including safe areas. |
| `src/components/gallery/Masonic.tsx` | `apps/web/src/modules/gallery/Masonic.tsx` | Local `usePositioner` / `useMasonry` composition. Uses masonic's 12fps window `useScroller`, preserving Jason's window-scroll Viewer restoration. Seeds all heights from aspect ratios; removes per-image measurement; creates a fresh native positioner on resize so zero/old-width cached heights cannot preserve incorrect column assignments. A stable outer ResizeObserver avoids masonic's first-mount keyed-node replacement. Resets on filters/reordering; sorts rendered DOM by Project index and adds virtual-list position semantics. Overscan remains 2 (one viewport behind, two ahead). |
| `src/components/gallery/MasonryPhotoItem.tsx` | `apps/web/src/modules/gallery/MasonryPhotoItem.tsx`, `apps/web/src/modules/media/HDRBadge.tsx` | Migrates card structure, full-image gradient, title/description/file details, tag pills, four capture chips and >=200px EXIF rule. Tailwind group hover becomes equivalent scoped CSS, with 1.05 scale / 300ms image transition as explicitly requested. Adds bounded description/tag overflow for small cards, keyboard focus reveal, reduced motion, link semantics and both upstream/Jason shared-trigger attributes. Reuses unchanged local CaptureIcons. HDR badge uses a pill, hairline and 12px backdrop blur per DESIGN.md. |
| `src/components/gallery/media/useLivePhoto.ts` | `apps/web/src/modules/gallery/MasonryPhotoItem.tsx`, `apps/web/src/lib/image-loader-manager.ts` (`processVideo`, `loadDirectVideo`, `convertVideo`) | Extracts gallery video lifecycle into a hook with a 200ms desktop hover delay, ready/playing/loading/error states, end/leave reset, and lazy local extraction/MOV modules. Adds request aborts, timeout, event/timer/Blob cleanup, rejected-play handling, late-load guards, tab visibility handling and reduced-motion/mobile autoplay suppression. Uses the shared mobile breakpoint. |
| `src/components/gallery/media/motion-photo-extractor.ts` | `apps/web/src/lib/motion-photo-extractor.ts` | Direct migration of Range extraction, full-file fallback, ftyp validation and Blob ownership. Adds AbortSignal and HTTP failure checking. Source offsets and sizes are unchanged. |
| `src/components/gallery/media/mp4-utils.ts` | `apps/web/src/lib/mp4-utils.ts` | Copies upstream's lossless MP4-MIME Blob adaptation for MOV. Replaces i18n calls with Chinese status and adds AbortSignal. As in upstream, this changes the MIME/container handoff, **does not transcode unsupported video codecs or rebuild MOV boxes**. |
| `src/components/gallery/PageHeader.tsx` | `apps/web/src/modules/gallery/PageHeader/{index,PageHeaderLeft,PageHeaderRight}.tsx` | 48px header and 60px progressive fade; Project home/title/count replace avatar/site/social/auth data. 12/16px responsive padding, semantic materials, dense type, MingCute icons, accessible dialog triggers. Mobile controls float at the bottom to retain every Jason action and the segment without compressing the title. |
| `src/components/gallery/ViewModeSegment.tsx` | `apps/web/src/modules/gallery/PageHeader/ViewModeSegment.tsx` | Migrates shared `segment-indicator` layoutId and `Spring.presets.snappy`; scoped `LayoutGroup`, `LazyMotion/domMax`, local settings callbacks, Chinese accessible labels, pressed state and reduced motion. Normalizes container/item radii and material/blur. |
| `src/components/gallery/FloatingActionButton.tsx` | `apps/web/src/modules/gallery/FloatingActionButton.tsx` (`GlassButton`), `PageHeader/utils.tsx` (`ActionIconButton`) | Combines the button presentation with Jason's existing actions. Uses normative 32px controls, 40px panel blur, semantic text/fill/accent, faint layered shadows and low-opacity edges. The old 56px radial/goo animation, z-50, solid black and hard shadow are not migrated. |
| `src/components/gallery/ui/LinearBlur.tsx` | `packages/ui/src/progressive-blur/index.tsx` (MIT) | Copies masks, geometric blur progression, tint glow and directional positioning to local CSS. Adds the missing first strength layer so the normative default has 8 layers including 128px; preserves DOM stacking without unassigned z-index values. Handles the one-step divisor. |
| `src/styles/gallery.css` | Gallery card, PageHeader, ViewModeSegment and FloatingActionButton utility styles above; `DESIGN.md` | Scoped plain CSS translation. Project chrome is dark-only; edge padding, material, hierarchy, reduced motion and safe-area treatment follow DESIGN.md. Existing List content and panel/map business logic are retained. |

`PhotoThumbnail.tsx` retains Jason's validated native hexadecimal ThumbHash
and original thumbnail URLs/dimensions; it now reports visual readiness to the
card and uses a 300ms reveal with a fixed layout and a localized image error icon.
`gallery/photos.ts` is the small Project display-data adapter: adds native video,
aspect ratio and preformatted capture values without exposing full EXIF or
changing the Viewer data contract, renderer, sync or build pipeline.

`GalleryTokens.css` duplicates only the already-localized MIT macOS semantic
palette and Geist font declarations under `.gallery-page`; the Viewer is untouched.
`GalleryIcons.css` bakes selected original SVG bodies from
`@iconify-json/mingcute@1.2.8` (MingCute Design, Apache-2.0), with the existing
`licenses/MINGCUTE-LICENSE`. Upstream's obsolete `image-line` is mapped to the
current `pic-line` asset. Geist files and OFL notice remain unchanged.

Exact upstream/local source hashes are recorded in
[licenses/gallery-upstream.json](licenses/gallery-upstream.json).
All executing source lives in this repository. The upstream checkout was used
only for comparison; no submodule, GitHub source import, external checkout path,
runtime source download or new production package dependency was added.

`tests/gallery/live.mp4` and the real QuickTime-container `live.mov` are synthetic 1.5-second test patterns generated locally
with FFmpeg's `testsrc2` and H.264 encoder, not a third-party photograph/video.

`ui/useReducedMotion.ts` is a Gallery-only reactive media-query adapter. It uses
React's external-store subscription because the installed Motion hook captures
only its mount-time preference. The native indicator branch avoids residual layout
projection when reduced motion changes during a session; live playback stops too.

## Phase 4 — Secondary Gallery UI (2026-09-13)

Pinned upstream remains `Afilmory/Afilmory@1f65cde6672e5231599182620116ac904e39f548`.
The complete `DESIGN.md` was checked against the retrieved upstream file before migration.
`licenses/gallery-upstream.json` records per-file source hashes and explicit adaptations for
`ListView`, `CommandPalette`/`SearchPanel`, `FilterChip`, `ViewPanel`/`SortPanel`/`ColumnsPanel`,
`ActionPanel` and PageHeader surface composition. Application derivatives retain
AGPL-3.0-or-later + ANL §4 attribution already displayed in Project Info and Viewer.

The local `EllipsisWithTooltip` and `LinearDivider` adapters derive from `packages/ui`
(MIT, Copyright (c) Afilmory Team). Panel surfaces also adapt the upstream MIT dropdown
primitive's material/border/shadow styling; product composition retains the application license.
Radix Dialog, Popover, Tooltip and Vaul are exact-version registry dependencies stored by the
normal local package installation. All application source is in this repository; there is no
runtime source download, source import from an external clone, or submodule.

`src/styles/photo-tokens.css` consolidates the existing MIT UIKit color definitions and
OFL Geist font declarations. It is scoped to Project Gallery and Viewer. The additional
locally embedded MingCute glyphs retain the existing Apache-2.0 notice. The reference document
remains CC BY 4.0 as credited in the Phase 2 notice.

DESIGN.md takes precedence over the referenced legacy implementations: neutral/light-dark
pairs, Lucide imports, off-role blur, arbitrary z-index, pointer-only slider behavior, and
spatial CSS tweens were not carried into the new components. The Vaul drawer shell uses
Motion springs in place of Vaul's default CSS easing. Source provenance records for the
existing Viewer CSS were updated only for the reviewed token and minimap status changes.

Final parity audit (2026-09-13) verified the same upstream HEAD and DESIGN.md. The mobile
header now follows upstream's top action group and desktop-only view segment/map shortcut;
mobile view and map actions remain in Settings/Search. The desktop Inspector starts collapsed
per DESIGN.md §8.1, taking precedence over upstream's default-open state. Only these reviewed
Gallery/Viewer adaptations have updated provenance hashes.

## Map Phase 1 — MiniMap to Project Map

Current `Afilmory/afilmory` main was checked on 2026-09-13 at
`1f65cde6672e5231599182620116ac904e39f548`. The full upstream `DESIGN.md`
was read before modification and matches `docs/viewer/AFILMORY_DESIGN.md`.
Copyright (c) 2025 Afilmory Team; application derivatives retain
**AGPL-3.0-or-later + ANL §4** and the existing complete
[license](licenses/AFILMORY-LICENSE), Project/Viewer attribution and source links.

- `gallery/map-state.ts` adapts `modules/map/MapSection.tsx`'s URL photo ID →
  validated GPS → initial view at zoom 15. Jason resolves only visible Project
  photos and uses its existing validated location adapter, including valid zero
  coordinates, instead of the global photo loader and EXIF-only conversion.
- `gallery/MapNavigation.tsx`, `viewer/MiniMap.tsx` and `viewer/MetadataPanel.tsx`
  adapt the upstream MiniMap's photo-specific internal map link. A colocated
  context and native same-document anchor navigation replace React Router and
  the upstream new-tab default. Native modified-click navigation remains usable.
  P0 map style, lazy initialization, resize, error fallback and provider credits
  are preserved. OpenStreetMap remains a secondary external link.
- `gallery/ProjectGallery.tsx` and `gallery/PhotoMap.tsx` adapt the controlled
  `selectedMarkerId` / `initialViewState` pattern of MapSection and GenericMap.
  Jason retains direct MapLibre, native History, Project filters, viewport memory,
  marker-to-Viewer behavior and all existing clustering/controls/error handling.
  The independent `mapPhoto` state is exposed to the map and accessible photo list;
  photo marker visuals and hover cards remain deferred.

No production dependency, CSS, Viewer motion engine or upstream map clustering
algorithm was added or changed. Reference and adapted-file SHA-256 values are in
[licenses/map-phase1-upstream.json](licenses/map-phase1-upstream.json).
The existing visual provenance record updates only the two changed metadata files.

## Map Phase 2 — Photo Marker Pin

Current `Afilmory/Afilmory` main was verified on 2026-09-13 at
`1f65cde6672e5231599182620116ac904e39f548`. `DESIGN.md` was read first and
matches the existing `docs/viewer/AFILMORY_DESIGN.md`. Copyright (c) 2025
Afilmory Team; application derivatives retain **AGPL-3.0-or-later + ANL §4**,
the complete [license](licenses/AFILMORY-LICENSE), and existing visible
Project/Viewer attribution and source links.

| Local file | Upstream source / pattern | Adaptation |
| --- | --- | --- |
| `src/components/gallery/map/PhotoMarkerPin.tsx` | `apps/web/src/components/ui/map/shared/PhotoMarkerPin.tsx`; `shared/types.ts`; `packages/ui/src/lazy-image/index.tsx` | Migrates the pin subtree: scale-in, 1.1 hover, 0.9 press, selection ring, circular thumbnail, material, glass overlay, MingCute camera and inner depth layer. Uses an accessible native button, controlled selected state, keyboard focus, reduced motion, and native lazy images with Jason's validated hexadecimal Thumbhash. No cards or original-image fallback. |
| `src/styles/gallery.css` (photo-marker rules) | PhotoMarkerPin utility styles; `DESIGN.md` §§2–4, 6–7, 12 | Plain CSS adapter: 40px circles, 40% image opacity, 12px control blur, hairline, existing material/accent tokens, faint shared shadows, selected outer 8px ring with a 2s opacity pulse. The legacy green wash, neutral ramp, light/dark pairs and heavy shadows are replaced by normative semantic materials. Uses existing `Spring.presets.snappy` instead of the legacy inline stiffness/damping; reduced motion disables scale gestures and pulse. |
| `src/components/gallery/PhotoMap.tsx`; `ProjectGallery.tsx` | `components/ui/map/MapLibre.tsx` controlled `selectedMarkerId` / `onMarkerClick`; `shared/clustering.ts` selected-photo independence | Retains native MapLibre clustering and expansion zoom. Only unclustered visible photos and the independent selected photo receive native HTML Markers, with React portals retaining the existing LazyMotion context. Excludes selected ID from the native source to avoid hiding or double-counting it; selection changes retain the map, viewport and marker instances while the source updates. Native History updates `mapPhoto` without opening Viewer. |
| `src/components/gallery/map/photo-marker-registry.ts` | Jason-specific native MapLibre bridge | New keyed lifecycle adapter: deduplicates source tile/world copies, reuses active instances, updates coordinates/selection, and removes retired markers on pan/zoom or teardown. No react-map-gl dependency. |

`photo-marker-card-behavior.ts`, map utilities, LazyImage, GlassButton and photo
accent extraction were also studied. HoverCard and anchored selected Card code
remain excluded for P3. Reference and adapted-file SHA-256 values are recorded in
[licenses/map-phase2-upstream.json](licenses/map-phase2-upstream.json).

## Map Phase 3 — Photo Marker Cards

Current `Afilmory/Afilmory` main was fetched and verified on 2026-09-13 at
`1f65cde6672e5231599182620116ac904e39f548`. The complete upstream `DESIGN.md`
was read before changes and matches `docs/viewer/AFILMORY_DESIGN.md` (CC BY 4.0).
Copyright (c) 2025 Afilmory Team. Application derivatives retain
**AGPL-3.0-or-later + ANL §4**, the full [Afilmory license](licenses/AFILMORY-LICENSE)
and existing visible Project/Viewer attribution and source links.

| Local file | Upstream source / pattern | Adaptation |
| --- | --- | --- |
| `gallery/map/photo-marker-card-behavior.ts` | `apps/web/src/components/ui/map/shared/photo-marker-card-behavior.ts` | Exact source copy: 400ms open, 100ms close, independent anchored selected card. The two upstream tests are migrated to `tests/website/photo-marker-card-behavior.test.ts`, changing only the import and removing an inapplicable ESLint directive. |
| `gallery/map/PhotoMarkerPin.tsx`; `PhotoMarkerCard.tsx` | `apps/web/src/components/ui/map/shared/PhotoMarkerPin.tsx`; `shared/types.ts` | Migrates HoverCard composition, shared card content, 320px width, 128px crop, 16px inset, title/arrow, date/camera/GPS/altitude rows, top anchor, 12px selected offset, close affordance and `.96`/4px entry. Existing shared Spring and semantic material/40px panel blur/16px radius take precedence over legacy styling. Native Marker portals replace react-map-gl; the existing Radix nonmodal Popover anchor escapes MapLibre clipping and follows map motion. Available top space constrains height, with scrolling and viewport collision handling. No outside/hover dismissal of selection. |
| `gallery/map/PhotoMarkerImage.tsx` | `packages/ui/src/lazy-image/index.tsx` (MIT) and the P2 image adapter | Shares thumbhash → native lazy thumbnail rendering between pin and card. Keeps Jason's hexadecimal hash decoder and error lifecycle. Rejects missing thumbnails and URLs equal to the original; no full-resolution fallback or metadata fetch. Delayed HoverCard mounting limits speculative loading. |
| `PhotoMarkerCard.tsx` close subtree | `packages/ui/src/button/GlassButton.tsx` (MIT) | Retains circular glass layers and 1.1/.95 spring gestures, with normative 32px size, 12px control blur, semantic tokens, keyboard name/focus and reduced motion. |
| `viewer/HoverCard.tsx` | `packages/ui/src/hover-card/index.tsx` (MIT), existing local adapter | Adds an optional reduced-motion input. Map previews reuse the pin's reactive preference without initializing Motion's permanent global media listener on first hover. The existing Viewer default and portal/motion behavior remain the same. |
| `PhotoMarkerCard.tsx` focus boundary | Jason native dialog/Panel focus model | Preserves the combined map/card Tab boundary while the persistent nonmodal Popover pauses the parent FocusScope. Removes its temporary keyboard listener and sizing frame when the card unmounts; Escape/Viewer ownership remains separate. |
| `gallery/PhotoMap.tsx`; `ProjectGallery.tsx` | Controlled selected-marker callbacks; existing Jason Viewer history owner | Full lightweight ViewerPhoto props supply preformatted date/camera and signed coordinates. The shared mobile breakpoint disables hover, while touch/keyboard selection use the same anchored card. Close pushes only a cleared `mapPhoto` state; card image/title anchors call the existing Viewer open flow. Viewer navigation and close preserve map/filter/sort context and viewport restoration. |
| `viewer/photos.ts`; `viewer/metadata.ts` | Jason display-data projection | Projects finite, signed EXIF altitude into an optional number, preserving zero and below-sea-level values without serializing full EXIF or changing the metadata formatter's behavior. |
| `src/styles/gallery.css`; `gallery/GalleryIcons.css` | Card/HoverCard/GlassButton utility styles; `DESIGN.md` | Scoped CSS and existing semantic material/blur/accent/shadow primitives. Adds only the original MingCute `mountain-2-line` SVG from `@iconify-json/mingcute@1.2.8`, retaining Apache-2.0 attribution and `licenses/MINGCUTE-LICENSE`. |

`packages/ui/src/hover-card/index.tsx` (MIT), LazyImage, GlassButton, map types,
`apps/web/src/hooks/usePhotoViewer.ts` and the Viewer/MapSection integration were
studied. The existing local HoverCard primitive is reused with the optional
reduced-motion input described above.
No production dependency, alternate photo page, clustering algorithm or Cluster UI
was introduced. Source and adapted-file SHA-256 values are recorded in
[licenses/map-phase3-upstream.json](licenses/map-phase3-upstream.json); overlapping
prior provenance entries point to this reviewed Phase 3 adaptation.

## Map Phase 4 — Cluster Marker and Photo Preview

Afilmory current main was read through the GitHub connector and verified on
2026-09-13 at `1f65cde6672e5231599182620116ac904e39f548`. The complete
`DESIGN.md` was read first and matches `docs/viewer/AFILMORY_DESIGN.md`.
Copyright (c) 2025 Afilmory Team. Application derivatives retain
**AGPL-3.0-or-later + ANL §4**, the full [license](licenses/AFILMORY-LICENSE),
and the existing visible Project/Viewer attribution and source links.

| Local file | Upstream source / pattern | Adaptation |
| --- | --- | --- |
| `gallery/map/ClusterMarker.tsx`; `cluster-preview.ts` | `apps/web/src/components/ui/map/shared/ClusterMarker.tsx`; `shared/types.ts` | Reuses the exact bounded logarithmic 40–64px size policy, circular 2×2 mosaic, 30% image opacity, count, 6px pulse ring, glass and inner layers, 1.05/.95 gestures, and 300/150ms HoverCard delays. Native MapLibre Marker hosts and existing React portals replace react-map-gl. Native buttons add keyboard focus and direct click/tap expansion. DESIGN.md overrides legacy neutral ramps, light/dark pairs, hard shadows and inline spring parameters. |
| `gallery/map/ClusterPhotoGrid.tsx` | `apps/web/src/components/ui/map/ClusterPhotoGrid.tsx` | Retains three-column square thumbnails, 8px gaps, 16px card inset, six-photo cap, +N tile, compact coordinates/date rows, and staggered `Spring.presets.smooth` entry. Jason's native count supplies the total and remainder. Preview cells are descriptive; activation of the cluster retains expansion. Capture range comes from native worker aggregates for all members rather than the six sample photos, and uses validated recorded calendar days. |
| `gallery/map/ClusterMarker.css` | ClusterMarker / ClusterPhotoGrid utility styles; `DESIGN.md` §§2–7, 12 | Scoped CSS with existing semantic accent/blue wash, material, 12px control blur, 40px panel blur, hairline and faint shared shadows. Reuses the existing opacity pulse; spatial motion uses shared Spring. Reduced motion disables spatial gestures, entry and pulse. Focus follows the semantic accent token. |
| `gallery/map/cluster-marker-registry.ts`; `gallery/PhotoMap.tsx` | Jason-specific native bridge; upstream `shared/clustering.ts` / `shared/types.ts` studied | Keeps native clustering and its existing radius. Deduplicates visible cluster IDs across source tiles/world copies, reuses marker instances, fetches four leaves once for mosaic and six on delayed preview, and retains data only for active markers. Pending requests deduplicate and cannot replace a larger sample. Generation and entry identity discard stale results after zoom, source update, retirement or teardown. Native `getClusterExpansionZoom()` still feeds `easeTo()`, with latest-click and lifecycle guards. Native `clusterProperties` min/max aggregate validated capture days without another clustering algorithm or full leaf scan. |
| `gallery/map/PhotoMarkerImage.tsx`; `viewer/HoverCard.tsx` (unchanged) | Existing P2/P3 adapters of MIT `packages/ui/src/lazy-image/index.tsx` / `hover-card/index.tsx`; shared Spring | Reuses thumbhash and lazy thumbnail rendering, including missing/original-equal guards; no original fallback or full metadata request. Reuses delayed Radix composition, collision positioning, material card styling and the caller's reactive reduced-motion preference. |

No dependency, Viewer, MiniMap, map controls, info panel, fullscreen or overall
layout changes are included. Upstream/source and adapted-file hashes are in
[licenses/map-phase4-upstream.json](licenses/map-phase4-upstream.json).

## Map Phase 5 — Immersive Project Map Chrome

Afilmory main was verified on 2026-09-13 at
`1f65cde6672e5231599182620116ac904e39f548`. The complete `DESIGN.md`
was read before implementation and matches `docs/viewer/AFILMORY_DESIGN.md`.
Copyright (c) 2025 Afilmory Team. Application derivatives retain
**AGPL-3.0-or-later + ANL §4** and [the full license](licenses/AFILMORY-LICENSE).
The existing visible Project/Viewer attribution and source links remain in place.

| Local file | Upstream source / pattern | Adaptation |
| --- | --- | --- |
| `gallery/Panel.tsx`; `gallery/map/MapExperience.css`; `gallery/PhotoMap.tsx` | `apps/web/src/modules/map/MapSection.tsx`; `MapLibre.tsx`; `GenericMap.tsx` | Reuses the full-area map with floating top-left back, top-right information and bottom-left controls. Jason keeps its Radix Dialog / Vaul Drawer, scroll lock, focus boundary, native MapLibre lifecycle and Project history. Desktop fills the viewport; mobile keeps the drawer handle, safe area and visual-viewport sizing. Entry uses the existing Spring presets and reactive reduced-motion preference, overriding legacy upstream tweens. |
| `gallery/map/MapControls.tsx` | `apps/web/src/components/ui/map/shared/MapControls.tsx` | Retains the grouped zoom controls, separate compass and geolocation glass groups, camera operations and location options (high accuracy, 10-second timeout, 60-second cache). A native Map instance replaces react-map-gl context. Zoom clamps to map limits; denied, unsupported or thrown location requests fail safely with a status message. Request identity prevents stale callbacks after retry, error or close. Reduced motion also disables native camera animations. |
| `gallery/map/MapInfoPanel.tsx`; `map-bounds.ts` | `apps/web/src/components/ui/map/MapInfoPanel.tsx`; `apps/web/src/lib/map-utils.ts` | Retains the icon/header/count, expandable Southwest/Northeast coordinate cards and exact approximate coverage formula (latitude span × longitude span × 111²). The Project title and filtered valid-GPS photos replace global photo-loader semantics. Coordinates are validated by the existing Jason helper, including zero and signed coordinates. |
| `gallery/map/MapBackButton.tsx` | `apps/web/src/components/ui/map/MapBackButton.tsx`; MIT `packages/ui/src/button/GlassButton.tsx` | Reuses upstream arrow placement, circular glass and smooth 1.1/.95 spring gestures. Uses the already migrated MIT `viewer/ActionButton.tsx` rather than introducing a duplicate button primitive. Invokes the existing Panel dismiss/history owner instead of navigating to the SPA root. |
| `gallery/map/MapLoadingState.tsx`; `MapPhotoList.tsx`; `gallery/ProjectGallery.tsx` | `apps/web/src/components/ui/map/MapLoadingState.tsx`; existing Jason fallback | Retains the centered location icon/title/description and spring entry with semantic colors. Preserves module failure, native MapLibre error, context loss, timeout, retry and no-GPS state. The existing lightweight photo list is normally collapsible and opens automatically on failure. Reuses existing EllipsisWithTooltip and lazy thumbnails. |
| `gallery/map/map-style.ts`; `viewer/MiniMap.tsx` | `apps/web/src/lib/map/style.ts`; existing migrated `apps/web/src/components/ui/map/MapLibreStyle.json` | Adapts the upstream shared getMapStyle entry point to Jason's existing built-in style. Both map sizes now request independent clones of the same unchanged, already verified Dark Matter configuration. No provider, pipeline or clustering change. |
| `gallery/map/MapExperience.css`; `GalleryIcons.css` | `DESIGN.md` §§2–8, 12; original MingCute icons | Reuses existing semantic material/accent/text/fill tokens, paired blur presets, faint shared shadows, LinearDivider, radius hierarchy and focus styles. Upstream map chrome's hard shadows, arbitrary blur, z-40/z-50 intra-surface layering, neutral ramps and raw white/black styling are adapted to the normative DESIGN rules. Adds the original `add-line`, `minimize-line`, `navigation-line`, `location-line` and `down-line` SVGs from Iconify's MingCute set (Apache-2.0); retains `licenses/MINGCUTE-LICENSE`. |

The already migrated `LinearBlur`, semantic material tokens, `Spring`,
`ActionButton`, `EllipsisWithTooltip`, `LinearDivider`, `useMobile` and
`useReducedMotion` were inspected. Existing page edge fades continue to use
`LinearBlur`; the map has no scrolling fixed header that needs another fade band.
No new dependency, independent map route, Viewer rewrite or photo system was added.
Source and adapted-file hashes are in [licenses/map-phase5-upstream.json](licenses/map-phase5-upstream.json).
