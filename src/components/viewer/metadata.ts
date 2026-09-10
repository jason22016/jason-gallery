import type { PhotoManifestItem } from '../../photo-engine';
type Exif = Partial<Pick<NonNullable<PhotoManifestItem['exif']>, 'DateTimeOriginal' | 'OffsetTimeOriginal' | 'zone' | 'tz' | 'tzSource' | 'GPSLatitude' | 'GPSLongitude' | 'GPSLatitudeRef' | 'GPSLongitudeRef' | 'GPSAltitude' | 'GPSAltitudeRef'>> | null | undefined;

/** Engine dateTaken can be the build clock. Only EXIF is evidence of capture time. */
export function captureDate(exif: Exif): string {
  const value = exif?.DateTimeOriginal;
  if (!value || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/.test(value)) return '';
  const day = value.slice(0, 10);
  const calendar = new Date(`${day}T00:00:00Z`);
  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== day) return '';
  const offset = exif?.OffsetTimeOriginal;
  const result = !/(Z|[+-]\d{2}:\d{2})$/.test(value) && offset && /^[+-]\d{2}:\d{2}$/.test(offset) ? value + offset : value;
  return Number.isFinite(Date.parse(/(Z|[+-]\d{2}:\d{2})$/.test(result) ? result : `${result}Z`)) ? result : '';
}
export function captureZone(exif: Exif): string {
  if (!captureDate(exif)) return '';
  const offset = captureDate(exif).match(/(Z|[+-]\d{2}:\d{2})$/)?.[1];
  const zone = exif?.zone || exif?.tz;
  return [offset === 'Z' ? 'UTC' : offset ? `UTC${offset}` : '', zone, exif?.tzSource ? `来源：${exif.tzSource}` : ''].filter(Boolean).join(' · ') || '未记录';
}
export function validLocation(location: PhotoManifestItem['location']): boolean {
  return !!location && Number.isFinite(location.latitude) && Number.isFinite(location.longitude)
    && Math.abs(location.latitude) <= 90 && Math.abs(location.longitude) <= 180;
}
/** Reverse geocoding is optional; native numeric EXIF coordinates remain usable. */
export function photoLocation(photo: { location: PhotoManifestItem['location']; exif: Exif }): PhotoManifestItem['location'] {
  if (validLocation(photo.location)) return photo.location;
  const exif = photo.exif;
  if (typeof exif?.GPSLatitude !== 'number' || typeof exif.GPSLongitude !== 'number') return null;
  const latitude = /^(S|South)$/i.test(exif.GPSLatitudeRef ?? '') ? -Math.abs(exif.GPSLatitude) : exif.GPSLatitude;
  const longitude = /^(W|West)$/i.test(exif.GPSLongitudeRef ?? '') ? -Math.abs(exif.GPSLongitude) : exif.GPSLongitude;
  const location = { latitude, longitude };
  return validLocation(location) ? location : null;
}
export function unit(value: unknown, suffix: string): string {
  if (value == null || value === '' || typeof value === 'number' && !Number.isFinite(value)) return '';
  const text = String(value).trim();
  return /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:\/\d+(?:\.\d+)?)?$/.test(text) ? `${text} ${suffix}` : text;
}
export function aperture(value: number | undefined): string { return value != null && Number.isFinite(value) && value > 0 ? `ƒ/${value}` : ''; }
export function altitude(exif: Exif): string {
  const value = exif?.GPSAltitude;
  if (typeof value !== 'number' || !Number.isFinite(value)) return unit(value, 'm');
  const below = /below/i.test(String(exif?.GPSAltitudeRef)) || Number(exif?.GPSAltitudeRef) === 1;
  return unit(below ? -Math.abs(value) : value, 'm');
}
