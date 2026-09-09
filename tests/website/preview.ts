import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repo, run } from './fixture';
import { serve } from './server';
import type { AfilmoryManifest } from '../../src/photo-engine';
import type { Project } from '../../src/projects';

/** Reuses existing local assets; demonstration projects are confined to this preview root. */
export const previewRoot = path.join(repo, '.cache/ui-preview');
export async function buildPreview() {
  const manifest: AfilmoryManifest = JSON.parse(await fs.readFile(path.join(repo, 'src/data/photos-manifest.json'), 'utf8'));
  if (manifest.data.length === 0) throw new Error('The preview needs existing Photo Engine output.');
  await fs.mkdir(previewRoot, { recursive: true });
  await fs.rm(path.join(previewRoot, 'src'), { recursive: true, force: true });
  await fs.cp(path.join(repo, 'src'), path.join(previewRoot, 'src'), {
    recursive: true, filter: source => !['data', 'content'].includes(path.relative(path.join(repo, 'src'), source).split(path.sep)[0]!),
  });
  await fs.writeFile(path.join(previewRoot, 'astro.config.mjs'), `export { default } from ${JSON.stringify(new URL('../../astro.config.mjs', import.meta.url).href)};\n`);
  await fs.writeFile(path.join(previewRoot, 'tsconfig.json'), JSON.stringify({ extends: path.join(repo, 'tsconfig.json') }));
  await fs.copyFile(path.join(repo, 'package.json'), path.join(previewRoot, 'package.json'));
  await fs.cp(path.join(repo, 'public/thumbnails'), path.join(previewRoot, 'public/thumbnails'), { recursive: true });
  const content = path.join(previewRoot, 'src/content/projects');
  await fs.mkdir(content, { recursive: true });
  await fs.mkdir(path.join(previewRoot, 'src/data'), { recursive: true });
  await fs.writeFile(path.join(previewRoot, 'src/data/photos-manifest.json'), JSON.stringify(manifest));
  const names = ['光影之间', '沿途所见', '日常片刻', '远方来信'];
  for (let i = 0; i < 4; i++) {
    const selection = manifest.data.slice(i * 24, (i + 1) * 24);
    if (!selection.length) continue;
    const cover = selection.find(p => p.height > p.width) ?? selection[0]!;
    const date = cover.dateTaken?.slice(0, 10);
    const project: Project = {
      schemaVersion: 1, id: `preview-${i + 1}`, slug: `preview-${i + 1}`, title: names[i]!,
      summary: 'Jason Gallery · 界面预览选集', description: '这是用于检查新版界面的临时选集，照片来自已有图库。此分组只存在于独立预览目录，不会写入正式项目。',
      coverPhotoId: cover.id, photos: selection.map(photo => ({ photoId: photo.id, alt: photo.title || photo.id })),
      ...(date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? { period: { start: date } } : {}), order: i, status: 'published',
    };
    await fs.writeFile(path.join(content, `${project.slug}.json`), JSON.stringify(project));
  }
  await fs.writeFile(path.join(previewRoot, 'build.log'), run([path.join(repo, 'node_modules/astro/bin/astro.mjs'), 'build'], previewRoot));
  return path.join(previewRoot, 'dist');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = await buildPreview();
  if (process.argv.includes('--serve')) console.log(`UI preview: ${(await serve(directory, 4324)).url}`);
  else console.log(`Built UI preview: ${directory}`);
}
