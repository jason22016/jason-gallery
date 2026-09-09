import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import type { AfilmoryManifest } from '../../src/photo-engine';
import type { Project } from '../../src/projects';
import { gainmapJPEG, jpeg } from '../../scripts/photos/fixtures';

export const repo = fileURLToPath(new URL('../../', import.meta.url));
export const root = path.join(repo, '.cache/website-fixture');
export const dist = path.join(root, 'dist');

export function run(args: string[], cwd: string) {
  const result = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', timeout: 90_000, env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1' } });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout + result.stderr;
}

/** Dedicated root: never swap out production content or its generated assets. */
export async function buildFixture() {
  await fs.rm(root, { force: true, recursive: true });
  await fs.mkdir(root, { recursive: true });
  await fs.cp(path.join(repo, 'src'), path.join(root, 'src'), {
    recursive: true, filter: source => !['data', 'content'].includes(path.relative(path.join(repo, 'src'), source).split(path.sep)[0]!),
  });
  const config = new URL('../../astro.config.mjs', import.meta.url).href;
  await fs.writeFile(path.join(root, 'astro.config.mjs'), `export { default } from ${JSON.stringify(config)};\n`);
  await fs.writeFile(path.join(root, 'tsconfig.json'), JSON.stringify({ extends: path.join(repo, 'tsconfig.json') }));
  // Astro discovers renderer bundling rules from the root dependency declarations.
  await fs.copyFile(path.join(repo, 'package.json'), path.join(root, 'package.json'));
  const originals = { 'ordinary.jpg': await jpeg('#597c8b', 960, 640), 'portrait.jpg': await jpeg('#9d7155', 640, 960), 'hdr.jpg': await gainmapJPEG(), 'private.jpg': await jpeg('#6b7756') };
  const files: Record<string, { file: string; commit: string }> = {};
  const commit = '3'.repeat(40);
  await fs.mkdir(path.join(root, 'sources'));
  for (const [key, bytes] of Object.entries(originals)) {
    await fs.writeFile(path.join(root, 'sources', key), bytes);
    files[`images/${key}`] = { file: `sources/${key}`, commit };
  }
  const fixtureFile = path.join(root, 'source-fixture.json');
  await fs.writeFile(fixtureFile, JSON.stringify({ ref: commit, files }));
  // Generate native IDs, HDR metadata, and thumbnails through the unchanged Phase 1 CLI.
  const engine = path.join(root, 'engine');
  const engineLog = run(['--import', 'tsx', 'scripts/photos/cli.ts', '--fixture', fixtureFile, '--root', engine], repo);
  await fs.writeFile(path.join(root, 'engine.log'), engineLog);
  const manifest: AfilmoryManifest = JSON.parse(await fs.readFile(path.join(engine, 'output/photos-manifest.json'), 'utf8'));
  // Rebase URLs only in this test manifest to the isolated local static fixture server.
  for (const photo of manifest.data) {
    photo.originalUrl = `/originals/${photo.s3Key}`;
    if (photo.s3Key === 'portrait.jpg') { photo.title = '街角 Portrait'; photo.dateTaken = '2024-03-02T12:00:00+08:00'; photo.tags = ['城市']; photo.location = { latitude: 22.3, longitude: 114.17, city: '测试位置' }; photo.exif = { ...photo.exif, Make: 'NIKON', Model: 'Z6', LensModel: '35mm', FNumber: 2.8, ISO: 100, Artist: 'Fixture artist' } as typeof photo.exif; }
    if (photo.s3Key === 'hdr.jpg') { photo.title = '天光 HDR'; photo.dateTaken = '2024-03-01T12:00:00+08:00'; photo.tags = ['天空']; }
    if (photo.s3Key === 'ordinary.jpg') { photo.title = '远山 Landscape'; photo.dateTaken = '2024-02-29T12:00:00+08:00'; photo.tags = ['风景']; }
  }
  await fs.mkdir(path.join(root, 'src/data'), { recursive: true });
  await fs.writeFile(path.join(root, 'src/data/photos-manifest.json'), JSON.stringify(manifest));
  await fs.cp(path.join(engine, 'output/public'), path.join(root, 'public'), { recursive: true });
  await fs.cp(path.join(root, 'sources'), path.join(root, 'public/originals'), { recursive: true });
  const id = (key: string) => manifest.data.find(photo => photo.s3Key === key)!.id;
  const photos = [
    { photoId: id('portrait.jpg'), alt: 'Fixture portrait', caption: 'First in the editorial sequence' },
    { photoId: id('hdr.jpg'), alt: 'Fixture HDR image', caption: 'Second in the editorial sequence' },
    { photoId: id('ordinary.jpg'), alt: 'Fixture landscape', caption: '<script>fixture caption is plain text</script>' },
  ];
  const base: Project = {
    schemaVersion: 1, id: 'fixture-beta', slug: 'fixture-beta', title: 'Fixture — ordered gallery',
    summary: 'Test content only. Portrait, HDR and landscape.', location: 'Fixture location',
    description: 'A fixture description.\n<script>window.fixtureInjection = true</script>',
    coverPhotoId: id('ordinary.jpg'), photos, tags: ['fixture', 'test-only'],
    period: { start: '2024-02-29', end: '2024-03-01' }, order: -2, status: 'published',
  };
  const projects: Project[] = [
    { ...base, id: 'fixture-zeta', slug: 'fixture-zeta', title: 'Fixture — single image', order: 4, photos: [photos[0]!], coverPhotoId: photos[0]!.photoId },
    { ...base, id: 'fixture-alpha', slug: 'fixture-alpha', title: 'Fixture — shared photographs', order: 4 },
    base,
    { ...base, id: 'secret-draft', slug: 'secret-draft', title: 'DRAFT WEBSITE SECRET', summary: 'PRIVATE PROJECT SUMMARY', order: -100, status: 'draft', coverPhotoId: id('private.jpg'), photos: [{ photoId: id('private.jpg'), caption: 'PRIVATE PROJECT CAPTION' }] },
  ];
  const content = path.join(root, 'src/content/projects');
  await fs.mkdir(content, { recursive: true });
  for (const project of projects) await fs.writeFile(path.join(content, `${project.slug}.json`), JSON.stringify(project));
  await fs.writeFile(path.join(root, 'build.log'), run([path.join(repo, 'node_modules/astro/bin/astro.mjs'), 'build'], root));
  return { manifest, projects, photos };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildFixture();
  console.log(`Built isolated Website fixture: ${dist}`);
}
