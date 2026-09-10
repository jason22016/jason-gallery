import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import { projectValidation } from './src/projects/integration.ts';
import { publishedPhotoAssets } from './src/website/public-assets.ts';
export default defineConfig({ integrations: [react(), projectValidation(), publishedPhotoAssets()], output: 'static' });
