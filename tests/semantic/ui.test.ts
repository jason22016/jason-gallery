import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GalleryPhoto } from '../../src/components/gallery/photos';
import { mapSemanticResults } from '../../src/components/gallery/semantic-results';
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

test('semantic suggestions are curated, deterministic, locale-ready, and contain no runtime generation path', () => {
  const chinese = semanticQuerySuggestions('zh-CN');
  assert.deepEqual(chinese.map(item => item.query), ['雾中的雪山', '夜晚的古镇', '森林里的动物', '金色日落', '岩石间的急流']);
  assert.equal(semanticQuerySuggestions('zh-CN'), chinese);
  assert.equal(semanticQuerySuggestions('en-US')[0]!.query, 'Misty snow mountains');
  assert.equal(semanticQuerySuggestions('unsupported'), chinese);
  assert.equal(new Set(chinese.map(item => item.id)).size, chinese.length);
});
