import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { copyFileSync } from 'node:fs';
import path from 'node:path';
import { before, after, test } from 'node:test';
import sharp from 'sharp';
import { chromium, type Browser } from 'playwright';
import { expect as baseExpect } from 'playwright/test';
import { buildFixture, repo } from './fixture';
import { serve } from './server';
import { browserReadyTimeout, softwareGPUOptions } from '../browser';
import { loadPublicPhotoCollection, type PublicPhotoCollection } from '../../src/website/public-photos';
import { shortPublicPhotoId } from '../../src/website/public-photo-id';
import { assertPublicOutput, publicOutputPaths } from '../../src/website/public-output';
import { loadProjects } from '../../src/projects';
import { photoDescription } from '../../src/website/seo';
import { installMapFixture, openMapPhotoList } from './map-fixture';

const expect = baseExpect.configure({ timeout: browserReadyTimeout(5_000) });
const root = path.join(repo, '.cache/photo-pages-fixture');
const dist = path.join(root, 'dist');
const origin = 'https://gallery.seo-fixture.com';
let fixture: Awaited<ReturnType<typeof buildFixture>>;
let collection: PublicPhotoCollection;
let server: Awaited<ReturnType<typeof serve>>;
let browser: Browser;
before(async () => {
  fixture = await buildFixture({ root, siteURL: origin, configure: manifest => {
    const portrait = manifest.data.find(photo => photo.s3Key === 'portrait.jpg')!;
    portrait.title = '街角 <晴天> & "Portrait"';
    portrait.digest = 'PHOTO PAGE PRIVATE DIGEST';
    portrait.regions = [{ name: 'PHOTO PAGE PRIVATE PERSON', area: null, appliedToDimensions: null }];
    Object.assign(portrait.exif!, { PrivateField: 'PHOTO PAGE PRIVATE EXIF' });
    portrait.video = { type: 'live-photo', videoUrl: '/originals/live.mp4', s3Key: 'live.mp4' };
    copyFileSync(path.join(repo, 'tests/gallery/live.mp4'), path.join(root, 'sources/live.mp4'));
    const empty = manifest.data.find(photo => photo.s3Key === 'map-far.jpg')!;
    empty.title = ''; empty.description = ''; empty.exif = null;
  } });
  collection = loadPublicPhotoCollection({ directory: path.join(root, 'src/content/projects'), manifestFile: path.join(root, 'src/data/photos-manifest.json') });
  server = await serve(dist);
  browser = await chromium.launch(softwareGPUOptions('webgl'));
}, { timeout: 120_000 });
after(async () => { await browser?.close(); await server?.close(); });

test('every public photo has one static share page with its own JPEG metadata, canonical and noindex', async t => {
  const ctx = await browser.newContext({ javaScriptEnabled: false }); t.after(() => ctx.close());
  const page = await ctx.newPage();
  const sitemap = await fs.readFile(path.join(dist, 'sitemap.xml'), 'utf8');
  const files = await fs.readdir(dist, { recursive: true });
  const photoPages = files.filter(file => /^photos\/[^/]+\/index\.html$/.test(file)).sort();
  assert.deepEqual(photoPages, collection.listPhotos().map(photo => `${photo.sharePath.slice(1)}index.html`).sort());
  assert.equal(photoPages.length, 5, 'shared memberships must not create duplicate Photo Pages');
  for (const photo of collection.listPhotos()) {
    const data = collection.getPhotoPage(photo.publicId)!;
    const response = await page.goto(`${server.url}${photo.sharePath}?photo=another&tag=ignored#ignored`);
    assert.equal(response!.status(), 200);
    const expectedTitle = `${data.title || `照片 · ${data.primaryProject.title}`} — Jason Gallery`;
    assert.equal(await page.title(), expectedTitle);
    assert.equal(await page.locator('link[rel="canonical"]').getAttribute('href'), origin + photo.sharePath);
    assert.equal(await page.locator('meta[property="og:url"]').getAttribute('content'), origin + photo.sharePath);
    assert.equal(await page.locator('meta[name="robots"]').getAttribute('content'), 'noindex, nofollow');
    for (const selector of ['meta[property="og:title"]', 'meta[name="twitter:title"]']) assert.equal(await page.locator(selector).getAttribute('content'), expectedTitle);
    for (const selector of ['meta[name="description"]', 'meta[property="og:description"]', 'meta[name="twitter:description"]']) assert.equal(await page.locator(selector).getAttribute('content'), photoDescription(data));
    for (const selector of ['meta[property="og:image"]', 'meta[name="twitter:image"]']) assert.equal(await page.locator(selector).getAttribute('content'), origin + photo.thumbnail);
    assert.equal(await page.locator('meta[property="og:image:type"]').getAttribute('content'), 'image/jpeg');
    assert.equal(await page.locator('meta[name="twitter:card"]').getAttribute('content'), 'summary_large_image');
    const image = await fetch(server.url + photo.thumbnail);
    assert.equal(image.status, 200);
    assert.equal((await sharp(Buffer.from(await image.arrayBuffer())).metadata()).format, 'jpeg');
    assert.equal(await page.locator('.photo-share-preview img').getAttribute('src'), photo.thumbnail);
    assert.equal(await page.locator('.photo-share-preview img').getAttribute('alt'), data.image.alt);
    assert.equal(await page.getByRole('link', { name: '查看原图 · Open in Viewer', exact: true }).getAttribute('href'), data.viewerHref);
    assert.equal(await page.locator('.photo-share-project a').textContent(), data.primaryProject.title);
    assert.equal(await page.locator('.photo-share-project a').getAttribute('href'), `/projects/${data.primaryProject.slug}/`);
    assert.equal(await page.locator('.photo-share h1').count(), data.title ? 1 : 0);
    assert.equal(await page.locator('.photo-share-caption').count(), data.caption ? 1 : 0);
    assert(!sitemap.includes(photo.sharePath));
    assert.equal(await page.locator('astro-island, .photo-dialog, .photo-map, .viewer-inspector, .filmstrip, canvas').count(), 0);
    const html = await response!.text();
    for (const absent of ['PHOTO PAGE PRIVATE', 'DateTimeOriginal', 'GPSLatitude', 'toneAnalysis', 'detailsUrl', 'data-photo-gallery', photo.src]) assert(!html.includes(absent), absent);
  }
  assert.match(await fs.readFile(path.join(dist, '_headers'), 'utf8'), /\/photos\/\*\n  X-Robots-Tag: noindex, nofollow/);
});

const captureShare = `
  window.shareCalls = []; window.copyCalls = [];
  window.shareFailure = ''; window.copyFailure = false;
  Object.defineProperty(navigator, 'share', { configurable: true, value: async data => {
    window.shareCalls.push(data);
    if (window.shareFailure) throw new DOMException('Fixture share failure', window.shareFailure);
  } });
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async url => {
    window.copyCalls.push(url);
    if (window.copyFailure) throw new Error('Fixture clipboard failure');
  } } });
`;
interface ShareCapture { shareCalls: ShareData[]; copyCalls: string[]; shareFailure: string; copyFailure: boolean; }

for (const mobile of [false, true]) test(`${mobile ? 'Web Share' : 'Copy Link'} uses the same Photo Page from Project, other Project, Explore and Map without changing browsing history`, async t => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: mobile ? 390 : 1280, height: 900 }, isMobile: mobile, hasTouch: mobile });
  t.after(() => ctx.close()); await ctx.addInitScript({ content: captureShare });
  const page = await ctx.newPage(); await installMapFixture(page, server.url);
  const photo = collection.listPhotos()[0]!;
  const shareURL = server.url + photo.sharePath;
  const query = '?camera=NIKON+Z6&sort=desc&view=list&tracking=keep#gallery';
  for (const route of ['/projects/fixture-beta/', '/projects/fixture-alpha/', '/explore/', '/map/']) {
    await page.goto(server.url + route + query);
    await expect(page.locator('[data-photo-gallery]')).toHaveAttribute('data-enhanced', 'true');
    assert.equal(await page.locator('a[href^="/photos/"]').count(), 0, 'normal browsing has no Photo Page entry');
    if (route === '/map/') {
      await expect(page.locator('.photo-map')).toHaveAttribute('data-map-state', 'ready');
      await openMapPhotoList(page); await page.locator('.map-photo-list button').click();
    } else await page.locator('.gallery-live [data-gallery-index]').first().click();
    await expect(page.locator('.photo-dialog')).toHaveAttribute('data-mobile', String(mobile));
    const browsingURL = page.url();
    assert.equal(new URL(browsingURL).searchParams.get('photo'), photo.id);
    const history = await page.evaluate(() => ({ length: window.history.length, state: window.history.state }));
    const collectionTitle = await page.locator('.gallery-live .gallery-header h1').textContent();
    const share = page.getByRole('button', { name: '分享照片', exact: true });
    if (mobile) await share.tap(); else await share.click();
    if (mobile) {
      await expect.poll(() => page.evaluate(() => (window as unknown as ShareCapture).shareCalls)).toEqual([{ title: `${photo.title} — ${collectionTitle}`, url: shareURL }]);
    } else {
      await expect.poll(() => page.evaluate(() => (window as unknown as ShareCapture).copyCalls)).toEqual([shareURL]);
      await expect(page.locator('.viewer-message')).toHaveText('照片链接已复制');
      assert.deepEqual(await page.evaluate(() => (window as unknown as ShareCapture).shareCalls), []);
    }
    assert.equal(page.url(), browsingURL);
    assert.deepEqual(await page.evaluate(() => ({ length: window.history.length, state: window.history.state })), history);
    await page.goBack(); await expect(page.locator('.photo-dialog')).toHaveCount(0);
    assert.equal(page.url(), server.url + route + query);
    await page.goForward(); await expect(page.locator('.photo-dialog')).toBeVisible();
    assert.equal(page.url(), browsingURL);
    const close = page.getByRole('button', { name: '关闭照片', exact: true });
    if (mobile) await close.tap(); else await close.click();
    await expect(page.locator('.photo-dialog')).toHaveCount(0);
    assert.equal(page.url(), server.url + route + query);
  }
});

test('share cancellation, unavailable APIs and rejected clipboard/native sharing retain the existing fallback', async t => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  t.after(() => ctx.close()); await ctx.addInitScript({ content: captureShare });
  const page = await ctx.newPage();
  const photo = collection.listPhotos()[0]!;
  const viewerHref = collection.getPhotoPage(photo.publicId)!.viewerHref;
  await page.goto(server.url + viewerHref); await expect(page.locator('.photo-dialog')).toHaveAttribute('data-mobile', 'true');
  const browsingURL = page.url();
  await page.evaluate(() => { (window as unknown as ShareCapture).shareFailure = 'AbortError'; });
  await page.getByRole('button', { name: '分享照片', exact: true }).tap();
  await expect.poll(() => page.evaluate(() => (window as unknown as ShareCapture).shareCalls.length)).toBe(1);
  assert.equal(await page.locator('.viewer-message').count(), 0);
  await page.evaluate(() => { (window as unknown as ShareCapture).shareFailure = 'NotAllowedError'; });
  await page.getByRole('button', { name: '分享照片', exact: true }).tap();
  await expect(page.locator('.viewer-message')).toHaveText(server.url + photo.sharePath);
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    (window as unknown as ShareCapture).copyFailure = true;
  });
  await page.getByRole('button', { name: '分享照片', exact: true }).tap();
  await expect.poll(() => page.evaluate(() => (window as unknown as ShareCapture).copyCalls)).toEqual([server.url + photo.sharePath]);
  await expect(page.locator('.viewer-message')).toHaveText(server.url + photo.sharePath);
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }));
  await page.getByRole('button', { name: '分享照片', exact: true }).tap();
  await expect(page.locator('.viewer-message')).toHaveText(server.url + photo.sharePath);
  assert.equal(page.url(), browsingURL);
});

test('Photo Page enters the primary Project Viewer, retains media/metadata/navigation and returns with Back', async t => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1280, height: 900 } });
  t.after(() => ctx.close()); await ctx.addInitScript({ content: captureShare + `
    Object.defineProperty(navigator, 'gpu', { configurable: true, value: undefined });
    const nativeContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(kind, ...args) {
      return ['webgl', 'webgl2', 'experimental-webgl'].includes(kind) && this.closest('.viewer-drag-content')
        ? null : nativeContext.call(this, kind, ...args);
    };
  ` });
  const page = await ctx.newPage(); await installMapFixture(page, server.url);
  const photo = collection.listPhotos()[0]!;
  const data = collection.getPhotoPage(photo.publicId)!;
  const metadata: string[] = [];
  page.on('request', request => { if (/\/photos\/[^/]+\.json$/.test(request.url())) metadata.push(request.url()); });
  await page.goto(server.url + data.path);
  assert.deepEqual(metadata, []);
  const historyLength = await page.evaluate(() => history.length);
  await page.getByRole('link', { name: '查看原图 · Open in Viewer', exact: true }).click();
  await expect(page.locator('.viewer-media')).toHaveAttribute('data-media-state', 'loaded');
  assert.equal(page.url(), server.url + data.viewerHref);
  assert.equal(data.primaryProject.slug, 'fixture-beta');
  assert.equal(await page.evaluate(() => history.length), historyLength + 1);
  assert.deepEqual(await page.locator('[data-filmstrip-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-filmstrip-id'))), fixture.photos.map(photo => photo.photoId));
  await expect(page.locator('.swiper-slide-active')).toHaveAttribute('data-photo-id', photo.id);
  await page.getByRole('button', { name: '放大', exact: true }).click();
  await expect.poll(() => page.locator('.viewer-fallback').evaluate(image => new DOMMatrixReadOnly(getComputedStyle(image).transform).a)).toBeGreaterThan(1);
  await page.getByRole('button', { name: '适应屏幕', exact: true }).click();
  await expect.poll(() => page.locator('.viewer-fallback').evaluate(image => new DOMMatrixReadOnly(getComputedStyle(image).transform).a)).toBe(1);
  await page.getByRole('button', { name: '照片信息', exact: true }).click();
  await expect(page.locator('.metadata-content')).toContainText('Fixture artist');
  await expect(page.locator('.viewer-minimap')).toHaveAttribute('data-map-state', 'ready', { timeout: browserReadyTimeout(15_000) });
  assert.deepEqual(metadata, [server.url + photo.detailsUrl]);
  await page.getByRole('button', { name: '照片信息', exact: true }).click();
  await page.getByRole('button', { name: '下一张照片', exact: true }).click();
  await expect(page.locator('.viewer-media')).toHaveAttribute('data-media-state', 'loaded');
  const hdr = collection.getPhoto(fixture.photos[1]!.photoId)!;
  await expect(page.locator('.swiper-slide-active')).toHaveAttribute('data-photo-id', hdr.id);
  await expect(page.locator('.hdr-status')).toHaveText('HDR source');
  await page.getByRole('button', { name: '分享照片', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as ShareCapture).copyCalls)).toEqual([server.url + hdr.sharePath]);
  await page.getByRole('button', { name: '上一张照片', exact: true }).click();
  await expect(page.locator('.viewer-counter')).toHaveText('1 / 3');
  await page.keyboard.press('End'); await expect(page.locator('.viewer-counter')).toHaveText('3 / 3');
  assert.equal(await page.evaluate(() => history.length), historyLength + 1, 'paging replaces the Project entry');
  const lastViewerURL = page.url();
  await page.goBack(); await expect(page.locator('.photo-share')).toBeVisible();
  assert.equal(page.url(), server.url + data.path);
  await page.goForward(); await expect(page.locator('.viewer-counter')).toHaveText('3 / 3');
  assert.equal(page.url(), lastViewerURL);
  await page.reload(); await expect(page.locator('.viewer-counter')).toHaveText('3 / 3');
  await page.getByRole('button', { name: '关闭照片', exact: true }).click();
  await expect(page.locator('.photo-dialog')).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.mouse.move(0, 0);
  const live = page.locator(`.gallery-live [data-photo-id="${photo.id}"]`);
  await expect(live.locator('.live-photo-badge')).toHaveAttribute('data-state', 'ready');
  await live.hover(); await expect(live.locator('video')).toHaveAttribute('data-playing', 'true');
  await page.mouse.move(0, 0); await expect(live.locator('video')).toHaveAttribute('data-playing', 'false');
  await page.goBack(); await expect(page.locator('.photo-share')).toBeVisible();
  assert.equal(page.url(), server.url + data.path);
});

test('draft-only, unused, raw internal IDs and guessed short URLs return 404 and stay outside the output whitelist', async () => {
  for (const photo of fixture.manifest.data.filter(photo => ['private.jpg', 'unused.jpg'].includes(photo.s3Key))) {
    for (const route of [`/photos/${shortPublicPhotoId(photo.id)}/`, `/photos/${encodeURIComponent(photo.id)}/`, photo.thumbnailUrl, photo.originalUrl]) {
      assert.equal((await fetch(server.url + route)).status, 404, route);
    }
  }
  for (const route of ['/photos/AAAAAAAAAAAAAAAA/', `/photos/${collection.listPhotos()[0]!.id}/`, `/photos/${collection.listPhotos()[0]!.publicId}.json`]) assert.equal((await fetch(server.url + route)).status, 404, route);
  const projects = loadProjects({ directory: path.join(root, 'src/content/projects'), manifestFile: path.join(root, 'src/data/photos-manifest.json') }).listProjects();
  const files = (await fs.readdir(dist, { recursive: true, withFileTypes: true })).filter(entry => entry.isFile()).map(entry => path.relative(dist, path.join(entry.parentPath, entry.name)));
  assertPublicOutput(files, publicOutputPaths(projects), true);
  for (const file of files.filter(file => /\.(html|js|json)$/.test(file))) {
    const body = await fs.readFile(path.join(dist, file), 'utf8');
    assert(!/PHOTO PAGE PRIVATE|DRAFT WEBSITE SECRET|PRIVATE PROJECT CAPTION/.test(body), file);
  }
});

test('minimal Photo Page uses existing chrome, handles missing fields and opens the correct existing Viewer', async t => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1280, height: 900 } }); t.after(() => ctx.close());
  const page = await ctx.newPage();
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const photo = collection.listPhotos()[0]!;
  const requests: string[] = []; page.on('request', request => requests.push(request.url()));
  await page.goto(server.url + photo.sharePath);
  await expect(page.locator('.photo-share-preview img')).toBeVisible();
  assert.equal(await page.locator('.photo-share h1').textContent(), photo.title);
  assert.equal(await page.locator('.photo-share-facts').innerText(), '日期\n2024-03-02\nCamera\nNIKON Z6\nLens\n35mm');
  assert.equal(await page.locator('.photo-share-preview img').evaluate(image => (image as HTMLImageElement).naturalWidth > 0), true);
  assert.equal(await page.locator('body').evaluate(element => getComputedStyle(element).fontFamily.includes('Geist')), true);
  assert.equal(await page.locator('.photo-share-open').evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(0, 122, 255)');
  assert(!requests.some(url => /\/originals\/|\/photos\/[^/]+\.json|PhotoViewer|PhotoGallery/.test(url)), 'landing page must not load the Viewer or details');
  await fs.mkdir(path.join(root, 'screenshots'), { recursive: true });
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no horizontal overflow at ${width}px`);
    const preview = await page.locator('.photo-share-preview img').boundingBox();
    assert(preview && Math.abs(preview.width / preview.height - photo.width / photo.height) < 0.01, 'uncropped photo ratio');
    await page.locator('.photo-share-open').focus();
    await expect(page.locator('.photo-share-open')).toBeFocused();
    assert.equal(await page.locator('.photo-share-open').evaluate(element => getComputedStyle(element).outlineStyle), 'solid');
    await page.screenshot({ path: path.join(root, `screenshots/photo-page-${width}.png`), fullPage: true });
  }
  await page.locator('summary[aria-label="网站导航"]').click();
  assert.deepEqual(await page.locator('.site-navigation a').allTextContents(), ['Projects', 'Explore', 'Map']);
  await page.locator('summary[aria-label="网站导航"]').click();
  await page.getByRole('link', { name: '查看原图 · Open in Viewer', exact: true }).click();
  await expect(page.locator('.photo-dialog')).toBeVisible();
  assert.equal(new URL(page.url()).searchParams.get('photo'), photo.id);
  assert.equal(new URL(page.url()).pathname, `/projects/${photo.projects[0]!.slug}/`);
  await expect(page.locator('.viewer-counter')).toHaveText('1 / 3');
  const empty = fixture.manifest.data.find(photo => photo.s3Key === 'map-far.jpg')!;
  await page.goBack(); await expect(page.locator('.photo-share')).toBeVisible();
  assert.equal(page.url(), server.url + photo.sharePath);
  await page.goForward(); await expect(page.locator('.viewer-counter')).toHaveText('1 / 3');
  await page.goto(server.url + collection.getPhoto(empty.id)!.sharePath);
  assert.equal(await page.locator('.photo-share h1, .photo-share-caption, .photo-share-facts').count(), 0);
  await expect(page.getByRole('link', { name: '查看原图 · Open in Viewer', exact: true })).toBeVisible();
  const landscape = fixture.manifest.data.find(photo => photo.s3Key === 'ordinary.jpg')!;
  await page.goto(server.url + collection.getPhoto(landscape.id)!.sharePath);
  assert.equal(await page.locator('.photo-share-caption').textContent(), '<script>fixture caption is plain text</script>');
  assert.equal(await page.locator('.photo-share-caption script').count(), 0);
  assert.equal(await page.locator('script').filter({ hasText: 'fixture caption is plain text' }).count(), 0);
  assert.deepEqual(errors, []);
});
