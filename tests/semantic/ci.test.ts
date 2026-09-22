import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('GitHub automation uses the shared CPU command between photo sync and the normal build', async () => {
  const workflow = await fs.readFile('.github/workflows/automation.yml', 'utf8');
  const photos = workflow.indexOf('run: pnpm automation photos');
  const embeddingRestore = workflow.indexOf('name: Restore content-addressed image embeddings');
  const plan = workflow.indexOf('run: pnpm automation semantic-plan');
  const setupPython = workflow.indexOf('uses: actions/setup-python');
  const runtime = workflow.indexOf('name: Install pinned CPU semantic runtime');
  const modelRestore = workflow.indexOf('name: Restore pinned SigLIP2 checkpoint');
  const semantic = workflow.indexOf('run: pnpm automation semantic\n');
  const build = workflow.indexOf('run: pnpm automation build');
  assert(embeddingRestore >= 0 && embeddingRestore < photos, 'embedding cache must be restored before photo export');
  assert(photos >= 0 && plan > photos && setupPython > plan && runtime > setupPython && modelRestore > runtime && semantic > modelRestore && build > semantic,
    'photo sync → cache inspection → conditional encoder setup → semantic index → build order');
  assert.equal(workflow.match(/if: steps\.semantic_plan\.outputs\.needs_encoder == 'true'/g)?.length, 3,
    'Python, pip and model restore must only run on cache misses');
  assert.match(workflow, /if: steps\.semantic_plan\.outcome == 'success'/);
  assert.match(workflow, /steps\.semantic_plan\.outputs\.needs_encoder == 'true' && steps\.semantic-model\.outputs\.cache-hit != 'true'/);
  assert.match(workflow, /Install pinned CPU semantic runtime/);
  assert.match(workflow, /SEMANTIC_DEVICE: cpu/);
  assert.match(workflow, /\.cache\/semantic\/embeddings/);
  assert.match(workflow, /\.cache\/semantic\/huggingface\/hub/);
  assert.match(workflow, /semantic-embeddings-v1-[^\n]+preprocess1-schema1/);
  assert(!workflow.includes('semantic-spike/'), 'production automation must not depend on spike code');

  const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));
  assert.equal(pkg.scripts['semantic:build'], 'node --import tsx scripts/semantic/cli.ts build');
  assert.equal(pkg.scripts['semantic:plan'], 'node --import tsx scripts/semantic/cli.ts plan');
  assert.match(pkg.scripts.build, /^pnpm semantic:build && astro build$/);

  const regression = await fs.readFile('.github/workflows/regression.yml', 'utf8');
  assert.match(regression, /if: matrix\.browser && matrix\.script != 'test:semantic-browser'\n\s+run: pnpm exec playwright install --with-deps chromium/,
    'ordinary browser jobs should install only Chromium');
  assert.match(regression, /if: matrix\.script == 'test:semantic-browser'\n\s+run: pnpm exec playwright install --with-deps chromium firefox webkit chrome/,
    'semantic compatibility checks must install every browser they launch');
});
