// Server/build entry. Browser consumers receive only the GalleryPhoto projection.
import { loadProjects, type DeepReadonly, type ProjectIndex, type ProjectLoadOptions, type ResolvedProject } from '../projects';
import { compareProjectOrder } from '../projects/order';
import { freezeDeep } from '../projects/resolver';
import { galleryPhotos, type GalleryPhoto, type GalleryProjectMembership } from '../components/gallery/photos';
import type { PhotoDetails } from '../components/viewer/photos';
import { projectPhotoDetails } from './photo-details';
import { indexPublicPhotoIds, shortPublicPhotoId } from './public-photo-id';

export type PublicGlobalPhoto = DeepReadonly<GalleryPhoto & {
  publicId: string;
  sharePath: string;
  projects: readonly GalleryProjectMembership[];
}>;
export type PublicPhotoPage = DeepReadonly<{
  publicId: string;
  path: string;
  title: string;
  caption: string;
  image: { path: string; alt: string; width: number; height: number };
  date: string;
  camera: string;
  lens: string;
  primaryProject: GalleryProjectMembership;
  viewerHref: string;
}>;
export interface PublicPhotoCollection {
  listPhotos(): readonly PublicGlobalPhoto[];
  getPhoto(id: string): PublicGlobalPhoto | undefined;
  getPhotoByPublicId(publicId: string): PublicGlobalPhoto | undefined;
  getPhotoPage(publicId: string): PublicPhotoPage | undefined;
  getPhotoDetails(id: string): DeepReadonly<PhotoDetails> | undefined;
}

/** Membership comes exclusively from published Projects, never from a Manifest scan. */
export function resolvePublicPhotoCollection(index: Pick<ProjectIndex, 'listProjects'>): PublicPhotoCollection {
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
  const photos = freezeDeep([...entries.values()].map(({ photo, projects }) => {
    const publicId = shortPublicPhotoId(photo.id);
    return { ...photo, projects, publicId, sharePath: `/photos/${publicId}/` };
  }));
  const byId = new Map(photos.map(photo => [photo.id, photo]));
  const byPublicId = indexPublicPhotoIds(photos);
  return Object.freeze({
    listPhotos: () => photos,
    getPhoto: (id: string) => byId.get(id),
    getPhotoByPublicId: (publicId: string) => byPublicId.get(publicId),
    getPhotoPage: (publicId: string) => {
      const photo = byPublicId.get(publicId);
      if (!photo) return undefined;
      const primaryProject = photo.projects[0]!;
      // Viewer titles may fall back to filenames; an empty editorial title stays empty here.
      const title = entries.get(photo.id)!.project.photos.find(entry => entry.photoId === photo.id)!.photo.title.trim();
      if (!/\.jpe?g$/i.test(photo.thumbnail.split(/[?#]/)[0]!)) throw new Error(`Public photo page requires a JPEG thumbnail: ${publicId}`);
      return freezeDeep({
        publicId, path: photo.sharePath, title, caption: photo.caption?.trim() || photo.description.trim(),
        image: { path: photo.thumbnail, alt: photo.alt.trim() || title || primaryProject.title, width: photo.width, height: photo.height },
        date: photo.date, camera: photo.camera.trim(), lens: photo.lens.trim(), primaryProject,
        viewerHref: `/projects/${primaryProject.slug}/?photo=${encodeURIComponent(photo.id)}`,
      });
    },
    getPhotoDetails: (id: string) => {
      const project = entries.get(id)?.project;
      return project ? freezeDeep(projectPhotoDetails(project, id)) : undefined;
    },
  });
}

export function loadPublicPhotoCollection(options: ProjectLoadOptions = {}): PublicPhotoCollection {
  return resolvePublicPhotoCollection(loadProjects(options));
}
