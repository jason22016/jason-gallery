import { readPhotographyStatsScope, type PhotographyStatsScope, type ScopedPhotographyStats } from '../../statistics/scope';
import type { PhotographyStatsPageData } from '../../website/photography-stats';
import { emptyFilters, type GalleryState } from '../gallery/filters';
import { DEFAULT_FOCAL_INTERVAL, validFocalInterval } from './focal-length';

export function statsGalleryState(result: ScopedPhotographyStats): GalleryState {
  return { filters: { ...emptyFilters, project: result.project?.id ?? '' }, sort: 'project' };
}

export function statsResultFromSearch(search: string, data: PhotographyStatsPageData) {
  const scope = readPhotographyStatsScope(new URLSearchParams(search));
  if (!scope) return undefined;
  return scope.type === 'all' ? data.all : data.projects.find(result => result.project?.slug === scope.slug);
}

export function statsScopeURL(current: URL, scope: PhotographyStatsScope): URL {
  const url = new URL(current);
  url.pathname = '/stats/';
  url.searchParams.delete('project');
  if (scope.type === 'project') url.searchParams.set('project', scope.slug);
  return url;
}

export function statsPeriodURL(current: URL, period: 'month' | 'year'): URL {
  const url = new URL(current);
  url.searchParams.delete('period');
  if (period === 'year') url.searchParams.set('period', period);
  return url;
}

export function statsFocalIntervalFromSearch(search: string): number {
  const values = new URLSearchParams(search).getAll('focalInterval');
  const value = values.length === 1 && /^\d{1,4}$/.test(values[0]!) ? Number(values[0]) : NaN;
  return validFocalInterval(value) ? value : DEFAULT_FOCAL_INTERVAL;
}

export function statsFocalIntervalURL(current: URL, interval: number): URL {
  const url = new URL(current);
  url.searchParams.delete('focalInterval');
  if (validFocalInterval(interval) && interval !== DEFAULT_FOCAL_INTERVAL) url.searchParams.set('focalInterval', String(interval));
  return url;
}
