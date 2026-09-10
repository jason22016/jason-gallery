import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { AfilmoryManifest } from '@afilmory/typing';
import { SourceSchema, originalURL, type PhotoSource } from '../../src/photo-engine/sources.js';
export const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
export async function fileHashes(directory: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  async function walk(relative: string) {
    for (const entry of (await fs.readdir(path.join(directory, relative), { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
      const name = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) await walk(name);
      else if (entry.isFile()) result[name] = sha256(await fs.readFile(path.join(directory, name)));
      else throw new Error('Artifact may not contain symlinks');
    }
  }
  await walk(''); return result;
}
export interface PhotoArtifact {
  schemaVersion: 1; kind: 'photos'; source: 'github' | 'fixture'; complete: boolean;
  photoCommit: string; fingerprint: string; websiteCommit: string | null;
  photos: number; processed: number; reused: number; files: Record<string, string>; version: string;
  sourceConfig: PhotoSource;
}
export async function sealPhotos(directory: string, source: 'github' | 'fixture', websiteCommit: string | null) {
  const result = JSON.parse(await fs.readFile(path.join(directory, 'result.json'), 'utf8'));
  const sourceConfig = SourceSchema.parse(JSON.parse(await fs.readFile(path.join(directory, 'source-snapshot.json'), 'utf8')).source);
  const files = await fileHashes(directory);
  const record = { schemaVersion: 1 as const, kind: 'photos' as const, source, sourceConfig, complete: result.complete, photoCommit: result.ref, fingerprint: result.fingerprint, websiteCommit, photos: result.photos, processed: result.processed, reused: result.reused, files };
  const artifact: PhotoArtifact = { ...record, version: sha256(JSON.stringify(record)) };
  await fs.writeFile(path.join(directory, 'artifact.json'), JSON.stringify(artifact, null, 2));
  return artifact;
}
export async function verifyPhotos(directory: string, options: { ref?: string; fingerprint?: string; production?: boolean } = {}) {
  const artifact: PhotoArtifact = JSON.parse(await fs.readFile(path.join(directory, 'artifact.json'), 'utf8'));
  const { version, ...record } = artifact;
  if (artifact.schemaVersion !== 1 || artifact.kind !== 'photos' || sha256(JSON.stringify(record)) !== version) throw new Error('Invalid photo artifact descriptor');
  const sourceConfig = SourceSchema.parse(artifact.sourceConfig);
  if (!artifact.complete || !/^[a-f0-9]{40}$/.test(artifact.photoCommit)) throw new Error('Incomplete/unpinned photo artifact');
  if (options.production && artifact.source !== 'github') throw new Error('Fixture artifact cannot be published');
  if (options.ref && artifact.photoCommit !== options.ref) throw new Error('Photo commit mismatch');
  if (options.fingerprint && artifact.fingerprint !== options.fingerprint) throw new Error('Processing fingerprint mismatch; rebuild photos');
  const files = await fileHashes(directory); delete files['artifact.json'];
  if (JSON.stringify(files) !== JSON.stringify(artifact.files)) throw new Error('Photo artifact file digest mismatch');
  const manifest: AfilmoryManifest = JSON.parse(await fs.readFile(path.join(directory, 'photos-manifest.json'), 'utf8'));
  const snapshot = JSON.parse(await fs.readFile(path.join(directory, 'source-snapshot.json'), 'utf8'));
  if (JSON.stringify(snapshot.source) !== JSON.stringify(sourceConfig) || snapshot.ref !== artifact.photoCommit || manifest.version !== 'v10' || manifest.data.length !== artifact.photos || snapshot.originals.length !== artifact.photos) throw new Error('Photo count/snapshot mismatch');
  const keys = new Set(snapshot.originals.map((x: {key: string}) => x.key));
  const ids = new Set<string>();
  for (const photo of manifest.data) {
    if (!keys.delete(photo.s3Key) || ids.has(photo.id) || photo.id.includes('/') || photo.id.includes('\\') || photo.id !== `${path.basename(photo.s3Key, path.extname(photo.s3Key))}_${sha256(photo.s3Key).slice(0, 8)}`) throw new Error('Photo ID/key mismatch');
    ids.add(photo.id);
    const url = originalURL(sourceConfig, artifact.photoCommit, photo.s3Key);
    if (photo.originalUrl !== url || photo.thumbnailUrl !== `/thumbnails/${photo.id}.jpg` || !photo.thumbHash || !photo.width || !photo.height || !photo.exif || !photo.toneAnalysis) throw new Error('Invalid photo metadata/URL');
    await sharp(path.join(directory, 'public', photo.thumbnailUrl), { failOn: 'warning' }).raw().toBuffer();
  }
  const thumbnails = Object.keys(files).filter(x => x.startsWith('public/'));
  if (thumbnails.length !== ids.size || thumbnails.some(x => !ids.has(x.slice('public/thumbnails/'.length, -4)))) throw new Error('Unexpected preview asset');
  return artifact;
}
