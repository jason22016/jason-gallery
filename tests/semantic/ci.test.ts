import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('GitHub automation uses the shared CPU command between photo sync and the normal build', async () => {
  const workflow = await fs.readFile('.github/workflows/automation.yml', 'utf8');
  const photos = workflow.indexOf('run: pnpm automation photos');
  const semantic = workflow.indexOf('run: pnpm automation semantic');
  const build = workflow.indexOf('run: pnpm automation build');
  assert(photos >= 0 && semantic > photos && build > semantic, 'photo sync → semantic index → build order');
  assert.match(workflow, /Install pinned CPU semantic runtime/);
  assert.match(workflow, /SEMANTIC_DEVICE: cpu/);
  assert.match(workflow, /\.cache\/semantic\/embeddings/);
  assert.match(workflow, /\.cache\/semantic\/huggingface\/hub/);
  assert.match(workflow, /semantic-embeddings-v1-[^\n]+preprocess1-schema1/);
  assert(!workflow.includes('semantic-spike/'), 'production automation must not depend on spike code');

  const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));
  assert.equal(pkg.scripts['semantic:build'], 'node --import tsx scripts/semantic/cli.ts build');
  assert.match(pkg.scripts.build, /^pnpm semantic:build && astro build$/);
});
