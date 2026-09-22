import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import { SemanticAssetCache, semanticCachePrefix, type CacheStorageLike } from '../../src/semantic-search/cache';
import {
  canonicalJSON,
  indexVersionRecord,
  normalizeEmbedding,
  parseClientModelConfig,
  parseClientReleaseManifest,
  parseSemanticIndex,
  rankSemanticVectors,
  type ClientReleaseFile,
  type ClientSemanticReleaseManifest,
} from '../../src/semantic-search/contracts';
import { sha256 as browserSha256 } from '../../src/semantic-search/hash';
import { loadSemanticIndex } from '../../src/semantic-search/index-loader';
import { SemanticSearchError } from '../../src/semantic-search/errors';
import { SemanticSearchEngine } from '../../src/semantic-search/engine';
import { downloadReleaseAssets } from '../../src/semantic-search/release-loader';
import { verifyClientSemanticRelease, verifyClientSemanticRuntime } from '../../scripts/semantic/client-release';
import { semanticModelConfig, semanticModelContractSha256 } from '../../scripts/semantic/model-config';
import { loadSemanticIndexFixture, semanticIndexFixturePhotoIds } from './index-fixture';

class MemoryCache {
  entries = new Map<string, Response>();
  async match(request: RequestInfo | URL) { return this.entries.get(String(request))?.clone(); }
  async put(request: RequestInfo | URL, response: Response) { this.entries.set(String(request), response.clone()); }
  async delete(request: RequestInfo | URL) { return this.entries.delete(String(request)); }
}

class MemoryCacheStorage implements CacheStorageLike {
  caches = new Map<string, MemoryCache>();
  async open(name: string): Promise<Cache> {
    let cache = this.caches.get(name);
    if (!cache) { cache = new MemoryCache(); this.caches.set(name, cache); }
    return cache as unknown as Cache;
  }
  async delete(name: string) { return this.caches.delete(name); }
  async keys() { return [...this.caches.keys()]; }
}

async function fakeRelease(): Promise<{ manifest: ClientSemanticReleaseManifest; assets: Map<string, ArrayBuffer> }> {
  const roles = ['tokenizer', 'tokenizer-config', 'model-config', 'onnx'] as const;
  const assets = new Map<string, ArrayBuffer>();
  const files: ClientReleaseFile[] = [];
  for (const [index, role] of roles.entries()) {
    const bytes = new TextEncoder().encode(`${role}-${index}`).buffer;
    assets.set(role, bytes);
    const digest = await browserSha256(bytes);
    files.push({
      role,
      path: `${role}.bin`,
      mediaType: 'application/octet-stream',
      bytes: bytes.byteLength,
      sha256: digest,
      parts: [{ path: `${role}.bin`, offset: 0, bytes: bytes.byteLength, sha256: digest, contentEncoding: null, transportBytes: bytes.byteLength, transportSha256: digest }],
    });
  }
  return {
    assets,
    manifest: {
      schemaVersion: 1, kind: 'jason-gallery-client-semantic-release', releaseId: 'fixture-r1', bundleSha256: 'a'.repeat(64), indivisible: true,
      model: { id: 'fixture', revision: '1'.repeat(40), semanticModelContractSha256: 'b'.repeat(64), clientModelContractSha256: 'c'.repeat(64), publicModelSha256: 'd'.repeat(64), embeddingSpace: 'fixture', embeddingDimension: 768 },
      compatibleIndex: { schemaVersion: 1, kind: 'jason-gallery-public-semantic-index', ordering: 'public-photo-id-bytewise-ascending', vectorFile: 'vectors.f32', dtype: 'float32-le', normalization: 'l2' },
      runtime: { onnxRuntimeWebVersion: '1', tokenizerPackage: '@huggingface/tokenizers', tokenizerVersion: '1', backendOrder: ['webgpu', 'wasm'] },
      payloadBytes: files.reduce((sum, file) => sum + file.bytes, 0),
      transportBytes: files.reduce((sum, file) => sum + file.parts.reduce((partSum, part) => partSum + part.transportBytes, 0), 0),
      files,
    },
  };
}

test('formal browser release is an exact, indivisible Phase 2B-compatible payload', { timeout: 60_000 }, async () => {
  const release = await verifyClientSemanticRelease();
  assert.equal(release.indivisible, true);
  assert.equal(release.releaseId, semanticModelConfig.clientModelRelease.id);
  assert.equal(release.model.semanticModelContractSha256, semanticModelContractSha256);
  assert.equal(release.model.clientModelContractSha256, semanticModelConfig.clientModelRelease.releaseSha256);
  assert.equal(release.files.find(file => file.role === 'onnx')?.sha256, semanticModelConfig.clientModelRelease.onnx.sha256);
  assert.equal(release.files.find(file => file.role === 'tokenizer')?.sha256, semanticModelConfig.clientModelRelease.tokenizer.sha256);
  assert.equal(release.payloadBytes, 111_166_042);
  assert.equal(release.transportBytes, 100_655_930);
  const onnx = release.files.find(file => file.role === 'onnx')!;
  assert.equal(onnx.path, 'model.onnx');
  assert.equal(onnx.parts.length, 6);
  assert(onnx.parts.every(part => part.transportBytes < 25 * 1024 * 1024));
  assert.deepEqual((await fs.readdir(`semantic-releases/${release.releaseId}`)).sort(), [
    'manifest.json', 'model-config.json',
    'model.onnx.part-000.br', 'model.onnx.part-001.br', 'model.onnx.part-002.br',
    'model.onnx.part-003.br', 'model.onnx.part-004.br', 'model.onnx.part-005.br',
    'tokenizer.json.br', 'tokenizer_config.json.br',
  ]);
  const runtime = await verifyClientSemanticRuntime();
  assert.equal(runtime.onnxRuntimeWebVersion, release.runtime.onnxRuntimeWebVersion);
  const runtimeWasm = runtime.files.find(file => file.mediaType === 'application/wasm')!;
  assert.equal(runtimeWasm.bytes, 26_781_914);
  assert.equal(runtimeWasm.transportBytes, 3_866_678);
  assert(runtimeWasm.transportBytes < 25 * 1024 * 1024);
});

test('Cache Storage uses a completion marker, rejects corrupt/incomplete entries and clears old releases', async () => {
  const storage = new MemoryCacheStorage();
  const cache = new SemanticAssetCache(storage);
  const releaseURL = new URL('https://gallery.test/semantic-models/fixture-r1/');
  const { manifest, assets } = await fakeRelease();
  assert.equal(await cache.read(manifest, releaseURL), undefined);
  assert.equal(await cache.write(manifest, releaseURL, assets), true);
  assert.equal(await cache.verify(manifest, releaseURL), true);
  assert.deepEqual([...(await cache.read(manifest, releaseURL))!.assets.keys()].sort(), ['model-config', 'onnx', 'tokenizer', 'tokenizer-config']);

  const currentName = (await storage.keys()).find(name => name.includes(manifest.bundleSha256))!;
  const current = storage.caches.get(currentName)!;
  current.entries.delete(new URL('onnx.bin', releaseURL).href);
  assert.equal(await cache.read(manifest, releaseURL), undefined, 'a marked but incomplete cache fails closed');
  assert.equal(storage.caches.has(currentName), false, 'incomplete generation is removed as a unit');

  await cache.write(manifest, releaseURL, assets);
  const repaired = storage.caches.get(currentName)!;
  repaired.entries.set(new URL('tokenizer.bin', releaseURL).href, new Response('corrupt'));
  assert.equal(await cache.read(manifest, releaseURL), undefined, 'a digest mismatch invalidates the complete release');

  await storage.open(`${semanticCachePrefix}old-release:${'0'.repeat(64)}`);
  await cache.write(manifest, releaseURL, assets);
  await cache.clearObsolete(manifest);
  assert.deepEqual(await storage.keys(), [currentName], 'semantic release update explicitly removes old cache names');
});

test('cache and quota failures fall back without treating storage as durable', async () => {
  const unavailable: CacheStorageLike = {
    open: async () => { throw new DOMException('quota', 'QuotaExceededError'); },
    delete: async () => false,
    keys: async () => { throw new DOMException('disabled', 'SecurityError'); },
  };
  const cache = new SemanticAssetCache(unavailable);
  const { manifest, assets } = await fakeRelease();
  const releaseURL = new URL('https://gallery.test/semantic-models/fixture-r1/');
  assert.equal(await cache.read(manifest, releaseURL), undefined);
  assert.equal(await cache.write(manifest, releaseURL, assets), false);
  await cache.clearObsolete(manifest);
});

test('a quota failure during cache commit deletes the incomplete generation and eviction is a clean miss', async () => {
  const backing = new MemoryCacheStorage();
  let puts = 0;
  const quotaStorage: CacheStorageLike = {
    async open(name) {
      const cache = await backing.open(name);
      return {
        match: cache.match.bind(cache), delete: cache.delete.bind(cache),
        async put(request, response) {
          if (++puts === 2) throw new DOMException('simulated quota exhaustion', 'QuotaExceededError');
          return cache.put(request, response);
        },
      } as Cache;
    },
    delete: name => backing.delete(name),
    keys: () => backing.keys(),
  };
  const { manifest, assets } = await fakeRelease();
  const releaseURL = new URL('https://gallery.test/semantic-models/fixture-r1/');
  assert.equal(await new SemanticAssetCache(quotaStorage).write(manifest, releaseURL, assets), false);
  assert.deepEqual(await backing.keys(), [], 'a partial cache transaction must not survive a failed put');

  const durable = new SemanticAssetCache(backing);
  assert.equal(await durable.write(manifest, releaseURL, assets), true);
  const [name] = await backing.keys();
  assert(name);
  await backing.delete(name);
  assert.equal(await durable.read(manifest, releaseURL), undefined, 'browser eviction behaves as a normal cache miss');
});

test('post-commit readback catches silent large-cache eviction before persistence is reported', async () => {
  const backing = new MemoryCacheStorage();
  const { manifest, assets } = await fakeRelease();
  const releaseURL = new URL('https://gallery.test/semantic-models/fixture-r1/');
  const silentlyEvicting: CacheStorageLike = {
    async open(name) {
      const cache = await backing.open(name);
      return {
        match: cache.match.bind(cache), delete: cache.delete.bind(cache),
        async put(request, response) {
          await cache.put(request, response);
          if (String(request).includes('/.semantic-cache/complete/')) await cache.delete(new URL('tokenizer.bin', releaseURL).href);
        },
      } as Cache;
    },
    delete: name => backing.delete(name),
    keys: () => backing.keys(),
  };
  const cache = new SemanticAssetCache(silentlyEvicting);
  assert.equal(await cache.write(manifest, releaseURL, assets), true, 'the simulated engine reports successful Cache.put calls');
  assert.equal(await cache.verify(manifest, releaseURL), false, 'readback detects the silently evicted file');
  assert.deepEqual(await backing.keys(), [], 'invalid committed generations are removed as a unit');
});

test('release downloads reject incomplete bytes and SHA mismatches, abort cleanly, and retry from scratch', async () => {
  const { manifest } = await fakeRelease();
  const releaseURL = new URL('https://gallery.test/semantic-models/fixture-r1/');
  const bytesByPath = new Map(manifest.files.flatMap(file => file.parts.map(part => [new URL(part.path, releaseURL).href, new TextEncoder().encode(`${file.role}-${manifest.files.indexOf(file)}`)] as const)));
  const fetcher = (fault: 'none' | 'short' | 'sha') => (async (input: RequestInfo | URL) => {
    const source = bytesByPath.get(String(input));
    if (!source) return new Response('missing', { status: 404 });
    const body = Uint8Array.from(source);
    if (fault === 'short') return new Response(body.slice(0, Math.max(0, body.length - 1)));
    if (fault === 'sha') body[0] ^= 0xff;
    return new Response(body);
  }) as typeof fetch;
  await assert.rejects(downloadReleaseAssets(fetcher('short'), releaseURL, manifest, new AbortController().signal, () => {}), (error: unknown) => error instanceof SemanticSearchError && error.code === 'MODEL_DOWNLOAD');
  await assert.rejects(downloadReleaseAssets(fetcher('sha'), releaseURL, manifest, new AbortController().signal, () => {}), (error: unknown) => error instanceof SemanticSearchError && error.code === 'MODEL_INTEGRITY');

  const controller = new AbortController();
  const blocked = ((_: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true });
  })) as typeof fetch;
  const pending = downloadReleaseAssets(blocked, releaseURL, manifest, controller.signal, () => {});
  controller.abort();
  await assert.rejects(pending, (error: unknown) => error instanceof SemanticSearchError && error.code === 'MODEL_DOWNLOAD');
  assert.equal((await downloadReleaseAssets(fetcher('none'), releaseURL, manifest, new AbortController().signal, () => {})).size, manifest.files.length);
});

test('interrupted initialization returns to disabled without leaking subscriptions or publishing an error state', async () => {
  const fetcher = ((_: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('navigation', 'AbortError')), { once: true });
  })) as typeof fetch;
  const engine = new SemanticSearchEngine({ baseURL: 'https://gallery.test/', fetch: fetcher, cacheStorage: null });
  const releases = Array.from({ length: 100 }, () => engine.subscribe(() => {}));
  assert.equal(engine.getDiagnostics().stateListeners, 100);
  releases.forEach(release => release());
  assert.equal(engine.getDiagnostics().stateListeners, 0);
  const pending = engine.enable();
  engine.dispose();
  await assert.rejects(pending, (error: unknown) => error instanceof SemanticSearchError && error.code === 'ABORTED');
  assert.equal(engine.getState().status, 'disabled');
  assert.equal(engine.getDiagnostics().workerStarts, 0);
});

test('query normalization and cosine Top-K are deterministic and reject malformed embeddings', () => {
  const query = new Float32Array(768); query[0] = 3; query[1] = 4;
  const normalized = normalizeEmbedding(query);
  assert(Math.abs(Math.hypot(...normalized) - 1) < 1e-6);
  const vectors = new Float32Array(3 * 768);
  vectors[0] = 1;
  vectors[768 + 1] = 1;
  vectors[2 * 768] = 0.6; vectors[2 * 768 + 1] = 0.8;
  assert.deepEqual(rankSemanticVectors(normalized, ['AAAAAAAAAAAAAAAA', 'BBBBBBBBBBBBBBBB', 'CCCCCCCCCCCCCCCC'], vectors, 3).map(result => result.publicId), [
    'CCCCCCCCCCCCCCCC', 'BBBBBBBBBBBBBBBB', 'AAAAAAAAAAAAAAAA',
  ]);
  assert.throws(() => normalizeEmbedding(new Float32Array(768)), /zero or invalid norm/);
  const invalid = new Float32Array(768); invalid[0] = Number.NaN;
  assert.throws(() => normalizeEmbedding(invalid), /non-finite/);
  assert.throws(() => rankSemanticVectors(normalized, ['AAAAAAAAAAAAAAAA'], new Float32Array(1), 1), /dimension mismatch/);
});

test('project scope is applied before Top-K so photos outside the global Top-100 remain discoverable', () => {
  const ids = Array.from({ length: 102 }, (_, index) => String(index).padStart(16, '0'));
  const query = new Float32Array(768); query[0] = 1;
  const vectors = new Float32Array(ids.length * 768);
  ids.forEach((_, row) => {
    vectors[row * 768] = row < 100 ? 1 : .6;
    vectors[row * 768 + 1] = row < 100 ? 0 : .8;
  });
  const scope = ids.slice(100).reverse();
  assert(rankSemanticVectors(query, ids, vectors, 100).every(result => !scope.includes(result.publicId)));
  assert.deepEqual(rankSemanticVectors(query, ids, vectors, 2, scope).map(({ publicId, rank }) => ({ publicId, rank })), [
    { publicId: ids[100], rank: 1 }, { publicId: ids[101], rank: 2 },
  ], 'ties keep original index order, independent of project/editorial order');
  assert.equal(rankSemanticVectors(query, ids, vectors, 60, [ids[101]!]).length, 1);
  assert.deepEqual(rankSemanticVectors(query, ids, vectors, 60, []), [], 'an empty scope must not widen to all photos');
});

test('model config exposes only the frozen text inference contract', async () => {
  const config = parseClientModelConfig(JSON.parse(await fs.readFile('semantic-releases/siglip2-base-v64k-uint4-b32-r1/model-config.json', 'utf8')));
  assert.equal(config.maximumTokens, 64);
  assert.equal(config.embeddingDimension, 768);
  assert.equal(config.transformerQuantization, 'asymmetric-uint4-block-32');
  assert.equal(config.tokenEmbedding, 'int8');
  assert.equal(config.projectionHeadDtype, 'float32');
});

test('browser index gate accepts the Phase 2B artifact and fails closed on model, SHA and public-ID mismatches', async () => {
  const release = parseClientReleaseManifest(JSON.parse(await fs.readFile('semantic-releases/siglip2-base-v64k-uint4-b32-r1/manifest.json', 'utf8')));
  const { indexBytes, vectorBytes } = await loadSemanticIndexFixture();
  const indexURL = new URL('https://gallery.test/semantic/index.json');
  const body = (value: Uint8Array) => Uint8Array.from(value).buffer;
  const fetcher = (indexBody: Uint8Array, vectorBody: Uint8Array = vectorBytes) => (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === indexURL.href) return new Response(body(indexBody), { status: 200 });
    if (url === new URL('vectors.f32', indexURL).href) return new Response(body(vectorBody), { status: 200 });
    return new Response('missing', { status: 404 });
  }) as typeof fetch;
  const expected = parseSemanticIndex(JSON.parse(indexBytes.toString('utf8'))).photoIds;
  const valid = await loadSemanticIndex(fetcher(indexBytes), indexURL, release, new AbortController().signal, expected);
  assert.equal(valid.index.photoIds.length, semanticIndexFixturePhotoIds.length);
  assert.equal(valid.vectors.length, semanticIndexFixturePhotoIds.length * 768);

  const oldModel = JSON.parse(indexBytes.toString('utf8'));
  oldModel.model.imageModel.revision = '0'.repeat(40);
  const parsedOld = parseSemanticIndex({ ...oldModel, indexVersion: '0'.repeat(64) });
  oldModel.indexVersion = await browserSha256(canonicalJSON(indexVersionRecord(parsedOld)));
  await assert.rejects(
    loadSemanticIndex(fetcher(new TextEncoder().encode(JSON.stringify(oldModel))), indexURL, release, new AbortController().signal),
    (error: unknown) => error instanceof SemanticSearchError && error.code === 'UPDATE_REQUIRED',
  );

  const corruptVectors = Uint8Array.from(vectorBytes); corruptVectors[0] ^= 0xff;
  await assert.rejects(
    loadSemanticIndex(fetcher(indexBytes, corruptVectors), indexURL, release, new AbortController().signal),
    (error: unknown) => error instanceof SemanticSearchError && error.code === 'INDEX_INTEGRITY',
  );
  await assert.rejects(
    loadSemanticIndex(fetcher(indexBytes), indexURL, release, new AbortController().signal, expected.slice(1)),
    (error: unknown) => error instanceof SemanticSearchError && error.code === 'INDEX_INTEGRITY',
  );
});
