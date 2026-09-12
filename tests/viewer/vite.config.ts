import { defineConfig } from 'vite';
import path from 'node:path';
export default defineConfig({
  root: path.resolve('tests/viewer'),
  publicDir: path.resolve('.cache/viewer-fixtures'),
  build: { rollupOptions: { input: { index: path.resolve('tests/viewer/index.html'), loader: path.resolve('tests/viewer/loader.html'), interactions: path.resolve('tests/viewer/interactions.html') } }, outDir: path.resolve('.cache/viewer-dist'), emptyOutDir: true, copyPublicDir: true },
  server: { host: '127.0.0.1', port: 4322, fs: { allow: [path.resolve('.')] } },
});
