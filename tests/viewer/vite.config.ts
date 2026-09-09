import { defineConfig } from 'vite';
import path from 'node:path';
export default defineConfig({
  root: path.resolve('tests/viewer'),
  publicDir: path.resolve('.cache/viewer-fixtures'),
  build: { outDir: path.resolve('.cache/viewer-dist'), emptyOutDir: true, copyPublicDir: true },
  server: { host: '127.0.0.1', port: 4322, fs: { allow: [path.resolve('.')] } },
});
