import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright';
import { expect } from 'playwright/test';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { serve } from '../website/server';
import { softwareGPUOptions } from '../browser';

let browser: Browser, server: Awaited<ReturnType<typeof serve>>;
before(async () => { server = await serve('.cache/viewer-dist'); browser = await chromium.launch(softwareGPUOptions()); });
after(async () => { await browser?.close(); await server?.close(); });
async function pageFor(mode: 'auto' | 'webgl' | 'no-gpu' | 'webgpu-failure' = 'auto') {
  const page = await browser.newPage();
  await page.addInitScript({ content: `
    const mode = ${JSON.stringify(mode)};
    if (mode !== 'auto') Object.defineProperty(navigator, 'gpu', { configurable: true, value: mode === 'webgpu-failure' ? { requestAdapter: async () => { throw new Error('injected'); } } : undefined });
    if (mode === 'no-gpu') {
      const get = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(kind, ...args) { return ['webgl','webgl2','webgpu'].includes(kind) ? null : Reflect.apply(get, this, [kind, ...args]); };
    }
  ` });
  return page;
}
async function loaded(page: Page, renderer?: string) {
  await expect(page.locator('.viewer-media')).toHaveAttribute('data-media-state', 'loaded', { timeout: 30_000 });
  if (renderer) await expect(page.locator('.viewer-media')).toHaveAttribute('data-renderer', renderer);
  assert.equal(await page.locator('.viewer-preview').count(), 0);
}

test('production PhotoMedia keeps thumbnail until real WebGPU queue completion and first frame handoff', async () => {
  const page = await pageFor();
  try {
    await page.addInitScript({ content: `
      const done = GPUQueue.prototype.onSubmittedWorkDone;
      window.gpuCompleted = false;
      GPUQueue.prototype.onSubmittedWorkDone = function() {
        return done.call(this).then(() => { window.gpuCompleted = true; return new Promise(resolve => { window.releaseGPU = resolve; }); });
      };
    ` });
    await page.goto(`${server.url}/loader.html?src=/hdr.jpg`);
    await page.waitForFunction('window.gpuCompleted');
    await expect(page.locator('.viewer-media')).toHaveAttribute('data-media-state', 'loading');
    await expect(page.locator('.viewer-preview')).toBeVisible();
    assert.equal(await page.evaluate(() => window.mediaTest.getState().ready), false);
    assert.equal(await page.locator('canvas').evaluate(e => getComputedStyle(e.parentElement!).opacity), '0');
    await page.evaluate('window.releaseGPU()');
    await loaded(page, 'webgpu');
    assert.equal(await page.evaluate(() => window.mediaTest.getState().ready), true);
  } finally { await page.close(); }
});

test('WebGL completion is fenced before handoff; post-load context loss still reaches Blob native fallback', async () => {
  const page = await pageFor('webgl');
  try {
    await page.addInitScript({ content: `
      const finish = WebGLRenderingContext.prototype.finish;
      const raf = window.requestAnimationFrame;
      let fenced = false, held = [];
      WebGLRenderingContext.prototype.finish = function() { finish.call(this); fenced = true; window.glCompleted = true; };
      window.requestAnimationFrame = function(cb) { if (fenced) { held.push(cb); return 0; } return raf(cb); };
      window.releaseGL = () => { fenced = false; for (const cb of held.splice(0)) raf(cb); };
    ` });
    await page.goto(`${server.url}/loader.html`);
    await page.waitForFunction('window.glCompleted');
    await expect(page.locator('.viewer-preview')).toBeVisible();
    await expect(page.locator('.viewer-media')).toHaveAttribute('data-media-state', 'loading');
    await page.evaluate('window.releaseGL()'); await loaded(page, 'webgl');
    await page.evaluate(() => document.querySelector('canvas')!.getContext('webgl')!.getExtension('WEBGL_lose_context')!.loseContext());
    await loaded(page, 'image');
    assert((await page.locator('.viewer-fallback').getAttribute('src'))!.startsWith('blob:'));
    await page.evaluate(() => window.mediaTest.zoomIn());
    assert((await page.evaluate(() => window.mediaTest.getState().scale))! > 1);
  } finally { await page.close(); }
});

test('normal flow uses one network original, reuses cached Blob, and falls WebGPU → WebGL → native', async () => {
  for (const mode of ['auto', 'webgpu-failure', 'no-gpu'] as const) {
    const page = await pageFor(mode);
    let originals = 0;
    page.on('request', request => { if (new URL(request.url()).pathname === '/hdr.jpg') originals++; });
    try {
      await page.goto(`${server.url}/loader.html?src=/hdr.jpg`);
      await loaded(page, mode === 'auto' ? 'webgpu' : mode === 'webgpu-failure' ? 'webgl' : 'image');
      assert.equal(originals, 1, 'GPU workers/native fallback must consume the downloaded Blob');
      await page.evaluate(() => window.mediaTest.mount('/ordinary.jpg')); await loaded(page);
      await page.evaluate(() => window.mediaTest.mount('/hdr.jpg')); await loaded(page);
      assert.equal(originals, 1, 'Revisit must not download the original again');
      await page.evaluate(() => { window.mediaTest.clearImageCaches(); });
      if (mode === 'no-gpu') {
        const blob = await page.locator('.viewer-fallback').getAttribute('src');
        assert.equal(await page.evaluate(async src => (await fetch(src!)).ok, blob), true, 'Mounted lease survives cache clear');
        await page.evaluate(() => window.mediaTest.close());
        await expect(page.locator('.viewer-media')).toHaveCount(0);
        assert.equal(await page.evaluate(async src => { try { await fetch(src!); return true; } catch { return false; } }, blob), false);
      }
    } finally { await page.close(); }
  }
});

test('real HEIC and TIFF decode to full-size JPEG Blob; native fallback consumes converted Blob too', { timeout: 90_000 }, async () => {
  for (const mode of ['auto', 'no-gpu'] as const) {
    const page = await pageFor(mode);
    try {
      for (const src of ['/ordinary.heic', '/ordinary.tiff', '/gray.tiff']) {
        await page.goto(`${server.url}/loader.html?src=${src}`);
        await loaded(page, mode === 'auto' ? 'webgpu' : 'image');
        const stats = await page.evaluate(() => window.mediaTest.getImageCacheStats());
        assert.equal(stats.converted.size, 1, src);
        const result = await page.evaluate(async src => {
          const manager = new window.mediaTest.ImageLoaderManager();
          const result = await manager.loadImage(new URL(src, location.href).href);
          const blob = await (await fetch(result.blobSrc)).blob();
          const bitmap = await createImageBitmap(blob);
          const out = { type: blob.type, width: bitmap.width, height: bitmap.height, converted: !!result.convertedUrl };
          bitmap.close(); manager.cleanup(); return out;
        }, src);
        assert.deepEqual(result, { type: 'image/jpeg', width: 96, height: 64, converted: true });
        // Compare screenshot center to the ordinary original (grayscale separately).
        const screenshot = await page.locator(mode === 'auto' ? 'canvas' : '.viewer-fallback').screenshot();
        const actual = [...await sharp(screenshot).resize(1, 1).removeAlpha().raw().toBuffer()];
        const expected = [...await sharp(await readFile('.cache/viewer-fixtures/ordinary.jpg')).resize(1, 1).removeAlpha().raw().toBuffer()];
        if (src === '/gray.tiff') assert(Math.max(...actual) - Math.min(...actual) <= 3, String(actual));
        else assert(actual.every((value, i) => Math.abs(value - expected[i]!) < 8), `${src}: ${actual} vs ${expected}`);
      }
    } finally { await page.close(); }
  }
});

test('CORS/download failure retains direct native fallback; complete failure shows retry and can recover', async () => {
  const page = await pageFor('no-gpu');
  try {
    await page.route('**/hdr.jpg', route => route.request().resourceType() === 'xhr' ? route.abort() : route.continue());
    await page.goto(`${server.url}/loader.html?src=/hdr.jpg`);
    await loaded(page, 'image');
    assert.equal(await page.locator('.viewer-fallback').getAttribute('src'), '/hdr.jpg');
    await page.unroute('**/hdr.jpg');
    await page.route('**/broken.jpg', route => route.fulfill({ status: 404, body: 'not found' }));
    await page.evaluate(() => window.mediaTest.mount('/broken.jpg'));
    await expect(page.locator('.viewer-media')).toHaveAttribute('data-media-state', 'error');
    await expect(page.getByRole('alert')).toHaveText('照片加载失败');
    await expect(page.locator('.viewer-preview')).toBeVisible();
    await page.unroute('**/broken.jpg');
    await page.route('**/broken.jpg', route => route.fulfill({ status: 200, contentType: 'image/jpeg', path: '.cache/viewer-fixtures/ordinary.jpg' }));
    await page.getByRole('button', { name: '重新加载' }).click(); await loaded(page, 'image');
  } finally { await page.close(); }
});

test('navigation/unmount cancels delayed and in-flight originals, and stale results cannot replace current photo', async () => {
  const page = await pageFor('no-gpu');
  try {
    await page.goto(`${server.url}/loader.html`); await loaded(page);
    let premature = 0;
    page.on('request', r => { if (r.url().includes('never-start')) premature++; });
    await page.evaluate(() => window.mediaTest.mount('/never-start.jpg'));
    await expect(page.locator('.viewer-media')).toHaveAttribute('data-media-state', 'loading');
    await page.evaluate(() => window.mediaTest.close());
    await page.waitForTimeout(350); assert.equal(premature, 0);
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/slow.jpg', async route => { await held; await route.fulfill({ path: '.cache/viewer-fixtures/ordinary.jpg' }).catch(() => {}); });
    const request = page.waitForRequest('**/slow.jpg');
    await page.evaluate(() => window.mediaTest.mount('/slow.jpg')); await request;
    const cancelled = page.waitForEvent('requestfailed', r => r.url().endsWith('/slow.jpg'));
    await page.evaluate(() => window.mediaTest.mount('/hdr.jpg')); await cancelled;
    await loaded(page, 'image'); release();
    await page.waitForTimeout(100);
    assert.equal(await page.locator('.viewer-fallback').getAttribute('alt'), '/hdr.jpg');
    assert.equal((await page.evaluate(() => window.mediaTest.getImageCacheStats())).regular.keys.some(key => key.endsWith('/slow.jpg')), false);
  } finally { await page.close(); }
});

test('production Blob pipeline preserves JPEG ICC/HDR/gain-map bytes and SDR rendered colors', async () => {
  const { createHash } = await import('node:crypto');
  const page = await pageFor();
  try {
    for (const name of ['srgb-icc.jpg', 'p3-icc.jpg', 'hdr-p3.jpg', 'iso-mpf.jpg']) {
      await page.goto(`${server.url}/loader.html?src=/${name}`); await loaded(page, 'webgpu');
      const actualHash = await page.evaluate(async name => {
        const manager = new window.mediaTest.ImageLoaderManager();
        const result = await manager.loadImage(new URL(`/${name}`, location.href).href);
        const bytes = await (await fetch(result.blobSrc)).arrayBuffer();
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
        manager.cleanup(); return hash;
      }, name);
      const bytes = await readFile(`.cache/viewer-fixtures/${name}`);
      assert.equal(actualHash, createHash('sha256').update(bytes).digest('hex'), name);
      await page.evaluate(async name => {
        const reference = new Image(); reference.id = 'reference'; reference.src = `/${name}`;
        reference.style.cssText = 'width:640px;height:420px;object-fit:contain';
        await reference.decode(); document.body.append(reference);
      }, name);
      const colors: number[][] = [];
      for (const selector of ['canvas', '#reference']) {
        const { data, info } = await sharp(await page.locator(selector).screenshot()).raw().toBuffer({ resolveWithObject: true });
        const i = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * info.channels;
        colors.push([...data.subarray(i, i + 3)]);
      }
      assert(colors[0]!.every((value, i) => Math.abs(value - colors[1]![i]!) <= 3), `${name}: ${JSON.stringify(colors)}`);
    }
  } finally { await page.close(); }
});

test('actual post-load WebGPU device loss returns to preview, then WebGL, then native on context loss', async () => {
  const page = await pageFor();
  try {
    await page.addInitScript({ content: `
      const requestDevice = GPUAdapter.prototype.requestDevice;
      GPUAdapter.prototype.requestDevice = async function(...args) {
        const device = await requestDevice.apply(this, args); window.lastDevice = device; return device;
      };
    ` });
    await page.goto(`${server.url}/loader.html?src=/hdr.jpg`); await loaded(page, 'webgpu');
    const eventsBefore = (await page.evaluate(() => window.mediaTest.getState().events)).length;
    await page.evaluate('window.lastDevice.destroy()');
    await expect(page.locator('.viewer-media')).toHaveAttribute('data-renderer', 'webgl'); await loaded(page, 'webgl');
    const events = (await page.evaluate(() => window.mediaTest.getState().events)).slice(eventsBefore) as { ready?: boolean }[];
    assert(events.some(e => e.ready === false), 'Renderer restart disables controls and shows preview again');
    assert(events.some(e => e.ready === true), 'Controls return only after the replacement renderer completes');
    await page.evaluate(() => document.querySelector('canvas')!.getContext('webgl')!.getExtension('WEBGL_lose_context')!.loseContext());
    await loaded(page, 'image');
  } finally { await page.close(); }
});

test('retry invalidates an undecodable cached original before downloading corrected bytes', async () => {
  const page = await pageFor('no-gpu');
  try {
    await page.route('**/corrupt.jpg', route => route.fulfill({ contentType: 'image/jpeg', body: Buffer.from([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]) }));
    await page.goto(`${server.url}/loader.html?src=%2Fcorrupt.jpg`);
    await expect(page.locator('.viewer-media')).toHaveAttribute('data-media-state', 'error');
    assert.equal((await page.evaluate(() => window.mediaTest.getImageCacheStats())).regular.size, 1);
    await page.unroute('**/corrupt.jpg');
    await page.route('**/corrupt.jpg', route => route.fulfill({ path: '.cache/viewer-fixtures/ordinary.jpg', contentType: 'image/jpeg' }));
    await page.getByRole('button', { name: '重新加载' }).click(); await loaded(page, 'image');
  } finally { await page.close(); }
});
