import { installMapFixture } from './map-fixture';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { before, after, test } from 'node:test';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { expect as baseExpect } from 'playwright/test';
import { serve } from './server';
import { repo, run } from './fixture';
import { browserReadyTimeout, softwareGPUOptions } from '../browser';
import { jpeg } from '../../scripts/photos/fixtures';
import type { GalleryPhoto } from '../../src/components/gallery/photos';
import { rgbaToThumbHash } from 'thumbhash';
import sharp from 'sharp';
import { CLIENT_SEMANTIC_RELEASE_BUNDLE_SHA256, CLIENT_SEMANTIC_RELEASE_ID } from '../../src/semantic-search/release-contract';
import { semanticCacheMarkerPath, semanticCachePrefix } from '../../src/semantic-search/cache';

const expect = baseExpect.configure({ timeout: browserReadyTimeout(5_000) });

let browser: Browser;
let server: Awaited<ReturnType<typeof serve>>;
let photos: GalleryPhoto[];
const root = path.join(repo, '.cache/gallery-fixture');
// Test artifacts must not overwrite tracked audit reports before release validation.
const screenshots = path.join(repo, '.cache/gallery-screenshots');
let motion: Buffer;
let video: Buffer;

before(async () => {
  await fs.mkdir(path.join(root, 'public'), { recursive: true });
  await fs.mkdir(screenshots, { recursive: true });
  const image = await jpeg('#9d7155', 640, 960);
  const pixels = await sharp(image).resize(64, 96).ensureAlpha().raw().toBuffer();
  const thumbHash = Buffer.from(rgbaToThumbHash(64, 96, pixels)).toString('hex');
  await fs.writeFile(path.join(root, 'public/thumb.jpg'), image);
  video = await fs.readFile(path.join(repo, 'tests/gallery/live.mp4'));
  motion = Buffer.concat([image, video]);
  await fs.writeFile(path.join(root, 'public/live.mp4'), video);
  await fs.copyFile(path.join(repo, 'tests/gallery/live.mov'), path.join(root, 'public/live.mov'));
  await fs.writeFile(path.join(root, 'public/motion.jpg'), motion);
  photos = Array.from({ length: 480 }, (_, i) => ({
    id: `photo-${i}`, publicId: String(i).padStart(16, '0'), title: `照片 ${i} — 完整标题`, alt: `Gallery photo ${i}`, filename: `${i}.jpg`, description: '这是一段照片说明。第二句说明帮助检查两行截断。',
    width: 640, height: i % 4 === 0 ? 960 : i % 4 === 1 ? 640 : i % 4 === 2 ? 400 : 120,
    aspectRatio: 640 / (i % 4 === 0 ? 960 : i % 4 === 1 ? 640 : i % 4 === 2 ? 400 : 120),
    thumbnail: `/thumb.jpg?id=${i}`, thumbHash, src: i === 2 ? '/motion.jpg' : '/thumb.jpg',
    date: `2024-03-${String(i % 28 + 1).padStart(2, '0')}T12:00:00`, tags: [i % 2 ? '奇数' : '偶数', '风景', '旅行'],
    exposure: ['50 mm', 'ƒ/2.8', '1/125 s', 'ISO 100'], capture: { focalLength: '50 mm', aperture: 'ƒ/2.8', shutter: '1/125 s', iso: 'ISO 100' },
    camera: 'NIKON Z6', lens: '35mm', format: 'jpg', size: 2097152, location: null, isHDR: i === 0,
    detailsUrl: '/details.json',
    ...(i === 1 ? { video: { type: 'live-photo' as const, videoUrl: '/live.mp4', s3Key: 'live.mp4' } } : {}),
    ...(i === 2 ? { video: { type: 'motion-photo' as const, offset: image.length, size: video.length } } : {}),
    ...(i === 3 ? { video: { type: 'live-photo' as const, videoUrl: '/live.mov', s3Key: 'live.mov' } } : {}),
  }));
  await fs.writeFile(path.join(root, 'public/photos.json'), JSON.stringify(photos));
  await fs.writeFile(path.join(root, 'build.log'), run([path.join(repo, 'node_modules/vite/bin/vite.js'), 'build', '--config', 'tests/gallery/vite.config.ts'], repo));
  server = await serve(path.join(repo, '.cache/gallery-dist'));
  browser = await chromium.launch(softwareGPUOptions('webgl'));
}, { timeout: 120_000 });
after(async () => { await browser?.close(); await server?.close(); });
async function pageFor(options: Parameters<Browser['newContext']>[0] = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...options });
  ctx.setDefaultTimeout(browserReadyTimeout(10_000));
  const page = await ctx.newPage();
  return { ctx, page };
}
async function installSemanticFake(page: Page, enableMode: 'download' | 'cache' | 'update' = 'download', persistAcrossNavigations = false) {
  const source = await fs.readFile(path.join(repo, 'tests/gallery/semantic-fake.js'), 'utf8');
  const script = `${source}\n;globalThis.installSemanticFake(${JSON.stringify(photos.map(photo => photo.publicId!))}, ${JSON.stringify(enableMode)});`;
  if (persistAcrossNavigations) await page.addInitScript(script);
  await page.evaluate(script);
}
async function ready(page: Page, query = '') {
  await page.goto(server.url + query);
  if (new URL(page.url()).searchParams.get('panel') === 'map') {
    // Cold software WebGL initialization blocks the renderer and can stall
    // thumbnail readiness checks. Wait for the active map first.
    await expect(page.locator('.photo-map')).toHaveAttribute('data-map-state', 'ready', { timeout: browserReadyTimeout(15_000) });
  }
  await expect(page.locator('.masonry-photo').first()).toBeVisible();
  await expect(page.locator('.masonry-photo').first().locator('img')).toHaveCSS('opacity', '1');
}
async function clusterFixture(page: Page) {
  const located = photos.slice(0, 12).map((photo, index) => ({ ...photo, video: undefined, src: `/original-forbidden/${index}.jpg`,
    date: index === 6 ? '2024-04-01T00:30:00+14:00' : index === 7 ? '2023-12-30T23:30:00-12:00' : photo.date,
    location: { longitude: 114.17 + (index < 8 ? index * .00001 : .08 + index * .00001), latitude: 22.3 } }));
  await page.route('**/photos.json', route => route.fulfill({ json: located }));
  await installMapFixture(page, server.url);
  return located;
}

test('native cluster mosaic and focus preview use actual leaves, bounded thumbnails, total count and whole-cluster dates', async t => {
  const { ctx, page } = await pageFor({ reducedMotion: 'reduce' }); t.after(() => ctx.close());
  const located = await clusterFixture(page);
  let originals = 0; const errors: string[] = [];
  page.on('request', request => { if (request.url().includes('/original-forbidden/')) originals++; });
  page.on('pageerror', error => errors.push(error.message));
  await ready(page, '?panel=map');
  const large = page.locator('.cluster-marker[data-point-count="8"]'), small = page.locator('.cluster-marker[data-point-count="4"]');
  await expect(large).toHaveCount(1); await expect(small).toHaveCount(1);
  await expect(large.locator('[data-mosaic-photo]')).toHaveCount(4);
  const members = new Set(located.slice(0, 8).map(photo => photo.id));
  const mosaic = await large.locator('[data-mosaic-photo]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-mosaic-photo')));
  assert(mosaic.every(id => members.has(id!)));
  const size = (await large.boundingBox())!.width;
  assert(Math.abs(size - (32 + Math.log(8) * 8)) < .1);
  await large.hover(); await page.waitForTimeout(80); await small.hover(); await page.waitForTimeout(80);
  await expect(page.locator('[data-card-kind="cluster"]')).toHaveCount(0);
  await page.mouse.move(0, 0);
  await large.focus();
  const card = page.locator('[data-card-kind="cluster"]');
  await expect(card).toBeVisible(); await expect(card.locator('[data-cluster-photo]')).toHaveCount(6);
  await expect(card.locator('h3')).toHaveText('8 张照片');
  await expect(card.locator('[data-cluster-remaining]')).toHaveText('+2更多照片');
  await expect(card.locator('[data-cluster-date]')).toHaveText('2023年12月30日 — 2024年4月1日');
  await expect(card.locator('.cluster-photo-coordinates')).toContainText('22.3000°N');
  const preview = await card.locator('[data-cluster-photo]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-cluster-photo')));
  assert(preview.every(id => members.has(id!))); assert.equal(new Set(preview).size, 6);
  await expect(card).toHaveCSS('backdrop-filter', 'blur(40px)'); await expect(card).toHaveCSS('border-radius', '16px');
  for (const image of await card.locator('img').all()) assert.match((await image.getAttribute('src'))!, /^\/thumb\.jpg\?id=\d+$/);
  await page.screenshot({ path: path.join(screenshots, 'map-phase4-cluster-preview.png') });
  await small.focus();
  await expect(card.locator('h3')).toHaveText('4 张照片'); await expect(card.locator('[data-cluster-photo]')).toHaveCount(4);
  await expect(card.locator('[data-cluster-remaining]')).toHaveCount(0);
  const otherMembers = new Set(located.slice(8).map(photo => photo.id));
  assert((await card.locator('[data-cluster-photo]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-cluster-photo')))).every(id => otherMembers.has(id!)));
  await large.focus(); await expect(card.locator('h3')).toHaveText('8 张照片');
  await page.getByRole('button', { name: '缩小地图', exact: true }).click();
  await expect(card).toHaveCount(0);
  await expect(large).toHaveCount(1); await large.click();
  await expect.poll(() => page.locator('.photo-marker-pin').count()).toBe(8);
  await expect(card).toHaveCount(0); await expect(large).toHaveCount(0);
  assert.equal(new URL(page.url()).searchParams.get('mapPhoto'), null);
  await page.locator('.photo-marker-pin').first().focus();
  await expect(page.locator('[data-card-kind="hover"]')).toBeVisible();
  await page.keyboard.press('Enter'); await expect(page.locator('[data-card-kind="selected"]')).toBeVisible();
  assert(new URL(page.url()).searchParams.has('mapPhoto'));
  await page.getByRole('button', { name: /^(关闭面板|返回项目相册)$/ }).click();
  await expect(page.locator('.cluster-marker, [data-card-kind="cluster"]')).toHaveCount(0);
  await page.evaluate(() => { history.pushState(history.state, '', '?panel=map&tag=偶数'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await expect(page.locator('.cluster-marker[data-point-count="4"]')).toHaveCount(1);
  await page.locator('.cluster-marker[data-point-count="4"]').focus();
  await expect(card.locator('[data-cluster-photo]')).toHaveCount(4);
  assert((await card.locator('[data-cluster-photo]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-cluster-photo')))).every(id => Number(id!.slice(6)) % 2 === 0));
  assert.equal(originals, 0); assert.deepEqual(errors, []);
});

test('touch cluster tap expands immediately without a preview and reduced motion disables the pulse', async t => {
  const { ctx, page } = await pageFor({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' }); t.after(() => ctx.close());
  await clusterFixture(page);
  await ready(page, '?panel=map');
  const cluster = page.locator('.cluster-marker[data-point-count="8"]');
  await expect(cluster).toHaveCount(1); await expect(cluster.locator('.cluster-marker-ring')).toHaveCSS('animation-name', 'none');
  await cluster.tap();
  await expect.poll(() => page.locator('.photo-marker-pin').count()).toBe(8);
  await expect(page.locator('[data-card-kind="cluster"]')).toHaveCount(0);
  await page.locator('.photo-marker-pin').first().focus(); await page.locator('.photo-marker-pin').first().tap();
  await expect(page.locator('[data-card-kind="selected"]')).toBeVisible();
  await page.screenshot({ path: path.join(screenshots, 'map-phase4-mobile-expanded.png') });
});
const cards = (page: Page) => page.locator('.masonry-photo');

test('Explore Cmd+K requires explicit AI enable, exposes real progress, maps ranked results into Gallery, and reuses one runtime', async t => {
  const { ctx, page } = await pageFor({ reducedMotion: 'reduce' }); t.after(() => ctx.close());
  const semanticRequests: string[] = [];
  page.on('request', request => {
    const pathname = new URL(request.url()).pathname;
    if (/^\/(?:semantic|semantic-releases|semantic-runtimes)\//.test(pathname)) semanticRequests.push(pathname);
  });
  await ready(page, '?global');
  await installSemanticFake(page);
  assert.equal(await page.evaluate(() => (globalThis as any)[Symbol.for('jason-gallery.semantic-search-engine')] === (window as any).semanticFake.engine), true);
  await page.keyboard.press('Meta+K');
  const dialog = page.getByRole('dialog', { name: '搜索和筛选' });
  await expect(dialog).toBeVisible();
  const normalSearch = dialog.getByRole('searchbox', { name: '搜索', exact: true });
  await normalSearch.fill('照片 1');
  const metadataBounds = await dialog.boundingBox();
  const metadataCount = await page.locator('.gallery-count').textContent();
  await expect(dialog.getByRole('button', { name: /Search “照片 1” with AI/ })).toBeVisible();
  await dialog.getByRole('button', { name: /Search “照片 1” with AI/ }).click();
  await expect(page.getByRole('heading', { name: 'Enable AI Search' })).toBeVisible();
  await expect(page.getByText('首次约 101 MB 下载 · 解压后约 111 MB')).toBeVisible();
  await expect(page.getByText(/查询文本、向量和排名计算均留在此设备上/)).toBeVisible();
  await expect(page.getByText(/缓存被清理后需要重新下载/)).toBeVisible();
  const aiBounds = await dialog.boundingBox();
  assert(metadataBounds && aiBounds && Math.abs(metadataBounds.height - aiBounds.height) < 1, 'AI mode keeps the Cmd+K panel height stable');
  await expect(page.locator('.ai-gallery-summary')).toHaveCount(0);
  assert.deepEqual(semanticRequests, [], 'entering AI mode must not load semantic assets');
  await page.getByRole('button', { name: 'Download & Enable' }).click();
  await expect(page.getByText('正在下载 AI 模型…')).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'AI Search 模型进度' })).toHaveAttribute('value', '25000000');
  await expect(page.getByText(/25 MB \/ 111\.2 MB/)).toBeVisible();
  await page.getByRole('button', { name: '取消', exact: true }).click({ force: true });
  await expect(page.getByRole('heading', { name: 'Enable AI Search' })).toBeVisible();
  await page.getByRole('button', { name: 'Download & Enable' }).click();
  const suggestion = page.getByRole('button', { name: '雾中的雪山', exact: true });
  await expect(suggestion).toBeVisible();
  await suggestion.focus(); await page.keyboard.press('Enter');
  await expect(page.locator('.ai-result-item')).toHaveCount(3);
  await expect(dialog.getByText('较相关的结果', { exact: true })).toBeVisible();
  await expect(page.getByText('按相关程度排序')).toBeVisible();
  assert(!decodeURI(page.url()).includes('雾中的雪山'), 'semantic query must not enter the URL');
  assert.deepEqual(await page.evaluate(() => (window as any).semanticFake.enabledPhotoIds), photos.map(photo => photo.publicId));

  await page.locator('.ai-result-item').first().click();
  await expect(page.locator('.photo-dialog')).toBeVisible();
  await expect(page.locator('.viewer-counter')).toHaveText('1 / 3');
  await page.getByRole('button', { name: '关闭照片', exact: true }).click();
  await page.keyboard.press('Meta+K');
  await expect(page.getByRole('dialog', { name: '搜索和筛选' })).toBeVisible();
  await page.getByRole('button', { name: '查看这 3 张照片' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => cards(page).evaluateAll(nodes => nodes.map(node => node.getAttribute('data-photo-id')))).toEqual(['photo-2', 'photo-0', 'photo-1']);

  await page.keyboard.press('Meta+K');
  await expect(page.getByRole('dialog', { name: '搜索和筛选' }).locator('.ai-result-item')).toHaveCount(3);
  const beforeExit = await page.evaluate(() => ({ ...((window as any).semanticFake.counts) }));
  assert.equal(beforeExit.workerStarts, 1); assert.equal(beforeExit.sessionInitializations, 1);
  await page.getByRole('button', { name: '退出 AI Search，恢复普通搜索' }).click();
  await expect(page.getByRole('dialog', { name: '搜索和筛选' })).toBeVisible();
  await expect(page.locator('.gallery-count')).toHaveText(metadataCount!);
  for (let cycle = 0; cycle < 8; cycle++) {
    await page.getByRole('button', { name: '开启 AI Search' }).click();
    await page.getByRole('button', { name: '退出 AI Search，恢复普通搜索' }).click();
  }
  const afterCycles = await page.evaluate(() => ({ ...((window as any).semanticFake.counts) }));
  assert.equal(afterCycles.workerStarts, 1); assert.equal(afterCycles.sessionInitializations, 1);
  assert.deepEqual(semanticRequests, [], 'the fake proves UI integration without hidden model requests');
});

test('AI Search expands populated score levels and shares the selected results with previews, Gallery and Viewer', async t => {
  const { ctx, page } = await pageFor({ reducedMotion: 'reduce' }); t.after(() => ctx.close());
  await ready(page, '?global');
  await installSemanticFake(page, 'cache');
  await page.evaluate(ids => {
    const scores = [.11, .07, .069999, .055, .05, .049999, .035, .03];
    const results = ids.slice(0, 60).map((publicId, index) => ({ publicId, rank: index + 1, score: scores[index] ?? .01 }));
    (window as any).semanticFake.resultSets['分级测试'] = results;
    (window as any).semanticFake.resultSets['新查询'] = results;
  }, photos.map(photo => photo.publicId!));
  await page.keyboard.press('Meta+K');
  const dialog = page.getByRole('dialog', { name: '搜索和筛选' });
  await dialog.getByRole('button', { name: '开启 AI Search' }).click();
  await dialog.getByRole('button', { name: 'Download & Enable' }).click();
  const input = dialog.getByRole('searchbox', { name: 'AI Search 自然语言搜索' });
  await expect(input).toBeEnabled();
  await input.fill('分级测试');
  await expect(dialog.locator('.ai-result-item')).toHaveCount(2);
  await expect(page.locator('.gallery-count')).toHaveText('2');
  await expect(dialog.getByRole('button', { name: '查看这 2 张照片' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /全部|剩余/ })).toHaveCount(0);
  await page.screenshot({ path: path.join(screenshots, 'ai-level-default-desktop.png') });

  await dialog.getByRole('button', { name: '显示更多', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.gallery-count')).toHaveText('5');
  await expect.poll(() => cards(page).evaluateAll(nodes => nodes.map(node => node.getAttribute('data-photo-id')))).toEqual(['photo-0', 'photo-1', 'photo-2', 'photo-3', 'photo-4']);
  await page.keyboard.press('Meta+K');
  await expect(dialog.locator('.ai-result-item')).toHaveCount(5);
  await expect(dialog.getByRole('button', { name: '查看这 5 张照片' })).toBeVisible();
  await dialog.getByRole('button', { name: '显示更多', exact: true }).click();
  await expect(page.locator('.gallery-count')).toHaveText('8');
  const summary = page.locator('.ai-gallery-summary');
  await expect(summary).toContainText('更广范围的结果');
  await summary.getByRole('button', { name: '显示剩余候选' }).click();
  await expect(page.locator('.gallery-count')).toHaveText('60');
  await expect(summary).toContainText('全部候选结果');
  await expect(summary.getByRole('button', { name: /显示更多|显示剩余候选/ })).toHaveCount(0);
  assert.equal(await page.evaluate(() => (window as any).semanticFake.counts.queries), 1, 'expanding results reuses the original candidates');

  await page.keyboard.press('Meta+K');
  await expect(dialog.locator('.ai-result-item')).toHaveCount(5);
  await expect(dialog.getByRole('button', { name: '查看这 60 张照片' })).toBeVisible();
  await dialog.locator('.ai-result-item').first().click();
  await expect(page.locator('.viewer-counter')).toHaveText('1 / 60');
  await page.keyboard.press('End');
  await expect(page.locator('.viewer-counter')).toHaveText('60 / 60');
  await page.getByRole('button', { name: '关闭照片', exact: true }).click();
  await summary.getByRole('button', { name: '只看较相关的结果' }).click();
  await expect(page.locator('.gallery-count')).toHaveText('2');
  await cards(page).first().click();
  await expect(page.locator('.viewer-counter')).toHaveText('1 / 2');
  await page.getByRole('button', { name: '关闭照片', exact: true }).click();

  await summary.getByRole('button', { name: '显示更多', exact: true }).click();
  await expect(page.locator('.gallery-count')).toHaveText('5');
  await page.keyboard.press('Meta+K');
  await input.fill('新查询');
  await expect(dialog.locator('.ai-result-item')).toHaveCount(2);
  await expect(dialog.locator('.ai-result-heading')).toContainText('较相关的结果');
  await expect.poll(() => page.evaluate(() => (window as any).semanticFake.queries.at(-1))).toBe('新查询');
  await expect(page.locator('.gallery-count')).toHaveText('2');
  await input.fill('');
  await expect(page.locator('.gallery-count')).toHaveText('480');
  await expect(summary).toHaveCount(0);
});

test('AI Search reveals more photos on every click and keeps the 云南 bird layout free of interior holes', async t => {
  const { ctx, page } = await pageFor({ viewport: { width: 1510, height: 1000 }, reducedMotion: 'reduce' }); t.after(() => ctx.close());
  const dimensions = [[6016, 4016], [6016, 4016], [5300, 3538], [4354, 2907], [4828, 3223], [3500, 2336], [5598, 3737], [6016, 4016], [6016, 4016], [4092, 2732], [6016, 4016], [6016, 4016], [6016, 4016], [6016, 4016], [6016, 4016]];
  const birds = photos.slice(0, dimensions.length).map((photo, index) => {
    const [width, height] = dimensions[index]!;
    return { ...photo, width, height, aspectRatio: width! / height!, video: undefined };
  });
  await page.route('**/photos.json', route => route.fulfill({ json: birds }));
  await ready(page);
  await installSemanticFake(page, 'cache');
  await page.evaluate(ids => {
    (window as any).semanticFake.resultSets['鸟'] = ids.map((publicId, index) => ({ publicId, rank: index + 1, score: index < 8 ? .1 : index < 14 ? .04 : .01 }));
  }, birds.map(photo => photo.publicId!));
  await page.keyboard.press('Meta+K');
  await page.getByRole('button', { name: '开启 AI Search' }).click();
  await page.getByRole('button', { name: 'Download & Enable' }).click();
  const input = page.getByRole('searchbox', { name: 'AI Search 自然语言搜索' });
  await expect(input).toBeEnabled();
  await input.fill('鸟');
  await page.getByRole('button', { name: '查看这 8 张照片' }).click();
  const summary = page.locator('.ai-gallery-summary');
  for (let repeat = 0; repeat < 2; repeat++) {
    await summary.getByRole('button', { name: '显示更多', exact: true }).click();
    await expect(page.locator('.gallery-count')).toHaveText('14');
    await expect(cards(page)).toHaveCount(14);
    const positions = await cards(page).evaluateAll(nodes => nodes.map(node => ({ id: node.getAttribute('data-photo-id'), x: node.getBoundingClientRect().x, y: node.getBoundingClientRect().y })));
    assert.deepEqual(positions.map(item => item.id), birds.slice(0, 14).map(photo => photo.id));
    const columns = [...new Set(positions.map(item => item.x))].sort((a, b) => a - b);
    assert.equal(columns.length, 5);
    positions.forEach((item, index) => assert.equal(item.x, columns[index % 5], 'each row fills from the left, including the last partial row'));
    for (const img of await cards(page).locator('img').all()) await expect(img).toHaveCSS('opacity', '1');
    await page.screenshot({ path: path.join(screenshots, 'ai-bird-expanded-no-gaps.png') });
    await summary.getByRole('button', { name: '显示剩余候选' }).click();
    await expect(page.locator('.gallery-count')).toHaveText('15');
    await expect(summary.getByRole('button', { name: /显示更多|显示剩余候选/ })).toHaveCount(0);
    await summary.getByRole('button', { name: '只看较相关的结果' }).click();
    await expect(page.locator('.gallery-count')).toHaveText('8');
  }
  assert.equal(await page.evaluate(() => (window as any).semanticFake.counts.queries), 1);
});

test('AI Search remembers successful enable across reloads and project navigation without loading before AI mode', async t => {
  const { ctx, page } = await pageFor({ reducedMotion: 'reduce' }); t.after(() => ctx.close());
  await ready(page, '?global');
  await installSemanticFake(page, 'cache', true);
  await page.keyboard.press('Meta+K');
  await page.getByRole('button', { name: '开启 AI Search' }).click();
  await page.getByRole('button', { name: 'Download & Enable' }).click();
  await expect(page.getByRole('button', { name: '雾中的雪山', exact: true })).toBeVisible();
  assert.equal(await page.evaluate(() => localStorage.getItem('jason-gallery:ai-search:enabled:v1')), 'true');

  for (const destination of ['reload', 'project']) {
    if (destination === 'reload') await page.reload();
    else await ready(page);
    await expect(cards(page).first()).toBeVisible();
    await page.keyboard.press('Meta+K');
    assert.equal(await page.evaluate(() => (window as any).semanticFake.counts.enables), 0, 'ordinary search never restores the model');
    await page.getByRole('button', { name: '开启 AI Search' }).click();
    await expect(page.getByRole('button', { name: '雾中的雪山', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download & Enable' })).toHaveCount(0);
    const counts = await page.evaluate(() => (window as any).semanticFake.counts);
    assert.equal(counts.enables, 1);
    assert.equal(counts.modelDownloads, 0);
    assert.equal(counts.persistentCacheHits, 1);
    assert.equal(counts.queries, 0, 'query text is not restored or persisted');
    assert.deepEqual(await page.evaluate(() => (window as any).semanticFake.enabledPhotoIds), destination === 'project' ? [] : photos.map(photo => photo.publicId));
    await page.getByRole('button', { name: '退出 AI Search，恢复普通搜索' }).click();
    await page.getByRole('button', { name: '开启 AI Search' }).click();
    assert.equal(await page.evaluate(() => (window as any).semanticFake.counts.enables), 1);
  }
});

test('AI Search cancellation stops automatic restore and a restore failure waits for manual retry', async t => {
  const { ctx, page } = await pageFor({ reducedMotion: 'reduce' }); t.after(() => ctx.close());
  await ready(page);
  await installSemanticFake(page, 'download', true);
  await page.evaluate(() => localStorage.setItem('jason-gallery:ai-search:enabled:v1', 'true'));
  await page.keyboard.press('Meta+K');
  await page.getByRole('button', { name: '开启 AI Search' }).click();
  await expect(page.getByText('正在下载 AI 模型…')).toBeVisible();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Download & Enable' })).toBeVisible();
  assert.equal(await page.evaluate(() => localStorage.getItem('jason-gallery:ai-search:enabled:v1')), 'false');
  await page.reload();
  await expect(cards(page).first()).toBeVisible();
  await page.keyboard.press('Meta+K');
  await page.getByRole('button', { name: '开启 AI Search' }).click();
  await expect(page.getByRole('button', { name: 'Download & Enable' })).toBeVisible();
  assert.equal(await page.evaluate(() => (window as any).semanticFake.counts.enables), 0);

  await page.evaluate(() => localStorage.setItem('jason-gallery:ai-search:enabled:v1', 'true'));
  await page.reload();
  await expect(cards(page).first()).toBeVisible();
  await page.evaluate(() => { (window as any).semanticFake.enableMode = 'update'; });
  await page.keyboard.press('Meta+K');
  await page.getByRole('button', { name: '开启 AI Search' }).click();
  await expect(page.getByRole('heading', { name: 'AI Search 需要更新' })).toBeVisible();
  await page.getByRole('button', { name: '退出 AI Search，恢复普通搜索' }).click();
  await page.getByRole('button', { name: '开启 AI Search' }).click();
  assert.equal(await page.evaluate(() => (window as any).semanticFake.counts.enables), 1, 'failure must not cause automatic retry loops');
  await page.evaluate(() => { (window as any).semanticFake.enableMode = 'cache'; });
  await page.getByRole('button', { name: '检查并更新' }).click();
  await expect(page.getByRole('button', { name: '雾中的雪山', exact: true })).toBeVisible();
  assert.equal(await page.evaluate(() => (window as any).semanticFake.counts.retries), 1);
});

test('AI Search restores a previously downloaded model without requiring a new opt-in, but respects cancellation', async t => {
  const { ctx, page } = await pageFor({ reducedMotion: 'reduce' }); t.after(() => ctx.close());
  await ready(page);
  await installSemanticFake(page, 'cache', true);
  await page.evaluate(async ({ name, url, marker }) => {
    const cache = await caches.open(name);
    await cache.put(url, new Response(JSON.stringify(marker)));
  }, {
    name: `${semanticCachePrefix}${CLIENT_SEMANTIC_RELEASE_ID}:${CLIENT_SEMANTIC_RELEASE_BUNDLE_SHA256}`,
    url: `${semanticCacheMarkerPath}${CLIENT_SEMANTIC_RELEASE_BUNDLE_SHA256}`,
    marker: { schemaVersion: 1, releaseId: CLIENT_SEMANTIC_RELEASE_ID, bundleSha256: CLIENT_SEMANTIC_RELEASE_BUNDLE_SHA256 },
  });
  assert.equal(await page.evaluate(() => localStorage.getItem('jason-gallery:ai-search:enabled:v1')), null);
  await page.keyboard.press('Meta+K');
  await page.getByRole('button', { name: '开启 AI Search' }).click();
  await expect(page.getByRole('button', { name: '雾中的雪山', exact: true })).toBeVisible();
  assert.equal(await page.evaluate(() => localStorage.getItem('jason-gallery:ai-search:enabled:v1')), 'true');
  assert.equal(await page.evaluate(() => (window as any).semanticFake.counts.modelDownloads), 0);
  await page.evaluate(() => localStorage.setItem('jason-gallery:ai-search:enabled:v1', 'false'));
  await page.reload();
  await expect(cards(page).first()).toBeVisible();
  await page.keyboard.press('Meta+K');
  await page.getByRole('button', { name: '开启 AI Search' }).click();
  await expect(page.getByRole('button', { name: 'Download & Enable' })).toBeVisible();
  assert.equal(await page.evaluate(() => (window as any).semanticFake.counts.enables), 0);
});

test('AI Search remains manually usable when browser storage is unavailable', async t => {
  const { ctx, page } = await pageFor({ reducedMotion: 'reduce' }); t.after(() => ctx.close());
  await page.addInitScript(() => {
    for (const key of ['localStorage', 'caches']) Object.defineProperty(window, key, { get() { throw new DOMException('Storage disabled', 'SecurityError'); } });
  });
  await ready(page);
  await installSemanticFake(page, 'cache');
  await page.keyboard.press('Meta+K');
  await page.getByRole('button', { name: '开启 AI Search' }).click();
  await page.getByRole('button', { name: 'Download & Enable' }).click();
  await expect(page.getByRole('button', { name: '雾中的雪山', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '雾中的雪山', exact: true }).click();
  await expect(page.locator('.ai-result-item')).toHaveCount(3);
});

test('Project Cmd+K AI Search ranks only project members and preserves levels, Viewer and metadata filters', async t => {
  const { ctx, page } = await pageFor({ reducedMotion: 'reduce' }); t.after(() => ctx.close());
  const projectPhotos = photos.slice(-3);
  await page.route('**/photos.json', route => route.fulfill({ json: projectPhotos }));
  await ready(page, '?tag=偶数');
  await expect(page.locator('.gallery-count')).toHaveText('1');
  await installSemanticFake(page, 'cache');
  await page.evaluate(ids => {
    (window as any).semanticFake.resultSets['项目内的画面'] = ids.map((publicId, index) => ({
      publicId, rank: index + 1, score: index < ids.length - 3 ? .9 : [.11, .05, .03][index - ids.length + 3],
    }));
  }, photos.map(photo => photo.publicId!));
  await page.keyboard.press('Meta+K');
  const dialog = page.getByRole('dialog', { name: '搜索和筛选' });
  await dialog.getByRole('button', { name: '开启 AI Search' }).click();
  await expect(dialog.getByText(/用自然语言描述当前项目中想找的画面/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Download & Enable' }).click();
  const input = dialog.getByRole('searchbox', { name: 'AI Search 自然语言搜索' });
  await expect(input).toBeEnabled();
  await expect(input).toHaveAttribute('placeholder', '描述当前项目中想找的画面…');
  await input.fill('项目内的画面');
  await expect(dialog.locator('.ai-result-item')).toHaveCount(1);
  await expect(dialog.locator('.ai-result-item').first()).toHaveAccessibleName('打开照片：照片 477 — 完整标题');
  assert.deepEqual(await page.evaluate(() => (window as any).semanticFake.enabledPhotoIds), [], 'project membership is not passed as an exact global-index catalog');
  assert.deepEqual(await page.evaluate(() => (window as any).semanticFake.queryOptions.at(-1)), { topK: 3, scopePhotoIds: projectPhotos.map(photo => photo.publicId) });
  await dialog.getByRole('button', { name: '显示更多', exact: true }).click();
  await expect(page.locator('.gallery-count')).toHaveText('2');
  await page.locator('.ai-gallery-summary').getByRole('button', { name: '显示更多', exact: true }).click();
  await expect(page.locator('.gallery-count')).toHaveText('3');
  await expect.poll(() => cards(page).evaluateAll(nodes => nodes.map(node => node.getAttribute('data-photo-id')))).toEqual(projectPhotos.map(photo => photo.id));
  await expect(page.locator('.ai-gallery-summary').getByRole('button', { name: /显示更多|显示剩余候选/ })).toHaveCount(0);
  await cards(page).first().click();
  await expect(page.locator('.viewer-counter')).toHaveText('1 / 3');
  await page.keyboard.press('End');
  await expect(page.locator('.viewer-counter')).toHaveText('3 / 3');
  assert.equal(new URL(page.url()).searchParams.get('photo'), 'photo-479');
  await page.getByRole('button', { name: '关闭照片', exact: true }).click();
  await page.keyboard.press('Meta+K');
  await dialog.getByRole('button', { name: '退出 AI Search，恢复普通搜索' }).click();
  await expect(page.locator('.gallery-count')).toHaveText('1');
  assert.equal(new URL(page.url()).searchParams.get('tag'), '偶数');
  assert.equal(await page.evaluate(() => (window as any).semanticFake.counts.queries), 1);
  await page.screenshot({ path: path.join(screenshots, 'project-ai-search.png') });
});

test('AI Search skips empty score bands on mobile and only displays actual candidates', async t => {
  const { ctx, page } = await pageFor({ viewport: { width: 320, height: 700 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' }); t.after(() => ctx.close());
  await ready(page, '?global');
  await installSemanticFake(page, 'cache');
  await page.evaluate(ids => {
    (window as any).semanticFake.resultSets['低分结果'] = ids.slice(0, 3).map((publicId, index) => ({ publicId, rank: index + 1, score: [.035, .03, -.01][index] }));
  }, photos.map(photo => photo.publicId!));
  await page.keyboard.press('Meta+K');
  const dialog = page.getByRole('dialog', { name: '搜索和筛选' });
  await dialog.getByRole('button', { name: '开启 AI Search' }).click();
  await dialog.getByRole('button', { name: 'Download & Enable' }).click();
  const input = dialog.getByRole('searchbox', { name: 'AI Search 自然语言搜索' });
  await expect(input).toBeEnabled();
  await input.fill('低分结果');
  await expect(dialog.getByText('当前范围没有匹配的结果')).toBeVisible();
  await expect(dialog.locator('.ai-result-item')).toHaveCount(0);
  await expect(page.locator('.gallery-count')).toHaveText('0');
  const more = dialog.getByRole('button', { name: '显示更多', exact: true });
  await more.focus(); await page.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);
  const summary = page.locator('.ai-gallery-summary');
  await expect(summary).toContainText('更广范围的结果 · 2 张');
  await expect(page.locator('.gallery-count')).toHaveText('2');
  await page.screenshot({ path: path.join(screenshots, 'ai-level-expanded-mobile.png') });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await summary.getByRole('button', { name: '显示剩余候选' }).tap();
  await expect(page.locator('.gallery-count')).toHaveText('3');
  await expect(summary.getByRole('button', { name: /显示更多|显示剩余候选/ })).toHaveCount(0);
  await page.keyboard.press('Meta+K');
  await expect(dialog.locator('.ai-result-item')).toHaveCount(3);
  await expect(dialog.getByRole('button', { name: '查看这 3 张照片' })).toBeVisible();
  await dialog.getByRole('button', { name: '只看较相关的结果' }).tap();
  await expect(page.locator('.gallery-count')).toHaveText('0');
  await page.keyboard.press('Meta+K');
  await input.fill('none');
  await expect(dialog.getByText('没有可显示的结果')).toBeVisible();
  await expect(dialog.getByRole('button', { name: /显示更多|显示剩余候选/ })).toHaveCount(0);
});

test('cache-hit AI Search debounces, cancels stale queries, handles no results and recovers from query errors', async t => {
  const { ctx, page } = await pageFor(); t.after(() => ctx.close());
  await ready(page, '?global');
  await installSemanticFake(page, 'cache');
  await page.keyboard.press('Meta+K');
  await page.getByRole('button', { name: '开启 AI Search' }).click();
  await page.getByRole('button', { name: 'Download & Enable' }).click();
  await expect(page.getByRole('button', { name: '金色日落', exact: true })).toBeVisible();
  assert.deepEqual(await page.evaluate(() => {
    const c = (window as any).semanticFake.counts; return { downloads: c.modelDownloads, hits: c.persistentCacheHits, sessions: c.sessionInitializations };
  }), { downloads: 0, hits: 1, sessions: 1 });

  const input = page.getByRole('searchbox', { name: 'AI Search 自然语言搜索' });
  await input.fill('slow river');
  await expect.poll(() => page.evaluate(() => (window as any).semanticFake.counts.queries)).toBe(1);
  await input.fill('golden sunset');
  await expect(page.locator('.ai-result-item')).toHaveCount(3);
  await expect(page.locator('.ai-result-item').first()).toHaveAccessibleName('打开照片：照片 2 — 完整标题');
  assert((await page.evaluate(() => (window as any).semanticFake.counts.abortedQueries)) >= 1);

  await input.fill('none');
  await expect(page.getByText('没有可显示的结果')).toBeVisible();
  await input.fill('error');
  await expect(page.getByRole('heading', { name: 'AI Search 启用失败' })).toBeVisible();
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByRole('button', { name: '岩石间的急流', exact: true })).toBeVisible();
});

test('AI Search stays keyboard-usable at 320px, has static reduced-motion edges, and reports update-required', async t => {
  const { ctx, page } = await pageFor({ viewport: { width: 320, height: 700 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' }); t.after(() => ctx.close());
  await ready(page, '?global');
  await installSemanticFake(page, 'update');
  await page.keyboard.press('Meta+K');
  const dialog = page.getByRole('dialog', { name: '搜索和筛选' });
  const metadataBounds = await dialog.boundingBox();
  const aiButton = page.getByRole('button', { name: '开启 AI Search' });
  await aiButton.focus(); await expect(aiButton).toBeFocused(); await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  const bounds = await dialog.boundingBox();
  assert(metadataBounds && bounds && Math.abs(metadataBounds.height - bounds.height) < 1, 'mobile AI mode keeps the search drawer height stable');
  assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 320);
  const activeAIButton = page.getByRole('button', { name: '退出 AI Search，恢复普通搜索' });
  assert.equal(await activeAIButton.evaluate(element => getComputedStyle(element, '::before').animationName), 'none');
  await page.getByRole('button', { name: 'Download & Enable' }).tap();
  await expect(page.getByRole('heading', { name: 'AI Search 需要更新' })).toBeVisible();
  await expect(page.getByRole('button', { name: '检查并更新' })).toBeVisible();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
});

test('Global Gallery keeps 480-photo virtualization and filtered Viewer scroll/focus restoration in both views', async t => {
  const { ctx, page } = await pageFor({ reducedMotion: 'reduce' }); t.after(() => ctx.close());
  const membership = { id: 'shared-id', slug: 'shared-slug', title: 'Shared project' };
  const globalPhotos = photos.map(photo => ({ ...photo, video: undefined, projects: [membership, { id: 'another-id', slug: 'another', title: 'Another project' }] }));
  await page.route('**/photos.json', route => route.fulfill({ json: globalPhotos }));
  const thumbnails = new Set<string>(), originalRequests: string[] = [];
  page.on('request', request => {
    if (request.url().includes('/thumb.jpg?id=')) thumbnails.add(request.url());
    if (/\/(motion\.jpg|live\.(mp4|mov)|details\.json)$/.test(request.url())) originalRequests.push(request.url());
  });
  await ready(page, '?global&project=shared-id&tag=偶数&sort=asc');
  await expect(page.locator('.gallery-count')).toHaveText('240');
  assert(await cards(page).count() < 100);
  assert(thumbnails.size < 100, 'Global Gallery requests only the virtual window of thumbnails');
  assert.deepEqual(originalRequests, []);
  await page.getByRole('button', { name: '列表视图', exact: true }).click();
  assert(await page.locator('.list-card').count() < 30);
  await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
  const last = page.locator('.list-card[data-gallery-index="239"]');
  await expect(last).toBeVisible();
  const before = await page.evaluate(() => scrollY), url = page.url();
  const trigger = last.locator('.list-image'), box = await trigger.boundingBox();
  await last.click();
  await expect(page.locator('.viewer-counter')).toHaveText('240 / 240');
  await expect(page.locator('.viewer-media')).toHaveAttribute('data-media-state', 'loaded', { timeout: browserReadyTimeout(15_000) });
  await page.keyboard.press('Home');
  await expect(page.locator('.viewer-counter')).toHaveText('1 / 240');
  await page.getByRole('button', { name: '关闭照片', exact: true }).click();
  await expect(page.locator('.photo-dialog')).toHaveCount(0);
  await expect(trigger).toBeFocused();
  assert.equal(page.url(), url); assert.equal(await page.evaluate(() => scrollY), before);
  assert.deepEqual(await trigger.boundingBox(), box);
});

test('480-photo native map bounds HTML markers to the viewport and releases motion subscriptions on close', async t => {
  const { ctx, page } = await pageFor({ reducedMotion: 'reduce' }); t.after(() => ctx.close());
  const located = photos.map((photo, index) => ({ ...photo, video: undefined, src: `/original-forbidden/${index}.jpg`,
    location: { longitude: 114.17 + (index % 24) * .0016, latitude: 22.3 + Math.floor(index / 24) * .0016 } }));
  let originalRequests = 0;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.url().includes('/original-forbidden/')) originalRequests++; });
  await page.route('**/photos.json', route => route.fulfill({ json: located }));
  await installMapFixture(page, server.url);
  await page.addInitScript({ content: `
    window.phase2MotionListeners = new Set();
    const add = MediaQueryList.prototype.addEventListener;
    const remove = MediaQueryList.prototype.removeEventListener;
    MediaQueryList.prototype.addEventListener = function(type, listener, ...args) {
      if (type === 'change' && this.media.includes('prefers-reduced-motion')) window.phase2MotionListeners.add(listener);
      return Reflect.apply(add, this, [type, listener, ...args]);
    };
    MediaQueryList.prototype.removeEventListener = function(type, listener, ...args) {
      if (type === 'change' && this.media.includes('prefers-reduced-motion')) window.phase2MotionListeners.delete(listener);
      return Reflect.apply(remove, this, [type, listener, ...args]);
    };
  ` });
  await ready(page);
  await page.waitForTimeout(500);
  const closedListeners = await page.evaluate(() => (window as any).phase2MotionListeners.size);
  await page.evaluate(() => {
    history.pushState(history.state, '', '?panel=map&mapPhoto=photo-240');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.locator('.photo-map')).toHaveAttribute('data-map-state', 'ready', { timeout: browserReadyTimeout(15_000) });
  await expect.poll(() => page.locator('.photo-marker-pin').count()).toBeGreaterThan(20);
  assert(await page.locator('.photo-marker-pin').count() < located.length, 'only loaded unclustered photos near the viewport get HTML markers');
  await expect(page.locator('.photo-marker-pin[aria-pressed="true"]')).toHaveCount(1);
  const listenersBefore = await page.evaluate(() => (window as any).phase2MotionListeners.size
    - document.querySelectorAll('.photo-marker-pin, .cluster-marker').length - document.querySelectorAll('.photo-marker-card .ellipsis-text').length);
  const canvas = page.locator('.photo-map canvas'), box = (await canvas.boundingBox())!;
  const markersStayInViewport = () => page.locator('.photo-marker-host').evaluateAll(nodes => {
    const canvas = document.querySelector('.photo-map canvas')!.getBoundingClientRect();
    return nodes.every(node => {
      const marker = node.getBoundingClientRect();
      const x = marker.x + marker.width / 2 - canvas.x, y = marker.y + marker.height / 2 - canvas.y;
      return x >= -40 && x <= canvas.width + 40 && y >= -40 && y <= canvas.height + 40;
    });
  });
  await expect.poll(markersStayInViewport).toBe(true);
  for (let cycle = 0; cycle < 3; cycle++) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 - 180, box.y + box.height / 2 - 60, { steps: 8 }); await page.mouse.up();
    await page.waitForTimeout(350);
    const ids = await page.locator('.photo-marker-host').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-photo-id')));
    assert.equal(new Set(ids).size, ids.length, 'pan does not duplicate tiled markers');
    assert(ids.length < located.length);
    await expect.poll(markersStayInViewport).toBe(true);
    await expect.poll(() => page.evaluate(() => (window as any).phase2MotionListeners.size
      - document.querySelectorAll('.photo-marker-pin, .cluster-marker').length - document.querySelectorAll('.photo-marker-card .ellipsis-text').length)).toBe(listenersBefore);
  }
  await page.getByRole('button', { name: '缩小地图' }).click();
  await page.waitForTimeout(500);
  await expect(page.locator('.photo-marker-host[data-photo-id="photo-240"]')).toHaveCount(1);
  await page.getByRole('button', { name: /^(关闭面板|返回项目相册)$/ }).click();
  await expect(page.locator('.photo-marker-pin')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).phase2MotionListeners.size)).toBe(closedListeners);
  assert.equal(originalRequests, 0); assert.deepEqual(errors, []);
});
async function geometry(page: Page) {
  return cards(page).evaluateAll(nodes => nodes.map(node => {
    const b = node.getBoundingClientRect();
    return { id: node.getAttribute('data-photo-id'), x: b.x, y: b.y + scrollY, w: b.width, h: b.height };
  }));
}
function assertShortestColumns(boxes: Awaited<ReturnType<typeof geometry>>, count: number) {
  const heights = Array(count).fill(0) as number[];
  const left = Math.min(...boxes.map(box => box.x));
  const top = Math.min(...boxes.map(box => box.y));
  for (const box of boxes) {
    const column = heights.indexOf(Math.min(...heights));
    assert(Math.abs(box.x - left - column * (box.w + 4)) < .1, `${box.id} must enter the shortest column`);
    assert(Math.abs(box.y - top - heights[column]!) < .1, `${box.id} must follow the preceding photo by 4px`);
    heights[column] += box.w / photos.find(photo => photo.id === box.id)!.aspectRatio + 4;
  }
}

test('480-photo masonry virtualizes, keeps ratio/gutters and stable total height through load, resize and scrolling', async t => {
  const { ctx, page } = await pageFor(); t.after(() => ctx.close());
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; }); t.after(() => release());
  await page.route('**/thumb.jpg?*', async route => { await held; await route.continue().catch(() => {}); });
  await page.goto(server.url, { waitUntil: 'domcontentloaded' });
  await expect(cards(page).first()).toBeVisible();
  const before = await geometry(page);
  const renderedIndices = before.map(p => Number(p.id!.slice(6)));
  assert.deepEqual(renderedIndices, [...renderedIndices].sort((a, b) => a - b), 'Keyboard and screen reader order must match the Project sequence');
  const heightBefore = await page.locator('.masonic').evaluate(el => el.getBoundingClientRect().height);
  assert(before.length < 100 && before.length > 10);
  assert.equal(new Set(before.filter(p => p.y === 52).map(p => p.x)).size, 5);
  assertShortestColumns(before, 5);
  for (const p of before) {
    const data = photos.find(photo => photo.id === p.id)!;
    assert(Math.abs(p.h - p.w / data.aspectRatio) < .1);
  }
  const firstRow = before.filter(p => p.y === 52).sort((a, b) => a.x - b.x);
  assert(Math.abs(firstRow[1]!.x - firstRow[0]!.x - firstRow[0]!.w - 4) < .1);
  const column = before.filter(p => p.x === firstRow[0]!.x).sort((a, b) => a.y - b.y);
  assert(Math.abs(column[1]!.y - column[0]!.y - column[0]!.h - 4) < .1);
  release();
  await expect(cards(page).first().locator('img')).toHaveCSS('opacity', '1');
  assert.deepEqual(await geometry(page), before);
  assert.equal(await page.locator('.masonic').evaluate(el => el.getBoundingClientRect().height), heightBefore);
  await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
  await expect(page.locator('[data-photo-id="photo-479"]')).toBeVisible();
  assert(await cards(page).count() < 100);
  assert.equal(await page.locator('[data-photo-id="photo-0"]').count(), 0);
  await page.evaluate(() => scrollTo(0, 0));
  await expect(page.locator('[data-photo-id="photo-0"]')).toBeVisible();
  for (const [width, columns] of [[390,2], [768,4], [1023,6], [1024,3], [1440,5], [3000,8]] as const) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(async () => new Set((await geometry(page)).filter(p => p.y === 52).map(p => p.x)).size).toBe(columns);
    const boxes = await geometry(page);
    assertShortestColumns(boxes, columns);
    for (const box of boxes) assert(Math.abs(box.h - box.w / photos.find(p => p.id === box.id)!.aspectRatio) < .1);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  assert.deepEqual(errors, []);
});

test('manual widths, filter/sort, segment URL persistence and Viewer shared-element entry stay project-scoped', async t => {
  const { ctx, page } = await pageFor(); t.after(() => ctx.close());
  await ready(page);
  await page.getByRole('button', { name: '显示设置' }).click();
  await chooseColumns(page, 8);
  await page.getByRole('button', { name: '关闭面板' }).click();
  await expect.poll(async () => new Set((await geometry(page)).filter(p => p.y === 52).map(p => p.x)).size).toBe(6);
  await page.getByRole('button', { name: '显示设置' }).click();
  await chooseColumns(page, 1);
  await page.getByRole('button', { name: '关闭面板' }).click();
  await expect.poll(async () => new Set((await geometry(page)).filter(p => p.y === 52).map(p => p.x)).size).toBe(2);
  await page.getByRole('button', { name: '列表视图' }).click();
  await expect(page.locator('.masonry-photo')).toHaveCount(0);
  assert(await page.locator('.photo-list > li').count() > 0 && await page.locator('.photo-list > li').count() < 30);
  assert.equal(new URL(page.url()).searchParams.get('view'), 'list');
  await page.reload(); await expect(page.locator('.list-card').first()).toBeVisible(); assert(await page.locator('.photo-list > li').count() > 0 && await page.locator('.photo-list > li').count() < 30);
  await page.getByRole('button', { name: '瀑布流' }).click();
  await page.getByRole('button', { name: '搜索和筛选' }).click();
  await page.getByRole('button', { name: '标签：偶数', exact: true }).click();
  await page.getByRole('button', { name: '查看 240 张照片' }).click();
  await expect(page.locator('.gallery-count')).toHaveText('240');
  assert((await geometry(page)).every(p => Number(p.id!.slice(6)) % 2 === 0));
  await page.getByRole('button', { name: '显示设置' }).click();
  await page.getByRole('radio', { name: '拍摄时间：从新到旧' }).click();
  await page.getByRole('button', { name: '关闭面板' }).click();
  await expect(page.locator('[data-gallery-index="0"]')).toHaveAttribute('data-photo-id', 'photo-26');
  const first = page.locator('[data-gallery-index="0"]');
  const before = await first.boundingBox();
  await first.click();
  await expect(page.locator('.photo-dialog')).toBeVisible();
  assert.equal(new URL(page.url()).searchParams.get('photo'), 'photo-26');
  await expect(page.locator('.viewer-counter')).toContainText('/ 240');
  await page.getByRole('button', { name: '关闭照片' }).click();
  await expect(page.locator('.photo-dialog')).toHaveCount(0);
  await expect(first).toBeFocused();
  assert.deepEqual(await first.boundingBox(), before);
});

test('hover metadata, full-card gradient, 1.05 reveal, compact rules, keyboard and reduced motion', async t => {
  const { ctx, page } = await pageFor(); t.after(() => ctx.close()); await ready(page);
  const card = page.locator('[data-photo-id="photo-0"]');
  await card.hover();
  await expect(card.locator('.masonry-media')).toHaveCSS('transform', 'matrix(1.05, 0, 0, 1.05, 0, 0)');
  await expect(card.locator('.masonry-media')).toHaveCSS('transition-duration', '0s');
  await expect(card.locator('.photo-hover-gradient')).toHaveCSS('opacity', '1');
  assert.deepEqual(await card.locator('.photo-hover-gradient').boundingBox(), await card.boundingBox());
  for (const text of ['照片 0', '这是一段照片说明', 'JPG', '640 × 960', '2.0MB', '旅行', '50 mm', 'ƒ/2.8', '1/125 s', 'ISO 100']) await expect(card.locator('.photo-hover')).toContainText(text);
  await expect(card.locator('.photo-exif > span')).toHaveCount(4);
  await expect(page.locator('[data-photo-id="photo-3"] .photo-exif')).toHaveCount(0);
  await page.screenshot({ path: path.join(screenshots, 'desktop-hover.png') });
  await page.mouse.move(0,0); await card.focus();
  await expect(card.locator('.photo-hover')).toHaveCSS('opacity', '1');
  assert.notEqual(await card.evaluate(el => getComputedStyle(el).outlineStyle), 'none');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await card.hover(); await expect(card.locator('.masonry-media')).toHaveCSS('transform', 'none');
  await page.getByRole('button', { name: '列表视图' }).click();
  await expect(page.getByRole('button', { name: '列表视图' })).toHaveAttribute('aria-pressed', 'true');
});

test('single-row mobile header exposes map and retains views in settings at narrow widths', async t => {
  const { ctx, page } = await pageFor({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  let completed = false;
  t.after(async () => {
    try {
      if (completed) await ctx.tracing.stop();
      else {
        const diagnostics = path.join(repo, '.cache/website-diagnostics');
        await fs.mkdir(diagnostics, { recursive: true });
        await ctx.tracing.stop({ path: path.join(diagnostics, 'single-row-mobile-header.zip') });
      }
    } finally { await ctx.close(); }
  });
  await ctx.tracing.start({ screenshots: true, snapshots: true, sources: true });
  await ready(page);
  await expect(page.locator('.gallery-header-content')).toHaveCSS('height', '48px');
  await expect(page.locator('.gallery-header')).toHaveCSS('z-index', '30');
  assert.equal(await page.locator('.linear-blur-layer').count(), 8);
  for (const width of [320,390,768,1023]) {
    await page.setViewportSize({ width, height: 844 });
    for (const name of ['搜索和筛选','地图探索','显示设置','项目信息']) {
      const button = page.getByRole('button', { name, exact: true });
      await expect.poll(async () => {
        const box = await button.boundingBox();
        return !!box && box.x >= 0 && box.x + box.width <= width && box.y >= 0 && box.y + box.height <= 48;
      }, { message: `${name} must stay inside the ${width} × 844 viewport after resize` }).toBe(true);
    }
    await expect(page.locator('.gallery-header .view-segment')).toHaveCount(0);
    const heading = await page.locator('.gallery-header h1').boundingBox();
    assert(heading && heading.width >= 32 && heading.y + heading.height <= 48, 'title stays visible in the single row');
    const first = await cards(page).first().boundingBox();
    assert(first && first.y >= 52, 'photos start below the single-row header');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  const settingsTrigger = page.getByRole('button', { name: '显示设置', exact: true });
  const settings = page.getByRole('dialog', { name: '显示设置', exact: true });
  const changeMobileView = async (name: '列表视图' | '瀑布流', view: 'list' | 'masonry') => {
    await settingsTrigger.tap();
    // A cold 1023px ListView plus the drawer's backdrop blur can stall software
    // rasterization beyond the ordinary assertion deadline. Keep the real spring
    // and exact settled transform; give readiness the same budget as a cold map.
    await expect(settings).toHaveCSS('transform', 'none', { timeout: browserReadyTimeout(15_000) });
    const option = settings.getByRole('button', { name, exact: true });
    await option.tap();
    await expect(option).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => new URL(page.url()).searchParams.get('view')).toBe(view);
    await settings.getByRole('button', { name: '关闭面板', exact: true }).tap();
    await expect(settings).toHaveCount(0);
    await expect(settingsTrigger).toHaveAttribute('aria-expanded', 'false');
    await expect(settingsTrigger).toBeFocused();
  };
  await changeMobileView('列表视图', 'list');
  await expect(page.locator('.list-card').first()).toBeVisible();
  await page.reload();
  await expect(page.locator('.list-card').first()).toBeVisible();
  await changeMobileView('瀑布流', 'masonry');
  await expect(cards(page).first()).toBeVisible();
  await page.getByRole('button', { name: '地图探索', exact: true }).tap();
  await expect(page.getByRole('dialog', { name: '地图探索', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '没有可显示的位置' })).toBeVisible();
  await page.getByRole('button', { name: /^(关闭面板|返回项目相册)$/, exact: true }).tap();
  await expect(page.getByRole('button', { name: '地图探索', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await page.setViewportSize({ width: 1024, height: 844 });
  await expect(page.locator('.gallery-header-content')).toHaveCSS('height', '48px');
  await expect(page.locator('.gallery-header .view-segment')).toBeVisible();
  await expect(page.getByRole('button', { name: '地图探索', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '瀑布流' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(cards(page).first()).toBeVisible();
  await page.screenshot({ path: path.join(screenshots, 'mobile.png') });
  await page.getByRole('button', { name: '项目信息' }).tap();
  await expect(page.getByRole('dialog', { name: '项目信息' })).toContainText('Project — 长标题');
  completed = true;
});

test('Live/Motion/MOV play after 200ms hover, reset on leave/end and preserve card geometry', async t => {
  const { ctx, page } = await pageFor(); t.after(() => ctx.close());
  let ranges = 0;
  await page.route('**/motion.jpg', route => {
    if (route.request().headers().range) { ranges++; return route.fulfill({ status: 206, contentType: 'video/mp4', body: video }); }
    return route.fulfill({ contentType: 'image/jpeg', body: motion });
  });
  await ready(page);
  for (const index of [1,2,3]) {
    const card = page.locator(`[data-photo-id="photo-${index}"]`), player = card.locator('video');
    await expect(card.locator('.live-photo-badge')).toHaveAttribute('data-state', 'ready');
    const box = await card.boundingBox();
    await card.hover(); await page.mouse.move(0,0);
    await page.waitForTimeout(250);
    await expect(player).toHaveAttribute('data-playing', 'false');
    await card.hover();
    await expect(player).toHaveAttribute('data-playing', 'true');
    assert(await player.evaluate(v => !(v as HTMLVideoElement).paused));
    await page.mouse.move(0,0);
    await expect(player).toHaveAttribute('data-playing', 'false');
    assert.equal(await player.evaluate(v => (v as HTMLVideoElement).currentTime), 0);
    assert.deepEqual(await card.boundingBox(), box);
    await card.hover(); await expect(player).toHaveAttribute('data-playing', 'true');
    await expect(player).toHaveAttribute('data-playing', 'false', { timeout: 5000 });
    await page.mouse.move(0,0);
  }
  assert.equal(ranges, 1);
});

test('video failure settles, while mobile/reduced motion never autoplay', async t => {
  const { ctx, page } = await pageFor(); t.after(() => ctx.close());
  await page.addInitScript({ content: `
    window.galleryPlayCalls = 0;
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function() { window.galleryPlayCalls++; return play.call(this); };
  ` });
  await page.route('**/live.mp4', route => route.abort());
  await page.route('**/motion.jpg', route => route.fulfill({ contentType: 'image/jpeg', body: motion }));
  await ready(page);
  await expect(page.locator('[data-photo-id="photo-1"] .live-photo-badge')).toHaveAttribute('data-state', 'error');
  await expect(page.locator('[data-photo-id="photo-2"] .live-photo-badge')).toHaveAttribute('data-state', 'ready');
  await page.locator('[data-photo-id="photo-1"]').hover();
  await expect(page.locator('[data-photo-id="photo-1"] video')).toHaveAttribute('data-playing', 'false');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('[data-photo-id="photo-2"]').hover(); await page.waitForTimeout(500);
  assert.equal(await page.evaluate('window.galleryPlayCalls'), 0);
  await expect(page.locator('[data-photo-id="photo-2"] video')).toHaveAttribute('data-playing', 'false');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 900, height: 900 });
  await page.locator('[data-photo-id="photo-2"]').hover(); await page.waitForTimeout(500);
  assert.equal(await page.evaluate('window.galleryPlayCalls'), 0);
  await expect(page.locator('[data-photo-id="photo-2"] video')).toHaveAttribute('data-playing', 'false');
});

test('leaving masonry during video loading cancels requests and releases video/Blob resources', async t => {
  const { ctx, page } = await pageFor(); t.after(() => ctx.close());
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript({ content: `
    window.galleryObjectURLs = []; window.galleryRevokedURLs = [];
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = blob => { const url = create(blob); window.galleryObjectURLs.push(url); return url; };
    URL.revokeObjectURL = url => { window.galleryRevokedURLs.push(url); revoke(url); };
  ` });
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; }); t.after(() => release());
  await page.route('**/live.mp4', async route => { await held; await route.fulfill({ contentType: 'video/mp4', body: video }).catch(() => {}); });
  await page.goto(server.url, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-photo-id="photo-1"] .live-photo-badge')).toHaveAttribute('data-state', 'loading');
  await expect(page.locator('[data-photo-id="photo-2"] .live-photo-badge')).toHaveAttribute('data-state', 'ready');
  await page.getByRole('button', { name: '列表视图' }).click(); release();
  await expect(page.locator('video')).toHaveCount(0);
  await expect.poll(() => page.evaluate('window.galleryObjectURLs.every(url => window.galleryRevokedURLs.includes(url))')).toBe(true);
  assert(await page.evaluate('window.galleryObjectURLs.length > 0'));
  await page.waitForTimeout(300);
  assert.deepEqual(errors, []);
});

test('segmented indicator actually travels between controls and reduced motion places it immediately', async t => {
  const { ctx, page } = await pageFor({ reducedMotion: 'no-preference' }); t.after(() => ctx.close()); await ready(page, '/?query=479.jpg');
  await page.evaluate(`document.querySelector('button[aria-label="列表视图"]').addEventListener('click', () => {
    window.gallerySegmentPositions = [];
    const sample = () => {
      window.gallerySegmentPositions.push(document.querySelector('.segment-indicator').getBoundingClientRect().x);
      if (window.gallerySegmentPositions.length < 30) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }, { once: true })`);
  await page.getByRole('button', { name: '列表视图' }).click();
  await expect.poll(() => page.evaluate('window.gallerySegmentPositions.length')).toBe(30);
  const positions = await page.evaluate<number[]>('window.gallerySegmentPositions');
  assert(new Set(positions.map(x => Math.round(x * 100))).size > 1, 'The shared indicator must visibly animate with the layout spring');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: '瀑布流' }).click();
  const indicator = await page.locator('.segment-indicator').boundingBox();
  const button = await page.getByRole('button', { name: '瀑布流' }).boundingBox();
  assert(indicator && button && Math.abs(indicator.x - button.x) < .1);
});

async function chooseColumns(page: Page, count: number) {
  const slider = page.getByRole('slider', { name: '瀑布流列数' });
  await slider.press('Home');
  for (let index = 0; index < count; index++) await slider.press('ArrowRight');
}

test('desktop ListView virtualizes all 480 photos and preserves crop, order, metadata and Viewer trigger', async t => {
  const { ctx, page } = await pageFor(); t.after(() => ctx.close());
  await page.goto(server.url + '?view=list');
  const first = page.locator('.list-card').first();
  await expect(first).toBeVisible();
  await expect(first).toHaveCSS('height', '176px');
  await expect(first.locator('.list-image')).toHaveCSS('width', '224px');
  await expect(first.locator('img')).toHaveCSS('object-fit', 'cover');
  assert(await page.locator('.list-card').count() < 30);
  await expect(first.locator('.list-info')).toContainText('NIKON Z6');
  await expect(first.locator('.list-info')).toContainText('35mm');
  await expect(first.locator('.list-exif')).toContainText('ISO 100');
  await page.screenshot({ path: path.join(screenshots, 'list-desktop.png') });
  await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
  await expect(page.locator('[data-photo-id="photo-479"]')).toBeVisible();
  assert.equal(await page.locator('[data-photo-id="photo-0"]').count(), 0);
  const last = page.locator('[data-photo-id="photo-479"]');
  const triggerBox = await last.locator('.list-image').boundingBox();
  await last.click();
  await expect(page.locator('.photo-dialog')).toBeVisible();
  assert.equal(new URL(page.url()).searchParams.get('photo'), 'photo-479');
  await page.getByRole('button', { name: '关闭照片' }).click();
  await expect(page.locator('.photo-dialog')).toHaveCount(0);
  await expect(last.locator('.list-image')).toBeFocused();
  assert.deepEqual(await last.locator('.list-image').boundingBox(), triggerBox);
});

test('mobile ListView uses ratio-first vertical cards and remeasures on resize without image-load jumps', async t => {
  const { ctx, page } = await pageFor({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); t.after(() => ctx.close());
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; }); t.after(() => release());
  await page.route('**/thumb.jpg?*', async route => { await held; await route.continue().catch(() => {}); });
  await page.goto(server.url + '?view=list', { waitUntil: 'domcontentloaded' });
  const first = page.locator('.list-card').first();
  await expect(first).toBeVisible();
  await expect(first).toHaveCSS('flex-direction', 'column');
  const image = await first.locator('.list-image').boundingBox();
  const metadata = await first.locator('.list-info').boundingBox();
  assert(image && metadata && Math.abs(image.width / image.height - photos[0]!.aspectRatio) < .001 && metadata.y >= image.y + image.height);
  const before = await first.boundingBox(); release();
  await expect(first.locator('img')).toHaveCSS('opacity', '1');
  assert.deepEqual(await first.boundingBox(), before);
  await page.screenshot({ path: path.join(screenshots, 'list-mobile.png') });
  await expect(first.locator('img')).toHaveCSS('object-fit', 'contain');
  assert(await page.locator('.list-card').count() < 20);
  await page.setViewportSize({ width: 768, height: 844 });
  await expect.poll(async () => (await first.boundingBox())!.width).toBe(736);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(first).toHaveCSS('height', '176px');
  await expect(first).toHaveCSS('flex-direction', 'row');
});

test('search keyboard, chips, dates and URL state keep the original filter semantics', async t => {
  const { ctx, page } = await pageFor(); t.after(() => ctx.close()); await ready(page);
  const trigger = page.getByRole('button', { name: '搜索和筛选', exact: true });
  await trigger.focus(); await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: '搜索和筛选' });
  await expect(page.getByRole('searchbox')).toBeFocused();
  await page.getByRole('searchbox').press('ArrowDown');
  await page.getByRole('searchbox').press('Enter');
  await expect(dialog.getByRole('button', { name: '相机：NIKON Z6', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByRole('button', { name: '标签：偶数', exact: true }).click();
  await dialog.locator('.date-filter summary').click();
  await page.getByLabel('开始日期', { exact: true }).fill('2024-03-03');
  await page.getByLabel('结束日期', { exact: true }).fill('2024-03-05');
  await expect(page.getByRole('button', { name: '查看 35 张照片' })).toBeVisible();
  await page.screenshot({ path: path.join(screenshots, 'search-desktop.png') });
  await page.getByRole('button', { name: '查看 35 张照片' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  assert.equal(new URL(page.url()).searchParams.get('tag'), '偶数');
  assert.equal(new URL(page.url()).searchParams.get('start'), '2024-03-03');
  await page.reload(); await expect(page.locator('.gallery-count')).toHaveText('35');
  await page.getByRole('button', { name: '移除标签：偶数', exact: true }).click();
  await expect(page.locator('.gallery-count')).toHaveText('53');
  assert.equal(new URL(page.url()).searchParams.get('tag'), null);
  await trigger.click(); await expect(page.getByRole('searchbox')).toBeFocused();
  await page.keyboard.press('Escape'); await expect(page.locator('.gallery-panel')).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('settings branches to an anchored desktop dropdown and mobile spring drawer with focus and safe bounds', async t => {
  const { ctx, page } = await pageFor(); t.after(() => ctx.close()); await ready(page);
  const trigger = page.getByRole('button', { name: '显示设置', exact: true });
  await trigger.click();
  await expect(page.locator('.gallery-dropdown')).toBeVisible();
  await expect(page.locator('.gallery-dropdown')).toHaveCSS('z-index', '60');
  const dropdown = await page.locator('.gallery-dropdown').boundingBox(), button = await trigger.boundingBox();
  assert(dropdown && button && dropdown.y >= button.y + button.height && dropdown.x + dropdown.width <= 1440);
  await page.getByRole('radio', { name: '项目编排顺序' }).press('ArrowDown');
  await expect(page.getByRole('radio', { name: '拍摄时间：从新到旧' })).toBeChecked();
  await chooseColumns(page, 8);
  assert.equal(new URL(page.url()).searchParams.get('columns'), '8');
  await page.screenshot({ path: path.join(screenshots, 'settings-desktop.png') });
  await page.getByRole('button', { name: '关闭面板', exact: true }).click();
  await expect(page.locator('.gallery-panel')).toHaveCount(0); await expect(trigger).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await trigger.click();
  await expect(page.locator('.gallery-drawer')).toBeVisible();
  await expect(page.locator('.gallery-drawer')).toHaveCSS('transition-duration', '0s');
  await expect(page.locator('.gallery-scrim')).toHaveCSS('backdrop-filter', 'blur(4px)');
  await expect(page.locator('.gallery-drawer')).toHaveCSS('transform', 'none');
  const drawer = await page.locator('.gallery-drawer').boundingBox();
  assert(drawer && drawer.x === 0 && drawer.width === 390 && Math.abs(drawer.y + drawer.height - 844) < 1);
  await page.screenshot({ path: path.join(screenshots, 'settings-mobile.png') });
  await page.getByRole('button', { name: '关闭面板手柄' }).click();
  await expect(page.locator('.gallery-panel')).toHaveCount(0); await expect(trigger).toBeFocused();
});


test('mobile search remains inside a short viewport, traps focus, and restores its trigger after dismissal', async t => {
  const { ctx, page } = await pageFor({ viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true }); t.after(() => ctx.close()); await ready(page);
  const trigger = page.getByRole('button', { name: '搜索和筛选', exact: true });
  await trigger.tap();
  const panel = page.getByRole('dialog', { name: '搜索和筛选' });
  await expect(panel).toBeFocused();
  await expect(page.getByRole('searchbox')).not.toBeFocused();
  await expect(panel).toHaveCSS('transform', 'none');
  await panel.getByRole('button', { name: '标签：偶数', exact: true }).tap();
  await panel.locator('.date-filter summary').tap();
  await page.getByLabel('开始日期', { exact: true }).fill('2024-03-03');
  const apply = page.getByRole('button', { name: '查看 222 张照片' });
  await expect(apply).toBeVisible();
  await apply.focus(); await page.keyboard.press('Tab');
  assert(await panel.evaluate(element => element.contains(document.activeElement)));
  for (const chip of await panel.locator('.filter-chip').all()) await expect(chip).toHaveCSS('transform', 'none');
  await page.screenshot({ path: path.join(screenshots, 'search-mobile.png') });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const box = await panel.boundingBox();
  assert(box && box.x >= 0 && box.y >= 0 && box.y + box.height <= 569);
  await page.keyboard.press('Escape'); await expect(page.locator('.gallery-panel')).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('mobile search keeps its input anchored through keyboard viewport changes and content scrolling', async t => {
  const { ctx, page } = await pageFor({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  t.after(() => ctx.close()); await ready(page);
  await installSemanticFake(page);
  await page.evaluate(() => window.scrollTo(0, 600));
  const scrollY = await page.evaluate(() => window.scrollY);
  const trigger = page.getByRole('button', { name: '搜索和筛选', exact: true });
  await trigger.tap();
  const panel = page.getByRole('dialog', { name: '搜索和筛选' });
  const input = panel.getByRole('searchbox');
  await expect(panel).toBeFocused();
  await expect(input).not.toBeFocused();
  await expect(panel).toHaveCSS('transform', 'none');
  await expect(panel).toHaveCSS('filter', 'none');
  await expect(input).toHaveCSS('font-size', '16px');
  const originalPanel = (await panel.boundingBox())!;
  const originalInput = (await input.boundingBox())!;
  await input.tap(); await expect(input).toBeFocused();
  await input.fill('照片 1');
  for (const height of [524, 844, 504, 844]) {
    // Safari/Chrome normally shrink only the visual viewport for the OS keyboard.
    await page.evaluate(value => {
      Object.defineProperty(window.visualViewport!, 'height', { configurable: true, value });
      window.visualViewport!.dispatchEvent(new Event('resize'));
    }, height);
    await expect.poll(async () => {
      const box = (await panel.boundingBox())!;
      return box.y + box.height;
    }).toBeLessThanOrEqual(height - 16 + 1);
    const box = (await panel.boundingBox())!;
    assert(Math.abs(box.y - originalPanel.y) < 1, 'keyboard changes never move the panel top');
    assert(Math.abs((await input.boundingBox())!.y - originalInput.y) < 1, 'the input stays anchored');
    assert.equal(await page.evaluate(() => window.scrollY), scrollY, 'focusing search does not scroll the gallery');
  }
  // Also cover browsers configured to resize the layout viewport itself.
  await page.evaluate(() => { Reflect.deleteProperty(window.visualViewport!, 'height'); });
  await page.setViewportSize({ width: 390, height: 460 });
  await expect.poll(async () => { const box = (await panel.boundingBox())!; return box.y + box.height; }).toBeLessThanOrEqual(445);
  await panel.locator('.search-mode-metadata').evaluate(element => { element.scrollTop = element.scrollHeight; });
  assert(Math.abs((await input.boundingBox())!.y - originalInput.y) < 1, 'scrolling filters leaves search visible');
  await panel.getByRole('button', { name: '开启 AI Search', exact: true }).tap();
  const enable = panel.locator('.ai-enable-panel').first();
  await expect(enable).toBeVisible();
  assert((await enable.boundingBox())!.y >= (await panel.locator('.search-mode-stack').boundingBox())!.y, 'AI mode starts at its own top after scrolling metadata');
  await panel.getByRole('button', { name: '退出 AI Search，恢复普通搜索', exact: true }).tap();
  await page.screenshot({ path: path.join(screenshots, 'search-mobile-keyboard.png') });
  await panel.getByRole('button', { name: '关闭面板', exact: true }).tap();
  await expect(panel).toHaveCount(0); await expect(trigger).toBeFocused();
  assert.equal(await page.evaluate(() => window.scrollY), scrollY);
  await page.setViewportSize({ width: 390, height: 844 });
  await trigger.tap(); await expect(panel).toBeFocused(); await expect(input).not.toBeFocused();
  await page.keyboard.press('Escape'); await expect(panel).toHaveCount(0);
});

test('mobile drawer follows the handle and dismisses after a downward drag', async t => {
  const { ctx, page } = await pageFor({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); t.after(() => ctx.close()); await ready(page);
  await page.getByRole('button', { name: '项目信息', exact: true }).tap();
  const panel = page.getByRole('dialog', { name: '项目信息' });
  await expect(panel).toHaveCSS('transform', 'none');
  await page.screenshot({ path: path.join(screenshots, 'info-mobile.png') });
  const handle = (await page.getByRole('button', { name: '关闭面板手柄' }).boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2 + 120, { steps: 8 });
  assert(await panel.evaluate(element => new DOMMatrixReadOnly(getComputedStyle(element).transform).m42) > 0);
  await page.mouse.up(); await expect(panel).toHaveCount(0);
});

test('coincident photos expand to keyboard markers and rapid map close/reopen removes stale portals and canvases', async t => {
  const { ctx, page } = await pageFor({ reducedMotion: 'reduce' }); t.after(() => ctx.close());
  const located = photos.slice(0, 8).map(photo => ({ ...photo, video: undefined,
    location: { longitude: 114.17, latitude: 22.3 } }));
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/photos.json', route => route.fulfill({ json: located }));
  await installMapFixture(page, server.url);
  await ready(page, '?panel=map');
  await expect(page.locator('.cluster-marker[data-point-count="8"]')).toHaveCount(1);
  await page.locator('.cluster-marker').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('.photo-marker-pin')).toHaveCount(8);
  for (const pin of await page.locator('.photo-marker-pin').all()) {
    await pin.focus(); await page.keyboard.press('Enter');
    await expect(pin).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-card-kind="selected"]')).toHaveCount(1);
  }
  for (let cycle = 0; cycle < 3; cycle++) {
    await page.getByRole('button', { name: '返回项目相册', exact: true }).click();
    await expect(page.locator('.photo-map canvas, [data-card-kind]')).toHaveCount(0);
    await page.getByRole('button', { name: '地图探索', exact: true }).click();
    await expect(page.locator('.photo-map canvas')).toHaveCount(1);
  }
  await page.getByRole('button', { name: '返回项目相册', exact: true }).click();
  await expect(page.locator('.photo-marker-pin, .cluster-marker, .photo-map canvas, [data-card-kind]')).toHaveCount(0);
  assert.deepEqual(errors, []);
});

test('widely separated GPS photos fit together and filtering to zero, one and many does not leave stale map markers', async t => {
  const { ctx, page } = await pageFor({ reducedMotion: 'reduce' }); t.after(() => ctx.close());
  const locations = [[-179, -33], [179, 50], [0, 0]];
  const located = photos.slice(0, 3).map((photo, index) => ({ ...photo, video: undefined,
    location: { longitude: locations[index]![0]!, latitude: locations[index]![1]! } }));
  await page.route('**/photos.json', route => route.fulfill({ json: located }));
  await installMapFixture(page, server.url);
  await ready(page, '?panel=map');
  await expect(page.locator('.photo-marker-pin')).toHaveCount(3);
  const filter = async (query: string) => page.evaluate(query => {
    history.pushState(history.state, '', `?panel=map&query=${query}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, query);
  await filter('missing-gps-photo');
  await expect(page.getByRole('heading', { name: '没有可显示的位置' })).toBeVisible();
  await expect(page.locator('.photo-map canvas, .photo-marker-pin, .cluster-marker')).toHaveCount(0);
  await filter('照片 0');
  await expect(page.locator('.photo-marker-pin')).toHaveCount(1);
  await filter('');
  await expect(page.locator('.photo-marker-pin')).toHaveCount(3);
});
