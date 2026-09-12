import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
export async function checkViewerInteractions(upstreamDir?: string) {
  const record = JSON.parse(await readFile(path.join(root, 'licenses/viewer-interaction-upstream.json'), 'utf8')) as {
    commit: string; files: { local: string; upstream: string; sha256: string; upstreamSha256: string; adapted: boolean }[];
  };
  const errors: string[] = [];
  for (const file of record.files) {
    if (digest(await readFile(path.join(root, file.local))) !== file.sha256) errors.push(`Local drift: ${file.local}`);
    if (!file.adapted && file.sha256 !== file.upstreamSha256) errors.push(`Unexplained difference: ${file.local}`);
    if (upstreamDir && digest(await readFile(path.join(upstreamDir, file.upstream))) !== file.upstreamSha256) errors.push(`Upstream mismatch: ${file.upstream}`);
  }
  const motionRoot = 'packages/afilmory/viewer-motion/src';
  for (const file of await readdir(path.join(root, motionRoot))) {
    if (!record.files.some(entry => entry.local === `${motionRoot}/${file}`)) errors.push(`Unrecorded motion source: ${file}`);
  }
  return { commit: record.commit, count: record.files.length, errors };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const index = process.argv.indexOf('--upstream-dir');
  const result = await checkViewerInteractions(index < 0 ? undefined : process.argv[index + 1]);
  if (result.errors.length) { console.error(result.errors.join('\n')); process.exitCode = 1; }
  else console.log(`PASS: ${result.count} Viewer interaction sources; pinned Afilmory ${result.commit}`);
}
