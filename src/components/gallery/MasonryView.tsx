import { useMemo } from 'react';
import { useMobile } from '../../hooks/useMobile';
import { Masonry } from './Masonic';
import { MasonryPhotoItem } from './MasonryPhotoItem';
import type { GalleryItem } from './photos';

const COLUMN_WIDTH_CONFIG = {
  auto: { mobile: 150, desktop: 250, maxColumns: 8 },
  min: { mobile: 120, desktop: 200 },
  max: { mobile: 250, desktop: 500 },
};

export function galleryColumnWidth(availableWidth: number, isMobile: boolean, columns: number) {
  const { auto, min, max } = COLUMN_WIDTH_CONFIG;
  const gutter = 4;
  if (!columns) {
    const autoWidth = isMobile ? auto.mobile : auto.desktop;
    const colCount = Math.floor((availableWidth + gutter) / (autoWidth + gutter));
    return colCount > auto.maxColumns ? (availableWidth - (auto.maxColumns - 1) * gutter) / auto.maxColumns : autoWidth;
  }
  const calculatedWidth = (availableWidth - (columns - 1) * gutter) / columns;
  return Math.max(Math.min(calculatedWidth, isMobile ? max.mobile : max.desktop), isMobile ? min.mobile : min.desktop);
}

export function MasonryView({ items, columns }: { items: GalleryItem[]; columns: number }) {
  const isMobile = useMobile();
  const columnWidth = useMemo(() => (width: number) => galleryColumnWidth(width, isMobile, columns), [columns, isMobile]);
  return <div className="masonry-grid"><Masonry items={items} render={MasonryPhotoItem} columnWidth={columnWidth}
    maxColumnCount={8} columnGutter={4} rowGutter={4} itemHeightEstimate={400} overscanBy={2} /></div>;
}
