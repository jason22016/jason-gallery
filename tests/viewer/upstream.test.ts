import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm, cp } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { checkViewer, type SyncRecord } from '../../scripts/upstream/check-viewer';

test('upstream verifier detects edits, missing/extra core files and unexplained adaptations', async () => {
  const record: SyncRecord = JSON.parse(await readFile('licenses/viewer-upstream.json', 'utf8'));
  assert.deepEqual(await checkViewer(process.cwd(), record), []);
  const root = await mkdtemp(path.join(tmpdir(), 'viewer-upstream-'));
  try {
    await mkdir(path.join(root, 'packages/afilmory/webgl-viewer'), { recursive: true });
    await cp('packages/afilmory/webgl-viewer/src', path.join(root, 'packages/afilmory/webgl-viewer/src'), { recursive: true });
    const core = record.files.find(f => f.path.endsWith('/shaders.ts'))!;
    await writeFile(path.join(root, core.path), 'changed shader');
    assert((await checkViewer(root, record)).includes(`Local drift: ${core.path}`));
    const wrapper = record.files.find(f => f.adaptation)!;
    await writeFile(path.join(root, wrapper.path), 'changed wrapper');
    assert((await checkViewer(root, record)).includes(`Local drift: ${wrapper.path}`));
    await rm(path.join(root, core.path));
    await writeFile(path.join(root, 'packages/afilmory/webgl-viewer/src/extra.ts'), '// extra');
    const errors = await checkViewer(root, record);
    assert(errors.includes(`Missing viewer source: ${core.path}`));
    assert(errors.some(e => e.startsWith('Untracked viewer source:')));
    const unexplained = structuredClone(record);
    delete unexplained.files.find(f => f.adaptation)!.adaptation;
    assert((await checkViewer(process.cwd(), unexplained)).some(e => e.startsWith('Unexplained upstream difference:')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('bundle audit exception only accepts file-type dormant Node method, retaining other leak markers', async () => {
  const { browserBundleForAudit } = await import('./bundle-audit');
  const method = 'async fromFile(e){let f=await x(`node:fs/promises`);f.O_NONBLOCK;f.isFile();this.fromTokenizer(f)}';
  assert(!browserBundleForAudit(method).includes('node:fs'));
  assert(browserBundleForAudit(method + ';import("node:fs")').includes('node:fs'));
  assert(browserBundleForAudit(method.replace('this.fromTokenizer(f)', 'this.fromTokenizer(f);"@afilmory/builder"')).includes('@afilmory/builder'));
  assert.throws(() => browserBundleForAudit('async fromFile(e){x("node:fs/promises")}'), /Unexpected/);
});

test('all localized interaction files match their reviewed upstream/adaptation records', async () => {
  const { checkViewerInteractions } = await import('../../scripts/upstream/check-viewer-interactions');
  const result = await checkViewerInteractions();
  assert.deepEqual(result.errors, []);
  assert.equal(result.count, 23);
});

test('localized Phase 2 components and assets match the recorded source provenance', async () => {
  const { createHash } = await import('node:crypto');
  const record = JSON.parse(await readFile('licenses/viewer-visual-upstream.json', 'utf8')) as {
    files: { local: string; sha256: string; adapted: boolean; upstream: { sha256: string }[] }[];
    assets: { local: string; sha256: string }[];
  };
  for (const file of [...record.files, ...record.assets]) {
    assert.equal(createHash('sha256').update(await readFile(file.local)).digest('hex'), file.sha256, file.local);
  }
  for (const file of record.files.filter(file => !file.adapted)) assert.equal(file.sha256, file.upstream[0]!.sha256);
});
