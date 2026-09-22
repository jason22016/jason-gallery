import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { browserReadyTimeout, softwareGPUOptions } from '../browser';
import { serveSemanticBrowserFixture } from './server';

let browser: Browser;
let server: Awaited<ReturnType<typeof serveSemanticBrowserFixture>>;

before(async () => {
  server = await serveSemanticBrowserFixture();
  browser = await chromium.launch(process.env.CI
    ? softwareGPUOptions('webgpu')
    : { channel: 'chrome', headless: true, args: ['--enable-precise-memory-info'] });
}, { timeout: 60_000 });

after(async () => { await browser?.close(); await server?.close(); });

async function harness(query = '', browserInstance = browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browserInstance.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(browserReadyTimeout(240_000));
  await page.goto(`${server.url}/${query}`);
  await page.waitForFunction(() => Boolean((window as unknown as { semanticTest?: unknown }).semanticTest));
  return { context, page };
}

for (const backend of ['auto', 'wasm']) test(`Project scoped ranking uses the real ${backend} Worker without losing low global ranks or changing other queries`, { timeout: 300_000 }, async t => {
  server.setFault('none');
  const { context, page } = await harness(`?backend=${backend}&storage=off`);
  t.after(() => context.close());
  await page.evaluate(() => window.semanticTest.enable());
  const all = await page.evaluate(() => window.semanticTest.search('Trees reflected in a blue lake', 6));
  const expected = all.results.slice(-2);
  const scoped = await page.evaluate(async ids => {
    const pending = window.semanticTest.search('Trees reflected in a blue lake', 2, ids);
    ids.splice(0, ids.length, 'unknown');
    return pending;
  }, expected.map(result => result.publicId).reverse());
  assert.deepEqual(scoped.results.map(result => result.publicId), expected.map(result => result.publicId));
  assert.deepEqual(scoped.results.map(result => result.rank), [1, 2]);
  scoped.results.forEach((result, index) => assert(Math.abs(result.score - expected[index]!.score) < 1e-6));
  const singleton = await page.evaluate(id => window.semanticTest.search('Trees reflected in a blue lake', 6, [id, id]), expected[0]!.publicId);
  assert.equal(singleton.results.length, 1);
  for (const scope of [[], ['unknown']]) {
    const invalid = await page.evaluate(ids => window.semanticTest.search('Trees reflected in a blue lake', 1, ids).then(() => null, error => error.code), scope);
    assert.equal(invalid, 'INVALID_SCOPE');
  }
  assert.equal((await page.evaluate(() => window.semanticTest.state())).status, 'ready');
  const globalAgain = await page.evaluate(() => window.semanticTest.search('Trees reflected in a blue lake', 2));
  assert.deepEqual(globalAgain.results.map(result => result.publicId), all.results.slice(0, 2).map(result => result.publicId));
  const diagnostics = await page.evaluate(() => window.semanticTest.diagnostics());
  assert.equal(diagnostics.workerStarts, 1);
  assert.equal(diagnostics.sessionInitializations, 1);
  assert.equal(diagnostics.modelDownloads, 1);
});

test('cold WebGPU download, progress, Top-K, cancellation, worker reuse and persistent refresh', { timeout: 300_000 }, async t => {
  server.setFault('none');
  const { context, page } = await harness('?backend=auto');
  t.after(() => context.close());
  await page.evaluate(() => window.semanticTest.clearCaches());
  server.resetRequests();
  const coldStarted = performance.now();
  const ready = await page.evaluate(() => window.semanticTest.enable());
  const coldMs = performance.now() - coldStarted;
  assert.equal(ready.status, 'ready');
  assert.equal(ready.backend, 'webgpu');
  assert.equal(ready.cache, 'persistent');
  assert.equal(ready.progress.downloadedBytes, 111_166_042);
  const states = await page.evaluate(() => window.semanticTest.states);
  for (const status of ['not-downloaded', 'downloading', 'verifying', 'initializing', 'ready']) assert(states.some(state => state.status === status), status);
  const progress = states.filter(state => state.status === 'downloading').map(state => state.progress.downloadedBytes);
  assert(progress.length > 3 && progress.at(-1) === 111_166_042);
  assert(progress.every((value, index) => index === 0 || value >= progress[index - 1]!));
  assert(server.requests.some(pathname => /\/model\.onnx\.part-\d+\.br$/.test(pathname)));
  assert(server.requests.some(pathname => pathname.endsWith('/ort-wasm-simd-threaded.asyncify.mjs')));
  assert(server.requests.some(pathname => pathname.endsWith('/ort-wasm-simd-threaded.asyncify.wasm.br')));

  const golden = await page.evaluate(() => window.semanticTest.search('阳光把雪山山顶染成金色', 3));
  assert.deepEqual(golden.results.map(result => result.publicId), ['AurF9dVsFmUPqefx', 'cn5AQ_QzZObYC1T6', 'IoJgKXf3_oiiL8Xz']);
  assert(Math.abs(golden.results[0]!.score - 0.1322941) < 2e-5);
  const lake = await page.evaluate(() => window.semanticTest.search('Trees reflected in a blue lake', 3));
  assert.deepEqual(lake.results.map(result => result.publicId), ['CP1txp1O9UsIKCzj', 'BBijJPwxpqz_9pI1', 'ti9q124e1ZUxwyD-']);
  assert.equal(await page.evaluate(() => window.semanticTest.cancel('A path through a dense green forest')), 'AbortError');
  const rapid = await page.evaluate(() => window.semanticTest.rapid('A close-up photograph of a chipmunk', 'Trees reflected in a blue lake'));
  assert.equal(rapid.stale, 'AbortError');
  assert.equal(rapid.latest.results[0]?.publicId, 'CP1txp1O9UsIKCzj');
  assert.deepEqual(await page.evaluate(() => window.semanticTest.diagnostics()), {
    workerStarts: 1, sessionInitializations: 1, queries: 5, modelDownloads: 1, persistentCacheHits: 0, stateListeners: 1,
  });
  assert.equal((await page.evaluate(() => window.semanticTest.cycleSubscriptions(100))).stateListeners, 1, 'temporary listeners must fully detach');

  await page.requestGC();
  const heapBefore = await page.evaluate(() => (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null);
  const sustained = await page.evaluate(async () => {
    const timings: number[] = [];
    const queries = ['湖边孤零零的一棵树', 'A ferry tied beside a concrete pier', '古城 gate 前鋪著 colorful flowers'];
    for (let index = 0; index < 30; index++) timings.push((await window.semanticTest.search(queries[index % queries.length]!, 5)).elapsedMs);
    const aborts: string[] = [];
    for (let index = 0; index < 20; index++) aborts.push(await window.semanticTest.cancel(`cancel cycle ${index}`));
    return { timings, aborts, diagnostics: window.semanticTest.diagnostics() };
  });
  await page.requestGC();
  const heapAfter = await page.evaluate(() => (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null);
  assert(sustained.timings.every(value => Number.isFinite(value) && value > 0));
  assert(sustained.aborts.every(value => value === 'AbortError'));
  assert.equal(sustained.diagnostics.workerStarts, 1);
  assert.equal(sustained.diagnostics.sessionInitializations, 1);
  assert.equal(sustained.diagnostics.stateListeners, 1);
  if (heapBefore !== null && heapAfter !== null) assert(heapAfter <= heapBefore + 16 * 1024 * 1024, `page heap grew unexpectedly: ${heapBefore} -> ${heapAfter}`);

  const background = await context.newPage();
  await background.goto('about:blank'); await background.bringToFront();
  const recoveredInBackground = await page.evaluate(() => window.semanticTest.search('A white bird skimming the water', 3));
  await page.bringToFront(); await background.close();
  assert.equal(recoveredInBackground.results.length, 3);
  assert.equal((await page.evaluate(() => window.semanticTest.diagnostics())).workerStarts, 1);

  await page.evaluate(() => window.semanticTest.addOldCache());
  await page.reload();
  await page.waitForFunction(() => Boolean(window.semanticTest));
  server.resetRequests();
  const cachedStarted = performance.now();
  const cachedReady = await page.evaluate(() => window.semanticTest.enable());
  const cachedMs = performance.now() - cachedStarted;
  assert.equal(cachedReady.status, 'ready');
  assert.equal(cachedReady.cache, 'persistent');
  assert.equal(server.requests.filter(pathname => /(?:model\.onnx\.part-\d+|tokenizer(?:_config)?\.json)\.br$/.test(pathname)).length, 0, 'reload must not fetch model payloads');
  assert.equal((await page.evaluate(() => window.semanticTest.diagnostics())).persistentCacheHits, 1);
  assert((await page.evaluate(() => window.semanticTest.cacheNames())).every(name => !name.includes('obsolete-r0')));

  await page.evaluate(() => window.semanticTest.corruptCache('tokenizer.json', 'corrupt'));
  await page.reload(); await page.waitForFunction(() => Boolean(window.semanticTest));
  server.resetRequests();
  const recovered = await page.evaluate(() => window.semanticTest.enable());
  assert.equal(recovered.status, 'ready');
  assert(server.requests.some(pathname => pathname.endsWith('/tokenizer.json.br')));
  assert(server.requests.some(pathname => /\/model\.onnx\.part-\d+\.br$/.test(pathname)), 'corruption invalidates and replaces the indivisible release');

  console.log(JSON.stringify({ semanticPerformance: { environment: 'macOS desktop Google Chrome headless; not mobile evidence', coldReadyMs: Math.round(coldMs), cachedReadyMs: Math.round(cachedMs), webgpuQueryMs: [golden.elapsedMs, lake.elapsedMs], sustainedQueryMs: sustained.timings, pageHeapBytes: { before: heapBefore, after: heapAfter } } }));
});

test('compatible-index and asset SHA failures are fail-closed and retry recovers', { timeout: 300_000 }, async t => {
  const mismatch = await harness('?backend=auto');
  t.after(() => mismatch.context.close());
  await mismatch.page.evaluate(() => window.semanticTest.clearCaches());
  server.setFault('index-mismatch'); server.resetRequests();
  const mismatchError = await mismatch.page.evaluate(() => window.semanticTest.enable().then(() => null, error => ({ code: error.code, state: window.semanticTest.state() })));
  assert.equal(mismatchError?.code, 'UPDATE_REQUIRED');
  assert.equal(mismatchError?.state.status, 'update-required');
  assert.equal(server.requests.some(pathname => /\/model\.onnx\.part-\d+\.br$/.test(pathname)), false, 'compatibility is checked before model download');
  await mismatch.context.close();

  for (const fault of ['vectors-sha', 'vectors-truncated'] as const) {
    const vectors = await harness('?backend=auto');
    t.after(() => vectors.context.close());
    await vectors.page.evaluate(() => window.semanticTest.clearCaches());
    server.setFault(fault); server.resetRequests();
    const vectorError = await vectors.page.evaluate(() => window.semanticTest.enable().then(() => null, error => ({ code: error.code, state: window.semanticTest.state() })));
    assert.equal(vectorError?.state.status, 'error');
    assert(['INDEX_INTEGRITY', 'INDEX_UNAVAILABLE'].includes(vectorError?.code ?? ''), String(vectorError?.code));
    assert.equal(server.requests.some(pathname => /\/model\.onnx\.part-\d+\.br$/.test(pathname)), false, `${fault} must stop before model download`);
    await vectors.context.close();
  }

  const truncated = await harness('?backend=auto');
  t.after(() => truncated.context.close());
  await truncated.page.evaluate(() => window.semanticTest.clearCaches());
  server.setFault('asset-truncated'); server.resetRequests();
  const truncatedError = await truncated.page.evaluate(() => window.semanticTest.enable().then(() => null, error => ({ code: error.code, state: window.semanticTest.state() })));
  assert.equal(truncatedError?.code, 'MODEL_DOWNLOAD');
  assert.equal(truncatedError?.state.status, 'error');
  await truncated.context.close();

  const integrity = await harness('?backend=auto');
  t.after(() => integrity.context.close());
  await integrity.page.evaluate(() => window.semanticTest.clearCaches());
  server.setFault('asset-sha'); server.resetRequests();
  const integrityError = await integrity.page.evaluate(() => window.semanticTest.enable().then(() => null, error => ({ code: error.code, state: window.semanticTest.state() })));
  assert.equal(integrityError?.code, 'MODEL_INTEGRITY');
  assert.equal(integrityError?.state.status, 'error');
  assert.equal(server.requests.some(pathname => /\/model\.onnx\.part-\d+\.br$/.test(pathname)), false, 'tokenizer SHA mismatch stops the release transaction');
  server.setFault('none');
  const recovered = await integrity.page.evaluate(() => window.semanticTest.retry());
  assert.equal(recovered.status, 'ready');
  assert.equal((await integrity.page.evaluate(() => window.semanticTest.search('Trees reflected in a blue lake', 1))).results[0]?.publicId, 'CP1txp1O9UsIKCzj');
});

test('explicit no-WebGPU path uses reusable WASM and storage-unavailable memory fallback', { timeout: 300_000 }, async t => {
  server.setFault('none'); server.resetRequests();
  const { context, page } = await harness('?backend=wasm&storage=off');
  t.after(() => context.close());
  const ready = await page.evaluate(() => window.semanticTest.enable());
  assert.equal(ready.status, 'ready');
  assert.equal(ready.backend, 'wasm');
  assert.equal(ready.cache, 'memory');
  const first = await page.evaluate(() => window.semanticTest.search('阳光把雪山山顶染成金色', 1));
  const second = await page.evaluate(() => window.semanticTest.search('Trees reflected in a blue lake', 1));
  assert.equal(first.results[0]?.publicId, 'AurF9dVsFmUPqefx');
  assert.equal(second.results[0]?.publicId, 'CP1txp1O9UsIKCzj');
  const diagnostics = await page.evaluate(() => window.semanticTest.diagnostics());
  assert.equal(diagnostics.workerStarts, 1);
  assert.equal(diagnostics.sessionInitializations, 1);
  assert.equal(diagnostics.queries, 2);
  console.log(JSON.stringify({ semanticPerformance: { wasmQueryMs: [first.elapsedMs, second.elapsedMs] } }));
});

test('auto backend falls back to WASM when WebGPU is unavailable', { timeout: 300_000 }, async t => {
  server.setFault('none');
  const { context, page } = await harness('?backend=auto&storage=off&worker=no-webgpu');
  t.after(() => context.close());
  const ready = await page.evaluate(() => window.semanticTest.enable());
  assert.equal(ready.status, 'ready');
  assert.equal(ready.backend, 'wasm');
  assert.equal(ready.fallbackReason, 'WebGPU adapter unavailable');
  assert.equal((await page.evaluate(() => window.semanticTest.search('Trees reflected in a blue lake', 1))).results[0]?.publicId, 'CP1txp1O9UsIKCzj');
});

test('reload during an interrupted download leaves no complete marker and a clean retry succeeds', { timeout: 300_000 }, async t => {
  server.setFault('slow-asset'); server.resetRequests();
  const { context, page } = await harness('?backend=wasm');
  t.after(() => context.close());
  await page.evaluate(() => window.semanticTest.clearCaches());
  await page.evaluate(() => { void window.semanticTest.enable().catch(() => {}); });
  await page.waitForFunction(() => window.semanticTest.state().status === 'downloading');
  await page.waitForFunction(() => window.semanticTest.state().progress.downloadedBytes > 0);
  await new Promise<void>((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      if (server.requests.some(pathname => pathname.endsWith('/model.onnx.part-000.br'))) resolve();
      else if (Date.now() - started > 30_000) reject(new Error('slow model request did not start'));
      else setTimeout(poll, 20);
    };
    poll();
  });
  server.setFault('none');
  await page.reload(); await page.waitForFunction(() => Boolean(window.semanticTest));
  assert.equal((await page.evaluate(() => window.semanticTest.cacheNames())).some(name => name.includes('siglip2-base-v64k-uint4-b32-r1')), false, 'interrupted generations must not have a completion marker/cache');
  server.resetRequests();
  const ready = await page.evaluate(() => window.semanticTest.enable());
  assert.equal(ready.status, 'ready');
  assert.equal(ready.cache, 'persistent');
  assert(server.requests.some(pathname => pathname.endsWith('/model.onnx.part-000.br')));
  assert.equal((await page.evaluate(() => window.semanticTest.search('A ferry tied beside a concrete pier', 1))).results.length, 1);
});
