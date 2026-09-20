import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { buildPhotographyStats, type PhotographyStatsPhoto, type StatsDistribution } from '../../src/statistics';
import { assertDeepFrozen, assertFiniteNumbers, publicFixture, statsPhoto } from './fixtures';

const values = <T extends string | number>(distribution: StatsDistribution<T>) => distribution.buckets.map(({ value, count }) => [value, count]);
const capturePhotos = (field: keyof PhotographyStatsPhoto['capture'], data: unknown[]) => data.map((value, index) => {
  const photo = statsPhoto(String(index));
  return { ...photo, capture: { ...photo.capture, [field]: value as string } };
});

test('canonical IDs, not public IDs or URLs, count once across shared Project references', () => {
  const { collection } = publicFixture();
  const photos = collection.listPhotos();
  const duplicate = { ...photos[0]!, publicId: 'different-short-id', src: '/other-url.jpg' };
  const stats = buildPhotographyStats([...photos, duplicate]);
  assert.equal(stats.photoCount, 3);
  assert.equal(stats.projectCount, 2);
  assert.equal(stats.cameras.sampleCount, 1);
  assert.equal(stats.dynamicRange.buckets.find(bucket => bucket.value === 'hdr')?.count, 1);
  assert.deepEqual(stats, buildPhotographyStats(photos));
  const sameURL = photos.map((photo, index) => ({ ...photo, id: String(index), src: '/same.jpg', publicId: 'same' }));
  assert.equal(buildPhotographyStats(sameURL).photoCount, 3);
});

test('duplicate public references retain distinct memberships without multiplying photo metrics', () => {
  const first = statsPhoto('shared');
  const second = { ...first, projects: [{ id: 'second-id', slug: 'second', title: 'Second' }] };
  const stats = buildPhotographyStats([first, second, second]);
  assert.equal(stats.photoCount, 1);
  assert.equal(stats.projectCount, 2);
  assert.equal(stats.orientation.sampleCount, 1);
  assert.deepEqual(stats, buildPhotographyStats([second, first]));
});

test('Camera / Lens reuse public display spelling, normalize whitespace and omit absent/invalid text', () => {
  const stats = buildPhotographyStats([
    statsPhoto('1', { camera: '  NIKON   CORPORATION NIKON Z 5 ', lens: ' NIKKOR Z 50mm f/1.8 S ' }),
    statsPhoto('2', { camera: 'NIKON CORPORATION NIKON Z 5', lens: 'NIKKOR\tZ 50mm f/1.8 S' }),
    statsPhoto('3', { camera: 'Apple iPhone 16 Pro', lens: 'iPhone 16 Pro back camera' }),
    statsPhoto('4', { camera: '  ', lens: 'Unknown' }),
    statsPhoto('5', { camera: 42, lens: {} } as unknown as Partial<PhotographyStatsPhoto>),
  ]);
  assert.deepEqual(values(stats.cameras), [['Apple iPhone 16 Pro', 1], ['NIKON CORPORATION NIKON Z 5', 2]]);
  assert.deepEqual(values(stats.lenses), [['NIKKOR Z 50mm f/1.8 S', 2], ['iPhone 16 Pro back camera', 1]]);
  assert.equal(stats.cameras.mostUsed?.value, 'NIKON CORPORATION NIKON Z 5');
  assert.equal(stats.lenses.mostUsed?.count, 2);
  assert.equal(stats.cameras.sampleCount, 3);
  assert.equal(stats.cameras.missingCount, 2);
  assert.equal(stats.cameras.coveragePercentage, 60);
  assert.equal(stats.cameras.mostUsed?.percentage, 2 / 3 * 100);
});

test('focal length accepts mm, decimals, numeric/rational values and the existing 35mm-preferred projection', () => {
  const stats = buildPhotographyStats(capturePhotos('focalLength', [35, '+35', '35.0 mm', ' 70/2 MM ', '50mm', 85, '1e2 mm']));
  assert.deepEqual(values(stats.focalLength), [[35, 4], [50, 1], [85, 1], [100, 1]]);
  assert.equal(stats.focalLength.median, 35);
  assert.equal(stats.focalLength.min, 35);
  assert.equal(stats.focalLength.max, 100);
  assert.equal(stats.focalLength.mostUsed?.count, 4);
  const projected = buildPhotographyStats(publicFixture().collection.listPhotos());
  assert.deepEqual(values(projected.focalLength), [[50, 1]]);
  assert.equal(projected.focalLength.basis, 'gallery-preferred');
  assert.equal(projected.focalLength.unit, 'mm');
});

test('aperture normalizes f-number formats, reports weighted median and resolves ties by numeric value', () => {
  const stats = buildPhotographyStats(capturePhotos('aperture', [2.8, 'ƒ/2.8', 'f/4', 'F / 4.0', '28/10', 'f/8']));
  assert.deepEqual(values(stats.aperture), [[2.8, 3], [4, 2], [8, 1]]);
  assert.equal(stats.aperture.median, 3.4);
  assert.equal(stats.aperture.unit, 'f-number');
  assert.equal(buildPhotographyStats(capturePhotos('aperture', ['f/8', 'f/2'])).aperture.mostUsed?.value, 2);
});

test('ISO accepts only positive safe integers, with or without the existing ISO prefix', () => {
  const stats = buildPhotographyStats(capturePhotos('iso', [100, 'ISO 100', ' iso 200 ', '400.0', 'ISO 800', 0, 100.5, '100/0', 'auto', '100abc', Number.MAX_SAFE_INTEGER + 1]));
  assert.deepEqual(values(stats.iso), [[100, 2], [200, 1], [400, 1], [800, 1]]);
  assert.equal(stats.iso.median, 200);
  assert.equal(stats.iso.missingCount, 6);
});

test('shutter speed unifies decimals, fractions and existing seconds suffixes without APEX inference', () => {
  const photos = capturePhotos('shutter', [0.008, '1/125', '1/125 s', '0.008 sec', '1 / 125 seconds', '.5s', '2 s', '30']);
  const stats = buildPhotographyStats(photos);
  assert.deepEqual(values(stats.shutterSpeed), [[0.008, 5], [0.5, 1], [2, 1], [30, 1]]);
  assert.equal(stats.shutterSpeed.median, 0.008);
  assert.equal(stats.shutterSpeed.unit, 'seconds');
  const noExposure = { ...statsPhoto('apex-only'), exif: { ShutterSpeedValue: 7 }, exposure: ['1/125 s'] };
  assert.equal(buildPhotographyStats([noExposure]).shutterSpeed.sampleCount, 0);
});

for (const [field, metric, malformed] of [
  ['focalLength', 'focalLength', ['35 m', '35 mm extra', '24-70 mm']],
  ['aperture', 'aperture', ['f/0', 'f/-2', 'f/2.8 rubbish']],
  ['iso', 'iso', ['ISO Auto', 'ISO 100 extra', '1.5']],
  ['shutter', 'shutterSpeed', ['1/0 s', '1/125 trailing', '1/-125', '1/2/3', '1ms', 'Bulb']],
] as const) {
  test(`${metric} excludes invalid values without counting them as zero`, () => {
    const invalid = [undefined, null, '', ' ', NaN, Infinity, -Infinity, 0, -1, '-1', 'NaN', 'Infinity', '0/0', '1/0', '0x10', '1e999', '1e-999', true, {}, [], ...malformed];
    const result = buildPhotographyStats(capturePhotos(field, invalid))[metric];
    assert.equal(result.sampleCount, 0);
    assert.equal(result.missingCount, invalid.length);
    assert.equal(result.coveragePercentage, 0);
    assert.deepEqual(result.buckets, []);
    assert.equal(result.median, null);
    assert.equal(result.mostUsed, null);
  });
}

test('year/month/hour and date range use capture wall clock even across offset-driven day/year boundaries', () => {
  const dates = ['2024-01-01T00:15:30.100+14:00', '2023-12-31T23:45:00-12:00', '2024-02-29T12:34:56', '2024-02-29T23:30:00Z', ''];
  const stats = buildPhotographyStats(dates.map((date, index) => statsPhoto(String(index), { date })));
  assert.deepEqual(values(stats.years), [[2023, 1], [2024, 3]]);
  assert.deepEqual(values(stats.months), [['2023-12', 1], ['2024-01', 1], ['2024-02', 2]]);
  assert.deepEqual(values(stats.shootingHours), [[0, 1], [12, 1], [23, 2]]);
  assert.deepEqual(stats.captureDateRange, { sampleCount: 4, missingCount: 1, coveragePercentage: 80, start: '2023-12-31T23:45:00', end: '2024-02-29T23:30:00' });
  assert.equal(stats.shootingHours.mostUsed?.percentage, 50);
});

test('wall-clock range preserves fractional precision and canonicalizes equivalent fractions', () => {
  const stats = buildPhotographyStats(['2024-01-01T08:00:00.0100-05:00', '2024-01-01T08:00:00.1+08:00', '2024-01-01T08:00:00.000Z'].map((date, index) => statsPhoto(String(index), { date })));
  assert.equal(stats.captureDateRange.start, '2024-01-01T08:00:00');
  assert.equal(stats.captureDateRange.end, '2024-01-01T08:00:00.1');
  assert.deepEqual(values(stats.shootingHours), [[8, 3]]);
});

test('missing or invalid dates never use Engine dateTaken, modified time or raw EXIF fallback', () => {
  const invalid = [undefined, null, '', 42, {}, 'bad', '2024-02-30T12:00:00', '2023-02-29T00:00:00', '2024-13-01T00:00:00', '2024-01-01T24:00:00', '2024-01-01T12:60:00', '2024-01-01T00:00:60', '2024-01-01T00:00:00+24:00', '2024-01-01T00:00:00+08:60', '2024:01:01 08:00:00', '2024-01-01'];
  const stats = buildPhotographyStats(invalid.map((date, index) => ({
    ...statsPhoto(String(index), { date: date as string }), dateTaken: '2026-09-20T14:00:00Z', lastModified: '2026-09-20T14:00:00Z', exif: { DateTimeOriginal: '2024-01-01T01:00:00Z' },
  })));
  for (const result of [stats.years, stats.months, stats.shootingHours, stats.captureDateRange]) {
    assert.equal(result.sampleCount, 0);
    assert.equal(result.missingCount, invalid.length);
  }
  assert.equal(stats.captureDateRange.start, null);
  assert.equal(stats.captureDateRange.end, null);
});

test('statistics serialize identically under different process/browser timezone defaults', () => {
  const moduleURL = new URL('../../src/statistics/index.ts', import.meta.url).href;
  const photos = ['2024-01-01T00:01:00+14:00', '2023-12-31T23:59:00-12:00', '2024-02-29T04:00:00', '2024-02-29T17:00:00Z'].map((date, index) => statsPhoto(String(index), { date }));
  const script = `import { buildPhotographyStats } from ${JSON.stringify(moduleURL)}; console.log(JSON.stringify(buildPhotographyStats(${JSON.stringify(photos)})));`;
  const expected = JSON.stringify(buildPhotographyStats(photos));
  for (const TZ of ['UTC', 'Asia/Hong_Kong', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { encoding: 'utf8', env: { ...process.env, TZ }, timeout: 15_000 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), expected, TZ);
  }
});

test('GPS uses only the public validLocation rule, including zero and boundary coordinates', () => {
  const locations = [{ latitude: 0, longitude: 0 }, { latitude: -90, longitude: 180 }, { latitude: 90, longitude: -180 }, null,
    { latitude: 91, longitude: 0 }, { latitude: 0, longitude: 181 }, { latitude: NaN, longitude: 0 }, { latitude: 0, longitude: Infinity },
    { latitude: '22.3', longitude: '114.1' }, { latitude: 20 }];
  const stats = buildPhotographyStats(locations.map((location, index) => ({ ...statsPhoto(String(index), { location: location as PhotographyStatsPhoto['location'] }), exif: { GPSLatitude: 0, GPSLongitude: 0 } })));
  assert.deepEqual(stats.geotagged, { count: 3, percentage: 30 });
});

test('HDR / SDR and Live / Motion / still use only explicit public fields', () => {
  const still = { ...statsPhoto('still'), format: 'heic', exif: { MPImageType: 'HDR', MotionPhoto: true } };
  const stats = buildPhotographyStats([
    statsPhoto('live', { isHDR: true, video: { type: 'live-photo' } }),
    statsPhoto('motion', { video: { type: 'motion-photo' } }),
    still,
    statsPhoto('malformed', { isHDR: 'true', video: { type: 'other' } } as unknown as Partial<PhotographyStatsPhoto>),
    statsPhoto('missing-hdr', { isHDR: undefined } as unknown as Partial<PhotographyStatsPhoto>),
  ]);
  assert.deepEqual(values(stats.dynamicRange), [['hdr', 1], ['sdr', 2]]);
  assert.equal(stats.dynamicRange.missingCount, 2);
  assert.deepEqual(values(stats.media), [['live-photo', 1], ['motion-photo', 1], ['still', 2]]);
  assert.equal(stats.media.missingCount, 1);
});

test('orientation uses finite positive public width/height, ignoring aspect ratio and EXIF Orientation', () => {
  const sizes = [[40, 20], [20, 40], [20, 20], [0, 10], [-1, 10], [Infinity, 10], [10, NaN], ['40', 20]];
  const stats = buildPhotographyStats(sizes.map(([width, height], index) => ({ ...statsPhoto(String(index), { width: width as number, height: height as number }), aspectRatio: 0.5, exif: { Orientation: 6 } })));
  assert.deepEqual(values(stats.orientation), [['landscape', 1], ['portrait', 1], ['square', 1]]);
  assert.equal(stats.orientation.missingCount, 5);
});

test('empty collection is a frozen, finite, JSON-safe result with no invented most-used or median values', () => {
  const stats = buildPhotographyStats([]);
  assert.equal(stats.photoCount, 0);
  assert.equal(stats.projectCount, 0);
  assert.deepEqual(stats.geotagged, { count: 0, percentage: 0 });
  for (const result of Object.values(stats)) {
    if (result && typeof result === 'object' && 'sampleCount' in result) {
      assert.equal(result.sampleCount, 0);
      assert.equal(result.missingCount, 0);
      assert.equal(result.coveragePercentage, 0);
      if ('buckets' in result) { assert.deepEqual(result.buckets, []); assert.equal(result.mostUsed, null); }
      if ('median' in result) { assert.equal(result.min, null); assert.equal(result.max, null); assert.equal(result.median, null); }
    }
  }
  assertDeepFrozen(stats);
  assertFiniteNumbers(stats);
  assert.deepEqual(JSON.parse(JSON.stringify(stats)), stats);
});

test('deterministic aggregation does not mutate/freeze inputs and returns recursively readonly results', () => {
  const photos = Array.from({ length: 250 }, (_, index) => statsPhoto(String(index), {
    camera: index % 2 ? 'NIKON Z6' : 'Apple iPhone', date: `2024-02-29T${String(index % 24).padStart(2, '0')}:00:00+08:00`,
    capture: { focalLength: `${[24, 35, 50, 85][index % 4]} mm`, aperture: index % 5 ? 'ƒ/2.8' : '', iso: `ISO ${[100, 200, 400][index % 3]}`, shutter: index % 3 ? '1/125 s' : 'invalid' },
  }));
  const before = structuredClone(photos);
  const stats = buildPhotographyStats(photos);
  assert.deepEqual(stats, buildPhotographyStats([...photos].reverse()));
  assert.deepEqual(stats, buildPhotographyStats([...photos.slice(50), ...photos.slice(0, 50)]));
  assert.deepEqual(photos, before);
  assert(!Object.isFrozen(photos)); assert(!Object.isFrozen(photos[0]!.capture)); assert(!Object.isFrozen(photos[0]!.projects));
  assertDeepFrozen(stats); assertFiniteNumbers(stats);
  assert.throws(() => Object.assign(stats.cameras.buckets[0]!, { count: 0 }), TypeError);
  for (const result of Object.values(stats)) {
    if (result && typeof result === 'object' && 'buckets' in result) {
      const distribution: StatsDistribution<string | number> = result;
      assert.equal(distribution.sampleCount + distribution.missingCount, stats.photoCount);
      assert.equal(distribution.buckets.reduce((sum, bucket) => sum + bucket.count, 0), distribution.sampleCount);
      assert(Math.abs(distribution.buckets.reduce((sum, bucket) => sum + bucket.percentage, 0) - (distribution.sampleCount ? 100 : 0)) < 1e-10);
    }
  }
});

test('large finite numbers and rational overflow cannot produce NaN or Infinity', () => {
  const stats = buildPhotographyStats(capturePhotos('shutter', [Number.MAX_VALUE, Number.MAX_VALUE, '1e308/1e-308', '1e-308/1e308']));
  assert.equal(stats.shutterSpeed.sampleCount, 2);
  assert.equal(stats.shutterSpeed.median, Number.MAX_VALUE);
  assertFiniteNumbers(stats);
  assert.deepEqual(JSON.parse(JSON.stringify(stats)), stats);
});
