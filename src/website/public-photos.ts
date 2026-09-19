// Server/build entry. Browser consumers receive only the GalleryPhoto projection.
import { loadProjects, type DeepReadonly, type ProjectIndex, type ProjectLoadOptions, type ResolvedProject } from '../projects';
import { compareProjectOrder } from '../projects/order';
import { freezeDeep } from '../projects/resolver';
import { galleryPhotos, type GalleryPhoto, type GalleryProjectMembership } from '../components/gallery/photos';
import type { PhotoDetails } from '../components/viewer/photos';
import { projectPhotoDetails } from './photo-details';

export type PublicGlobalPhoto = DeepReadonly<GalleryPhoto & { projects: readonly GalleryProjectMembership[] }>;
export interface PublicPhotoCollection {
  listPhotos(): readonly PublicGlobalPhoto[];
  getPhoto(id: string): PublicGlobalPhoto | undefined;
  getPhotoDetails(id: string): DeepReadonly<PhotoDetails> | undefined;
}

/** Membership comes exclusively from published Projects, never from a Manifest scan. */
export function resolvePublicPhotoCollection(index: ProjectIndex): PublicPhotoCollection {
  const entries = new Map<string, { photo: GalleryPhoto; projects: GalleryProjectMembership[]; project: ResolvedProject }>();
  for (const project of [...index.listProjects()].filter(project => project.status === 'published').sort(compareProjectOrder)) {
    const membership = { id: project.id, slug: project.slug, title: project.title };
    for (const photo of galleryPhotos(project)) {
      const existing = entries.get(photo.id);
      if (existing) existing.projects.push(membership);
      else entries.set(photo.id, { photo, projects: [membership], project });
    }
  }
  // First published membership supplies project-local alt/caption and its existing detail URL.
  const photos = freezeDeep([...entries.values()].map(({ photo, projects }) => ({ ...photo, projects })));
  const byId = new Map(photos.map(photo => [photo.id, photo]));
  return Object.freeze({
    listPhotos: () => photos,
    getPhoto: (id: string) => byId.get(id),
    getPhotoDetails: (id: string) => {
      const project = entries.get(id)?.project;
      return project ? freezeDeep(projectPhotoDetails(project, id)) : undefined;
    },
  });
}

export function loadPublicPhotoCollection(options: ProjectLoadOptions = {}): PublicPhotoCollection {
  return resolvePublicPhotoCollection(loadProjects(options));
}
