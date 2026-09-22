import type { SemanticSearchResult } from '../../semantic-search/types';
import type { GalleryPhoto } from './photos';

export interface MappedSemanticResult {
  readonly photo: GalleryPhoto;
  readonly publicId: string;
  readonly score: number;
  readonly rank: number;
}

// Every query uses the same progressive cutoffs for the current SigLIP2 release.
// The last level restores the original candidates without another inference.
export const SEMANTIC_RESULT_LEVELS = [0.07, 0.05, 0.03, -Infinity] as const;
export const semanticResultLabels = ['较相关的结果', '更多结果', '更广范围的结果', '全部候选结果'] as const;

export function selectSemanticResults(
  results: readonly MappedSemanticResult[],
  level = 0,
): readonly MappedSemanticResult[] {
  const minimumScore = SEMANTIC_RESULT_LEVELS[level] ?? SEMANTIC_RESULT_LEVELS[0];
  return minimumScore === -Infinity ? results : results.filter(result => result.score >= minimumScore);
}

/** Skip empty score bands so every available expansion reveals more photos. */
export function nextSemanticResultLevel(results: readonly MappedSemanticResult[], level: number): number | null {
  const count = selectSemanticResults(results, level).length;
  for (let next = level + 1; next < SEMANTIC_RESULT_LEVELS.length; next++) {
    if (selectSemanticResults(results, next).length > count) return next;
  }
  return null;
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
