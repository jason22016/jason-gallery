import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { brotliCompressSync, brotliDecompressSync, constants } from 'node:zlib';
import { canonicalJSON, indexVersionRecord, parseSemanticIndex } from '../../src/semantic-search/contracts';

export type SemanticServerFault = 'none' | 'index-mismatch' | 'asset-sha';

function digest(value: string | Uint8Array) { return createHash('sha256').update(value).digest('hex'); }

export async function serveSemanticBrowserFixture(port = 0) {
  const root = path.resolve('.');
  const dist = path.join(root, '.cache/semantic-browser-dist');
  const release = path.join(root, 'semantic-releases/siglip2-base-v64k-uint4-b32-r1');
  const runtime = path.join(root, 'semantic-runtimes/onnxruntime-web-1.30.0-asyncify-r1');
  const semantic = path.join(root, 'public/semantic');
  const baseIndex = JSON.parse(await fsp.readFile(path.join(semantic, 'index.json'), 'utf8'));
  const incompatible = structuredClone(baseIndex);
  incompatible.model.imageModel.revision = '0'.repeat(40);
  incompatible.indexVersion = digest(canonicalJSON(indexVersionRecord(parseSemanticIndex({ ...incompatible, indexVersion: '0'.repeat(64) }))));
  const incompatibleBytes = Buffer.from(JSON.stringify(incompatible));
  const tokenizer = brotliDecompressSync(await fsp.readFile(path.join(release, 'tokenizer.json.br')));
  const corruptTokenizer = Buffer.from(tokenizer);
  const marker = corruptTokenizer.indexOf(Buffer.from('65535'));
  if (marker < 0) throw new Error('Could not prepare same-length tokenizer corruption');
  corruptTokenizer[marker + 4] = corruptTokenizer[marker + 4] === 0x35 ? 0x34 : 0x35;
  const corruptTokenizerBrotli = brotliCompressSync(corruptTokenizer, { params: { [constants.BROTLI_PARAM_QUALITY]: 6 } });
  let fault: SemanticServerFault = 'none';
  const requests: string[] = [];
  const contentTypes: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json; charset=utf-8', '.wasm': 'application/wasm', '.br': 'application/octet-stream', '.f32': 'application/octet-stream' };

  const server = http.createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url!, 'http://localhost').pathname);
    requests.push(pathname);
    try {
      if (pathname === '/semantic/index.json' && fault === 'index-mismatch') {
        response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Content-Length': incompatibleBytes.length });
        response.end(incompatibleBytes); return;
      }
      if (pathname.endsWith('/tokenizer.json.br') && fault === 'asset-sha') {
        response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Encoding': 'br', 'Cache-Control': 'no-store', 'Content-Length': corruptTokenizerBrotli.length });
        response.end(corruptTokenizerBrotli); return;
      }
      let filename: string;
      let encoded = false;
      if (pathname.startsWith('/semantic-models/siglip2-base-v64k-uint4-b32-r1/')) {
        filename = path.join(release, path.basename(pathname));
        encoded = filename.endsWith('.br');
      } else if (pathname.startsWith('/semantic-runtimes/onnxruntime-web-1.30.0-asyncify-r1/')) {
        filename = path.join(runtime, path.basename(pathname));
        encoded = filename.endsWith('.br');
      } else if (pathname.startsWith('/semantic/')) filename = path.join(semantic, path.basename(pathname));
      else {
        const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
        filename = path.resolve(dist, relative);
        if (filename !== dist && !filename.startsWith(`${dist}${path.sep}`)) throw new Error('Invalid path');
      }
      const stat = await fsp.stat(filename);
      if (!stat.isFile()) throw new Error('Not a file');
      const extension = encoded ? path.extname(filename.slice(0, -3)) : path.extname(filename);
      response.writeHead(200, {
        'Content-Type': contentTypes[extension] ?? 'application/octet-stream',
        'Content-Length': stat.size,
        'Cache-Control': 'no-store',
        ...(encoded ? { 'Content-Encoding': 'br' } : {}),
      });
      fs.createReadStream(filename).pipe(response);
    } catch {
      response.writeHead(404, { 'Content-Type': 'text/plain' }); response.end('not found');
    }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Semantic browser server has no port');
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    setFault(value: SemanticServerFault) { fault = value; },
    resetRequests() { requests.length = 0; },
    close: () => new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); }),
  };
}
