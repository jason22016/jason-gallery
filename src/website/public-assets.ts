import type { AstroIntegration } from 'astro';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPhotoIndex, photoIndexFile, type PhotoManifestItem } from '../photo-engine';
import { loadProjects } from '../projects';

/** Astro copies public/ verbatim. Limit photo assets in the output, never edit engine inputs. */
export function publishedPhotoAssets(): AstroIntegration {
  let srcDir: URL;
  return {
    name: 'jason-gallery-published-photo-assets',
    hooks: {
      'astro:config:done': ({ config }) => { srcDir = config.srcDir; },
      'astro:build:done': async ({ dir }) => {
        const output = fileURLToPath(dir);
        const options = { directory: new URL('content/projects/', srcDir), manifestFile: photoIndexFile(new URL('data/', srcDir)) };
        const localFile = (url: string | null | undefined) => {
          if (!url?.startsWith('/') || url.startsWith('//')) return null;
          const file = path.resolve(output, `.${decodeURIComponent(url.split(/[?#]/)[0]!)}`);
          if (!file.startsWith(`${path.resolve(output)}${path.sep}`)) throw new Error('Photo asset escapes build output');
          return file;
        };
        const urls = (photo: Pick<PhotoManifestItem, 'thumbnailUrl' | 'originalUrl' | 'ogImageUrl'>) => [photo.thumbnailUrl, photo.originalUrl, photo.ogImageUrl];
        const published = new Set(loadProjects(options).listProjects().flatMap(project => project.photos.flatMap(({ photo }) => urls(photo).map(localFile).filter(file => file !== null))));
        const candidates = new Set(loadPhotoIndex(options.manifestFile).listPhotos().flatMap(photo => urls(photo).map(localFile).filter(file => file !== null)));
        // Include stale engine thumbnails no longer present in the current manifest.
        const thumbnails = path.join(output, 'thumbnails');
        const files = await fs.readdir(thumbnails, { recursive: true, withFileTypes: true }).catch(error => {
          if (error.code !== 'ENOENT') throw error;
          return [];
        });
        for (const file of files) if (file.isFile()) candidates.add(path.join(file.parentPath, file.name));
        for (const file of candidates) if (!published.has(file)) await fs.rm(file, { force: true });
      },
    },
  };
}
