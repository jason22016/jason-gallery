import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import test from 'node:test';
import sharp from 'sharp';
import { chromium } from 'playwright';
import { buildFixture, repo, run } from '../website/fixture';
import { serve } from '../website/server';
import { softwareGPUOptions } from '../browser';
import { DEFAULT_SITE_URL, resolveSiteURL } from '../../src/website/site-url';
import { canonicalURL, projectDescription, textSummary } from '../../src/website/seo';
import { buildRelease } from '../../scripts/ci/release';
import { shortPublicPhotoId } from '../../src/website/public-photo-id';

test('site addresses are explicit HTTPS origins; malformed/placeholder/local addresses fail', () => {
  assert.equal(resolveSiteURL(DEFAULT_SITE_URL), 'https://jason-gallery.pages.dev');
  assert.equal(resolveSiteURL(' https://GALLERY.seo-fixture.com/ '), 'https://gallery.seo-fixture.com');
  assert.equal(resolveSiteURL(''), undefined);
  assert.throws(() => resolveSiteURL('', true), /SITE_URL is required/);
  for (const url of ['gallery.com', 'http://gallery.com', 'https://localhost', 'https://127.0.0.1', 'https://[::1]', 'https://site.local', 'https://example.com', 'https://site.invalid', 'https://gallery.com/folder', 'https://gallery.com/../', 'https://gallery.com?x=1', 'https://gallery.com#', 'https://user:pass@gallery.com', 'https://gallery.com:4321', 'https://gallery.com\\foo']) {
    assert.throws(() => resolveSiteURL(url), /SITE_URL/, url);
  }
  const site = new URL('https://gallery.seo-fixture.com');
  assert.equal(canonicalURL('/projects/travel?photo=one&tag=city#viewer', site), 'https://gallery.seo-fixture.com/projects/travel/');
  assert.equal(canonicalURL('/index.html', site), 'https://gallery.seo-fixture.com/');
  assert.equal(canonicalURL('/', undefined), undefined);
});

test('descriptions have useful fallbacks, normalize whitespace and truncate Unicode safely', () => {
  const project = { title: '旅途', summary: '  ', description: '  城市\n\t和远山  ' };
  assert.equal(projectDescription(project), '城市 和远山');
  assert.equal(projectDescription({ ...project, description: '' }), '浏览 Jason 的摄影项目「旅途」。');
  assert.equal(projectDescription({ ...project, summary: '精选照片' }), '精选照片');
  const long = textSummary('📷'.repeat(200));
  assert.equal(Array.from(long).length, 160); assert(long.endsWith('…')); assert(!long.includes('\uFFFD'));
});

test('production release rejects a missing or malformed origin before touching content', async () => {
  const previous = process.env.SITE_URL;
  try {
    for (const value of ['', 'https://example.com']) {
      process.env.SITE_URL = value;
      await assert.rejects(buildRelease({ root: '/does-not-exist', photos: '/does-not-exist', destination: '/does-not-exist', websiteCommit: 'a'.repeat(40), runId: 'test', runNumber: 1, production: true }), /SITE_URL/);
    }
  } finally { if (previous === undefined) delete process.env.SITE_URL; else process.env.SITE_URL = previous; }
});

test('built HTML, sitemap, social images, drafts and Cloudflare Pages headers agree', { timeout: 180_000 }, async t => {
  const root = path.join(repo, '.cache/seo-fixture');
  const dist = path.join(root, 'dist');
  const origin = 'https://gallery.seo-fixture.com';
  const fixture = await buildFixture({ root, siteURL: `${origin}/` });
  const server = await serve(dist); t.after(() => server.close());
  const browser = await chromium.launch(softwareGPUOptions('webgl')); t.after(() => browser.close());
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  const published = fixture.projects.filter(project => project.status === 'published').sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug));
  const urls = ['/', ...published.map(project => `/projects/${project.slug}/`)];
  for (const [index, url] of urls.entries()) {
    const project = index === 0 ? undefined : published[index - 1]!;
    const response = await page.goto(`${server.url}${url}?photo=selected&tag=city#viewer`);
    assert.equal(response!.status(), 200);
    assert.equal(await page.locator('link[rel="icon"]').count(), 1);
    assert.equal(await page.locator('link[rel="icon"]').getAttribute('href'), '/favicon.svg');
    assert.equal(await page.locator('link[rel="icon"]').getAttribute('type'), 'image/svg+xml');
    assert.equal(await page.locator('link[rel="canonical"]').count(), 1);
    assert.equal(await page.locator('link[rel="canonical"]').getAttribute('href'), origin + url);
    assert.equal(await page.locator('meta[property="og:url"]').getAttribute('content'), origin + url);
    assert.equal(await page.locator('meta[property="og:title"]').getAttribute('content'), await page.title());
    assert.equal(await page.title(), project ? `${project.title} — Jason Gallery` : 'Jason Gallery — Photography');
    const description = await page.locator('meta[name="description"]').getAttribute('content');
    assert(description && description.length > 5);
    assert.equal(await page.locator('meta[property="og:description"]').getAttribute('content'), description);
    assert.match((await page.locator('meta[name="robots"]').getAttribute('content'))!, /^index, follow/);
    const image = await page.locator('meta[property="og:image"]').getAttribute('content');
    const cover = fixture.manifest.data.find(photo => photo.id === (project ?? published[0]!).coverPhotoId)!;
    assert.equal(image, origin + cover.thumbnailUrl);
    assert.equal(await page.locator('meta[name="twitter:image"]').getAttribute('content'), image);
    assert.equal(await page.locator('meta[name="twitter:card"]').getAttribute('content'), 'summary_large_image');
    assert(await page.locator('meta[property="og:image:alt"]').getAttribute('content'));
    const fetched = await fetch(server.url + new URL(image!).pathname);
    assert.equal(fetched.status, 200);
    assert.equal((await sharp(Buffer.from(await fetched.arrayBuffer())).metadata()).format, 'jpeg');
  }
  const sitemap = await (await fetch(`${server.url}/sitemap.xml`)).text();
  const favicon = await fetch(`${server.url}/favicon.svg`);
  assert.equal(favicon.status, 200);
  assert.equal(favicon.headers.get('content-type'), 'image/svg+xml');
  assert.deepEqual(Buffer.from(await favicon.arrayBuffer()), await fs.readFile(path.join(repo, 'public/favicon.svg')));
  const entries = await page.evaluate(xml => {
    const parsed = new DOMParser().parseFromString(xml, 'application/xml');
    if (parsed.querySelector('parsererror')) throw new Error('Invalid sitemap XML');
    return [...parsed.querySelectorAll('loc')].map(node => node.textContent);
  }, sitemap);
  assert.deepEqual(entries, ['/', '/explore/', '/map/', '/stats/', ...urls.slice(1)].map(url => origin + url));
  await page.goto(`${server.url}/explore/?project=fixture-beta&photo=selected&tag=city#viewer`);
  assert.equal(await page.title(), 'Explore — Jason Gallery');
  assert.equal(await page.locator('link[rel="canonical"]').getAttribute('href'), `${origin}/explore/`);
  assert.equal(await page.locator('meta[property="og:url"]').getAttribute('content'), `${origin}/explore/`);
  assert.equal(await page.locator('meta[property="og:image"]').getAttribute('content'), `${origin}/social/default.jpg`);
  assert.match((await page.locator('meta[name="robots"]').getAttribute('content'))!, /^index, follow/);
  await page.goto(`${server.url}/map/?camera=sony&tag=night`);
  assert.equal(await page.title(), 'Global Map — Jason Gallery');
  assert.equal(await page.locator('link[rel="canonical"]').getAttribute('href'), `${origin}/map/`);
  assert.equal(await page.locator('meta[property="og:url"]').getAttribute('content'), `${origin}/map/`);
  for (const query of ['', '?project=fixture-beta&period=year#when']) {
    await page.goto(`${server.url}/stats/${query}`);
    assert.equal(await page.title(), 'Photography Stats — Jason Gallery');
    assert.equal(await page.locator('link[rel="canonical"]').count(), 1);
    assert.equal(await page.locator('link[rel="canonical"]').getAttribute('href'), `${origin}/stats/`);
    assert.equal(await page.locator('meta[property="og:url"]').getAttribute('content'), `${origin}/stats/`);
    assert.equal(await page.locator('meta[property="og:title"]').getAttribute('content'), await page.title());
    const description = await page.locator('meta[name="description"]').getAttribute('content');
    assert(description && /cameras.*photographs/.test(description));
    assert.equal(await page.locator('meta[property="og:description"]').getAttribute('content'), description);
    assert.equal(await page.locator('meta[property="og:type"]').getAttribute('content'), 'website');
    assert.equal(await page.locator('meta[property="og:image"]').getAttribute('content'), `${origin}/social/default.jpg`);
    assert.equal(await page.locator('meta[name="twitter:image"]').getAttribute('content'), `${origin}/social/default.jpg`);
    assert.equal(await page.locator('meta[name="twitter:card"]').getAttribute('content'), 'summary_large_image');
    assert.match((await page.locator('meta[name="robots"]').getAttribute('content'))!, /^index, follow/);
  }
  assert(!/secret-draft|404|admin|\.json|\?/.test(sitemap.replace(/^<\?xml[^>]+>/, '')));
  const robots = await (await fetch(`${server.url}/robots.txt`)).text();
  assert.match(robots, /Allow: \/\n/); assert(robots.includes(`Sitemap: ${origin}/sitemap.xml`));
  assert(!robots.includes('secret-draft'));
  const privatePhoto = fixture.manifest.data.find(photo => photo.s3Key === 'private.jpg')!;
  for (const url of ['/missing', '/projects/secret-draft/', '/admin/', privatePhoto.thumbnailUrl]) {
    const response = await page.goto(server.url + url);
    assert.equal(response!.status(), 404);
    assert.equal(await page.locator('link[rel="icon"]').getAttribute('href'), '/favicon.svg');
    assert.equal(await page.locator('meta[name="robots"]').getAttribute('content'), 'noindex, nofollow');
    assert.equal(await page.locator('link[rel="canonical"],meta[property="og:url"]').count(), 0);
    assert.equal(await page.getByRole('link', { name: '返回项目 →' }).getAttribute('href'), '/');
  }
  const files = await fs.readdir(dist, { recursive: true });
  for (const name of files.filter(name => /\.(html|xml|txt|json)$/.test(name))) {
    const body = await fs.readFile(path.join(dist, name), 'utf8');
    assert(!/DRAFT WEBSITE SECRET|PRIVATE PROJECT|secret-draft/.test(body), name);
  }

  // Actual local Pages runtime, not just a static fixture server: verify _headers and 404 status.
  const probe = createServer(); await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
  const address = probe.address(); assert(address && typeof address !== 'string');
  const port = address.port; await new Promise<void>(resolve => probe.close(() => resolve()));
  const child = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'pages', 'dev', dist, '--ip', '127.0.0.1', '--port', String(port)], { cwd: repo, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: path.join(root, 'wrangler-logs') }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; child.stdout.on('data', value => { log += value; }); child.stderr.on('data', value => { log += value; });
  try {
    const host = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let i = 0; i < 120; i++) {
      try { if ((await fetch(`${host}/health.txt`)).ok) { ready = true; break; } } catch { /* starting */ }
      if (child.exitCode !== null) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert(ready, log);
    assert(!/invalid header|invalid rule/i.test(log), log);
    const home = await fetch(host); assert.equal(home.status, 200); assert.equal(home.headers.get('X-Robots-Tag'), null);
    const stats = await fetch(`${host}/stats/?project=fixture-beta`); assert.equal(stats.status, 200); assert.equal(stats.headers.get('X-Robots-Tag'), null);
    const icon = await fetch(`${host}/favicon.svg`); assert.equal(icon.status, 200);
    assert.match(icon.headers.get('content-type')!, /^image\/svg\+xml/);
    assert.deepEqual(Buffer.from(await icon.arrayBuffer()), await fs.readFile(path.join(repo, 'public/favicon.svg')));
    const metadata = await fetch(`${host}/projects/fixture-beta/photos/${fixture.photos[0]!.photoId}.json`);
    assert.equal(metadata.status, 200); assert.equal(metadata.headers.get('X-Robots-Tag'), 'noindex, nofollow');
    const photoPage = await fetch(`${host}/photos/${shortPublicPhotoId(fixture.photos[0]!.photoId)}/`);
    assert.equal(photoPage.status, 200); assert.equal(photoPage.headers.get('X-Robots-Tag'), 'noindex, nofollow');
    for (const url of ['/does-not-exist', '/projects/secret-draft/', '/admin/']) {
      const response = await fetch(host + url); assert.equal(response.status, 404);
      assert.match(await response.text(), /name="robots" content="noindex, nofollow"/);
    }
    await fs.writeFile(path.join(root, 'pages.log'), log);
  } finally {
    child.kill('SIGTERM');
    await new Promise<void>(resolve => { if (child.exitCode !== null) return resolve(); child.once('exit', () => resolve()); setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 5000).unref(); });
  }

  // Explicit no-origin preview: no invented localhost/production links, even with public Projects.
  const content = path.join(root, 'src/content/projects/fixture-beta.json');
  const project = JSON.parse(await fs.readFile(content, 'utf8'));
  project.summary = '  A "quote" & <script>window.seoInjection=true</script>\n description  ';
  await fs.writeFile(content, JSON.stringify(project));
  run([path.join(repo, 'node_modules/astro/bin/astro.mjs'), 'build'], root, { SITE_URL: '', CF_PAGES_URL: 'https://temporary.jason-gallery.pages.dev' });
  await page.goto(`${server.url}/projects/fixture-beta/`);
  assert.equal(await page.locator('meta[name="description"]').getAttribute('content'), 'A "quote" & <script>window.seoInjection=true</script> description');
  assert.equal(await page.locator('script').filter({ hasText: /^window.seoInjection/ }).count(), 0);
  assert.equal(await page.locator('meta[name="robots"]').getAttribute('content'), 'noindex, nofollow');
  assert.equal(await page.locator('link[rel="canonical"],meta[property="og:url"],meta[property="og:image"]').count(), 0);
  assert(!(await fs.readFile(path.join(dist, 'sitemap.xml'), 'utf8')).includes('<loc>'));
  assert.equal(await fs.readFile(path.join(dist, 'robots.txt'), 'utf8'), 'User-agent: *\nDisallow: /\n');
  assert.equal(await fs.readFile(path.join(dist, '_headers'), 'utf8'), '/*\n  X-Robots-Tag: noindex, nofollow\n');
  await page.goto(`${server.url}/stats/?project=fixture-beta`);
  assert.equal(await page.locator('meta[name="robots"]').getAttribute('content'), 'noindex, nofollow');
  assert.equal(await page.locator('link[rel="canonical"],meta[property="og:url"],meta[property="og:image"]').count(), 0);
  await page.goto(`${server.url}/photos/${shortPublicPhotoId(fixture.photos[0]!.photoId)}/`);
  assert.equal(await page.locator('meta[name="robots"]').getAttribute('content'), 'noindex, nofollow');
  assert.equal(await page.locator('link[rel="canonical"],meta[property="og:url"],meta[property="og:image"],meta[name="twitter:image"]').count(), 0);

  // Publishing no projects still has a valid homepage and share image; no former routes remain.
  for (const name of await fs.readdir(path.dirname(content))) {
    const filename = path.join(path.dirname(content), name);
    const draft = JSON.parse(await fs.readFile(filename, 'utf8')); draft.status = 'draft';
    await fs.writeFile(filename, JSON.stringify(draft));
  }
  run([path.join(repo, 'node_modules/astro/bin/astro.mjs'), 'build'], root, { SITE_URL: DEFAULT_SITE_URL });
  await page.goto(server.url);
  assert.equal(await page.locator('meta[property="og:image"]').getAttribute('content'), `${DEFAULT_SITE_URL}/social/default.jpg`);
  assert.equal(await page.locator('link[rel="canonical"]').getAttribute('href'), `${DEFAULT_SITE_URL}/`);
  const fallback = await sharp(path.join(dist, 'social/default.jpg')).metadata();
  assert.equal(fallback.format, 'jpeg'); assert.equal(fallback.width, 1200); assert.equal(fallback.height, 630);
  assert.equal(((await fs.readFile(path.join(dist, 'sitemap.xml'), 'utf8')).match(/<loc>/g) ?? []).length, 4);
  assert.equal((await fetch(`${server.url}/projects/fixture-beta/`)).status, 404);
  assert.equal((await fetch(`${server.url}/photos/${shortPublicPhotoId(fixture.photos[0]!.photoId)}/`)).status, 404);
  assert(!(await fs.readdir(dist, { recursive: true })).some(file => /^photos\/[^/]+\/index\.html$/.test(file)));
  const invalid = spawnSync(process.execPath, [path.join(repo, 'node_modules/astro/bin/astro.mjs'), 'build'], { cwd: root, env: { ...process.env, SITE_URL: 'https://example.com' }, encoding: 'utf8' });
  assert.notEqual(invalid.status, 0); assert.match(invalid.stdout + invalid.stderr, /SITE_URL/);
});
