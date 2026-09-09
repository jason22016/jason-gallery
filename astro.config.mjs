import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import { projectValidation } from './src/projects/integration.ts';
export default defineConfig({ integrations: [react(), projectValidation()], output: 'static' });
