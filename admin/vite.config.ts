import { defineConfig } from 'vite';
import path from 'node:path';
export default defineConfig({ root: path.resolve('admin/client'), publicDir: false, build: { outDir: path.resolve('.cache/admin-release'), emptyOutDir: true } });
