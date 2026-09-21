import type { AstroIntegration } from 'astro';
import { fileURLToPath } from 'node:url';
import { installClientSemanticRelease } from '../../scripts/semantic/client-release';

/** Installs the immutable, precompressed client model after Astro finishes its ordinary asset graph. */
export function clientSemanticAssets(): AstroIntegration {
  return {
    name: 'jason-gallery-client-semantic-assets',
    hooks: {
      'astro:build:done': async ({ dir }) => {
        await installClientSemanticRelease(fileURLToPath(dir));
      },
    },
  };
}
