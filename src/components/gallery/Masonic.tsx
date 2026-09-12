import { createPositioner, useMasonry, usePositioner, useScroller, type RenderComponentProps } from 'masonic';
import { Children, cloneElement, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type ReactElement } from 'react';
import type { GalleryItem } from './photos';

export function Masonry({ items, render, columnWidth, columnGutter, rowGutter, maxColumnCount, itemHeightEstimate, overscanBy }: {
  items: GalleryItem[];
  render: ComponentType<RenderComponentProps<GalleryItem>>;
  columnWidth: (width: number) => number;
  columnGutter: number;
  rowGutter: number;
  maxColumnCount: number;
  itemHeightEstimate: number;
  overscanBy: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerPosition, setContainerPosition] = useState({ width: 0, offset: 0, height: 0 });
  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const update = () => {
      const bounds = element.getBoundingClientRect();
      const next = { width: bounds.width, offset: bounds.top + window.scrollY, height: window.innerHeight };
      setContainerPosition(prev => prev.width === next.width && prev.offset === next.offset && prev.height === next.height ? prev : next);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    if (element.parentElement?.parentElement) observer.observe(element.parentElement.parentElement);
    window.addEventListener('resize', update);
    return () => { observer.disconnect(); window.removeEventListener('resize', update); };
  }, []);
  const { width, offset, height } = containerPosition;
  const layout = usePositioner({ width, columnWidth: columnWidth(width), columnGutter, rowGutter, maxColumnCount });
  const positioner = useMemo(() => {
    const next = createPositioner(layout.columnCount, layout.columnWidth, columnGutter, rowGutter);
    items.forEach(({ photo }, index) => {
      next.set(index, next.columnWidth / photo.aspectRatio);
    });
    return next;
  }, [items, layout.columnCount, layout.columnWidth, columnGutter, rowGutter]);
  const { scrollTop, isScrolling } = useScroller(offset, 12);
  const masonry = useMasonry({
    positioner, items, height, scrollTop, isScrolling,
    render, itemHeightEstimate, overscanBy, itemKey: item => item.photo.id,
    role: 'list', tabIndex: -1, className: 'masonic', style: { visibility: width ? 'visible' : 'hidden' },
  });
  const cells = Children.toArray(masonry.props.children) as ReactElement<{ children: ReactElement<{ index: number }>; 'aria-posinset'?: number; 'aria-setsize'?: number }>[];
  cells.sort((a, b) => a.props.children.props.index - b.props.children.props.index);
  return <div ref={containerRef}>{cloneElement(masonry, {}, cells.map(cell => cloneElement(cell, {
    'aria-posinset': cell.props.children.props.index + 1, 'aria-setsize': items.length,
  })))}</div>;
}
