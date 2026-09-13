// Adapted from Afilmory/Afilmory, apps/web/src/modules/map/MapSection.tsx
// 1f65cde6672e5231599182620116ac904e39f548; AGPL-3.0-or-later + ANL §4. See THIRD_PARTY_NOTICES.md.
import { validLocation } from '../viewer/metadata';
import type { ViewerPhoto } from '../viewer/photos';

export interface MapViewport { center: [number, number]; zoom: number; bearing: number; pitch: number }

export function resolveMapPhoto(photos: readonly ViewerPhoto[], id: string | null) {
  return photos.find(photo => photo.id === id && validLocation(photo.location)) ?? null;
}

export function mapPhotoViewport(photo: ViewerPhoto | null): MapViewport | undefined {
  if (!photo?.location || !validLocation(photo.location)) return undefined;
  return { center: [photo.location.longitude, photo.location.latitude], zoom: 15, bearing: 0, pitch: 0 };
}

export function mapPhotoURL(current: URL, id: string): URL {
  const url = new URL(current);
  url.searchParams.delete('photo');
  url.searchParams.set('panel', 'map');
  url.searchParams.set('mapPhoto', id);
  return url;
}
