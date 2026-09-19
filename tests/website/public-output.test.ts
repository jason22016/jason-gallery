import assert from 'node:assert/strict';
import test from 'node:test';
import { assertPublicOutput, localAssetPath, photoAssetPaths, publicOutputPaths } from '../../src/website/public-output';
import { resolveProjects } from '../../src/projects/resolver';
import { photo, project } from '../projects/fixtures';
import { shortPublicPhotoId } from '../../src/website/public-photo-id';

test('build and release share an exact public route/asset allowlist, including live media but excluding drafts', () => {
  const image = photo('public');
  image.thumbnailUrl = '/thumbnails/public.jpg'; image.originalUrl = '/originals/public.jpg';
  image.video = { type: 'live-photo', videoUrl: '/originals/public.mov', s3Key: 'public.mov' };
  const catalog = resolveProjects([
    { source: 'public', data: project({ coverPhotoId: image.id, photos: [{ photoId: image.id }] }) },
    { source: 'draft', data: project({ id: 'draft', slug: 'draft', status: 'draft', coverPhotoId: image.id, photos: [{ photoId: image.id }] }) },
  ], { getPhoto: () => image });
  const allowed = publicOutputPaths([...catalog.published.listProjects(), ...catalog.drafts.listProjects()]);
  const photoPage = `photos/${shortPublicPhotoId(image.id)}/index.html`;
  for (const name of ['explore/index.html', 'map/index.html', 'originals/public.mov', 'projects/project-one/photos/public.json', photoPage]) assert(allowed.has(name), name);
  assert(!allowed.has('projects/draft/index.html'));
  assertPublicOutput([...allowed, '_astro/client.abc.js', '_astro/font.xyz.woff2'], allowed, true);
  assert.throws(() => assertPublicOutput([...allowed].filter(name => name !== 'map/index.html'), allowed, true), /Missing published asset: map/);
  assert.throws(() => assertPublicOutput([...allowed].filter(name => name !== photoPage), allowed, true), /Missing published asset: photos/);
  for (const name of ['explore/private.json', 'map/photos.json', 'photos/private.json', 'photos/public/index.html', `photos/${shortPublicPhotoId('private')}/index.html`, `photos/${shortPublicPhotoId(image.id)}/metadata.json`, '_astro/photos-manifest.json', '_astro/client.js.map', 'projects/draft/photos/public.json']) {
    assert.throws(() => assertPublicOutput([...allowed, name], allowed), /Unexpected public file/);
  }
  assert.deepEqual(photoAssetPaths(image), ['thumbnails/public.jpg', 'originals/public.jpg', 'originals/public.mov']);
});

test('asset paths decode local URLs, ignore remote URLs and reject traversal', () => {
  assert.equal(localAssetPath('/thumbnails/photo%20one.jpg?cache=1#image'), 'thumbnails/photo one.jpg');
  for (const url of [null, undefined, 'https://photos.test/photo.jpg', '//photos.test/photo.jpg']) assert.equal(localAssetPath(url), null);
  for (const url of ['/../private.json', '/thumbnails/%2e%2e/private.json', '/thumbnails/..%5cprivate.json']) assert.throws(() => localAssetPath(url), /escapes build output/);
});
