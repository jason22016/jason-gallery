import type { PhotoManifestItem } from '../../src/photo-engine';
import type { PhotoSource } from '../../src/photo-engine/source-schema';
import type { Project } from '../../src/projects/schema';

/** Fixture transport projection, not a second photo metadata contract. */
export interface PreviewPhoto {
  sourceId: string;
  photo: Pick<PhotoManifestItem, 'id' | 'title' | 'thumbnailUrl' | 'width' | 'height'>;
}
export interface PreviewData { photos: PreviewPhoto[]; sources: PhotoSource[]; projects: Project[]; imageMode: string }
