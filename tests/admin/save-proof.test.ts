import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, env, head, prepareKeys, token } from './backend-fixture';
import { AdminService } from '../../admin/server/service';
import { GitHub } from '../../admin/server/github';
import { handle } from '../../admin/server/worker';
import type { Project } from '../../src/projects/schema';

test.before(prepareKeys);
async function setup() {
  const f = await fixture(); f.enableSealed();
  const photos = JSON.parse(f.readFiles.catalog.toString()).photos;
  const project: Project = { schemaVersion: 1, id: 'admin-acceptance-20260911', slug: 'admin-acceptance-20260911', title: '[TEST] 后台验收 2026-09-11', status: 'draft', order: 0, coverPhotoId: photos[0].id, photos: photos.map((p: any) => ({ photoId: p.id })) };
  f.setProjects([project, ...Array.from({ length: 39 }, (_, i) => ({ ...project, id: `other-${i}`, slug: `other-${i}`, status: i % 2 ? 'published' : 'draft' }))]);
  const state = await new AdminService(new GitHub(env, f.fetcher)).bootstrap();
  assert.equal(state.media.state, 'ready'); assert(state.saveProof);
  const jwt = await token();
  const save = (body: unknown, transport = f.fetcher, settings = env) => handle(new Request(settings.ADMIN_ORIGIN + '/api/save', { method: 'POST', headers: { Origin: settings.ADMIN_ORIGIN, 'Content-Type': 'application/json', 'Cf-Access-Jwt-Assertion': jwt }, body: JSON.stringify(body) }), settings, transport);
  return { f, project, state, save };
}

test('20 signed saves advance HEAD and read back exact draft content, with four upstreams and no artifact download', async () => {
  const { f, project, state, save } = await setup();
  let expectedHead = state.head, saveProof = state.saveProof;
  for (let i = 1; i <= 20; i++) {
    const edited = { ...project, description: `Controlled isolated save ${i}` };
    const before = f.network.length;
    const response = await save({ kind: 'project', expectedHead, project: edited, saveProof });
    assert.equal(response.status, 200, await response.clone().text());
    const saved = await response.json(); assert.equal(saved.status, 'saved'); assert.notEqual(saved.head, expectedHead); assert(saved.saveProof);
    const requests = f.network.slice(before); assert.equal(requests.length, 4);
    assert(!requests.some(r => r.url.includes('blob.core') || r.url.includes('/git/') || r.url.includes('/actions/artifacts/')));
    const content = await new AdminService(new GitHub(env, f.fetcher)).content();
    assert.equal(content.head, saved.head); assert.deepEqual(content.projects.find(p => p.id === project.id), edited); assert.equal(content.projects.length, 40);
    expectedHead = saved.head; saveProof = saved.saveProof;
  }
  assert.equal(f.mutations.length, 20);
});

test('signed saves reject changed HEAD, concurrent writers, stale runs and removed or replaced artifacts', async () => {
  for (const mode of ['head', 'race', 'run', 'expired', 'deleted', 'digest', 'attempt']) {
    const { f, project, state, save } = await setup();
    if (mode === 'head') f.setStale();
    if (mode === 'race') f.setRace();
    if (mode === 'run') f.run.id = 2;
    if (mode === 'attempt') f.run.run_attempt = 2;
    if (mode === 'expired') f.setExpired();
    const response = await save({ kind: 'project', expectedHead: state.head, project, saveProof: state.saveProof }, async (input, init) => {
      const response = await f.fetcher(input, init);
      if (String(input).includes('/artifacts?')) {
        const data = await response.json();
        if (mode === 'deleted') data.artifacts = data.artifacts.filter((a: any) => a.name !== 'photos');
        if (mode === 'digest') data.artifacts.find((a: any) => a.name === 'admin-read').digest = 'sha256:' + 'f'.repeat(64);
        return Response.json(data);
      }
      return response;
    });
    assert.equal(response.status, ['expired', 'deleted'].includes(mode) ? 410 : mode === 'digest' ? 422 : 409, mode);
    if (!['head', 'race'].includes(mode)) assert.equal(f.mutations.length, 0, mode);
  }
  const { project, state, save } = await setup();
  const outcomes = await Promise.all([1, 2].map(i => save({ kind: 'project', expectedHead: state.head, project: { ...project, description: String(i) }, saveProof: state.saveProof })));
  assert.deepEqual(outcomes.map(r => r.status).sort(), [200, 409]);
});

test('all draft and published references, aliases, slug collisions and proof identity are still enforced', async () => {
  for (const mode of ['unknown', 'alias-duplicate', 'slug', 'rename', 'tamper', 'origin', 'wrong-head', 'other-invalid']) {
    const { f, project, state, save } = await setup();
    let edited = project, saveProof = state.saveProof, expectedHead = state.head, settings = env;
    if (mode === 'unknown') edited = { ...project, photos: [{ photoId: 'missing' }], coverPhotoId: 'missing' };
    if (mode === 'alias-duplicate') { const [alias, canonical] = Object.entries(state.media.aliases)[0] as [string, string]; edited = { ...project, photos: [{ photoId: alias }, { photoId: canonical }], coverPhotoId: alias }; }
    if (mode === 'slug') edited = { ...project, id: 'new-id', slug: 'other-0' };
    if (mode === 'rename') edited = { ...project, slug: 'renamed' };
    if (mode === 'tamper') saveProof = (saveProof![0] === 'A' ? 'B' : 'A') + saveProof!.slice(1);
    if (mode === 'origin') settings = { ...env, ADMIN_ORIGIN: 'https://other.example.com' };
    if (mode === 'wrong-head') expectedHead = 'd'.repeat(40);
    if (mode === 'other-invalid') {
      f.setProjects([project, { ...project, id: 'broken', slug: 'broken', status: 'published', coverPhotoId: 'missing', photos: [{ photoId: 'missing' }] }]);
      saveProof = (await new AdminService(new GitHub(env, f.fetcher)).bootstrap()).saveProof;
    }
    const response = await save({ kind: 'project', expectedHead, project: edited, saveProof }, f.fetcher, settings);
    assert.equal(response.status, ['tamper', 'origin'].includes(mode) ? 403 : mode === 'wrong-head' ? 409 : 422, mode);
    assert.equal(f.mutations.length, 0, mode);
  }
});

test('a connection lost after a successful commit is reported unconfirmed and never retried', async () => {
  const { f, project, state, save } = await setup();
  const response = await save({ kind: 'project', expectedHead: head, project: { ...project, description: 'Stored before connection failed' }, saveProof: state.saveProof }, async (input, init) => {
    const response = await f.fetcher(input, init);
    if (String(input).endsWith('/graphql') && JSON.parse(String(init?.body)).query.startsWith('mutation')) throw new TypeError('connection lost after commit');
    return response;
  });
  assert.equal(response.status, 502); assert.equal((await response.json()).error, 'save_unconfirmed'); assert.equal(f.mutations.length, 1);
  const content = await new AdminService(new GitHub(env, f.fetcher)).content();
  assert.notEqual(content.head, head); assert.equal(content.projects.find(p => p.id === project.id)?.description, 'Stored before connection failed');
});
