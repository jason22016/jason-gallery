import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { before, after, test } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright';
import { expect as baseExpect } from 'playwright/test';
import { buildFixture, repo } from './fixture';
import { serve } from './server';
import { installMapFixture, openMapPhotoList } from './map-fixture';
import { browserReadyTimeout, softwareGPUOptions } from '../browser';
import { loadPublicPhotoCollection } from '../../src/website/public-photos';
import { validLocation } from '../../src/components/viewer/metadata';

const expect = baseExpect.configure({ timeout: browserReadyTimeout(5_000) });
const root = path.join(repo, '.cache/global-map-fixture');
let fixture: Awaited<ReturnType<typeof buildFixture>>;
let browser: Browser;
let server: Awaited<ReturnType<typeof serve>>;
const photoId = (key: string) => fixture.manifest.data.find(photo => photo.s3Key === key)!.id;

before(async () => {
  fixture = await buildFixture({ root, configure: manifest => {
    for (const photo of manifest.data) {
      if (['private.jpg', 'unused.jpg'].includes(photo.s3Key)) photo.location = { latitude: 22.32, longitude: 114.18 };
      if (photo.s3Key === 'ordinary.jpg') photo.location = { latitude: 91, longitude: 181 };
    }
  } });
  server = await serve(path.join(root, 'dist'));
  browser = await chromium.launch(softwareGPUOptions('webgl'));
}, { timeout: 120_000 });
after(async () => { await browser?.close(); await server?.close(); });

async function pageFor(options: Parameters<Browser['newContext']>[0] = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', ...options });
  ctx.setDefaultTimeout(browserReadyTimeout(10_000));
  const page = await ctx.newPage();
  await installMapFixture(page, server.url);
  return { ctx, page };
}
async function ready(page: Page, query = '') {
  await page.goto(`${server.url}/map/${query}`);
  await expect(page.locator('[data-photo-gallery]')).toHaveAttribute('data-enhanced', 'true');
  await expect(page.locator('.photo-map')).toHaveAttribute('data-map-state', 'ready', { timeout: browserReadyTimeout(15_000) });
}
async function loaded(page: Page) {
  await expect(page.locator('.viewer-media')).toHaveAttribute('data-media-state', 'loaded', { timeout: browserReadyTimeout(15_000) });
}
async function filterURL(page: Page, query: string) {
  await page.evaluate(query => { history.pushState(null, '', `/map/${query}`); window.dispatchEvent(new PopStateEvent('popstate')); }, query);
}
async function offset(page: Page, id: string) {
  return page.locator(`.photo-marker-host[data-photo-id="${id}"]`).evaluate(element => {
    const marker = element.getBoundingClientRect(), canvas = document.querySelector('.photo-map canvas')!.getBoundingClientRect();
    return { x: Math.round(marker.x + marker.width / 2 - canvas.x - canvas.width / 2), y: Math.round(marker.y + marker.height / 2 - canvas.y - canvas.height / 2) };
  });
}

test('Global Map serializes only deduplicated public photos with valid GPS; private, unused and invalid GPS links stay excluded', async t => {
  const { ctx, page } = await pageFor(); t.after(() => ctx.close());
  const requested: string[] = [];
  page.on('request', request => { if (/\/originals\/|\/photos\/.*\.json/.test(request.url())) requested.push(request.url()); });
  await ready(page);
  const collection = loadPublicPhotoCollection({ directory: path.join(root, 'src/content/projects'), manifestFile: path.join(root, 'src/data/photos-manifest.json') });
  const expected = collection.listPhotos().filter(photo => validLocation(photo.location)).map(photo => photo.id);
  assert.deepEqual(expected, ['portrait.jpg', 'map-near.jpg', 'map-far.jpg'].map(photoId));
  assert.deepEqual(await page.locator('[data-static-gallery] [data-photo-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-photo-id'))), expected);
  await expect(page.locator('.gallery-live .gallery-count')).toHaveText('3');
  await expect(page.locator('.map-photo-list button')).toHaveCount(3);
  await expect(page.locator('astro-island[client]')).toHaveCount(1);
  const html = await fs.readFile(path.join(root, 'dist/map/index.html'), 'utf8');
  for (const value of ['private.jpg', 'unused.jpg', 'ordinary.jpg', 'hdr.jpg', 'DRAFT WEBSITE SECRET', 'secret-draft']) {
    assert(!html.includes(value));
    if (value.endsWith('.jpg')) assert(!html.includes(photoId(value)));
  }
  assert.deepEqual(requested, [], 'map thumbnails do not fetch originals or detailed EXIF');
  await page.screenshot({ path: path.join(root, 'map-desktop.png') });
  for (const id of [photoId('private.jpg'), photoId('unused.jpg'), photoId('ordinary.jpg'), photoId('hdr.jpg'), 'unknown']) {
    await ready(page, `?photo=${id}&mapPhoto=${id}`);
    await expect(page.locator('.photo-dialog, [data-card-kind="selected"]')).toHaveCount(0);
    await expect(page.locator('.gallery-notice')).toBeVisible();
    assert(!new URL(page.url()).searchParams.has('photo'));
    assert(!new URL(page.url()).searchParams.has('mapPhoto'));
  }
});

test('Global Map composes the shared Project, Date, Camera, Lens, Tag and Search controls and keeps sort', async t => {
  const { ctx, page } = await pageFor(); t.after(() => ctx.close());
  await ready(page, '?sort=asc');
  await page.getByRole('button', { name: '搜索和筛选', exact: true }).click();
  const panel = page.getByRole('dialog', { name: '搜索和筛选' });
  for (const label of ['项目：Fixture — shared photographs', '相机：NIKON Z6', '镜头：35mm', '标签：城市']) await panel.getByRole('button', { name: label, exact: true }).click();
  await panel.getByRole('searchbox').fill('街角 Portrait');
  await panel.locator('.date-filter summary').click();
  await panel.getByLabel('开始日期').fill('2024-03-02');
  await panel.getByLabel('结束日期').fill('2024-03-02');
  await expect(page.locator('.gallery-live .gallery-count')).toHaveText('1');
  await expect(panel.locator('.filter-chip')).toHaveCount(7);
  await panel.getByRole('button', { name: '查看 1 张照片', exact: true }).click();
  await expect(page.locator('.map-photo-list button')).toHaveCount(1);
  const params = new URL(page.url()).searchParams;
  assert.deepEqual(Object.fromEntries(params), { sort: 'asc', query: '街角 Portrait', project: 'fixture-alpha', start: '2024-03-02', end: '2024-03-02', camera: 'NIKON Z6', lens: '35mm', tag: '城市' });
  await page.reload();
  await expect(page.locator('.map-photo-list button')).toHaveCount(1);
  await page.getByRole('button', { name: '清除筛选', exact: true }).click();
  await expect(page.locator('.map-photo-list button')).toHaveCount(3);
  assert.equal(new URL(page.url()).search, '?sort=asc');
  for (const query of ['?project=fixture-zeta', '?start=2024-03-01&end=2024-03-01', '?camera=NIKON+Z6', '?lens=35mm', '?tag=城市', '?query=Portrait']) {
    await filterURL(page, query);
    await expect(page.locator('.map-photo-list button')).toHaveCount(1);
    await expect(page.locator('.gallery-live .filter-chip')).toHaveCount(query.includes('&') ? 2 : 1);
  }
});

test('Explore and Map navigation preserves all shared filters/sort across refresh and Back/Forward', async t => {
  const { ctx, page } = await pageFor(); t.after(() => ctx.close());
  const query = '?project=fixture-alpha&start=2024-03-01&end=2024-03-03&camera=NIKON+Z6&lens=35mm&tag=城市&query=Portrait&sort=desc';
  await page.goto(`${server.url}/explore/${query}`);
  await expect(page.locator('[data-photo-gallery]')).toHaveAttribute('data-enhanced', 'true');
  await page.getByRole('link', { name: '地图探索', exact: true }).click();
  await expect(page.locator('.map-photo-list button')).toHaveCount(1);
  const expected = Object.fromEntries(new URLSearchParams(query));
  assert.deepEqual(Object.fromEntries(new URL(page.url()).searchParams), expected);
  await page.reload(); await expect(page.locator('.map-photo-list button')).toHaveCount(1);
  await page.locator('.gallery-live summary[aria-label="网站导航"]').click();
  await page.locator('.gallery-live .site-navigation').getByRole('link', { name: 'Explore', exact: true }).click();
  await expect(page.locator('.gallery-live [data-gallery-index]')).toHaveCount(1);
  assert.deepEqual(Object.fromEntries(new URL(page.url()).searchParams), expected);
  await page.goBack(); await expect(page.locator('.map-photo-list button')).toHaveCount(1);
  await page.goForward(); await expect(page.locator('.gallery-live [data-gallery-index]')).toHaveCount(1);
  await page.goBack();
  await filterURL(page, '?project=fixture-alpha&start=2024-03-01&end=2024-03-01');
  await expect(page.locator('.map-photo-list button')).toContainText('map near');
  await page.goBack(); await expect(page.locator('.map-photo-list button')).toContainText('街角 Portrait');
  await page.goForward(); await expect(page.locator('.map-photo-list button')).toContainText('map near');
});

test('native clusters, thumbnails, marker preview and Viewer use the unique filtered/sorted map sequence', async t => {
  const { ctx, page } = await pageFor(); t.after(() => ctx.close());
  await ready(page, '?project=fixture-alpha&sort=asc');
  const cluster = page.locator('.cluster-marker');
  await expect(cluster).toHaveAttribute('data-point-count', '2');
  await expect(cluster.locator('[data-mosaic-photo]')).toHaveCount(2);
  await cluster.hover();
  await expect(page.locator('[data-card-kind="cluster"]')).toBeVisible();
  const members = await page.locator('[data-cluster-photo]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-cluster-photo')));
  assert.deepEqual(new Set(members), new Set([photoId('portrait.jpg'), photoId('map-near.jpg')]));
  await cluster.click();
  await expect(page.locator('.cluster-marker')).toHaveCount(0);
  await expect(page.locator('.photo-marker-pin')).toHaveCount(2);
  const pin = page.locator(`.photo-marker-host[data-photo-id="${photoId('portrait.jpg')}"] .photo-marker-pin`);
  await pin.click();
  await expect(page.locator('[data-card-kind="selected"]')).toBeVisible();
  await page.getByRole('button', { name: '搜索和筛选', exact: true }).click();
  await expect(page.locator('[data-card-kind="selected"]')).toHaveCount(0);
  await page.getByRole('dialog', { name: '搜索和筛选' }).getByRole('button', { name: '查看 3 张照片', exact: true }).click();
  await expect(page.locator('[data-card-kind="selected"]')).toBeVisible();
  const mapURL = page.url(), position = await offset(page, photoId('portrait.jpg'));
  assert.equal(new URL(mapURL).searchParams.get('panel'), null);
  await page.locator('[data-card-kind="selected"] .photo-marker-card-image').click(); await loaded(page);
  await expect(page.locator('.viewer-counter')).toHaveText('2 / 3');
  assert.deepEqual(await page.locator('[data-filmstrip-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-filmstrip-id'))), ['map-near.jpg', 'portrait.jpg', 'map-far.jpg'].map(photoId));
  await page.keyboard.press('ArrowRight'); await loaded(page);
  await expect(page.locator('.viewer-counter')).toHaveText('3 / 3');
  await page.getByRole('button', { name: '关闭照片', exact: true }).click();
  await expect(page).toHaveURL(mapURL);
  await expect(pin).toBeFocused();
  assert.deepEqual(await offset(page, photoId('portrait.jpg')), position);
  await page.goForward(); await loaded(page);
  await page.reload(); await loaded(page);
  await expect(page.locator('.viewer-counter')).toHaveText('3 / 3');
  await page.getByRole('button', { name: '照片信息', exact: true }).click();
  await page.getByRole('link', { name: '在地图中查看', exact: true }).first().click();
  await expect(page.locator('.photo-map')).toHaveAttribute('data-selected-photo', photoId('map-far.jpg'));
  await expect.poll(async () => { const point = await offset(page, photoId('map-far.jpg')); return Math.max(Math.abs(point.x), Math.abs(point.y)); }).toBeLessThan(2);
  await ready(page, `?tag=城市&photo=${photoId('map-near.jpg')}&mapPhoto=${photoId('map-near.jpg')}`);
  await expect(page.locator('.photo-dialog')).toHaveCount(0);
  assert.equal(new URL(page.url()).searchParams.get('tag'), '城市');
  assert(!new URL(page.url()).searchParams.has('photo'));
});

test('initial bounds fit the results; filtering updates the same map without recentering until Fit Results', async t => {
  const { ctx, page } = await pageFor(); t.after(() => ctx.close());
  await ready(page);
  await expect(page.locator('.cluster-marker')).toHaveCount(1);
  await expect(page.locator('.photo-marker-pin')).toHaveCount(1);
  const far = photoId('map-far.jpg');
  const initial = await offset(page, far);
  assert(Math.abs(initial.x) > 30 && Math.abs(initial.y) > 30);
  const box = (await page.locator('.photo-map canvas').boundingBox())!;
  const canvas = await page.locator('.photo-map canvas').elementHandle();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 - 90, box.y + box.height / 2 + 40, { steps: 15 }); await page.mouse.up();
  await expect.poll(async () => (await offset(page, far)).x).not.toBe(initial.x);
  const moved = await offset(page, far);
  await filterURL(page, '?query=map-far');
  await expect(page.locator('.map-photo-list button')).toHaveCount(1);
  await expect(page.locator('.cluster-marker')).toHaveCount(0);
  assert(await canvas!.evaluate(element => element === document.querySelector('.photo-map canvas')));
  await expect.poll(() => offset(page, far)).toEqual(moved);
  await page.getByRole('button', { name: '适配筛选结果（Fit Results）', exact: true }).click();
  await expect.poll(async () => { const point = await offset(page, far); return Math.max(Math.abs(point.x), Math.abs(point.y)); }).toBeLessThan(2);
  await filterURL(page, '?tag=天空');
  await expect(page.getByRole('heading', { name: '没有可显示的位置' })).toBeVisible();
  await expect(page.locator('.photo-map canvas, .photo-marker-pin, .cluster-marker')).toHaveCount(0);
  await page.getByRole('link', { name: '浏览全部照片', exact: true }).click();
  await expect(page.locator('.gallery-live [data-gallery-index]')).toHaveCount(1);
  assert.equal(new URL(page.url()).searchParams.get('tag'), '天空');
  await page.goBack();
  await page.getByRole('button', { name: '清除筛选', exact: true }).click();
  await expect(page.locator('.map-photo-list button')).toHaveCount(3);
  await page.getByRole('button', { name: '适配筛选结果（Fit Results）', exact: true }).click();
  await expect(page.locator('.cluster-marker')).toHaveCount(1);
  await expect(page.locator('.photo-marker-pin')).toHaveCount(1);
});

test('network, MapLibre module and unavailable GPU fallbacks keep the filtered public Viewer usable', async t => {
  for (const failure of ['network', 'module', 'gpu']) {
    await t.test(failure, async t => {
      const { ctx, page } = await pageFor(); t.after(() => ctx.close());
      if (failure === 'network') await page.route('**/tiles.json', route => route.abort('failed'));
      if (failure === 'module') await page.route(/\/PhotoMap[.-][^/]+\.js$/, route => route.abort('failed'));
      if (failure === 'gpu') await page.addInitScript(() => {
        Object.defineProperty(navigator, 'gpu', { value: undefined });
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...args: unknown[]) {
          return ['webgl', 'webgl2', 'experimental-webgl', 'webgpu'].includes(kind) ? null : Reflect.apply(original, this, [kind, ...args]);
        } as typeof original;
      });
      await page.goto(`${server.url}/map/?tag=城市`);
      await expect(page.locator('.map-fallback')).toBeVisible();
      await expect(page.locator('.map-fallback .map-photo-list button')).toHaveCount(1);
      await page.locator('.map-fallback .map-photo-list button').click(); await loaded(page);
      await expect(page.locator('.viewer-counter')).toHaveText('1 / 1');
      await page.getByRole('button', { name: '关闭照片', exact: true }).click();
      await expect(page.locator('.map-fallback')).toBeVisible();
      assert.equal(new URL(page.url()).searchParams.get('tag'), '城市');
    });
  }
});

test('loading timeout, retry and GPU context loss reuse the PhotoMap fallback', async t => {
  const { ctx, page } = await pageFor(); t.after(() => ctx.close());
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; }); t.after(() => release());
  await page.route('**/tiles.json', async route => { await held; await route.fallback().catch(() => {}); });
  await page.clock.install();
  await page.goto(`${server.url}/map/?project=fixture-alpha`);
  await expect(page.locator('.map-loading')).toBeVisible();
  await expect(page.getByRole('button', { name: '适配筛选结果（Fit Results）', exact: true })).toBeDisabled();
  await page.clock.fastForward(16_000);
  await expect(page.locator('.photo-map')).toHaveAttribute('data-map-state', 'error');
  await expect(page.locator('.map-fallback .map-photo-list button')).toHaveCount(3);
  release(); await page.getByRole('button', { name: '重试地图', exact: true }).click(); await page.clock.resume();
  await expect(page.locator('.photo-map')).toHaveAttribute('data-map-state', 'ready');
  await page.locator('.photo-map canvas').evaluate(canvas => canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true })));
  await expect(page.locator('.photo-map')).toHaveAttribute('data-map-state', 'error');
  await page.locator('.map-fallback .map-photo-list button').first().click(); await loaded(page);
  await expect(page.locator('.viewer-counter')).toHaveText('1 / 3');
});

test('mobile Global Map shares the filter drawer, touch marker, Viewer, navigation and safe viewport', async t => {
  const { ctx, page } = await pageFor({ viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true }); t.after(() => ctx.close());
  await installMapFixture(page, server.url, '© <a href="https://example.com/">CARTO</a>, © <a href="https://example.com/">OpenStreetMap contributors</a>');
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await ready(page, '?project=fixture-zeta');
  const fit = (await page.getByRole('button', { name: '适配筛选结果（Fit Results）', exact: true }).boundingBox())!;
  const attribution = (await page.locator('.maplibregl-ctrl-attrib').boundingBox())!;
  assert(fit.y + fit.height <= attribution.y, 'Fit Results stays above the provider attribution on small screens');
  await page.getByRole('button', { name: '搜索和筛选', exact: true }).tap();
  const panel = page.getByRole('dialog', { name: '搜索和筛选' });
  await panel.getByRole('button', { name: '相机：NIKON Z6', exact: true }).tap();
  await panel.getByRole('button', { name: '查看 1 张照片', exact: true }).tap();
  await expect(page.getByRole('button', { name: '搜索和筛选', exact: true })).toBeFocused();
  await page.locator('.photo-marker-pin').tap();
  const card = page.locator('[data-card-kind="selected"]');
  await expect(card).toBeVisible();
  await expect(page.locator('[data-card-kind="hover"]')).toHaveCount(0);
  const bounds = (await card.boundingBox())!;
  assert(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 320 && bounds.y + bounds.height <= 568);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight));
  await page.screenshot({ path: path.join(root, 'map-mobile.png') });
  await card.locator('.photo-marker-card-image').tap(); await loaded(page);
  await expect(page.locator('.photo-dialog')).toHaveAttribute('data-mobile', 'true');
  await expect(page.locator('.viewer-counter')).toHaveText('1 / 1');
  await expect(page.locator('[data-viewer-transition-variant]')).toHaveCount(0);
  await page.getByRole('button', { name: '关闭照片', exact: true }).tap();
  await expect(page.locator('.photo-marker-pin')).toBeFocused();
  await page.getByRole('button', { name: /取消选择/ }).tap();
  await openMapPhotoList(page);
  await expect(page.locator('.map-photo-list button')).toBeVisible();
  await page.getByRole('link', { name: '浏览全部照片', exact: true }).tap();
  await expect(page.locator('.gallery-live [data-gallery-index]')).toHaveCount(1);
  assert.equal(new URL(page.url()).searchParams.get('camera'), 'NIKON Z6');
  assert.deepEqual(errors, []);
});
