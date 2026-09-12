import fs from 'node:fs/promises';
import { readCollection } from '../../src/photo-engine/collection-contract.js';
import path from 'node:path';
import type { AfilmoryManifest } from '@afilmory/typing';
import { fileHashes, sha256, verifyPhotos } from './artifact.js';
import { photoReference, verifySnapshot, type SourcesConfig, type PhotoSnapshot } from '../../src/photo-engine/sources.js';
import { createUnifiedIndex, type UnifiedIndex } from '../../src/photo-engine/unified-index.js';
import type { SourceStatus } from './snapshot.js';

export interface PhotoCollection {
  schemaVersion: 2; kind: 'photos'; complete: true; source: 'github' | 'fixture';
  snapshot: PhotoSnapshot; fingerprint: string; websiteCommit: string | null;
  photos: number; processed: number; reused: number; sources: SourceStatus[];
  files: Record<string,string>; version: string;
}
export async function sealCollection(directory: string, snapshot: PhotoSnapshot, fingerprint: string, source: 'github' | 'fixture', sources: SourceStatus[], websiteCommit: string | null = process.env.GITHUB_SHA ?? null) {
  const manifests = new Map<string,AfilmoryManifest>();
  await fs.mkdir(path.join(directory, 'public/thumbnails'), { recursive: true });
  for (const entry of snapshot.sources) {
    const root = path.join(directory, 'sources', entry.sourceId);
    const native = await verifyPhotos(root, { ref: entry.commit, fingerprint, production: source === 'github' });
    if (JSON.stringify(native.sourceConfig) !== JSON.stringify(snapshot.config.sources.find(s => s.sourceId === entry.sourceId))) throw new Error('Native source configuration mismatch');
    const manifest: AfilmoryManifest = JSON.parse(await fs.readFile(path.join(root, 'photos-manifest.json'), 'utf8'));
    manifests.set(entry.sourceId, manifest);
    for (const photo of manifest.data) await fs.copyFile(path.join(root, 'public/thumbnails', `${photo.id}.jpg`), path.join(directory, 'public/thumbnails', `${photoReference(entry, photo.id)}.jpg`));
  }
  const index = createUnifiedIndex(snapshot, manifests);
  await fs.writeFile(path.join(directory, 'photo-index.json'), JSON.stringify(index));
  const record = { schemaVersion: 2 as const, kind: 'photos' as const, complete: true as const, source, snapshot, fingerprint, websiteCommit, photos: index.entries.length, processed: sources.reduce((n,s) => n + (s.processed ?? 0), 0), reused: sources.reduce((n,s) => n + (s.reused ?? 0), 0), sources, files: await fileHashes(directory) };
  const artifact: PhotoCollection = { ...record, version: sha256(JSON.stringify(record)) };
  await fs.writeFile(path.join(directory, 'artifact.json'), JSON.stringify(artifact, null, 2));
  return artifact;
}
export async function verifyCollection(directory: string, options: { config?: SourcesConfig; snapshot?: PhotoSnapshot; fingerprint?: string; production?: boolean } = {}) {
  const artifact: PhotoCollection = JSON.parse(await fs.readFile(path.join(directory, 'artifact.json'), 'utf8'));
  const { version, ...record } = artifact;
  if (artifact.schemaVersion !== 2 || artifact.kind !== 'photos' || artifact.complete !== true || sha256(JSON.stringify(record)) !== version) throw new Error('Invalid multi-source photo artifact; rebuild legacy artifacts');
  const snapshot = verifySnapshot(artifact.snapshot, options.config);
  if (options.snapshot && snapshot.version !== verifySnapshot(options.snapshot).version) throw new Error('Photo snapshot mismatch');
  if (options.fingerprint && artifact.fingerprint !== options.fingerprint) throw new Error('Processing fingerprint mismatch; rebuild photos');
  if (options.production && artifact.source !== 'github') throw new Error('Fixture artifact cannot be published');
  const files = await fileHashes(directory); delete files['artifact.json'];
  if (JSON.stringify(files) !== JSON.stringify(artifact.files)) throw new Error('Photo artifact file digest mismatch');
  const manifests = new Map<string,AfilmoryManifest>();
  const expectedFiles = new Set(['photo-index.json']);
  let total = 0, processed = 0, reused = 0;
  for (const s of snapshot.sources) {
    const root = path.join(directory, 'sources', s.sourceId);
    const native = await verifyPhotos(root, { ref: s.commit, fingerprint: artifact.fingerprint, production: options.production });
    if (native.source !== artifact.source || JSON.stringify(native.sourceConfig) !== JSON.stringify(snapshot.config.sources.find(c => c.sourceId === s.sourceId))) throw new Error('Source artifact identity mismatch');
    const manifest: AfilmoryManifest = JSON.parse(await fs.readFile(path.join(root, 'photos-manifest.json'), 'utf8'));
    manifests.set(s.sourceId, manifest);
    for (const name of Object.keys(await fileHashes(root))) expectedFiles.add(`sources/${s.sourceId}/${name}`);
    for (const photo of manifest.data) {
      const name = `public/thumbnails/${photoReference(s, photo.id)}.jpg`;
      expectedFiles.add(name);
      if (files[name] !== native.files[`public/thumbnails/${photo.id}.jpg`]) throw new Error('Cross-source thumbnail mismatch');
    }
    const status = artifact.sources.find(status => status.sourceId === s.sourceId);
    if (!status || status.status !== 'success' || status.failureReason !== null || status.commit !== s.commit || status.total !== native.photos || status.processed !== (status.retained ? 0 : native.processed) || status.reused !== (status.retained ? native.photos : native.reused)) throw new Error('Source result mismatch');
    total += native.photos; processed += status.processed; reused += status.reused;
  }
  if (artifact.sources.length !== snapshot.config.sources.length || new Set(artifact.sources.map(s => s.sourceId)).size !== artifact.sources.length) throw new Error('Source status set mismatch');
  for (const s of snapshot.config.sources.filter(s => !s.enabled)) {
    const status = artifact.sources.find(status => status.sourceId === s.sourceId);
    if (!status || status.status !== 'disabled' || status.total !== null || status.commit !== null || status.processed !== null || status.reused !== null) throw new Error('Disabled source result mismatch');
  }
  const index: UnifiedIndex = JSON.parse(await fs.readFile(path.join(directory, 'photo-index.json'), 'utf8'));
  if (JSON.stringify(index) !== JSON.stringify(createUnifiedIndex(snapshot, manifests)) || artifact.photos !== total || artifact.processed !== processed || artifact.reused !== reused) throw new Error('Unified photo count/index mismatch');
  if (Object.keys(files).length !== expectedFiles.size || Object.keys(files).some(name => !expectedFiles.has(name))) throw new Error('Unexpected collection asset');
  await readCollection(name => fs.readFile(path.join(directory, name)), options.config, options.production ?? false);
  return artifact;
}
export async function exportCollection(directory: string, root: string) {
  await verifyCollection(directory);
  const cache = path.join(root, '.cache'); await fs.mkdir(cache, { recursive: true });
  const lock = path.join(cache, 'photo-export.lock');
  await fs.mkdir(lock).catch(() => { throw new Error('Photo export already running'); });
  const staging = await fs.mkdtemp(path.join(cache, 'photo-export-'));
  const swaps: Array<{ target:string; backup:string; installed:boolean; saved:boolean }> = [];
  try {
    const data = path.join(staging, 'data');
    await fs.mkdir(path.join(data, 'sources'), { recursive: true });
    const index: UnifiedIndex = JSON.parse(await fs.readFile(path.join(directory, 'photo-index.json'), 'utf8'));
    for (const s of index.snapshot.sources) {
      await fs.mkdir(path.join(data, 'sources', s.sourceId));
      await fs.copyFile(path.join(directory, 'sources', s.sourceId, 'photos-manifest.json'), path.join(data, 'sources', s.sourceId, 'photos-manifest.json'));
    }
    await fs.copyFile(path.join(directory, 'photo-index.json'), path.join(data, 'photo-index.json'));
    await fs.cp(path.join(directory, 'public/thumbnails'), path.join(staging, 'thumbnails'), { recursive: true });
    // Fully copy/verify before touching current data. Roll back both directories
    // if installation fails; the immutable collection output is the CI boundary.
    await verifyCollection(directory);
    for (const [name, target] of [['data',path.join(root,'src/data')],['thumbnails',path.join(root,'public/thumbnails')]]) {
      await fs.mkdir(path.dirname(target!), { recursive: true });
      const swap = { target:target!, backup:path.join(staging, `old-${name}`), installed:false, saved:false };
      swaps.push(swap);
      if (await fs.lstat(target!).catch(() => null)) { await fs.rename(target!, swap.backup); swap.saved = true; }
      await fs.rename(path.join(staging, name!), target!); swap.installed = true;
    }
  } catch (error) {
    for (const swap of swaps.reverse()) {
      if (swap.installed) await fs.rm(swap.target, { recursive:true, force:true });
      if (swap.saved) await fs.rename(swap.backup, swap.target);
    }
    throw error;
  } finally { await fs.rm(lock, { recursive:true, force:true }); }
}
