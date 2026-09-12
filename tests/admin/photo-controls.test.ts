import test from 'node:test';
import assert from 'node:assert/strict';
import { projectMembership, sortProjectPhotos, type PreviewPhoto } from '../../admin/client/model';
import type { Project } from '../../src/projects/schema';

test('membership resolves aliases across all Projects and filename sort preserves photo metadata', () => {
  const refs = [{ photoId: 'legacy', caption: 'caption', alt: 'alt' }, { photoId: 'two' }, { photoId: 'one' }];
  const membership = projectMembership([
    { id: 'draft', photos: refs, status: 'draft' } as Project,
    { id: 'published', photos: [{ photoId: 'ten' }], status: 'published' } as Project,
  ], { legacy: 'ten' });
  assert.deepEqual([...membership.get('ten')!], ['draft', 'published']);
  assert.equal(membership.has('unused'), false);
  const photos = ['ten', 'two', 'one'].map((id, i) => ({ photo: { id, title: ['IMG_10.jpg', 'img_2.jpg', 'IMG_1.jpg'][i] } })) as PreviewPhoto[];
  const asc = sortProjectPhotos(refs, photos, 'asc', { legacy: 'ten' });
  assert.deepEqual(asc.map(p => p.photoId), ['one', 'two', 'legacy']);
  assert.deepEqual(sortProjectPhotos(refs, photos, 'desc', { legacy: 'ten' }).map(p => p.photoId), ['legacy', 'two', 'one']);
  assert.equal(asc[2], refs[0]);
  assert.deepEqual(refs.map(p => p.photoId), ['legacy', 'two', 'one']);
});
