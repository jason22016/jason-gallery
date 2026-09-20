// Isolated loopback harness. Deliberately cannot serve Phase 1 checkpoints/originals.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const cache = path.join(root, '.cache/semantic-spike/smaller');
const runtime = path.join(root, '.cache/semantic-spike/phase2a/runtime/node_modules');
const port = Number(process.env.SPIKE_PORT ?? 8768);
const types = {'.html':'text/html; charset=utf-8','.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.wasm':'application/wasm'};
export const server = http.createServer(async (req, res) => {
  const headers = {'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp',
    'Cross-Origin-Resource-Policy':'same-origin','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
  try {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (req.method !== 'GET') {res.writeHead(405, headers).end(); return;}
    let file;
    if (url.pathname === '/') file = path.join(here,'index.html');
    else if (/^\/(app|worker|tokenize)\.mjs$/.test(url.pathname)) file = path.join(here,url.pathname.slice(1));
    else if (url.pathname === '/tokenizers.mjs') file = path.join(runtime,'@huggingface/tokenizers/dist/tokenizers.mjs');
    else if (/^\/ort\/[a-zA-Z0-9.-]+\.(mjs|wasm)$/.test(url.pathname)) file = path.join(runtime,'onnxruntime-web/dist',path.basename(url.pathname));
    else if (/^\/assets\/(baseline|trim32k|trim64k|multiclip|mobileclip2)\/[a-zA-Z0-9_.-]+\.(json|onnx|f32)$/.test(url.pathname)) file = path.join(cache,url.pathname.slice('/assets/'.length));
    else {res.writeHead(404,headers).end(); return;}
    const stat = await fsp.stat(file);
    res.writeHead(200,{...headers,'Content-Type':types[path.extname(file)] ?? 'application/octet-stream','Content-Length':stat.size});
    fs.createReadStream(file).pipe(res);
  } catch (error) {res.writeHead(404,headers).end(String(error.code ?? error));}
});
server.listen(port,'127.0.0.1',()=>console.log(`Semantic browser harness: http://127.0.0.1:${port}`));
