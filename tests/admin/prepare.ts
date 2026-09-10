import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { photoReference, parseSources } from '../../src/photo-engine/sources';
import { loadPhotoIndex } from '../../src/photo-engine';
import { ProjectSchema } from '../../src/projects/schema';
import type { PreviewData } from './model';

export const fixtureRoot = path.resolve('.cache/admin-fixture');
export async function preparePreview(localPhotos = false) {
  await fs.rm(fixtureRoot, { recursive: true, force: true });
  await fs.mkdir(path.join(fixtureRoot, 'thumbnails'), { recursive: true });
  const sources = parseSources({ schemaVersion: 1, sources: [
    { sourceId: 'fixture-travel', name: '旅行手记', owner: 'fixture', repo: 'travel-photos', branch: 'main', path: 'images', enabled: true },
    { sourceId: 'fixture-everyday', name: '日常观察', owner: 'fixture', repo: 'everyday-photos', branch: 'main', path: 'photographs', enabled: true },
    { sourceId: 'fixture-archive', name: '旧时光', owner: 'fixture', repo: 'archive-photos', branch: 'main', path: '', enabled: false },
  ] }).sources;
  const local = localPhotos ? loadPhotoIndex().listPhotos() : [];
  if (localPhotos && local.length < 18) throw new Error('Local thumbnail preview needs at least 18 verified photos');
  const photos: PreviewData['photos'] = [];
  for (let i = 0; i < 18; i++) {
    const source = sources.find(s => s.sourceId === (i < 10 ? 'fixture-travel' : 'fixture-everyday'))!;
    const id = photoReference(source, `fixture-${i % 10}`);
    const name = `${String(i + 1).padStart(2, '0')}.jpg`;
    let width = 900, height = [600, 1100, 700, 650, 850, 600][i % 6]!;
    if (localPhotos) {
      const photo = local[(i * 7 + 3) % local.length]!;
      width = photo.width; height = photo.height;
      await fs.copyFile(path.resolve('public', `.${photo.thumbnailUrl}`), path.join(fixtureRoot, 'thumbnails', name));
    } else {
      // Deterministic original vector artwork, rasterized only for isolated UI tests.
      const palette = ['#55695d', '#807060', '#4d656d', '#5c6270', '#9c8362', '#68735a'];
      const sky = palette[i % palette.length];
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${sky}"/><circle cx="660" cy="180" r="70" fill="#e5dac4"/><path d="M0 ${height * .7} L260 ${height * .38} L500 ${height * .7} L740 ${height * .43} L900 ${height * .6} V${height} H0Z" fill="#293c3c"/><path d="M0 ${height * .85} Q300 ${height * .62} 900 ${height * .84} V${height} H0Z" fill="#172d2c"/></svg>`;
      await sharp(Buffer.from(svg)).jpeg().toFile(path.join(fixtureRoot, 'thumbnails', name));
    }
    photos.push({ sourceId: source.sourceId, photo: { id, title: `FRAME_${String(i + 1).padStart(3, '0')}.jpg`, thumbnailUrl: `/thumbnails/${name}`, width, height } });
  }
  const project = ProjectSchema.parse({ schemaVersion: 1, id: 'fixture-project', slug: 'between-places', title: '在路上，慢一点', summary: '一些途中的光线，和不经意留下的片刻。', location: '沿途', description: '', coverPhotoId: photos[0]!.photo.id, photos: [photos[0], photos[10], photos[3], photos[12]].map(p => ({ photoId: p!.photo.id })), tags: ['旅行', '片刻'], order: 0, status: 'draft' });
  const data: PreviewData = { sources, photos, projects: [project], imageMode: localPhotos ? '缩略图来自已有本地产物；来源分组与 Project 为虚构 fixture' : '全部照片为程序生成的隔离测试图' };
  await fs.writeFile(path.join(fixtureRoot, 'fixture.json'), JSON.stringify(data));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await preparePreview(process.argv.includes('--local-photos'));
