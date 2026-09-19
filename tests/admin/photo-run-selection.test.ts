import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, env, head, prepareKeys, token } from './backend-fixture';
import { handle } from '../../admin/server/worker';
import { verifySaveProof } from '../../admin/server/save-proof';
import type { Project } from '../../src/projects/schema';

test.before(prepareKeys);

async function failedRun(id: number) {
  const f = await fixture(undefined, id);
  f.run.conclusion = 'failure';
  f.setSummary({ ...f.summary, photos: { status: 'failure' }, adminRead: { status: 'not_started' } });
  return f;
}

async function setup() {
  const old = await fixture(); old.enableSealed();
  const failed = await failedRun(3);
  const runs = [old, failed];
  const photos = JSON.parse(old.readFiles.catalog.toString()).photos;
  const project: Project = { schemaVersion: 1, id: 'fallback', slug: 'fallback', title: 'Fallback', status: 'draft', order: 0, coverPhotoId: photos[0].id, photos: photos.map((p: any) => ({ photoId: p.id })) };
  old.setProjects([project, { ...project, id: 'published', slug: 'published', status: 'published' }]);
  const requests: { url: string; method: string; body: any }[] = [];
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url: url.origin + url.pathname, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.pathname.endsWith('/actions/workflows/automation.yml/runs')) {
      // Deliberately return history oldest-first: selection must use run times.
      const history = runs.map(f => ({ ...f.run, run_started_at: new Date(Date.UTC(2026, 0, f.run.id)).toISOString() }));
      return Response.json({ workflow_runs: url.searchParams.get('status') === 'completed'
        ? history.filter(r => r.status === 'completed').sort((a, b) => b.id - a.id).slice(0, 1) : history });
    }
    const runId = /\/actions\/runs\/(\d+)/.exec(url.pathname)?.[1];
    const artifactId = /\/actions\/artifacts\/(\d+)/.exec(url.pathname)?.[1];
    const storageRun = url.hostname === 'fixture.blob.core.windows.net' ? /^\/(\d+)\//.exec(url.pathname)?.[1] : undefined;
    const id = runId ? Number(runId) : artifactId ? Math.floor(Number(artifactId) / 10) : Number(storageRun ?? 1);
    const target = runs.find(f => f.run.id === id);
    assert(target, `Missing fixture run ${id}`);
    return target.fetcher(input, init);
  };
  const jwt = await token();
  const api = (path: string, body?: unknown, fetcher = transport, settings = env) => handle(new Request(settings.ADMIN_ORIGIN + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Cf-Access-Jwt-Assertion': jwt, ...(body === undefined ? {} : { Origin: settings.ADMIN_ORIGIN, 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), settings, fetcher);
  const load = async () => {
    const response = await api('/api/state');
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  };
  const state = await load();
  assert.equal(state.head, head); assert.equal(state.media.state, 'ready'); assert.equal(state.media.runId, 1); assert(state.saveProof);
  return { old, failed, runs, requests, transport, project, api, load, state };
}

test('ready state after a newer failed automation supports two signed saves with new HEADs and one write each', async () => {
  const { old, project, api, load, state, requests } = await setup();
  let current = state;
  for (let i = 1; i <= 2; i++) {
    const edited = { ...project, description: `Saved after failure ${i}` };
    requests.length = 0;
    const response = await api('/api/save', { kind: 'project', expectedHead: current.head, project: edited, saveProof: current.saveProof });
    assert.equal(response.status, 200, await response.clone().text());
    const saved = await response.json();
    assert.equal(saved.status, 'saved'); assert.notEqual(saved.head, current.head); assert(saved.saveProof);
    assert.equal(verifySaveProof(env, saved.saveProof, saved.head).runId, 1);
    assert.equal(old.mutations.length, i);
    const writes = requests.filter(r => r.body?.query?.startsWith('mutation'));
    assert.equal(writes.length, 1); assert.equal(writes[0]!.body.variables.input.expectedHeadOid, current.head);
    // Only the new failed run's small summary is read. The attested photo
    // catalog, repository content/tree and full photo archives are never reread.
    assert.equal(requests.length, 8);
    assert(!requests.some(r => /\/git\/|\/actions\/artifacts\/(10|11|12)\/|\/(photos|admin-read)$/.test(r.url) || r.body?.query?.startsWith('query')));
    assert.deepEqual(requests.filter(r => r.url.includes('blob.core')).map(r => new URL(r.url).pathname), ['/3/summary']);
    const refreshed = await load();
    assert.equal(refreshed.head, saved.head); assert.equal(refreshed.media.state, 'ready'); assert.equal(refreshed.media.runId, 1); assert(refreshed.saveProof);
    assert.deepEqual(refreshed.projects.find((p: Project) => p.id === edited.id), edited);
    assert.equal(refreshed.projects.length, 2);
    // Continue with exactly the new HEAD/proof returned to the editor.
    current = { ...current, ...saved };
  }
});

test('a newly failed automation after proof issuance does not invalidate unchanged photos; proofless saves agree', async () => {
  for (const withProof of [true, false]) {
    const { old, runs, project, api, state } = await setup();
    runs.push(await failedRun(4));
    const response = await api('/api/save', { kind: 'project', expectedHead: state.head, project, ...(withProof ? { saveProof: state.saveProof } : {}) });
    assert.equal(response.status, 200, await response.clone().text());
    assert.notEqual((await response.json()).head, state.head); assert.equal(old.mutations.length, 1);
  }
});

test('new valid photos supersede the old proof even when the automation as a whole failed', async () => {
  for (const id of [2, 4]) {
    const { old, runs, project, api, load, state } = await setup();
    const newer = await fixture(undefined, id); newer.enableSealed();
    newer.run.conclusion = 'failure'; // A later website/deployment step may fail.
    runs.push(newer);
    const response = await api('/api/save', { kind: 'project', expectedHead: state.head, project, saveProof: state.saveProof });
    assert.equal(response.status, 409); assert.equal((await response.json()).error, 'stale');
    assert.equal(old.mutations.length, 0); assert.equal(newer.mutations.length, 0);
    const fresh = await load();
    assert.equal(fresh.head, state.head); assert.equal(fresh.media.state, 'ready'); assert.equal(fresh.media.runId, id); assert(fresh.saveProof);
    const saved = await api('/api/save', { kind: 'project', expectedHead: fresh.head, project, saveProof: fresh.saveProof });
    assert.equal(saved.status, 200, await saved.clone().text()); assert.equal(old.mutations.length, 1);
  }
});

test('fallback proofs retain HEAD, identity, expiry, integrity and reference rejection boundaries', async () => {
  const modes = ['head', 'race', 'attempt', 'run-head', 'repository', 'head-repository', 'workflow', 'event', 'branch', 'deleted-photos', 'deleted-read', 'expired-photos', 'expired-read', 'expiry-date', 'photos-id', 'read-id', 'digest', 'archive-size', 'duplicate', 'tamper', 'repository-proof', 'proof-expiry', 'unknown', 'alias-duplicate', 'schema', 'other-reference'];
  for (const mode of modes) {
    const { old, project, api, load, state, transport } = await setup();
    let edited = project, proof = state.saveProof, settings = env;
    if (mode === 'head') old.setHead('f'.repeat(40));
    if (mode === 'race') old.setRace();
    if (mode === 'attempt') old.run.run_attempt++;
    if (mode === 'run-head') old.run.head_sha = 'f'.repeat(40);
    if (mode === 'repository') old.run.repository.full_name = 'other/repository';
    if (mode === 'head-repository') old.run.head_repository.full_name = 'other/repository';
    if (mode === 'workflow') old.run.path = '.github/workflows/other.yml';
    if (mode === 'event') old.run.event = 'pull_request';
    if (mode === 'branch') old.run.head_branch = 'other';
    if (mode === 'tamper') proof = (proof[0] === 'A' ? 'B' : 'A') + proof.slice(1);
    if (mode === 'repository-proof') settings = { ...env, GITHUB_REPOSITORY: 'other/repository' };
    if (mode === 'unknown') edited = { ...project, photos: [{ photoId: 'missing' }], coverPhotoId: 'missing' };
    if (mode === 'alias-duplicate') {
      const [alias, canonical] = Object.entries(state.media.aliases)[0] as [string, string];
      edited = { ...project, photos: [{ photoId: alias }, { photoId: canonical }], coverPhotoId: alias };
    }
    if (mode === 'schema') edited = { ...project, title: '' };
    if (mode === 'other-reference') {
      old.setProjects([project, { ...project, id: 'published', slug: 'published', status: 'published', coverPhotoId: 'missing', photos: [{ photoId: 'missing' }] }]);
      proof = (await load()).saveProof;
    }
    const fetcher: typeof fetch = async (input, init) => {
      const response = await transport(input, init);
      if (String(input).includes('/actions/runs/1/artifacts?')) {
        const data = await response.json();
        const photos = data.artifacts.find((a: any) => a.name === 'photos'), read = data.artifacts.find((a: any) => a.name === 'admin-read');
        if (mode === 'deleted-photos') data.artifacts = data.artifacts.filter((a: any) => a !== photos);
        if (mode === 'deleted-read') data.artifacts = data.artifacts.filter((a: any) => a !== read);
        if (mode === 'expired-photos') photos.expired = true;
        if (mode === 'expired-read') read.expired = true;
        if (mode === 'expiry-date') read.expires_at = new Date(Date.now() - 1000).toISOString();
        if (mode === 'photos-id') photos.id++;
        if (mode === 'read-id') read.id++;
        if (mode === 'digest') read.digest = 'sha256:' + 'f'.repeat(64);
        if (mode === 'archive-size') read.size_in_bytes++;
        if (mode === 'duplicate') data.artifacts.push({ ...read, id: 99 });
        return Response.json(data);
      }
      return response;
    };
    const now = Date.now;
    if (mode === 'proof-expiry') {
      const expiresAt = verifySaveProof(env, proof, state.head).expiresAt;
      Date.now = () => expiresAt + 1;
    }
    let response: Response;
    try { response = await api('/api/save', { kind: 'project', expectedHead: state.head, project: edited, saveProof: proof }, fetcher, settings); }
    finally { Date.now = now; }
    const expected = ['head', 'race', 'attempt', 'run-head'].includes(mode) ? 409 : ['tamper', 'repository-proof'].includes(mode) ? 403 : /^(deleted|expired|expiry|proof-expiry)/.test(mode) ? 410 : 422;
    assert.equal(response.status, expected, `${mode}: ${await response.clone().text()}`);
    if (['head', 'race'].includes(mode)) {
      assert.equal((await response.json()).error, 'conflict');
      assert.equal(old.mutations.length, 1, 'The single atomic commit attempt must reject the outdated HEAD');
    } else assert.equal(old.mutations.length, 0, mode);
  }
});

test('fallback state never issues a proof for incompatible processors or corrupted summary/catalog identities', async () => {
  for (const mode of ['processor', 'catalog', 'summary-run', 'summary-attempt', 'seal-repository', 'seal-artifact', 'failed-summary']) {
    const { old, failed, project, api, load } = await setup();
    if (mode === 'processor') old.setStale();
    if (mode === 'catalog') old.setSummary({ ...old.summary, adminRead: { ...old.summary.adminRead, catalog: old.summary.adminRead.catalog + ' ' } });
    if (mode === 'summary-run') old.setSummary({ ...old.summary, runId: 2 });
    if (mode === 'summary-attempt') old.setSummary({ ...old.summary, runAttempt: 2 });
    if (mode === 'seal-repository') old.setSummary({ ...old.summary, adminRead: { ...old.summary.adminRead, repository: 'other/repository' } });
    if (mode === 'seal-artifact') old.setSummary({ ...old.summary, adminRead: { ...old.summary.adminRead, artifactId: 99 } });
    if (mode === 'failed-summary') failed.setSummary({ ...failed.summary, runAttempt: 2 });
    const state = await load();
    assert.notEqual(state.media.state, 'ready', mode); assert.equal(state.saveProof, undefined, mode);
    const response = await api('/api/save', { kind: 'project', expectedHead: state.head, project });
    assert.equal(response.status, mode === 'processor' ? 409 : 422, mode); assert.equal(old.mutations.length, 0, mode);
  }
});
