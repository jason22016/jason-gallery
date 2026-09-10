/** Browser interaction + formal Worker requests; upstreams are fixtures, not production latency. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { serve } from '../website/server';
import { softwareGPUOptions } from '../browser';
import { fixture, prepareKeys, token, env, head, config } from './backend-fixture';
import { readCollection } from '../../src/photo-engine/collection-contract';
const require = createRequire(import.meta.url);
const { Miniflare, convertV4MiniflareOptions } = await import(pathToFileURL(require.resolve('miniflare', { paths: [dirname(require.resolve('wrangler/package.json'))] })).href);
const [bundle, out, input] = process.argv.slice(2);
await prepareKeys(); let replay;
if (input) {
  const artifact = JSON.parse(await readFile(resolve(input, 'artifact.json'), 'utf8')); const files = new Map<string, Uint8Array>();
  for (const name of ['artifact.json', ...Object.keys(artifact.files)]) files.set(name, new Uint8Array(await readFile(resolve(input, name))));
  replay = { files, artifact, config: artifact.snapshot.config };
}
const f = await fixture(replay); f.enableSealed(); const collection = await readCollection(async name => f.c.files.get(name)!, replay?.config ?? config);
const refs = [collection.photos[0].id, collection.photos.at(-1)!.id];
const initialProjects = Array.from({ length: 40 }, (_, i) => ({ schemaVersion: 1, id: `profile-${i}`, slug: `profile-${i}`, title: `Profile ${i}`, coverPhotoId: refs[0], photos: refs.map(photoId => ({ photoId })), status: i % 2 ? 'published' : 'draft', order: i }));
const bindings = { ...env }; delete (bindings as any).ASSETS;
const mf = new Miniflare(convertV4MiniflareOptions({ name: 'gallery-ui-profile', modules: true, scriptPath: resolve(bundle), compatibilityDate: '2026-09-10', compatibilityFlags: ['nodejs_compat'], bindings,
  serviceBindings: { ASSETS: () => new Response('assets') }, outboundService: async (r: Request) => f.fetcher(r.url, { method: r.method, headers: r.headers, body: ['GET', 'HEAD'].includes(r.method) ? undefined : await r.text() }) }));
const host = await serve(resolve('.cache/admin-release')); const browser = await chromium.launch(softwareGPUOptions('webgl')); const jwt = await token();
const samples = [];
try {
  for (let iteration = 0; iteration < 4; iteration++) {
    if (!iteration) await mf.purgeCache(); f.setHead(head); f.setProjects(structuredClone(initialProjects));
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }); const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await page.route('**/api/**', async route => {
      const r = route.request(); const u = new URL(r.url());
      if (u.pathname === '/api/save') assert(JSON.parse(r.postData()!).saveProof, 'The connected editor must use its signed context');
      const response = await mf.dispatchFetch(env.ADMIN_ORIGIN + u.pathname + u.search, { method: r.method(), headers: { 'Cf-Access-Jwt-Assertion': jwt, Origin: env.ADMIN_ORIGIN, 'Content-Type': 'application/json' }, body: r.postData() ?? undefined });
      await route.fulfill({ status: response.status, contentType: response.headers.get('content-type') ?? undefined, body: Buffer.from(await response.arrayBuffer()) });
    });
    const start = performance.now(); await page.goto(host.url); await page.locator('.photo-card').first().waitFor();
    await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => r())));
    const firstInteractiveMs = performance.now() - start;
    assert.equal(await page.locator('.photo-card').count(), collection.photos.length);
    await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>('.photo-card img')].filter(img => img.getBoundingClientRect().top < innerHeight).every(img => img.complete && img.naturalWidth > 0), undefined, { timeout: 30000 });
    const visiblePreviewsMs = performance.now() - start;
    const first = page.locator('.photo-card').first();
    await first.evaluate(el => el.addEventListener('click', () => { const t = performance.now(); requestAnimationFrame(() => el.setAttribute('data-profile-selection-ms', String(performance.now() - t))); }, { once: true }));
    await first.click();
    await page.waitForFunction(() => document.querySelector('.photo-card')?.hasAttribute('data-profile-selection-ms'));
    const selectedMs = Number(await first.getAttribute('data-profile-selection-ms'));
    assert.equal(await page.locator('.photo-card').first().getAttribute('aria-pressed'), 'true');
    // Search reaches the last photo, not just the initially visible cards; selection survives.
    await page.getByLabel('搜索照片').fill(collection.photos.at(-1)!.title);
    assert((await page.locator('.photo-card').count()) >= 1);
    const last = page.locator('.photo-card').last(); await last.click();
    await page.getByLabel('搜索照片').fill(''); assert.equal(await page.locator('.photo-card[aria-pressed="true"]').count(), 2);
    if ((replay?.config ?? config).sources.length > 1) {
      await page.locator('.tabs button').last().click(); await page.locator('.tabs button').first().click();
      assert.equal(await page.locator('.photo-card[aria-pressed="true"]').count(), 2);
    }
    await page.getByRole('navigation').getByRole('button', { name: 'Project', exact: true }).click(); await page.getByRole('button', { name: /Profile 0 / }).click();
    await page.getByLabel('标题', { exact: true }).fill('Profile edited'); await page.getByLabel('上移照片 2', { exact: true }).click();
    const sequence = await page.locator('.sequence-list').innerText();
    const saveStart = performance.now(); await page.getByRole('button', { name: '保存 Project', exact: true }).click(); await page.getByText('Project 已提交 GitHub。网站尚未发布。', { exact: true }).waitFor();
    const saveVisibleMs = performance.now() - saveStart;
    assert.equal(await page.getByLabel('标题', { exact: true }).inputValue(), 'Profile edited'); assert.equal(await page.locator('.sequence-list').innerText(), sequence);
    const readback = await mf.dispatchFetch(env.ADMIN_ORIGIN + '/api/state', { headers: { 'Cf-Access-Jwt-Assertion': jwt } });
    const stored = await readback.json() as any; assert.equal(readback.status, 200); assert.notEqual(stored.head, head);
    const savedProject = stored.projects.find((p: any) => p.id === 'profile-0');
    assert.equal(savedProject.title, 'Profile edited'); assert.deepEqual(savedProject.photos.map((p: any) => p.photoId), [...refs].reverse());
    assert.deepEqual(errors, []); await page.close();
    samples.push({ cache: iteration ? 'warm' : 'cold', iteration, firstInteractiveMs, visiblePreviewsMs, selectedMs, saveVisibleMs });
  }
  await mkdir(dirname(resolve(out)), { recursive: true });
  await writeFile(out, JSON.stringify({ photos: collection.photos.length, projects: 40, sources: (replay?.config ?? config).sources.length, caveat: 'Local Chromium and workerd; signed fixture JWT, mocked upstream latency. Click-to-animation-frame and visible save confirmation, not production performance. No real Access OTP, GitHub writes or production deployment.', samples }, null, 2));
} finally { await browser.close(); await host.close(); await mf.dispose(); }
