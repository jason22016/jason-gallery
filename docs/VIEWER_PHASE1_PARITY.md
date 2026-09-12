# Phase 1 — Photo Viewer Interaction Core Parity

2026-09-12 · Upstream `Afilmory/Afilmory@1f65cde6672e5231599182620116ac904e39f548`.
HEAD was resolved from GitHub, then the complete referenced files were read and
compared against the local worktree. No external checkout is needed by the app.

## Before migration: source comparison

| Source | Afilmory current implementation | Jason starting implementation | Migration |
| --- | --- | --- | --- |
| PhotoViewer.tsx | Swiper Navigation + Virtual; all mobile motion channels; deferred entry stage/catch-up; active slide rendering | A single `PhotoMedia key=photo.id`; pointer distance decides when to replace the photo | Swiper owns slidePrev/Next/To and active index; Project continues owning URL and sequence |
| GalleryThumbnail.tsx | 48/64px height, proportional widths, TanStack horizontal virtualizer, centering, wheel translation, spring, HoverCard | All items mounted, fixed 68×60px crops; scrollIntoView; no spring | Direct component migration with local model/CSS and accessibility adapters |
| MobilePhotoInspectorSheet.tsx | Persistent MotionValue-driven shell; y/opacity/scale from createInspectorSheetPresentation; viewport height clamping | Conditional `mobile-inspector` aside | Direct shell/presentation migration; existing MetadataPanel content |
| ProgressiveImage.tsx | Current/neighbor lifecycle; thumbnail cache/visual-ready signal; high-res only active/current and visible | Single renderer unmounts every time photo ID changes | Lifecycle adapter around extracted, preserved PhotoMedia; neighbor thumbnails and one active GPU/original |
| PhotoViewer.css | Swiper touch handling and component utilities | Layout/filmstrip/mobile inspector in gallery.css | Scoped upstream CSS plus plain CSS equivalents for utility classes; obsolete Viewer rules removed |
| viewer-motion | 11 production TS/TSX files plus 3 tests | All 11 production files already byte-identical, older provenance commit; most output channels unused | Current source/test sync, complete wiring; reduced-motion and unmount cleanup adapter |
| useMobile.ts | `width < 1024 && width !== 0` | Viewer used `<768 OR coarse pointer`; Gallery width-based density independent | Viewer, thumbnail and inspector use the same hook; no iPad or coarse-pointer override |
| ProjectGallery / PhotoThumbnail / MetadataPanel | Upstream app owns global photo list, EXIF/social services | Jason owns Project filters, history, scroll/focus, hex ThumbHash, lazy metadata | Preserved; the Viewer interface remains project-scoped. No home, card, hover, list, header, map, admin, sync or theme redesign |

## Interaction and lifecycle details

- Swiper Virtual can emit slideChange during a drag, before touchend. Publishing
  that event immediately unmounted the old GPU/fallback DOM target and lost native
  touchend. The adapter forwards Swiper's final active index after the native
  gesture ends; horizontal motion itself remains entirely Swiper-driven.
- `dismissX`, `viewerLiftY`, `viewerScale`, `viewerRotate`, `viewerBorderRadius`
  transform the whole media/chrome/thumbnail stage, with the upstream 50% 18% origin.
  Backdrop/chrome/thumbnail/hint values are bound to their corresponding elements.
- Sheet stays mounted, follows inspectorProgress, is inert when closed, and lazily
  mounts Jason metadata when interactive. Its scroll area remains native pan-y.
- Swiper touch movement is disabled while zoomed, pinching, handling a vertical
  gesture or showing the Sheet. Document pointer cleanup survives active renderer
  replacement. Document keyboard handling survives Swiper blurring the prior control.
- Shared transition uses the local upstream hook/preview, thumbnail + ThumbHash,
  entry catch-up state, real visual readiness and projected mobile exit frames.
  High-res handoff still waits for the GPU's first completed frame. A failed
  thumbnail releases catch-up so original retry controls cannot become invisible.
- Original/blob downloading, HEIC/TIFF conversion, HDR reconstruction, WebGL/WebGPU
  shaders and native-image zoom fallback are preserved. PhotoMedia was extracted
  from the old Viewer; only its lifecycle inputs/panning/reduced-motion wiring changed.
- Reduced motion skips shared-element/spring/slide settling animations, keeps
  gestures available, uses zero-duration Swiper navigation and immediate Sheet
  settling, and disables GPU double-tap interpolation.

## Deliberate differences

Jason keeps a native dialog, Project sequence/filter/URL/history owner, lazy
MetadataPanel, toolbar labels, original/share/zoom controls, renderer fallback and
current appearance. Afilmory's cloud comments, reactions, regions and video UI
are outside this phase. Styles are plain scoped CSS instead of importing the
entire upstream application/Tailwind environment. Small adapters cover native
touch target lifetime, dialog HoverCard portal, ResizeObserver, reduced motion
and error reachability. Thumbnail backdrop blur is kept on a separate background
pseudo-element: applying it directly to the animated thumbnail parent reproducibly
stalled Chromium Graphite/SwiftShader requestAdapter; the separate layer retains
the material while restoring real WebGPU HDR initialization.

The Viewer and related UI use the upstream 1024px mobile cutoff; iPad portrait
below 1024 gets the Sheet, and wide iPad landscape gets desktop layout, just as
upstream. Non-Viewer Gallery layout and header CSS remain outside the change.

The upstream license distinguishes MIT library code from AGPL application code.
The migrated app components retain AGPL-3.0-or-later + ANL §4 notices, with a
visible source/license attribution in Viewer information. See
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) for all copied/adapted files,
licenses and upstream hashes; the complete source diff is
`patches/afilmory-viewer-interactions.patch`.

## Reproducibility boundary confirmed by the user

All Viewer runtime TypeScript and all @afilmory package sources are in this
repository. Dependencies come from pinned npm registry resolutions and workspace
links. No submodule, external clone import or source download is used.

The user explicitly chose to retain the existing pre-synchronized photo-data
requirement. `src/data` manifests/index and `public/thumbnails` remain ignored,
unchanged generated inputs. A fresh clone must supply those existing photo
inputs before building; this phase does not add 38 MB of generated assets to Git
or change the photo sync/build pipeline.

## Verification

Completed on 2026-09-12 with Node 24.19.0, pnpm 11.19.0 and Chromium
151.0.7922.34. All required commands exited successfully:

| Gate | Result |
| --- | --- |
| `pnpm check` | Pass |
| `pnpm test:viewer` | 44 passed, 0 failed; includes 13 migrated upstream motion tests |
| `pnpm test:website` | 29 passed, 0 failed |
| `pnpm build` | Pass; 4 pages from the existing synchronized photo inputs |
| `pnpm check:upstream` | 16 renderer source records verified; existing reviewed adapter retained |
| `node --import tsx scripts/upstream/check-viewer-interactions.ts` | All 23 localized interaction source records verified; also checked against the pinned upstream checkout during development |
| Source whitespace check | Pass; excludes byte-preserved upstream licenses and generated patch context, which intentionally retain their original whitespace |

The browser tests cover native touch drags sampled before release, linked
MotionValues, partial Sheet presentation, pinch/cancel/reset, 180-photo thumbnail
virtualization, centering/resize/wheel/HoverCard, reduced motion,
entry/exit/thumbnail handoff, and production Project history/scroll/focus.
Back/Forward followed by Escape is covered, including a nonzero opening scroll
position and focus restoration after thumbnail and keyboard navigation. HDR
tests run actual WebGPU reconstruction on a software GPU; dynamic-range media
capability is simulated. Physical iOS/Android devices were not tested.

An independent directory was populated from the 357 candidate repository files,
without `.git`, the existing `node_modules`, or any upstream checkout. Only the
user-approved pre-synchronized photo inputs were added. A fresh
`pnpm install --frozen-lockfile --offline` using the existing registry package
cache, followed by `pnpm build`, passed on the final source (4 pages). This
verifies self-contained runtime source; it does not claim that unsynchronized
photo data is present in a fresh clone.

Production Projects, manifests and thumbnails are hash-checked before and after
the website suite and were unchanged. Build output retains the existing warning
about chunks larger than 500 kB; no code splitting or image pipeline redesign
was introduced in this phase.
