# Afilmory Viewer interaction sources

Source: https://github.com/Afilmory/Afilmory

Pinned and checked against upstream HEAD on 2026-09-12:
`1f65cde6672e5231599182620116ac904e39f548`.

Copyright (c) 2025 Afilmory Team. The complete upstream Attribution Network
License (ANL) v1.0, including MIT, AGPLv3 and the §4 attribution terms, is
preserved in [licenses/AFILMORY-LICENSE](licenses/AFILMORY-LICENSE).
The public copy is `public/licenses/afilmory.txt`. Photographs retain their
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
