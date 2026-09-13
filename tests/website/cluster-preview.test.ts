import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clusterCaptureProperties, clusterCoordinates, clusterDateRange, clusterMarkerSize, unknownCaptureDay } from '../../src/components/gallery/map/cluster-preview';
import { ClusterMarkerRegistry, type ClusterCandidate, type ClusterMarkerEntry } from '../../src/components/gallery/map/cluster-marker-registry';
import type { ViewerPhoto } from '../../src/components/viewer/photos';

const candidate = (id: number): ClusterCandidate => ({ clusterId: id, pointCount: 8, coordinates: [114.17, 22.3], firstDay: 20240301, lastDay: 20240302 });
const deferred = <T>() => {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
function fixture() {
  const leaves: { id: number; limit: number; offset: number; result: ReturnType<typeof deferred<{ properties: { id: string } }[]>> }[] = [];
  const expansions: ReturnType<typeof deferred<number>>[] = [];
  const photos = new Map(Array.from({ length: 8 }, (_, index) => [String(index), { id: String(index) } as ViewerPhoto]));
  const changes: ClusterMarkerEntry[][] = [], moves: unknown[] = [], failures: unknown[] = [];
  let removed = 0;
  const registry = new ClusterMarkerRegistry({
    getClusterLeaves(id, limit, offset) { const result = deferred<{ properties: { id: string } }[]>(); leaves.push({ id, limit, offset, result }); return result.promise; },
    getClusterExpansionZoom() { const result = deferred<number>(); expansions.push(result); return result.promise; },
  }, () => photos, value => ({ ...value, element: {} as HTMLElement, marker: { setLngLat() {}, remove() { removed++; } }, photos: [], previewFailed: false }),
  value => changes.push(value), value => moves.push(value), () => failures.push(true));
  const resolveLeaves = async (index: number) => {
    const request = leaves[index]!;
    request.result.resolve(Array.from({ length: request.limit }, (_, id) => ({ properties: { id: String(id) } })));
    await request.result.promise; await Promise.resolve(); await Promise.resolve();
  };
  return { registry, leaves, expansions, changes, moves, failures, resolveLeaves, removed: () => removed };
}

test('cluster size is bounded; date aggregation ignores invalid data and preserves recorded capture days', () => {
  assert.equal(clusterMarkerSize(2), 40);
  assert.equal(clusterMarkerSize(1_000_000), 64);
  assert(clusterMarkerSize(12) > clusterMarkerSize(2));
  for (const date of ['', 'invalid', '2024-02-30T12:00:00']) assert.deepEqual(clusterCaptureProperties(date), { capture_start: unknownCaptureDay, capture_end: 0 });
  assert.deepEqual(clusterCaptureProperties('2024-03-01T00:30:00+14:00'), { capture_start: 20240301, capture_end: 20240301 });
  assert.equal(clusterDateRange(unknownCaptureDay, 0), '');
  assert.equal(clusterDateRange(20240301, 20240301), '2024年3月1日');
  assert.equal(clusterDateRange(20231230, 20240401), '2023年12月30日 — 2024年4月1日');
  assert.equal(clusterCoordinates([-70.125, -22.3]), '22.3000°S, 70.1250°W');
  assert.equal(clusterCoordinates([474.17, 22.3]), '22.3000°N, 114.1700°E');
});

test('native leaves are bounded, tile duplicates reuse a marker and pending/cached previews deduplicate requests', async () => {
  const f = fixture(), [entry] = f.registry.sync([candidate(1), candidate(1)])!;
  assert.equal(f.leaves.length, 1); assert.equal(f.leaves[0]!.limit, 4); assert.equal(f.leaves[0]!.offset, 0);
  for (let render = 0; render < 20; render++) assert.equal(f.registry.sync([candidate(1)]), null);
  await f.resolveLeaves(0);
  assert.equal(entry!.photos.length, 4);
  const preview = f.registry.load(entry!), duplicate = f.registry.load(entry!);
  assert.equal(preview, duplicate); assert.equal(f.leaves.length, 2); assert.equal(f.leaves[1]!.limit, 6);
  await f.resolveLeaves(1); await preview;
  assert.deepEqual(entry!.photos.map(photo => photo.id), ['0', '1', '2', '3', '4', '5']);
  await f.registry.load(entry!); assert.equal(f.leaves.length, 2);
  f.registry.clear(); assert.equal(f.removed(), 1);
});

test('zoom/filter invalidation and cluster removal discard pending leaves and stale expansion, even when an ID is reused', async () => {
  const f = fixture(), [old] = f.registry.sync([candidate(1)])!;
  const preview = f.registry.load(old!); const expansion = f.registry.expand(old!);
  f.registry.clear();
  const [replacement] = f.registry.sync([candidate(1)])!;
  await f.resolveLeaves(0); await f.resolveLeaves(1); await preview;
  f.expansions[0]!.resolve(15); await expansion;
  assert.equal(f.changes.length, 0); assert.equal(replacement!.photos.length, 0); assert.deepEqual(f.moves, []);
  f.registry.sync([]); await f.resolveLeaves(2);
  assert.equal(f.changes.length, 0); assert.equal(f.removed(), 2);
});

test('late mosaic cannot replace six preview photos, and latest click expands with the native zoom and coordinates', async () => {
  const f = fixture(), [entry] = f.registry.sync([candidate(1)])!;
  const preview = f.registry.load(entry!);
  await f.resolveLeaves(1); await preview; await f.resolveLeaves(0);
  assert.equal(entry!.photos.length, 6);
  const first = f.registry.expand(entry!), latest = f.registry.expand(entry!);
  f.expansions[1]!.resolve(15); await latest;
  f.expansions[0]!.resolve(13); await first;
  assert.deepEqual(f.moves, [{ center: [114.17, 22.3], zoom: 15 }]);
});

test('leaf failures remain local, retry on demand, and stale rejections cannot revive a preview or fallback', async () => {
  const f = fixture(), [entry] = f.registry.sync([candidate(1)])!;
  const failedPreview = f.registry.load(entry!);
  f.leaves[0]!.result.reject(new Error('worker failure')); f.leaves[1]!.result.reject(new Error('worker failure'));
  await failedPreview;
  assert.equal(entry!.previewFailed, true); assert.deepEqual(f.failures, []);
  const retry = f.registry.load(entry!); await f.resolveLeaves(2); await retry;
  assert.equal(entry!.previewFailed, false);
  const pendingExpansion = f.registry.expand(entry!);
  f.registry.clear(); f.expansions[0]!.reject(new Error('removed source')); await pendingExpansion;
  assert.deepEqual(f.failures, []);
});

test('a late mosaic failure cannot flag a successful preview, and a mosaic success cannot clear a six-leaf failure', async () => {
  const success = fixture(), [entry] = success.registry.sync([candidate(1)])!;
  const preview = success.registry.load(entry!); await success.resolveLeaves(1); await preview;
  success.leaves[0]!.result.reject(new Error('late mosaic failure')); await Promise.resolve(); await Promise.resolve();
  assert.equal(entry!.previewFailed, false); assert.equal(entry!.photos.length, 6);
  const failure = fixture(), [other] = failure.registry.sync([candidate(2)])!;
  const failedPreview = failure.registry.load(other!);
  failure.leaves[1]!.result.reject(new Error('six-leaf failure')); await failedPreview;
  await failure.resolveLeaves(0);
  assert.equal(other!.photos.length, 4); assert.equal(other!.previewFailed, true);
});
