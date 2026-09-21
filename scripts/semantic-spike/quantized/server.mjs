// Isolated loopback harness. Deliberately cannot serve Phase 1 checkpoints/originals.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const cache = path.join(root, '.cache/semantic-spike/quantized');
const runtime = path.join(root, '.cache/semantic-spike/phase2a/runtime/node_modules');
const port = Number(process.env.SPIKE_PORT ?? 8769);
const types = {'.html':'text/html; charset=utf-8','.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.wasm':'application/wasm'};
export const server = http.createServer(async (req, res) => {
  const headers = {'Cross-Origin-Resource-Policy':'same-origin','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
    ...(process.env.SPIKE_NO_ISOLATION === '1' ? {} : {'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'})};
  try {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const compressed=url.pathname.startsWith('/br/');
    if(compressed)url.pathname=url.pathname.slice(3);
    if (req.method !== 'GET') {res.writeHead(405, headers).end(); return;}
    let file;
    if (url.pathname === '/') file = path.join(here,'index.html');
    else if (/^\/(app|worker|tokenize)\.mjs$/.test(url.pathname)) file = path.join(here,url.pathname.slice(1));
    else if (url.pathname === '/tokenizers.mjs') file = path.join(runtime,'@huggingface/tokenizers/dist/tokenizers.mjs');
    else if (/^\/ort\/[a-zA-Z0-9.-]+\.(mjs|wasm)$/.test(url.pathname)) file = path.join(runtime,'onnxruntime-web/dist',path.basename(url.pathname));
    else if (/^\/assets\/(v[0-9]+-[a-z0-9-]+)\/[a-zA-Z0-9_.-]+\.(json|onnx|f32)$/.test(url.pathname)) file = path.join(cache,url.pathname.slice('/assets/'.length));
    else {res.writeHead(404,headers).end(); return;}
    const type=types[path.extname(file)] ?? 'application/octet-stream';
    if(compressed) {
      if(url.pathname.startsWith('/assets/'))file=path.join(cache,'brotli',url.pathname.slice('/assets/'.length))+'.br';
      else if(url.pathname.startsWith('/ort/'))file=path.join(cache,'brotli',url.pathname.slice(1))+'.br';
      else {res.writeHead(404,headers).end();return;}
    }
    const stat = await fsp.stat(file);
    res.writeHead(200,{...headers,'Content-Type':type,'Content-Length':stat.size,...(compressed?{'Content-Encoding':'br','Vary':'Accept-Encoding'}:{})});
    fs.createReadStream(file).pipe(res);
  } catch (error) {res.writeHead(404,headers).end(String(error.code ?? error));}
});
server.listen(port,'127.0.0.1',()=>console.log(`Semantic browser harness: http://127.0.0.1:${port}`));
