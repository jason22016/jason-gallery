import type { ViewerPhoto } from '../viewer/photos';
import type { GalleryPhoto } from './photos';

export const emptyFilters = { query: '', project: '', start: '', end: '', camera: '', lens: '', tag: '' };
export type Filters = typeof emptyFilters;
/** `project` retains the supplied collection order, including for global collections. */
export type Sort = 'project' | 'asc' | 'desc';
export interface GalleryState { filters: Filters; sort: Sort }
type FilterablePhoto = ViewerPhoto & Pick<GalleryPhoto, 'projects'>;
export type FilterField = 'project' | 'camera' | 'lens' | 'tag';
export interface FilterOption { field: FilterField; value: string; label: string; count: number }

export function selectPhotos<T extends FilterablePhoto>(photos: readonly T[], filters: Filters, sort: Sort): T[] {
  const words = filters.query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const result = photos.filter(p => {
    const text = [p.title, p.filename, p.description, p.caption, ...p.tags].join(' ').toLocaleLowerCase();
    const day = p.date?.slice(0, 10);
    return words.every(w => text.includes(w)) && (!filters.project || p.projects?.some(project => project.id === filters.project))
      && (!filters.camera || filters.camera === p.camera)
      && (!filters.lens || filters.lens === p.lens) && (!filters.tag || p.tags.includes(filters.tag))
      && (!filters.start || (!!day && day >= filters.start)) && (!filters.end || (!!day && day <= filters.end));
  });
  if (sort !== 'project') result.sort((a, b) => {
    // Unzoned EXIF is ordered by its recorded wall clock, independent of the browser zone.
    const time = (value: string) => Date.parse(value && !/(Z|[+-]\d{2}:\d{2})$/.test(value) ? `${value}Z` : value);
    const left = time(a.date), right = time(b.date);
    if (!Number.isFinite(left)) return Number.isFinite(right) ? 1 : 0;
    if (!Number.isFinite(right)) return -1;
    return (left - right) * (sort === 'asc' ? 1 : -1);
  });
  return result;
}

export function galleryFilterOptions(photos: readonly FilterablePhoto[], fields: readonly FilterField[] = ['camera', 'lens', 'tag']): FilterOption[] {
  return fields.flatMap(field => {
    const options = new Map<string, FilterOption>();
    for (const photo of photos) {
      const values = field === 'project' ? (photo.projects ?? []).map(project => [project.id, project.title] as const)
        : (field === 'tag' ? photo.tags : [photo[field]]).map(value => [value, value] as const);
      for (const [value, label] of new Map(values)) {
        if (!value) continue;
        const option = options.get(value);
        if (option) option.count++;
        else options.set(value, { field, value, label, count: 1 });
      }
    }
    return [...options.values()].sort((a, b) => a.label < b.label ? -1 : a.label > b.label ? 1 : a.value < b.value ? -1 : a.value > b.value ? 1 : 0);
  });
}
