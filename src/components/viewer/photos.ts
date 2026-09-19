import { aperture, captureDate, numericAltitude, photoLocation, unit } from './metadata';
import type { ResolvedProject } from '../../projects';
import type { PhotoManifestItem } from '../../photo-engine';

/** Public display data for the current collection; never serialize the full engine manifest. */
export interface ViewerPhoto {
  readonly id: string;
  readonly src: string;
  readonly thumbnail: string;
  readonly thumbHash: string | null;
  readonly width: number;
  readonly height: number;
  readonly alt: string;
  readonly caption?: string;
  readonly title: string;
  readonly filename: string;
  readonly description: string;
  readonly date: string;
  readonly tags: readonly string[];
  readonly camera: string;
  readonly lens: string;
  readonly exposure: readonly string[];
  readonly format: string;
  readonly size: number;
  readonly location: PhotoManifestItem['location'];
  readonly altitude?: number;
  readonly detailsUrl: string;
  readonly isHDR: boolean;
}
export interface PhotoDetails {
  exif: Partial<NonNullable<PhotoManifestItem['exif']>> | null;
  toneAnalysis: PhotoManifestItem['toneAnalysis'];
}
export type GalleryProject = Pick<ResolvedProject, 'title' | 'slug' | 'summary' | 'description' | 'location' | 'period' | 'tags'>;
export function viewerPhotos(project: ResolvedProject): readonly ViewerPhoto[] {
  return project.photos.map(({ photoId, photo, alt, caption }, index) => ({
    id: photoId, src: photo.originalUrl, thumbnail: photo.thumbnailUrl, thumbHash: photo.thumbHash,
    width: photo.width, height: photo.height, alt: alt ?? `${project.title} — photograph ${index + 1}`,
    title: photo.title || photo.s3Key.split('/').at(-1) || photoId,
    filename: photo.s3Key.split('/').at(-1) || photoId, caption, description: photo.description,
    date: captureDate(photo.exif), tags: [...new Set([...photo.tags, ...photo.keywords])],
    camera: [photo.exif?.Make, photo.exif?.Model].filter(Boolean).join(' '), lens: photo.exif?.LensModel ?? '',
    exposure: [unit(photo.exif?.FocalLength, 'mm') || (photo.exif?.FocalLengthIn35mmFormat ? `${unit(photo.exif.FocalLengthIn35mmFormat, 'mm')}（35mm 等效）` : ''), aperture(photo.exif?.FNumber), unit(photo.exif?.ExposureTime, 's'), photo.exif?.ISO ? `ISO ${photo.exif.ISO}` : ''].filter(Boolean),
    format: photo.format, size: photo.size, location: photoLocation(photo), altitude: numericAltitude(photo.exif),
    detailsUrl: `/projects/${project.slug}/photos/${encodeURIComponent(photoId)}.json`, isHDR: photo.isHDR ?? false,
  }));
}
export { emptyFilters, selectPhotos, type Filters, type Sort } from '../gallery/filters';
export const formatBytes = (size: number) => size >= 1048576 ? `${(size / 1048576).toFixed(1)} MiB` : `${Math.round(size / 1024)} KiB`;
