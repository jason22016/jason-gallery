import { readPhotographyStatsScope, type PhotographyStatsScope } from '../../statistics/scope';
import type { PhotographyStatsPageData } from '../../website/photography-stats';

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
