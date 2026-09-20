import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { before, after, test } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright';
import { expect as baseExpect } from 'playwright/test';
import { buildFixture, repo } from '../website/fixture';
import { serve } from '../website/server';
import { browserReadyTimeout, softwareGPUOptions } from '../browser';
import { loadPublicPhotoCollection } from '../../src/website/public-photos';
import { resolvePhotographyStats, type PhotographyStats, type StatsDistribution } from '../../src/statistics';

const expect = baseExpect.configure({ timeout: browserReadyTimeout(5_000) });
// Stats runs alongside the other Statistics tests and can also run alongside Website.
const root = path.join(repo, '.cache/statistics-page-fixture');
const emptyRoot = path.join(repo, '.cache/statistics-empty-fixture');
let fixture: Awaited<ReturnType<typeof buildFixture>>;
let browser: Browser;
let server: Awaited<ReturnType<typeof serve>>;
let emptyServer: Awaited<ReturnType<typeof serve>>;
let photos: ReturnType<ReturnType<typeof loadPublicPhotoCollection>['listPhotos']>;

before(async () => {
  fixture = await buildFixture({ root, configure(manifest) {
    const ordinary = manifest.data.find(photo => photo.s3Key === 'ordinary.jpg')!;
    ordinary.exif = { ...ordinary.exif, DateTimeOriginal: '2023-12-31T23:30:00-12:00', Make: 'Canon', Model: 'EOS R6', LensModel: 'RF 24mm', FocalLength: '24 mm', FNumber: 8, ISO: 400, ExposureTime: '1/250' } as typeof ordinary.exif;
    ordinary.video = { type: 'motion-photo', offset: 123, size: 456, presentationTimestamp: 789 };
    const hdr = manifest.data.find(photo => photo.s3Key === 'hdr.jpg')!;
    hdr.exif = { ...hdr.exif, DateTimeOriginal: '2024-01-01T06:00:00+14:00', Make: 'SONY', Model: 'ILCE-7M4', LensModel: 'FE 85mm', FocalLength: '85 mm', FNumber: 1.8, ISO: 800, ExposureTime: '1/60' } as typeof hdr.exif;
    hdr.video = { type: 'live-photo', videoUrl: '/originals/stats-live.mov', s3Key: 'PRIVATE STATS LIVE STORAGE' };
    const portrait = manifest.data.find(photo => photo.s3Key === 'portrait.jpg')!;
    Object.assign(portrait.exif!, { PrivateStatsExif: 'PRIVATE STATS EXIF', Artist: 'PRIVATE STATS ARTIST' });
    const privatePhoto = manifest.data.find(photo => photo.s3Key === 'private.jpg')!;
    privatePhoto.exif = { Make: 'PRIVATE STATS CAMERA', Model: 'PRIVATE STATS MODEL' } as typeof privatePhoto.exif;
  }, configureProjects(projects, manifest) {
    const missing = manifest.data.find(photo => photo.s3Key === 'map-far.jpg')!;
    projects.push({ ...projects.find(project => project.status === 'published')!, id: 'fixture-missing', slug: 'fixture-missing', title: 'Fixture — missing metadata', order: 10, coverPhotoId: missing.id, photos: [{ photoId: missing.id }] });
  } });
  photos = loadPublicPhotoCollection({ directory: path.join(root, 'src/content/projects'), manifestFile: path.join(root, 'src/data/photos-manifest.json') }).listPhotos();
  server = await serve(path.join(root, 'dist'));
  await buildFixture({ root: emptyRoot, configureProjects(projects) { for (const project of projects) project.status = 'draft'; } });
  emptyServer = await serve(path.join(emptyRoot, 'dist'));
  browser = await chromium.launch(softwareGPUOptions('webgl'));
}, { timeout: 180_000 });
after(async () => { await browser?.close(); await server?.close(); await emptyServer?.close(); });

function engineStats(slug?: string) {
  const result = resolvePhotographyStats(photos, slug ? { type: 'project', slug } : { type: 'all' });
  assert(result, `Expected public fixture scope ${slug ?? 'all'}`);
  return result.stats;
}
async function pageFor(options: Parameters<Browser['newContext']>[0] = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ...options });
  ctx.setDefaultTimeout(browserReadyTimeout(10_000));
  return { ctx, page: await ctx.newPage() };
}
async function ready(page: Page, query = '', base = server.url) {
  const response = await page.goto(`${base}/stats/${query}`);
  assert.equal(response?.status(), 200);
  await expect(page.locator('[data-stats-ready]')).toHaveAttribute('data-stats-ready', 'true');
}
const chart = (page: Page, id: string) => page.locator(`[data-stats-chart="${id}"]`);
const buckets = (page: Page, id: string) => chart(page, id).locator('button[data-stats-value]');
async function overview(page: Page, stats: PhotographyStats) {
  for (const [key, value] of [['photos', stats.photoCount], ['projects', stats.projectCount], ['geotagged', stats.geotagged.count]] as const) {
    await expect(page.locator(`[data-stat="${key}"]`)).toHaveAttribute('data-value', String(value));
    assert.equal(await page.locator(`[data-stat="${key}"]`).ariaSnapshot(), `- definition: "${value}"`);
  }
  await expect(page.locator('[data-stat="date-range"]')).toBeVisible();
  await expect(page.locator('[data-stat="date-range"]')).toHaveAttribute('data-value', `${stats.captureDateRange.start ?? ''}/${stats.captureDateRange.end ?? ''}`);
}
function distributions(stats: PhotographyStats, period: 'month' | 'year' = 'month'): [string, StatsDistribution<string | number>][] {
  return [
    ['cameras', stats.cameras], ['lenses', stats.lenses], ['focal-length', stats.focalLength],
    ['aperture', stats.aperture], ['iso', stats.iso], ['shutter-speed', stats.shutterSpeed],
    ['timeline', period === 'month' ? stats.months : stats.years], ['shooting-hours', stats.shootingHours],
    ['dynamic-range', stats.dynamicRange], ['media', stats.media], ['orientation', stats.orientation],
  ];
}
async function assertCharts(page: Page, stats: PhotographyStats, period: 'month' | 'year' = 'month') {
  for (const [id, distribution] of distributions(stats, period)) {
    await expect(chart(page, id)).toBeVisible();
    await expect(chart(page, id)).toHaveAttribute('data-stats-samples', String(distribution.sampleCount));
    await expect(chart(page, id)).toHaveAttribute('data-stats-missing', String(distribution.missingCount));
    const actual = await buckets(page, id).evaluateAll(nodes => nodes.map(node => ({
      value: node.getAttribute('data-stats-value'), count: Number(node.getAttribute('data-stats-count')), percentage: Number(node.getAttribute('data-stats-percentage')),
    })));
    const expected = distribution.buckets.map(bucket => ({ ...bucket, value: String(bucket.value) }));
    const byValue = (a: { value: string | null }, b: { value: string | null }) => String(a.value).localeCompare(String(b.value));
    assert.deepEqual(actual.sort(byValue), expected.sort(byValue), `${id} must consume the Statistics Engine's aggregate buckets`);
  }
  assert(!/NaN|Infinity/.test(await page.locator('[data-stats-ready]').innerText()));
  assert.equal(await page.locator('[data-stats-ready] [style]').evaluateAll(nodes => nodes.some(node => /NaN|Infinity/.test(node.getAttribute('style') ?? ''))), false);
}
async function chooseScope(page: Page, title: string) {
  await page.getByRole('button', { name: 'Statistics scope', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Statistics scope', exact: true });
  await expect(panel).toBeVisible();
  await panel.getByRole('radio', { name: title, exact: true }).click();
  await expect(panel).toHaveCount(0);
}
async function screenshot(page: Page, filename: string) {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  });
  await page.screenshot({ path: path.join(root, filename), fullPage: true });
}

test('/stats/ defaults to All Photos and every visualization matches the unified engine', async t => {
  const { ctx, page } = await pageFor(); t.after(() => ctx.close());
  await ready(page);
  await expect(page.locator('[data-stats-scope]')).toHaveAttribute('data-stats-scope', 'all');
  await expect(page.getByRole('button', { name: 'Statistics scope', exact: true })).toContainText('All Photos');
  await expect(page.locator('select')).toHaveCount(0);
  await overview(page, engineStats());
  await assertCharts(page, engineStats());
  await page.getByRole('button', { name: 'Year', exact: true }).click();
  assert.equal(new URL(page.url()).searchParams.get('period'), 'year');
  await assertCharts(page, engineStats(), 'year');
  await page.getByRole('button', { name: 'Month', exact: true }).click();
  assert.equal(new URL(page.url()).searchParams.has('period'), false);
  await assertCharts(page, engineStats());
  await screenshot(page, 'stats-desktop.png');
});

test('one material Project selector contains only published scopes and updates the whole page', async t => {
  const { ctx, page } = await pageFor(); t.after(() => ctx.close());
  await ready(page);
  await page.getByRole('button', { name: 'Statistics scope', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Statistics scope', exact: true });
  await expect(panel).toHaveClass(/gallery-dropdown/);
  await expect(panel.getByRole('radio', { name: 'All Photos', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(panel.getByRole('radio')).toHaveCount(fixture.projects.filter(project => project.status === 'published').length + 1);
  await expect(panel).not.toContainText('DRAFT WEBSITE SECRET');
  await panel.getByRole('radio', { name: 'Fixture — ordered gallery', exact: true }).click();
  await expect(panel).toHaveCount(0);
  await expect(page).toHaveURL(/\/stats\/\?project=fixture-beta$/);
  await expect(page.locator('[data-stats-scope]')).toHaveAttribute('data-stats-scope', 'fixture-beta');
  await overview(page, engineStats('fixture-beta'));
  await expect(page.locator('[data-stat="photos"] [aria-hidden="true"]')).toHaveText(String(engineStats('fixture-beta').photoCount));
  await assertCharts(page, engineStats('fixture-beta'));
  await chooseScope(page, 'All Photos');
  await expect(page).toHaveURL(/\/stats\/$/);
  await overview(page, engineStats());
  await assertCharts(page, engineStats());
  const trigger = page.getByRole('button', { name: 'Statistics scope', exact: true });
  await trigger.focus(); await page.keyboard.press('Enter');
  await expect(panel.getByRole('radio', { name: 'All Photos', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(panel.getByRole('radio', { name: 'Fixture — ordered gallery', exact: true })).toBeFocused();
  await expect(panel.getByRole('radio', { name: 'Fixture — ordered gallery', exact: true })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Enter');
  await expect(panel).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await overview(page, engineStats('fixture-beta'));
});

test('direct Project entry, refresh, Back and Forward restore scope and chart period together', async t => {
  const { ctx, page } = await pageFor(); t.after(() => ctx.close());
  await ready(page, '?project=fixture-beta&period=year');
  await overview(page, engineStats('fixture-beta'));
  await assertCharts(page, engineStats('fixture-beta'), 'year');
  await page.reload();
  await expect(page.locator('[data-stats-scope]')).toHaveAttribute('data-stats-scope', 'fixture-beta');
  await assertCharts(page, engineStats('fixture-beta'), 'year');
  await chooseScope(page, 'Fixture — single image');
  assert.equal(new URL(page.url()).searchParams.get('project'), 'fixture-zeta');
  assert.equal(new URL(page.url()).searchParams.get('period'), 'year');
  await overview(page, engineStats('fixture-zeta'));
  await page.getByRole('button', { name: 'Month', exact: true }).click();
  await assertCharts(page, engineStats('fixture-zeta'));
  await page.goBack();
  await assertCharts(page, engineStats('fixture-zeta'), 'year');
  await page.goBack();
  await expect(page.locator('[data-stats-scope]')).toHaveAttribute('data-stats-scope', 'fixture-beta');
  await overview(page, engineStats('fixture-beta'));
  await page.goForward();
  await expect(page.locator('[data-stats-scope]')).toHaveAttribute('data-stats-scope', 'fixture-zeta');
  await overview(page, engineStats('fixture-zeta'));
  await page.goForward();
  await assertCharts(page, engineStats('fixture-zeta'));
});

test('draft, unknown, malformed and ambiguous Project URLs never become a statistics scope', async t => {
  const { ctx, page } = await pageFor(); t.after(() => ctx.close());
  for (const query of ['project=secret-draft', 'project=unknown-project', 'project=', 'project=UPPERCASE', 'project=..%2Fprivate', 'project=fixture-beta&project=fixture-alpha']) {
    await ready(page, `?${query}`);
    await expect(page.locator('[data-stats-scope]')).toHaveAttribute('data-stats-scope', 'unavailable');
    await expect(page.getByRole('heading', { name: 'Project unavailable', exact: true })).toBeVisible();
    await expect(page.locator('[data-stats-chart]')).toHaveCount(0);
    await expect(page.locator('[data-stat="photos"]')).toHaveCount(0);
    await page.getByRole('button', { name: 'All Photos', exact: true }).click();
    await expect(page).toHaveURL(/\/stats\/$/);
    await overview(page, engineStats());
  }
});

test('desktop hover and keyboard reveal details; click selection persists until Escape or scope change', async t => {
  const { ctx, page } = await pageFor(); t.after(() => ctx.close()); await ready(page);
  const cameraChart = chart(page, 'cameras');
  const first = buckets(page, 'cameras').first();
  await first.hover();
  await expect(cameraChart.getByRole('tooltip')).toBeVisible();
  await expect(cameraChart.getByRole('tooltip')).toContainText(await first.getAttribute('data-stats-value') ?? '');
  await first.click();
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.move(0, 0);
  await expect(cameraChart.getByRole('tooltip')).toBeVisible();
  await first.press('Escape');
  await expect(first).toHaveAttribute('aria-pressed', 'false');
  await expect(cameraChart.getByRole('tooltip')).toHaveCount(0);
  await first.press('Tab');

  // All five reusable visualization types expose a focusable native control.
  for (const id of ['cameras', 'focal-length', 'timeline', 'shooting-hours', 'media']) {
    const button = buckets(page, id).first();
    await button.focus();
    await expect(chart(page, id).getByRole('tooltip')).toBeVisible();
    await button.press('Enter');
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    assert(await button.getAttribute('aria-label'), `${id} exposes its value and count without hover`);
    await button.press('Escape');
    await expect(button).toHaveAttribute('aria-pressed', 'false');
  }
  const focal = buckets(page, 'focal-length').first();
  await focal.focus(); await page.keyboard.press('Space');
  await expect(focal).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Tab');
  await expect(buckets(page, 'focal-length').nth(1)).toBeFocused();
  await chooseScope(page, 'Fixture — single image');
  await expect(page.locator('[data-stats-chart] button[aria-pressed="true"]')).toHaveCount(0);
});

test('mobile tap retains selection, selector uses the existing drawer, and the page fits the viewport', async t => {
  const { ctx, page } = await pageFor({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); t.after(() => ctx.close());
  await ready(page);
  const focal = buckets(page, 'focal-length').first();
  await focal.tap();
  await expect(focal).toHaveAttribute('aria-pressed', 'true');
  await page.touchscreen.tap(2, 2);
  await expect(focal).toHaveAttribute('aria-pressed', 'true');
  await expect(chart(page, 'focal-length').getByRole('tooltip')).toBeVisible();
  await focal.tap();
  await expect(focal).toHaveAttribute('aria-pressed', 'false');
  const segment = chart(page, 'media').locator('[data-stats-segment]').first();
  await segment.tap();
  await expect(segment).toHaveAttribute('aria-pressed', 'true');
  await expect(chart(page, 'media').locator(`[data-stats-value="${await segment.getAttribute('data-stats-segment')}"]`)).toHaveAttribute('aria-pressed', 'true');
  await expect(chart(page, 'media').getByRole('tooltip')).toBeVisible();
  await page.getByRole('button', { name: 'Statistics scope', exact: true }).tap();
  const panel = page.getByRole('dialog', { name: 'Statistics scope', exact: true });
  await expect(panel).toHaveClass(/gallery-drawer/);
  await panel.getByRole('radio', { name: 'Fixture — ordered gallery', exact: true }).tap();
  await expect(panel).toHaveCount(0);
  await overview(page, engineStats('fixture-beta'));
  await assertCharts(page, engineStats('fixture-beta'));
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'Stats must not overflow horizontally on mobile');
  await screenshot(page, 'stats-mobile.png');
});

test('reduced motion disables chart transitions while retaining scope and selection interactions', async t => {
  const { ctx, page } = await pageFor({ reducedMotion: 'reduce' }); t.after(() => ctx.close()); await ready(page);
  for (const [id] of distributions(engineStats())) await expect(chart(page, id)).toHaveAttribute('data-reduced-motion', 'true');
  await chooseScope(page, 'Fixture — ordered gallery');
  await overview(page, engineStats('fixture-beta'));
  await assertCharts(page, engineStats('fixture-beta'));
  assert.equal(await page.locator('.stats-chart-fill').evaluateAll(nodes => nodes.some(node => node.getAnimations({ subtree: true }).some(animation => animation.playState === 'running'))), false);
  const media = buckets(page, 'media').first();
  await media.click();
  await expect(media).toHaveAttribute('aria-pressed', 'true');
  await expect(chart(page, 'media').getByRole('tooltip')).toBeVisible();
});

test('missing EXIF and an empty public collection render explicit, finite fallbacks', async t => {
  const { ctx, page } = await pageFor(); t.after(() => ctx.close());
  await ready(page, '?project=fixture-missing');
  const missing = engineStats('fixture-missing');
  await overview(page, missing); await assertCharts(page, missing);
  for (const id of ['cameras', 'lenses', 'focal-length', 'aperture', 'iso', 'shutter-speed', 'timeline', 'shooting-hours']) {
    await expect(chart(page, id).locator('[data-stats-empty]')).toBeVisible();
  }
  await expect(page.locator('[data-stat="date-range"]')).toContainText(/not recorded|unavailable|no recorded/i);
  await ready(page, '', emptyServer.url);
  await expect(page.getByText(/^No published photos yet\./)).toBeVisible();
  const empty = resolvePhotographyStats([], { type: 'all' })!.stats;
  await overview(page, empty); await assertCharts(page, empty);
  await expect(page.locator('[data-stats-chart] [data-stats-empty]')).toHaveCount(distributions(empty).length);
  await page.getByRole('button', { name: 'Statistics scope', exact: true }).click();
  await expect(page.getByRole('radio')).toHaveCount(1);
  await expect(page.getByRole('radio', { name: 'All Photos', exact: true })).toHaveAttribute('aria-checked', 'true');
});

test('Stats ships only aggregates and public scope metadata, with no Gallery, Viewer, Map or image-engine loading', async t => {
  const { ctx, page } = await pageFor(); t.after(() => ctx.close());
  const requests: string[] = [], errors: string[] = [];
  page.on('request', request => requests.push(new URL(request.url()).pathname));
  page.on('pageerror', error => errors.push(error.message));
  await ready(page);
  await chooseScope(page, 'Fixture — ordered gallery');
  await page.getByRole('button', { name: 'Year', exact: true }).click();
  await buckets(page, 'media').first().click();
  await expect(chart(page, 'media').getByRole('tooltip')).toBeVisible();
  await expect(page.locator('astro-island[client]')).toHaveCount(1);
  const props = await page.locator('astro-island[client]').getAttribute('props');
  assert(props);
  for (const field of ['exif', 'photos', 'capture', 's3Key', 'digest', 'regions', 'toneAnalysis', 'originalUrl', 'thumbnailUrl', 'detailsUrl', 'videoUrl', 'lastModified']) {
    assert(!props.includes(`"${field}"`), `Stats props must not contain per-photo field ${field}`);
  }
  for (const photo of fixture.manifest.data) assert(!props.includes(photo.id), 'Stats props must not serialize canonical photo IDs');
  const html = await fs.readFile(path.join(root, 'dist/stats/index.html'), 'utf8');
  for (const privateValue of ['secret-draft', 'DRAFT WEBSITE SECRET', 'PRIVATE PROJECT SUMMARY', 'PRIVATE PROJECT CAPTION', 'PRIVATE STATS EXIF', 'PRIVATE STATS ARTIST', 'PRIVATE STATS CAMERA', 'PRIVATE STATS MODEL', 'PRIVATE STATS LIVE STORAGE']) {
    assert(!html.includes(privateValue), `Stats HTML leaked ${privateValue}`);
    assert(!props.includes(privateValue), `Stats props leaked ${privateValue}`);
  }
  const unnecessary = requests.filter(url => /\/(?:originals|thumbnails|photos)\/|photos-manifest|\/projects\/[^/]+\/photos\//i.test(url)
    || /\/(?:Gallery[.-]|Viewer[.-]|GlobalMap[.-]|PhotoMap[.-]|maplibre[.-]|browser[.-]|webgpu-texture\.worker-|heic-to[.-])[^/]*\.js$/i.test(url));
  assert.deepEqual(unnecessary, [], 'Stats must not download photos, EXIF, Manifest or unrelated heavy features');
  for (const url of requests.filter(url => url.endsWith('.js'))) {
    const source = await fs.readFile(path.join(root, 'dist', url), 'utf8');
    for (const heavyMarker of ['maplibregl', 'GPUTextureUsage', '正在加载看图组件', 'exiftool-vendored', 'node:fs', '@afilmory/builder']) assert(!source.includes(heavyMarker), `${url} contains ${heavyMarker}`);
  }
  assert.deepEqual(errors, []);
});

test('Stats is a public navigation destination and server HTML provides a useful All Photos fallback', async t => {
  const { ctx, page } = await pageFor({ javaScriptEnabled: false }); t.after(() => ctx.close());
  await page.goto(server.url);
  await page.getByRole('navigation', { name: '网站导航' }).getByRole('link', { name: 'Stats', exact: true }).click();
  await expect(page).toHaveURL(/\/stats\/$/);
  await expect(page.getByRole('heading', { name: 'Photography Stats', exact: true })).toBeVisible();
  const stats = engineStats();
  for (const [key, value] of [['photos', stats.photoCount], ['projects', stats.projectCount], ['geotagged', stats.geotagged.count]] as const) {
    await expect(page.locator(`noscript [data-stat="${key}"]`)).toHaveText(String(value));
  }
  await expect(page.locator('noscript [data-stat="date-range"]')).toContainText(stats.captureDateRange.start!.slice(0, 10));
  await expect(page.locator('noscript [data-stat="date-range"]')).toContainText(stats.captureDateRange.end!.slice(0, 10));
  assert(!/NaN|Infinity/.test(await page.locator('main').innerText()));
});
