/** Export only the site's existing public projection; never scan a manifest for membership. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { loadPublicPhotoCollection } from '../../src/website/public-photos.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
process.chdir(root);
const cache = path.join(root, '.cache/semantic-spike');
fs.mkdirSync(cache, { recursive: true });
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

function readPhotos() {
  if (!fs.existsSync('src/data/photo-index.json')) throw new Error('Missing photo index');
  const photos = [...loadPublicPhotoCollection().listPhotos()].sort((a, b) => a.id.localeCompare(b.id, 'en'));
  if (!photos.length) throw new Error('Empty public photo collection');
  for (const photo of photos) {
    if (!/^\/thumbnails\/[^/]+\.jpg$/.test(photo.thumbnail)) throw new Error(`Unexpected thumbnail: ${photo.thumbnail}`);
    if (!fs.existsSync(path.join(root, 'public', photo.thumbnail))) throw new Error(`Missing thumbnail: ${photo.id}`);
    if (!/^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[a-f0-9]{40}\//.test(photo.src)) {
      throw new Error(`Expected real, commit-pinned remote photo: ${photo.id}`);
    }
  }
  return photos;
}

let photos;
try { photos = readPhotos(); }
catch (error) {
  console.log(`Local real collection unavailable: ${String(error)}. Running existing photos export.`);
  execFileSync('pnpm', ['photos', '--export', '--root', path.join(cache, 'photo-engine')], { stdio: 'inherit' });
  photos = readPhotos();
}
const records = await Promise.all(photos.map(async (p, ordinal) => {
  const thumbnail = path.join('public', p.thumbnail);
  const bytes = fs.readFileSync(thumbnail);
  const meta = await sharp(bytes).metadata();
  return { ordinal, id: p.id, publicId: p.publicId, filename: p.filename, thumbnail,
    thumbnailSha256: digest(bytes), thumbnailBytes: bytes.length,
    thumbnailWidth: meta.width, thumbnailHeight: meta.height,
    originalUrl: p.src, width: p.width, height: p.height,
    projects: p.projects.map(project => ({ slug: project.slug, title: project.title })) };
}));
const snapshot = JSON.parse(fs.readFileSync('src/data/photo-index.json', 'utf8')).snapshot;
const corpus = { schemaVersion: 1, source: 'loadPublicPhotoCollection', snapshot,
  fingerprint: digest(JSON.stringify(records)), photos: records };
fs.writeFileSync(path.join(cache, 'corpus.json'), JSON.stringify(corpus, null, 2));

// Contact sheets are review aids only; model input always uses the untouched thumbnails.
for (let start = 0; start < records.length; start += 40) {
  const subset = records.slice(start, start + 40);
  const tiles = await Promise.all(subset.map(async (p, index) => ({
    input: await sharp(p.thumbnail).resize(210, 145, { fit: 'contain', background: '#111' })
      .extend({ bottom: 25, background: '#fff' }).composite([{ input: Buffer.from(
        `<svg width="210" height="25"><text x="6" y="18" font-size="14">${p.ordinal} · ${p.publicId}</text></svg>`), top: 145, left: 0 }]).jpeg().toBuffer(),
    left: (index % 5) * 210, top: Math.floor(index / 5) * 170,
  })));
  await sharp({ create: { width: 1050, height: Math.ceil(subset.length / 5) * 170, channels: 3, background: '#eee' } })
    .composite(tiles).jpeg({ quality: 88 }).toFile(path.join(cache, `contact-${start}.jpg`));
}
console.log(JSON.stringify({ photos: records.length, fingerprint: corpus.fingerprint, output: cache }));
