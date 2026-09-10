import test from 'node:test';
import assert from 'node:assert/strict';
import { AdminService } from '../../admin/server/service';
import { GitHub } from '../../admin/server/github';
import { fixture, prepareKeys, env, head, config } from './backend-fixture';
import { readCollection } from '../../src/photo-engine/collection-contract';
import { ArtifactCache } from '../../admin/server/cache';

test.before(prepareKeys);
const service = (f: Awaited<ReturnType<typeof fixture>>, transport = f.fetcher) => new AdminService(new GitHub({ ...env, PUBLISH_ENABLED: 'true' }, transport));
async function withCache(run: (stored: Map<string, Response>) => Promise<void>) {
  const prior = globalThis.caches; const stored = new Map<string, Response>();
  Object.defineProperty(globalThis, 'caches', { configurable: true, value: { default: { match: async (r: Request) => stored.get(r.url)?.clone(), put: async (r: Request, v: Response) => { stored.set(r.url, v.clone()); } } } });
  try { await run(stored); } finally { Object.defineProperty(globalThis, 'caches', { configurable: true, value: prior }); }
}

test('complete catalog and ordering survive eviction, expired/corrupt derived records and unavailable Cache API', async () => {
  await withCache(async stored => {
    const cache = new ArtifactCache(env.GITHUB_REPOSITORY);
    await cache.putDerived('proof-a', { version: 'old' }, 3600);
    stored.set(cache.key('proof-b').url, stored.get(cache.key('proof-a').url)!.clone());
    assert.equal(await cache.derived('proof-b'), undefined, 'a proof copied to another immutable key must be rejected');
    const f = await fixture(); const original = await service(f).bootstrap();
    assert.equal(original.media.state, 'ready');
    for (const mode of ['evict', 'expire', 'corrupt', 'no-op', 'no-op-again', 'unavailable']) {
      if (mode === 'evict') stored.clear();
      if (mode === 'expire') for (const [key, value] of stored) if (key.includes('catalog-v1') || key.includes('content-v1')) { const envelope = await value.clone().json(); envelope.until = 1; stored.set(key, Response.json(envelope)); }
      if (mode === 'corrupt') for (const key of stored.keys()) if (key.includes('catalog-v1') || key.includes('content-v1')) stored.set(key, new Response('{"data":"bad"}'));
      if (mode.startsWith('no-op')) Object.defineProperty(globalThis, 'caches', { configurable: true, value: { default: { match: async () => undefined, put: async () => {} } } });
      if (mode === 'unavailable') Object.defineProperty(globalThis, 'caches', { configurable: true, value: { default: { match: async () => { throw new Error('cache offline'); }, put: async () => { throw new Error('cache offline'); } } } });
      const state = await service(f).bootstrap(); assert.equal(state.media.state, 'ready', mode);
      assert.deepEqual(state.media.photos, original.media.photos, mode); assert.deepEqual(state.media.aliases, original.media.aliases, mode);
      assert.equal(f.mutations.length, 0, 'no sync or write required for cache recovery');
    }
  });
});

test('40 Project batches include the last draft/published reference and reject partial, truncated or wrong-OID responses', async () => {
  const f = await fixture(); const p = (await readCollection(async p => f.c.files.get(p)!, config)).photos[0];
  const project = { schemaVersion: 1, id: 'new', slug: 'new', title: 'New', photos: [{ photoId: p.id }], coverPhotoId: p.id, order: 0, status: 'draft' };
  f.setProjects(Array.from({ length: 40 }, (_, i) => ({ ...project, id: `p-${i}`, slug: `p-${i}` })));
  const content = await service(f).content(); assert.equal(content.projects.length, 40);
  assert.equal(f.network.filter(n => n.url.endsWith('/graphql')).length, 1);
  for (const status of ['draft', 'published']) {
    f.setProjects(content.projects.map((p, i) => i === 39 ? { ...p, status, photos: [{ photoId: 'missing-last' }], coverPhotoId: 'missing-last' } : p));
    await assert.rejects(service(f).save({ kind: 'project', expectedHead: head, project }), /引用校验失败/);
    await assert.rejects(service(f).dispatch({ mode: 'publish', expectedHead: head, photoRunId: 1 }), /unknown photo ID/);
    const impact = await service(f).impact({ ...config, sources: config.sources.map(s => ({ ...s, enabled: false })) }); assert(impact.impacts.length >= 39);
  }
  assert.equal(f.mutations.length, 0);
  for (const mode of ['missing', 'errors', 'truncated', 'oid', 'text', 'size']) {
    const transport: typeof fetch = async (input, init) => {
      const res = await f.fetcher(input, init);
      if (!String(input).endsWith('/graphql')) return res;
      const data = await res.json(); const b = data.data.repository.sourceFile;
      if (mode === 'missing') delete data.data.repository.sourceFile;
      if (mode === 'errors') data.errors = [{ message: 'partial' }];
      if (mode === 'truncated') b.isTruncated = true;
      if (mode === 'oid') b.oid = 'e'.repeat(40);
      if (mode === 'text') b.text += ' ';
      if (mode === 'size') b.byteSize++;
      return Response.json(data);
    };
    await assert.rejects(service(f, transport).content(), Error, mode);
  }
});

test('warm catalog cannot hide processor/config changes, expired artifacts, foreign runs or legacy/canonical duplicates', async () => {
  await withCache(async stored => {
    for (const mode of ['processor', 'config', 'expired', 'foreign', 'summary']) {
      stored.clear(); const f = await fixture(); assert.equal((await service(f).bootstrap()).media.state, 'ready');
      if (mode === 'processor') f.setStale();
      if (mode === 'expired') f.setExpired();
      if (mode === 'foreign') f.run.head_repository.full_name = 'other/repo';
      if (mode === 'summary') { f.setSummary({ ...f.summary, photos: { status: 'failure' } }); for (const key of stored.keys()) if (key.includes('/11/')) stored.delete(key); }
      if (mode === 'config') f.setConfig({ ...config, sources: config.sources.map(s => ({ ...s, name: s.name + ' changed' })) });
      assert.notEqual((await service(f).bootstrap()).media.state, 'ready', mode);
      await assert.rejects(service(f).dispatch({ mode: 'publish', expectedHead: mode === 'processor' ? 'b'.repeat(40) : head, photoRunId: 1 }));
      assert.equal(f.mutations.length, 0);
    }
    stored.clear(); const f = await fixture(); const state = await service(f).bootstrap(); const [alias, canonical] = Object.entries(state.media.aliases)[0];
    const project = { schemaVersion: 1, id: 'alias', slug: 'alias', title: 'Alias', photos: [{ photoId: alias }, { photoId: canonical }], coverPhotoId: alias, order: 0, status: 'draft' };
    await assert.rejects(service(f).save({ kind: 'project', expectedHead: head, project }), /引用校验失败/);
    // A deleted current blob cannot be resurrected from the prior immutable content key.
    f.setProjects([{ ...project, photos: [{ photoId: 'missing' }], coverPhotoId: 'missing' }]);
    await assert.rejects(service(f).dispatch({ mode: 'publish', expectedHead: head, photoRunId: 1 }), /unknown photo ID/);
    const cache = new ArtifactCache('other/repository'); assert.equal(await cache.derived('catalog-v1/10/x'), undefined);
  });
});
