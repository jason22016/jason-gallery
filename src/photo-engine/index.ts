import fs from 'node:fs';
import path from 'node:path';
import type { AfilmoryManifest, PhotoManifestItem } from '@afilmory/typing';
export type { AfilmoryManifest, PhotoManifestItem } from '@afilmory/typing';
export function loadPhotoIndex(file: string | URL = path.resolve('src/data/photos-manifest.json')) {
  const manifest: AfilmoryManifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  const index = new Map(manifest.data.map(photo => [photo.id, photo]));
  if (index.size !== manifest.data.length) throw new Error('Duplicate photo ID');
  return {
    getPhoto: (id: PhotoManifestItem['id']) => structuredClone(index.get(id)),
    listPhotos: (): readonly PhotoManifestItem[] => structuredClone(manifest.data),
  };
}
