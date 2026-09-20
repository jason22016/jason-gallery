import type { StatsBucket, StatsDistribution } from '../../statistics/types';

export const DEFAULT_FOCAL_INTERVAL = 10;
export const MAX_FOCAL_INTERVAL = 1000;
export const FOCAL_INTERVAL_PRESETS = [1, 5, 10, 20, 50] as const;

export function validFocalInterval(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= MAX_FOCAL_INTERVAL;
}

/** Display-only grouping of public aggregate counts, never individual photos. */
export function groupFocalLengths(distribution: StatsDistribution<number>, interval: number): StatsDistribution<number> {
  if (!validFocalInterval(interval)) throw new RangeError('Invalid focal length interval');
  const counts = new Map<number, number>();
  for (const bucket of distribution.buckets) {
    const start = bucket.value - bucket.value % interval;
    counts.set(start, (counts.get(start) ?? 0) + bucket.count);
  }
  const buckets = [...counts].sort(([a], [b]) => a - b).map(([value, count]) => ({
    value, count, percentage: distribution.sampleCount ? count / distribution.sampleCount * 100 : 0,
  }));
  let mostUsed: StatsBucket<number> | null = null;
  for (const bucket of buckets) if (!mostUsed || bucket.count > mostUsed.count) mostUsed = bucket;
  return {
    buckets, mostUsed,
    sampleCount: distribution.sampleCount,
    missingCount: distribution.missingCount,
    coveragePercentage: distribution.coveragePercentage,
  };
}
