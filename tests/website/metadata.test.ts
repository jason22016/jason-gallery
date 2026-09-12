import assert from 'node:assert/strict';
import { test } from 'node:test';
import { captureDate, captureZone, formatCaptureTime, photoLocation, altitude, aperture, unit } from '../../src/components/viewer/metadata';
import { viewerPhotos, selectPhotos, emptyFilters, formatBytes } from '../../src/components/viewer/photos';
import { resolveProjects } from '../../src/projects/resolver';
import { photo, project } from '../projects/fixtures';

test('capture time preserves EXIF wall clock and offsets; build clock and malformed dates are not capture evidence', () => {
  assert.equal(captureDate(null), '');
  assert.equal(captureDate({}), '');
  for (const value of ['garbage', '2024-02-30T10:00:00', '2024-13-01T00:00:00', '2024-01-01T24:00:00']) assert.equal(captureDate({ DateTimeOriginal: value }), '');
  const date = '2024-02-29T00:15:30.123';
  assert.equal(captureDate({ DateTimeOriginal: date }), date);
  assert.equal(captureZone({ DateTimeOriginal: date }), '未记录');
  assert.equal(captureDate({ DateTimeOriginal: date, OffsetTimeOriginal: '+05:30' }), `${date}+05:30`);
  assert.equal(captureZone({ DateTimeOriginal: `${date}-03:30` }), 'UTC_-3:30');
  assert.equal(captureDate({ DateTimeOriginal: `${date}Z`, OffsetTimeOriginal: '+08:00' }), `${date}Z`);
});

test('capture display omits fractions and offsets without shifting the recorded wall clock', () => {
  const date = '2026-02-18T07:59:55.990+08:00';
  assert.equal(formatCaptureTime(date), '2026-02-18 07:59:55');
  assert.equal(formatCaptureTime('2026-02-18T00:01:02.123-03:30'), '2026-02-18 00:01:02');
  assert.equal(formatCaptureTime('2026-02-18T07:59:55Z'), '2026-02-18 07:59:55');
  assert.equal(formatCaptureTime('2026-02-18T07:59:55'), '2026-02-18 07:59:55');
  assert.equal(formatCaptureTime(''), '未记录');
  assert.equal(formatCaptureTime('2026-02-30T07:59:55'), '未记录');
  assert.equal(captureZone({ DateTimeOriginal: date, OffsetTimeOriginal: '+08:00', zone: 'UTC+8', tzSource: 'OffsetTimeOriginal' }), 'UTC_8');
  assert.equal(captureZone({ DateTimeOriginal: '2026-02-18T07:59:55Z' }), 'UTC_0');
  assert.equal(captureZone({ DateTimeOriginal: '2026-02-18T07:59:55+05:45' }), 'UTC_5:45');
  assert.equal(captureZone({ DateTimeOriginal: '2026-02-18T07:59:55', zone: 'UTC+8' }), 'UTC_8');
});

test('native EXIF GPS works without reverse geocoding; zero, signed hemispheres, invalid/missing pairs and units stay honest', () => {
  const gps = (latitude: number, longitude: number) => photoLocation({ location: null, exif: { GPSLatitude: latitude, GPSLongitude: longitude } });
  assert.deepEqual(gps(0, 0), { latitude: 0, longitude: 0 });
  assert.deepEqual(photoLocation({ location: null, exif: { GPSLatitude: -33.5, GPSLongitude: 70.5, GPSLatitudeRef: 'S', GPSLongitudeRef: 'W' } }), { latitude: -33.5, longitude: -70.5 });
  for (const [lat, lon] of [[91, 0], [0, 181], [NaN, 1], [1, Infinity]]) assert.equal(gps(lat!, lon!), null);
  assert.equal(photoLocation({ location: null, exif: { GPSLatitude: 0 } }), null);
  assert.equal(altitude({ GPSAltitude: 0 }), '0 m');
  assert.equal(altitude({ GPSAltitude: -12, GPSAltitudeRef: 1 }), '-12 m');
  assert.equal(unit('1/125', 's'), '1/125 s');
  assert.equal(unit(2.5, 's'), '2.5 s');
  assert.equal(unit('50.0 mm', 'mm'), '50.0 mm');
  assert.equal(unit(0, 'EV'), '0 EV');
  assert.equal(unit(undefined, 'mm'), '');
  assert.equal(aperture(0), '');
  assert.equal(formatBytes(1048576), '1.0 MiB');
});


test('projection and date filters/sort use recorded dates, actual focal length and native coordinates without mutating the engine', () => {
  const missing = photo('missing'), first = photo('first'), second = photo('second');
  first.exif = { DateTimeOriginal: '2024-03-01T00:15:00+08:00', FocalLength: '35 mm', FocalLengthIn35mmFormat: '50 mm', ExposureTime: '1/125', ISO: 100 } as typeof first.exif;
  second.exif = { DateTimeOriginal: '2024-02-29T20:00:00Z' } as typeof second.exif;
  const native = [missing, first, second];
  const snapshot = JSON.stringify(native);
  const resolved = resolveProjects([{ source: 'fixture', data: project({ coverPhotoId: missing.id, photos: native.map(p => ({ photoId: p.id })) }) }], { getPhoto: id => structuredClone(native.find(p => p.id === id)) }).published.listProjects()[0]!;
  const photos = viewerPhotos(resolved);
  assert.equal(photos[0]!.date, '');
  assert.deepEqual(photos[1]!.exposure, ['35 mm', '1/125 s', 'ISO 100']);
  assert.deepEqual(selectPhotos(photos, { ...emptyFilters, start: '2024-03-01', end: '2024-03-01' }, 'project').map(p => p.id), ['first']);
  assert.deepEqual(selectPhotos(photos, emptyFilters, 'asc').map(p => p.id), ['first', 'second', 'missing']);
  assert.deepEqual(selectPhotos(photos, emptyFilters, 'desc').map(p => p.id), ['second', 'first', 'missing']);
  assert.equal(JSON.stringify(native), snapshot);
});
