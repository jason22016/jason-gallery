import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
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
