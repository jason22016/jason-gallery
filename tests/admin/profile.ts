/** Local workerd/V8 sampling only. Fixture upstreams never contact GitHub/Cloudflare.
 * Not a measurement of billed Workers CPU and not a Free deployment acceptance test. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fixture, prepareKeys, token, env, head, config } from './backend-fixture';
import { readCollection } from '../../src/photo-engine/collection-contract';
const require = createRequire(import.meta.url);
const { Miniflare, convertV4MiniflareOptions } = await import(pathToFileURL(require.resolve('miniflare', { paths: [dirname(require.resolve('wrangler/package.json'))] })).href);
const args = process.argv.slice(2).filter(arg => arg !== '--smoke');
const smoke = process.argv.includes('--smoke');
const bundle = resolve(args[0] ?? 'admin/.cache/admin-profile-worker/worker.js');
const output = resolve(args[1] ?? '.cache/admin-profile');
const collectionDir = args[2] && resolve(args[2]);
await mkdir(output, { recursive: true });
await prepareKeys();
let replay;
if (collectionDir) {
  const artifact = JSON.parse(await readFile(resolve(collectionDir, 'artifact.json'), 'utf8'));
  const files = new Map<string, Uint8Array>();
  for (const name of ['artifact.json', ...Object.keys(artifact.files)]) files.set(name, new Uint8Array(await readFile(resolve(collectionDir, name))));
  const config = artifact.snapshot.config;
  // Verifies real local artifacts before replay. The profiler never writes these files.
  await readCollection(async name => files.get(name)!, config);
  replay = { files, artifact, config };
}
const f = await fixture(replay);
const bindings = { ...env, PUBLISH_ENABLED: 'true' }; delete (bindings as any).ASSETS;
const mf = new Miniflare(convertV4MiniflareOptions({ name: 'gallery-profile', modules: true, scriptPath: bundle, compatibilityDate: '2026-09-10', compatibilityFlags: ['nodejs_compat'], bindings, inspectorPort: 0,
  serviceBindings: { ASSETS: () => new Response('fixture assets') },
  outboundService: async (request: Request) => f.fetcher(request.url, { method: request.method, headers: request.headers, body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.text() }),
}));
let ws: WebSocket | undefined;
try {
  const inspector = await mf.getInspectorURL();
  const discovery = new URL('/json/list', inspector); discovery.protocol = 'http:';
  const targets = await (await fetch(discovery)).json() as any[];
  const target = targets.find(t => t.id?.includes('gallery-profile')) ?? targets.find(t => t.webSocketDebuggerUrl);
  assert(target, 'No inspector target');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise<void>((ok, fail) => { ws!.addEventListener('open', () => ok(), { once: true }); ws!.addEventListener('error', fail, { once: true }); });
  let sequence = 0;
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
  ws.addEventListener('message', event => { const message = JSON.parse(String(event.data)); const item = pending.get(message.id); if (item) { pending.delete(message.id); if (message.error) item.reject(message.error); else item.resolve(message.result); } });
  const cdp = (method: string, params = {}) => new Promise<any>((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); ws!.send(JSON.stringify({ id, method, params })); });
  await cdp('Profiler.enable'); await cdp('Profiler.setSamplingInterval', { interval: 100 });
  for (const claims of [{ exp: 1 }, { aud: 'wrong' }, { email: 'outsider@example.com' }]) { const denied = await mf.dispatchFetch(env.ADMIN_ORIGIN + '/api/state', { headers: { 'Cf-Access-Jwt-Assertion': await token(claims) } }); assert.equal(denied.status, 401); await denied.text(); }
  const jwt = await token();
  const activeConfig = replay?.config ?? config;
  const photos = await readCollection(async name => f.c.files.get(name)!, activeConfig);
  const ref = photos.photos[0].id;
  const project = { schemaVersion: 1, id: 'profile-only', slug: 'profile-only', title: 'Isolated profile fixture', coverPhotoId: ref, photos: [{ photoId: ref }], status: 'draft', order: 0 };
  const cases: { name: string; path: string; body?: unknown; projectCount?: number }[] = [
    { name: 'authenticated-assets', path: '/' },
    { name: 'state', path: '/api/state' },
    { name: 'thumbnail', path: `/api/thumbnail/1/${ref}` },
    { name: 'source-impact', path: '/api/impact', body: activeConfig },
    { name: 'source-save', path: '/api/save', body: { kind: 'sources', expectedHead: head, config: activeConfig } },
    { name: 'project-save', path: '/api/save', body: { kind: 'project', expectedHead: head, project } },
    { name: 'sync-dispatch', path: '/api/dispatch', body: { mode: 'sync', expectedHead: head } },
    { name: 'publish-dispatch', path: '/api/dispatch', body: { mode: 'publish', expectedHead: head, photoRunId: 1 } },
    { name: 'tasks', path: '/api/tasks' },
    { name: 'state-40-projects', path: '/api/state', projectCount: 40 },
    { name: 'project-save-40-projects', path: '/api/save', body: { kind: 'project', expectedHead: head, project }, projectCount: 40 },
    { name: 'publish-40-projects', path: '/api/dispatch', body: { mode: 'publish', expectedHead: head, photoRunId: 1 }, projectCount: 40 },
  ];
  const results = [];
  for (const scenario of cases) {
    await mf.purgeCache();
    f.setProjects(Array.from({ length: scenario.projectCount ?? 0 }, (_, i) => ({ ...project, id: `profile-${i}`, slug: `profile-${i}` })));
    for (let iteration = 0; iteration < (smoke ? 2 : 6); iteration++) {
      f.setHead(head);
      const before = f.network.length;
      await cdp('Profiler.start');
      const started = performance.now();
      const response = await mf.dispatchFetch(env.ADMIN_ORIGIN + scenario.path, { method: scenario.body === undefined ? 'GET' : 'POST', headers: { 'Cf-Access-Jwt-Assertion': jwt, ...(scenario.body === undefined ? {} : { Origin: env.ADMIN_ORIGIN, 'Content-Type': 'application/json' }) }, body: scenario.body === undefined ? undefined : JSON.stringify(scenario.body) });
      const body = await response.text();
      const wallMs = performance.now() - started;
      const { profile } = await cdp('Profiler.stop');
      assert.equal(response.status, 200, `${scenario.name}: ${body}`);
      if (scenario.path === '/api/save') assert.equal(JSON.parse(body).status, 'saved', body);
      if (scenario.path === '/api/dispatch') assert.equal(JSON.parse(body).state, 'pending', body);
      if (scenario.path === '/api/tasks') assert.equal(JSON.parse(body).tasks[0].published, false, body);
      if (scenario.path === '/api/state') { const state = JSON.parse(body); assert.equal(state.media.state, 'ready', body); assert.deepEqual(state.media.photos.map((p: any) => p.photo.id), photos.photos.map(p => p.id)); assert.equal(state.projects.length, scenario.projectCount ?? 0); }
      const nodes = new Map<number, any>(profile.nodes.map((n: any) => [n.id, n]));
      let sampledV8Ms = 0;
      for (let i = 0; i < profile.samples.length; i++) if (nodes.get(profile.samples[i]).callFrame.functionName !== '(idle)') sampledV8Ms += profile.timeDeltas[i] / 1000;
      const result = { name: scenario.name, cache: iteration === 0 ? 'cold' : 'warm', iteration, sampledV8Ms, wallMs, externalRequests: f.network.length - before };
      results.push(result);
      await writeFile(resolve(output, `${scenario.name}-${iteration}.cpuprofile`), JSON.stringify(profile));
      console.log(JSON.stringify(result));
    }
  }
  // A separate wrapper counts native Cache operations around the unmodified formal
  // bundle. No instrumentation/headers are included in the CPU samples or release.
  const countingPath = resolve(output, 'count-worker.js');
  const formalSource = await readFile(bundle, 'utf8');
  assert(formalSource.includes('worker_default as default'));
  await writeFile(countingPath, formalSource.replace('worker_default as default', 'counting_worker as default') + `
const worker = worker_default;
import { AsyncLocalStorage } from 'node:async_hooks';
const scope = new AsyncLocalStorage();
for (const name of ['match', 'put', 'delete']) {
  const original = Cache.prototype[name];
  Cache.prototype[name] = function(...args) { const count = scope.getStore(); if (count) count.value++; return original.apply(this, args); };
}
const counting_worker = { fetch(request, env, ctx) { return scope.run({ value: 0 }, async () => { const response = await worker.fetch(request, env, ctx); response.headers.set('x-test-cache-operations', String(scope.getStore().value)); return response; }); } };
`);
  const counting = new Miniflare(convertV4MiniflareOptions({ name: 'gallery-count', modules: true, scriptPath: countingPath, compatibilityDate: '2026-09-10', compatibilityFlags: ['nodejs_compat'], bindings,
    serviceBindings: { ASSETS: () => new Response('fixture assets') },
    outboundService: async (request: Request) => f.fetcher(request.url, { method: request.method, headers: request.headers, body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.text() }),
  }));
  try {
    for (const scenario of cases) {
      await counting.purgeCache();
      f.setProjects(Array.from({ length: scenario.projectCount ?? 0 }, (_, i) => ({ ...project, id: `profile-${i}`, slug: `profile-${i}` })));
      for (const cache of ['cold', 'warm']) {
        f.setHead(head); const before = f.network.length;
        const response = await counting.dispatchFetch(env.ADMIN_ORIGIN + scenario.path, { method: scenario.body === undefined ? 'GET' : 'POST', headers: { 'Cf-Access-Jwt-Assertion': jwt, Origin: env.ADMIN_ORIGIN, 'Content-Type': 'application/json' }, body: scenario.body === undefined ? undefined : JSON.stringify(scenario.body) });
        await response.arrayBuffer(); assert.equal(response.status, 200);
        const cacheOperations = Number(response.headers.get('x-test-cache-operations'));
        if (scenario.path === '/api/state') assert(cacheOperations > 0, 'Cache calls were not counted');
        if (smoke) assert(f.network.length - before + cacheOperations <= 50, `${scenario.name} exceeds the fixture fetch + cache budget`);
        for (const result of results.filter(r => r.name === scenario.name && r.cache === cache)) Object.assign(result, { cacheOperations, countedExternalRequests: f.network.length - before, fetchPlusCacheOperations: f.network.length - before + cacheOperations });
      }
    }
  } finally { await counting.dispose(); }
  // Reproduce actual browser fan-out, including a totally cold artifact path. The
  // inline ZIP codec must never hand a Promise to a different workerd request.
  if (smoke) {
  await mf.purgeCache();
  const previews = await Promise.all(Array.from({ length: 12 }, async (_, i) => {
    const photo = photos.photos[i % photos.photos.length];
    const response = await mf.dispatchFetch(env.ADMIN_ORIGIN + `/api/thumbnail/1/${photo.id}`, { headers: { 'Cf-Access-Jwt-Assertion': jwt } });
    assert.equal(response.status, 200); assert.deepEqual(new Uint8Array(await response.arrayBuffer()), f.c.files.get(`public/thumbnails/${photo.id}.jpg`));
  }));
  assert.equal(previews.length, 12);
  }
  await writeFile(resolve(output, 'results.json'), JSON.stringify({ measuredAt: new Date().toISOString(), bundle, node: process.version, photos: photos.photos.length, sources: activeConfig.sources.length, fixture: collectionDir ? 'verified-local-collection' : 'isolated-two-source', caveat: 'Local sampled V8 CPU; excludes idle samples but may omit native CPU and include debugger overhead. Not billed CPU, not Free acceptance. First case also includes isolate startup. 1 cold + 5 warm samples per route; warm means disposable Cache API retained, not cached login.', results }, null, 2) + '\n');
} finally { ws?.close(); await mf.dispose(); }
