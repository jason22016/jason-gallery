import { expectFallbackSource } from './viewer-assertions';
import { browserBundleForAudit } from '../viewer/bundle-audit';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { test, before, after } from 'node:test';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { expect } from 'playwright/test';
import { buildFixture, dist, repo, root, run } from './fixture';
import { serve } from './server';
import { colorFixtures } from '../viewer/color-fixtures';
import { softwareGPUOptions } from '../browser';

let fixture: Awaited<ReturnType<typeof buildFixture>>;
let browser: Browser;
let server: Awaited<ReturnType<typeof serve>>;
let productionBefore: Record<string, string>;

async function productionSnapshot() {
  const result: Record<string, string> = {};
  for (const directory of ['src/content/projects', 'src/data', 'public/thumbnails']) {
    const entries = await fs.readdir(path.join(repo, directory), { recursive: true, withFileTypes: true }).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      result[directory] = '<absent>';
      return [];
    });
    for (const entry of entries.filter(entry => entry.isFile())) {
      const filename = path.join(entry.parentPath, entry.name);
      result[path.relative(repo, filename)] = createHash('sha256').update(await fs.readFile(filename)).digest('hex');
    }
  }
  return result;
}

before(async () => {
  productionBefore = await productionSnapshot();
  fixture = await buildFixture();
  server = await serve();
  browser = await chromium.launch(softwareGPUOptions('webgl'));
  console.log(`Website browser: ${browser.version()}`);
}, { timeout: 120_000 });
after(async () => {
  await browser?.close(); await server?.close();
  assert.deepEqual(await productionSnapshot(), productionBefore, 'Website tests must not modify production Projects, Manifest, or thumbnails');
});

async function context(options: Parameters<Browser['newContext']>[0] = {}, gpu: 'none' | 'webgpu-failure' | 'native' = 'none') {
  const result = await browser.newContext(options);
  result.setDefaultTimeout(10_000);
  // Raw browser code avoids tsx/esbuild's __name helper on nested functions;
  // that helper does not exist in the browser's init-script realm.
  if (gpu !== 'native') await result.addInitScript({ content: `
    const mode = ${JSON.stringify(gpu)};
    window.testGPUAdapterRequests = 0;
    Object.defineProperty(navigator, 'gpu', { configurable: true, value: mode === 'none' ? undefined : {
      requestAdapter: async () => { window.testGPUAdapterRequests++; throw new Error('Injected WebGPU initialization failure'); },
    } });
    if (mode === 'none') {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
        if (['webgl', 'webgl2', 'experimental-webgl', 'webgpu'].includes(kind)) return null;
        return Reflect.apply(original, this, [kind, ...args]);
      };
    }
  ` });
  return result;
}

async function projectPage(ctx: BrowserContext, slug = 'fixture-beta') {
  const page = await ctx.newPage();
  await page.goto(`${server.url}/projects/${slug}/`);
  await page.locator('[data-viewer-ready="true"]').waitFor({ state: 'attached' });
  return page;
}
async function open(page: Page, index = 0) {
  await page.locator(`.gallery-live [data-gallery-index="${index}"]`).click();
  await expect(page.getByRole('dialog')).toBeVisible();
}
async function loaded(page: Page) { await expect(page.locator('.viewer-media')).toHaveAttribute('data-media-state', 'loaded', { timeout: 15_000 }); }
async function assertGPUFailureInjected(page: Page) {
  assert(await page.evaluate(() => (window as unknown as { testGPUAdapterRequests: number }).testGPUAdapterRequests > 0), 'Viewer must actually call the injected failing WebGPU adapter');
}

test('production routes, published order, cover, project fields and Gallery order work without JavaScript', async t => {
  const ctx = await context({ javaScriptEnabled: false }); t.after(() => ctx.close());
  const page = await ctx.newPage();
  await page.goto(server.url);
  assert.deepEqual(await page.locator('[data-project-slug]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-project-slug'))), ['fixture-beta', 'fixture-alpha', 'fixture-zeta']);
  await expect(page.locator('.project-card img').first()).toHaveAttribute('src', fixture.manifest.data.find(photo => photo.s3Key === 'ordinary.jpg')!.thumbnailUrl);
  await page.locator('.project-link').first().click();
  await expect(page).toHaveURL(/\/projects\/fixture-beta\/$/);
  assert.deepEqual(await page.locator('[data-photo-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-photo-id'))), fixture.photos.map(photo => photo.photoId));
  for (let i = 0; i < fixture.photos.length; i++) {
    const photo = fixture.manifest.data.find(photo => photo.id === fixture.photos[i]!.photoId)!;
    await expect(page.locator('.photo-grid img').nth(i)).toHaveAttribute('src', photo.thumbnailUrl);
    await expect(page.locator('[data-gallery-index]').nth(i)).toHaveAttribute('href', photo.originalUrl);
  }
  await page.locator('.static-info summary').click();
  await expect(page.locator('.project-details')).toContainText('Fixture location');
  await expect(page.locator('.project-details')).toContainText('2024-02-29 — 2024-03-01');
  await expect(page.locator('.project-description')).toContainText('<script>window.fixtureInjection = true</script>');
  await expect(page.locator('.tags')).toContainText('test-only');
  await page.locator('[data-gallery-index]').first().click();
  await expect(page).toHaveURL(/\/originals\/portrait.jpg$/);
});

test('draft/unknown routes return custom 404 and draft data never enters HTML or JavaScript; worker is isolated', async t => {
  const ctx = await context(); t.after(() => ctx.close());
  const page = await ctx.newPage();
  for (const slug of ['secret-draft', 'unknown-project']) {
    const response = await page.goto(`${server.url}/projects/${slug}/`);
    assert.equal(response!.status(), 404);
    await expect(page.getByRole('heading', { name: '找不到页面' })).toBeVisible();
    await page.getByRole('link', { name: '返回项目' }).click();
    await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
  }
  const files = await fs.readdir(dist, { recursive: true });
  assert(!files.some(file => file.includes('secret-draft')));
  assert(files.some(file => /webgpu-texture.worker-.*\.js$/.test(file)), 'production Astro emits the real WebGPU worker');
  for (const file of files.filter(file => /\.(html|js|json)$/.test(file))) {
    const text = await fs.readFile(path.join(dist, file), 'utf8');
    for (const value of ['DRAFT WEBSITE SECRET', 'PRIVATE PROJECT SUMMARY', 'PRIVATE PROJECT CAPTION', 'secret-draft', 'exiftool-vendored', 'node:fs', '@afilmory/builder', 'JASON_PHOTOS_READ_TOKEN', 'JASON_GALLERY_PHOTO_WORKDIR']) assert(!browserBundleForAudit(text).includes(value), `${file} leaked ${value}`);
  }
});

test('lazy Viewer, selection, buttons, keyboard limits, focus trap/restoration and GPU-to-img fallback', async t => {
  const ctx = await context(); t.after(() => ctx.close());
  const page = await ctx.newPage();
  const originals: string[] = [];
  const engineRequests: string[] = [];
  page.on('request', request => { if (request.url().includes('/originals/')) originals.push(request.url()); });
  page.on('request', request => { if (/\/(browser\.|webgpu-texture.worker-)/.test(request.url())) engineRequests.push(request.url()); });
  await page.goto(`${server.url}/projects/fixture-beta/`);
  await page.locator('[data-viewer-ready="true"]').waitFor({ state: 'attached' });
  assert.deepEqual(originals, [], 'closed Gallery loads only thumbnails');
  assert.deepEqual(engineRequests, [], 'GPU module and worker are deferred until opening');
  const props = await page.locator('astro-island').getAttribute('props');
  for (const field of ['exif', 's3Key', 'toneAnalysis', 'thumbnailUrl', 'lastModified']) assert(!props!.includes(`"${field}"`), `Viewer props contain unnecessary ${field}`);
  assert.equal(await page.evaluate(() => 'fixtureInjection' in window), false);
  await open(page, 1); await loaded(page);
  await expect(page.locator('.viewer-counter')).toHaveText('2 / 3');
  await expectFallbackSource(page, '/originals/hdr.jpg');
  await expect(page.locator('.hdr-status')).toHaveText('HDR source');
  assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden');
  await expect(page.getByRole('button', { name: '关闭照片' })).toBeFocused();
  await page.keyboard.press('ArrowRight'); await loaded(page);
  await expect(page.locator('.viewer-counter')).toHaveText('3 / 3');
  await expect(page.locator('.hdr-status')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '下一张照片' })).toBeDisabled();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.viewer-counter')).toHaveText('3 / 3');
  await page.keyboard.press('Home'); await loaded(page);
  await expect(page.getByRole('button', { name: '上一张照片' })).toBeDisabled();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.viewer-counter')).toHaveText('1 / 3');
  await page.getByRole('button', { name: '下一张照片' }).click(); await loaded(page);
  await page.getByRole('button', { name: '上一张照片' }).click(); await loaded(page);
  await page.keyboard.press('End'); await loaded(page);
  await expect(page.locator('.viewer-counter')).toHaveText('3 / 3');
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    assert(await page.evaluate(() => !!document.activeElement?.closest('dialog')), 'focus stays inside modal');
  }
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Shift+Tab');
    assert(await page.evaluate(() => !!document.activeElement?.closest('dialog')), 'reverse Tab stays inside modal');
  }
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.gallery-live [data-gallery-index]').nth(1)).toBeFocused();
  assert.equal(await page.evaluate(() => document.body.style.overflow), '');
  await page.keyboard.press('Enter'); await loaded(page);
  await page.getByRole('button', { name: '关闭照片' }).click();
  await expect(page.locator('.gallery-live [data-gallery-index]').nth(1)).toBeFocused();
});

test('loading is visible; switching/closing while requests are pending cannot revive an old photo', async t => {
  const ctx = await context(); t.after(() => ctx.close());
  const page = await projectPage(ctx);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  t.after(() => release());
  await page.route('**/originals/portrait.jpg', async route => { await pending; await route.continue().catch(() => {}); });
  await open(page);
  await expect(page.locator('.viewer-status')).toContainText('正在加载照片…');
  await page.keyboard.press('ArrowRight'); await loaded(page);
  release();
  await expectFallbackSource(page, '/originals/hdr.jpg');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  let releaseClosed!: () => void;
  const closedRequest = new Promise<void>(resolve => { releaseClosed = resolve; });
  t.after(() => releaseClosed());
  await page.unroute('**/originals/portrait.jpg');
  await page.route('**/originals/portrait.jpg', async route => { await closedRequest; await route.continue().catch(() => {}); });
  await open(page);
  await expect(page.locator('.viewer-status')).toContainText('正在加载照片…');
  await page.keyboard.press('Escape');
  releaseClosed();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await open(page, 2); await loaded(page);
  await expectFallbackSource(page, '/originals/ordinary.jpg');
});

test('failed GPU module download still opens the unmodified original image', async t => {
  const ctx = await context(); t.after(() => ctx.close());
  const page = await projectPage(ctx);
  await page.route(/\/_astro\/browser\.[^/]+\.js/, route => route.abort());
  await open(page); await loaded(page);
  await expect(page.locator('.viewer-media')).toHaveAttribute('data-renderer', 'image');
  await expectFallbackSource(page, '/originals/portrait.jpg');
});

test('thumbnail error, original error and successful retry remain usable', async t => {
  const ctx = await context(); t.after(() => ctx.close());
  const page = await ctx.newPage();
  await page.route(`**/thumbnails/${fixture.photos[0]!.photoId}.jpg`, route => route.abort());
  await page.route('**/originals/portrait.jpg', route => route.abort());
  await page.goto(`${server.url}/projects/fixture-beta/`);
  await page.locator('[data-viewer-ready="true"]').waitFor({ state: 'attached' });
  await expect(page.locator('.gallery-live .thumbnail-error').first()).toBeVisible();
  await open(page);
  await expect(page.getByRole('alert')).toHaveText('照片加载失败');
  await expect(page.locator('.viewer-actions a[aria-label="打开原图"]')).toHaveAttribute('href', '/originals/portrait.jpg');
  await page.unroute('**/originals/portrait.jpg');
  await page.getByRole('button', { name: '重新加载' }).click(); await loaded(page);
  await expectFallbackSource(page, '/originals/portrait.jpg');
  await page.keyboard.press('ArrowRight'); await loaded(page);
  await expect(page.locator('.viewer-counter')).toHaveText('2 / 3');
  await page.getByRole('button', { name: '关闭照片' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('real Afilmory WebGPU initialization failure falls back to WebGL in the Astro production bundle', async t => {
  const ctx = await context({}, 'webgpu-failure'); t.after(() => ctx.close());
  const page = await projectPage(ctx);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await open(page, 1); await loaded(page);
  await assertGPUFailureInjected(page);
  await expect(page.locator('.viewer-media')).toHaveAttribute('data-renderer', 'webgl');
  await expect(page.locator('.viewer-media canvas[role="img"]')).toHaveAttribute('aria-label', 'Fixture HDR image');
  await expect(page.locator('.hdr-status')).toHaveText('HDR source');
  await page.keyboard.press('ArrowRight'); await loaded(page);
  await expect(page.locator('.viewer-media')).toHaveAttribute('data-renderer', 'webgl');
  await page.keyboard.press('Escape');
  assert.deepEqual(errors, []);
});

test('mobile masonry layout, touch controls, single-photo boundaries and viewport resizing', async t => {
  const ctx = await context({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }); t.after(() => ctx.close());
  const page = await projectPage(ctx, 'fixture-zeta');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.locator('.gallery-live [data-gallery-index]').tap(); await loaded(page);
  for (const label of ['上一张照片', '下一张照片']) await expect(page.getByRole('button', { name: label })).toBeDisabled();
  for (const size of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(size);
    const box = await page.getByRole('dialog').boundingBox();
    assert(box && Math.abs(box.height - size.height) < 2 && Math.abs(box.width - size.width) < 2);
    const close = await page.getByRole('button', { name: '关闭照片' }).boundingBox();
    assert(close && close.height >= 44 && close.width >= 44);
    const media = await page.locator('.viewer-media').boundingBox(); assert(media && media.height > 100);
  }
  await page.getByRole('button', { name: '关闭照片' }).tap();
  await page.goto(`${server.url}/projects/fixture-beta/`);
  await page.locator('.gallery-live [data-gallery-index]').first().waitFor();
  const positions = await page.locator('.gallery-live [data-gallery-index]').evaluateAll(nodes => nodes.map(node => ({ left: node.getBoundingClientRect().left, top: node.getBoundingClientRect().top })));
  assert.notEqual(positions[0]!.left, positions[1]!.left, 'mobile masonry has two columns');
  assert.equal(positions[0]!.top, positions[1]!.top);
  await page.screenshot({ path: path.join(root, 'mobile-gallery.png'), fullPage: true });
});

test('desktop fixture screenshots and ordinary browsing have no uncaught runtime errors', async t => {
  const ctx = await context({ viewport: { width: 1440, height: 1000 } }); t.after(() => ctx.close());
  const page = await ctx.newPage();
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(server.url);
  await page.locator('gallery-thumbnail[data-state="loaded"]').first().waitFor();
  await page.screenshot({ path: path.join(root, 'desktop-home.png'), fullPage: true });
  await page.locator('.project-link').first().click();
  await page.locator('[data-viewer-ready="true"]').waitFor({ state: 'attached' });
  await page.screenshot({ path: path.join(root, 'desktop-gallery.png'), fullPage: true });
  await open(page); await loaded(page);
  await page.locator('[data-viewer-transition-variant]').waitFor({ state: 'detached' });
  await page.screenshot({ path: path.join(root, 'desktop-viewer.png') });
  await page.keyboard.press('Escape');
  assert.deepEqual(errors, []);
});

test('empty public catalog builds a useful home page, even when draft content exists', async t => {
  const directory = path.join(root, 'src/content/projects');
  const published = fixture.projects.filter(project => project.status === 'published');
  try {
    for (const project of published) await fs.rm(path.join(directory, `${project.slug}.json`));
    run([path.join(repo, 'node_modules/astro/bin/astro.mjs'), 'build', '--outDir', './empty-dist'], root);
    const emptyDist = path.join(root, 'empty-dist');
    const host = await serve(emptyDist); t.after(() => host.close());
    const ctx = await context(); t.after(() => ctx.close());
    const page = await ctx.newPage();
    await page.goto(host.url);
    await expect(page.getByRole('heading', { name: '尚无公开项目' })).toBeVisible();
    await expect(page.locator('[data-project-slug]')).toHaveCount(0);
    const html = await fs.readFile(path.join(emptyDist, 'index.html'), 'utf8');
    assert(!html.includes('DRAFT WEBSITE SECRET'));
    assert(!(await fs.readdir(emptyDist)).includes('projects'));
    assert.equal((await fs.readdir(path.join(emptyDist, 'thumbnails'))).length, 0);
    assert.equal((await fs.readdir(path.join(emptyDist, 'originals'))).length, 0);
    await page.screenshot({ path: path.join(root, 'empty-home.png'), fullPage: true });
  } finally {
    for (const project of published) await fs.writeFile(path.join(directory, `${project.slug}.json`), JSON.stringify(project));
  }
});

test('Light home: responsive cover geometry, hover/focus overlay, and two deliberate touch taps', async t => {
  const ctx = await context({ viewport: { width: 2048, height: 1000 } }); t.after(() => ctx.close());
  const page = await ctx.newPage(); await page.goto(server.url);
  const cover = page.locator('.project-link').first(), overlay = cover.locator('.project-overlay');
  await expect(overlay).toHaveCSS('opacity', '0'); await cover.hover(); await expect(overlay).toHaveCSS('opacity', '1');
  await expect(overlay.locator('time')).toHaveText('2024-02-29');
  for (const [width, count] of [[2048, 4], [1440, 4], [1000, 3], [768, 2], [390, 1]]) {
    await page.setViewportSize({ width: width!, height: 1000 });
    assert.equal(await page.locator('.project-grid').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length), count);
    const box = await cover.boundingBox(); assert(box && Math.abs(box.width / box.height - 5 / 6) < .01);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await page.mouse.move(0, 0); await cover.focus(); await expect(overlay).toHaveCSS('opacity', '1');
  const touchContext = await context({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); t.after(() => touchContext.close());
  const mobile = await touchContext.newPage(); await mobile.goto(server.url);
  const first = mobile.locator('.project-link').first();
  await first.tap(); await expect(first).toHaveAttribute('data-revealed', 'true'); await expect(mobile).toHaveURL(`${server.url}/`);
  await mobile.locator('.site-header').tap({ position: { x: 300, y: 60 } }); await expect(first).not.toHaveAttribute('data-revealed', 'true');
  await first.tap(); await first.tap(); await expect(mobile).toHaveURL(/projects\/fixture-beta\/$/);
});

test('project information, filters, chronological sort, list persistence, and shared viewer sequence', async t => {
  const ctx = await context(); t.after(() => ctx.close()); const page = await projectPage(ctx);
  await page.getByRole('button', { name: '项目信息', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Fixture location');
  await page.getByRole('button', { name: '关闭面板' }).click();
  await page.getByRole('button', { name: '搜索和筛选' }).click();
  await page.getByLabel('相机', { exact: true }).selectOption('NIKON Z6');
  await page.getByRole('button', { name: '查看 1 张照片' }).click();
  await expect(page.locator('.gallery-live [data-gallery-index]')).toHaveCount(1);
  await open(page); await loaded(page); await expect(page.locator('.viewer-counter')).toHaveText('1 / 1');
  await expect(page.locator('.viewer-inspector')).toContainText('Fixture artist');
  await expect(page.getByRole('button', { name: '下一张照片' })).toBeDisabled();
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '清除筛选' }).click();
  await page.getByRole('button', { name: '显示设置' }).click();
  await page.getByLabel('照片排序').selectOption('asc'); await page.getByLabel('瀑布流列数').selectOption('2');
  await page.getByRole('button', { name: '关闭面板' }).click();
  await open(page); await loaded(page); await expectFallbackSource(page, '/originals/ordinary.jpg');
  await page.getByRole('button', { name: '下一张照片' }).click(); await loaded(page); await expectFallbackSource(page, '/originals/hdr.jpg');
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '列表视图' }).click(); await expect(page.locator('.photo-list > li')).toHaveCount(3);
  await page.reload(); await expect(page.locator('.photo-list > li')).toHaveCount(3);
  await page.getByRole('button', { name: '搜索和筛选' }).click();
  await page.getByRole('searchbox').fill('no matching photograph'); await page.getByRole('button', { name: '查看 0 张照片' }).click();
  await expect(page.getByRole('heading', { name: '没有符合条件的照片' })).toBeVisible();
});

test('photo URLs support direct entry, refresh, Back/Forward, invalid IDs and project-scoped metadata', async t => {
  const ctx = await context({ reducedMotion: 'reduce' }); t.after(() => ctx.close());
  const page = await projectPage(ctx); await open(page, 1); await loaded(page);
  await expect(page).toHaveURL(new RegExp(`photo=${fixture.photos[1]!.photoId}`));
  await page.goBack(); await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goForward(); await loaded(page); await expect(page.locator('.viewer-counter')).toHaveText('2 / 3');
  await page.reload(); await loaded(page); await expect(page.locator('[data-viewer-transition-variant]')).toHaveCount(0);
  await page.getByRole('button', { name: '关闭照片' }).click(); await expect(page).toHaveURL(/fixture-beta\/$/);
  await page.goto(`${server.url}/projects/fixture-beta/?photo=missing`); await expect(page.locator('.gallery-notice')).toContainText('此照片不在当前项目中');
  await expect(page).toHaveURL(/fixture-beta\/$/);
  const details = await ctx.request.get(`${server.url}/projects/fixture-beta/photos/${fixture.photos[0]!.photoId}.json`);
  assert.equal(details.status(), 200); const json = await details.json(); assert.equal(json.exif.Artist, 'Fixture artist'); assert(!('s3Key' in json)); assert(!('RegionInfo' in json.exif));
  const privateId = fixture.manifest.data.find(p => p.s3Key === 'private.jpg')!.id;
  assert.equal((await ctx.request.get(`${server.url}/projects/fixture-beta/photos/${privateId}.json`)).status(), 404);
  assert.equal((await ctx.request.get(`${server.url}/projects/secret-draft/photos/${privateId}.json`)).status(), 404);
  assert.equal((await ctx.request.get(`${server.url}/thumbnails/${privateId}.jpg`)).status(), 404);
  assert.equal((await ctx.request.get(`${server.url}/originals/private.jpg`)).status(), 404);
  const unreferenced = fixture.manifest.data.find(p => p.s3Key === 'map-near.jpg')!;
  assert.equal((await ctx.request.get(`${server.url}/projects/fixture-beta/photos/${unreferenced.id}.json`)).status(), 404);
});

test('map has an accessible fallback and obeys current filters; missing GPS produces an empty state', async t => {
  const ctx = await context(); t.after(() => ctx.close()); const page = await projectPage(ctx);
  await page.route('**/*cartocdn.com/**', route => route.abort());
  await page.getByRole('button', { name: '地图探索' }).click();
  await expect(page.locator('.map-photo-list button')).toHaveCount(1);
  await page.locator('.map-photo-list button').click(); await loaded(page);
  await expectFallbackSource(page, '/originals/portrait.jpg');
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog', { name: '地图探索', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭面板' }).click();
  await page.getByRole('button', { name: '搜索和筛选' }).click(); await page.getByLabel('标签', { exact: true }).selectOption('风景');
  await page.getByRole('button', { name: '查看 1 张照片' }).click(); await page.getByRole('button', { name: '地图探索' }).click();
  await expect(page.getByRole('heading', { name: '没有可显示的位置' })).toBeVisible();
});

test('fallback zoom disables swipe navigation, resets, and the mobile inspector remains operable', async t => {
  const ctx = await context({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' }); t.after(() => ctx.close());
  const page = await projectPage(ctx); await open(page); await loaded(page);
  await page.getByRole('button', { name: '照片信息', exact: true }).tap();
  await expect(page.locator('.mobile-inspector')).toBeVisible();
  await expect(page.locator('.mobile-inspector')).toContainText('Fixture artist');
  assert.equal(await page.locator('.mobile-inspector').evaluate(el => el.scrollTop), 0);
  await page.getByRole('button', { name: '收起照片信息' }).tap(); await expect(page.locator('.mobile-inspector')).toHaveCount(0);
  await page.locator('.fallback-stage').dblclick({ position: { x: 150, y: 250 } });
  await expect(page.locator('.viewer-fallback')).toHaveAttribute('style', /scale\(2\)/);
  await page.keyboard.press('ArrowRight'); await expect(page.locator('.viewer-counter')).toHaveText('1 / 3');
  await page.locator('.fallback-stage').dblclick({ position: { x: 150, y: 250 } });
  await page.keyboard.press('ArrowRight'); await loaded(page); await expect(page.locator('.viewer-counter')).toHaveText('2 / 3');
  await page.getByRole('button', { name: '关闭照片' }).tap(); await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('native touch gestures switch photos, reveal the inspector, dismiss, and ignore homepage scrolls', async t => {
  const ctx = await context({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'no-preference' }); t.after(() => ctx.close());
  const page = await ctx.newPage(); await page.goto(server.url);
  const touch = await ctx.newCDPSession(page);
  const frame = () => page.evaluate('new Promise(resolve => requestAnimationFrame(resolve))');
  const swipe = async (from: [number, number], to: [number, number]) => {
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from[0], y: from[1] }] });
    for (let step = 1; step <= 10; step++) {
      await new Promise(resolve => setTimeout(resolve, 25));
      await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{
        x: from[0] + (to[0] - from[0]) * step / 10,
        y: from[1] + (to[1] - from[1]) * step / 10,
      }] });
      await frame();
    }
    // End a stationary drag, not a burst of CDP events with artificial velocity.
    // Chromium's touch gesture recognizer otherwise treats the next tap as a
    // fling cancellation. Keep the finger still before releasing it.
    await new Promise(resolve => setTimeout(resolve, 150));
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await frame();
  };
  await swipe([200, 520], [200, 240]);
  await expect(page).toHaveURL(`${server.url}/`); await expect(page.locator('[data-revealed]')).toHaveCount(0);
  await page.goto(`${server.url}/projects/fixture-beta/`); await page.locator('.gallery-live [data-gallery-index]').first().waitFor();
  await open(page); await loaded(page); await page.locator('[data-viewer-transition-variant]').waitFor({ state: 'detached' });
  await swipe([300, 340], [80, 340]); await loaded(page); await expect(page.locator('.viewer-counter')).toHaveText('2 / 3');
  await swipe([190, 470], [190, 210]); await expect(page.locator('.mobile-inspector')).toBeVisible();
  // Visibility begins at 2% progress; wait for the reveal spring to settle
  // before a second interaction. The rendered transform is the public result.
  await expect.poll(() => page.locator('.viewer-drag-content').evaluate(el => {
    const transform = new DOMMatrixReadOnly(getComputedStyle(el).transform);
    return Math.abs(transform.m22 - 0.978) < 0.0001 && Math.abs(transform.m42 + 18) < 0.01;
  })).toBe(true);
  await page.evaluate(`
    window.testInspectorCloseClicks = 0;
    window.testTouchEvents = [];
    document.querySelector('.mobile-inspector button').addEventListener('click', () => window.testInspectorCloseClicks++);
    for (const type of ['touchstart', 'touchend', 'pointerdown', 'pointerup', 'click']) {
      document.addEventListener(type, event => window.testTouchEvents.push({ type, target: event.target.closest('button')?.getAttribute('aria-label') || event.target.tagName }), { capture: true });
    }
    const prevent = Event.prototype.preventDefault;
    Event.prototype.preventDefault = function () {
      if (/^(touch|pointer)/.test(this.type)) window.testTouchEvents.push({ type: 'preventDefault:' + this.type, stack: new Error().stack });
      return prevent.call(this);
    };
  `);
  const closeButton = page.getByRole('button', { name: '收起照片信息' });
  const box = await closeButton.boundingBox(); assert(box);
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label'), point), '收起照片信息');
  // Let Chromium schedule a complete native touch tap through its gesture
  // recognizer, including touchdown/up timing and the compatibility click.
  await closeButton.tap();
  try {
    await expect.poll(() => page.evaluate('window.testInspectorCloseClicks'), { message: 'Native tap must deliver the inspector close click' }).toBe(1);
    assert(await page.evaluate("window.testTouchEvents.some(event => event.type === 'touchstart') && window.testTouchEvents.some(event => event.type === 'touchend')"), 'The tap must exercise native touch events');
  } finally {
    console.log('Native touch close events:', await page.evaluate('window.testTouchEvents'));
  }
  await expect(page.locator('.mobile-inspector')).toHaveCount(0);
  await swipe([190, 250], [190, 540]); await expect(page.getByRole('dialog')).toHaveCount(0);
  assert.equal(await page.evaluate(() => document.body.style.overflow), '');
});

test('native hexadecimal ThumbHash produces the correct preview colours before the JPEG loads', async t => {
  const ctx = await context(); t.after(() => ctx.close()); const page = await ctx.newPage();
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; }); t.after(() => release());
  await page.route(`**/thumbnails/${fixture.photos[0]!.photoId}.jpg`, async route => { await pending; await route.continue().catch(() => {}); });
  await page.goto(`${server.url}/projects/fixture-beta/`, { waitUntil: 'domcontentloaded' });
  const thumbnail = page.locator('.gallery-live [data-gallery-index="0"] .gallery-thumbnail');
  await thumbnail.waitFor();
  const colour = await thumbnail.evaluate(async element => {
    const src = (element as HTMLElement).style.backgroundImage.slice(5, -2);
    const image = new Image(); image.src = src; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1;
    const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0, 1, 1);
    return Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3);
  });
  // The native builder fixture is a solid #9d7155 portrait, so its preview should stay brown.
  for (const [i, channel] of [157, 113, 85].entries()) assert(Math.abs(colour[i]! - channel) < 20, `Incorrect placeholder colour: ${colour}`);
  release(); await expect(thumbnail.locator('img')).toHaveCSS('opacity', '1');
});

test('metadata stays lazy, preserves units/offsets and zero values, retries, and clears stale details on navigation', async t => {
  const ctx = await context({ timezoneId: 'America/Los_Angeles', reducedMotion: 'reduce' }); t.after(() => ctx.close());
  const page = await ctx.newPage();
  let requests = 0;
  page.on('request', r => { if (/\/photos\/.*\.json/.test(r.url())) requests++; });
  await page.goto(`${server.url}/projects/fixture-alpha/`);
  await page.locator('[data-viewer-ready]').waitFor(); assert.equal(requests, 0);
  const detailsURL = `**/photos/${fixture.photos[0]!.photoId}.json`;
  await page.route(detailsURL, route => route.abort());
  await open(page); await loaded(page);
  await expect(page.locator('.metadata-content')).toContainText('详细信息暂时不可用');
  await page.unroute(detailsURL);
  await page.locator('.metadata-content').getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.locator('.metadata-content')).toContainText('Fixture artist');
  for (const value of ['2024-03-02 12:00:00+08:00', 'UTC+08:00', '35 mm', '1/125 s', '0 EV', '0 m', '22.3 °', '114.17 °']) await expect(page.locator('.metadata-content')).toContainText(value);
  let release!: () => void; const pending = new Promise<void>(resolve => { release = resolve; }); t.after(() => release());
  const nearId = fixture.manifest.data.find(photo => photo.s3Key === 'map-near.jpg')!.id;
  let intercepted = 0;
  await page.route(url => url.pathname === `/projects/fixture-alpha/photos/${nearId}.json`, async route => {
    intercepted++;
    await pending;
    await route.continue().catch(() => {});
  });
  await page.keyboard.press('ArrowRight'); await loaded(page);
  await expect.poll(() => intercepted, { message: 'The next photo metadata response must be held by the test' }).toBe(1);
  await expect(page.locator('.metadata-content')).not.toContainText('Fixture artist');
  await expect(page.locator('.metadata-content')).toContainText('正在加载详细信息');
  await page.keyboard.press('ArrowRight'); await loaded(page); release();
  await expect(page.locator('.metadata-content')).toContainText('此照片没有 EXIF 信息');
  await expect(page.locator('.metadata-content')).toContainText('未记录');
  await expect(page.locator('.exposure-grid')).toHaveCount(0);
  await expect(page.locator('.metadata-content')).not.toContainText('2026-');
});

test('filtered/sorted share URL restores the same sequence; Forward then Close does not add duplicate history', async t => {
  const ctx = await context({ reducedMotion: 'reduce' }); t.after(() => ctx.close());
  const page = await projectPage(ctx);
  await page.getByRole('button', { name: '搜索和筛选' }).click();
  await page.getByLabel('开始日期').fill('2024-03-01');
  await page.getByRole('button', { name: '查看 2 张照片' }).click();
  await page.getByRole('button', { name: '显示设置' }).click();
  await page.getByLabel('照片排序').selectOption('asc');
  await page.getByRole('button', { name: '关闭面板' }).click();
  await open(page); await loaded(page);
  await expect(page.locator('.viewer-counter')).toHaveText('1 / 2');
  await page.keyboard.press('ArrowRight'); await loaded(page);
  const shared = page.url();
  // Exercise the unavailable-clipboard path explicitly, independently of the
  // browser channel's clipboard permissions and host operating system.
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }));
  await page.getByRole('button', { name: '分享照片' }).click();
  await expect(page.locator('.viewer-message')).toHaveText(shared);
  await page.goBack(); await expect(page.locator('.photo-dialog')).toHaveCount(0);
  await page.goForward(); await loaded(page);
  await page.getByRole('button', { name: '关闭照片' }).click();
  await expect(page.locator('.photo-dialog')).toHaveCount(0);
  await page.goForward(); await loaded(page);
  const direct = await ctx.newPage(); await direct.goto(shared); await loaded(direct);
  assert.deepEqual(await direct.locator('[data-filmstrip-id]').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-filmstrip-id'))), [fixture.photos[1]!.photoId, fixture.photos[0]!.photoId]);
  await expect(direct.locator('.viewer-counter')).toHaveText('2 / 2');
  await direct.reload(); await loaded(direct);
  await direct.getByRole('button', { name: '关闭照片' }).click();
  await expect(direct.locator('.gallery-live [data-gallery-index]')).toHaveCount(2);
  await direct.goto(`${server.url}/projects/fixture-beta/?tag=风景&sort=asc&photo=${fixture.photos[0]!.photoId}`); await loaded(direct);
  await expect(direct.locator('.viewer-counter')).toHaveText('3 / 3');
  assert(!new URL(direct.url()).searchParams.has('tag'));
});

// Inspect visible circle pixels in the real WebGL canvas, without exposing application test hooks.
async function mapCircles(page: Page, shade: number) {
  const { default: sharp } = await import('sharp');
  const { data, info } = await sharp(await page.locator('.photo-map canvas').screenshot()).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const visited = new Set<number>(), circles: { x: number; y: number; area: number }[] = [];
  const matches = (i: number) => i >= 0 && i < info.width * info.height && data[i * 3] === shade && data[i * 3 + 1] === shade && data[i * 3 + 2] === shade;
  for (let i = 0; i < info.width * info.height; i++) {
    if (visited.has(i) || !matches(i)) continue;
    const queue = [i]; visited.add(i); let x = 0, y = 0;
    for (let j = 0; j < queue.length; j++) {
      const pixel = queue[j]!; x += pixel % info.width; y += Math.floor(pixel / info.width);
      for (const next of [pixel - 1, pixel + 1, pixel - info.width, pixel + info.width]) if (!visited.has(next) && matches(next)) { visited.add(next); queue.push(next); }
    }
    if (queue.length > 70 && (shade !== 255 || queue.length < 220)) circles.push({ x: x / queue.length, y: y / queue.length, area: queue.length });
  }
  return circles;
}

test('real MapLibre renders fixture points, expands a cluster, opens a point, and restores the filtered map', async t => {
  const ctx = await context({ reducedMotion: 'reduce' }, 'native'); t.after(() => ctx.close());
  const page = await projectPage(ctx, 'fixture-alpha');
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  // Deterministic local style. Empty glyph fixture avoids dependence on external font services;
  // production CARTO tiles and count labels are checked separately with real photos.
  await page.route('**/dark-matter-gl-style/style.json', route => route.fulfill({ json: {
    version: 8, glyphs: `${server.url}/fixture-font/{fontstack}/{range}.pbf`, sources: {},
    layers: [{ id: 'fixture-background', type: 'background', paint: { 'background-color': '#102030' } }],
  } }));
  await page.route('**/fixture-font/**', route => route.fulfill({ contentType: 'application/x-protobuf', body: Buffer.alloc(0) }));
  await page.getByRole('button', { name: '地图探索' }).click();
  await expect(page.locator('.photo-map')).toHaveAttribute('data-map-state', 'ready');
  await expect(page.locator('.map-photo-list button')).toHaveCount(3);
  const clusters = await mapCircles(page, 221); assert.equal(clusters.length, 1);
  assert.equal((await mapCircles(page, 255)).length, 1);
  await page.locator('.photo-map canvas').click({ position: { x: clusters[0]!.x, y: clusters[0]!.y } });
  await expect.poll(async () => (await mapCircles(page, 221)).length).toBe(0);
  await expect.poll(async () => (await mapCircles(page, 255)).length).toBe(2);
  const points = await mapCircles(page, 255);
  await page.locator('.photo-map canvas').click({ position: { x: points[0]!.x, y: points[0]!.y } });
  await loaded(page);
  await expect(page.locator('.viewer-counter')).toContainText('/ 4');
  await page.goBack(); await expect(page.getByRole('dialog', { name: '地图探索', exact: true })).toBeVisible();
  await expect(page.locator('.photo-map')).toHaveAttribute('data-map-state', 'ready');
  assert.equal((await mapCircles(page, 221)).length, 0, 'expanded view survives returning from Viewer');
  await page.goForward(); await loaded(page);
  await page.getByRole('button', { name: '关闭照片' }).click();
  await expect(page.getByRole('dialog', { name: '地图探索', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭面板' }).click();
  await page.getByRole('button', { name: '搜索和筛选' }).click();
  await page.getByLabel('相机', { exact: true }).selectOption('NIKON Z6');
  await page.getByRole('button', { name: '查看 1 张照片' }).click();
  await page.getByRole('button', { name: '地图探索' }).click();
  await expect(page.locator('.photo-map')).toHaveAttribute('data-map-state', 'ready');
  assert.equal((await mapCircles(page, 221)).length, 0);
  const filtered = await mapCircles(page, 255); assert.equal(filtered.length, 1);
  await page.locator('.photo-map canvas').click({ position: { x: filtered[0]!.x, y: filtered[0]!.y } }); await loaded(page);
  await expect(page.locator('.viewer-counter')).toHaveText('1 / 1');
  assert.deepEqual(errors, []);
});

test('map network failure with WebGL available and lazy module failure retain selectable photos', async t => {
  const ctx = await context({ reducedMotion: 'reduce' }, 'native'); t.after(() => ctx.close());
  const page = await projectPage(ctx);
  await page.route('**/dark-matter-gl-style/style.json', route => route.abort());
  await page.getByRole('button', { name: '地图探索' }).click();
  await expect(page.locator('.photo-map')).toHaveAttribute('data-map-state', 'error');
  await page.locator('.map-photo-list button').click(); await loaded(page);
  await page.getByRole('button', { name: '关闭照片' }).click();
  await expect(page.locator('.map-photo-list button')).toHaveCount(1);
  await page.getByRole('button', { name: '关闭面板' }).click();
  const fresh = await projectPage(ctx);
  await fresh.route(/\/_astro\/PhotoMap\.[^/]+\.js/, route => route.abort());
  await fresh.getByRole('button', { name: '地图探索' }).click();
  await expect(fresh.getByRole('alert')).toContainText('地图组件加载失败');
  await fresh.locator('.map-photo-list button').click(); await loaded(fresh);
  await expect(fresh.locator('.viewer-counter')).toHaveText('1 / 3');
});

test('WebGL context loss after a loaded HDR source reaches the normal image fallback', async t => {
  const ctx = await context({}, 'webgpu-failure'); t.after(() => ctx.close());
  const page = await projectPage(ctx); await open(page, 1); await loaded(page);
  await assertGPUFailureInjected(page);
  await expect(page.locator('.viewer-media')).toHaveAttribute('data-renderer', 'webgl');
  await page.locator('.viewer-media canvas').evaluate(canvas => {
    (canvas as HTMLCanvasElement).getContext('webgl')!.getExtension('WEBGL_lose_context')!.loseContext();
  });
  await expect(page.locator('.viewer-media')).toHaveAttribute('data-renderer', 'image'); await loaded(page);
  await expect(page.locator('.hdr-status')).toHaveText('HDR source');
  await expectFallbackSource(page, '/originals/hdr.jpg');
  await page.keyboard.press('ArrowRight'); await loaded(page);
  await expect(page.locator('.hdr-status')).toHaveCount(0);
});

test('HDR active requires successful reconstruction; capability changes, malformed gain and next photo clear it', async t => {
  const gpuBrowser = await chromium.launch(softwareGPUOptions());
  t.after(() => gpuBrowser.close());
  const ctx = await gpuBrowser.newContext();
  // This only simulates the media capability. The worker, WebGPU device and shader are real.
  await ctx.addInitScript({ content: `
    const original = window.matchMedia.bind(window), media = new EventTarget();
    let high = true;
    Object.defineProperty(media, 'matches', { get: () => high });
    window.matchMedia = query => query === '(dynamic-range: high)' ? media : original(query);
    window.setTestHDR = value => { high = value; media.dispatchEvent(new Event('change')); };
  ` });
  const page = await projectPage(ctx); await open(page, 1); await loaded(page);
  await expect(page.locator('.viewer-media')).toHaveAttribute('data-renderer', 'webgpu');
  await expect(page.locator('.hdr-status')).toHaveText('HDR active');
  await page.evaluate(() => (window as unknown as { setTestHDR: (v: boolean) => void }).setTestHDR(false));
  await expect(page.locator('.hdr-status')).toHaveText('HDR source');
  await page.evaluate(() => (window as unknown as { setTestHDR: (v: boolean) => void }).setTestHDR(true));
  await expect(page.locator('.hdr-status')).toHaveText('HDR active');
  await page.keyboard.press('ArrowRight'); await loaded(page);
  await expect(page.locator('.hdr-status')).toHaveCount(0);
  // Manifest still marks a source; the worker must independently validate the fetched bytes.
  const brokenGain = (await colorFixtures())['broken-gain.jpg'];
  await page.route('**/originals/hdr.jpg', route => route.fulfill({ contentType: 'image/jpeg', body: brokenGain }));
  // A fresh page clears the immutable-original Blob cache before substituting bytes.
  await page.reload(); await loaded(page);
  await page.keyboard.press('ArrowLeft'); await loaded(page);
  await expect(page.locator('.viewer-media')).toHaveAttribute('data-renderer', 'webgpu');
  await expect(page.locator('.hdr-status')).toHaveText('HDR source');
});

test('device appearance applies to home, static gallery, panels and viewer and updates live', async t => {
  const ctx = await context({ colorScheme: 'light' }); t.after(() => ctx.close());
  const page = await ctx.newPage();
  await page.goto(server.url);
  assert.equal(await page.locator('html').evaluate(el => getComputedStyle(el).colorScheme), 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  assert.equal(await page.locator('html').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(22, 22, 22)');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(`${server.url}/projects/fixture-beta/`);
  await page.locator('[data-viewer-ready="true"]').waitFor({ state: 'attached' });
  assert.equal(await page.locator('body').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(255, 255, 255)');
  await open(page); await loaded(page);
  assert.equal(await page.locator('.photo-dialog').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(245, 245, 245)');
  assert.equal(await page.locator('.viewer-inspector .photo-caption').evaluate(el => getComputedStyle(el).color), 'rgb(102, 102, 102)');
  assert.equal(await page.locator('.viewer-inspector').evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(255, 255, 255, 0.69)');
  await page.screenshot({ path: '.cache/website-viewer-light.png' });
  await page.emulateMedia({ colorScheme: 'dark' });
  assert.equal(await page.locator('.photo-dialog').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(24, 24, 24)');
  assert.equal(await page.locator('body').evaluate(el => getComputedStyle(el).colorScheme), 'dark');
  const staticCtx = await browser.newContext({ javaScriptEnabled: false, colorScheme: 'light' });
  t.after(() => staticCtx.close());
  const staticPage = await staticCtx.newPage();
  await staticPage.goto(`${server.url}/projects/fixture-beta/`);
  assert.equal(await staticPage.locator('body').evaluate(el => getComputedStyle(el).colorScheme), 'light');
});
