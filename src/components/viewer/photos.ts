import type { ResolvedProject } from '../../projects';

/** Transient UI props only. Never serialize the full Photo Manifest into an island. */
export interface ViewerPhoto {
  readonly id: string;
  readonly src: string;
  readonly width: number;
  readonly height: number;
  readonly alt: string;
  readonly caption?: string;
  readonly isHDR: boolean;
}

export function viewerPhotos(project: ResolvedProject): readonly ViewerPhoto[] {
  return project.photos.map(({ photoId, photo, alt, caption }, index) => ({
    id: photoId, src: photo.originalUrl, width: photo.width, height: photo.height,
    alt: alt ?? `${project.title} — photograph ${index + 1}`, caption, isHDR: photo.isHDR ?? false,
  }));
}
