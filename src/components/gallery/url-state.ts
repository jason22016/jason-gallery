import { emptyFilters, type Filters, type GalleryState } from './filters';

const filterKeys = Object.keys(emptyFilters) as (keyof Filters)[];

export function readGalleryState(params: URLSearchParams): GalleryState {
  const filters = { ...emptyFilters };
  for (const key of filterKeys) filters[key] = params.get(key) || '';
  const sort = params.get('sort');
  return { filters, sort: sort === 'asc' || sort === 'desc' ? sort : 'project' };
}

/** Update only the shared filters/sort; the caller owns Viewer, Map and history state. */
export function galleryStateURL(current: URL, { filters, sort }: GalleryState): URL {
  const url = new URL(current);
  for (const key of filterKeys) {
    if (filters[key]) url.searchParams.set(key, filters[key]); else url.searchParams.delete(key);
  }
  if (sort !== 'project') url.searchParams.set('sort', sort); else url.searchParams.delete('sort');
  return url;
}
