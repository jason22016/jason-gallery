import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { gainmapJPEG, jpeg } from './fixtures.js';
import { extractJPEGGainMap } from '../../packages/afilmory/webgl-viewer/src/jpeg-gainmap.js';

const root = path.resolve('.cache/smoke');
await fs.rm(root, { recursive: true, force: true });
await fs.mkdir(root, { recursive: true });
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const nativeId = (key: string) => `${path.parse(key).name}_${sha(key).slice(0, 8)}`;
const ref1 = '1'.repeat(40), ref2 = '2'.repeat(40);
const originals: Record<string, Buffer> = {
  'ordinary.jpg': await jpeg(), 'existing.jpg': await jpeg('#aabbcc'),
  'missing.jpg': await jpeg('#aa3344'), 'broken.jpg': await jpeg('#338844'),
  'a/duplicate.jpg': await jpeg('#556677'), 'b/duplicate.jpg': await jpeg('#778899'),
  'hdr.jpg': await gainmapJPEG(),
};
const thumbs = { '.afilmory/thumbnails/existing.jpg': await jpeg('#aabbcc', 32), '.afilmory/thumbnails/broken.jpg': Buffer.from('not a JPEG') };
const fixture: { ref: string; files: Record<string, { file: string; commit: string }> } = { ref: ref1, files: {} };
for (const [key, bytes] of Object.entries({ ...originals, ...thumbs, '.gitkeep': Buffer.alloc(0) })) {
  const file = `sources/${key}`;
  await fs.mkdir(path.join(root, path.dirname(file)), { recursive: true });
  await fs.writeFile(path.join(root, file), bytes);
  fixture.files[`images/${key}`] = { file, commit: ref1 };
}
const fixtureFile = path.join(root, 'fixture.json');
const engineRoot = path.join(root, 'engine');
const inputHashes = async () => Object.fromEntries(await Promise.all(Object.entries(fixture.files).map(async ([key, entry]) => [key, sha(await fs.readFile(path.join(root, entry.file)))])));
const buffer = originals['hdr.jpg']!;
const parsed = extractJPEGGainMap(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer);
assert(parsed && parsed.metadata.capacityMax === 2 && parsed.gain.size > 0, 'Fixture must contain an actual decodable gain image');
const baseInfo = await sharp(Buffer.from(await parsed.base.arrayBuffer())).metadata();
const gainInfo = await sharp(Buffer.from(await parsed.gain.arrayBuffer())).metadata();
assert.equal(baseInfo.width! / baseInfo.height!, gainInfo.width! / gainInfo.height!, 'Gain map aspect ratio matches primary');
await fs.writeFile(path.join(root, 'hdr.jpg'), buffer);
await fs.writeFile(path.join(root, 'ordinary.jpg'), originals['ordinary.jpg']!);
async function run(label: string, target = engineRoot, failure = false) {
  await fs.writeFile(fixtureFile, JSON.stringify(fixture));
  const before = await inputHashes();
  const code = await new Promise<number | null>((resolve, reject) => {
    const log = requireLog(path.join(root, `${label}.log`));
    const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/photos/cli.ts', '--fixture', fixtureFile, '--root', target], { stdio: ['ignore', log, log], timeout: 120_000 });
    child.on('error', reject); child.on('exit', resolve);
  });
  assert.equal(code === 0, !failure, `${label}: inspect .cache/smoke/${label}.log`);
  assert.deepEqual(await inputHashes(), before, 'Builder changed source repository bytes');
  const runs = (await fs.readdir(target)).filter(x => x.startsWith('run-'));
  for (const name of runs) {
    const requests = JSON.parse(await fs.readFile(path.join(target, name, 'requests.json'), 'utf8'));
    assert(requests.length > 0 && requests.every((r: any) => r.method === 'GET'), 'Non-read request');
  }
  if (failure) return;
  const manifest = JSON.parse(await fs.readFile(path.join(target, 'output/photos-manifest.json'), 'utf8'));
  const result = JSON.parse(await fs.readFile(path.join(target, 'output/result.json'), 'utf8'));
  assert.deepEqual(Object.keys(manifest).sort(), ['cameras', 'data', 'lenses', 'version']);
  assert.equal(manifest.version, 'v10');
  assert.equal(manifest.data.length, 7);
  assert.equal(new Set(manifest.data.map((p: any) => p.id)).size, 7);
  for (const item of manifest.data) {
    assert.equal(item.id, nativeId(item.s3Key));
    assert.equal(item.originalUrl.includes(fixture.ref), true);
    assert(item.thumbHash && item.width > 0 && item.height > 0);
    assert(!item.s3Key.includes('.afilmory'));
  }
  return { manifest, result };
}
// File descriptors are closed on child exit by the parent below.
import { openSync, closeSync } from 'node:fs';
const descriptors: number[] = [];
function requireLog(file: string) { const fd = openSync(file, 'w'); descriptors.push(fd); return fd; }
try {
  const first = (await run('first'))!;
  assert.equal(first.result.decisions['existing.jpg'], 'remote');
  assert.match(first.result.decisions['missing.jpg'], /^generated/);
  assert.match(first.result.decisions['broken.jpg'], /^generated/);
  assert.equal(first.manifest.data.find((p: any) => p.s3Key === 'hdr.jpg').isHDR, true);
  assert.equal(first.manifest.data.find((p: any) => p.s3Key === 'ordinary.jpg').isHDR, false);
  const thumbnail = path.join(engineRoot, 'output/public/thumbnails', `${nativeId('existing.jpg')}.jpg`);
  assert.equal(sha(await fs.readFile(thumbnail)), sha(thumbs['.afilmory/thumbnails/existing.jpg']));
  const before = sha(await fs.readFile(thumbnail));
  const warm = (await run('warm'))!;
  assert(Object.values(warm.result.decisions).every(x => x === 'local'));
  await fs.writeFile(path.join(engineRoot, 'cache/thumbnails', `${nativeId('missing.jpg')}.jpg`), 'corrupt');
  const repair = (await run('local-corrupt'))!;
  assert.match(repair.result.decisions['missing.jpg'], /^generated/);
  fixture.ref = ref2;
  fixture.files['images/existing.jpg']!.commit = ref2;
  await fs.writeFile(path.join(root, 'sources/existing.jpg'), await jpeg('#ee1122', 128));
  const changed = (await run('changed'))!;
  assert.match(changed.result.decisions['existing.jpg'], /^generated/);
  assert.notEqual(sha(await fs.readFile(thumbnail)), before);
  assert.equal(changed.manifest.data.find((p: any) => p.s3Key === 'existing.jpg').width, 128);
  // A completely deleted cache must not resurrect the old remote thumbnail.
  const cold = (await run('cold-after-update', path.join(root, 'cold-engine')))!;
  assert.match(cold.result.decisions['existing.jpg'], /^generated/);
  // Genuine 32-bit SHA prefix collision for the same basename: fail before processing.
  const seen = new Map<string, string>(); let collision: [string, string] | undefined;
  for (let i = 0; !collision && i < 1_000_000; i++) {
    const key = `collision/${i}/same.jpg`, digest = sha(key).slice(0, 8);
    const previous = seen.get(digest);
    if (previous) collision = [previous, key]; else seen.set(digest, key);
  }
  assert(collision, 'Find deterministic digest collision');
  for (const key of collision) fixture.files[`images/${key}`] = { file: 'sources/ordinary.jpg', commit: ref2 };
  const published = sha(await fs.readFile(path.join(engineRoot, 'output/photos-manifest.json')));
  await run('duplicate-id', engineRoot, true);
  assert.equal(sha(await fs.readFile(path.join(engineRoot, 'output/photos-manifest.json'))), published);
  for (const key of collision) delete fixture.files[`images/${key}`];
  // Corrupt original: no partial manifest may replace the previous success.
  await fs.writeFile(path.join(root, 'sources/ordinary.jpg'), 'broken original');
  await run('invalid-original', engineRoot, true);
  assert.equal(sha(await fs.readFile(path.join(engineRoot, 'output/photos-manifest.json'))), published);
  const report = { status: 'PASS', cases: ['ordinary JPEG', 'existing thumbnail byte reuse', 'missing thumbnail', 'corrupt remote/local thumbnail', 'duplicate basename', 'actual 8-digit ID collision rejection', 'warm cache', 'original update + metadata invalidation', 'cold cache stale remote rejection', 'gain-map JPEG + native isHDR', 'commit URL refresh', 'read-only requests + source hashes', 'failed build preserves prior manifest'], collision };
  await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { for (const fd of descriptors) closeSync(fd); }
