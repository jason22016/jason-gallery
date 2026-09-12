import type { PhotoManifestItem } from '../../photo-engine';
import type { ResolvedProject } from '../../projects';
import { aperture, unit } from '../viewer/metadata';
import { viewerPhotos, type ViewerPhoto } from '../viewer/photos';

export interface GalleryPhoto extends ViewerPhoto {
  readonly aspectRatio: number;
  readonly video?: PhotoManifestItem['video'];
  readonly capture: { focalLength: string; aperture: string; shutter: string; iso: string };
}

export function galleryPhotos(project: ResolvedProject): readonly GalleryPhoto[] {
  return viewerPhotos(project).map((photo, index) => {
    const source = project.photos[index]!.photo;
    const exif = source.exif;
    return {
      ...photo,
      aspectRatio: Number.isFinite(source.aspectRatio) && source.aspectRatio > 0 ? source.aspectRatio : photo.width / photo.height,
      video: source.video,
      capture: {
        focalLength: unit(exif?.FocalLengthIn35mmFormat || exif?.FocalLength, 'mm'),
        aperture: aperture(exif?.FNumber),
        shutter: unit(exif?.ExposureTime, 's'),
        iso: exif?.ISO ? `ISO ${exif.ISO}` : '',
      },
    };
  });
}

export interface GalleryItem {
  photo: GalleryPhoto;
  index: number;
  onOpen: (photo: ViewerPhoto, element: HTMLElement | null) => void;
}
