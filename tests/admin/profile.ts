/** Local workerd/V8 sampling only. Fixture upstreams never contact GitHub/Cloudflare.
 * Not a measurement of billed Workers CPU and not a Free deployment acceptance test. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fixture, prepareKeys, token, env, head, config } from './backend-fixture';
import { AdminService } from '../../admin/server/service';
import { GitHub } from '../../admin/server/github';
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
const f = await fixture(replay); f.enableSealed();
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
  const proofState = await new AdminService(new GitHub(env, f.fetcher)).bootstrap();
  assert.equal(proofState.media.state, 'ready');
  const previewURLs = new Map<string,string>(proofState.media.photos.map((p: any) => [p.photo.id,p.photo.thumbnailUrl]));
  const ref = photos.photos[0].id;
  const saveRefs: string[] = collectionDir
    ? JSON.parse(new TextDecoder().decode(f.c.files.get('photo-index.json')!)).entries.filter((p: any) => /^DSC_(0129|0160)_/.test(p.nativeId)).map((p: any) => p.reference)
    : [photos.photos[0].id, photos.photos.at(-1)!.id];
  assert.equal(new Set(saveRefs).size, 2, 'Save fixture must contain both approved photo references');
  const project = { schemaVersion: 1, id: 'profile-only', slug: 'profile-only', title: '[TEST] 后台验收 2026-09-11', coverPhotoId: saveRefs[0], photos: saveRefs.map(photoId => ({ photoId })), status: 'draft', order: 0 };
  const cases: { name: string; path: string; body?: unknown; projectCount?: number; signed?: boolean }[] = [
    { name: 'authenticated-assets', path: '/' },
    { name: 'state', path: '/api/state' },
    { name: 'thumbnail', path: previewURLs.get(ref)! },
    { name: 'source-impact', path: '/api/impact', body: activeConfig },
    { name: 'source-save', path: '/api/save', body: { kind: 'sources', expectedHead: head, config: activeConfig } },
    { name: 'project-save', path: '/api/save', body: { kind: 'project', expectedHead: head, project } },
    { name: 'sync-dispatch', path: '/api/dispatch', body: { mode: 'sync', expectedHead: head } },
    { name: 'publish-dispatch', path: '/api/dispatch', body: { mode: 'publish', expectedHead: head, photoRunId: 1 } },
    { name: 'signed-project-save', path: '/api/save', body: { kind: 'project', expectedHead: head, project }, signed: true },
    { name: 'signed-project-save-40-projects', path: '/api/save', body: { kind: 'project', expectedHead: head, project }, projectCount: 40, signed: true },
    { name: 'tasks', path: '/api/tasks' },
    { name: 'state-40-projects', path: '/api/state', projectCount: 40 },
    { name: 'project-save-40-projects', path: '/api/save', body: { kind: 'project', expectedHead: head, project }, projectCount: 40 },
    { name: 'publish-40-projects', path: '/api/dispatch', body: { mode: 'publish', expectedHead: head, photoRunId: 1 }, projectCount: 40 },
  ];
  const requestBody = async (scenario: typeof cases[number]) => scenario.signed
    ? { ...scenario.body as object, saveProof: (await new AdminService(new GitHub(env, f.fetcher)).bootstrap()).saveProof }
    : scenario.body;
  const resetScenario = (scenario: typeof cases[number]) => {
    f.setHead(head);
    f.setProjects(Array.from({ length: scenario.projectCount ?? 0 }, (_, i) => ({ ...project, id: `profile-${i}`, slug: `profile-${i}` })));
  };
  const results = [];
  for (const scenario of cases) {
    await mf.purgeCache();
    f.setProjects(Array.from({ length: scenario.projectCount ?? 0 }, (_, i) => ({ ...project, id: `profile-${i}`, slug: `profile-${i}` })));
    for (let iteration = 0; iteration < (smoke ? 2 : 6); iteration++) {
      resetScenario(scenario);
      const bodyInput = await requestBody(scenario);
      const before = f.network.length;
      await cdp('Profiler.start');
      const started = performance.now();
      const response = await mf.dispatchFetch(env.ADMIN_ORIGIN + scenario.path, { method: scenario.body === undefined ? 'GET' : 'POST', headers: { 'Cf-Access-Jwt-Assertion': jwt, ...(scenario.body === undefined ? {} : { Origin: env.ADMIN_ORIGIN, 'Content-Type': 'application/json' }) }, body: scenario.body === undefined ? undefined : JSON.stringify(bodyInput) });
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
  for (const forbidden of ['@zip.js', 'readCollection', 'projectUnifiedIndex', 'ZipReader']) assert(!formalSource.includes(forbidden), `Heavy photo path remains in bundle: ${forbidden}`);
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
        resetScenario(scenario); const bodyInput = await requestBody(scenario); const before = f.network.length;
        const response = await counting.dispatchFetch(env.ADMIN_ORIGIN + scenario.path, { method: scenario.body === undefined ? 'GET' : 'POST', headers: { 'Cf-Access-Jwt-Assertion': jwt, Origin: env.ADMIN_ORIGIN, 'Content-Type': 'application/json' }, body: scenario.body === undefined ? undefined : JSON.stringify(bodyInput) });
        await response.arrayBuffer(); assert.equal(response.status, 200);
        const cacheOperations = Number(response.headers.get('x-test-cache-operations'));
        assert.equal(cacheOperations, 0, 'Production paths must not call the unavailable Access Cache API');
        if (smoke) assert(f.network.length - before + cacheOperations <= 50, `${scenario.name} exceeds the fixture fetch + cache budget`);
        for (const result of results.filter(r => r.name === scenario.name && r.cache === cache)) Object.assign(result, { cacheOperations, countedExternalRequests: f.network.length - before, fetchPlusCacheOperations: f.network.length - before + cacheOperations });
      }
    }
  } finally { await counting.dispose(); }
  // Check every real preview at each observed fan-out, without shared Cache API.
  const previewChecks = [];
  for (const concurrency of [12, 40]) {
    await mf.purgeCache();
    const before = f.network.length;
    for (let offset = 0; offset < photos.photos.length; offset += concurrency) {
      await Promise.all(photos.photos.slice(offset, offset + concurrency).map(async photo => {
        const response = await mf.dispatchFetch(env.ADMIN_ORIGIN + previewURLs.get(photo.id)!, { headers: { 'Cf-Access-Jwt-Assertion': jwt } });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('Content-Type'), 'image/jpeg');
        assert.deepEqual(new Uint8Array(await response.arrayBuffer()), f.c.files.get(`public/thumbnails/${photo.id}.jpg`));
      }));
    }
    assert.equal(f.network.length - before, photos.photos.length * 4);
    previewChecks.push({ concurrency, verified: photos.photos.length, upstreamRequestsPerImage: 4 });
  }
  resetScenario({ name: 'save-sequence', path: '/api/save', projectCount: 40 });
  let saveState: { head: string; saveProof?: string } = await new AdminService(new GitHub(env, f.fetcher)).bootstrap();
  assert(saveState.saveProof);
  const signedSaveChecks = [];
  for (let i = 1; i <= 20; i++) {
    const edited = { ...project, id: 'profile-0', slug: 'profile-0', description: `Isolated verified save ${i}` };
    const before = f.network.length;
    const response: Response = await mf.dispatchFetch(env.ADMIN_ORIGIN + '/api/save', { method: 'POST', headers: { 'Cf-Access-Jwt-Assertion': jwt, Origin: env.ADMIN_ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'project', expectedHead: saveState.head, project: edited, saveProof: saveState.saveProof }) });
    const saved = await response.json() as any;
    assert.equal(response.status, 200, JSON.stringify(saved)); assert.equal(saved.status, 'saved'); assert.notEqual(saved.head, saveState.head); assert(saved.saveProof);
    assert.equal(f.network.length - before, 4);
    const readback = await mf.dispatchFetch(env.ADMIN_ORIGIN + '/api/state', { headers: { 'Cf-Access-Jwt-Assertion': jwt } });
    const state = await readback.json() as any; assert.equal(readback.status, 200); assert.equal(state.head, saved.head);
    assert.equal(state.projects.length, 40); assert.deepEqual(state.projects.find((p: any) => p.id === edited.id), edited);
    signedSaveChecks.push({ iteration: i, status: 200, exactReadback: true, upstreamRequests: 4 });
    saveState = { ...saveState, head: saved.head, saveProof: saved.saveProof };
  }
  const freshIsolateChecks = [];
  for (const scenario of cases) {
    f.setHead(head);
    f.setProjects(Array.from({ length: scenario.projectCount ?? 0 }, (_, i) => ({ ...project, id: `fresh-${i}`, slug: `fresh-${i}` })));
    const bodyInput = await requestBody(scenario);
    const fresh = new Miniflare(convertV4MiniflareOptions({ name: 'gallery-fresh', modules: true, scriptPath: bundle, compatibilityDate: '2026-09-10', compatibilityFlags: ['nodejs_compat'], bindings,
      serviceBindings: { ASSETS: () => new Response('fixture assets') },
      outboundService: async (request: Request) => f.fetcher(request.url, { method: request.method, headers: request.headers, body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.text() }),
    }));
    try {
      const before = f.network.length;
      // Deliberately the first invocation, with no preceding auth probe or warm-up.
      const response = await fresh.dispatchFetch(env.ADMIN_ORIGIN + scenario.path, { method: scenario.body === undefined ? 'GET' : 'POST', headers: { 'Cf-Access-Jwt-Assertion': jwt, Origin: env.ADMIN_ORIGIN, 'Content-Type': 'application/json' }, body: scenario.body === undefined ? undefined : JSON.stringify(bodyInput) });
      const value = new Uint8Array(await response.arrayBuffer());
      assert.equal(response.status, 200, new TextDecoder().decode(value));
      if (scenario.path === '/api/state') { const data = JSON.parse(new TextDecoder().decode(value)); assert.equal(data.media.state, 'ready'); assert.deepEqual(data.media.photos.map((p: any) => p.photo.id), photos.photos.map(p => p.id)); assert.equal(data.projects.length, scenario.projectCount ?? 0); }
      if (scenario.path === '/api/save') assert.equal(JSON.parse(new TextDecoder().decode(value)).status, 'saved');
      if (scenario.path.includes('/thumbnail/')) assert.deepEqual(value, f.c.files.get(`public/thumbnails/${ref}.jpg`));
      const operations = f.network.length - before + (scenario.path === '/' ? 1 : 0);
      assert(operations <= 50);
      freshIsolateChecks.push({ name: scenario.name, status: response.status, upstreamAndAssetCalls: operations });
    } finally { await fresh.dispose(); }
  }
  await writeFile(resolve(output, 'results.json'), JSON.stringify({ measuredAt: new Date().toISOString(), bundle, node: process.version, photos: photos.photos.length, sources: activeConfig.sources.length, fixture: collectionDir ? 'verified-local-collection' : 'isolated-two-source', cacheMode: 'disabled', caveat: 'Local sampled V8 CPU; excludes idle samples but may omit native CPU and include debugger overhead. Not billed CPU, not Free acceptance. Legacy cold/warm labels mean first/repeated samples in the shared isolate, not persistent cache. Separate fresh-isolate checks are functional assertions, not CPU measurements.', freshIsolateChecks, previewChecks, signedSaveChecks, results }, null, 2) + '\n');
} finally { ws?.close(); await mf.dispose(); }
