import type { GalleryPhoto } from '../components/gallery/photos';
import type { DeepReadonly } from '../projects';

/** Only existing public projection fields; never pass Manifest/EXIF records here. */
export type PhotographyStatsPhoto = DeepReadonly<Pick<GalleryPhoto,
  'id' | 'projects' | 'date' | 'camera' | 'lens' | 'capture' | 'width' | 'height' | 'location' | 'isHDR'
> & { video?: Pick<NonNullable<GalleryPhoto['video']>, 'type'> }>;

export interface StatsCount {
  readonly count: number;
  readonly percentage: number;
}

export interface StatsCoverage {
  readonly sampleCount: number;
  readonly missingCount: number;
  /** Valid samples / unique photos, on a 0–100 scale. */
  readonly coveragePercentage: number;
}

export interface StatsBucket<T extends string | number> extends StatsCount {
  readonly value: T;
}

export interface StatsDistribution<T extends string | number> extends StatsCoverage {
  /** Ascending values; percentages use sampleCount, not the total photo count. */
  readonly buckets: readonly StatsBucket<T>[];
  /** Ties choose the first bucket in ascending value order. */
  readonly mostUsed: StatsBucket<T> | null;
}

export interface NumericStatsDistribution extends StatsDistribution<number> {
  readonly min: number | null;
  readonly max: number | null;
  readonly median: number | null;
}

export interface PhotographyStats {
  readonly photoCount: number;
  /** Distinct public memberships in the input; a resolved Project scope has exactly one. */
  readonly projectCount: number;
  /** Percentage uses photoCount. */
  readonly geotagged: StatsCount;
  readonly captureDateRange: StatsCoverage & {
    /** ISO wall-clock values without zone suffixes; these are not UTC instants. */
    readonly start: string | null;
    readonly end: string | null;
  };
  readonly cameras: StatsDistribution<string>;
  readonly lenses: StatsDistribution<string>;
  readonly focalLength: NumericStatsDistribution & { readonly unit: 'mm'; readonly basis: 'gallery-preferred' };
  readonly aperture: NumericStatsDistribution & { readonly unit: 'f-number' };
  readonly iso: NumericStatsDistribution;
  readonly shutterSpeed: NumericStatsDistribution & { readonly unit: 'seconds' };
  readonly years: StatsDistribution<number>;
  /** Calendar months, YYYY-MM, retaining the capture year. */
  readonly months: StatsDistribution<string>;
  /** Recorded hours 0–23, without timezone conversion. */
  readonly shootingHours: StatsDistribution<number>;
  readonly dynamicRange: StatsDistribution<'hdr' | 'sdr'>;
  readonly media: StatsDistribution<'live-photo' | 'motion-photo' | 'still'>;
  readonly orientation: StatsDistribution<'landscape' | 'portrait' | 'square'>;
}
