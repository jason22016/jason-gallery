import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { brotliCompressSync, brotliDecompressSync, constants } from 'node:zlib';
import { canonicalJSON, indexVersionRecord, parseSemanticIndex } from '../../src/semantic-search/contracts';
import { loadSemanticIndexFixture } from '../semantic/index-fixture';

export type SemanticServerFault =
  | 'none'
  | 'index-mismatch'
  | 'asset-sha'
  | 'asset-truncated'
  | 'asset-http'
  | 'vectors-sha'
  | 'vectors-truncated'
  | 'slow-asset';

function digest(value: string | Uint8Array) { return createHash('sha256').update(value).digest('hex'); }

export async function serveSemanticBrowserFixture(port = 0, semanticDirectory?: string) {
  const root = path.resolve('.');
  const dist = path.join(root, '.cache/semantic-browser-dist');
  const release = path.join(root, 'semantic-releases/siglip2-base-v64k-uint4-b32-r1');
  const runtime = path.join(root, 'semantic-runtimes/onnxruntime-web-1.30.0-asyncify-r1');
  const semantic = semanticDirectory ? path.resolve(semanticDirectory) : undefined;
  const fixture = semantic ? undefined : await loadSemanticIndexFixture();
  const indexBytes = fixture?.indexBytes ?? await fsp.readFile(path.join(semantic!, 'index.json'));
  const baseIndex = JSON.parse(indexBytes.toString('utf8'));
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
  const tokenizerBrotli = await fsp.readFile(path.join(release, 'tokenizer.json.br'));
  const vectors = fixture?.vectorBytes ?? await fsp.readFile(path.join(semantic!, 'vectors.f32'));
  const corruptVectors = Buffer.from(vectors); corruptVectors[0] ^= 0xff;
  let fault: SemanticServerFault = 'none';
  const requests: string[] = [];
  const abortedRequests: string[] = [];
  const contentTypes: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json; charset=utf-8', '.wasm': 'application/wasm', '.br': 'application/octet-stream', '.f32': 'application/octet-stream' };

  const server = http.createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url!, 'http://localhost').pathname);
    requests.push(pathname);
    request.once('aborted', () => abortedRequests.push(pathname));
    try {
      if (pathname === '/semantic/index.json' && fault === 'index-mismatch') {
        response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Content-Length': incompatibleBytes.length });
        response.end(incompatibleBytes); return;
      }
      if (pathname.endsWith('/tokenizer.json.br') && fault === 'asset-sha') {
        response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Encoding': 'br', 'Cache-Control': 'no-store', 'Content-Length': corruptTokenizerBrotli.length });
        response.end(corruptTokenizerBrotli); return;
      }
      if (pathname.endsWith('/tokenizer.json.br') && fault === 'asset-truncated') {
        const partial = tokenizerBrotli.subarray(0, Math.floor(tokenizerBrotli.length / 2));
        response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Encoding': 'br', 'Cache-Control': 'no-store', 'Content-Length': partial.length });
        response.end(partial); return;
      }
      if (pathname.endsWith('/tokenizer.json.br') && fault === 'asset-http') {
        response.writeHead(503, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
        response.end('simulated model outage'); return;
      }
      if (pathname === '/semantic/vectors.f32' && (fault === 'vectors-sha' || fault === 'vectors-truncated')) {
        const body = fault === 'vectors-sha' ? corruptVectors : vectors.subarray(0, Math.floor(vectors.length / 2));
        response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store', 'Content-Length': body.length });
        response.end(body); return;
      }
      if (pathname.endsWith('/model.onnx.part-000.br') && fault === 'slow-asset') {
        await new Promise(resolve => setTimeout(resolve, 2_000));
        if (response.destroyed) return;
      }
      let filename: string;
      let encoded = false;
      if (pathname.startsWith('/semantic-models/siglip2-base-v64k-uint4-b32-r1/')) {
        filename = path.join(release, path.basename(pathname));
        encoded = filename.endsWith('.br');
      } else if (pathname.startsWith('/semantic-runtimes/onnxruntime-web-1.30.0-asyncify-r1/')) {
        filename = path.join(runtime, path.basename(pathname));
        encoded = filename.endsWith('.br');
      } else if (pathname.startsWith('/semantic/') && fixture) {
        const body = pathname === '/semantic/index.json' ? indexBytes : pathname === '/semantic/vectors.f32' ? vectors : undefined;
        if (!body) throw new Error('Not a file');
        response.writeHead(200, {
          'Content-Type': pathname.endsWith('.json') ? contentTypes['.json'] : contentTypes['.f32'],
          'Content-Length': body.byteLength,
          'Cache-Control': 'no-store',
        });
        response.end(body); return;
      } else if (pathname.startsWith('/semantic/')) filename = path.join(semantic!, path.basename(pathname));
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
    abortedRequests,
    setFault(value: SemanticServerFault) { fault = value; },
    resetRequests() { requests.length = 0; },
    close: () => new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); }),
  };
}
