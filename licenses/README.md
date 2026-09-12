# Vendored library provenance

Upstream: https://github.com/Afilmory/afilmory at **a3db486b0a8f2572de3032eabdfce24e726e83f3**.

Only `src/` and package manifests from these library packages were extracted:

| Local directory | Upstream directory | Package |
| --- | --- | --- |
| packages/afilmory/builder | packages/builder | @afilmory/builder |
| packages/afilmory/typing | packages/typing | @afilmory/typing |
| packages/afilmory/utils | packages/utils | @afilmory/utils |
| packages/afilmory/renderer | packages/renderer | @afilmory/og-renderer |
| packages/afilmory/webgl-viewer | packages/webgl-viewer | @afilmory/webgl-viewer |
| packages/afilmory/viewer-motion | packages/viewer-motion | @afilmory/viewer-motion |

No `apps/`, backend, UI package, upstream media, or example photos were copied. Upstream tests and Markdown inside source folders were omitted. Per-file SHA-256 provenance (before and after patches) is in `afilmory-files.json`; the added, unmodified viewer-motion sources are recorded in `viewer-motion-files.json`.

Builder and Viewer package manifests declare MIT; the typing, utils and renderer code is reused as linked library code under Section 1/3 of the preserved root `AFILMORY-LICENSE` (Copyright 2025 Afilmory Team). Source files were scanned for SPDX, alternate licenses, copyright and external origin notices: no conflicting source-specific license was found. The Viewer’s own LICENSE is also preserved. `renderer/src/og/tweemoji.ts` retains its Twitter MIT notice and Satori origin comment; corresponding `TWEMOJI-LICENSE` (13.1.0) and `SATORI-LICENSE` (0.26.0) are included. OG rendering is not enabled or tested in Phase 1. Registry dependencies retain their own package licenses and exact resolutions in pnpm-lock.yaml. Photographs remain separately owned and are not included in these code licenses.

## Modifications

- `builder/src/path.ts`: absolute `JASON_GALLERY_PHOTO_WORKDIR`, with upstream default retained. Environment inheritance is standard Node behavior; Phase 1 uses the upstream in-process async worker pool, not cluster subprocesses.
- `builder/src/image/exif.ts`: type-only record assertion for dynamically selected ExifTool keys, to compile under strict TypeScript. No runtime algorithm change.
- Package manifests: source-only private workspace packages, exact dependency versions, expanded catalogs; utils is moved into Builder runtime dependencies and the previously root-hoisted `es-toolkit@1.47.1` is declared. Renderer gets actual Hono JSX, Satori and Resvg runtime dependencies; its two incorrect subpath exports now point to `src/og/`. Unused upstream `heic-to` is omitted; `heic-convert` remains. Build/release dev toolchains are not copied.
- `src/vendor-types.d.ts` is a local declaration for the untyped HEIC conversion dependency, not a change to upstream processing.

Patches are in `patches/`; ID generation, metadata processing, Manifest schema, gain-map detection and color reconstruction algorithms are unchanged.

## Phase 5 HDR / Color (2026-09-10)

`webgl-viewer/src/ImageViewer.tsx` now listens for `webglcontextlost` and routes it to its existing failure callback, removing the listener on cleanup. A real `WEBGL_lose_context` regression reproduced a blank canvas remaining in the loaded state after the load promise had resolved; the callback lets the website use its existing ordinary-image fallback. This six-line lifecycle patch is locally authored against the same pinned commit above, recorded in `patches/afilmory-hdr-color.patch`, with the updated local hash in `afilmory-files.json`. No package upgrade, shader, color conversion, HDR detection, or Manifest change is involved.

## UI redesign (2026-09-10)

`viewer-motion` is linked as MIT Library Code at the same pinned upstream commit. Its source files are unchanged; its local manifest exports TypeScript sources, pins Motion 12.38.0 and @use-gesture/react 10.3.1, and omits upstream build-only tooling. The root Afilmory license and copyright remain in `AFILMORY-LICENSE`.

The portfolio, gallery, metadata, and map application components are authored locally from the user-approved visual and interaction specification. No Afilmory `apps/web` components, Typecho theme code, reference-site logos or reference-site photographs are included. Masonic, Motion, Lucide, ThumbHash, and MapLibre are registry dependencies with pinned versions and their distributed licenses. The map loads CARTO's Dark Matter style, which supplies its own map attributions; the application leaves MapLibre's attribution control enabled. The preview uses the user's existing Photo Engine output in a separate ignored directory.

## Viewer loading alignment (2026-09-12)

The current Viewer baseline is **1f65cde6672e5231599182620116ac904e39f548**; `viewer-upstream.json` supersedes the original Viewer source hashes for synchronization checks. Fifteen core source files still match upstream byte-for-byte. `ImageViewer.tsx` retains the context-loss patch and adds renderer restart/first-frame handoff; `patches/afilmory-viewer-lifecycle.patch` records the complete wrapper difference against this baseline (do not also apply the historical HDR patch).

The reusable image-loading/conversion modules under `src/lib` are adapted from Afilmory's `apps/web/src/lib/image-loader-manager.ts` and `image-convert/` library modules; their source references and hashes are recorded in the new manifest. Copyright (c) 2025 Afilmory Team; the preserved root license covers their reusable library role. `src/components/viewer/useImageLoader.ts` and the site media integration are locally authored adapters referencing the public behavior of ProgressiveImage/hooks; no upstream application UI is copied. The pipeline file is copied from the reusable upstream queue. See the alignment report for behavior and ownership changes. Dependencies `file-type`, `heic-to` and `tiff` retain their registry licenses and pinned lockfile resolutions.

## Viewer interaction core migration (2026-09-12)

The historical statements above about application UI not being copied describe
those earlier phases. This phase directly migrates `apps/web` Viewer components
at `1f65cde6672e5231599182620116ac904e39f548`, under AGPL-3.0-or-later + ANL §4.
See [the complete new notices](../THIRD_PARTY_NOTICES.md) and
`viewer-interaction-upstream.json` for copied files and adaptations. The
viewer-motion sources also now carry a small reduced-motion/cleanup adaptation;
`viewer-motion-files.json` supersedes its former byte-identical source record.
