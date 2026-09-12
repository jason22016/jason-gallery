import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

export interface SyncRecord {
  commit: string;
  repository: string;
  files: { path: string; upstream: string; upstreamSha256: string; sha256: string; adaptation?: string }[];
  references: { path: string; sha256: string }[];
}
const digest = (bytes: Buffer | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const sourceRoot = 'packages/afilmory/webgl-viewer/src';
export async function checkViewer(root: string, record: SyncRecord, upstreamDir?: string): Promise<string[]> {
  const errors: string[] = [];
  const actual = (await readdir(path.join(root, sourceRoot), { recursive: true, withFileTypes: true }))
    .filter(entry => entry.isFile()).map(entry => path.relative(root, path.join(entry.parentPath, entry.name)));
  const expected = record.files.map(file => file.path);
  for (const name of actual) if (!expected.includes(name)) errors.push(`Untracked viewer source: ${name}`);
  for (const file of record.files) {
    const bytes = await readFile(path.join(root, file.path)).catch(() => null);
    if (!bytes) errors.push(`Missing viewer source: ${file.path}`);
    else if (digest(bytes) !== file.sha256) errors.push(`Local drift: ${file.path}`);
    if (!file.adaptation && file.sha256 !== file.upstreamSha256) errors.push(`Unexplained upstream difference: ${file.path}`);
  }
  if (upstreamDir) {
    const commit = execFileSync('git', ['-C', upstreamDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    if (commit !== record.commit) errors.push(`Upstream checkout is ${commit}; expected ${record.commit}`);
    for (const file of [...record.files.map(f => ({ path: f.upstream, sha256: f.upstreamSha256 })), ...record.references]) {
      const bytes = await readFile(path.join(upstreamDir, file.path)).catch(() => null);
      if (!bytes || digest(bytes) !== file.sha256) errors.push(`Upstream baseline mismatch: ${file.path}`);
    }
    const directory = path.join(upstreamDir, 'packages/webgl-viewer/src');
    const files = await readdir(directory, { recursive: true, withFileTypes: true });
    for (const file of files.filter(f => f.isFile() && !/\.(test|spec)\./.test(f.name))) {
      const name = path.relative(upstreamDir, path.join(file.parentPath, file.name));
      if (!record.files.some(f => f.upstream === name)) errors.push(`Untracked upstream source: ${name}`);
    }
  }
  return errors;
}
async function main() {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const record: SyncRecord = JSON.parse(await readFile(path.join(root, 'licenses/viewer-upstream.json'), 'utf8'));
  const args = process.argv.slice(2);
  const dirIndex = args.indexOf('--upstream-dir');
  if (dirIndex >= 0 && !args[dirIndex + 1]) throw new Error('--upstream-dir requires a checkout path');
  const errors = await checkViewer(root, record, dirIndex < 0 ? undefined : path.resolve(args[dirIndex + 1]!));
  if (args.includes('--remote')) {
    const response = await fetch('https://api.github.com/repos/Afilmory/Afilmory/commits/main', { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Upstream lookup failed: HTTP ${response.status}`);
    const latest = await response.json() as { sha: string };
    console.log(`Current upstream main: ${latest.sha}`);
    if (latest.sha !== record.commit) errors.push(`Upstream advanced from ${record.commit} to ${latest.sha}; review before updating the baseline`);
    // Verify the pinned baseline, not a moving branch. Never rewrite the record.
    for (const file of [...record.files.map(f => ({ path: f.upstream, sha256: f.upstreamSha256 })), ...record.references]) {
      const response = await fetch(`https://raw.githubusercontent.com/Afilmory/Afilmory/${record.commit}/${file.path}`, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok || digest(new Uint8Array(await response.arrayBuffer())) !== file.sha256) errors.push(`Remote baseline mismatch: ${file.path}`);
    }
  }
  console.log(`Pinned Afilmory: ${record.commit}; ${record.files.length} viewer source files`);
  for (const file of record.files.filter(f => f.adaptation)) console.log(`Reviewed adaptation: ${file.path}: ${file.adaptation}`);
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
  else console.log('PASS: viewer core matches pinned upstream; reviewed wrapper adaptations unchanged');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
