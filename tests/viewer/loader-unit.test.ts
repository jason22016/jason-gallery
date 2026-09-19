import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ImageBlobCache, ImageDownloadStalledError, ImageLoaderManager, clearImageCaches, getImageCacheStats, type LoadingState } from '../../src/lib/image-loader-manager';
import { imageLoadingPolicy } from '../../src/lib/image-loading-policy';
import { imageConverterManager, needsImageConversion } from '../../src/lib/image-convert';
import { ImageConversionPipeline } from '../../src/lib/image-convert/pipeline';
import { imageViewerConfig } from '../../src/components/viewer/image-viewer-config';

const png = new Blob([Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex')], { type: 'application/octet-stream' });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
const next = () => new Promise(resolve => setImmediate(resolve));
class XHR {
  static requests: XHR[] = [];
  status = 200; response = png; responseType = ''; aborted = false;
  onload = () => {}; onerror = () => {}; onabort = () => {};
  onprogress = (_event: { loaded: number; total: number; lengthComputable: boolean }) => {};
  open() {} send() { XHR.requests.push(this); }
  abort() { this.aborted = true; this.onabort?.(); }
}

Object.defineProperty(globalThis, 'XMLHttpRequest', { configurable: true, writable: true, value: XHR });

test('Blob leases survive LRU eviction/clear and revoke once the last consumer releases', t => {
  const revoked: string[] = [];
  const revoke = URL.revokeObjectURL.bind(URL);
  t.mock.method(URL, 'revokeObjectURL', (url: string) => { revoked.push(url); revoke(url); });
  const cache = new ImageBlobCache(1);
  const a = cache.store('a', png, false), a2 = cache.acquire('a')!;
  const b = cache.store('b', png, true);
  assert.equal(revoked.length, 0);
  a.release(); assert.equal(revoked.length, 0);
  a2.release(); assert.deepEqual(revoked, [a.result.blobSrc]);
  cache.clear(); assert.equal(revoked.length, 1);
  b.release(); b.release(); assert.deepEqual(revoked, [a.result.blobSrc, b.result.blobSrc]);
});

test('manager delay/XHR/decoder cancellation settles, suppresses stale callbacks and avoids Blob allocation', async t => {
  t.mock.property(globalThis, 'XMLHttpRequest', XHR as unknown as typeof XMLHttpRequest);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  clearImageCaches(); XHR.requests = [];
  const manager = new ImageLoaderManager();
  let errors = 0;
  const pending = manager.loadImage('cancel-before-send', { onError: () => errors++ });
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  manager.cleanup(); t.mock.timers.tick(300); await rejected;
  assert.equal(XHR.requests.length, 0);
  const downloading = manager.loadImage('cancel-during-download', { onError: () => errors++ });
  const downloadRejected = assert.rejects(downloading, { name: 'AbortError' });
  t.mock.timers.tick(300); manager.cleanup(); await downloadRejected;
  assert.equal(XHR.requests[0]!.aborted, true);
  const decode = deferred<Blob>();
  t.mock.method(imageConverterManager, 'convertImage', () => decode.promise);
  let updates = 0;
  const converting = manager.loadImage('cancel-during-convert', { onLoadingStateUpdate: () => updates++, onError: () => errors++ });
  const conversionRejected = assert.rejects(converting, { name: 'AbortError' });
  t.mock.timers.tick(300); XHR.requests.at(-1)!.onload(); await next();
  manager.cleanup(); await conversionRejected;
  const before = updates;
  decode.resolve(png); await next();
  assert.equal(updates, before); assert.equal(errors, 0);
  assert.equal(getImageCacheStats().converted.size, 0);
  assert.equal(getImageCacheStats().regular.size, 0);
});

test('magic detection preserves ordinary bytes, reports progress, caches before network and rejects invalid payloads', async t => {
  t.mock.property(globalThis, 'XMLHttpRequest', XHR as unknown as typeof XMLHttpRequest);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  clearImageCaches(); XHR.requests = [];
  const manager = new ImageLoaderManager();
  const progress: number[] = [];
  let loading: Partial<LoadingState> = {};
  const onLoadingStateUpdate = (state: Partial<LoadingState>) => { loading = { ...loading, ...state }; };
  const promise = manager.loadImage('image', { onProgress: value => progress.push(value), onLoadingStateUpdate });
  t.mock.timers.tick(300);
  XHR.requests[0]!.onprogress({ loaded: 5, total: 10, lengthComputable: true });
  assert.equal(loading.loadedBytes, 5); assert.equal(loading.totalBytes, 10);
  XHR.requests[0]!.onload();
  const result = await promise;
  assert(result.blobSrc.startsWith('blob:'));
  const response = await fetch(result.blobSrc);
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from(await png.arrayBuffer()));
  assert.deepEqual(progress, [50]);
  assert.equal(loading.loadedBytes, png.size); assert.equal(loading.totalBytes, png.size);
  const cached = await manager.loadImage('image', { onLoadingStateUpdate });
  assert.equal(loading.loadingProgress, 100);
  assert.equal(loading.loadedBytes, png.size); assert.equal(loading.totalBytes, png.size);
  assert.equal(cached.blobSrc, result.blobSrc); assert.equal(XHR.requests.length, 1);
  const bad = manager.loadImage('html');
  const rejected = assert.rejects(bad, /not a valid image/);
  t.mock.timers.tick(300); XHR.requests.at(-1)!.response = new Blob(['<html>error</html>']); XHR.requests.at(-1)!.onload();
  await rejected;
  manager.cleanup(); clearImageCaches();
});

test('converter failures retain original Blob fallback and requests can retry after network errors', async t => {
  t.mock.property(globalThis, 'XMLHttpRequest', XHR as unknown as typeof XMLHttpRequest);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(imageConverterManager, 'convertImage', async () => { throw new Error('decoder failed'); });
  t.mock.method(console, 'warn', () => {});
  clearImageCaches(); XHR.requests = [];
  const manager = new ImageLoaderManager();
  const promise = manager.loadImage('retry');
  const rejected = assert.rejects(promise, /Network error/);
  t.mock.timers.tick(300); XHR.requests[0]!.onerror(); await rejected;
  const retry = manager.loadImage('retry');
  t.mock.timers.tick(300); XHR.requests[1]!.onload();
  const result = await retry;
  assert.equal(result.convertedUrl, undefined);
  assert.deepEqual(Buffer.from(await (await fetch(result.blobSrc)).arrayBuffer()), Buffer.from(await png.arrayBuffer()));
  manager.cleanup(); clearImageCaches();
});

test('no bytes times out once, aborts the XHR, and retry ignores stale events without leaking Blob URLs', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  clearImageCaches(); XHR.requests = [];
  const create = t.mock.method(URL, 'createObjectURL');
  const revoke = t.mock.method(URL, 'revokeObjectURL');
  const manager = new ImageLoaderManager();
  t.after(() => { manager.cleanup(); clearImageCaches(); });
  let errors = 0, updates = 0;
  const stalled = manager.loadImage('stalled', { onError: () => errors++, onLoadingStateUpdate: () => updates++ });
  const rejected = assert.rejects(stalled, ImageDownloadStalledError);
  t.mock.timers.tick(imageLoadingPolicy.requestDelayMs);
  const old = XHR.requests[0]!, lateLoad = old.onload, lateProgress = old.onprogress;
  t.mock.timers.tick(imageLoadingPolicy.downloadIdleTimeoutMs - 1);
  old.onprogress({ loaded: 0, total: 0, lengthComputable: false });
  assert.equal(old.aborted, false);
  t.mock.timers.tick(1); await rejected;
  assert.equal(old.aborted, true); assert.equal(errors, 1);
  assert.equal(old.onload, null); assert.equal(old.onprogress, null);
  assert.equal(create.mock.callCount(), 0);

  const before = updates;
  const retry = manager.loadImage('stalled');
  t.mock.timers.tick(imageLoadingPolicy.requestDelayMs);
  lateProgress({ loaded: 100, total: 100, lengthComputable: true }); lateLoad();
  assert.equal(updates, before);
  assert.equal(XHR.requests.length, 2);
  XHR.requests[1]!.onload();
  const result = await retry;
  assert.equal(create.mock.callCount(), 1);
  assert.deepEqual(getImageCacheStats().regular.keys, ['stalled']);
  clearImageCaches(); assert.equal(revoke.mock.callCount(), 0, 'Mounted lease survives cache invalidation');
  manager.cleanup(); manager.cleanup();
  assert.equal(revoke.mock.callCount(), 1);
  assert.equal(revoke.mock.calls[0]!.arguments[0], result.blobSrc);
  t.mock.timers.tick(imageLoadingPolicy.downloadIdleTimeoutMs * 2);
  assert.equal(errors, 1); assert.equal(XHR.requests[1]!.aborted, false);
});

for (const knownTotal of [true, false]) {
  test(`partial download stalls even with repeated identical progress events (Content-Length: ${knownTotal})`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    clearImageCaches(); XHR.requests = [];
    const manager = new ImageLoaderManager();
    t.after(() => { manager.cleanup(); clearImageCaches(); });
    let loading: Partial<LoadingState> = {};
    const promise = manager.loadImage('partial', { onLoadingStateUpdate: state => { loading = { ...loading, ...state }; } });
    const rejected = assert.rejects(promise, ImageDownloadStalledError);
    t.mock.timers.tick(imageLoadingPolicy.requestDelayMs);
    const request = XHR.requests[0]!;
    t.mock.timers.tick(imageLoadingPolicy.downloadIdleTimeoutMs / 2);
    const progress = { loaded: 5, total: knownTotal ? 10 : 0, lengthComputable: knownTotal };
    request.onprogress(progress);
    t.mock.timers.tick(imageLoadingPolicy.downloadIdleTimeoutMs - 1);
    assert.equal(request.aborted, false, 'New bytes restart the idle window');
    request.onprogress(progress);
    t.mock.timers.tick(1); await rejected;
    assert.equal(request.aborted, true);
    assert.equal(loading.loadedBytes, 5); assert.equal(loading.totalBytes, knownTotal ? 10 : undefined);
    assert.equal(loading.isVisible, false);
    assert.equal(getImageCacheStats().regular.size, 0);
  });

  test(`slow downloads can exceed many idle windows while bytes keep arriving (Content-Length: ${knownTotal})`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    clearImageCaches(); XHR.requests = [];
    const manager = new ImageLoaderManager();
    t.after(() => { manager.cleanup(); clearImageCaches(); });
    let errors = 0;
    const promise = manager.loadImage('slow', { onError: () => errors++ });
    t.mock.timers.tick(imageLoadingPolicy.requestDelayMs);
    const request = XHR.requests[0]!;
    for (let loaded = 1; loaded <= 6; loaded++) {
      t.mock.timers.tick(imageLoadingPolicy.downloadIdleTimeoutMs - 1);
      assert.equal(request.aborted, false);
      request.onprogress({ loaded, total: knownTotal ? 10 : 0, lengthComputable: knownTotal });
    }
    request.onload();
    assert((await promise).blobSrc.startsWith('blob:'));
    t.mock.timers.tick(imageLoadingPolicy.downloadIdleTimeoutMs * 2);
    assert.equal(request.aborted, false); assert.equal(errors, 0);
  });
}

test('conversion queue limits concurrency and native-format policy/config match upstream', async () => {
  const queue = new ImageConversionPipeline({ maxConcurrent: 2 });
  const a = deferred<void>(), b = deferred<void>();
  const first = queue.enqueue(() => a.promise), second = queue.enqueue(() => b.promise);
  let ran = false; const third = queue.enqueue(async () => { ran = true; });
  assert.equal(queue.getActiveCount(), 2); assert.equal(queue.getPendingCount(), 1); assert.equal(ran, false);
  a.resolve(); await first; await third; b.resolve(); await second;
  assert.equal(ran, true);
  assert.equal(needsImageConversion('image/heic', 'Version/17.0 Safari'), false);
  assert.equal(needsImageConversion('image/heif', 'Version/16.0 Safari'), true);
  assert.equal(needsImageConversion('image/heic', 'Chrome Safari'), true);
  assert.equal(needsImageConversion('image/tiff', 'Version/17.0 Safari'), false);
  assert.equal(needsImageConversion('image/tiff', 'Firefox'), true);
  assert.equal(needsImageConversion('image/jpeg', 'Firefox'), false);
  assert.equal(imageViewerConfig.minScale, 1); assert.equal(imageViewerConfig.maxScale, 20);
});
