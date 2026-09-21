import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
  root: path.resolve('tests/semantic-browser'),
  resolve: { conditions: ['onnxruntime-web-use-extern-wasm'] },
  worker: { format: 'es' },
  build: {
    outDir: path.resolve('.cache/semantic-browser-dist'),
    emptyOutDir: true,
    sourcemap: false,
  },
});
