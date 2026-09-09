import * as fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { installReadOnlyFetch, type RequestAudit } from './network.js';
const args = process.argv.slice(2);
const value = (key: string) => args.includes(key) ? args[args.indexOf(key) + 1] : undefined;
if (args.includes('--export') && value('--keys')) throw new Error('Cannot export a filtered manifest');
const root = path.resolve(value('--root') ?? '.cache/photo-engine');
const workdir = await fs.mkdtemp(path.join(await fs.mkdir(root, { recursive: true }).then(() => root), 'run-'));
process.env.JASON_GALLERY_PHOTO_WORKDIR = workdir;
const requests: RequestAudit[] = [];
// Explicit opt-in: credential stays in process memory, never in files or logs.
if (args.includes('--git-credential') && !process.env.JASON_PHOTOS_READ_TOKEN) {
  const fields = execFileSync('git', ['credential', 'fill'], { input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  const password = fields.split('\n').find(line => line.startsWith('password='))?.slice('password='.length);
  if (!password) throw new Error('GitHub credential unavailable; set JASON_PHOTOS_READ_TOKEN');
  process.env.JASON_PHOTOS_READ_TOKEN = password;
}
try {
  if (value('--fixture')) {
    const { installFixture } = await import('./fixture-network.js');
    await installFixture(value('--fixture')!);
  }
  installReadOnlyFetch(requests);
  const { api, jsonGet, buildPhotos } = await import('./engine.js');
  const ref = value('--ref') ?? (await jsonGet(`${api}/commits/main`)).sha;
  const result = await buildPhotos({ root, ref, keyRegex: value('--keys') });
  // Publish local build artifacts only after all manifest/thumbnail checks pass.
  const output = path.join(root, 'output');
  await fs.mkdir(output, { recursive: true });
  await fs.cp(path.join(workdir, 'public'), path.join(output, 'public'), { recursive: true });
  await fs.copyFile(result.manifestFile, path.join(output, 'photos-manifest.json'));
  await fs.copyFile(path.join(workdir, 'result.json'), path.join(output, 'result.json'));
  if (args.includes('--export')) {
    await fs.mkdir('src/data', { recursive: true });
    await fs.mkdir('public/thumbnails', { recursive: true });
    await fs.cp(path.join(workdir, 'public/thumbnails'), 'public/thumbnails', { recursive: true });
    await fs.copyFile(result.manifestFile, 'src/data/photos-manifest.json');
  }
  console.log(JSON.stringify({ status: 'ok', workdir, ref, photos: result.manifest.data.length, decisions: result.decisions }));
} finally {
  await fs.writeFile(path.join(workdir, 'requests.json'), JSON.stringify(requests, null, 2));
}
