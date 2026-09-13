import test from 'node:test';
import assert from 'node:assert/strict';
import { coverGeometry, COVER_ASPECT_RATIO } from '../../src/projects/cover';
import { ProjectSchema } from '../../src/projects/schema';
import { fixture, project } from './fixtures';
import { loadProjects } from '../../src/projects';

test('cover crop survives loading without altering the source photo and remains optional', t => {
  const f = fixture(t);
  const crop = { x: 0.2, y: 0.8, zoom: 2.5 };
  f.write(project({ coverCrop: crop }));
  const resolved = loadProjects(f).listProjects()[0]!;
  assert.deepEqual(resolved.coverCrop, crop);
  assert.equal(resolved.cover, resolved.photos[0].photo);
  assert.equal(ProjectSchema.parse(project()).coverCrop, undefined);
  for (const invalid of [{ ...crop, x: -0.01 }, { ...crop, y: 1.01 }, { ...crop, zoom: 0.99 }, { ...crop, zoom: 5.01 }, { ...crop, x: NaN }, { ...crop, zoom: Infinity }, { x: 0.5, y: 0.5 }, { ...crop, unexpected: true }]) {
    assert.equal(ProjectSchema.safeParse({ ...project(), coverCrop: invalid }).success, false);
  }
});

test('landscape, portrait, square and matching images cover the frame at every edge and zoom', () => {
  for (const [width, height] of [[1800, 600], [600, 1800], [900, 900], [500, 600]]) {
    for (const zoom of [1, 1.1, 3, 5]) for (const x of [0, 0.2, 1]) for (const y of [0, 0.8, 1]) {
      const g = coverGeometry(width, height, { x, y, zoom });
      assert(g.left <= 0 && g.top <= 0);
      assert(g.left + g.width >= 1 - 1e-10 && g.top + g.height >= 1 - 1e-10, 'no exposed background');
      assert(Math.abs(g.width / g.height * COVER_ASPECT_RATIO - width / height) < 1e-10, 'no image distortion');
    }
    const g = coverGeometry(width, height);
    assert.equal(g.left, -(g.width - 1) / 2);
    assert.equal(g.top, -(g.height - 1) / 2);
  }
});
