// Server/build-only adapter. PublicPhotoCollection remains the sole source of public membership.
import type { ProjectLoadOptions } from '../projects';
import { resolvePhotographyStats, type PhotographyStatsScope, type ScopedPhotographyStats } from '../statistics';
import { loadPublicPhotoCollection } from './public-photos';

export function loadPhotographyStats(
  scope: PhotographyStatsScope | undefined, options: ProjectLoadOptions = {},
): ScopedPhotographyStats | undefined {
  if (!scope) return undefined;
  return resolvePhotographyStats(loadPublicPhotoCollection(options).listPhotos(), scope);
}
