// Server/build-only adapter. PublicPhotoCollection remains the sole source of public membership.
import { loadProjects, type ProjectLoadOptions } from '../projects';
import { allPhotographyStatsScope, resolvePhotographyStats, type PhotographyStatsScope, type ScopedPhotographyStats } from '../statistics';
import { loadPublicPhotoCollection, resolvePublicPhotoCollection } from './public-photos';

/** Browser payload: aggregates plus the minimum published Project identity for scope selection. */
export interface PhotographyStatsPageData {
  readonly all: ScopedPhotographyStats;
  readonly projects: readonly ScopedPhotographyStats[];
}

export function loadPhotographyStats(
  scope: PhotographyStatsScope | undefined, options: ProjectLoadOptions = {},
): ScopedPhotographyStats | undefined {
  if (!scope) return undefined;
  return resolvePhotographyStats(loadPublicPhotoCollection(options).listPhotos(), scope);
}

/** Resolve every selectable scope from one public collection snapshot, in Gallery Project order. */
export function loadPhotographyStatsPageData(options: ProjectLoadOptions = {}): PhotographyStatsPageData {
  const index = loadProjects(options);
  const photos = resolvePublicPhotoCollection(index).listPhotos();
  const projects = index.listProjects().flatMap(project => {
    const result = resolvePhotographyStats(photos, { type: 'project', slug: project.slug });
    return result ? [result] : [];
  });
  return Object.freeze({
    all: resolvePhotographyStats(photos, allPhotographyStatsScope)!,
    projects: Object.freeze(projects),
  });
}
