import type { ResolvedProject } from '../projects';

export const SITE_NAME = 'Jason Gallery';
export const SITE_DESCRIPTION = 'Jason 的摄影作品集，按项目记录旅途、城市与日常中的光影。';
export const DEFAULT_SHARE_IMAGE = '/social/default.jpg';
export const NOINDEX = 'noindex, nofollow';

export function textSummary(value: string): string {
  const text = value.replace(/\s+/gu, ' ').trim();
  const chars = Array.from(text);
  return chars.length > 160 ? `${chars.slice(0, 159).join('').trimEnd()}…` : text;
}

export function projectDescription(project: Pick<ResolvedProject, 'summary' | 'description' | 'title'>): string {
  return textSummary(project.summary?.trim() || project.description?.trim() || `浏览 Jason 的摄影项目「${project.title}」。`);
}

/** Photo/filter query parameters are state within the same static Gallery page. */
export function canonicalURL(pathname: string, site: URL | undefined): string | undefined {
  if (!site) return undefined;
  const path = new URL(pathname, site).pathname.replace(/\/index\.html$/, '/').replace(/\/+$/, '');
  return new URL(`${path || ''}/`, site).href;
}

export function projectShareImage(project?: ResolvedProject) {
  // Same published JPEG as the cover, not an original/HDR or admin asset.
  return {
    path: project?.cover.thumbnailUrl || DEFAULT_SHARE_IMAGE,
    alt: project?.photos.find(photo => photo.photoId === project.coverPhotoId)?.alt?.trim() || project?.title || `${SITE_NAME} — Photography`,
  };
}

export function sitemapXML(site: URL | undefined, slugs: readonly string[]): string {
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  const urls = site ? ['/', '/explore/', ...slugs.map(slug => `/projects/${slug}/`)] : [];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(path => `  <url><loc>${escape(canonicalURL(path, site)!)}</loc></url>`).join('\n')}\n</urlset>\n`;
}

export function robotsTXT(site: URL | undefined): string {
  return site
    ? `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\n\nSitemap: ${new URL('/sitemap.xml', site).href}\n`
    : 'User-agent: *\nDisallow: /\n';
}

export function indexingHeaders(site: URL | undefined): string {
  const paths = site ? ['/404', '/404.html', '/admin', '/admin/*', '/api/*', '/projects/:slug/photos/*', '/health.txt', '/build-version.json'] : ['/*'];
  return paths.map(path => `${path}\n  X-Robots-Tag: ${NOINDEX}\n`).join('\n');
}
