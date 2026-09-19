import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyFilters, galleryFilterOptions, selectPhotos } from '../../src/components/gallery/filters';
import { galleryStateURL, galleryViewURL, globalGalleryHref, readGalleryState, readGalleryView } from '../../src/components/gallery/url-state';
import { galleryPhotos } from '../../src/components/gallery/photos';
import { resolveMapPhoto } from '../../src/components/gallery/map-state';
import { resolvePublicPhotoCollection } from '../../src/website/public-photos';
import { resolveProjects } from '../../src/projects/resolver';
import { photo, project } from '../projects/fixtures';

function collectionFixture() {
  const first = photo('first'), second = photo('second'), unknown = photo('unknown');
  first.title = 'Mountain 街角'; first.tags = ['travel', 'travel']; first.keywords = ['city'];
  first.exif = { DateTimeOriginal: '2024-03-01T00:15:00+08:00', Make: 'NIKON', Model: 'Z6', LensModel: '35mm', GPSLatitude: 0, GPSLongitude: 0 } as typeof first.exif;
  second.exif = { DateTimeOriginal: '2024-02-29T20:00:00Z' } as typeof second.exif;
  const native = [unknown, first, second];
  const projects = resolveProjects([
    project({ coverPhotoId: unknown.id, photos: native.map(photo => ({ photoId: photo.id })) }),
    project({ id: 'another-id', slug: 'another-slug', title: 'Another project', order: 2, coverPhotoId: first.id, photos: [{ photoId: first.id }] }),
  ].map(data => ({ source: data.slug, data })), { getPhoto: id => native.find(photo => photo.id === id) }).published;
  return { projects, photos: resolvePublicPhotoCollection(projects).listPhotos() };
}

test('the same selector composes search, Project ID, date, equipment and tags for Project, Global and Map data', () => {
  const { projects, photos } = collectionFixture();
  const filters = { query: 'mountain CITY', project: 'another-id', start: '2024-03-01', end: '2024-03-01', camera: 'NIKON Z6', lens: '35mm', tag: 'travel' };
  const visible = selectPhotos(photos, filters, 'project');
  assert.deepEqual(visible.map(photo => photo.id), ['first']);
  assert.equal(visible[0], photos[1], 'selection retains Gallery fields and memberships');
  assert.equal(visible[0]!.aspectRatio, 2);
  assert.equal(visible[0]!.projects.length, 2);
  assert.equal(resolveMapPhoto(visible, 'first'), visible[0], 'zero GPS remains usable by the existing Map resolver');
  assert.equal(resolveMapPhoto(visible, 'second'), null);
  const local = galleryPhotos(projects.getProject('another-id')!);
  assert.deepEqual(selectPhotos(local, filters, 'project').map(photo => photo.id), ['first']);
  for (const [field, value] of Object.entries({ query: 'missing', project: 'another-slug', start: '2024-03-02', end: '2024-02-29', camera: 'other', lens: 'other', tag: 'other' })) {
    assert.deepEqual(selectPhotos(photos, { ...filters, [field]: value }, 'project'), [], field);
  }
});

test('shared sorting preserves input order, date semantics and unknown-last without mutating the collection', () => {
  const { photos } = collectionFixture();
  const before = JSON.stringify(photos);
  assert.deepEqual(selectPhotos(photos, emptyFilters, 'project').map(photo => photo.id), ['unknown', 'first', 'second']);
  assert.deepEqual(selectPhotos(photos, emptyFilters, 'asc').map(photo => photo.id), ['first', 'second', 'unknown']);
  assert.deepEqual(selectPhotos(photos, emptyFilters, 'desc').map(photo => photo.id), ['second', 'first', 'unknown']);
  assert.equal(JSON.stringify(photos), before);
});

test('shared facets count each photo once and expose Project IDs with display labels only when requested', () => {
  const { photos } = collectionFixture();
  const options = galleryFilterOptions(photos);
  assert.deepEqual(options.slice(0, 2), [
    { field: 'camera', value: 'NIKON Z6', label: 'NIKON Z6', count: 1 },
    { field: 'lens', value: '35mm', label: '35mm', count: 1 },
  ]);
  assert.equal(options.find(option => option.value === 'travel')!.count, 1);
  assert(!options.some(option => option.field === 'project'), 'existing SearchPanel categories remain unchanged');
  assert.deepEqual(galleryFilterOptions(photos, ['project']), [
    { field: 'project', value: 'another-id', label: 'Another project', count: 1 },
    { field: 'project', value: 'project-one', label: 'Fixture project', count: 3 },
  ]);
});

test('Gallery URL state round-trips all filters/sort while preserving Viewer, Map, view preferences and unknown parameters', () => {
  const filters = { query: '街角 & night', project: 'project / permanent-id', start: '2024-03-01', end: '2024-03-02', camera: 'NIKON Z6', lens: '35mm', tag: '城市' };
  for (const pathname of ['/projects/travel/', '/explore/', '/map/']) {
    const current = new URL(`https://gallery.example${pathname}?photo=source%3Aphoto&panel=map&mapPhoto=first&view=list&columns=3&other=kept#anchor`);
    const before = current.href;
    const state = { filters, sort: 'desc' as const };
    const updated = galleryStateURL(current, state);
    assert.deepEqual(readGalleryState(updated.searchParams), state);
    assert.equal(current.href, before);
    for (const [key, value] of current.searchParams) assert.equal(updated.searchParams.get(key), value);
    assert.equal(updated.pathname, pathname);
    assert.equal(updated.hash, '#anchor');
    const cleared = galleryStateURL(updated, { filters: emptyFilters, sort: 'project' });
    assert.equal(cleared.href, before);
  }
  assert.deepEqual(readGalleryState(new URLSearchParams('query=old&sort=asc')), { filters: { ...emptyFilters, query: 'old' }, sort: 'asc' });
  for (const sort of ['', 'invalid', 'project']) assert.deepEqual(readGalleryState(new URLSearchParams({ sort })), { filters: emptyFilters, sort: 'project' });
});

test('global page navigation round-trips only shared filters and sort with URL encoding', () => {
  const state = { filters: { ...emptyFilters, query: '夜景 & /', camera: 'Sony α7', lens: '35mm', project: 'travel', tag: 'night', start: '2024-01-01', end: '2024-02-01' }, sort: 'asc' as const };
  for (const page of ['explore', 'map'] as const) {
    const url = new URL(globalGalleryHref(page, state), 'https://gallery.test');
    assert.equal(url.pathname, `/${page}/`);
    assert.deepEqual(readGalleryState(url.searchParams), state);
    assert.equal(globalGalleryHref(page), `/${page}/`);
  }
});

test('view URL state overrides preferences and absent/invalid values resolve independently on every history entry', () => {
  const preferences = { view: 'list' as const, columns: 4 };
  assert.deepEqual(readGalleryView(new URLSearchParams()), { view: 'masonry', columns: 0 });
  assert.deepEqual(readGalleryView(new URLSearchParams('view=bad&columns=99'), preferences), preferences);
  assert.deepEqual(readGalleryView(new URLSearchParams('view=masonry&columns=0'), preferences), { view: 'masonry', columns: 0 });
  const current = new URL('https://gallery.test/explore/?project=one&photo=two&other=kept#anchor');
  const updated = galleryViewURL(current, preferences);
  assert.deepEqual(readGalleryView(updated.searchParams), preferences);
  for (const [key, value] of current.searchParams) assert.equal(updated.searchParams.get(key), value);
  assert.equal(updated.hash, current.hash);
  assert(!current.searchParams.has('view'));
});
