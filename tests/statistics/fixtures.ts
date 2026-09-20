import type { PhotographyStatsPhoto } from '../../src/statistics';
import { resolveProjects } from '../../src/projects/resolver';
import { resolvePublicPhotoCollection } from '../../src/website/public-photos';
import { photo, project } from '../projects/fixtures';

export function statsPhoto(id: string, overrides: Partial<PhotographyStatsPhoto> = {}): PhotographyStatsPhoto {
  return {
    id, projects: [{ id: 'public-id', slug: 'public', title: 'Public Project' }],
    date: '', camera: '', lens: '', capture: { focalLength: '', aperture: '', iso: '', shutter: '' },
    width: 40, height: 20, location: null, isHDR: false, ...overrides,
  };
}

export function publicFixture() {
  const native = ['source:shared', 'first-only', 'second-only', 'draft-only', 'unused'].map(photo);
  const shared = native[0]!;
  shared.s3Key = 'PRIVATE STORAGE/shared.jpg';
  shared.digest = 'PRIVATE DIGEST';
  shared.regions = [{ name: 'PRIVATE PERSON', area: null, appliedToDimensions: null }];
  shared.exif = {
    DateTimeOriginal: '2024-03-01T00:15:30+08:00', Make: 'NIKON', Model: 'Z6', LensModel: 'NIKKOR Z 35mm',
    FocalLength: '35 mm', FocalLengthIn35mmFormat: '50 mm', FNumber: 2.8, ISO: 100, ExposureTime: '1/125',
    GPSLatitude: 0, GPSLongitude: 0,
  } as typeof shared.exif;
  Object.assign(shared.exif!, { PrivateExif: 'PRIVATE EXIF' });
  shared.isHDR = true;
  shared.video = { type: 'live-photo', videoUrl: '/public/shared.mov', s3Key: 'PRIVATE VIDEO STORAGE' };
  const first = project({ id: 'first-id', slug: 'first', title: 'First', order: 0, coverPhotoId: 'legacy-shared', photos: [
    { photoId: 'legacy-shared' }, { photoId: 'first-only' },
  ] });
  const second = project({ id: 'second-id', slug: 'second', title: 'Second', order: 1, coverPhotoId: shared.id, photos: [
    { photoId: 'second-only' }, { photoId: shared.id },
  ] });
  const draft = project({ id: 'draft-id', slug: 'private-draft', title: 'PRIVATE DRAFT', status: 'draft', order: -1, coverPhotoId: 'draft-only', photos: [
    { photoId: 'draft-only' }, { photoId: shared.id, caption: 'PRIVATE CAPTION' },
  ] });
  const catalog = resolveProjects([draft, second, first].map(data => ({ source: data.slug, data })), {
    getPhoto: id => native.find(photo => photo.id === (id === 'legacy-shared' ? shared.id : id)),
  });
  // Defense in depth: even an accidental mixed Project index is filtered by the existing collection.
  const collection = resolvePublicPhotoCollection({ listProjects: () => [...catalog.drafts.listProjects(), ...catalog.published.listProjects()] });
  return { native, first, second, draft, catalog, collection };
}

export function assertDeepFrozen(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  if (!Object.isFrozen(value)) throw new Error('Expected a recursively frozen result');
  for (const child of Object.values(value)) assertDeepFrozen(child);
}

export function assertFiniteNumbers(value: unknown): void {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`Non-finite result: ${value}`);
  if (value !== null && typeof value === 'object') for (const child of Object.values(value)) assertFiniteNumbers(child);
}
