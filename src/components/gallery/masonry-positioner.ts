import { createIntervalTree, type Positioner, type PositionerItem } from 'masonic';

/** Keep visually level columns in reading order despite subpixel aspect-ratio differences. */
export function createGalleryPositioner(
  columnCount: number,
  columnWidth: number,
  columnGutter: number,
  rowGutter: number,
): Positioner {
  let tree = createIntervalTree();
  const items: PositionerItem[] = [];
  const columnHeights = Array<number>(columnCount).fill(0);
  const set = (index: number, height = 0) => {
    const shortest = Math.min(...columnHeights);
    // A fraction of a pixel must not move the next ranked photo past an empty
    // column. Keep exact image heights; only treat near-equal column bottoms as ties.
    const column = columnHeights.findIndex(bottom => bottom <= shortest + 1);
    const top = columnHeights[column]!;
    items[index] = { left: column * (columnWidth + columnGutter), top, height, column };
    columnHeights[column] = top + height + rowGutter;
    tree.insert(top, top + height, index);
  };
  return {
    columnCount,
    columnWidth,
    set,
    get: index => items[index],
    update: updates => {
      for (let i = 0; i < updates.length; i += 2) items[updates[i]!]!.height = updates[i + 1]!;
      const heights = items.map(item => item.height);
      tree = createIntervalTree();
      items.length = 0;
      columnHeights.fill(0);
      heights.forEach((height, index) => set(index, height));
    },
    range: (low, high, render) => tree.search(low, high, (index, top) => render(index, items[index]!.left, top)),
    size: () => tree.size,
    estimateHeight: (count, estimate) => Math.max(...columnHeights) + Math.ceil(Math.max(0, count - items.length) / columnCount) * estimate,
    shortestColumn: () => Math.min(...columnHeights),
    all: () => items,
  };
}
