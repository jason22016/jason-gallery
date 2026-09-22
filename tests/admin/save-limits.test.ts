import test from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../../admin/server/worker';
import { ProjectSchema, type Project } from '../../src/projects/schema';
import { fixture, env, head, prepareKeys, token } from './backend-fixture';

test.before(prepareKeys);
const fileLimit = 512000, totalLimit = 4 * 1024 ** 2;
const serialized = (project: Project) => JSON.stringify(ProjectSchema.parse(project), null, 2) + '\n';

function sizedProject(project: Project, size: number, stored = false): Project {
  const result = { ...project, description: '' };
  const remaining = size - Buffer.byteLength(stored ? JSON.stringify(result) : serialized(result));
  assert(remaining >= 0);
  result.description = '海'.repeat(Math.floor(remaining / 3)) + 'x'.repeat(remaining % 3);
  assert.equal(Buffer.byteLength(stored ? JSON.stringify(result) : serialized(result)), size);
  return result;
}

async function setup(mode: 'ordinary' | 'proof') {
  const f = await fixture();
  f.enableSealed();
  const photoId = JSON.parse(f.readFiles.catalog.toString()).photos[0].id;
  const project: Project = { schemaVersion: 1, id: 'target', slug: 'target', title: '保存容量测试', coverPhotoId: photoId, photos: [{ photoId }], order: 0, status: 'draft' };
  const jwt = await token();
  const api = (path: string, body?: unknown) => handle(new Request(env.ADMIN_ORIGIN + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Cf-Access-Jwt-Assertion': jwt, ...(body === undefined ? {} : { Origin: env.ADMIN_ORIGIN, 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env, f.fetcher);
  const state = async () => {
    const response = await api('/api/state');
    assert.equal(response.status, 200, await response.clone().text());
    const value = await response.json();
    assert.equal(value.media.state, 'ready');
    assert(value.saveProof);
    return value;
  };
  const save = (current: Awaited<ReturnType<typeof state>>, edited: Project) => {
    const body = { kind: 'project', expectedHead: current.head, project: edited, ...(mode === 'proof' ? { saveProof: current.saveProof } : {}) };
    // The request fits; the limit must apply to the formatted UTF-8 Git blob.
    assert(Buffer.byteLength(JSON.stringify(body)) < fileLimit);
    return api('/api/save', body);
  };
  return { f, project, api, state, save };
}

for (const mode of ['ordinary', 'proof'] as const) for (const operation of ['create', 'update']) {
  test(`${mode} ${operation} rejects oversized formatted UTF-8 files before writing and accepts the exact limit`, async () => {
    const { f, project, state, save } = await setup(mode);
    const initial = operation === 'update' ? [project] : [];
    f.setProjects(initial);
    const before = await state();
    // Tags expand during formatting, keeping even the proof request under 512 KB.
    const edited = { ...project, tags: Array<string>(1000).fill('海') };
    const oversized = sizedProject(edited, fileLimit + 1);
    assert(serialized(oversized).length < fileLimit, 'UTF-8 bytes must be counted, not characters');
    const response = await save(before, oversized);
    assert.equal(response.status, 422, await response.clone().text());
    assert.match((await response.json()).message, /512 KB/);
    assert.equal(f.mutations.length, 0);
    const unchanged = await state();
    assert.equal(unchanged.head, head);
    assert.deepEqual(unchanged.projects, initial);

    const bounded = sizedProject(edited, fileLimit);
    const saved = await save(unchanged, bounded);
    assert.equal(saved.status, 200, await saved.clone().text());
    const contents = f.mutations[0].body.variables.input.fileChanges.additions[0].contents;
    assert.equal(Buffer.from(contents, 'base64').length, fileLimit);
    const after = await state();
    assert.equal(after.head, (await saved.json()).head);
    assert.deepEqual(after.projects, [bounded]);
  });

  test(`${mode} ${operation} rejects excess total bytes and leaves loading, editing and deletion available`, async () => {
    const { f, project, api, state, save } = await setup(mode);
    // Existing files are compact JSON: their actual stored sizes, rather than
    // their sizes after reformatting, must be used for the unchanged Projects.
    const others = Array.from({ length: 8 }, (_, i) => sizedProject({ ...project, id: `other-${i}`, slug: `other-${i}`, status: i % 2 ? 'published' : 'draft' }, 500000, true));
    const initial = [...others, ...(operation === 'update' ? [sizedProject(project, 100000, true)] : [])];
    f.setProjects(initial);
    const before = await state();
    const available = totalLimit - 8 * 500000;
    const response = await save(before, sizedProject(project, available + 1));
    assert.equal(response.status, 422, await response.clone().text());
    assert.match((await response.json()).message, /4 MB/);
    assert.equal(f.mutations.length, 0);
    const unchanged = await state();
    assert.equal(unchanged.head, head);
    assert.deepEqual(unchanged.projects, initial);

    // Replacing an existing Project deducts its old bytes before adding the new
    // blob. A repository exactly at the total limit must remain readable.
    const bounded = sizedProject(project, available);
    const saved = await save(unchanged, bounded);
    assert.equal(saved.status, 200, await saved.clone().text());
    const savedResult = await saved.json();
    const after = await state();
    assert.equal(after.head, savedResult.head);
    assert.deepEqual(after.projects, [...others, bounded]);

    // The returned proof must count the saved blob when another Project grows.
    if (mode === 'proof') assert(savedResult.saveProof);
    const current = { ...after, ...(mode === 'proof' ? { saveProof: savedResult.saveProof } : {}) };
    const overflow = await save(current, sizedProject(others[0], 500001));
    assert.equal(overflow.status, 422, await overflow.clone().text());
    assert.match((await overflow.json()).message, /4 MB/);
    assert.equal(f.mutations.length, 1);

    const edited = await save(current, sizedProject(project, available - 1));
    assert.equal(edited.status, 200, await edited.clone().text());
    const editedResult = await edited.json();
    const removed = await api('/api/delete', { kind: 'project', expectedHead: editedResult.head, projectId: project.id });
    assert.equal(removed.status, 200, await removed.clone().text());
    assert.deepEqual((await state()).projects, others);
    assert.equal(f.mutations.length, 3);
  });
}
