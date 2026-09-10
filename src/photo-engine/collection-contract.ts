// Shared CI/Worker verification of signed-by-provenance artifact metadata. Native data is never rewritten.
import { createHash } from 'node:crypto';
import type { AfilmoryManifest } from '@afilmory/typing';
import type { PhotoCollection } from '../../scripts/photos/collection';
import { verifySnapshot, photoReference, originalURL, type SourcesConfig } from './source-contract';
import { projectUnifiedIndex, type UnifiedIndex } from './unified-index';
export const hashBytes = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
export async function readCollection(read: (path: string) => Promise<Uint8Array>, config?: SourcesConfig, production = true) {
  const parse = (bytes: Uint8Array) => JSON.parse(new TextDecoder().decode(bytes));
  const artifact: PhotoCollection = parse(await read('artifact.json'));
  const { version, ...record } = artifact;
  if (artifact.schemaVersion !== 2 || artifact.kind !== 'photos' || !artifact.complete || version !== hashBytes(JSON.stringify(record)) || production && artifact.source !== 'github') throw new Error('照片产物格式或摘要无效；请重新同步');
  verifySnapshot(artifact.snapshot, config);
  const verified = async (path: string) => { const value = await read(path); if (artifact.files[path] !== hashBytes(value)) throw new Error('照片产物文件摘要不匹配'); return value; };
  const manifests = new Map<string, AfilmoryManifest>();
  for (const s of artifact.snapshot.sources) {
    const base = `sources/${s.sourceId}/`;
    const native = parse(await verified(base + 'artifact.json'));
    const { version: nv, ...nr } = native;
    if (nv !== hashBytes(JSON.stringify(nr)) || native.schemaVersion !== 1 || native.kind !== 'photos' || !native.complete || native.source !== artifact.source || native.fingerprint !== artifact.fingerprint || native.photoCommit !== s.commit || JSON.stringify(native.sourceConfig) !== JSON.stringify(artifact.snapshot.config.sources.find(c => c.sourceId === s.sourceId))) throw new Error('原生照片产物身份不匹配');
    const data = await verified(base + 'photos-manifest.json');
    if (native.files['photos-manifest.json'] !== hashBytes(data)) throw new Error('原生 Manifest 摘要不匹配');
    const manifest: AfilmoryManifest = parse(data);
    if (native.photos !== manifest.data.length) throw new Error('照片数量不匹配');
    for (const photo of manifest.data) {
      const key = photo.s3Key;
      if (typeof key !== 'string' || key.split('/').some(p => !p || p === '.' || p === '..') || photo.originalUrl !== originalURL(s, s.commit, key) || photo.thumbnailUrl !== `/thumbnails/${photo.id}.jpg`) throw new Error('照片 URL 不匹配');
      if (artifact.files[`public/thumbnails/${photoReference(s, photo.id)}.jpg`] !== native.files[`public/thumbnails/${photo.id}.jpg`]) throw new Error('跨源缩略图摘要不匹配');
    }
    manifests.set(s.sourceId, manifest);
  }
  const index: UnifiedIndex = parse(await verified('photo-index.json'));
  if (JSON.stringify(index.snapshot) !== JSON.stringify(artifact.snapshot)) throw new Error('照片索引快照不匹配');
  const projection = projectUnifiedIndex(index, manifests);
  if (projection.photos.length !== artifact.photos) throw new Error('完整索引数量不匹配');
  return { artifact, index, ...projection, read: verified };
}
