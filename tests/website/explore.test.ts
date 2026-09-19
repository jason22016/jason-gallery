import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { before, after, test } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright';
import { expect as baseExpect } from 'playwright/test';
import { buildFixture, repo } from './fixture';
import { serve } from './server';
import { browserReadyTimeout, softwareGPUOptions } from '../browser';
import { loadPublicPhotoCollection } from '../../src/website/public-photos';

const expect = baseExpect.configure({ timeout: browserReadyTimeout(5_000) });
const root = path.join(repo, '.cache/explore-fixture');
const dist = path.join(root, 'dist');
let fixture: Awaited<ReturnType<typeof buildFixture>>;
let browser: Browser;
let server: Awaited<ReturnType<typeof serve>>;
let photos: ReturnType<ReturnType<typeof loadPublicPhotoCollection>['listPhotos']>;
const photoId = (key: string) => fixture.manifest.data.find(photo => photo.s3Key === key)!.id;
const cards = (page: Page) => page.locator('.gallery-live [data-gallery-index]');
const ids = (page: Page) => cards(page).evaluateAll(nodes => nodes.map(node => node.getAttribute('data-photo-id')));

before(async () => {
  fixture = await buildFixture({ root });
  photos = loadPublicPhotoCollection({ directory: path.join(root, 'src/content/projects'), manifestFile: path.join(root, 'src/data/photos-manifest.json') }).listPhotos();
  server = await serve(dist);
  browser = await chromium.launch(softwareGPUOptions('webgl'));
}, { timeout: 120_000 });
after(async () => { await browser?.close(); await server?.close(); });

async function pageFor(options: Parameters<Browser['newContext']>[0] = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...options });
  ctx.setDefaultTimeout(browserReadyTimeout(10_000));
  await ctx.addInitScript({ content: `
    Object.defineProperty(navigator, 'gpu', { configurable: true, value: undefined });
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(kind, ...args) {
      return ['webgl', 'webgl2', 'experimental-webgl', 'webgpu'].includes(kind) ? null : Reflect.apply(original, this, [kind, ...args]);
    };
  ` });
  return { ctx, page: await ctx.newPage() };
}
async function ready(page: Page, query = '') {
  await page.goto(`${server.url}/explore/${query}`);
  await expect(page.locator('[data-photo-gallery]')).toHaveAttribute('data-enhanced', 'true');
}
async function loaded(page: Page) {
  await expect(page.locator('.viewer-media')).toHaveAttribute('data-media-state', 'loaded', { timeout: browserReadyTimeout(15_000) });
}

test('Explore builds from the public collection exactly once per photo, with bounded public props and no private assets', async t => {
  const { ctx, page } = await pageFor(); t.after(() => ctx.close());
  const originals: string[] = [], details: string[] = [], heavy: string[] = [];
  page.on('request', request => {
    const url = request.url();
    if (url.includes('/originals/')) originals.push(url);
    if (/\/photos\/.*\.json/.test(url)) details.push(url);
    if (/\/(browser\.|webgpu-texture\.worker-|PhotoMap-)/.test(url)) heavy.push(url);
  });
  await ready(page);
  await expect.poll(() => ids(page)).toEqual(photos.map(photo => photo.id));
  assert.equal(photos.length, 5);
  assert.equal(photos.find(photo => photo.id === photoId('portrait.jpg'))!.projects.length, 3);
  await expect(cards(page)).toHaveCount(5);
  await expect(page.locator('.gallery-live .gallery-count')).toHaveText('5');
  await expect(page.locator('.masonry-photo').first().locator('img')).toHaveCSS('opacity', '1');
  assert.deepEqual(originals, []); assert.deepEqual(details, []); assert.deepEqual(heavy, []);
  await expect(page.locator('astro-island[client]')).toHaveCount(1);
  const props = await page.locator('astro-island[client]').getAttribute('props');
  for (const field of ['exif', 'toneAnalysis', 's3Key', 'digest', 'regions', 'lastModified', 'thumbnailUrl']) assert(!props!.includes(`"${field}"`), field);
  const files = await fs.readdir(dist, { recursive: true });
  for (const file of files.filter(file => /\.(html|js|json)$/.test(file))) {
    const text = await fs.readFile(path.join(dist, file), 'utf8');
    for (const value of ['secret-draft', 'DRAFT WEBSITE SECRET', photoId('private.jpg'), photoId('unused.jpg'), 'unused.jpg', 'PRIVATE PROJECT CAPTION']) assert(!text.includes(value), `${file}: ${value}`);
  }
  for (const key of ['private.jpg', 'unused.jpg']) {
    const photo = fixture.manifest.data.find(photo => photo.s3Key === key)!;
    for (const url of [photo.originalUrl, photo.thumbnailUrl, `/projects/fixture-beta/photos/${photo.id}.json`]) assert.equal((await fetch(server.url + url)).status, 404);
  }
  await page.screenshot({ path: path.join(root, 'explore-desktop.png') });
});

test('Projects remains the home entry; shared navigation reaches Explore and Map has no fake route', async t => {
  for (const javaScriptEnabled of [false, true]) {
    const { ctx, page } = await pageFor({ javaScriptEnabled }); t.after(() => ctx.close());
    await page.goto(server.url);
    await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toHaveCount(1);
    await page.getByRole('navigation', { name: '网站导航' }).getByRole('link', { name: 'Explore', exact: true }).click();
    await expect(page).toHaveURL(/\/explore\/$/);
    if (javaScriptEnabled) await expect(page.locator('[data-photo-gallery]')).toHaveAttribute('data-enhanced', 'true');
    const header = page.locator(javaScriptEnabled ? '.gallery-live .gallery-header' : '[data-static-gallery] .gallery-header');
    await header.locator('summary[aria-label="网站导航"]').click();
    const nav = header.getByRole('navigation', { name: '网站导航' });
    await expect(nav.getByRole('link', { name: 'Explore' })).toHaveAttribute('aria-current', 'page');
    await expect(nav.locator('[aria-disabled="true"]')).toHaveText('Map');
    await expect(nav.getByRole('link', { name: 'Map', exact: true })).toHaveCount(0);
    if (!javaScriptEnabled) assert.deepEqual(await page.locator('[data-static-gallery] [data-photo-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-photo-id'))), photos.map(photo => photo.id));
    await nav.getByRole('link', { name: 'Projects' }).click();
    await expect(page.locator('[data-project-slug]')).toHaveCount(3);
  }
  assert.equal((await fetch(server.url + '/map/')).status, 404);
});

test('shared SearchPanel composes Project, Search, Date, Camera, Lens and Tag, and clear preserves sort/view', async t => {
  const { ctx, page } = await pageFor(); t.after(() => ctx.close()); await ready(page, '?sort=asc&view=list#photos');
  await page.getByRole('button', { name: '搜索和筛选', exact: true }).click();
  const panel = page.getByRole('dialog', { name: '搜索和筛选' });
  await expect(panel.getByRole('button', { name: /^项目：/ })).toHaveCount(3);
  await expect(panel.getByRole('button', { name: '项目：Fixture — ordered gallery', exact: true }).locator('.command-count')).toHaveText('3');
  await expect(panel.getByRole('button', { name: '项目：Fixture — shared photographs', exact: true }).locator('.command-count')).toHaveText('4');
  await panel.getByRole('button', { name: '项目：Fixture — shared photographs', exact: true }).click();
  await expect(page.locator('.gallery-live .gallery-count')).toHaveText('4');
  await panel.getByRole('searchbox').fill('街角 Portrait');
  await panel.getByRole('button', { name: '相机：NIKON Z6', exact: true }).click();
  await panel.getByRole('button', { name: '镜头：35mm', exact: true }).click();
  await panel.getByRole('button', { name: '标签：城市', exact: true }).click();
  await panel.locator('.date-filter summary').click();
  await panel.getByLabel('开始日期', { exact: true }).fill('2024-03-02');
  await panel.getByLabel('结束日期', { exact: true }).fill('2024-03-02');
  await panel.getByRole('button', { name: '查看 1 张照片', exact: true }).click();
  assert.deepEqual(await ids(page), [photoId('portrait.jpg')]);
  const query = new URL(page.url()).searchParams;
  assert.deepEqual(Object.fromEntries(query), { sort: 'asc', view: 'list', project: 'fixture-alpha', query: '街角 Portrait', camera: 'NIKON Z6', lens: '35mm', tag: '城市', start: '2024-03-02', end: '2024-03-02' });
  await expect(page.getByRole('button', { name: '移除项目：Fixture — shared photographs', exact: true })).toBeVisible();
  await page.reload(); await expect(cards(page)).toHaveCount(1);
  await page.locator('.filter-summary').getByRole('button', { name: '清除筛选', exact: true }).click();
  await expect(page.locator('.gallery-live .gallery-count')).toHaveText('5');
  assert.equal(new URL(page.url()).search, '?sort=asc&view=list'); assert.equal(new URL(page.url()).hash, '#photos');
  await page.getByRole('button', { name: '搜索和筛选', exact: true }).click();
  await panel.getByRole('button', { name: '项目：Fixture — single image', exact: true }).click();
  await panel.getByRole('button', { name: '重置', exact: true }).click();
  await expect(panel.locator('.filter-chip')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: '查看 5 张照片', exact: true })).toBeVisible();
});

test('direct filter and sort URLs restore each facet, combinations and empty results without leaking hidden photos', async t => {
  const { ctx, page } = await pageFor(); t.after(() => ctx.close());
  const cases: [Record<string, string>, string[]][] = [
    [{ project: 'fixture-zeta' }, ['portrait.jpg']],
    [{ query: 'Landscape' }, ['ordinary.jpg']],
    [{ start: '2024-03-01', end: '2024-03-01', sort: 'asc' }, ['map-near.jpg', 'hdr.jpg']],
    [{ camera: 'NIKON Z6' }, ['portrait.jpg']],
    [{ lens: '35mm' }, ['portrait.jpg']],
    [{ tag: '风景' }, ['ordinary.jpg']],
    [{ project: 'fixture-beta', sort: 'asc' }, ['ordinary.jpg', 'hdr.jpg', 'portrait.jpg']],
    [{ project: 'fixture-beta', sort: 'desc' }, ['portrait.jpg', 'hdr.jpg', 'ordinary.jpg']],
    [{ project: 'fixture-zeta', tag: '风景' }, []],
    [{ project: 'secret-draft' }, []],
    [{ query: 'does-not-exist' }, []],
  ];
  for (const [query, keys] of cases) {
    await ready(page, '?' + new URLSearchParams(query));
    await expect.poll(() => ids(page)).toEqual(keys.map(photoId));
    if (!keys.length) await expect(page.getByRole('heading', { name: '没有符合条件的照片' })).toBeVisible();
  }
  await page.locator('.gallery-empty').getByRole('button', { name: '清除筛选', exact: true }).click();
  await expect(page.locator('.gallery-live .gallery-count')).toHaveText('5');
  await page.getByRole('button', { name: '显示设置', exact: true }).click();
  await page.getByRole('radio', { name: '拍摄时间：从新到旧' }).click();
  await page.getByRole('button', { name: '关闭面板', exact: true }).click();
  assert.equal(new URL(page.url()).searchParams.get('sort'), 'desc');
  await expect(cards(page).first()).toHaveAttribute('data-photo-id', photoId('portrait.jpg'));
  await expect(cards(page).last()).toHaveAttribute('data-photo-id', photoId('map-far.jpg'));
});

test('Explore Viewer uses the filtered/sorted sequence, restores history/focus, shares and refreshes, and loads metadata on demand', async t => {
  const { ctx, page } = await pageFor({ reducedMotion: 'reduce' }); t.after(() => ctx.close());
  const query = '?project=fixture-beta&start=2024-03-01&sort=asc&columns=3#photos';
  const detailRequests: string[] = [];
  page.on('request', request => { if (/\/photos\/.*\.json/.test(request.url())) detailRequests.push(request.url()); });
  await ready(page, query);
  const opener = cards(page).first();
  await opener.click(); await loaded(page);
  await expect(page.locator('.viewer-counter')).toHaveText('1 / 2');
  assert.equal(new URL(page.url()).searchParams.get('photo'), photoId('hdr.jpg'));
  await page.keyboard.press('ArrowRight'); await loaded(page);
  await expect(page.locator('.viewer-counter')).toHaveText('2 / 2');
  await expect(page.getByRole('button', { name: '下一张照片' })).toBeDisabled();
  assert.deepEqual(await page.locator('[data-filmstrip-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-filmstrip-id'))), [photoId('hdr.jpg'), photoId('portrait.jpg')]);
  assert.deepEqual(detailRequests, []);
  await page.getByRole('button', { name: '照片信息', exact: true }).click();
  await expect(page.locator('.viewer-inspector')).toContainText('Fixture artist');
  assert.deepEqual(detailRequests, [server.url + photos.find(photo => photo.id === photoId('portrait.jpg'))!.detailsUrl]);
  await expect(page.locator('.viewer-minimap')).toHaveCount(1);
  await expect(page.getByRole('link', { name: '在地图中查看', exact: true })).toHaveCount(0);
  const shared = page.url();
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press('Tab');
    assert(await page.evaluate(() => !!document.activeElement?.closest('.photo-dialog')));
  }
  await page.goBack(); await expect(page.locator('.photo-dialog')).toHaveCount(0);
  await expect(opener).toBeFocused();
  assert.equal(page.url(), server.url + '/explore/' + query);
  await page.goForward(); await loaded(page);
  await expect(page.locator('.viewer-counter')).toHaveText('2 / 2');
  await page.getByRole('button', { name: '关闭照片', exact: true }).click();
  await expect(page.locator('.photo-dialog')).toHaveCount(0); await expect(opener).toBeFocused();
  assert.equal(page.url(), server.url + '/explore/' + query);
  const direct = await ctx.newPage(); await direct.goto(shared); await loaded(direct);
  await direct.reload(); await loaded(direct);
  await expect(direct.locator('.viewer-counter')).toHaveText('2 / 2');
  await direct.getByRole('button', { name: '关闭照片', exact: true }).click();
  await expect(direct.locator('.photo-dialog')).toHaveCount(0);
  assert.equal(direct.url(), server.url + '/explore/' + query);
  await expect.poll(() => ids(direct)).toEqual([photoId('hdr.jpg'), photoId('portrait.jpg')]);
});

test('Back/Forward reapplies complete filter snapshots; incompatible/private photo links keep Explore filters intact', async t => {
  const { ctx, page } = await pageFor({ reducedMotion: 'reduce' }); t.after(() => ctx.close());
  const first = '?project=fixture-beta&tag=风景&sort=desc';
  await ready(page, first);
  await page.evaluate(() => { history.pushState(null, '', '?project=fixture-zeta&camera=NIKON+Z6&sort=asc'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await expect.poll(() => ids(page)).toEqual([photoId('portrait.jpg')]);
  await page.goBack(); await expect.poll(() => ids(page)).toEqual([photoId('ordinary.jpg')]);
  await page.goForward(); await expect.poll(() => ids(page)).toEqual([photoId('portrait.jpg')]);
  await page.reload(); await expect.poll(() => ids(page)).toEqual([photoId('portrait.jpg')]);
  for (const id of [photoId('portrait.jpg'), photoId('private.jpg'), photoId('unused.jpg'), 'unknown']) {
    await ready(page, `${first}&photo=${encodeURIComponent(id)}&panel=map&mapPhoto=${id}`);
    await expect(page.locator('.photo-dialog, .photo-map')).toHaveCount(0);
    await expect(page.locator('.gallery-notice')).toBeVisible();
    await expect.poll(() => ids(page)).toEqual([photoId('ordinary.jpg')]);
    const params = new URL(page.url()).searchParams;
    assert.equal(params.get('project'), 'fixture-beta'); assert.equal(params.get('tag'), '风景'); assert.equal(params.get('sort'), 'desc');
    assert(!params.has('photo')); assert(!params.has('mapPhoto'));
  }
});

test('Explore retains the existing shared-element entry and exit when motion is enabled', async t => {
  const { ctx, page } = await pageFor({ reducedMotion: 'no-preference' }); t.after(() => ctx.close());
  await ready(page, '?project=fixture-beta&tag=风景');
  const opener = cards(page).first();
  await expect(opener.locator('img')).toHaveCSS('opacity', '1');
  await page.evaluate(`
    window.exploreTransitions = [];
    new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (node instanceof Element) {
          const transition = node.matches('[data-viewer-transition-variant]') ? node : node.querySelector('[data-viewer-transition-variant]');
          if (transition) window.exploreTransitions.push(transition.getAttribute('data-viewer-transition-variant'));
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  `);
  const bounds = await opener.boundingBox();
  await opener.click(); await loaded(page);
  await expect(page.locator('.viewer-counter')).toHaveText('1 / 1');
  assert((await page.evaluate<string[]>('window.exploreTransitions')).includes('entry'));
  await page.getByRole('button', { name: '关闭照片', exact: true }).click();
  await expect(page.locator('.photo-dialog')).toHaveCount(0);
  assert((await page.evaluate<string[]>('window.exploreTransitions')).includes('exit'));
  await expect(opener).toBeFocused(); assert.deepEqual(await opener.boundingBox(), bounds);
});

test('mobile Explore uses the same responsive controls, filter panel, Viewer and reduced-motion behavior', async t => {
  const { ctx, page } = await pageFor({ viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' }); t.after(() => ctx.close());
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await ready(page);
  await expect(page.locator('.gallery-live .gallery-header-content')).toHaveCSS('height', '48px');
  const search = page.getByRole('button', { name: '搜索和筛选', exact: true });
  await search.tap();
  const panel = page.getByRole('dialog', { name: '搜索和筛选' });
  await panel.getByRole('button', { name: '项目', exact: true }).tap();
  await panel.getByRole('button', { name: '项目：Fixture — single image', exact: true }).tap();
  await expect(panel.locator('.filter-chip')).toHaveCSS('transform', 'none');
  await expect(panel).toHaveCSS('transform', 'none');
  const bounds = (await panel.boundingBox())!;
  assert(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 320 && bounds.y + bounds.height <= 569);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: path.join(root, 'explore-mobile-filters.png') });
  await panel.getByRole('button', { name: '查看 1 张照片', exact: true }).tap();
  await expect(search).toBeFocused();
  await cards(page).first().tap(); await loaded(page);
  await expect(page.locator('.photo-dialog')).toHaveAttribute('data-mobile', 'true');
  await expect(page.locator('.viewer-counter')).toHaveText('1 / 1');
  await expect(page.locator('[data-viewer-transition-variant]')).toHaveCount(0);
  await page.getByRole('button', { name: '关闭照片', exact: true }).tap();
  await expect(page.locator('.photo-dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '显示设置', exact: true }).tap();
  await page.getByRole('dialog', { name: '显示设置' }).getByRole('button', { name: '列表视图', exact: true }).tap();
  await page.getByRole('button', { name: '关闭面板', exact: true }).tap();
  await expect(page.locator('.list-view')).toHaveAttribute('data-mobile', 'true');
  await expect(page.locator('.list-card')).toHaveCSS('flex-direction', 'column');
  await page.reload(); await expect(page.locator('.list-card')).toBeVisible();
  assert.deepEqual(errors, []);
});
