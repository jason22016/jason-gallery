import assert from 'node:assert/strict';
import { test } from 'node:test';
import { groupFocalLengths } from '../../src/components/stats/focal-length';
import type { StatsDistribution } from '../../src/statistics';

function distribution(values: [number, number][], missingCount = 0): StatsDistribution<number> {
  const sampleCount = values.reduce((total, [, count]) => total + count, 0);
  const buckets = values.map(([value, count]) => Object.freeze({ value, count, percentage: count / sampleCount * 100 }));
  return Object.freeze({
    buckets: Object.freeze(buckets), mostUsed: buckets.reduce<(typeof buckets)[number] | null>((most, bucket) => !most || bucket.count > most.count ? bucket : most, null),
    sampleCount, missingCount, coveragePercentage: sampleCount ? sampleCount / (sampleCount + missingCount) * 100 : 0,
  });
}

test('focal intervals combine weighted counts, keep upper boundaries exclusive and preserve missing-data coverage', () => {
  const source = distribution([[24, 2], [29.9, 1], [30, 4], [35, 1], [50, 2]], 2);
  const before = JSON.stringify(source);
  const grouped = groupFocalLengths(source, 10);
  assert.deepEqual(grouped.buckets, [
    { value: 20, count: 3, percentage: 30 },
    { value: 30, count: 5, percentage: 50 },
    { value: 50, count: 2, percentage: 20 },
  ]);
  assert.strictEqual(grouped.mostUsed, grouped.buckets[1]);
  assert.equal(grouped.sampleCount, 10);
  assert.equal(grouped.missingCount, 2);
  assert.equal(grouped.coveragePercentage, source.coveragePercentage);
  assert.deepEqual(groupFocalLengths(source, 20).buckets.map(({ value, count }) => [value, count]), [[20, 8], [40, 2]]);
  assert.deepEqual(groupFocalLengths(source, 1).buckets.map(({ value, count }) => [value, count]), [[24, 2], [29, 1], [30, 4], [35, 1], [50, 2]]);
  assert.equal(JSON.stringify(source), before);
});

test('custom intervals handle fractional focal lengths and deterministic ties without rounding photos into the next range', () => {
  const source = distribution([[0.5, 1], [24.999, 1], [25, 1], [49.99, 1], [50, 1]]);
  const grouped = groupFocalLengths(source, 25);
  assert.deepEqual(grouped.buckets.map(({ value, count }) => [value, count]), [[0, 2], [25, 2], [50, 1]]);
  assert.equal(grouped.mostUsed?.value, 0);
  for (const interval of [1, 5, 10, 20, 25, 50, 75, 1000]) {
    const result = groupFocalLengths(source, interval);
    assert.equal(result.buckets.reduce((sum, bucket) => sum + bucket.count, 0), source.sampleCount);
    assert.equal(result.buckets.reduce((sum, bucket) => sum + bucket.percentage, 0), 100);
  }
});

test('empty, missing and widely separated focal data stay finite and bounded by the existing aggregate size', () => {
  for (const missing of [0, 3]) assert.deepEqual(groupFocalLengths(distribution([], missing), 10), distribution([], missing));
  const sparse = groupFocalLengths(distribution([[24, 1], [Number.MAX_VALUE, 1]]), 7);
  assert.equal(sparse.buckets.length, 2);
  assert.equal(sparse.sampleCount, 2);
  assert(sparse.buckets.every(bucket => Number.isFinite(bucket.value)));
});

test('invalid focal intervals cannot divide by zero or produce unbounded chart work', () => {
  const source = distribution([[24, 1]]);
  for (const interval of [0, -1, 1.5, 1001, NaN, Infinity]) assert.throws(() => groupFocalLengths(source, interval), RangeError);
});
