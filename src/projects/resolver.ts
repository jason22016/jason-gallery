import type { loadPhotoIndex, PhotoManifestItem } from '../photo-engine/index';
import { ProjectSchema, type Project } from './schema';

export type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;
export type ResolvedProject = DeepReadonly<Omit<Project, 'photos'> & {
  cover: PhotoManifestItem;
  photos: Array<Project['photos'][number] & { photo: PhotoManifestItem }>;
}>;

/** A snapshot. Neither collections nor nested Project/photo values can be mutated. */
export interface ProjectIndex {
  listProjects(): readonly ResolvedProject[];
  getProject(id: string): ResolvedProject | undefined;
  getProjectBySlug(slug: string): ResolvedProject | undefined;
}

/** Build/editor access only. Public consumers use loadProjects(). */
export interface ProjectCatalog {
  readonly published: ProjectIndex;
  readonly drafts: ProjectIndex;
}

export interface ProjectSource {
  readonly source: string;
  readonly data: unknown;
  /** File loaders enforce <slug>.json; in-memory fixtures need no filename. */
  readonly expectedSlug?: string;
}

function freezeDeep<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

function createIndex(projects: ResolvedProject[]): ProjectIndex {
  projects.sort((a, b) => a.order < b.order ? -1 : a.order > b.order ? 1 : a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);
  const list = Object.freeze(projects);
  const byId = new Map(list.map(project => [project.id, project]));
  const bySlug = new Map(list.map(project => [project.slug, project]));
  return Object.freeze({
    listProjects: () => list,
    getProject: (id: string) => byId.get(id),
    getProjectBySlug: (slug: string) => bySlug.get(slug),
  });
}

/** Validate every source before exposing either status; errors never silently drop photos. */
export function resolveProjects(
  sources: readonly ProjectSource[],
  photoIndex: Pick<ReturnType<typeof loadPhotoIndex>, 'getPhoto'>,
): ProjectCatalog {
  const ids = new Map<string, string>();
  const slugs = new Map<string, string>();
  const projects = sources.map(({ source, data, expectedSlug }) => {
    const result = ProjectSchema.safeParse(data);
    if (!result.success) {
      throw new Error(`Invalid Project ${source}:\n${result.error.issues.map(issue => `  ${issue.path.join('.') || '<root>'}: ${issue.message}`).join('\n')}`);
    }
    const project = result.data;
    if (expectedSlug !== undefined && project.slug !== expectedSlug) {
      throw new Error(`Invalid Project ${source}: slug "${project.slug}" must match filename "${expectedSlug}.json"`);
    }
    for (const [field, seen] of [['id', ids], ['slug', slugs]] as const) {
      if (seen.has(project[field])) {
        throw new Error(`Invalid Project ${source}: duplicate Project ${field} "${project[field]}" (also in ${seen.get(project[field])})`);
      }
      seen.set(project[field], source);
    }
    return { source, project };
  });

  const resolved = projects.map(({ source, project }) => {
    const photos = project.photos.map((reference, index) => {
      const photo = photoIndex.getPhoto(reference.photoId);
      if (!photo) throw new Error(`Invalid Project ${source}: photos.${index}.photoId: unknown photo ID "${reference.photoId}"`);
      // Own a detached snapshot; never freeze or modify values owned by the Photo Engine.
      return { ...reference, photo: structuredClone(photo) };
    });
    const cover = photos.find(entry => entry.photoId === project.coverPhotoId)!.photo;
    return freezeDeep({ ...project, photos, cover });
  });

  return Object.freeze({
    published: createIndex(resolved.filter(project => project.status === 'published')),
    drafts: createIndex(resolved.filter(project => project.status === 'draft')),
  });
}
