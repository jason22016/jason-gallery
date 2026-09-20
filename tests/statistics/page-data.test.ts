import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test, type TestContext } from 'node:test';
import { allPhotographyStatsScope, buildPhotographyStats, resolvePhotographyStats } from '../../src/statistics';
import { loadPhotographyStatsPageData } from '../../src/website/photography-stats';
import { loadPublicPhotoCollection } from '../../src/website/public-photos';
import { fixture, photo, project } from '../projects/fixtures';
import { assertDeepFrozen, assertFiniteNumbers, publicFixture } from './fixtures';

function pageFixture(t: TestContext) {
  const files = fixture(t);
  const { native, first, second, draft } = publicFixture();
  fs.writeFileSync(files.manifestFile, JSON.stringify({ ...files.manifest, data: native }));
  const canonicalFirst = { ...first, coverPhotoId: native[0]!.id, photos: [{ photoId: native[0]!.id }, { photoId: 'first-only' }] };
  for (const entry of [canonicalFirst, second, draft]) files.write(entry);
  return { ...files, first: canonicalFirst, second, draft };
}

test('Stats page data defaults to All Photos and uses the unified engine for every public scope', t => {
  const files = pageFixture(t);
  const data = loadPhotographyStatsPageData(files);
  const photos = loadPublicPhotoCollection(files).listPhotos();
  assert.deepEqual(Object.keys(data), ['all', 'projects']);
  assert.deepEqual(data.all, resolvePhotographyStats(photos, allPhotographyStatsScope));
  assert.equal(data.all.stats.photoCount, 3, 'the shared photo counts once in All Photos');
  assert.equal(data.all.stats.projectCount, 2);
  assert.deepEqual(data.projects.map(result => result.project), [
    { id: 'first-id', slug: 'first', title: 'First' },
    { id: 'second-id', slug: 'second', title: 'Second' },
  ]);
  for (const result of data.projects) {
    assert.deepEqual(result, resolvePhotographyStats(photos, result.scope));
    assert.equal(result.stats.photoCount, 2);
    assert.equal(result.stats.projectCount, 1);
  }
  assertDeepFrozen(data);
  assertFiniteNumbers(data);
});

test('selector order follows published Project order even when a shared photo introduces a later membership first', t => {
  const files = fixture(t);
  const entries = [photo('shared'), photo('middle')];
  fs.writeFileSync(files.manifestFile, JSON.stringify({ ...files.manifest, data: entries }));
  for (const [order, slug, photoId] of [[0, 'first', 'shared'], [1, 'middle', 'middle'], [2, 'last', 'shared']] as const) {
    files.write(project({ id: slug, slug, order, title: slug, coverPhotoId: photoId, photos: [{ photoId }] }));
  }
  const data = loadPhotographyStatsPageData(files);
  assert.deepEqual(data.projects.map(result => result.project!.slug), ['first', 'middle', 'last']);
  assert.equal(data.all.stats.photoCount, 2);
  assert.equal(data.all.stats.projectCount, 3);
});

test('page payload contains only aggregates and minimal public identities, without draft or photo internals', t => {
  const data = loadPhotographyStatsPageData(pageFixture(t));
  const serialized = JSON.stringify(data);
  for (const result of [data.all, ...data.projects]) {
    assert.deepEqual(Object.keys(result), ['scope', 'project', 'stats']);
    if (result.project) assert.deepEqual(Object.keys(result.project), ['id', 'slug', 'title']);
  }
  for (const secret of [
    'PRIVATE', 'private-draft', 'draft-only', 'unused', 'source:shared', 'first-only', 'second-only',
    'exif', 'PrivateExif', 'regions', 'digest', 's3Key', 'originalUrl', 'thumbnail', 'videoUrl',
    'detailsUrl', 'latitude', 'longitude', 'photos-manifest', 'coverPhotoId', 'photoId',
  ]) assert(!serialized.includes(secret), secret);
  assert.deepEqual(JSON.parse(serialized), data, 'the payload survives island serialization without undefined or non-finite values');
});

test('page scopes reflect publication changes and cannot retain a Project after it becomes draft', t => {
  const files = pageFixture(t);
  assert.equal(loadPhotographyStatsPageData(files).projects.length, 2);
  files.write({ ...files.first, status: 'draft' });
  const data = loadPhotographyStatsPageData(files);
  assert.deepEqual(data.projects.map(result => result.project!.slug), ['second']);
  assert.equal(data.all.stats.photoCount, 2);
  assert.equal(data.all.stats.projectCount, 1);
  assert(!JSON.stringify(data).includes('first-id'));
  for (const slug of ['first', 'private-draft', 'unknown', '../first']) {
    assert(!data.projects.some(result => result.scope.type === 'project' && result.scope.slug === slug));
  }
});

test('an empty public collection returns a finite empty All Photos aggregate and no selectable Projects', t => {
  const files = pageFixture(t);
  files.write({ ...files.first, status: 'draft' });
  files.write({ ...files.second, status: 'draft' });
  const data = loadPhotographyStatsPageData(files);
  assert.deepEqual(data.all.stats, buildPhotographyStats([]));
  assert.deepEqual(data.projects, []);
  assert.equal(data.all.stats.photoCount, 0);
  assert.equal(data.all.stats.captureDateRange.start, null);
  assert.equal(data.all.stats.captureDateRange.end, null);
  assertDeepFrozen(data);
  assertFiniteNumbers(data);
});

test('missing EXIF remains an explicit coverage gap in the page payload', t => {
  const files = fixture(t);
  files.write(project());
  const data = loadPhotographyStatsPageData(files);
  for (const result of [data.all, ...data.projects]) {
    assert.equal(result.stats.photoCount, 2);
    for (const distribution of [
      result.stats.cameras, result.stats.lenses, result.stats.focalLength, result.stats.aperture,
      result.stats.iso, result.stats.shutterSpeed, result.stats.years, result.stats.months, result.stats.shootingHours,
    ]) {
      assert.equal(distribution.sampleCount, 0);
      assert.equal(distribution.missingCount, 2);
      assert.equal(distribution.coveragePercentage, 0);
      assert.deepEqual(distribution.buckets, []);
      assert.equal(distribution.mostUsed, null);
    }
    assert.deepEqual(result.stats.captureDateRange, { start: null, end: null, sampleCount: 0, missingCount: 2, coveragePercentage: 0 });
    assert.equal(result.stats.orientation.sampleCount, 2);
  }
  assertFiniteNumbers(data);
});
