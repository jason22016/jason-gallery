import type { PhotoManifestItem } from '../../photo-engine';
import type { ResolvedProject } from '../../projects';
import { aperture, unit } from '../viewer/metadata';
import { viewerPhotos, type ViewerPhoto } from '../viewer/photos';

export type GalleryProjectMembership = Pick<ResolvedProject, 'id' | 'slug' | 'title'>;
type Video = NonNullable<PhotoManifestItem['video']>;
type GalleryVideo = Pick<Extract<Video, { type: 'live-photo' }>, 'type' | 'videoUrl'>
  | Pick<Extract<Video, { type: 'motion-photo' }>, 'type' | 'offset' | 'size' | 'presentationTimestamp'>;

export interface GalleryPhoto extends ViewerPhoto {
  /** Stable public semantic-index identity; present on the Public Global Photo Collection. */
  readonly publicId?: string;
  readonly projects?: readonly GalleryProjectMembership[];
  readonly aspectRatio: number;
  readonly video?: GalleryVideo;
  readonly capture: { focalLength: string; aperture: string; shutter: string; iso: string; exposureBias?: string };
}

export function galleryPhotos(project: ResolvedProject): readonly GalleryPhoto[] {
  const projects = [{ id: project.id, slug: project.slug, title: project.title }];
  return viewerPhotos(project).map((photo, index) => {
    const source = project.photos[index]!.photo;
    const exif = source.exif;
    const video = source.video;
    return {
      ...photo,
      projects,
      aspectRatio: Number.isFinite(source.aspectRatio) && source.aspectRatio > 0 ? source.aspectRatio : photo.width / photo.height,
      video: video?.type === 'live-photo' ? { type: video.type, videoUrl: video.videoUrl }
        : video ? { type: video.type, offset: video.offset, size: video.size, presentationTimestamp: video.presentationTimestamp } : undefined,
      capture: {
        focalLength: unit(exif?.FocalLengthIn35mmFormat || exif?.FocalLength, 'mm'),
        aperture: aperture(exif?.FNumber),
        shutter: unit(exif?.ExposureTime, 's'),
        iso: exif?.ISO ? `ISO ${exif.ISO}` : '',
        exposureBias: unit(exif?.ExposureCompensation, 'EV'),
      },
    };
  });
}

export interface GalleryItem {
  photo: GalleryPhoto;
  index: number;
  onOpen: (photo: ViewerPhoto, element: HTMLElement | null) => void;
}
