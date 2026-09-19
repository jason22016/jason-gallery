import path from 'node:path';
import type { PhotoManifestItem } from '../photo-engine';
import type { ResolvedProject } from '../projects';
import { resolvePublicPhotoCollection } from './public-photos';

export function localAssetPath(url: string | null | undefined): string | null {
  if (!url?.startsWith('/') || url.startsWith('//')) return null;
  const decoded = decodeURIComponent(url.split(/[?#]/)[0]!);
  if (decoded.includes('\\') || decoded.split('/').includes('..')) throw new Error('Photo asset escapes build output');
  return path.posix.normalize(decoded).slice(1);
}

export function photoAssetPaths(photo: Pick<PhotoManifestItem, 'thumbnailUrl' | 'originalUrl' | 'ogImageUrl' | 'video'>): string[] {
  return [photo.thumbnailUrl, photo.originalUrl, photo.ogImageUrl, photo.video?.type === 'live-photo' ? photo.video.videoUrl : null]
    .map(localAssetPath).filter((file): file is string => file !== null);
}

export function publicOutputPaths(projects: readonly ResolvedProject[]): Set<string> {
  return new Set([
    'index.html', 'explore/index.html', 'map/index.html', '404.html', 'health.txt', 'favicon.svg', 'sitemap.xml', 'robots.txt', '_headers', 'social/default.jpg',
    ...resolvePublicPhotoCollection({ listProjects: () => projects }).listPhotos().map(photo => `${photo.sharePath.slice(1)}index.html`),
    ...projects.filter(project => project.status === 'published').flatMap(project => [
      `projects/${project.slug}/index.html`,
      ...project.photos.flatMap(({ photoId, photo }) => [`projects/${project.slug}/photos/${photoId}.json`, ...photoAssetPaths(photo)]),
    ]),
  ]);
}

export function assertPublicOutput(files: Iterable<string>, expected: ReadonlySet<string>, requireAll = false) {
  const actual = new Set(files);
  if (requireAll) for (const name of expected) if (!actual.has(name)) throw new Error(`Missing published asset: ${name}`);
  for (const name of actual) {
    if (!expected.has(name) && !/^_astro\/[\w.-]+\.(?:js|css|woff2?|txt|wasm)$/.test(name)) throw new Error(`Unexpected public file: ${name}`);
  }
}
