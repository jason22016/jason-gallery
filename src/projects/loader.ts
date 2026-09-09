// Node/build-only: no Builder imports and no writes or generated Project data.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPhotoIndex } from '../photo-engine/index';
import { resolveProjects, type ProjectCatalog, type ProjectIndex, type ProjectSource } from './resolver';

export interface ProjectLoadOptions {
  directory?: string | URL;
  manifestFile?: string | URL;
}

/** Explicit tooling entry: validate published AND draft content against the same Photo Index. */
export function loadProjectCatalog(options: ProjectLoadOptions = {}): ProjectCatalog {
  const directory = options.directory instanceof URL ? fileURLToPath(options.directory) : options.directory ?? path.resolve('src/content/projects');
  const entries = fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const sources: ProjectSource[] = entries.filter(entry => entry.name !== '.gitkeep').map(entry => {
    const source = path.join(directory, entry.name);
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      throw new Error(`Invalid Project source ${source}: expected a regular <slug>.json file`);
    }
    let data: unknown;
    try {
      data = JSON.parse(fs.readFileSync(source, 'utf8'));
    } catch (cause) {
      throw new Error(`Cannot read Project JSON ${source}`, { cause });
    }
    return { source, data, expectedSlug: entry.name.slice(0, -5) };
  });
  return resolveProjects(sources, loadPhotoIndex(options.manifestFile));
}

/** Public entry: drafts are absent from lists and both lookup methods. */
export function loadProjects(options: ProjectLoadOptions = {}): ProjectIndex {
  return loadProjectCatalog(options).published;
}
