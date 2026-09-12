import test from 'node:test';
import assert from 'node:assert/strict';
import { syncAdditions, type SyncedLibrary } from '../../admin/client/sync-additions';
import { appendProjectPhotos } from '../../admin/client/model';

const photos = Array.from({ length: 10 }, (_, i) => ({ sourceId: 'source', photo: { id: `new-${i}`, title: `NEW_${i}.jpg`, thumbnailUrl: '', width: 10, height: 10 } }));
const library: SyncedLibrary = { ready: true, runId: 2, photos, aliases: { legacy: 'new-0' } };
const task = () => ({ id: 2, state: 'completed', conclusion: 'success', summary: { action: 'sync', photos: { status: 'success' }, adminRead: { status: 'success' }, sync: { applied: true, sourceIds: ['source'], counts: { added: 10 }, sources: [{ sourceId: 'source', changes: [...photos.map(p => ({ kind: 'added', reference: p.photo.id })), { kind: 'updated', reference: 'old' }, { kind: 'removed', reference: 'removed' }] }] } } });

test('actual applied additions include exactly the ten new photos, and append deduplicates aliases while retaining metadata', () => {
  const result = syncAdditions(task(), library)!;
  assert.deepEqual(result.ids, photos.map(p => p.photo.id));
  const existing = [{ photoId: 'legacy', caption: 'Keep caption', alt: 'Keep alt' }, { photoId: 'old' }];
  const combined = appendProjectPhotos(existing, result.ids, library.aliases);
  assert.equal(combined.length, 11);
  assert.equal(combined[0], existing[0]);
  assert.deepEqual(appendProjectPhotos(combined, result.ids, library.aliases), combined);
  assert.equal(existing.length, 2);
});

test('queued, failed, unapplied and unavailable summaries cannot expose an add action', () => {
  for (const mutate of [
    (t: any) => { t.state = 'in_progress'; },
    (t: any) => { t.conclusion = 'failure'; },
    (t: any) => { t.summary.photos.status = 'failure'; },
    (t: any) => { t.summary.adminRead.status = 'failure'; },
    (t: any) => { t.summary.sync.applied = false; },
    (t: any) => { t.summary = null; },
  ]) { const value = task(); mutate(value); assert.equal(syncAdditions(value, library), null); }
});

test('missing baseline/details, wrong loaded run, unavailable or incomplete library never silently add a subset', () => {
  for (const mutate of [
    (t: any) => { t.summary.sync.counts = null; },
    (t: any) => { delete t.summary.sync.sources; },
    (t: any) => { t.summary.sync.sources[0].changes.pop(); t.summary.sync.counts.added = 11; },
    (t: any) => { t.summary.sync.sources[0].changes[0].reference = 'new-1'; },
    (t: any) => { t.summary.sync.sourceIds = ['other']; },
    (t: any) => { t.summary.sync.sources[0].changes[0] = null; },
    (t: any) => { t.summary.sync.sources[0] = null; },
  ]) { const value = task(); mutate(value); const result = syncAdditions(value, library)!; assert.deepEqual(result.ids, []); assert.ok(result.reason); }
  for (const value of [{ ...library, ready: false }, { ...library, runId: 1 }, { ...library, photos: photos.slice(1) }, { ...library, photos: photos.map(p => ({ ...p, sourceId: 'other' })) }]) {
    const result = syncAdditions(task(), value)!; assert.deepEqual(result.ids, []); assert.ok(result.reason);
  }
  const empty = task(); empty.summary.sync.counts.added = 0; empty.summary.sync.sources[0].changes = [];
  assert.deepEqual(syncAdditions(empty, library), { ids: [], count: 0 });
});
