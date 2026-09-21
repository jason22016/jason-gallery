import type { AstroIntegration } from 'astro';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPhotoIndex, photoIndexFile } from '../photo-engine';
import { loadProjects } from '../projects';
import { assertPublicOutput, photoAssetPaths, publicOutputPaths } from './public-output';

/** Astro copies public/ verbatim. Limit photo assets in the output, never edit engine inputs. */
export function publishedPhotoAssets(): AstroIntegration {
  let srcDir: URL;
  let publicDir: URL;
  const options = () => ({ directory: new URL('content/projects/', srcDir), manifestFile: photoIndexFile(new URL('data/', srcDir)) });
  const filesIn = async (directory: string) => {
    const entries = await fs.readdir(directory, { recursive: true, withFileTypes: true }).catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return [];
    });
    return entries.filter(entry => !entry.isDirectory()).map(entry => path.relative(directory, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'));
  };
  return {
    name: 'jason-gallery-published-photo-assets',
    hooks: {
      'astro:config:done': ({ config }) => { srcDir = config.srcDir; publicDir = config.publicDir; },
      'astro:build:start': async () => {
        const candidates = new Set(loadPhotoIndex(options().manifestFile).listPhotos().flatMap(photoAssetPaths));
        for (const name of await filesIn(fileURLToPath(publicDir))) {
          const semantic = name === 'semantic/index.json' || name === 'semantic/vectors.f32';
          if (name !== 'favicon.svg' && !name.startsWith('thumbnails/') && !candidates.has(name) && !semantic) throw new Error(`Unexpected public file: ${name}`);
          if (name.startsWith('_astro/')) throw new Error(`Unexpected public file: ${name}`);
        }
      },
      'astro:build:done': async ({ dir }) => {
        const output = fileURLToPath(dir);
        const projects = loadProjects(options()).listProjects();
        const published = new Set(projects.flatMap(project => project.photos.flatMap(({ photo }) => photoAssetPaths(photo))));
        const candidates = new Set(loadPhotoIndex(options().manifestFile).listPhotos().flatMap(photoAssetPaths));
        // Include stale engine thumbnails no longer present in the current manifest.
        for (const file of await filesIn(path.join(output, 'thumbnails'))) candidates.add(`thumbnails/${file}`);
        for (const file of candidates) if (!published.has(file)) await fs.rm(path.join(output, file), { force: true });
        assertPublicOutput(await filesIn(output), publicOutputPaths(projects));
      },
    },
  };
}
