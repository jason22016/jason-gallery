import type { AfilmoryManifest, PhotoManifestItem } from '@afilmory/typing';
import { LEGACY_SOURCE, photoReference, sourceIdentity, verifySnapshot, type PhotoSnapshot } from './source-contract.js';

export interface UnifiedIndex {
  schemaVersion: 1; kind: 'photo-index'; snapshot: PhotoSnapshot;
  entries: Array<{ reference: string; sourceId: string; nativeId: string }>;
}
export function createUnifiedIndex(snapshot: PhotoSnapshot, manifests: Map<string, AfilmoryManifest>): UnifiedIndex {
  verifySnapshot(snapshot);
  const entries: UnifiedIndex['entries'] = [];
  for (const source of snapshot.sources) {
    const manifest = manifests.get(source.sourceId);
    if (!manifest || manifest.version !== 'v10') throw new Error(`Missing native v10 Manifest: ${source.sourceId}`);
    const ids = new Set<string>();
    for (const photo of manifest.data) {
      if (!photo.id || /[/\\\x00-\x1f]/.test(photo.id) || ids.has(photo.id)) throw new Error(`Invalid/duplicate native photo ID: ${source.sourceId}`);
      ids.add(photo.id);
      entries.push({ reference: photoReference(source, photo.id), sourceId: source.sourceId, nativeId: photo.id });
    }
  }
  if (new Set(entries.map(entry => entry.reference)).size !== entries.length) throw new Error('Qualified photo reference collision');
  return { schemaVersion: 1, kind: 'photo-index', snapshot, entries };
}
export function projectUnifiedIndex(index: UnifiedIndex, manifests: Map<string, AfilmoryManifest>) {
  const expected = createUnifiedIndex(index.snapshot, manifests);
  if (JSON.stringify(expected) !== JSON.stringify(index)) throw new Error('Unified Photo Index differs from native Manifests/snapshot');
  const photos: PhotoManifestItem[] = [];
  const aliases = new Map<string, string>();
  for (const source of index.snapshot.sources) {
    const legacy = source.sourceId === LEGACY_SOURCE.sourceId && sourceIdentity(source) === sourceIdentity(LEGACY_SOURCE);
    for (const native of manifests.get(source.sourceId)!.data) {
      const id = photoReference(source, native.id);
      // Website projection only. Native Manifests are never mutated or extended.
      photos.push({ ...structuredClone(native), id, thumbnailUrl: `/thumbnails/${id}.jpg` });
      if (legacy) aliases.set(native.id, id);
    }
  }
  return { photos, aliases };
}
