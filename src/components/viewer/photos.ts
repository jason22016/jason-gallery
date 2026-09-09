import type { ResolvedProject } from '../../projects';
import type { PhotoManifestItem } from '../../photo-engine';

/** Public, project-scoped display data; never serialize the full engine manifest. */
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
    date: photo.exif?.DateTimeOriginal || photo.dateTaken, tags: [...new Set([...photo.tags, ...photo.keywords])],
    camera: [photo.exif?.Make, photo.exif?.Model].filter(Boolean).join(' '), lens: photo.exif?.LensModel ?? '',
    exposure: [photo.exif?.FocalLengthIn35mmFormat || photo.exif?.FocalLength, photo.exif?.FNumber ? `ƒ/${photo.exif.FNumber}` : '', photo.exif?.ExposureTime ? `${photo.exif.ExposureTime}s` : '', photo.exif?.ISO ? `ISO ${photo.exif.ISO}` : ''].filter(Boolean).map(String),
    format: photo.format, size: photo.size, location: photo.location,
    detailsUrl: `/projects/${project.slug}/photos/${encodeURIComponent(photoId)}.json`, isHDR: photo.isHDR ?? false,
  }));
}
export const emptyFilters = { query: '', start: '', end: '', camera: '', lens: '', tag: '' };
export type Filters = typeof emptyFilters;
export type Sort = 'project' | 'asc' | 'desc';
export function selectPhotos(photos: readonly ViewerPhoto[], filters: Filters, sort: Sort): ViewerPhoto[] {
  const words = filters.query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const result = photos.filter(p => {
    const text = [p.title, p.filename, p.description, p.caption, ...p.tags].join(' ').toLocaleLowerCase();
    const day = p.date?.slice(0, 10);
    return words.every(w => text.includes(w)) && (!filters.camera || filters.camera === p.camera)
      && (!filters.lens || filters.lens === p.lens) && (!filters.tag || p.tags.includes(filters.tag))
      && (!filters.start || (!!day && day >= filters.start)) && (!filters.end || (!!day && day <= filters.end));
  });
  if (sort !== 'project') result.sort((a, b) => {
    const left = Date.parse(a.date), right = Date.parse(b.date);
    if (!Number.isFinite(left)) return Number.isFinite(right) ? 1 : 0;
    if (!Number.isFinite(right)) return -1;
    return (left - right) * (sort === 'asc' ? 1 : -1);
  });
  return result;
}
export const formatBytes = (size: number) => size >= 1048576 ? `${(size / 1048576).toFixed(1)} MB` : `${Math.round(size / 1024)} KB`;
