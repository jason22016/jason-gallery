import { validLocation } from '../../viewer/metadata';
import type { ViewerPhoto } from '../../viewer/photos';

export interface MapBounds { minLat: number; maxLat: number; minLng: number; maxLng: number }

export function calculateMapBounds(photos: readonly Pick<ViewerPhoto, 'location'>[]): MapBounds | null {
  const locations = photos.flatMap(photo => validLocation(photo.location) ? [photo.location!] : []);
  if (!locations.length) return null;
  const latitudes = locations.map(location => location.latitude);
  const longitudes = locations.map(location => location.longitude);
  return { minLat: Math.min(...latitudes), maxLat: Math.max(...latitudes), minLng: Math.min(...longitudes), maxLng: Math.max(...longitudes) };
}

export function approximateCoverage(bounds: MapBounds): string {
  return Math.abs((bounds.maxLat - bounds.minLat) * (bounds.maxLng - bounds.minLng) * 111 * 111).toFixed(1);
}
