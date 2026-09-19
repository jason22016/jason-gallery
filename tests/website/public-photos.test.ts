import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { resolveProjects, type ProjectIndex } from '../../src/projects/resolver';
import { galleryPhotos } from '../../src/components/gallery/photos';
import { loadPublicPhotoCollection, resolvePublicPhotoCollection } from '../../src/website/public-photos';
import { projectPhotoDetails } from '../../src/website/photo-details';
import { fixture, photo, project } from '../projects/fixtures';

function publicFixture() {
  const native = ['shared', 'first-only', 'second-only', 'draft-only', 'unreferenced'].map(photo);
  const shared = native[0]!;
  shared.s3Key = 'internal-storage-directory/shared.jpg';
  shared.digest = 'PRIVATE ENGINE DIGEST';
  shared.regions = [{ name: 'PRIVATE PERSON REGION', area: null, appliedToDimensions: null }];
  shared.exif = { Artist: 'Public artist', GPSAltitude: 0, DateTimeOriginal: '2024-03-01T08:00:00+08:00', Make: 'NIKON', Model: 'Z6', Orientation: 1 } as typeof shared.exif;
  Object.assign(shared.exif!, { PrivateField: 'PRIVATE EXIF FIELD' });
  const first = project({ id: 'first-id', slug: 'first', title: 'First public project', order: 0, coverPhotoId: 'shared', photos: [
    { photoId: 'shared', alt: 'First local alt', caption: 'First local caption' }, { photoId: 'first-only' },
  ] });
  const second = project({ id: 'second-id', slug: 'second', title: 'Second public project', order: 0, coverPhotoId: 'second-only', photos: [
    { photoId: 'second-only' }, { photoId: 'shared', alt: 'Second local alt', caption: 'Second local caption' },
  ] });
  const draft = project({ id: 'draft-id', slug: 'draft', title: 'PRIVATE DRAFT PROJECT', status: 'draft', order: -1, coverPhotoId: 'draft-only', photos: [
    { photoId: 'draft-only' }, { photoId: 'shared', caption: 'PRIVATE DRAFT CAPTION' },
  ] });
  const before = JSON.stringify(native);
  const catalog = resolveProjects([second, draft, first].map(data => ({ source: data.slug, data })), { getPhoto: id => native.find(photo => photo.id === id) });
  return { native, before, catalog, first, second, draft };
}

test('global collection contains only published references, deduplicated with all public memberships in Project order', () => {
  const { catalog, native, before } = publicFixture();
  const collection = resolvePublicPhotoCollection(catalog.published);
  assert.deepEqual(collection.listPhotos().map(photo => photo.id), ['shared', 'first-only', 'second-only']);
  const shared = collection.getPhoto('shared')!;
  assert.deepEqual(shared.projects, [
    { id: 'first-id', slug: 'first', title: 'First public project' },
    { id: 'second-id', slug: 'second', title: 'Second public project' },
  ]);
  assert.deepEqual(collection.getPhoto('second-only')!.projects, [shared.projects[1]]);
  assert.equal(collection.getPhoto('draft-only'), undefined);
  assert.equal(collection.getPhoto('unreferenced'), undefined);
  assert.equal(collection.getPhoto('missing'), undefined);
  assert.equal(shared, collection.listPhotos()[0]);
  assert.equal(shared.alt, 'First local alt');
  assert.equal(shared.caption, 'First local caption');
  assert.equal(shared.detailsUrl, '/projects/first/photos/shared.json');
  const { projects, ...projection } = shared;
  const { projects: localProjects, ...existingProjection } = galleryPhotos(catalog.published.getProject('first-id')!)[0]!;
  assert.deepEqual(projection, existingProjection, 'global entries reuse the existing Gallery/Viewer projection');
  assert.equal(galleryPhotos(catalog.published.getProject('second-id')!)[1]!.caption, 'Second local caption');
  assert.equal(JSON.stringify(native), before);
  assert(!Object.isFrozen(native[0]), 'engine-owned inputs must not be frozen');
});

test('public detail lookup uses the same whitelist as the Project route and refuses non-public IDs', () => {
  const { catalog } = publicFixture();
  const collection = resolvePublicPhotoCollection(catalog.published);
  const details = collection.getPhotoDetails('shared')!;
  assert.deepEqual(details, projectPhotoDetails(catalog.published.getProject('first-id')!, 'shared'));
  assert.deepEqual(details, { exif: { Artist: 'Public artist', GPSAltitude: 0, DateTimeOriginal: '2024-03-01T08:00:00+08:00' }, toneAnalysis: null });
  assert.deepEqual(collection.getPhotoDetails('first-only'), { exif: null, toneAnalysis: null });
  for (const id of ['draft-only', 'unreferenced', 'missing', '__proto__', 'constructor']) assert.equal(collection.getPhotoDetails(id), undefined);
  assert.equal(projectPhotoDetails(catalog.drafts.getProject('draft-id')!, 'shared'), undefined);
  assert.equal(projectPhotoDetails(catalog.published.getProject('first-id')!, 'second-only'), undefined);
  const serialized = JSON.stringify([collection.listPhotos(), details]);
  for (const value of ['draft-only', 'unreferenced', 'PRIVATE', 'internal-storage-directory', 'regions', 'lastModified', 'digest', 'PrivateField', 'Orientation']) assert(!serialized.includes(value), value);
});

test('even a draft or mixed index cannot add private photos, memberships or details to the public collection', () => {
  const { catalog } = publicFixture();
  const draftOnly = resolvePublicPhotoCollection(catalog.drafts);
  assert.deepEqual(draftOnly.listPhotos(), []);
  assert.equal(draftOnly.getPhotoDetails('shared'), undefined);
  const mixed: ProjectIndex = { ...catalog.published, listProjects: () => [...catalog.drafts.listProjects(), ...catalog.published.listProjects()].reverse() };
  const collection = resolvePublicPhotoCollection(mixed);
  assert.deepEqual(collection.listPhotos(), resolvePublicPhotoCollection(catalog.published).listPhotos());
  assert.equal(collection.getPhotoDetails('draft-only'), undefined);
});

test('canonical photo IDs deduplicate legacy and qualified references across Projects', () => {
  const canonical = photo('source:photo');
  const catalog = resolveProjects(['legacy-photo', canonical.id].map((id, index) => ({ source: `project-${index}`, data: project({
    id: `project-${index}`, slug: `project-${index}`, coverPhotoId: id, photos: [{ photoId: id }],
  }) })), { getPhoto: id => id === 'legacy-photo' || id === canonical.id ? canonical : undefined });
  const collection = resolvePublicPhotoCollection(catalog.published);
  assert.deepEqual(collection.listPhotos().map(photo => photo.id), [canonical.id]);
  assert.equal(collection.getPhoto(canonical.id)!.projects.length, 2);
  assert.equal(collection.getPhoto(canonical.id)!.detailsUrl, '/projects/project-0/photos/source%3Aphoto.json');
  assert.deepEqual(collection.getPhotoDetails(canonical.id), { exif: null, toneAnalysis: null });
  assert.equal(collection.getPhotoDetails('legacy-photo'), undefined, 'public IDs remain canonical');
});

test('public snapshots are immutable and do not expose the resolver or engine objects', () => {
  const { catalog } = publicFixture();
  const collection = resolvePublicPhotoCollection(catalog.published);
  for (const value of [collection, collection.listPhotos(), collection.getPhoto('shared'), collection.getPhoto('shared')!.projects,
    collection.getPhoto('shared')!.projects[0], collection.getPhoto('shared')!.tags, collection.getPhoto('shared')!.capture,
    collection.getPhotoDetails('shared'), collection.getPhotoDetails('shared')!.exif]) assert(Object.isFrozen(value));
  assert.throws(() => Object.assign(collection.getPhoto('shared')!.projects[0]!, { title: 'changed' }), TypeError);
  assert.throws(() => Object.assign(collection.getPhotoDetails('shared')!.exif!, { Artist: 'changed' }), TypeError);
  assert.equal(catalog.published.getProject('first-id')!.photos[0]!.photo.exif!.Artist, 'Public artist');
});

test('build loader validates the Project catalog and never publishes unreferenced Manifest photos', t => {
  const files = fixture(t);
  const { native, first, second, draft } = publicFixture();
  fs.writeFileSync(files.manifestFile, JSON.stringify({ ...files.manifest, data: native }));
  for (const project of [first, second, draft]) files.write(project);
  const collection = loadPublicPhotoCollection(files);
  assert.deepEqual(collection.listPhotos().map(photo => photo.id), ['shared', 'first-only', 'second-only']);
  assert.equal(collection.getPhotoDetails('unreferenced'), undefined);
  for (const published of [first, second]) files.write({ ...published, status: 'draft' });
  assert.deepEqual(loadPublicPhotoCollection(files).listPhotos(), []);
  files.write({ ...draft, coverPhotoId: 'dangling', photos: [{ photoId: 'dangling' }] });
  assert.throws(() => loadPublicPhotoCollection(files), /unknown photo ID/);
});
