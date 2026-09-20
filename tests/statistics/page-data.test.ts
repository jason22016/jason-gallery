import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test, type TestContext } from 'node:test';
import { allPhotographyStatsScope, buildPhotographyStats, resolvePhotographyStats } from '../../src/statistics';
import { loadPhotographyStatsPageData } from '../../src/website/photography-stats';
import { loadPublicPhotoCollection } from '../../src/website/public-photos';
import { fixture, photo, project } from '../projects/fixtures';
import { assertDeepFrozen, assertFiniteNumbers, publicFixture } from './fixtures';
import { readGalleryState, globalGalleryHref } from '../../src/components/gallery/url-state';
import { selectPhotos } from '../../src/components/gallery/filters';
import { statsGalleryState } from '../../src/components/stats/url-state';

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
  const { explore, ...all } = data.all;
  assert.deepEqual(all, resolvePhotographyStats(photos, allPhotographyStatsScope));
  assert.equal(data.all.stats.photoCount, 3, 'the shared photo counts once in All Photos');
  assert.equal(data.all.stats.projectCount, 2);
  assert.deepEqual(data.projects.map(result => result.project), [
    { id: 'first-id', slug: 'first', title: 'First' },
    { id: 'second-id', slug: 'second', title: 'Second' },
  ]);
  for (const result of data.projects) {
    const { explore, ...aggregate } = result;
    assert.deepEqual(aggregate, resolvePhotographyStats(photos, result.scope));
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
    assert.deepEqual(Object.keys(result), ['scope', 'project', 'stats', 'explore']);
    if (result.project) assert.deepEqual(Object.keys(result.project), ['id', 'slug', 'title']);
    assert.deepEqual(Object.keys(result.explore), ['cameras', 'lenses']);
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

test('equipment links and Map use the shared filters, preserving exact public membership and Project IDs', t => {
  const files = pageFixture(t);
  const data = loadPhotographyStatsPageData(files);
  const photos = loadPublicPhotoCollection(files).listPhotos();
  for (const result of [data.all, ...data.projects]) {
    const state = statsGalleryState(result);
    const map = new URL(globalGalleryHref('map', state), 'https://gallery.test');
    assert.equal(map.pathname, '/map/');
    assert.deepEqual([...map.searchParams], result.project ? [['project', result.project.id]] : []);
    assert.deepEqual(selectPhotos(photos, readGalleryState(map.searchParams).filters, 'project').map(photo => photo.id),
      photos.filter(photo => !result.project || photo.projects.some(project => project.id === result.project!.id)).map(photo => photo.id));
    for (const [field, metric] of [['camera', 'cameras'], ['lens', 'lenses']] as const) {
      for (const bucket of result.stats[metric].buckets) {
        const href = result.explore[metric][bucket.value];
        assert(href);
        const url = new URL(href, 'https://gallery.test');
        assert.equal(url.pathname, '/explore/');
        assert.deepEqual(Object.fromEntries(url.searchParams), { ...(result.project ? { project: result.project.id } : {}), [field]: bucket.value });
        const target = readGalleryState(url.searchParams);
        assert.equal(selectPhotos(photos, target.filters, target.sort).length, bucket.count);
      }
    }
  }
});

test('equipment whitespace and URL-special characters retain exact Explore values; merged groups never link to a partial subset', t => {
  const files = fixture(t);
  const lens = '  NIKKOR Z 24–70mm f/4 & <S> + #1  ';
  const entries = [photo('one'), photo('two')];
  entries[0]!.exif = { Make: 'NIKON ', Model: ' Z5', LensModel: lens } as typeof entries[0]['exif'];
  entries[1]!.exif = { Make: 'NIKON', Model: 'Z5', LensModel: lens } as typeof entries[1]['exif'];
  fs.writeFileSync(files.manifestFile, JSON.stringify({ ...files.manifest, data: entries }));
  for (const entry of entries) files.write(project({ id: `id-${entry.id}`, slug: entry.id, coverPhotoId: entry.id, photos: [{ photoId: entry.id }] }));
  const data = loadPhotographyStatsPageData(files);
  const photos = loadPublicPhotoCollection(files).listPhotos();
  assert.equal(data.all.stats.cameras.buckets[0]!.count, 2);
  assert.deepEqual(data.all.explore.cameras, {}, 'Explore cannot express the union of these two exact strings');
  assert.equal(Object.keys(data.all.explore.lenses).length, 1);
  for (const result of [data.all, ...data.projects]) {
    for (const [field, metric] of [['camera', 'cameras'], ['lens', 'lenses']] as const) {
      for (const [value, href] of Object.entries(result.explore[metric])) {
        const state = readGalleryState(new URL(href, 'https://gallery.test').searchParams);
        if (field === 'lens') assert.equal(state.filters.lens, lens);
        assert.equal(selectPhotos(photos, state.filters, state.sort).length, result.stats[metric].buckets.find(bucket => bucket.value === value)!.count);
      }
    }
  }
  assert.equal(Object.keys(data.projects[0]!.explore.cameras).length, 1, 'a Project with one exact variant can still link accurately');
  assertDeepFrozen(data);
});
