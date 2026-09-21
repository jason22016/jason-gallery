import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium, firefox, webkit, type Browser, type BrowserType } from 'playwright';
import { browserReadyTimeout } from '../browser';
import { serveSemanticBrowserFixture } from './server';

let server: Awaited<ReturnType<typeof serveSemanticBrowserFixture>>;

before(async () => { server = await serveSemanticBrowserFixture(); }, { timeout: 60_000 });
after(async () => { await server?.close(); });

const engines: Array<{
  label: string;
  browserType: BrowserType<Browser>;
  launch: Parameters<BrowserType<Browser>['launch']>[0];
  evidence: 'real-browser-desktop' | 'playwright-engine-simulated';
}> = [
  { label: 'Google Chrome', browserType: chromium, launch: { channel: 'chrome', headless: true }, evidence: 'real-browser-desktop' },
  { label: 'Playwright Firefox', browserType: firefox, launch: { headless: true }, evidence: 'playwright-engine-simulated' },
  { label: 'Playwright WebKit', browserType: webkit, launch: { headless: true }, evidence: 'playwright-engine-simulated' },
];

for (const engine of engines) test(`${engine.label} loads Brotli assets, selects a viable backend, and handles Cache Storage/Worker/session lifecycle`, { timeout: 360_000 }, async t => {
  server.setFault('none'); server.resetRequests();
  const browser = await engine.browserType.launch(engine.launch);
  t.after(() => browser.close());
  const context = await browser.newContext();
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(browserReadyTimeout(240_000));
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${server.url}/?backend=auto`);
  await page.waitForFunction(() => Boolean(window.semanticTest));
  const storageProbe = await page.evaluate(async () => {
    if (!('caches' in globalThis)) return { available: false, roundTrip: false };
    const name = 'semantic-phase3c-storage-probe';
    try {
      const cache = await caches.open(name);
      await cache.put('/probe', new Response('ok'));
      const roundTrip = await (await cache.match('/probe'))?.text() === 'ok';
      await caches.delete(name);
      return { available: true, roundTrip };
    } catch { return { available: true, roundTrip: false }; }
  });
  assert.deepEqual(storageProbe, { available: true, roundTrip: true });
  await page.evaluate(() => window.semanticTest.clearCaches());
  server.resetRequests();
  const started = performance.now();
  const ready = await page.evaluate(() => window.semanticTest.enable());
  const coldReadyMs = performance.now() - started;
  const capabilities = await page.evaluate(() => ({ userAgent: navigator.userAgent, webgpuExposed: Boolean(navigator.gpu), visibilityState: document.visibilityState }));
  assert.equal(ready.status, 'ready');
  assert(['webgpu', 'wasm'].includes(ready.backend ?? ''));
  assert(['persistent', 'memory'].includes(ready.cache), String(ready.cache));
  if (!capabilities.webgpuExposed) {
    assert.equal(ready.backend, 'wasm');
    assert.equal(ready.fallbackReason, 'WebGPU adapter unavailable');
  }
  assert(server.requests.some(pathname => pathname.endsWith('/tokenizer.json.br')), 'Brotli tokenizer must be served and decoded');
  assert(server.requests.some(pathname => pathname.endsWith('/model.onnx.part-000.br')), 'Brotli model parts must be served and decoded');
  const lake = await page.evaluate(() => window.semanticTest.search('Trees reflected in a blue lake', 3));
  const mountain = await page.evaluate(() => window.semanticTest.search('阳光把雪山山顶染成金色', 3));
  assert.equal(lake.results[0]?.publicId, 'CP1txp1O9UsIKCzj');
  assert.equal(mountain.results[0]?.publicId, 'AurF9dVsFmUPqefx');
  const diagnostics = await page.evaluate(() => window.semanticTest.diagnostics());
  assert.equal(diagnostics.workerStarts, 1);
  assert.equal(diagnostics.sessionInitializations, 1);
  assert.equal(diagnostics.stateListeners, 1);

  await page.reload(); await page.waitForFunction(() => Boolean(window.semanticTest));
  server.resetRequests();
  const cachedStarted = performance.now();
  const cached = await page.evaluate(() => window.semanticTest.enable());
  const cachedReadyMs = performance.now() - cachedStarted;
  assert.equal(cached.status, 'ready');
  const payloadRequests = server.requests.filter(pathname => /(?:model\.onnx\.part-\d+|tokenizer(?:_config)?\.json)\.br$/.test(pathname)).length;
  if (payloadRequests === 0) {
    assert.equal(cached.cache, 'persistent');
    assert.equal((await page.evaluate(() => window.semanticTest.diagnostics())).persistentCacheHits, 1);
  } else {
    const recovered = await page.evaluate(() => window.semanticTest.diagnostics());
    assert.equal(recovered.modelDownloads, 1, 'an engine-evicted generation must safely redownload as one complete release');
    assert.equal(recovered.persistentCacheHits, 0);
    assert.equal(cached.status, 'ready');
  }
  assert.equal((await page.evaluate(() => window.semanticTest.search('A ferry tied beside a concrete pier', 1))).results.length, 1);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ semanticCompatibility: { label: engine.label, evidence: engine.evidence, browserVersion: browser.version(), ...capabilities, backend: ready.backend, fallbackReason: ready.fallbackReason ?? null, cache: { cold: ready.cache, reload: cached.cache, payloadRequestsOnReload: payloadRequests }, coldReadyMs: Math.round(coldReadyMs), cachedReadyMs: Math.round(cachedReadyMs), queryMs: [lake.elapsedMs, mountain.elapsedMs], platformScope: 'macOS desktop only; WebKit is not real Safari and no result is mobile evidence' } }));
});
