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
    id: `photo-${i}`, title: `照片 ${i} — 完整标题`, alt: `Gallery photo ${i}`, filename: `${i}.jpg`, description: '这是一段照片说明。第二句说明帮助检查两行截断。',
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
async function ready(page: Page, query = '') {
  await page.goto(server.url + query);
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
  await expect(page.locator('.photo-map')).toHaveAttribute('data-map-state', 'ready', { timeout: browserReadyTimeout(15_000) });
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
  await expect(page.locator('.photo-map')).toHaveAttribute('data-map-state', 'ready', { timeout: browserReadyTimeout(15_000) });
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

test('48px progressive header and safe-area mobile actions remain usable at narrow widths', async t => {
  const { ctx, page } = await pageFor({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); t.after(() => ctx.close()); await ready(page);
  await expect(page.locator('.gallery-header-content')).toHaveCSS('height', '48px');
  await expect(page.locator('.gallery-header')).toHaveCSS('z-index', '30');
  assert.equal(await page.locator('.linear-blur-layer').count(), 8);
  for (const width of [320,390,768,1023]) {
    await page.setViewportSize({ width, height: 844 });
    for (const name of ['搜索和筛选','显示设置','项目信息']) {
      const button = page.getByRole('button', { name, exact: true });
      await expect.poll(async () => {
        const box = await button.boundingBox();
        return !!box && box.x >= 0 && box.x + box.width <= width && box.y >= 0 && box.y + box.height <= 48;
      }, { message: `${name} must stay inside the ${width} × 844 viewport after resize` }).toBe(true);
    }
    await expect(page.locator('.gallery-header .view-segment')).toHaveCount(0);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await page.getByRole('button', { name: '显示设置' }).tap();
  await page.getByRole('button', { name: '列表视图' }).tap();
  await page.getByRole('button', { name: '关闭面板', exact: true }).tap();
  await expect(page.locator('.list-card').first()).toBeVisible();
  await page.getByRole('button', { name: '搜索和筛选' }).tap();
  await page.locator('.palette-actions summary').tap();
  await page.getByRole('button', { name: '地图探索', exact: true }).tap();
  await expect(page.getByRole('dialog', { name: '地图探索', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^(关闭面板|返回项目相册)$/, exact: true }).tap();
  await page.setViewportSize({ width: 1024, height: 844 });
  await expect(page.locator('.gallery-header .view-segment')).toBeVisible();
  await expect(page.getByRole('button', { name: '地图探索', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '瀑布流' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(cards(page).first()).toBeVisible();
  await page.screenshot({ path: path.join(screenshots, 'mobile.png') });
  await page.getByRole('button', { name: '项目信息' }).tap();
  await expect(page.getByRole('dialog', { name: '项目信息' })).toContainText('Project — 长标题');
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
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
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
  await expect(page.getByRole('searchbox')).toBeFocused();
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
  await page.keyboard.press('Escape'); await expect(panel).toHaveCount(0);
  await expect(trigger).toBeFocused();
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
