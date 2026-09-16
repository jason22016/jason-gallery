import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import { projectValidation } from './src/projects/integration.ts';
import { publishedPhotoAssets } from './src/website/public-assets.ts';
import { DEFAULT_SITE_URL, resolveSiteURL } from './src/website/site-url.ts';
import { publicSEO } from './src/website/seo-integration.ts';
export default defineConfig({
  site: resolveSiteURL(process.env.SITE_URL ?? DEFAULT_SITE_URL),
  trailingSlash: 'always',
  integrations: [react(), projectValidation(), publishedPhotoAssets(), publicSEO()],
  output: 'static',
});
