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
