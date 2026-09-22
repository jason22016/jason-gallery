import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { before, after, test } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright';
import { expect as baseExpect } from 'playwright/test';
import { buildFixture, repo } from './fixture';
import { serve } from './server';
import { installMapFixture } from './map-fixture';
import { browserReadyTimeout, softwareGPUOptions } from '../browser';
import { shortPublicPhotoId } from '../../src/website/public-photo-id';

const expect = baseExpect.configure({ timeout: browserReadyTimeout(5_000) });
const root = path.join(repo, '.cache/global-release-fixture');
let browser: Browser;
let server: Awaited<ReturnType<typeof serve>>;
let fixture: Awaited<ReturnType<typeof buildFixture>>;
before(async () => {
  fixture = await buildFixture({ root, configure: manifest => {
    const photo = manifest.data.find(photo => photo.s3Key === 'portrait.jpg')!;
    photo.digest = 'RELEASE PRIVATE DIGEST';
    photo.regions = [{ name: 'RELEASE PRIVATE PERSON', area: null, appliedToDimensions: null }];
    Object.assign(photo.exif!, { ReleasePrivateField: 'RELEASE PRIVATE EXIF' });
    manifest.data.push(...Array.from({ length: 160 }, (_, index) => ({ ...photo, id: `release-${index}`, tags: [index % 2 ? 'odd' : 'even'] })));
  }, configureProjects: (projects, manifest) => {
    for (const project of projects.filter(project => project.status === 'published')) {
      project.photos.push(...manifest.data.filter(photo => photo.id.startsWith('release-')).map(photo => ({ photoId: photo.id })));
    }
  } });
  server = await serve(path.join(root, 'dist'));
  browser = await chromium.launch(softwareGPUOptions('webgl'));
}, { timeout: 120_000 });
after(async () => { await browser?.close(); await server?.close(); });
async function pageFor() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  page.setDefaultTimeout(browserReadyTimeout(10_000));
  await installMapFixture(page, server.url);
  return { ctx, page };
}
async function ready(page: Page) {
  await expect(page.locator('[data-photo-gallery]')).toHaveAttribute('data-enhanced', 'true');
  await expect(page.locator('.gallery-live [data-gallery-index]').first()).toBeVisible();
}

test('production Gallery preserves deep scroll through refresh and cross-page Explore / Map / Projects history', async t => {
  const { ctx, page } = await pageFor(); t.after(() => ctx.close());
  for (const route of ['/explore/', '/projects/fixture-beta/']) {
    await page.goto(`${server.url}${route}?tag=even&view=list`); await ready(page);
    await page.evaluate(() => scrollTo(0, 4000));
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(4000);
    await page.reload(); await ready(page);
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(4000);
    await page.locator('.gallery-live summary[aria-label="网站导航"]').click();
    await page.locator('.gallery-live .site-navigation').getByRole('link', { name: 'Map', exact: true }).click();
    await expect(page.locator('.photo-map')).toHaveAttribute('data-map-state', 'ready');
    await page.goBack(); await ready(page);
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(4000);
    await page.goForward();
    await expect(page.locator('.photo-map')).toHaveAttribute('data-map-state', 'ready');
    await page.goBack(); await ready(page);
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(4000);
  }
});

test('production global pages add no metadata copies and cannot expose private details through alternate routes', async () => {
  const files = await fs.readdir(path.join(root, 'dist'), { recursive: true });
  const published = fixture.projects.filter(project => project.status === 'published');
  assert.deepEqual(
    files.filter(file => file.startsWith('semantic/')).sort(),
    ['semantic/index.json', 'semantic/vectors.f32'],
  );
  assert.equal(
    files.filter(file => file.endsWith('.json') && file !== 'semantic/index.json' && !file.startsWith('semantic-models/') && !file.startsWith('semantic-runtimes/')).length,
    published.reduce((count, project) => count + project.photos.length, 0),
  );
  for (const file of files.filter(file => /\.(?:html|js|json)$/.test(file))) {
    const body = await fs.readFile(path.join(root, 'dist', file), 'utf8');
    for (const value of ['RELEASE PRIVATE DIGEST', 'RELEASE PRIVATE PERSON', 'RELEASE PRIVATE EXIF', 'DRAFT WEBSITE SECRET', 'PRIVATE PROJECT CAPTION']) assert(!body.includes(value), `${file}: ${value}`);
  }
  for (const photo of fixture.manifest.data.filter(photo => ['private.jpg', 'unused.jpg'].includes(photo.s3Key))) {
    for (const route of [`/photos/${photo.id}.json`, `/projects/fixture-beta/photos/${photo.id}.json`, `/projects/secret-draft/photos/${photo.id}.json`]) assert.equal((await fetch(server.url + route)).status, 404);
  }
  assert.equal((await fetch(`${server.url}/photos/release-0.json`)).status, 404, 'Global pages reuse the published Project route rather than emitting a duplicate');
  assert.equal((await fetch(`${server.url}/projects/fixture-beta/photos/release-0.json`)).status, 200);
});

test('ordinary Home, Project, Explore, Map, Stats, Cmd+K and Viewer paths never load semantic assets', async t => {
  const { ctx, page } = await pageFor(); t.after(() => ctx.close());
  const requests: string[] = [];
  page.on('request', request => requests.push(new URL(request.url()).pathname));
  for (const route of ['/', '/projects/fixture-beta/', '/explore/', '/map/', '/stats/']) {
    await page.goto(server.url + route);
    if (route === '/explore/' || route.startsWith('/projects/')) await ready(page);
  }
  await page.goto(`${server.url}/explore/`); await ready(page);
  await page.keyboard.press('Meta+K');
  await expect(page.getByRole('dialog', { name: '搜索和筛选' })).toBeVisible();
  await page.getByRole('button', { name: '开启 AI Search' }).click();
  await expect(page.getByRole('heading', { name: 'Enable AI Search' })).toBeVisible();
  assert.deepEqual(requests.filter(pathname => /^\/(?:semantic|semantic-models|semantic-releases|semantic-runtimes)\//.test(pathname) || /\/semantic-search(?:\.worker)?[-.].+\.js$/.test(pathname)), [], 'opening Cmd+K and entering AI mode must not fetch or preload any semantic asset/client/Worker chunk');
  await page.keyboard.press('Escape');
  await page.locator('.gallery-live [data-gallery-index]').first().click();
  await expect(page.locator('.photo-dialog')).toBeVisible();
  assert.deepEqual(requests.filter(pathname => /^\/(?:semantic|semantic-models|semantic-releases|semantic-runtimes)\//.test(pathname) || /\/semantic-search(?:\.worker)?[-.].+\.js$/.test(pathname)), []);

  const files = await fs.readdir(path.join(root, 'dist/_astro'));
  assert(files.some(file => /^semantic-search\..+\.js$/.test(file)), 'AI Search must ship as a separately loadable client chunk');
  assert(files.some(file => /^semantic-search\.worker-.+\.js$/.test(file)), 'the shared semantic worker must remain in its own lazy chunk');
  assert.equal(files.some(file => /ort-wasm/i.test(file)), false, 'the ORT WASM runtime must remain an explicit immutable asset');
  for (const file of (await fs.readdir(path.join(root, 'dist'), { recursive: true })).filter(file => file.endsWith('.html'))) {
    const html = await fs.readFile(path.join(root, 'dist', file), 'utf8');
    assert.equal(/semantic-search(?:\.worker)?[-.].+\.js/.test(html), false, `${file}: semantic chunks must not be preloaded by ordinary HTML`);
  }
});

test('production Project pages expose AI Search with canonical project scope after Astro hydration', async t => {
  const { ctx, page } = await pageFor(); t.after(() => ctx.close());
  const fake = await fs.readFile(path.join(repo, 'tests/gallery/semantic-fake.js'), 'utf8');
  const { photoIds } = JSON.parse(await fs.readFile(path.join(root, 'dist/semantic/index.json'), 'utf8')) as { photoIds: string[] };
  for (const project of fixture.projects.filter(project => project.status === 'published')) {
    await page.goto(`${server.url}/projects/${project.slug}/`); await ready(page);
    await page.keyboard.press('Meta+K');
    const dialog = page.getByRole('dialog', { name: '搜索和筛选' });
    await dialog.getByRole('button', { name: '开启 AI Search' }).click();
    await expect(dialog.getByRole('heading', { name: 'Enable AI Search' })).toBeVisible();
    await page.evaluate(`${fake}\n;globalThis.installSemanticFake(${JSON.stringify(photoIds)}, 'cache');`);
    await page.evaluate(ids => {
      (window as any).semanticFake.resultSets['项目检索'] = ids.map((publicId, index) => ({ publicId, rank: index + 1, score: .1 }));
    }, photoIds);
    await dialog.getByRole('button', { name: 'Download & Enable' }).click();
    const input = dialog.getByRole('searchbox', { name: 'AI Search 自然语言搜索' });
    await expect(input).toBeEnabled();
    await input.fill('项目检索');
    await expect(dialog.getByRole('button', { name: '查看这 60 张照片' })).toBeVisible();
    assert.deepEqual(await page.evaluate(() => (window as any).semanticFake.queryOptions.at(-1)?.scopePhotoIds), project.photos.map(photo => shortPublicPhotoId(photo.photoId)));
    await expect(page.locator('.gallery-live .gallery-count')).toHaveText('60');
  }
});

test('history restores absent view settings and filter edits never add entries', async t => {
  const { ctx, page } = await pageFor(); t.after(() => ctx.close());
  await page.goto(`${server.url}/explore/?tag=even#kept`); await ready(page);
  await page.evaluate(() => { history.pushState(null, '', '?tag=odd&view=list&columns=3#kept'); dispatchEvent(new PopStateEvent('popstate')); });
  await expect(page.locator('.list-view')).toBeVisible();
  await page.goBack();
  await expect(page.locator('.masonry-grid')).toBeVisible();
  await page.goForward(); await expect(page.locator('.list-view')).toBeVisible();
  const historyLength = await page.evaluate(() => history.length);
  await page.getByRole('button', { name: '搜索和筛选', exact: true }).click();
  const panel = page.getByRole('dialog', { name: '搜索和筛选' });
  await panel.getByRole('searchbox').fill('街角');
  await panel.getByRole('searchbox').fill('街角 Portrait');
  await panel.getByRole('button', { name: '查看 80 张照片', exact: true }).click();
  assert.equal(await page.evaluate(() => history.length), historyLength);
  assert.equal(new URL(page.url()).hash, '#kept');
});

test('mobile masonry restores the underlying scroll after refreshing an open Viewer', async t => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  t.after(() => ctx.close());
  const page = await ctx.newPage();
  await page.goto(`${server.url}/explore/?tag=even`); await ready(page);
  await page.evaluate(() => scrollTo(0, 3000));
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(3000);
  // Scroll position updates before the virtualized window has rendered its cards.
  let index: string | null | undefined;
  await expect.poll(async () => {
    index = await page.locator('.gallery-live [data-gallery-index]').evaluateAll(nodes => nodes.find(node => {
      const rect = node.getBoundingClientRect(); return rect.top >= 100 && rect.bottom < innerHeight - 20;
    })?.getAttribute('data-gallery-index'));
    return index;
  }, { message: 'a fully visible photo must render at the restored scroll position' }).toBeTruthy();
  await page.locator(`.gallery-live [data-gallery-index="${index}"]`).tap();
  await expect(page.locator('.photo-dialog')).toBeVisible();
  await page.reload(); await expect(page.locator('.photo-dialog')).toBeVisible();
  await page.getByRole('button', { name: '关闭照片', exact: true }).tap();
  await expect(page.locator('.photo-dialog')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(3000);
  assert.equal(new URL(page.url()).search, '?tag=even');
});

test('repeated activation creates one Viewer entry; paging replaces it and close returns to the filtered origin', async t => {
  const { ctx, page } = await pageFor(); t.after(() => ctx.close());
  await page.goto(`${server.url}/explore/?tag=even&sort=asc&tracking=kept#anchor`); await ready(page);
  const origin = page.url(), historyLength = await page.evaluate(() => history.length);
  await page.locator('.gallery-live [data-gallery-index]').first().evaluate(element => { (element as HTMLElement).click(); (element as HTMLElement).click(); });
  await expect(page.locator('.viewer-counter')).toHaveText('1 / 80');
  assert.equal(await page.evaluate(() => history.length), historyLength + 1);
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.viewer-counter')).toHaveText('2 / 80');
  assert.equal(await page.evaluate(() => history.length), historyLength + 1);
  await page.getByRole('button', { name: '关闭照片', exact: true }).click();
  await expect(page.locator('.photo-dialog')).toHaveCount(0);
  assert.equal(page.url(), origin);
  await page.goForward(); await expect(page.locator('.viewer-counter')).toHaveText('2 / 80');
});

test('plain production builds remove stale public assets and reject accidental Manifest/metadata copies before emitting them', async () => {
  const build = () => spawnSync(process.execPath, [path.join(repo, 'node_modules/astro/bin/astro.mjs'), 'build'], {
    cwd: root, encoding: 'utf8', timeout: 90_000, env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1' },
  });
  const stale = path.join(root, 'public/thumbnails/removed-photo.jpg');
  await fs.writeFile(stale, 'STALE PHOTO');
  const clean = build(); assert.equal(clean.status, 0, clean.stdout + clean.stderr);
  await assert.rejects(fs.access(path.join(root, 'dist/thumbnails/removed-photo.jpg')));
  assert.equal(await fs.readFile(stale, 'utf8'), 'STALE PHOTO', 'cleanup must never mutate photo-engine inputs');
  for (const name of ['photos-manifest.json', '_astro/private-metadata.json', 'explore/photos.json', 'projects/fixture-beta/photos/private.json', 'photos/AAAAAAAAAAAAAAAA/index.html']) {
    const filename = path.join(root, 'public', name);
    await fs.mkdir(path.dirname(filename), { recursive: true });
    await fs.writeFile(filename, '{"private":"MUST NOT BE PUBLIC"}');
    try {
      const poisoned = build();
      assert.notEqual(poisoned.status, 0);
      assert.match(poisoned.stdout + poisoned.stderr, /Unexpected public file/);
      await assert.rejects(fs.access(path.join(root, 'dist', name)));
    } finally { await fs.rm(filename); }
  }
});
