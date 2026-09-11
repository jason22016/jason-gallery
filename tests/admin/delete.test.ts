import test from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../../admin/server/worker';
import { GitHub } from '../../admin/server/github';
import { AdminService } from '../../admin/server/service';
import { photoReference } from '../../src/photo-engine/source-contract';
import { head, next, env, prepareKeys, token, config, fixture } from './backend-fixture';

test.before(prepareKeys);
const project = { schemaVersion: 1, id: 'remove-me', slug: 'remove-me', title: 'Delete fixture', coverPhotoId: photoReference(config.sources[0], 'same_12345678'), photos: [{ photoId: photoReference(config.sources[0], 'same_12345678') }], order: 0, status: 'draft' };
async function remove(f: Awaited<ReturnType<typeof fixture>>, body: unknown, headers: Record<string, string> = {}) {
  return handle(new Request(env.ADMIN_ORIGIN + '/api/delete', { method: 'POST', headers: { 'Cf-Access-Jwt-Assertion': await token(), Origin: env.ADMIN_ORIGIN, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }), env, f.fetcher);
}
const read = (f: Awaited<ReturnType<typeof fixture>>) => new AdminService(new GitHub(env, f.fetcher)).content();

test('delete requires a signed session, same origin JSON, strict target IDs and a current head', async () => {
  const f = await fixture(); f.setProjects([project]);
  const body = { kind: 'project', projectId: project.id, expectedHead: head };
  const invalidHeaders: Record<string, string>[] = [{ 'Cf-Access-Jwt-Assertion': '' }, { Origin: 'https://evil.example' }, { 'Content-Type': 'text/plain' }];
  for (const headers of invalidHeaders) {
    const result = await remove(f, body, headers);
    assert.equal(result.status, 'Cf-Access-Jwt-Assertion' in headers ? 401 : 403);
  }
  for (const invalid of [{ ...body, path: 'config/photo-sources.json' }, { ...body, kind: 'all' }, { ...body, expectedHead: 'bad' }, { ...body, projectId: '' }, { kind: 'source', sourceId: '../escape', expectedHead: head }]) assert.equal((await remove(f, invalid)).status, 422);
  assert.equal((await remove(f, { ...body, expectedHead: next })).status, 409);
  assert.equal((await remove(f, { ...body, projectId: 'missing' })).status, 404);
  assert.equal((await remove(f, { kind: 'source', sourceId: 'missing', expectedHead: head })).status, 404);
  assert.equal(f.mutations.length, 0);
  for (const path of ['config/photo-sources.json', '.github/workflows/automation.yml', 'src/content/projects/../secret.json', 'src/content/projects/.gitkeep']) await assert.rejects(new GitHub(env, f.fetcher).commit(head, [], [path]), /不允许删除/);
  assert.equal(f.mutations.length, 0);
});

test('delete removes only the selected Project, preserves other content and works without photo artifacts', async () => {
  const f = await fixture(); f.setProjects([project, { ...project, id: 'keep', slug: 'keep', status: 'published' }]); f.setExpired();
  const response = await remove(f, { kind: 'project', projectId: project.id, expectedHead: head });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'deleted', head: next, kind: 'project', id: project.id });
  const input = f.mutations[0].body.variables.input;
  assert.equal(input.expectedHeadOid, head); assert.match(input.message.headline, /\[skip ci\]/);
  assert.deepEqual(input.fileChanges, { additions: [], deletions: [{ path: 'src/content/projects/remove-me.json' }] });
  assert.equal(f.mutations.length, 1);
  assert(!f.network.some(n => /\/actions\/|blob\.core/.test(n.url)), 'Deletion must not depend on photo downloads or trigger Actions');
  const content = await read(f);
  assert.deepEqual(content.projects.map(p => p.id), ['keep']); assert.deepEqual(content.config, config);
  assert.equal((await remove(f, { kind: 'project', projectId: project.id, expectedHead: head })).status, 409);
  assert.equal((await remove(f, { kind: 'project', projectId: project.id, expectedHead: next })).status, 404);
  assert.equal(f.mutations.length, 1);
});

test('source deletion blocks draft, published and legacy references even for disabled sources', async () => {
  for (const status of ['draft', 'published']) for (const legacy of [false, true]) {
    const f = await fixture();
    f.setProjects([{ ...project, status, ...(legacy ? { coverPhotoId: 'file--with-dashes_abcd', photos: [{ photoId: 'file--with-dashes_abcd' }] } : {}) }]);
    f.setConfig({ ...config, sources: config.sources.map(s => ({ ...s, enabled: false })) });
    const response = await remove(f, { kind: 'source', sourceId: 'jason-photos', expectedHead: head });
    assert.equal(response.status, 422);
    const error = await response.json(); assert.equal(error.error, 'source_impact');
    assert.deepEqual(error.details.map((p: any) => [p.projectId, p.status, p.count]), [[project.id, status, 1]]);
    assert.equal(f.mutations.length, 0);
  }
});

test('deleting the final Project and all sources leaves a valid empty catalog; no source repository is written', async () => {
  const f = await fixture(); f.setProjects([project]);
  let expectedHead = head;
  for (const target of [{ kind: 'project', projectId: project.id }, ...config.sources.map(s => ({ kind: 'source', sourceId: s.sourceId }))]) {
    const response = await remove(f, { ...target, expectedHead }); assert.equal(response.status, 200);
    expectedHead = (await response.json()).head;
  }
  const content = await read(f); assert.deepEqual(content.projects, []); assert.deepEqual(content.config, { schemaVersion: 1, sources: [] });
  assert.equal(f.mutations.length, 3);
  for (const mutation of f.mutations) assert.equal(mutation.body.variables.input.branch.repositoryNameWithOwner, env.GITHUB_REPOSITORY);
  for (const mutation of f.mutations.slice(1)) { assert.deepEqual(mutation.body.variables.input.fileChanges.additions.map((c: any) => c.path), ['config/photo-sources.json']); assert.equal(mutation.body.variables.input.fileChanges.deletions, undefined); }
});

test('unrelated existing references do not block deleting an unused source', async () => {
  const f = await fixture(); f.setProjects([project]);
  f.setConfig({ ...config, sources: config.sources.map(s => ({ ...s, enabled: false })) });
  const response = await remove(f, { kind: 'source', sourceId: config.sources[1].sourceId, expectedHead: head });
  assert.equal(response.status, 200);
  const content = await read(f);
  assert.deepEqual(content.projects, [project]);
  assert.deepEqual(content.config.sources.map(s => s.sourceId), [config.sources[0].sourceId]);
});

test('a commit arriving during validation blocks Project and source deletion atomically', async () => {
  for (const target of [{ kind: 'project', projectId: project.id }, { kind: 'source', sourceId: config.sources[1].sourceId }]) {
    const f = await fixture(); f.setProjects([project]); f.setRace();
    assert.equal((await remove(f, { ...target, expectedHead: head })).status, 409);
    const content = await read(f); assert.deepEqual(content.projects, [project]); assert.deepEqual(content.config, config);
    assert.equal(f.mutations.length, 1);
  }
});

test('a lost deletion response reports uncertainty and never automatically retries the mutation', async () => {
  const f = await fixture(); f.setProjects([project]);
  const transport: typeof fetch = async (url, init) => {
    const result = await f.fetcher(url, init);
    if (String(url).endsWith('/graphql') && String(init?.body).includes('mutation(')) throw new Error('connection lost after commit');
    return result;
  };
  const response = await remove({ ...f, fetcher: transport }, { kind: 'project', projectId: project.id, expectedHead: head });
  assert.equal(response.status, 502); const error = await response.json();
  assert.equal(error.error, 'delete_unconfirmed'); assert.match(error.message, /删除结果尚未确认/);
  assert.equal(f.mutations.length, 1); assert.deepEqual((await read(f)).projects, []);
});
