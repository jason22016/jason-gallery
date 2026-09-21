import type { SemanticSearchResult } from '../../semantic-search/types';
import type { GalleryPhoto } from './photos';

export interface MappedSemanticResult {
  readonly photo: GalleryPhoto;
  readonly publicId: string;
  readonly score: number;
  readonly rank: number;
}

/** Preserve model rank exactly while dropping stale, unknown, or duplicate public IDs. */
export function mapSemanticResults(
  photos: readonly GalleryPhoto[],
  results: readonly SemanticSearchResult[],
): MappedSemanticResult[] {
  const byPublicId = new Map(photos.flatMap(photo => photo.publicId ? [[photo.publicId, photo] as const] : []));
  const seen = new Set<string>();
  const mapped: MappedSemanticResult[] = [];
  for (const result of results) {
    if (seen.has(result.publicId)) continue;
    const photo = byPublicId.get(result.publicId);
    if (!photo) continue;
    seen.add(result.publicId);
    mapped.push({ photo, publicId: result.publicId, score: result.score, rank: result.rank });
  }
  return mapped;
}
