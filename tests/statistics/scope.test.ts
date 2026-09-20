import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { galleryPhotos } from '../../src/components/gallery/photos';
import { allPhotographyStatsScope, buildPhotographyStats, readPhotographyStatsScope, resolvePhotographyStats } from '../../src/statistics';
import { loadPhotographyStats } from '../../src/website/photography-stats';
import { fixture } from '../projects/fixtures';
import { assertDeepFrozen, publicFixture } from './fixtures';

test('All Photos uses the Public Global Photo Collection, including canonical legacy/qualified deduplication', () => {
  const { collection } = publicFixture();
  const result = resolvePhotographyStats(collection.listPhotos(), allPhotographyStatsScope)!;
  assert.equal(result.scope.type, 'all');
  assert.equal(result.project, null);
  assert.equal(result.stats.photoCount, 3);
  assert.equal(result.stats.projectCount, 2);
  assert.equal(result.stats.geotagged.count, 1);
  assert.equal(result.stats.captureDateRange.sampleCount, 1);
  assert.equal(result.stats.shutterSpeed.median, 1 / 125);
  assert.equal(result.stats.aperture.median, 2.8);
  assert.deepEqual(result.stats, buildPhotographyStats(collection.listPhotos()));
  assertDeepFrozen(result);
});

test('each published Project uses the same engine on exactly its own photos and has projectCount = 1', () => {
  const { collection, catalog } = publicFixture();
  const photos = collection.listPhotos();
  const before = JSON.stringify(photos);
  for (const project of catalog.published.listProjects()) {
    const scope = { type: 'project' as const, slug: project.slug };
    const result = resolvePhotographyStats(photos, scope)!;
    assert.equal(result.stats.photoCount, 2);
    assert.equal(result.stats.projectCount, 1, 'other memberships of the shared photo are outside the scope');
    assert.deepEqual(result.project, { id: project.id, slug: project.slug, title: project.title });
    assert.deepEqual(result.stats, buildPhotographyStats(galleryPhotos(project)));
    assert.deepEqual(result, resolvePhotographyStats([...photos, photos[0]!], scope));
    assertDeepFrozen(result);
    assert(!Object.isFrozen(scope), 'caller-owned scope must remain untouched');
  }
  assert.equal(JSON.stringify(photos), before);
  assert.equal(photos[0]!.projects.length, 2);
});

test('draft Projects, draft-only photos and unused Manifest photos cannot enter any stats scope', () => {
  const { collection, native } = publicFixture();
  assert.equal(native.length, 5);
  assert.deepEqual(collection.listPhotos().map(photo => photo.id), ['source:shared', 'first-only', 'second-only']);
  for (const slug of ['private-draft', 'unknown', 'draft-only', 'unused', 'first-id', 'all', '', '../first', 'FIRST', '__proto__', 'constructor']) {
    assert.equal(resolvePhotographyStats(collection.listPhotos(), { type: 'project', slug }), undefined, slug);
  }
  assert.equal(resolvePhotographyStats([], { type: 'project', slug: 'first' }), undefined);
  assert.equal(resolvePhotographyStats([], allPhotographyStatsScope)!.stats.photoCount, 0);
});

test('URL scope is all by default, a strict Project slug when present, and never widens invalid requests', () => {
  const { collection } = publicFixture();
  assert.deepEqual(readPhotographyStatsScope(new URLSearchParams()), allPhotographyStatsScope);
  assert.deepEqual(readPhotographyStatsScope(new URLSearchParams('unrelated=1')), allPhotographyStatsScope);
  const scope = readPhotographyStatsScope(new URLSearchParams('project=first'));
  assert.deepEqual(scope, { type: 'project', slug: 'first' });
  assert.equal(resolvePhotographyStats(collection.listPhotos(), scope)!.stats.photoCount, 2);
  for (const query of ['project=', 'project=../first', 'project=%2Ffirst', 'project=First', 'project=first+second', 'project=first&project=second', 'project=first&project=first', 'project=first--second', 'project=%00first']) {
    const invalid = readPhotographyStatsScope(new URLSearchParams(query));
    assert.equal(invalid, undefined, query);
    assert.equal(resolvePhotographyStats(collection.listPhotos(), invalid), undefined);
    assert.equal(loadPhotographyStats(invalid, { directory: '/must-not-read-invalid-scope' }), undefined);
  }
  for (const query of ['project=missing', 'project=private-draft', 'project=all']) {
    assert.equal(resolvePhotographyStats(collection.listPhotos(), readPhotographyStatsScope(new URLSearchParams(query))), undefined);
  }
});

test('server loader uses the validated public collection and reflects publication changes without a facts cache', t => {
  const files = fixture(t);
  const { native, first, second, draft } = publicFixture();
  fs.writeFileSync(files.manifestFile, JSON.stringify({ ...files.manifest, data: native }));
  const canonicalFirst = { ...first, coverPhotoId: native[0]!.id, photos: [{ photoId: native[0]!.id }, { photoId: 'first-only' }] };
  for (const project of [canonicalFirst, second, draft]) files.write(project);
  const all = loadPhotographyStats(allPhotographyStatsScope, files)!;
  assert.equal(all.stats.photoCount, 3);
  assert.equal(all.stats.projectCount, 2);
  assert.equal(loadPhotographyStats({ type: 'project', slug: 'second' }, files)!.stats.photoCount, 2);
  assert.equal(loadPhotographyStats({ type: 'project', slug: 'private-draft' }, files), undefined);
  assert.equal(loadPhotographyStats({ type: 'project', slug: 'missing' }, files), undefined);
  files.write({ ...canonicalFirst, status: 'draft' });
  assert.equal(loadPhotographyStats(allPhotographyStatsScope, files)!.stats.photoCount, 2);
  assert.equal(loadPhotographyStats({ type: 'project', slug: 'first' }, files), undefined);
  files.write({ ...second, status: 'draft' });
  assert.equal(loadPhotographyStats(allPhotographyStatsScope, files)!.stats.photoCount, 0);
  files.write({ ...draft, coverPhotoId: 'missing', photos: [{ photoId: 'missing' }] });
  assert.throws(() => loadPhotographyStats(allPhotographyStatsScope, files), /unknown photo ID/);
});

test('statistics serialize only aggregates and the selected public Project, never photo internals or draft memberships', () => {
  const { collection, catalog } = publicFixture();
  const photos = collection.listPhotos();
  const extended = photos.map(photo => ({ ...photo,
    exif: { PrivateExif: 'PRIVATE EXIF', DateTimeOriginal: '1900-01-01T00:00:00Z' },
    regions: ['PRIVATE PERSON'], digest: 'PRIVATE DIGEST', s3Key: 'PRIVATE STORAGE', source: { token: 'PRIVATE SOURCE' },
    draftMemberships: catalog.drafts.listProjects(),
  }));
  const results = [resolvePhotographyStats(extended, allPhotographyStatsScope), resolvePhotographyStats(extended, { type: 'project', slug: 'second' })];
  assert.deepEqual(results[0], resolvePhotographyStats(photos, allPhotographyStatsScope));
  assert.deepEqual(results[1], resolvePhotographyStats(photos, { type: 'project', slug: 'second' }));
  const serialized = JSON.stringify(results);
  for (const privateValue of ['PRIVATE', 'private-draft', 'draft-only', 'unused', 'regions', 'digest', 's3Key', 'draftMemberships', 'PrivateExif', 'exif', 'source:shared', 'videoUrl', 'thumbnail', 'detailsUrl', 'latitude', 'longitude']) {
    assert(!serialized.includes(privateValue), privateValue);
  }
});
