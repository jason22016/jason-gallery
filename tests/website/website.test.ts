import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { test, before, after } from 'node:test';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { expect } from 'playwright/test';
import { buildFixture, dist, repo, root, run } from './fixture';
import { serve } from './server';

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
  browser = await chromium.launch({
    executablePath: process.env.JASON_TEST_CHROMIUM || undefined,
    timeout: 20_000,
    args: ['--enable-unsafe-swiftshader'],
  });
  console.log(`Website browser: ${browser.version()}`);
}, { timeout: 120_000 });
after(async () => {
  await browser?.close(); await server?.close();
  assert.deepEqual(await productionSnapshot(), productionBefore, 'Website tests must not modify production Projects, Manifest, or thumbnails');
});

async function context(options: Parameters<Browser['newContext']>[0] = {}, gpu: 'none' | 'webgpu-failure' | 'native' = 'none') {
  const result = await browser.newContext(options);
  result.setDefaultTimeout(10_000);
  if (gpu !== 'native') await result.addInitScript(mode => {
    Object.defineProperty(navigator, 'gpu', { configurable: true, value: mode === 'none' ? undefined : {
      requestAdapter: async () => { throw new Error('Injected WebGPU initialization failure'); },
    } });
    if (mode === 'none') {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...args: unknown[]) {
        if (['webgl', 'webgl2', 'experimental-webgl', 'webgpu'].includes(kind)) return null;
        return Reflect.apply(original, this, [kind, ...args]);
      } as typeof original;
    }
  }, gpu);
  return result;
}

async function projectPage(ctx: BrowserContext, slug = 'fixture-beta') {
  const page = await ctx.newPage();
  await page.goto(`${server.url}/projects/${slug}/`);
  await page.locator('[data-viewer-ready="true"]').waitFor({ state: 'attached' });
  return page;
}
async function open(page: Page, index = 0) {
  await page.locator('[data-gallery-index]').nth(index).click();
  await expect(page.getByRole('dialog')).toBeVisible();
}
async function loaded(page: Page) { await expect(page.locator('.viewer-media')).toHaveAttribute('data-media-state', 'loaded', { timeout: 15_000 }); }

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
    await expect(page.getByRole('heading', { name: 'Page not found.' })).toBeVisible();
    await page.getByRole('link', { name: 'Return to projects' }).click();
    await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
  }
  const files = await fs.readdir(dist, { recursive: true });
  assert(!files.some(file => file.includes('secret-draft')));
  assert(files.some(file => /webgpu-texture.worker-.*\.js$/.test(file)), 'production Astro emits the real WebGPU worker');
  for (const file of files.filter(file => /\.(html|js|json)$/.test(file))) {
    const text = await fs.readFile(path.join(dist, file), 'utf8');
    for (const value of ['DRAFT WEBSITE SECRET', 'PRIVATE PROJECT SUMMARY', 'PRIVATE PROJECT CAPTION', 'secret-draft', 'exiftool-vendored', 'node:fs', '@afilmory/builder', 'JASON_PHOTOS_READ_TOKEN', 'JASON_GALLERY_PHOTO_WORKDIR']) assert(!text.includes(value), `${file} leaked ${value}`);
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
  await expect(page.locator('.viewer-fallback')).toHaveAttribute('src', '/originals/hdr.jpg');
  await expect(page.locator('.hdr-status')).toHaveText('HDR source');
  assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden');
  await expect(page.getByRole('button', { name: 'Close photo viewer' })).toBeFocused();
  await page.keyboard.press('ArrowRight'); await loaded(page);
  await expect(page.locator('.viewer-counter')).toHaveText('3 / 3');
  await expect(page.locator('.hdr-status')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Next photograph' })).toBeDisabled();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.viewer-counter')).toHaveText('3 / 3');
  await page.keyboard.press('Home'); await loaded(page);
  await expect(page.getByRole('button', { name: 'Previous photograph' })).toBeDisabled();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.viewer-counter')).toHaveText('1 / 3');
  await page.getByRole('button', { name: 'Next photograph' }).click(); await loaded(page);
  await page.getByRole('button', { name: 'Previous photograph' }).click(); await loaded(page);
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
  await expect(page.locator('[data-gallery-index]').nth(1)).toBeFocused();
  assert.equal(await page.evaluate(() => document.body.style.overflow), '');
  await page.keyboard.press('Enter'); await loaded(page);
  await page.getByRole('button', { name: 'Close photo viewer' }).click();
  await expect(page.locator('[data-gallery-index]').nth(1)).toBeFocused();
});

test('loading is visible; switching/closing while requests are pending cannot revive an old photo', async t => {
  const ctx = await context(); t.after(() => ctx.close());
  const page = await projectPage(ctx);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  t.after(() => release());
  await page.route('**/originals/portrait.jpg', async route => { await pending; await route.continue().catch(() => {}); });
  await open(page);
  await expect(page.getByRole('status')).toHaveText('Loading photograph…');
  await page.keyboard.press('ArrowRight'); await loaded(page);
  release();
  await expect(page.locator('.viewer-fallback')).toHaveAttribute('src', '/originals/hdr.jpg');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  let releaseClosed!: () => void;
  const closedRequest = new Promise<void>(resolve => { releaseClosed = resolve; });
  t.after(() => releaseClosed());
  await page.unroute('**/originals/portrait.jpg');
  await page.route('**/originals/portrait.jpg', async route => { await closedRequest; await route.continue().catch(() => {}); });
  await open(page);
  await expect(page.getByRole('status')).toHaveText('Loading photograph…');
  await page.keyboard.press('Escape');
  releaseClosed();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await open(page, 2); await loaded(page);
  await expect(page.locator('.viewer-fallback')).toHaveAttribute('src', '/originals/ordinary.jpg');
});

test('failed GPU module download still opens the unmodified original image', async t => {
  const ctx = await context(); t.after(() => ctx.close());
  const page = await projectPage(ctx);
  await page.route(/\/_astro\/browser\.[^/]+\.js/, route => route.abort());
  await open(page); await loaded(page);
  await expect(page.locator('.viewer-media')).toHaveAttribute('data-renderer', 'image');
  await expect(page.locator('.viewer-fallback')).toHaveAttribute('src', '/originals/portrait.jpg');
});

test('thumbnail error, original error and successful retry remain usable', async t => {
  const ctx = await context(); t.after(() => ctx.close());
  const page = await ctx.newPage();
  await page.route(`**/thumbnails/${fixture.photos[0]!.photoId}.jpg`, route => route.abort());
  await page.route('**/originals/portrait.jpg', route => route.abort());
  await page.goto(`${server.url}/projects/fixture-beta/`);
  await page.locator('[data-viewer-ready="true"]').waitFor({ state: 'attached' });
  await expect(page.locator('.thumbnail-error').first()).toBeVisible();
  await open(page);
  await expect(page.getByRole('alert')).toHaveText('This photograph could not be loaded.');
  await expect(page.getByRole('link', { name: 'Original' })).toHaveAttribute('href', '/originals/portrait.jpg');
  await page.unroute('**/originals/portrait.jpg');
  await page.getByRole('button', { name: 'Try again' }).click(); await loaded(page);
  await expect(page.locator('.viewer-fallback')).toHaveAttribute('src', '/originals/portrait.jpg');
  await page.keyboard.press('ArrowRight'); await loaded(page);
  await expect(page.locator('.viewer-counter')).toHaveText('2 / 3');
  await page.getByRole('button', { name: 'Close photo viewer' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('real Afilmory WebGPU initialization failure falls back to WebGL in the Astro production bundle', async t => {
  const ctx = await context({}, 'webgpu-failure'); t.after(() => ctx.close());
  const page = await projectPage(ctx);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await open(page, 1); await loaded(page);
  await expect(page.locator('.viewer-media')).toHaveAttribute('data-renderer', 'webgl');
  await expect(page.locator('canvas[role="img"]')).toHaveAttribute('aria-label', 'Fixture HDR image');
  await expect(page.locator('.hdr-status')).toHaveText('HDR source');
  await page.keyboard.press('ArrowRight'); await loaded(page);
  await expect(page.locator('.viewer-media')).toHaveAttribute('data-renderer', 'webgl');
  await page.keyboard.press('Escape');
  assert.deepEqual(errors, []);
});

test('mobile single-column layout, touch controls, single-photo boundaries and viewport resizing', async t => {
  const ctx = await context({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }); t.after(() => ctx.close());
  const page = await projectPage(ctx, 'fixture-zeta');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.locator('[data-gallery-index]').tap(); await loaded(page);
  for (const label of ['Previous photograph', 'Next photograph']) await expect(page.getByRole('button', { name: label })).toBeDisabled();
  for (const size of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(size);
    const box = await page.getByRole('dialog').boundingBox();
    assert(box && Math.abs(box.height - size.height) < 2 && Math.abs(box.width - size.width) < 2);
    const close = await page.getByRole('button', { name: 'Close photo viewer' }).boundingBox();
    assert(close && close.height >= 44 && close.width >= 44);
    const media = await page.locator('.viewer-media').boundingBox(); assert(media && media.height > 100);
  }
  await page.getByRole('button', { name: 'Close photo viewer' }).tap();
  await page.goto(`${server.url}/projects/fixture-beta/`);
  const positions = await page.locator('.photo-grid > li').evaluateAll(nodes => nodes.map(node => ({ left: node.getBoundingClientRect().left, top: node.getBoundingClientRect().top })));
  assert.equal(positions[0]!.left, positions[1]!.left);
  assert(positions[0]!.top < positions[1]!.top);
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
    await expect(page.getByRole('heading', { name: 'No published projects yet.' })).toBeVisible();
    await expect(page.locator('[data-project-slug]')).toHaveCount(0);
    const html = await fs.readFile(path.join(emptyDist, 'index.html'), 'utf8');
    assert(!html.includes('DRAFT WEBSITE SECRET'));
    assert(!(await fs.readdir(emptyDist)).includes('projects'));
    await page.screenshot({ path: path.join(root, 'empty-home.png'), fullPage: true });
  } finally {
    for (const project of published) await fs.writeFile(path.join(directory, `${project.slug}.json`), JSON.stringify(project));
  }
});
