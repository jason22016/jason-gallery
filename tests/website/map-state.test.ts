import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mapPhotoURL, mapPhotoViewport, resolveMapPhoto } from '../../src/components/gallery/map-state';
import { emptyFilters, selectPhotos, type ViewerPhoto } from '../../src/components/viewer/photos';

const photo = (id: string, location: ViewerPhoto['location'], tags = ['visible']) => ({ id, location, tags, src: '', thumbnail: '', thumbHash: null, width: 1, height: 1, alt: '', title: id, filename: id, description: '', date: '', camera: '', lens: '', exposure: [], format: 'jpg', size: 1, detailsUrl: '', isHDR: false } satisfies ViewerPhoto);

test('map URLs separate Viewer photo, retain Project/filter/view/hash and do not mutate their source', () => {
  const source = new URL('https://gallery.test/projects/travel/?photo=old&tag=city&sort=asc&view=list&columns=3#gallery');
  const url = mapPhotoURL(source, 'photo /&中');
  assert.equal(url.pathname, '/projects/travel/');
  assert.equal(url.searchParams.get('panel'), 'map');
  assert.equal(url.searchParams.get('mapPhoto'), 'photo /&中');
  assert.equal(url.searchParams.get('photo'), null);
  for (const key of ['tag', 'sort', 'view', 'columns']) assert.equal(url.searchParams.get(key), source.searchParams.get(key));
  assert.equal(url.hash, '#gallery');
  assert.equal(source.searchParams.get('photo'), 'old');
});

test('map selection resolves only within visible Project photos, using valid GPS including zero at upstream zoom 15', () => {
  const photos = [photo('zero', { latitude: 0, longitude: 0 }), photo('south', { latitude: -33.5, longitude: -70.5 }),
    photo('no-gps', null), photo('invalid', { latitude: 91, longitude: 0 }),
    photo('infinite', { latitude: 0, longitude: Infinity }), photo('filtered', { latitude: 22.3, longitude: 114.17 }, ['hidden'])];
  const visible = selectPhotos(photos, { ...emptyFilters, tag: 'visible' }, 'project');
  for (const id of [null, '', 'missing', 'other-project', 'no-gps', 'invalid', 'infinite', 'filtered']) {
    assert.equal(resolveMapPhoto(visible, id), null);
    assert.equal(mapPhotoViewport(resolveMapPhoto(visible, id)), undefined);
  }
  assert.deepEqual(mapPhotoViewport(resolveMapPhoto(visible, 'zero')), { center: [0, 0], zoom: 15, bearing: 0, pitch: 0 });
  assert.deepEqual(mapPhotoViewport(resolveMapPhoto(visible, 'south')), { center: [-70.5, -33.5], zoom: 15, bearing: 0, pitch: 0 });
});
