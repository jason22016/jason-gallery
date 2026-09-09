import type { AstroIntegration } from 'astro';
import { loadProjectCatalog } from './loader';

/** Independent of page usage so invalid/draft content cannot bypass build validation. */
export function projectValidation(): AstroIntegration {
  let srcDir: URL;
  return {
    name: 'jason-gallery-projects',
    hooks: {
      'astro:config:done': ({ config }) => { srcDir = config.srcDir; },
      'astro:build:start': ({ logger }) => {
        const catalog = loadProjectCatalog({
          directory: new URL('content/projects/', srcDir),
          manifestFile: new URL('data/photos-manifest.json', srcDir),
        });
        logger.info(`Validated Projects: ${catalog.published.listProjects().length} published, ${catalog.drafts.listProjects().length} draft`);
      },
    },
  };
}
