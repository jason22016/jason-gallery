import PhotoGallery from './PhotoGallery';
import type { GalleryPhoto } from './photos';
import type { GalleryProject } from '../viewer/photos';

export default function ProjectGallery({ photos, project }: { photos: readonly GalleryPhoto[]; project: GalleryProject }) {
  return <PhotoGallery photos={photos} title={project.title} project={project} />;
}
