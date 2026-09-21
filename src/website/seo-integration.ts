import type { AstroIntegration } from 'astro';
import { writeFile } from 'node:fs/promises';
import { resolveSiteURL } from './site-url';
import { indexingHeaders } from './seo';
import { clientSemanticReleaseHeaders } from '../../scripts/semantic/client-release';

export function publicSEO(): AstroIntegration {
  let site: URL | undefined;
  return {
    name: 'jason-gallery-seo',
    hooks: {
      'astro:config:done': ({ config }) => {
        const origin = resolveSiteURL(config.site);
        site = origin ? new URL(origin) : undefined;
      },
      'astro:build:start': ({ logger }) => {
        if (!site) logger.warn('SITE_URL is empty: building a noindex preview without canonical URLs or sitemap entries.');
      },
      'astro:build:done': async ({ dir }) => {
        await writeFile(new URL('_headers', dir), `${indexingHeaders(site)}\n${clientSemanticReleaseHeaders()}`);
      },
    },
  };
}
