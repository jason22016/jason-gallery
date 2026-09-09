import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { AfilmoryManifest } from '@afilmory/typing';
import { SUPPORTED_FORMATS } from '@afilmory/builder/constants/index.js';
import type { StorageObject } from '@afilmory/builder/storage/interfaces.js';
import type { RequestAudit } from './network.js';

const args = process.argv.slice(2);
const value = (flag: string) => args[args.indexOf(flag) + 1];
assert(args.includes('--run'), 'Pass the completed Builder --run directory');
const run = path.resolve(value('--run')!);
const root = path.dirname(run);
const snapshot: { ref: string; all: StorageObject[]; originals: StorageObject[] } = JSON.parse(await fs.readFile(path.join(run, 'source-snapshot.json'), 'utf8'));
const manifestBytes = await fs.readFile(path.join(run, 'src/data/photos-manifest.json'));
const manifest: AfilmoryManifest = JSON.parse(manifestBytes.toString());
const result = JSON.parse(await fs.readFile(path.join(run, 'result.json'), 'utf8'));
const requests: RequestAudit[] = JSON.parse(await fs.readFile(path.join(run, 'requests.json'), 'utf8'));
const state = JSON.parse(await fs.readFile(path.join(root, 'cache/state.json'), 'utf8'));
const hash = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const originalFiles = snapshot.all.filter(x => !x.key.split('/').includes('.afilmory') && SUPPORTED_FORMATS.has(path.extname(x.key).toLowerCase()));
const keys = originalFiles.map(x => x.key).sort();
assert(keys.length > 0);
assert.equal(new Set(keys).size, keys.length);
assert.deepEqual(snapshot.originals.map(x => x.key).sort(), keys, 'Filtered runs cannot pass the full gate');
assert.deepEqual(manifest.data.map(x => x.s3Key).sort(), keys, 'Every original must be present exactly once');
assert.deepEqual(Object.keys(manifest).sort(), ['cameras', 'data', 'lenses', 'version']);
assert.equal(manifest.version, 'v10');
assert.equal(new Set(manifest.data.map(x => x.id)).size, keys.length);
assert.deepEqual(Object.keys(state.entries).sort(), keys);
assert.equal(result.photos, keys.length);
assert(requests.length > 0 && requests.every(r => ['GET', 'HEAD'].includes(r.method)), 'Repository writes are forbidden');
assert(requests.every(r => !r.error && r.status === 200), 'Final acceptance requires a clean successful request audit');
const thumbnailNames = manifest.data.map(x => `${x.id}.jpg`).sort();
const thumbnailDirs = [path.join(run, 'public/thumbnails'), path.join(root, 'output/public/thumbnails')];
if (args.includes('--exported')) thumbnailDirs.push(path.resolve('public/thumbnails'));
for (const dir of thumbnailDirs) assert.deepEqual((await fs.readdir(dir)).sort(), thumbnailNames, `Thumbnail count/names mismatch: ${dir}`);
assert.equal(hash(await fs.readFile(path.join(root, 'output/photos-manifest.json'))), hash(manifestBytes));
if (args.includes('--exported')) assert.equal(hash(await fs.readFile('src/data/photos-manifest.json')), hash(manifestBytes));
let originalBytes = 0, thumbnailBytes = 0;
const thumbnailHashes: Record<string, string> = {};
for (const item of manifest.data) {
  const object = originalFiles.find(x => x.key === item.s3Key)!;
  assert(object.etag && /^[a-f0-9]{40}$/.test(object.etag));
  const original = await fs.readFile(path.join(root, 'cache/blobs', object.etag));
  assert.equal(createHash('sha1').update(`blob ${original.length}\0`).update(original).digest('hex'), object.etag);
  assert.equal(original.length, object.size);
  assert.equal(item.size, original.length);
  assert.equal(state.entries[item.s3Key].original, object.etag);
  assert.equal(item.originalUrl, `https://raw.githubusercontent.com/jason22016/jason-photos/${snapshot.ref}/images/${item.s3Key}`);
  assert.equal(item.thumbnailUrl, `/thumbnails/${item.id}.jpg`);
  assert(item.width > 0 && item.height > 0 && item.thumbHash && item.exif && item.toneAnalysis, `Incomplete metadata: ${item.id}`);
  const thumb = await fs.readFile(path.join(thumbnailDirs[0]!, `${item.id}.jpg`));
  await sharp(thumb, { failOn: 'warning' }).stats();
  const digest = hash(thumb);
  assert.equal(state.entries[item.s3Key].thumbnail, digest);
  for (const dir of thumbnailDirs.slice(1)) assert.equal(hash(await fs.readFile(path.join(dir, `${item.id}.jpg`))), digest);
  thumbnailHashes[item.id] = digest;
  originalBytes += original.length; thumbnailBytes += thumb.length;
}
const counts = (values: string[]) => Object.fromEntries([...new Set(values)].sort().map(value => [value, values.filter(x => x === value).length]));
const report = {
  status: 'PASS', ref: snapshot.ref, run: path.basename(run), scannedFiles: snapshot.all.length,
  originalCount: keys.length, manifestCount: manifest.data.length, thumbnailCount: thumbnailNames.length,
  remoteThumbnailCount: snapshot.all.filter(x => x.key.startsWith('.afilmory/thumbnails/') && x.key.endsWith('.jpg')).length,
  excludedNonPhotos: snapshot.all.filter(x => !x.key.split('/').includes('.afilmory') && !SUPPORTED_FORMATS.has(path.extname(x.key).toLowerCase())).map(x => x.key),
  originalBytes, thumbnailBytes, manifestBytes: manifestBytes.length, manifestSha256: hash(manifestBytes),
  decisions: counts(Object.values(result.decisions)), warnings: result.warnings,
  network: { count: requests.length, methods: counts(requests.map(x => x.method)), statuses: counts(requests.map(x => String(x.status))), attemptsBeyondFirst: requests.filter(x => x.attempt > 1).length, minimumRateLimitRemaining: Math.min(...requests.flatMap(x => x.rateLimitRemaining ? [Number(x.rateLimitRemaining)] : [])) },
  hdrCount: manifest.data.filter(x => x.isHDR).length, thumbnailHashes,
};
await fs.writeFile(path.join(run, 'full-verification.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, thumbnailHashes: `${Object.keys(thumbnailHashes).length} verified SHA-256 values in full-verification.json` }, null, 2));
