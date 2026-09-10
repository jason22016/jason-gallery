Jason Gallery is a static photography portfolio built with Astro, featuring curated projects, HDR viewing, and automated photo synchronization from multiple GitHub repositories.

Phase 7 adds an independent Cloudflare Worker admin with Cloudflare Access email OTP, source management, Project editing, version-checked GitHub saves, and separate sync/publish actions. Polish, SEO, and performance work move to Phase 8.

- `pnpm admin:fixture` — isolated UI preview at `http://127.0.0.1:4325/`; `pnpm admin:preview` uses existing local thumbnails.
- `pnpm admin:build` — build the real admin UI; `pnpm admin:dev` starts its protected local Worker.
- `pnpm test:admin` — admin API/UI and local workerd checks; `pnpm test` runs the full regression suite.

Cloudflare is not configured yet. The real Worker fails closed without valid Access authentication; fixture preview edits stay in memory. No production deployment or real Project creation was performed. See [admin setup and deployment prerequisites](docs/ADMIN_SETUP.md), [Phase 7 report](PHASE7_REPORT.md), and [architecture](ARCHITECTURE.md).
