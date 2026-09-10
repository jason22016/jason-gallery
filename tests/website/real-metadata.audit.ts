import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadPhotoIndex } from '../../src/photo-engine/index';
import { loadProjectCatalog } from '../../src/projects/loader';
import { viewerPhotos } from '../../src/components/viewer/photos';
import { resolveProjects } from '../../src/projects/resolver';
import { project } from '../projects/fixtures';

test('existing real manifest projection agrees with native capture time, exposure and GPS', async () => {
  const manifest = { data: loadPhotoIndex().listPhotos() };
  if (manifest.data.length === 0) {
    const catalog = loadProjectCatalog();
    assert.equal(catalog.published.listProjects().length + catalog.drafts.listProjects().length, 0, 'An empty source set cannot retain Project references');
    return;
  }
  const snapshot = JSON.stringify(manifest);
  const resolved = resolveProjects([{ source: 'in-memory audit only', data: project({ coverPhotoId: manifest.data[0]!.id, photos: manifest.data.map(p => ({ photoId: p.id })) }) }], { getPhoto: id => structuredClone(manifest.data.find(p => p.id === id)) }).published.listProjects()[0]!;
  const photos = viewerPhotos(resolved);
  for (const [i, native] of manifest.data.entries()) {
    const projected = photos[i]!;
    assert.equal(projected.date, native.exif?.DateTimeOriginal ?? '');
    if (native.exif?.GPSLatitude !== undefined && native.exif.GPSLongitude !== undefined) {
      assert.equal(projected.location?.latitude, native.exif.GPSLatitude);
      assert.equal(projected.location?.longitude, native.exif.GPSLongitude);
    }
    if (native.exif?.ExposureTime) assert(projected.exposure.includes(`${native.exif.ExposureTime} s`));
  }
  assert.equal(JSON.stringify(manifest), snapshot);
});
