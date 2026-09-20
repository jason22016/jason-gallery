import { validLocation } from '../components/viewer/metadata';
import type { NumericStatsDistribution, PhotographyStats, PhotographyStatsPhoto, StatsBucket, StatsDistribution } from './types';
import { apertureValue, captureWallClock, equipmentValue, focalLengthValue, isoValue, shutterSpeedValue } from './values';

const percentage = (count: number, total: number) => total ? count / total * 100 : 0;
const coverage = (sampleCount: number, total: number) => ({ sampleCount, missingCount: total - sampleCount, coveragePercentage: percentage(sampleCount, total) });
const compare = <T extends string | number>(a: T, b: T) => a < b ? -1 : a > b ? 1 : 0;

function add<T extends string | number>(counts: Map<T, number>, value: T | null): void {
  if (value !== null) counts.set(value, (counts.get(value) ?? 0) + 1);
}

function distribution<T extends string | number>(counts: ReadonlyMap<T, number>, total: number): StatsDistribution<T> {
  let sampleCount = 0;
  for (const count of counts.values()) sampleCount += count;
  const buckets = Object.freeze([...counts].sort(([a], [b]) => compare(a, b))
    .map(([value, count]) => Object.freeze({ value, count, percentage: percentage(count, sampleCount) })));
  let mostUsed: StatsBucket<T> | null = null;
  for (const bucket of buckets) if (!mostUsed || bucket.count > mostUsed.count) mostUsed = bucket;
  return Object.freeze({ ...coverage(sampleCount, total), buckets, mostUsed });
}

function numericDistribution(counts: ReadonlyMap<number, number>, total: number): NumericStatsDistribution {
  const result = distribution(counts, total);
  let median: number | null = null;
  if (result.sampleCount) {
    const lowerIndex = Math.floor((result.sampleCount - 1) / 2);
    const upperIndex = Math.floor(result.sampleCount / 2);
    let seen = 0, lower = 0;
    for (const { value, count } of result.buckets) {
      if (seen <= lowerIndex && seen + count > lowerIndex) lower = value;
      if (seen + count > upperIndex) {
        // All numeric metrics are positive; this avoids overflow from (lower + value) / 2.
        median = lower + (value - lower) / 2;
        break;
      }
      seen += count;
    }
  }
  return Object.freeze({ ...result, min: result.buckets[0]?.value ?? null, max: result.buckets.at(-1)?.value ?? null, median });
}

/** Pure aggregation of a public snapshot; canonical IDs identify photos, never URLs. */
export function buildPhotographyStats(photos: readonly PhotographyStatsPhoto[]): PhotographyStats {
  const seen = new Set<string>(), projects = new Set<string>();
  const cameras = new Map<string, number>(), lenses = new Map<string, number>();
  const focalLength = new Map<number, number>(), aperture = new Map<number, number>();
  const iso = new Map<number, number>(), shutter = new Map<number, number>();
  const years = new Map<number, number>(), months = new Map<string, number>(), hours = new Map<number, number>();
  const dynamicRange = new Map<'hdr' | 'sdr', number>();
  const media = new Map<'live-photo' | 'motion-photo' | 'still', number>();
  const orientation = new Map<'landscape' | 'portrait' | 'square', number>();
  let geotaggedCount = 0, datedCount = 0;
  let start: string | null = null, end: string | null = null;

  for (const photo of photos) {
    for (const project of photo.projects ?? []) projects.add(project.id);
    if (seen.has(photo.id)) continue;
    seen.add(photo.id);
    add(cameras, equipmentValue(photo.camera));
    add(lenses, equipmentValue(photo.lens));
    add(focalLength, focalLengthValue(photo.capture?.focalLength));
    add(aperture, apertureValue(photo.capture?.aperture));
    add(iso, isoValue(photo.capture?.iso));
    add(shutter, shutterSpeedValue(photo.capture?.shutter));
    if (validLocation(photo.location)) geotaggedCount++;
    const date = captureWallClock(photo.date);
    if (date) {
      datedCount++;
      if (start === null || date < start) start = date;
      if (end === null || date > end) end = date;
      add(years, Number(date.slice(0, 4)));
      add(months, date.slice(0, 7));
      add(hours, Number(date.slice(11, 13)));
    }
    add(dynamicRange, photo.isHDR === true ? 'hdr' : photo.isHDR === false ? 'sdr' : null);
    add(media, photo.video == null ? 'still' : photo.video.type === 'live-photo' || photo.video.type === 'motion-photo' ? photo.video.type : null);
    const { width, height } = photo;
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      add(orientation, width > height ? 'landscape' : width < height ? 'portrait' : 'square');
    }
  }

  const total = seen.size;
  return Object.freeze({
    photoCount: total, projectCount: projects.size,
    geotagged: Object.freeze({ count: geotaggedCount, percentage: percentage(geotaggedCount, total) }),
    captureDateRange: Object.freeze({ ...coverage(datedCount, total), start, end }),
    cameras: distribution(cameras, total), lenses: distribution(lenses, total),
    focalLength: Object.freeze({ ...numericDistribution(focalLength, total), unit: 'mm', basis: 'gallery-preferred' }),
    aperture: Object.freeze({ ...numericDistribution(aperture, total), unit: 'f-number' }),
    iso: numericDistribution(iso, total),
    shutterSpeed: Object.freeze({ ...numericDistribution(shutter, total), unit: 'seconds' }),
    years: distribution(years, total), months: distribution(months, total), shootingHours: distribution(hours, total),
    dynamicRange: distribution(dynamicRange, total), media: distribution(media, total), orientation: distribution(orientation, total),
  });
}
