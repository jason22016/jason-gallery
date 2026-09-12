import type { PhotoManifestItem } from '../../src/photo-engine';
import type { PhotoSource } from '../../src/photo-engine/source-schema';
import type { Project } from '../../src/projects/schema';

/** Fixture transport projection, not a second photo metadata contract. */
export interface PreviewPhoto {
  sourceId: string;
  photo: Pick<PhotoManifestItem, 'id' | 'title' | 'thumbnailUrl' | 'width' | 'height'>;
}
export interface PreviewData { photos: PreviewPhoto[]; sources: PhotoSource[]; projects: Project[]; imageMode: string }

/** Resolve legacy references before computing membership, including draft Projects. */
export function projectMembership(projects: Project[], aliases: Record<string, string> = {}) {
  const membership = new Map<string, Set<string>>();
  for (const project of projects) for (const { photoId } of project.photos) {
    const id = aliases[photoId] ?? photoId;
    if (!membership.has(id)) membership.set(id, new Set());
    membership.get(id)!.add(project.id);
  }
  return membership;
}

const filenameOrder = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
export function sortProjectPhotos(refs: Project['photos'], photos: PreviewPhoto[], direction: 'asc' | 'desc', aliases: Record<string, string> = {}) {
  const titles = new Map(photos.map(p => [p.photo.id, p.photo.title]));
  const name = (id: string) => titles.get(aliases[id] ?? id) || id;
  // Copy the array while retaining captions, alt text, and original references.
  return [...refs].sort((a, b) => (direction === 'asc' ? 1 : -1) * filenameOrder.compare(name(a.photoId), name(b.photoId)));
}

export function appendProjectPhotos(refs: Project['photos'], ids: string[], aliases: Record<string, string> = {}) {
  const present = new Set(refs.map(p => aliases[p.photoId] ?? p.photoId));
  const additions = ids.filter(id => {
    const canonical = aliases[id] ?? id;
    if (present.has(canonical)) return false;
    present.add(canonical); return true;
  }).map(photoId => ({ photoId }));
  return [...refs, ...additions];
}
