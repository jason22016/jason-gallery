import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { groupWebsiteTests, websiteGroupNames } from '../../scripts/ci/website-tests';

const files = fs.readdirSync('tests/website').filter(file => file.endsWith('.test.ts')).sort();

test('Website groups cover the full serial suite exactly once, including future test files', () => {
  const allFiles = [...files, 'new-feature.test.ts'];
  const groups = groupWebsiteTests(allFiles);
  assert.deepEqual(groups.gallery, ['gallery.test.ts']);
  assert.deepEqual(groups.project, ['website.test.ts']);
  assert(groups.pages.includes('new-feature.test.ts'));
  assert.deepEqual(websiteGroupNames.flatMap(name => groups[name]).sort(), allFiles.sort());
  assert.deepEqual(groupWebsiteTests([...files].reverse()), groupWebsiteTests(files));
});

test('Website grouping fails closed for duplicate, missing, invalid or empty input', () => {
  assert.throws(() => groupWebsiteTests([...files, files[0]!]), /Duplicate/);
  for (const required of ['gallery.test.ts', 'website.test.ts']) {
    assert.throws(() => groupWebsiteTests(files.filter(file => file !== required)), /Missing/);
  }
  assert.throws(() => groupWebsiteTests([...files, '../outside.test.ts']), /Invalid/);
  assert.throws(() => groupWebsiteTests([...files, 'fixture.ts']), /Invalid/);
  assert.throws(() => groupWebsiteTests(['gallery.test.ts', 'website.test.ts']), /Empty/);
});

test('Website group CLI lists the complete partition and rejects invalid invocations', () => {
  const run = (...args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', 'scripts/ci/website-tests.ts', ...args], { encoding: 'utf8' });
  const selected: string[] = [];
  for (const group of websiteGroupNames) {
    const result = run(group, '--list');
    assert.equal(result.status, 0, result.stderr);
    const listed = JSON.parse(result.stdout);
    assert.equal(listed.group, group);
    selected.push(...listed.files);
  }
  assert.deepEqual(selected.sort(), files);
  for (const args of [[], ['typo'], ['pages', '--unknown'], ['pages', '--list', 'extra']]) {
    const result = run(...args);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Usage:/);
  }
});

test('Website group CLI runs only its selected files and propagates a failing test', t => {
  fs.mkdirSync('.cache', { recursive: true });
  const root = fs.mkdtempSync(path.resolve('.cache/website-group-cli-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'scripts/ci'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tests/website'), { recursive: true });
  fs.copyFileSync('scripts/ci/website-tests.ts', path.join(root, 'scripts/ci/website-tests.ts'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ type: 'module' }));
  for (const [file, name, body] of [
    ['gallery.test.ts', 'gallery sentinel', ''],
    ['website.test.ts', 'project sentinel', ''],
    ['failure.test.ts', 'pages failure sentinel', 'throw new Error("expected fixture failure")'],
  ]) {
    fs.writeFileSync(path.join(root, 'tests/website', file!), `import { test } from 'node:test';\ntest(${JSON.stringify(name)}, () => { ${body} });\n`);
  }
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT; // This fixture intentionally starts a separate test runner.
  const run = (group: string) => spawnSync(process.execPath, ['--import', 'tsx', 'scripts/ci/website-tests.ts', group], { cwd: root, encoding: 'utf8', env });
  const failed = run('pages');
  assert.equal(failed.status, 1, failed.stderr);
  assert.match(failed.stdout, /pages failure sentinel/);
  assert.doesNotMatch(failed.stdout, /gallery sentinel|project sentinel/);
  const passed = run('gallery');
  assert.equal(passed.status, 0, passed.stderr);
  assert.match(passed.stdout, /gallery sentinel/);
  assert.doesNotMatch(passed.stdout, /pages failure sentinel|project sentinel/);
});
