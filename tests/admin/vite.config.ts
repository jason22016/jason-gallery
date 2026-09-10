import { defineConfig } from 'vite';
import path from 'node:path';
export default defineConfig({
  root: path.resolve('tests/admin'),
  publicDir: path.resolve('.cache/admin-fixture'),
  build: { outDir: path.resolve('.cache/admin-dist'), emptyOutDir: true },
  server: { host: '127.0.0.1', port: 4325, strictPort: true },
});
