// Server/build-only adapter. PublicPhotoCollection remains the sole source of public membership.
import { loadProjects, type ProjectLoadOptions } from '../projects';
import { allPhotographyStatsScope, resolvePhotographyStats, type PhotographyStatsScope, type ScopedPhotographyStats } from '../statistics';
import { loadPublicPhotoCollection, resolvePublicPhotoCollection } from './public-photos';
import { galleryFilterOptions, selectPhotos } from '../components/gallery/filters';
import { globalGalleryHref } from '../components/gallery/url-state';
import { statsGalleryState } from '../components/stats/url-state';
import { equipmentValue } from '../statistics/values';

export interface PhotographyStatsPageScope extends ScopedPhotographyStats {
  readonly explore: {
    readonly cameras: Readonly<Record<string, string>>;
    readonly lenses: Readonly<Record<string, string>>;
  };
}

/** Browser payload: aggregates, public scope identities and verified equipment links. */
export interface PhotographyStatsPageData {
  readonly all: PhotographyStatsPageScope;
  readonly projects: readonly PhotographyStatsPageScope[];
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
  const withExploreLinks = (result: ScopedPhotographyStats): PhotographyStatsPageScope => {
    const state = statsGalleryState(result);
    const filterOptions = galleryFilterOptions(selectPhotos(photos, state.filters, state.sort), ['camera', 'lens']);
    const hrefs = (field: 'camera' | 'lens', distribution: ScopedPhotographyStats['stats']['cameras']) => {
      const matches = new Map<string, (typeof filterOptions)[number] | null>();
      for (const option of filterOptions) {
        if (option.field !== field) continue;
        const value = equipmentValue(option.value);
        if (value !== null) matches.set(value, matches.has(value) ? null : option);
      }
      return Object.freeze(Object.fromEntries(distribution.buckets.flatMap(bucket => {
        const candidate = matches.get(bucket.value);
        // Explore uses exact strings: a merged bucket cannot link to only part of its photos.
        if (!candidate || candidate.count !== bucket.count) return [];
        return [[bucket.value, globalGalleryHref('explore', { ...state, filters: { ...state.filters, [field]: candidate.value } })]];
      })));
    };
    return Object.freeze({ ...result, explore: Object.freeze({ cameras: hrefs('camera', result.stats.cameras), lenses: hrefs('lens', result.stats.lenses) }) });
  };
  const projects = index.listProjects().flatMap(project => {
    const result = resolvePhotographyStats(photos, { type: 'project', slug: project.slug });
    return result ? [withExploreLinks(result)] : [];
  });
  return Object.freeze({
    all: withExploreLinks(resolvePhotographyStats(photos, allPhotographyStatsScope)!),
    projects: Object.freeze(projects),
  });
}
