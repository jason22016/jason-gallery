import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { GitHubStorageProvider } from '@afilmory/builder/storage/providers/github-provider.js';
import { LEGACY_SOURCE, originalURL, parseSources, sourceIdentity } from '../../src/photo-engine/sources.js';
import { loadPhotoIndex } from '../../src/photo-engine/index.js';
import { jpeg } from '../../scripts/photos/fixtures.js';
import { verifyCollection } from '../../scripts/photos/collection.js';

const commit = 'a'.repeat(40);
const names = [
  ['ordinary.jpg', 'ordinary.jpg'],
  ['shoot#1.jpg', 'shoot%231.jpg'],
  ['shoot?1.jpg', 'shoot%3F1.jpg'],
  ['shoot%201.jpg', 'shoot%25201.jpg'],
  ['shoot 1.jpg', 'shoot%201.jpg'],
  ['shoot%2F1.jpg', 'shoot%252F1.jpg'],
  ['照片+一.jpg', '%E7%85%A7%E7%89%87%2B%E4%B8%80.jpg'],
  ['session #1/part?2/%20/shot [&].jpg', 'session%20%231/part%3F2/%2520/shot%20%5B%26%5D.jpg'],
] as const;

for (const [directory, encodedDirectory] of [['', ''], ['images', 'images'], ['相册/2026 summer', '%E7%9B%B8%E5%86%8C/2026%20summer']]) {
  test(`original URLs preserve literal filename characters under ${directory || 'the repository root'}`, () => {
    const source = { ...LEGACY_SOURCE, path: directory };
    const config = { provider: 'github' as const, owner: source.owner, repo: source.repo, branch: commit, path: directory };
    const raw = new GitHubStorageProvider(config);
    const blob = new GitHubStorageProvider({ ...config, useRawUrl: false });
    const cdn = new GitHubStorageProvider({ ...config, customDomain: 'https://photos.example.com/' });
    for (const [key, encodedKey] of names) {
      const encodedPath = [encodedDirectory, encodedKey].filter(Boolean).join('/');
      const expected = `https://raw.githubusercontent.com/${source.owner}/${source.repo}/${commit}/${encodedPath}`;
      assert.equal(originalURL(source, commit, key), expected);
      assert.equal(raw.generatePublicUrl(key), expected);
      assert.equal(blob.generatePublicUrl(key), `https://github.com/${source.owner}/${source.repo}/blob/${commit}/${encodedPath}`);
      assert.equal(cdn.generatePublicUrl(key), `https://photos.example.com/${encodedPath}`);
      const url = new URL(expected);
      assert.equal(url.hash, '');
      assert.equal(url.search, '');
      assert.equal(decodeURIComponent(url.pathname), '/' + [source.owner, source.repo, commit, directory, key].filter(Boolean).join('/'));
    }
  });
}

test('special filenames survive complete cold and cached multi-source syncs with exact download paths', { timeout: 120000 }, async () => {
  const root = path.resolve('.cache/source-url-test');
  await fs.rm(root, { recursive: true, force: true });
  await fs.mkdir(path.join(root, 'projects'), { recursive: true });
  const config = parseSources({ schemaVersion: 1, sources: [LEGACY_SOURCE, { ...LEGACY_SOURCE, sourceId: 'second', owner: 'fixture', repo: 'second', path: '相册/2026 summer' }] });
  const expected = new Map<string, { url: string; width: number }>();
  const repositories = [];
  for (const source of config.sources) {
    const files: Record<string, { file: string; commit: string }> = {};
    const entries = source.sourceId === LEGACY_SOURCE.sourceId ? names : [names[0]];
    for (const [i, [key, encodedKey]] of entries.entries()) {
      const file = `${source.sourceId}-${i}.jpg`, width = 80 + i;
      await fs.writeFile(path.join(root, file), await jpeg('#2266aa', width, 60));
      files[`${source.path}/${key}`] = { file, commit };
      const directory = source.sourceId === LEGACY_SOURCE.sourceId ? 'images' : '%E7%9B%B8%E5%86%8C/2026%20summer';
      expected.set(`${source.sourceId}/${key}`, { url: `https://raw.githubusercontent.com/${source.owner}/${source.repo}/${commit}/${directory}/${encodedKey}`, width });
    }
    repositories.push({ owner: source.owner, repo: source.repo, branch: source.branch, ref: commit, files });
  }
  await fs.writeFile(path.join(root, 'config.json'), JSON.stringify(config));
  await fs.writeFile(path.join(root, 'fixture.json'), JSON.stringify({ repositories }));
  const engine = path.join(root, 'engine'), output = path.join(engine, 'output');
  const read = async (file: string) => JSON.parse(await fs.readFile(file, 'utf8'));
  let previousIds: string[] | undefined;
  for (const phase of ['cold', 'cached']) {
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/photos/sync.ts', '--root', engine, '--config', path.join(root, 'config.json'), '--fixture', path.join(root, 'fixture.json'), '--projects', path.join(root, 'projects')], { encoding: 'utf8', timeout: 50000 });
    await fs.writeFile(path.join(root, `${phase}.log`), result.stdout + result.stderr);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const report = await read(path.join(engine, 'last-sync-result.json'));
    assert.equal(report.status, 'success');
    assert.equal(report.total, expected.size);
    assert.equal(report.processed, phase === 'cold' ? expected.size : 0);
    assert.equal(report.reused, phase === 'cached' ? expected.size : 0);
    await verifyCollection(output, { config });
    const photos = loadPhotoIndex(path.join(output, 'photo-index.json')).listPhotos();
    assert.deepEqual(photos.map(photo => photo.originalUrl).sort(), [...expected.values()].map(photo => photo.url).sort());
    const ids = photos.map(photo => photo.id).sort();
    if (previousIds) assert.deepEqual(ids, previousIds);
    previousIds = ids;

    const syncResult = JSON.parse(result.stdout.trim().split('\n').at(-1)!);
    const visibilityRequests = await read(path.join(syncResult.workdir, 'requests.json'));
    assert.deepEqual(visibilityRequests.filter((r: any) => new URL(r.url).hostname === 'raw.githubusercontent.com').map((r: any) => r.url).sort(), [...expected.values()].map(photo => photo.url).sort());
    for (const source of config.sources) {
      const manifest = await read(path.join(output, 'sources', source.sourceId, 'photos-manifest.json'));
      for (const photo of manifest.data) {
        const original = expected.get(`${source.sourceId}/${photo.s3Key}`)!;
        assert(original, photo.s3Key);
        assert.equal(photo.originalUrl, original.url);
        assert.equal(photo.width, original.width, 'Literal %20 and spaces must resolve to different originals');
      }
      const native = await fs.realpath(path.join(engine, 'sources', source.sourceId, sourceIdentity(source), 'output'));
      const requests = await read(path.join(native, '..', 'requests.json'));
      const contents = requests.filter((r: any) => new URL(r.url).pathname.includes('/contents/'));
      assert(contents.length > 0);
      for (const request of contents) {
        const url = new URL(request.url);
        assert.equal(url.hash, '');
        assert.deepEqual([...url.searchParams], [['ref', commit]]);
      }
      if (phase === 'cold') for (const photo of manifest.data) {
        assert(contents.some((r: any) => decodeURIComponent(new URL(r.url).pathname) === `/repos/${source.owner}/${source.repo}/contents/${source.path}/${photo.s3Key}`), photo.s3Key);
      }
    }
  }
});
