import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { runWithPhotoExecutionContext, createStorageKeyNormalizer } from '@afilmory/builder/photo/execution-context.js';
import { createPhotoProcessingLoggers } from '@afilmory/builder/photo/logger-adapter.js';
import { logger } from '@afilmory/builder/logger/index.js';
import { AfilmoryBuilder } from '@afilmory/builder/builder/builder.js';
import { GitHubStorageProvider } from '@afilmory/builder/storage/providers/github-provider.js';
import type { StorageObject } from '@afilmory/builder/storage/interfaces.js';
import { extractPhotoInfo } from '@afilmory/builder/photo/info-extractor.js';
import type { PhotoManifestItem } from '@afilmory/typing';
import { processingFingerprint } from './fingerprint.js';
import { createPhotoConfig } from '../../builder.config.js';

export const api = 'https://api.github.com/repos/jason22016/jason-photos';
export const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
// Predict ONLY the local filename for prefill; the Builder owns the actual ID.
// Every resulting native ID is checked against this prediction before publication.
export const expectedId = (key: string) => `${path.basename(key, path.extname(key))}_${hash(key).slice(0, 8)}`;
export function uniqueIds(items: Array<{ id: string }>) {
  if (new Set(items.map(x => x.id)).size !== items.length) throw new Error('Duplicate photo ID');
}
export async function jsonGet(url: string): Promise<any> {
  const r = await fetch(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'jason-gallery', ...(process.env.JASON_PHOTOS_READ_TOKEN ? { Authorization: `Bearer ${process.env.JASON_PHOTOS_READ_TOKEN}` } : {}) } });
  if (!r.ok) throw new Error(`GET ${url}: ${r.status}`);
  return r.json();
}
export async function decode(bytes: Buffer) {
  const result = await sharp(bytes, { failOn: 'warning' }).raw().toBuffer({ resolveWithObject: true });
  if (!result.info.width || !result.info.height) throw new Error('Empty thumbnail');
}
interface CacheEntry { original: string; remote?: string; thumbnail: string; metadata?: string; }
interface Cache { fingerprint: string; ref: string; entries: Record<string, CacheEntry>; }
export async function buildPhotos(options: { root: string; ref: string; keyRegex?: string }) {
  if (!/^[a-f0-9]{40}$/.test(options.ref)) throw new Error('A pinned Git commit is required');
  const workdir = process.env.JASON_GALLERY_PHOTO_WORKDIR!;
  if (!workdir || !path.isAbsolute(workdir)) throw new Error('Missing absolute workdir');
  const cacheDir = path.join(options.root, 'cache');
  const config = createPhotoConfig(options.ref);
  const fingerprint = await processingFingerprint();
  let old: Cache | undefined;
  try { old = JSON.parse(await fs.readFile(path.join(cacheDir, 'state.json'), 'utf8')); } catch {}
  const next: Cache = { fingerprint, ref: options.ref, entries: {} };
  const storage = new GitHubStorageProvider(config.user!.storage as any);
  // No write-capable provider method is available through the Builder manager.
  const deny = async () => { throw new Error('Photo repository is read-only'); };
  const decisions: Record<string, string> = {};
  const warnings: string[] = [];
  let originals: StorageObject[] = [];
  let all: StorageObject[] = [];
  const blobs = new Map<string, Buffer>();
  const reused = new Map<string, PhotoManifestItem>();
  async function bytes(key: string, sha: string) {
    const cached = path.join(cacheDir, 'blobs', sha);
    let data: Buffer;
    try { data = await fs.readFile(cached); } catch {
      const result = await storage.getFile(key);
      if (!result) throw new Error(`Missing source: ${key}`);
      data = result;
    }
    const actual = createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');
    if (actual !== sha) throw new Error(`Git blob digest mismatch: ${key}`);
    await fs.mkdir(path.dirname(cached), { recursive: true });
    await fs.writeFile(cached, data);
    return data;
  }
  config.plugins.push({
    name: 'jason:readonly-reconciliation',
    hooks: {
      onInit: async ({ builder }) => {
        const manager = builder.getStorageManager();
        manager.addExcludePrefix('.afilmory');
        manager.uploadFile = deny; manager.deleteFile = deny; manager.deleteFolder = deny; manager.moveFile = deny;
        // Native GitHub scanner once, pinned to a commit; avoid duplicate API scans.
        all = await storage.listAllFiles();
        // Contents API can truncate large directories; independently cross-check Git's tree.
        const tree = await jsonGet(`${api}/git/trees/${options.ref}?recursive=1`);
        if (tree.truncated || !Array.isArray(tree.tree)) throw new Error('Incomplete Git tree');
        const sourceTree = tree.tree.filter((x: any) => x.path.startsWith('images/') && x.type !== 'tree');
        if (sourceTree.some((x: any) => x.type !== 'blob' || x.mode === '120000') || sourceTree.length !== all.length || sourceTree.some((x: any) => !all.some(o => o.key === x.path.slice(7) && o.etag === x.sha && o.size === x.size))) throw new Error('Source listing differs from pinned Git tree');
        manager.listAllFiles = async () => all.filter(x => !x.key.split('/').includes('.afilmory'));
        const { SUPPORTED_FORMATS } = await import('@afilmory/builder/constants/index.js');
        manager.listImages = async () => (await manager.listAllFiles()).filter(x => SUPPORTED_FORMATS.has(path.extname(x.key).toLowerCase()));
        manager.getFile = async key => {
          const object = all.find(x => x.key === key);
          if (!object?.etag) throw new Error(`Source absent from snapshot: ${key}`);
          const original = await bytes(key, object.etag);
          await sharp(original, { failOn: 'warning' }).stats();
          return original;
        };
      },
      afterImagesListed: async ({ payload }) => {
        originals = [...payload.imageObjects];
        if (!originals.length) throw new Error('No photos in snapshot');
        await fs.writeFile(path.join(workdir, 'source-snapshot.json'), JSON.stringify({ ref: options.ref, all, originals }, null, 2));
        uniqueIds(originals.map(x => ({ id: expectedId(x.key) })));
        const basenameCounts = new Map<string, number>();
        for (const obj of originals) {
          const base = path.parse(obj.key).name;
          // Count ALL originals, including those outside a debug sample.
          basenameCounts.set(base, all.filter(x => !x.key.split('/').includes('.afilmory') && path.parse(x.key).name === base).length);
        }
        await fs.mkdir(path.join(workdir, 'public/thumbnails'), { recursive: true });
        for (const obj of originals) {
          if (!/^[a-f0-9]{40}$/.test(obj.etag ?? '')) throw new Error(`Missing blob SHA: ${obj.key}`);
          const id = expectedId(obj.key);
          const legacyKey = `.afilmory/thumbnails/${path.parse(obj.key).name}.jpg`;
          const remote = all.find(x => x.key === `.afilmory/thumbnails/${id}.jpg`) ?? (basenameCounts.get(path.parse(obj.key).name) === 1 ? all.find(x => x.key === legacyKey) : undefined);
          const previous = old?.fingerprint === fingerprint ? old.entries[obj.key] : undefined;
          let thumbnail: Buffer | undefined;
          if (previous && previous.original === obj.etag && previous.remote === remote?.etag) {
            try {
              const candidate = await fs.readFile(path.join(cacheDir, 'thumbnails', `${id}.jpg`));
              if (hash(candidate) !== previous.thumbnail) throw new Error('Changed cached thumbnail');
              await decode(candidate); thumbnail = candidate; decisions[obj.key] = 'local';
            } catch (error) { warnings.push(`Invalid local thumbnail ${obj.key}: ${error instanceof Error ? error.message : String(error)}`); }
          }
          // Unversioned repository thumbnails cannot prove processor/config provenance.
          // Reuse verified local derivatives only; regenerate legacy candidates.
          if (thumbnail) await fs.writeFile(path.join(workdir, 'public/thumbnails', `${id}.jpg`), thumbnail);
          else decisions[obj.key] ??= remote ? 'generated:unversioned-remote' : 'generated:missing';
          next.entries[obj.key] = { original: obj.etag!, remote: remote?.etag, thumbnail: '' };
          if (decisions[obj.key] === 'local' && previous?.metadata) {
            try {
              const metadata = await fs.readFile(path.join(cacheDir, 'metadata', `${id}.json`));
              if (hash(metadata) !== previous.metadata) throw new Error('Changed cached metadata');
              const item: PhotoManifestItem = JSON.parse(metadata.toString());
              if (item.id !== id || item.s3Key !== obj.key || item.size !== obj.size) throw new Error('Metadata source mismatch');
              // Identical verified bytes were fully decoded on the successful producing run.
              // Verify bytes again, but avoid Sharp/ExifTool/tone work for unchanged originals.
              await bytes(obj.key, obj.etag!);
              // Keep native merged XMP tags and all byte-derived metadata intact.
              item.dateTaken = extractPhotoInfo(obj.key, item.exif).dateTaken;
              item.originalUrl = storage.generatePublicUrl(obj.key);
              item.lastModified = obj.lastModified?.toISOString() ?? new Date().toISOString();
              reused.set(obj.key, item);
            } catch { warnings.push(`Metadata cache miss: ${obj.key}`); }
          }
        }
      },
      afterTasksPrepared: ({ payload }) => {
        const pending = payload.tasks.filter(obj => !reused.has(obj.key));
        payload.tasks.splice(0, payload.tasks.length, ...pending);
      },
      afterProcessTasks: ({ payload }) => {
        if (payload.results.length !== originals.length - reused.size || payload.results.some(result => result.type === 'failed' || !result.item)) throw new Error('Photo processing failed: refusing incomplete manifest');
        payload.manifest.push(...reused.values());
      },
      beforeSaveManifest: async ({ payload }) => {
        const items = payload.manifest;
        uniqueIds(items);
        if (items.length !== originals.length) throw new Error('Incomplete manifest');
        for (const item of items) {
          if (!next.entries[item.s3Key] || item.id !== expectedId(item.s3Key) || item.originalUrl !== storage.generatePublicUrl(item.s3Key)) throw new Error('Native ID/key mismatch');
          if (!item.thumbHash || !item.width || !item.height || !item.exif || !item.toneAnalysis || item.thumbnailUrl !== `/thumbnails/${item.id}.jpg`) throw new Error(`Invalid photo result: ${item.id}`);
          const data = await fs.readFile(path.join(workdir, 'public/thumbnails', `${item.id}.jpg`));
          await decode(data); blobs.set(item.id, data);
          next.entries[item.s3Key]!.thumbnail = hash(data);
        }
      },
    },
  });
  // Construct AFTER adding plugin references (constructor captures references).
  const configuredBuilder = new AfilmoryBuilder(config);
  await configuredBuilder.ensurePluginsReady();
  await runWithPhotoExecutionContext({ builder: configuredBuilder, storageManager: configuredBuilder.getStorageManager(), storageConfig: config.user!.storage!, normalizeStorageKey: createStorageKeyNormalizer(config.user!.storage!), loggers: createPhotoProcessingLoggers(0, logger) }, () => configuredBuilder.buildManifest({ isForceMode: false, isForceManifest: true, isForceThumbnails: false, keyRegex: options.keyRegex }));
  const manifestFile = path.join(workdir, 'src/data/photos-manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
  if (manifest.version !== 'v10') throw new Error(`Unexpected schema: ${manifest.version}`);
  await fs.mkdir(path.join(cacheDir, 'thumbnails'), { recursive: true });
  for (const [id, data] of blobs) await fs.writeFile(path.join(cacheDir, 'thumbnails', `${id}.jpg`), data);
  await fs.mkdir(path.join(cacheDir, 'metadata'), { recursive: true });
  for (const item of manifest.data) {
    const data = JSON.stringify(item);
    next.entries[item.s3Key]!.metadata = hash(data);
    await fs.writeFile(path.join(cacheDir, 'metadata', `${item.id}.json`), data);
  }
  await fs.writeFile(path.join(cacheDir, 'state.json.tmp'), JSON.stringify(next, null, 2));
  await fs.rename(path.join(cacheDir, 'state.json.tmp'), path.join(cacheDir, 'state.json'));
  await fs.writeFile(path.join(workdir, 'result.json'), JSON.stringify({ ref: options.ref, fingerprint, complete: !options.keyRegex, scanned: all.length, photos: originals.length, processed: originals.length - reused.size, reused: reused.size, decisions, warnings }, null, 2));
  return { manifest, manifestFile, decisions, scanned: all.length };
}
