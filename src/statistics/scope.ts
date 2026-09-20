import type { GalleryProjectMembership } from '../components/gallery/photos';
import type { PhotographyStats, PhotographyStatsPhoto } from './types';
import { buildPhotographyStats } from './engine';

export type PhotographyStatsScope = { readonly type: 'all' } | { readonly type: 'project'; readonly slug: string };
export interface ScopedPhotographyStats {
  readonly scope: PhotographyStatsScope;
  readonly project: GalleryProjectMembership | null;
  readonly stats: PhotographyStats;
}

export const allPhotographyStatsScope = Object.freeze({ type: 'all' } as const);
const validSlug = (slug: string) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);

/** /stats/ is all; ?project=<slug> is a Project. Invalid/ambiguous input never falls back to all. */
export function readPhotographyStatsScope(params: URLSearchParams): PhotographyStatsScope | undefined {
  const projects = params.getAll('project');
  if (!projects.length) return allPhotographyStatsScope;
  if (projects.length !== 1 || !validSlug(projects[0]!)) return undefined;
  return Object.freeze({ type: 'project', slug: projects[0]! });
}

/** The input must come from PublicPhotoCollection, whose memberships are published-only. */
export function resolvePhotographyStats(
  photos: readonly PhotographyStatsPhoto[], scope: PhotographyStatsScope | undefined,
): ScopedPhotographyStats | undefined {
  if (!scope) return undefined;
  if (scope.type === 'all') return Object.freeze({ scope: allPhotographyStatsScope, project: null, stats: buildPhotographyStats(photos) });
  if (scope.type !== 'project' || !validSlug(scope.slug)) return undefined;
  const selected: PhotographyStatsPhoto[] = [];
  let project: GalleryProjectMembership | null = null;
  for (const photo of photos) {
    const membership = photo.projects?.find(project => project.slug === scope.slug);
    if (!membership) continue;
    project ??= Object.freeze({ id: membership.id, slug: membership.slug, title: membership.title });
    // Shared photos belong to this scope once; other public memberships do not inflate projectCount.
    selected.push({ ...photo, projects: [project] });
  }
  if (!project) return undefined;
  return Object.freeze({ scope: Object.freeze({ type: 'project', slug: scope.slug }), project, stats: buildPhotographyStats(selected) });
}
