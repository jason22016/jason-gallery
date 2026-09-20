import type { PhotographyStats, PhotographyStatsPhoto, ScopedPhotographyStats } from '../../src/statistics';

// Compile-only public API contract, checked by pnpm check.
export function readonlyStatsContract(stats: PhotographyStats, scoped: ScopedPhotographyStats, photo: PhotographyStatsPhoto): void {
  // @ts-expect-error Summary is readonly.
  stats.photoCount = 0;
  // @ts-expect-error Distribution arrays are readonly.
  stats.cameras.buckets.push({ value: 'Camera', count: 1, percentage: 100 });
  // @ts-expect-error Buckets are readonly.
  stats.cameras.buckets[0].count = 0;
  // @ts-expect-error Nested range is readonly.
  stats.captureDateRange.start = null;
  // @ts-expect-error Nested coverage is readonly.
  stats.iso.median = 100;
  // @ts-expect-error Scoped result is readonly.
  scoped.scope = { type: 'all' };
  if (scoped.scope.type === 'project') {
    // @ts-expect-error Scope slug is readonly.
    scoped.scope.slug = 'another';
  }
  if (scoped.project) {
    // @ts-expect-error Public Project is readonly.
    scoped.project.title = 'Changed';
  }
  // @ts-expect-error Projection is readonly.
  photo.capture.iso = 'ISO 100';
  // @ts-expect-error No private EXIF in the stats input contract.
  photo.exif;
}
