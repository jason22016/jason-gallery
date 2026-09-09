import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fixture, project } from './fixtures';

test('actual Astro build validates Projects without a Project page and rejects invalid drafts', { timeout: 90_000 }, t => {
  const f = fixture(t);
  const repo = fileURLToPath(new URL('../../', import.meta.url));
  const config = new URL('../../astro.config.mjs', import.meta.url).href;
  // Use production integrations, isolated content/output, and the pinned installed CLI.
  fs.writeFileSync(path.join(f.root, 'astro.config.mjs'), `export { default } from ${JSON.stringify(config)};\n`);
  fs.mkdirSync(path.join(f.root, 'src/pages'));
  fs.copyFileSync(path.join(repo, 'src/pages/health.txt.ts'), path.join(f.root, 'src/pages/health.txt.ts'));
  f.write(project());
  f.write(project({ id: 'secret', slug: 'secret', title: 'DRAFT MUST STAY PRIVATE', status: 'draft' }));
  const build = () => {
    const result = spawnSync(process.execPath, [path.join(repo, 'node_modules/astro/bin/astro.mjs'), 'build', '--root', f.root], {
      cwd: repo, encoding: 'utf8', timeout: 25_000, env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1' },
    });
    assert.ifError(result.error);
    return { status: result.status, output: result.stdout + result.stderr };
  };
  const valid = build();
  assert.equal(valid.status, 0, valid.output);
  assert.match(valid.output, /Validated Projects: 1 published, 1 draft/);
  assert.equal(fs.readFileSync(path.join(f.root, 'dist/health.txt'), 'utf8'), 'jason-gallery bootstrap ok\n');
  for (const file of fs.readdirSync(path.join(f.root, 'dist'), { recursive: true, withFileTypes: true })) {
    if (file.isFile()) assert(!fs.readFileSync(path.join(file.parentPath, file.name), 'utf8').includes('DRAFT MUST STAY PRIVATE'));
  }

  f.write(project({ id: 'secret', slug: 'secret', status: 'draft', photos: [{ photoId: 'absent' }], coverPhotoId: 'absent' }));
  const dangling = build();
  assert.notEqual(dangling.status, 0);
  assert.match(dangling.output, /secret.json.*photos\.0\.photoId: unknown photo ID "absent"/);

  fs.writeFileSync(path.join(f.directory, 'secret.json'), JSON.stringify({ ...project({ id: 'secret', slug: 'secret', status: 'draft' }), order: '1' }));
  const invalidSchema = build();
  assert.notEqual(invalidSchema.status, 0);
  assert.match(invalidSchema.output, /Invalid Project .*secret.json/);
  assert.match(invalidSchema.output, /order/);
});
