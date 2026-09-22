import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GalleryPhoto } from '../../src/components/gallery/photos';
import { mapSemanticResults, nextSemanticResultLevel, selectSemanticResults } from '../../src/components/gallery/semantic-results';
import { semanticQuerySuggestions } from '../../src/components/gallery/semantic-suggestions';

const photo = (id: string, publicId?: string) => ({ id, publicId, title: id } as GalleryPhoto);

test('semantic UI mapping preserves model rank and ignores unknown or duplicate public IDs', () => {
  const photos = [photo('internal-a', 'AAAAAAAAAAAAAAAA'), photo('internal-b', 'BBBBBBBBBBBBBBBB'), photo('no-public-id')];
  const mapped = mapSemanticResults(photos, [
    { publicId: 'BBBBBBBBBBBBBBBB', score: .92, rank: 1 },
    { publicId: 'UNKNOWN000000000', score: .88, rank: 2 },
    { publicId: 'AAAAAAAAAAAAAAAA', score: .83, rank: 3 },
    { publicId: 'BBBBBBBBBBBBBBBB', score: .8, rank: 4 },
  ]);
  assert.deepEqual(mapped.map(result => ({ id: result.photo.id, rank: result.rank, score: result.score })), [
    { id: 'internal-b', rank: 1, score: .92 },
    { id: 'internal-a', rank: 3, score: .83 },
  ]);
});

test('semantic result levels include threshold boundaries, preserve ranking and recover all candidates', () => {
  const scores = [.1, .07, .069999, .05, .049999, .03, .029999, -.01];
  const results = scores.map((score, index) => ({ photo: photo(`photo-${index}`), publicId: String(index), score, rank: index + 1 }));
  const before = structuredClone(results);
  assert.deepEqual(selectSemanticResults(results).map(result => result.rank), [1, 2]);
  assert.deepEqual(selectSemanticResults(results, 1).map(result => result.rank), [1, 2, 3, 4]);
  assert.deepEqual(selectSemanticResults(results, 2).map(result => result.rank), [1, 2, 3, 4, 5, 6]);
  assert.equal(selectSemanticResults(results, 3), results);
  assert.deepEqual(selectSemanticResults(results.slice(6)), [], 'weak matches must not fill a minimum result count');
  assert.deepEqual(results, before, 'filtering never discards the stored original candidates');
});

test('semantic suggestions are curated, deterministic, locale-ready, and contain no runtime generation path', () => {
  const chinese = semanticQuerySuggestions('zh-CN');
  assert.deepEqual(chinese.map(item => item.query), ['雾中的雪山', '夜晚的古镇', '森林里的动物', '金色日落', '岩石间的急流']);
  assert.equal(semanticQuerySuggestions('zh-CN'), chinese);
  assert.equal(semanticQuerySuggestions('en-US')[0]!.query, 'Misty snow mountains');
  assert.equal(semanticQuerySuggestions('unsupported'), chinese);
  assert.equal(new Set(chinese.map(item => item.id)).size, chinese.length);
});

test('semantic expansion skips score bands that add no photos and stops when all candidates are visible', () => {
  const results = [.12, .08, .04, .03, -.01].map((score, index) => ({ photo: photo(String(index)), publicId: String(index), score, rank: index + 1 }));
  assert.equal(nextSemanticResultLevel(results, 0), 2);
  assert.equal(nextSemanticResultLevel(results, 2), 3);
  assert.equal(nextSemanticResultLevel(results, 3), null);
  assert.equal(nextSemanticResultLevel(results.slice(0, 2), 0), null);
  assert.equal(nextSemanticResultLevel([], 0), null);
  assert.equal(nextSemanticResultLevel(results.slice(-1), 0), 3);
  assert.equal(nextSemanticResultLevel(results.slice(2), 0), 2);
});
