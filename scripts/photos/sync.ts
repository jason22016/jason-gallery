import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { loadSources, verifySnapshot, sourceIdentity, LEGACY_SOURCE } from '../../src/photo-engine/sources.js';
import { loadProjectCatalog } from '../../src/projects/loader.js';
import { processingFingerprint } from './fingerprint.js';
import { installReadOnlyFetch, type RequestAudit } from './network.js';
import { sourceStatuses, resolveSnapshot, parseCommits, sourceToken, safeReason } from './snapshot.js';
import { sealCollection, verifyCollection, exportCollection } from './collection.js';

const args = process.argv.slice(2);
const value = (key: string) => args.includes(key) ? args[args.indexOf(key) + 1] : undefined;
const allowed = new Set(['--root', '--config', '--snapshot', '--commits', '--fixture', '--projects', '--export', '--git-credential']);
for (let i=0; i<args.length; i++) {
  const key = args[i]!;
  if (!allowed.has(key)) throw new Error(`Unknown photos option: ${key}`);
  if (!['--export', '--git-credential'].includes(key) && (!args[++i] || args[i]!.startsWith('--'))) throw new Error(`Missing value for ${key}`);
}
const root = path.resolve(value('--root') ?? '.cache/photo-engine');
await fs.mkdir(root, { recursive: true });
const lock = path.join(root, 'sync.lock');
await fs.mkdir(lock).catch(() => { throw new Error('Photo sync already running; verify writer before clearing stale sync.lock'); });
const run = await fs.mkdtemp(path.join(root, 'sync-'));
const audit: RequestAudit[] = [];
const checkoutCommit = process.env.GITHUB_SHA ?? spawnSync('git', ['rev-parse','HEAD'], { encoding:'utf8' }).stdout?.trim();
const websiteCommit = /^[a-f0-9]{40}$/.test(checkoutCommit ?? '') ? checkoutCommit! : null;
const result: any = { schemaVersion: 2, invocationId: process.env.JASON_PHOTO_SYNC_ID ?? randomUUID(), websiteCommit, status: 'running', snapshot: null, sources: [], failureReason: null };
try {
  const config = loadSources(value('--config'));
  result.sources = sourceStatuses(config);
  if (args.includes('--git-credential') && !process.env.JASON_PHOTOS_READ_TOKEN) {
    const fields = execFileSync('git', ['credential', 'fill'], { input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8', stdio: ['pipe','pipe','ignore'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
    process.env.JASON_PHOTOS_READ_TOKEN = fields.split('\n').find(line => line.startsWith('password='))?.slice(9);
    if (!process.env.JASON_PHOTOS_READ_TOKEN) throw new Error('GitHub credential unavailable');
  }
  if (value('--fixture')) await (await import('./fixture-network.js')).installFixture(path.resolve(value('--fixture')!));
  installReadOnlyFetch(audit);
  if (value('--snapshot') && value('--commits')) throw new Error('Use either --snapshot or --commits');
  const selected = value('--snapshot')
    ? verifySnapshot(JSON.parse(await fs.readFile(value('--snapshot')!, 'utf8')), config)
    : null;
  const snapshot = await resolveSnapshot(config, selected ? Object.fromEntries(selected.sources.map(s => [s.sourceId,s.commit])) : parseCommits(value('--commits') ?? '', config), result.sources);
  result.snapshot = snapshot;
  // All source commits are fixed before importing/starting any Builder process.
  await fs.writeFile(path.join(run, 'snapshot.json'), JSON.stringify(snapshot, null, 2));
  const fingerprint = await processingFingerprint();
  const artifact = path.join(run, 'artifact');
  await fs.mkdir(path.join(artifact, 'sources'), { recursive: true });
  for (const source of snapshot.sources) {
    const status = result.sources.find((s: any) => s.sourceId === source.sourceId);
    status.commit = source.commit;
    try {
      const configSource = config.sources.find(s => s.sourceId === source.sourceId)!;
      const sourceFile = path.join(run, `${source.sourceId}.json`);
      await fs.writeFile(sourceFile, JSON.stringify(configSource));
      const workerRoot = path.join(root, 'sources', source.sourceId, sourceIdentity(source));
      if (source.sourceId === LEGACY_SOURCE.sourceId && sourceIdentity(source) === sourceIdentity(LEGACY_SOURCE)) {
        const oldBlobs = path.join(root, 'cache/blobs');
        const blobs = path.join(workerRoot, 'cache/blobs');
        if (!(await fs.stat(blobs).catch(() => null)) && await fs.stat(oldBlobs).catch(() => null)) await fs.cp(oldBlobs, blobs, { recursive:true });
      }
      const childArgs = ['--import','tsx',path.resolve('scripts/photos/cli.ts'),'--root',workerRoot,'--source',sourceFile,'--ref',source.commit];
      if (value('--fixture')) childArgs.push('--fixture', path.resolve(value('--fixture')!));
      const child = spawnSync(process.execPath, childArgs, { encoding: 'utf8', maxBuffer: 24 * 1024 * 1024, env: { ...process.env, JASON_PHOTOS_READ_TOKEN: sourceToken(source.sourceId) ?? '', JASON_PHOTOS_READ_TOKENS: '' } });
      await fs.writeFile(path.join(run, `${source.sourceId}.log`), safeReason(child.stdout + child.stderr));
      if (child.error || child.status !== 0) throw new Error(`Photo processing failed for ${source.sourceId}; see source log (${child.status ?? 'spawn error'})`);
      const nativeRoot = path.join(workerRoot, 'output');
      const native = await (await import('./artifact.js')).verifyPhotos(nativeRoot, { ref: source.commit, fingerprint });
      await fs.cp(await fs.realpath(nativeRoot), path.join(artifact, 'sources', source.sourceId), { recursive: true });
      Object.assign(status, { status: 'success', total: native.photos, processed: native.processed, reused: native.reused });
    } catch (error) { status.status = 'failure'; status.failureReason = safeReason(error); }
  }
  if (result.sources.some((s: any) => s.status === 'failure')) throw new Error('At least one enabled source failed; retaining preceding complete index');
  await sealCollection(artifact, snapshot, fingerprint, value('--fixture') ? 'fixture' : 'github', result.sources, websiteCommit);
  const verified = await verifyCollection(artifact, { config, snapshot, fingerprint });
  // Sync also validates draft references when a source/photo is removed or disabled.
  loadProjectCatalog({ directory: value('--projects') ?? 'src/content/projects', manifestFile: path.join(artifact, 'photo-index.json') });
  const output = path.join(root, 'output');
  const link = path.join(run, 'output-link');
  await fs.symlink(artifact, link, 'dir');
  const previous = await fs.lstat(output).catch(() => null);
  if (previous && !previous.isSymbolicLink()) throw new Error('Existing output must be an atomic symlink');
  await fs.rename(link, output);
  if (args.includes('--export')) await exportCollection(artifact, process.cwd());
  Object.assign(result, { status: 'success', total: verified.photos, processed: verified.processed, reused: verified.reused, artifactVersion: verified.version });
} catch (error) {
  result.status = 'failure'; result.failureReason = safeReason(error); process.exitCode = 1;
} finally {
  await fs.writeFile(path.join(run, 'requests.json'), JSON.stringify(audit, null, 2));
  await fs.writeFile(path.join(run, 'result.json'), JSON.stringify(result, null, 2));
  await fs.writeFile(path.join(root, 'last-sync-result.json'), JSON.stringify(result, null, 2));
  await fs.rm(lock, { recursive: true, force: true });
  console.log(JSON.stringify({ ...result, workdir: run }));
}
