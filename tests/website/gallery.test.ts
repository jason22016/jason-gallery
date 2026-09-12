import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { before, after, test } from 'node:test';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { expect } from 'playwright/test';
import { serve } from './server';
import { repo, run } from './fixture';
import { softwareGPUOptions } from '../browser';
import { jpeg } from '../../scripts/photos/fixtures';
import type { GalleryPhoto } from '../../src/components/gallery/photos';
import { rgbaToThumbHash } from 'thumbhash';
import sharp from 'sharp';

let browser: Browser;
let server: Awaited<ReturnType<typeof serve>>;
let photos: GalleryPhoto[];
const root = path.join(repo, '.cache/gallery-fixture');
const screenshots = path.join(repo, 'reports/gallery');
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
  ctx.setDefaultTimeout(10000);
  const page = await ctx.newPage();
  return { ctx, page };
}
async function ready(page: Page, query = '') {
  await page.goto(server.url + query);
  await expect(page.locator('.masonry-photo').first()).toBeVisible();
  await expect(page.locator('.masonry-photo').first().locator('img')).toHaveCSS('opacity', '1');
}
const cards = (page: Page) => page.locator('.masonry-photo');
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
  await page.getByLabel('瀑布流列数').selectOption('8');
  await page.getByRole('button', { name: '关闭面板' }).click();
  await expect.poll(async () => new Set((await geometry(page)).filter(p => p.y === 52).map(p => p.x)).size).toBe(6);
  await page.getByRole('button', { name: '显示设置' }).click();
  await page.getByLabel('瀑布流列数').selectOption('1');
  await page.getByRole('button', { name: '关闭面板' }).click();
  await expect.poll(async () => new Set((await geometry(page)).filter(p => p.y === 52).map(p => p.x)).size).toBe(2);
  await page.getByRole('button', { name: '列表视图' }).click();
  await expect(page.locator('.masonry-photo')).toHaveCount(0);
  await expect(page.locator('.photo-list > li')).toHaveCount(480);
  assert.equal(new URL(page.url()).searchParams.get('view'), 'list');
  await page.reload(); await expect(page.locator('.photo-list > li')).toHaveCount(480);
  await page.getByRole('button', { name: '瀑布流' }).click();
  await page.getByRole('button', { name: '搜索和筛选' }).click();
  await page.getByLabel('标签', { exact: true }).selectOption('偶数');
  await page.getByRole('button', { name: '查看 240 张照片' }).click();
  await expect(page.locator('.gallery-count')).toHaveText('240');
  assert((await geometry(page)).every(p => Number(p.id!.slice(6)) % 2 === 0));
  await page.getByRole('button', { name: '显示设置' }).click();
  await page.getByLabel('照片排序').selectOption('desc');
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
  await expect(card.locator('img')).toHaveCSS('transform', 'matrix(1.05, 0, 0, 1.05, 0, 0)');
  await expect(card.locator('img')).toHaveCSS('transition-duration', '0.3s, 0.3s');
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
  await card.hover(); await expect(card.locator('img')).toHaveCSS('transform', 'none');
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
    for (const name of ['瀑布流','列表视图','搜索和筛选','地图探索','显示设置','项目信息']) {
      const button = page.getByRole('button', { name, exact: true });
      await expect.poll(async () => {
        const box = await button.boundingBox();
        return !!box && box.x >= 0 && box.x + box.width <= width && box.y >= 0 && box.y + box.height <= 844;
      }, { message: `${name} must stay inside the ${width} × 844 viewport after resize` }).toBe(true);
    }
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
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
