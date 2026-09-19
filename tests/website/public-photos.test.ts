import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { resolveProjects, type ProjectIndex } from '../../src/projects/resolver';
import { galleryPhotos } from '../../src/components/gallery/photos';
import { loadPublicPhotoCollection, resolvePublicPhotoCollection } from '../../src/website/public-photos';
import { projectPhotoDetails } from '../../src/website/photo-details';
import { indexPublicPhotoIds, shortPublicPhotoId } from '../../src/website/public-photo-id';
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
  const { projects, publicId, sharePath, ...projection } = shared;
  const { projects: localProjects, ...existingProjection } = galleryPhotos(catalog.published.getProject('first-id')!)[0]!;
  assert.deepEqual(projection, existingProjection, 'global entries reuse the existing Gallery/Viewer projection');
  assert.equal(galleryPhotos(catalog.published.getProject('second-id')!)[1]!.caption, 'Second local caption');
  assert.equal(JSON.stringify(native), before);
  assert(!Object.isFrozen(native[0]), 'engine-owned inputs must not be frozen');
});

test('short public IDs pin the v1 algorithm, remain URL-safe and detect collisions before publication', () => {
  for (const [id, expected] of [['shared', 'HWhRgdyx7wovNJkA'], ['source:photo', '3VS8e-Z5g0wzOlbr'], ['图库/雪山.jpg', 'Xg2qV9ag2S8VMggy']]) {
    assert.equal(shortPublicPhotoId(id!), expected);
    assert.equal(shortPublicPhotoId(id!), shortPublicPhotoId(id!));
  }
  const photos = Array.from({ length: 10_000 }, (_, index) => {
    const id = `source-${index % 3}:photo-${index}`;
    return { id, publicId: shortPublicPhotoId(id) };
  });
  assert(photos.every(photo => /^[A-Za-z0-9_-]{16}$/.test(photo.publicId)));
  assert.equal(indexPublicPhotoIds(photos).size, photos.length);
  assert.deepEqual([...indexPublicPhotoIds(photos).keys()].sort(), [...indexPublicPhotoIds([...photos].reverse()).keys()].sort());
  assert.throws(() => indexPublicPhotoIds([{ id: 'first', publicId: 'collision' }, { id: 'second', publicId: 'collision' }]), /Public photo ID collision/);
});

test('Photo Page lookups use the public collection and expose only a small landing-page projection', () => {
  const { catalog } = publicFixture();
  const collection = resolvePublicPhotoCollection(catalog.published);
  const photo = collection.getPhoto('shared')!;
  assert.equal(photo.publicId, 'HWhRgdyx7wovNJkA');
  assert.equal(photo.sharePath, `/photos/${photo.publicId}/`);
  assert.equal(collection.getPhotoByPublicId(photo.publicId), photo);
  const page = collection.getPhotoPage(photo.publicId)!;
  assert.deepEqual(page, {
    publicId: photo.publicId, path: photo.sharePath, title: 'Fixture shared', caption: 'First local caption',
    image: { path: '/thumbnails/shared.jpg', alt: 'First local alt', width: 40, height: 20 },
    date: '2024-03-01T08:00:00+08:00', camera: 'NIKON Z6', lens: '', primaryProject: photo.projects[0],
    viewerHref: '/projects/first/?photo=shared',
  });
  assert(Object.isFrozen(page)); assert(Object.isFrozen(page.image)); assert(Object.isFrozen(page.primaryProject));
  for (const id of ['draft-only', 'unreferenced', 'missing']) {
    assert.equal(collection.getPhoto(id)?.sharePath, undefined);
    assert.equal(collection.getPhotoByPublicId(shortPublicPhotoId(id)), undefined);
    assert.equal(collection.getPhotoPage(shortPublicPhotoId(id)), undefined);
  }
  assert.equal(collection.getPhotoPage(photo.id), undefined, 'internal IDs are not public route aliases');
  for (const privateField of ['exif', 'toneAnalysis', 'location', 'src', 'filename', 'detailsUrl', 'projects']) assert(!(privateField in page));
});

test('primary Project and URL identity are stable across input order, editorial edits and membership changes', () => {
  const { native, first, second, draft } = publicFixture();
  const resolve = (projects: typeof first[]) => resolvePublicPhotoCollection(resolveProjects(projects.map(data => ({ source: data.slug, data })), { getPhoto: id => native.find(photo => photo.id === id) }).published);
  const firstPage = resolve([second, draft, first]).getPhotoPage(shortPublicPhotoId('shared'))!;
  assert.deepEqual(resolve([first, second, draft]).getPhotoPage(firstPage.publicId), firstPage);
  const renamed = resolve([{ ...first, slug: 'renamed', title: 'Changed title', order: -10 }, second, draft]);
  assert.equal(renamed.getPhoto('shared')!.sharePath, firstPage.path);
  assert.equal(renamed.getPhotoPage(firstPage.publicId)!.primaryProject.slug, 'renamed');
  const unpublished = resolve([{ ...first, status: 'draft' }, second, draft]);
  assert.equal(unpublished.getPhotoPage(firstPage.publicId)!.path, firstPage.path);
  assert.equal(unpublished.getPhotoPage(firstPage.publicId)!.primaryProject.slug, 'second');
  assert.equal(unpublished.getPhotoPage(firstPage.publicId)!.caption, 'Second local caption');
  assert.equal(resolve([draft]).getPhotoPage(firstPage.publicId), undefined);
});

test('Photo Pages preserve missing editorial fields, encode canonical IDs and reject non-JPEG share thumbnails', () => {
  const image = photo('source:photo /雪?&#');
  image.title = ''; image.description = '';
  const resolve = () => resolvePublicPhotoCollection(resolveProjects([{ source: 'project', data: project({ coverPhotoId: image.id, photos: [{ photoId: image.id, caption: '  ' }] }) }], { getPhoto: () => image }).published);
  // The normal engine emits URL-safe JPEG thumbnail paths independently of the Viewer query.
  image.thumbnailUrl = '/thumbnails/public.jpg';
  const page = resolve().getPhotoPage(shortPublicPhotoId(image.id))!;
  assert.equal(page.title, ''); assert.equal(page.caption, ''); assert.equal(page.date, '');
  assert.equal(page.viewerHref, `/projects/project-one/?photo=${encodeURIComponent(image.id)}`);
  assert.equal(new URL(page.viewerHref, 'https://gallery.test').searchParams.get('photo'), image.id);
  for (const extension of ['heic', 'tiff', 'hdr', 'webp']) {
    image.thumbnailUrl = `/thumbnails/public.${extension}`;
    assert.throws(() => resolve().getPhotoPage(page.publicId), /requires a JPEG thumbnail/);
  }
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
