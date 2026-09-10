import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileHashes, sha256 } from '../photos/artifact.js';
import { verifyCollection, exportCollection } from '../photos/collection.js';
import { loadSources, verifySnapshot, type PhotoSnapshot } from '../../src/photo-engine/sources.js';
import { processingFingerprint } from '../photos/fingerprint.js';
import { loadProjectCatalog } from '../../src/projects/loader.js';

export interface Release {
  schemaVersion: 2; websiteCommit: string; photoSnapshot: PhotoSnapshot; photoArtifactVersion: string;
  projectDigest: string; fingerprint: string; runId: string; runNumber: number;
  publishedProjects: number; publicPhotos: number; source: 'github' | 'fixture';
  files: Record<string, string>; version: string;
}
export async function buildRelease(options: { photos: string; root: string; destination: string; websiteCommit: string; runId: string; runNumber: number; production: boolean }) {
  const config = loadSources(path.join(options.root, 'config/photo-sources.json'));
  const photos = await verifyCollection(options.photos, { config, fingerprint: await processingFingerprint(), production: options.production });
  if (!/^[a-f0-9]{40}$/.test(options.websiteCommit)) throw new Error('Website commit must be pinned');
  if (options.production && path.resolve(options.root) !== process.cwd()) throw new Error('Production build must use repository root');
  const projectDir = path.join(options.root, 'src/content/projects');
  const projectFiles = await fileHashes(projectDir);
  if (options.production) {
    // Ensure temporary, untracked selections never become production content.
    const tracked = spawnSync('git', ['ls-files', '--error-unmatch', ...Object.keys(projectFiles).map(x => `src/content/projects/${x}`)], { encoding: 'utf8' });
    if (tracked.status !== 0) throw new Error('Untracked Project content');
    const dirty = spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' });
    if (dirty.status !== 0 || dirty.stdout.trim()) throw new Error('Production source checkout is dirty');
    const head = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
    if (head.stdout.trim() !== options.websiteCommit) throw new Error('Website checkout commit mismatch');
  }
  const catalog = loadProjectCatalog({ directory: projectDir, manifestFile: path.join(options.photos, 'photo-index.json') });
  const projects = catalog.published.listProjects();
  const ids = new Set(projects.flatMap(p => p.photos.map(x => x.photoId)));
  const projectDigest = sha256(JSON.stringify(projectFiles));
  await exportCollection(options.photos, options.root);
  // public/ is copied verbatim by Astro, including any files under _astro/.
  // Only verified engine thumbnails are allowed as public source input today.
  for (const [name, digest] of Object.entries(await fileHashes(path.join(options.root, 'public')))) {
    if (!name.startsWith('thumbnails/') || photos.files[`public/${name}`] !== digest) throw new Error(`Unexpected public file: ${name}`);
  }
  const staging = await fs.mkdtemp(path.join(await fs.mkdir(path.dirname(options.destination), { recursive: true }).then(() => path.dirname(options.destination)), 'release-'));
  const output = path.join(staging, 'dist');
  const build = spawnSync(process.execPath, [path.resolve('node_modules/astro/bin/astro.mjs'), 'build', '--root', path.resolve(options.root), '--outDir', output], { cwd: options.root, stdio: 'inherit', env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1' } });
  if (build.error || build.status !== 0) throw new Error('Astro production build failed');
  if (sha256(JSON.stringify(await fileHashes(projectDir))) !== projectDigest) throw new Error('Projects changed during build');
  await verifyCollection(options.photos, { config: loadSources(path.join(options.root, 'config/photo-sources.json')), snapshot: photos.snapshot });
  if (sha256(await fs.readFile(path.join(options.root, 'src/data/photo-index.json'))) !== photos.files['photo-index.json']) throw new Error('Manifest changed during build');
  for (const s of photos.snapshot.sources) {
    const name = `sources/${s.sourceId}/photos-manifest.json`;
    if (sha256(await fs.readFile(path.join(options.root, 'src/data', name))) !== photos.files[name]) throw new Error('Native source Manifest changed during build');
  }
  const files = await fileHashes(output);
  const expected = new Set(['index.html', '404.html', 'health.txt', ...projects.flatMap(p => [`projects/${p.slug}/index.html`, ...p.photos.map(x => `projects/${p.slug}/photos/${x.photoId}.json`)]), ...[...ids].map(id => `thumbnails/${id}.jpg`)]);
  for (const name of expected) if (!files[name]) throw new Error(`Missing published asset: ${name}`);
  for (const name of Object.keys(files)) if (!expected.has(name) && !name.startsWith('_astro/')) throw new Error(`Unexpected public file: ${name}`);
  for (const id of ids) if (files[`thumbnails/${id}.jpg`] !== photos.files[`public/thumbnails/${id}.jpg`]) throw new Error('Published thumbnail mismatch');
  const secrets = ['JASON_PHOTOS_READ_TOKEN', 'CLOUDFLARE_API_TOKEN', 'GITHUB_TOKEN'].map(k => process.env[k]).filter((x): x is string => Boolean(x));
  secrets.push(...Object.values(JSON.parse(process.env.JASON_PHOTOS_READ_TOKENS || '{}')) as string[]);
  for (const name of Object.keys(files)) {
    const bytes = await fs.readFile(path.join(output, name));
    if (secrets.some(secret => bytes.includes(secret))) throw new Error('Credential found in public artifact');
  }
  const record = { schemaVersion: 2 as const, websiteCommit: options.websiteCommit, photoSnapshot: photos.snapshot, photoArtifactVersion: photos.version, projectDigest, fingerprint: photos.fingerprint, runId: options.runId, runNumber: options.runNumber, publishedProjects: projects.length, publicPhotos: ids.size, source: photos.source, files };
  const release: Release = { ...record, version: sha256(JSON.stringify(record)) };
  await fs.writeFile(path.join(staging, 'release.json'), JSON.stringify(release, null, 2));
  // Public provenance contains no full index or Project drafts.
  await fs.writeFile(path.join(output, 'build-version.json'), JSON.stringify({ version: release.version, websiteCommit: release.websiteCommit, photoSnapshotVersion: release.photoSnapshot.version, runNumber: release.runNumber }));
  await fs.rm(options.destination, { recursive: true, force: true });
  await fs.rename(staging, options.destination);
  return release;
}
export async function verifyRelease(directory: string, production = true) {
  const release: Release = JSON.parse(await fs.readFile(path.join(directory, 'release.json'), 'utf8'));
  const { version, ...record } = release;
  if (release.schemaVersion !== 2 || sha256(JSON.stringify(record)) !== version || (production && release.source !== 'github')) throw new Error('Invalid release provenance');
  verifySnapshot(release.photoSnapshot);
  const files = await fileHashes(path.join(directory, 'dist')); delete files['build-version.json'];
  if (JSON.stringify(files) !== JSON.stringify(release.files)) throw new Error('Release file digest mismatch');
  const publicVersion = JSON.parse(await fs.readFile(path.join(directory, 'dist/build-version.json'), 'utf8'));
  if (publicVersion.version !== version || publicVersion.websiteCommit !== release.websiteCommit || publicVersion.photoSnapshotVersion !== release.photoSnapshot.version || publicVersion.runNumber !== release.runNumber) throw new Error('Public release version mismatch');
  return release;
}
