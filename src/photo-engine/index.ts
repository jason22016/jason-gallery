import fs from 'node:fs';
import path from 'node:path';
import type { AfilmoryManifest, PhotoManifestItem } from '@afilmory/typing';
import { fileURLToPath } from 'node:url';
import { projectUnifiedIndex, type UnifiedIndex } from './unified-index.js';
import { verifySnapshot, loadSources, sourceIdentity, LEGACY_SOURCE } from './sources.js';
export type { AfilmoryManifest, PhotoManifestItem } from '@afilmory/typing';
export function photoIndexFile(directory: string | URL = path.resolve('src/data')) {
  const dir = directory instanceof URL ? fileURLToPath(directory) : directory;
  const unified = path.join(dir, 'photo-index.json');
  return fs.existsSync(unified) ? unified : path.join(dir, 'photos-manifest.json');
}
export function loadPhotoIndex(file: string | URL = photoIndexFile()) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const directory = path.dirname(file instanceof URL ? fileURLToPath(file) : file);
  const configFile = path.resolve(directory, '../../config/photo-sources.json');
  const config = path.basename(directory) === 'data' && path.basename(path.dirname(directory)) === 'src' && fs.existsSync(configFile) ? loadSources(configFile) : undefined;
  let photos: PhotoManifestItem[];
  let aliases = new Map<string,string>();
  if (data.kind === 'photo-index') {
    const descriptor = data as UnifiedIndex;
    // Validate before using source IDs in filesystem paths.
    verifySnapshot(descriptor.snapshot, config);
    const manifests = new Map<string,AfilmoryManifest>(descriptor.snapshot.sources.map(source => [source.sourceId, JSON.parse(fs.readFileSync(path.join(directory, 'sources', source.sourceId, 'photos-manifest.json'), 'utf8'))]));
    ({ photos, aliases } = projectUnifiedIndex(descriptor, manifests));
  } else {
    const enabled = config?.sources.filter(s => s.enabled);
    if (enabled && (enabled.length !== 1 || enabled[0]!.sourceId !== LEGACY_SOURCE.sourceId || sourceIdentity(enabled[0]!) !== sourceIdentity(LEGACY_SOURCE))) throw new Error('Legacy Manifest cannot represent current sources; run photos sync');
    if (data.version !== 'v10' || !Array.isArray(data.data)) throw new Error('Expected native v10 Manifest or unified Photo Index');
    photos = data.data;
  }
  const index = new Map(photos.map(photo => [photo.id, photo]));
  if (index.size !== photos.length) throw new Error('Duplicate photo ID');
  return {
    getPhoto: (id: PhotoManifestItem['id']) => structuredClone(index.get(id) ?? index.get(aliases.get(id) ?? '')),
    listPhotos: (): readonly PhotoManifestItem[] => structuredClone(photos),
  };
}
