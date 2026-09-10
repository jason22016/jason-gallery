/** Optional read-only audit of the existing Phase 1 cache; never downloads or exports. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { AfilmoryManifest } from '../../src/photo-engine';
import { extractJPEGGainMap } from '../../packages/afilmory/webgl-viewer/src/jpeg-gainmap';

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const manifestBytes = await fs.readFile('src/data/photos-manifest.json');
const manifest: AfilmoryManifest = JSON.parse(manifestBytes.toString());
const state: { ref: string; entries: Record<string, { original: string; thumbnail: string }> } = JSON.parse(await fs.readFile('.cache/photo-engine/cache/state.json', 'utf8'));
const photos = [];
for (const photo of manifest.data) {
  const entry = state.entries[photo.s3Key]!;
  const bytes = await fs.readFile(`.cache/photo-engine/cache/blobs/${entry.original}`);
  assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), entry.original, photo.s3Key);
  assert.equal(photo.originalUrl, `https://raw.githubusercontent.com/jason22016/jason-photos/${state.ref}/images/${encodeURIComponent(photo.s3Key).replaceAll('%2F', '/')}`);
  const metadata = await sharp(bytes).metadata();
  const parsed = extractJPEGGainMap(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const thumbnail = await fs.readFile(`public${photo.thumbnailUrl}`);
  assert.equal(digest(thumbnail), entry.thumbnail);
  const thumbMetadata = await sharp(thumbnail).metadata();
  photos.push({ key: photo.s3Key, bytes: bytes.length, blob: entry.original, isHDR: photo.isHDR, gainMapDecoded: !!parsed,
    icc: metadata.icc ? { bytes: metadata.icc.length, sha256: digest(metadata.icc), sRGBDescription: metadata.icc.includes(Buffer.from('sRGB IEC61966-2.1')) } : null,
    thumbnail: { sha256: digest(thumbnail), depth: thumbMetadata.depth, space: thumbMetadata.space, hasICC: !!thumbMetadata.icc } });
}
const summary = { manifestSha256: digest(manifestBytes), ref: state.ref, count: photos.length, bytes: photos.reduce((n, p) => n + p.bytes, 0),
  sourceHDRCount: photos.filter(p => p.isHDR).length, decodedGainMapCount: photos.filter(p => p.gainMapDecoded).length,
  profiles: Object.entries(Object.groupBy(photos, p => p.icc?.sha256 ?? 'none')).map(([sha256, items]) => ({ sha256, count: items!.length, sRGBDescription: items!.every(p => p.icc?.sRGBDescription) })) };
await fs.writeFile('.cache/phase5-source-audit.json', JSON.stringify({ summary, photos }, null, 2));
console.log(summary);
