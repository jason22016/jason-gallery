import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGalleryPositioner } from '../../src/components/gallery/masonry-positioner';

// Actual dimensions of the first 14 results for 云南 / 鸟, in model rank order.
const birdDimensions = [
  [6016, 4016], [6016, 4016], [5300, 3538], [4354, 2907], [4828, 3223],
  [3500, 2336], [5598, 3737], [6016, 4016], [6016, 4016], [4092, 2732],
  [6016, 4016], [6016, 4016], [6016, 4016], [6016, 4016],
] as const;

test('near-equal photo heights fill rows in rank order without interior holes at every column width', () => {
  for (let columns = 2; columns <= 8; columns++) {
    for (let width = 120; width <= 500; width++) {
      const positioner = createGalleryPositioner(columns, width, 4, 4);
      birdDimensions.forEach(([w, h], index) => positioner.set(index, width * h / w));
      assert.deepEqual(positioner.all().map(item => item.column), birdDimensions.map((_, index) => index % columns), `${columns} columns of ${width}px`);
      positioner.all().forEach((item, index) => {
        assert.equal(item.height, width * birdDimensions[index]![1] / birdDimensions[index]![0], 'retain the actual aspect ratio');
        if (index >= columns) {
          const above = positioner.get(index - columns)!;
          assert.equal(item.top, above.top + above.height + 4, 'no overlap or oversized vertical gap');
        }
      });
    }
  }
});

test('masonry still fills genuinely shorter columns and the viewport range stays accurate after size updates', () => {
  const positioner = createGalleryPositioner(3, 200, 4, 4);
  [400, 100, 200, 100, 90, 150].forEach((height, index) => positioner.set(index, height));
  assert.deepEqual(positioner.all().map(item => item.column), [0, 1, 2, 1, 2, 1]);
  const checkRange = () => {
    const found: number[] = [];
    positioner.range(210, 310, index => found.push(index));
    assert.deepEqual(found.sort((a, b) => a - b), positioner.all().flatMap((item, index) => item.top <= 310 && item.top + item.height >= 210 ? [index] : []));
    assert.equal(positioner.size(), 6);
    assert.equal(positioner.estimateHeight(6, 400), Math.max(...positioner.all().map(item => item.top + item.height + 4)));
  };
  checkRange();
  positioner.update([0, 150, 3, 180]);
  assert.equal(positioner.get(0)!.height, 150);
  assert.equal(positioner.get(3)!.height, 180);
  checkRange();
});
