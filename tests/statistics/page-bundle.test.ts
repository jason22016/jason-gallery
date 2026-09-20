import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'vite';

test('Stats island ships aggregates UI and the scope parser without the photo collection, statistics engine or heavy Gallery modules', async t => {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: true,
      lib: { entry: fileURLToPath(new URL('../../src/components/stats/StatsPage.tsx', import.meta.url)), formats: ['es'] },
    },
  });
  assert(Array.isArray(result));
  const chunks = result.flatMap(result => result.output).filter(output => output.type === 'chunk');
  const modules = [...new Set(chunks.flatMap(chunk => chunk.moduleIds))];
  assert(modules.some(id => id.endsWith('/src/components/stats/StatsPage.tsx')));
  assert(modules.some(id => id.endsWith('/src/components/stats/StatsVisualizations.tsx')));
  assert.deepEqual(modules.filter(id => id.includes('/src/statistics/')).map(id => id.split('/src/statistics/')[1]), ['scope.ts'],
    'Project query validation is the only statistics runtime required by the browser');

  for (const id of modules) {
    assert(!/\/src\/(?:website|projects|photo-engine|data)\//.test(id), `Server/private module in Stats island: ${id}`);
    assert(!/\/src\/components\/gallery\/(?:PhotoGallery|photos|FilterPanel|MapPanel|DetailsPanel|Virtual)/.test(id), `Gallery runtime in Stats island: ${id}`);
    assert(!/maplibre|webgl-viewer|webgpu|photos-manifest|photo-details/i.test(id), `Heavy photo module in Stats island: ${id}`);
    if (id.includes('/src/components/viewer/')) {
      assert(/\/(?:ActionButton|CaptureIcons)\.tsx$/.test(id), `Viewer runtime in Stats island: ${id}`);
    }
    if (id.includes('/src/components/gallery/map/') && !id.endsWith('.css')) {
      assert(id.endsWith('/MapBackButton.tsx'), `Map runtime in Stats island: ${id}`);
    }
  }
  t.diagnostic(`Isolated Stats island including shared React/Panel/motion: ${chunks.reduce((bytes, chunk) => bytes + Buffer.byteLength(chunk.code), 0)} bytes, ${chunks.reduce((bytes, chunk) => bytes + gzipSync(chunk.code).length, 0)} gzip bytes.`);
});
