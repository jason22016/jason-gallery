import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { buildPhotographyStats } from '../../src/statistics';
import { publicFixture } from './fixtures';

test('browser entry bundles and runs without filesystem, Project resolver, Manifest or server dependencies', async () => {
  const result = await build({
    configFile: false, logLevel: 'silent',
    build: { write: false, minify: false, lib: { entry: fileURLToPath(new URL('../../src/statistics/index.ts', import.meta.url)), formats: ['es'] } },
  });
  assert(Array.isArray(result));
  const outputs = result.flatMap(result => result.output);
  const chunks = outputs.filter(output => output.type === 'chunk');
  assert.equal(chunks.length, 1);
  const chunk = chunks[0]!;
  assert.deepEqual(chunk.imports, []);
  assert.deepEqual(chunk.dynamicImports, []);
  for (const id of Object.keys(chunk.modules)) {
    assert(id.includes('/src/statistics/') || id.endsWith('/src/components/viewer/metadata.ts'), `Unexpected browser runtime dependency: ${id}`);
  }
  const bundled = await import(`data:text/javascript;base64,${Buffer.from(chunk.code).toString('base64')}`);
  const photos = publicFixture().collection.listPhotos();
  assert.deepEqual(bundled.buildPhotographyStats(photos), buildPhotographyStats(photos));
  assert.equal(bundled.resolvePhotographyStats(photos, bundled.readPhotographyStatsScope(new URLSearchParams('project=private-draft'))), undefined);
});
