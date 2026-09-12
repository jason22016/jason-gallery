import { defineConfig } from 'vite';
import path from 'node:path';
export default defineConfig({
  root: path.resolve('tests/gallery'),
  publicDir: path.resolve('.cache/gallery-fixture/public'),
  build: { outDir: path.resolve('.cache/gallery-dist'), emptyOutDir: true },
});
