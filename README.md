Jason Gallery is a static photography portfolio built with Astro, featuring curated projects, HDR viewing, and automated photo synchronization from multiple GitHub repositories.

Phase 7 is in the fixture UI review stage; management APIs and production authentication are not connected yet. Polish, SEO, and performance work move to Phase 8.

- `pnpm admin:preview` — preview with existing local thumbnails at `http://127.0.0.1:4325/`.
- `pnpm admin:fixture` — preview with generated test images, no real gallery required.
- `pnpm test:admin` — isolated admin UI checks; `pnpm test` runs the full regression suite.

Preview edits stay in page memory and never create real Projects or trigger deployment. See [Phase 7 report](PHASE7_REPORT.md) and [architecture/authentication decision](docs/PHASE7_PLAN.md) for scope, Cloudflare setup, and outstanding validation.
