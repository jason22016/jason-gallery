// Pure, browser-safe entry; the filesystem loader is intentionally separate.
export { buildPhotographyStats } from './engine';
export { allPhotographyStatsScope, readPhotographyStatsScope, resolvePhotographyStats } from './scope';
export type { PhotographyStatsScope, ScopedPhotographyStats } from './scope';
export type { PhotographyStats, PhotographyStatsPhoto, StatsCount, StatsCoverage, StatsBucket, StatsDistribution, NumericStatsDistribution } from './types';
