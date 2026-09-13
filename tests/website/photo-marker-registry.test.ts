import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PhotoMarkerRegistry, type MarkerCandidate } from '../../src/components/gallery/map/photo-marker-registry';
import type { ViewerPhoto } from '../../src/components/viewer/photos';

test('photo markers deduplicate tiled/world copies, retain instances across selection and remove every retired instance once', () => {
  const created: string[] = [], removed: string[] = [], moved: [number, number][] = [];
  const registry = new PhotoMarkerRegistry(candidate => {
    created.push(candidate.photo.id);
    return { ...candidate, element: { dataset: {} } as HTMLElement, marker: {
      setLngLat: coordinates => moved.push(coordinates), remove: () => removed.push(candidate.photo.id),
    } };
  });
  const candidates: MarkerCandidate[] = Array.from({ length: 1000 }, (_, index) => ({
    photo: { id: String(index) } as ViewerPhoto, coordinates: [index / 10, 0],
  }));
  const initial = registry.sync([...candidates, ...candidates], null)!;
  assert.equal(initial.length, 1000);
  for (let cycle = 0; cycle < 30; cycle++) {
    assert.equal(registry.sync([...candidates, ...candidates.slice(0, 100)], String(cycle)), null);
    assert.equal(initial.filter(entry => entry.element.dataset.selected === 'true').length, 1);
    assert.equal(initial[cycle]!.element.dataset.selected, 'true');
  }
  assert.equal(created.length, 1000);
  assert.deepEqual(moved, []);
  registry.sync([{ ...candidates[0]!, coordinates: [360, 0] }], '0');
  assert.deepEqual(moved, [[360, 0]]);
  assert.equal(removed.length, 999);
  registry.clear(); registry.clear();
  assert.equal(removed.length, 1000);
  assert.equal(new Set(removed).size, 1000);
  assert.equal(registry.sync([candidates[0]!], null)!.length, 1);
  assert.equal(created.length, 1001);
  registry.clear();
});
