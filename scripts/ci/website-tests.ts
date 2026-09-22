import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const websiteGroupNames = ['gallery', 'project', 'pages'] as const;
export type WebsiteGroup = typeof websiteGroupNames[number];

/** Keep the two longest files separate; automatically include new files in pages. */
export function groupWebsiteTests(files: readonly string[]): Record<WebsiteGroup, string[]> {
  if (new Set(files).size !== files.length) throw new Error('Duplicate Website test files');
  for (const required of ['gallery.test.ts', 'website.test.ts']) {
    if (!files.includes(required)) throw new Error(`Missing Website test file: ${required}`);
  }
  const groups: Record<WebsiteGroup, string[]> = { gallery: [], project: [], pages: [] };
  for (const file of [...files].sort()) {
    if (path.basename(file) !== file || !file.endsWith('.test.ts')) throw new Error(`Invalid Website test file: ${file}`);
    const group = file === 'gallery.test.ts' ? 'gallery' : file === 'website.test.ts' ? 'project' : 'pages';
    groups[group].push(file);
  }
  for (const name of websiteGroupNames) {
    if (!groups[name].length) throw new Error(`Empty Website test group: ${name}`);
  }
  return groups;
}

function main() {
  const [group, option, ...extra] = process.argv.slice(2);
  if (!websiteGroupNames.includes(group as WebsiteGroup) || (option !== undefined && option !== '--list') || extra.length) {
    throw new Error('Usage: pnpm test:website:group <gallery|project|pages> [--list]');
  }
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const directory = path.join(root, 'tests/website');
  const files = fs.readdirSync(directory).filter(file => file.endsWith('.test.ts'));
  const selected = groupWebsiteTests(files)[group as WebsiteGroup];
  if (option === '--list') {
    console.log(JSON.stringify({ group, files: selected }));
    return;
  }
  console.log(`Website ${group}: ${selected.length}/${files.length} test files`);
  const result = spawnSync(process.execPath, [
    '--import', 'tsx', '--test', '--test-concurrency=1',
    ...selected.map(file => path.join('tests/website', file)),
  ], { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  // A failed or interrupted test process must fail its matrix job and block release.
  process.exitCode = result.status ?? 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
