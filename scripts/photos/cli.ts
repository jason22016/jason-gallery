import * as fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { installReadOnlyFetch, type RequestAudit } from './network.js';
import { LEGACY_SOURCE, SourceSchema, sourceAPI } from '../../src/photo-engine/sources.js';
const args = process.argv.slice(2);
const value = (key: string) => args.includes(key) ? args[args.indexOf(key) + 1] : undefined;
if (args.includes('--export') && value('--keys')) throw new Error('Cannot export a filtered manifest');
const root = path.resolve(value('--root') ?? '.cache/photo-engine');
const lock = path.join(root, 'build.lock');
await fs.mkdir(root, { recursive: true });
await fs.mkdir(lock).catch(() => { throw new Error('Photo build already running (or stale build.lock; remove only after verifying no writer)'); });
const workdir = await fs.mkdtemp(path.join(await fs.mkdir(root, { recursive: true }).then(() => root), 'run-'));
process.env.JASON_GALLERY_PHOTO_WORKDIR = workdir;
const requests: RequestAudit[] = [];
try {
// Explicit opt-in: credential stays in process memory, never in files or logs.
if (args.includes('--git-credential') && !process.env.JASON_PHOTOS_READ_TOKEN) {
  const fields = execFileSync('git', ['credential', 'fill'], { input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  const password = fields.split('\n').find(line => line.startsWith('password='))?.slice('password='.length);
  if (!password) throw new Error('GitHub credential unavailable; set JASON_PHOTOS_READ_TOKEN');
  process.env.JASON_PHOTOS_READ_TOKEN = password;
}
  if (value('--fixture')) {
    const { installFixture } = await import('./fixture-network.js');
    await installFixture(value('--fixture')!);
  }
  installReadOnlyFetch(requests);
  const source = value('--source') ? SourceSchema.parse(JSON.parse(await fs.readFile(value('--source')!, 'utf8'))) : LEGACY_SOURCE;
  const { jsonGet, buildPhotos } = await import('./engine.js');
  const ref = value('--ref') ?? (await jsonGet(`${sourceAPI(source)}/commits/${encodeURIComponent(source.branch)}`)).sha;
  const result = await buildPhotos({ root, ref, keyRegex: value('--keys'), source });
  const { sealPhotos, verifyPhotos } = await import('./artifact.js');
  const artifactDir = path.join(workdir, 'artifact');
  await fs.mkdir(artifactDir);
  await fs.cp(path.join(workdir, 'public'), path.join(artifactDir, 'public'), { recursive: true });
  await fs.copyFile(result.manifestFile, path.join(artifactDir, 'photos-manifest.json'));
  for (const name of ['result.json', 'source-snapshot.json']) await fs.copyFile(path.join(workdir, name), path.join(artifactDir, name));
  await sealPhotos(artifactDir, value('--fixture') ? 'fixture' : 'github', process.env.GITHUB_SHA ?? null);
  if (!value('--keys')) await verifyPhotos(artifactDir);
  // Atomic pointer to a complete immutable generation. No stale deleted thumbnails.
  const output = path.join(root, 'output');
  const nextOutput = path.join(workdir, 'output-link');
  await fs.symlink(artifactDir, nextOutput, 'dir');
  const previous = await fs.lstat(output).catch(() => null);
  const legacy = previous && !previous.isSymbolicLink();
  if (legacy) await fs.rename(output, path.join(workdir, 'legacy-output'));
  try { await fs.rename(nextOutput, output); }
  catch (error) {
    if (legacy) await fs.rename(path.join(workdir, 'legacy-output'), output);
    throw error;
  }
  if (args.includes('--export')) {
    const exportLock = path.resolve('.cache/photo-export.lock');
    await fs.mkdir(exportLock).catch(() => { throw new Error('Photo export already running'); });
    try {
      await fs.mkdir('src/data', { recursive: true });
      await fs.rm('public/thumbnails', { recursive: true, force: true });
      await fs.cp(path.join(artifactDir, 'public/thumbnails'), 'public/thumbnails', { recursive: true });
      await fs.copyFile(result.manifestFile, 'src/data/photos-manifest.json');
    } finally { await fs.rm(exportLock, { recursive: true }); }
  }
  console.log(JSON.stringify({ status: 'ok', workdir, ref, photos: result.manifest.data.length, decisions: result.decisions }));
} finally {
  await fs.writeFile(path.join(workdir, 'requests.json'), JSON.stringify(requests, null, 2));
  await fs.rm(lock, { recursive: true, force: true });
}
