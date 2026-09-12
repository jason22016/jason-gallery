import { Spring } from '@afilmory/utils';
import { getViewerTransitionTriggerProps } from '@afilmory/viewer-motion';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { m } from 'motion/react';
import { useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { useMobile } from '../../hooks/useMobile';
import { CarbonIsoOutline, MaterialSymbolsShutterSpeed, StreamlineImageAccessoriesLensesPhotosCameraShutterPicturePhotographyPicturesPhotoLens as LensIcon, TablerAperture } from '../viewer/CaptureIcons';
import { formatBytes } from '../viewer/photos';
import PhotoThumbnail from './PhotoThumbnail';
import type { GalleryItem } from './photos';
import { EllipsisWithTooltip } from './ui/EllipsisWithTooltip';
import { Icon } from './ui/Icon';
import { useReducedMotion } from './ui/useReducedMotion';

export function ListView({ items }: { items: GalleryItem[] }) {
  const isMobile = useMobile();
  const listRef = useRef<HTMLOListElement>(null);
  const [bounds, setBounds] = useState({ width: 0, offset: 0 });
  useLayoutEffect(() => {
    const element = listRef.current;
    if (!element) return;
    const update = () => {
      const rect = element.getBoundingClientRect();
      setBounds(previous => previous.width === rect.width && previous.offset === rect.top + scrollY ? previous : { width: rect.width, offset: rect.top + scrollY });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    if (element.parentElement?.parentElement) observer.observe(element.parentElement.parentElement);
    window.addEventListener('resize', update);
    return () => { observer.disconnect(); window.removeEventListener('resize', update); };
  }, []);
  const virtualizer = useWindowVirtualizer({
    count: items.length,
    getItemKey: index => items[index]!.photo.id,
    estimateSize: index => isMobile ? Math.max(0, bounds.width - 18) / items[index]!.photo.aspectRatio + 244 : 176,
    gap: 8,
    overscan: 5,
    scrollMargin: bounds.offset,
  });
  useLayoutEffect(() => { virtualizer.measure(); }, [isMobile, bounds.width, items, virtualizer]);
  return <div className="list-view" data-mobile={isMobile}>
    <ol ref={listRef} className="photo-list" aria-label="照片列表" style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map(item => <li key={item.key} data-index={item.index} ref={isMobile ? virtualizer.measureElement : undefined}
        aria-posinset={item.index + 1} aria-setsize={items.length} style={{ transform: `translateY(${item.start - bounds.offset}px)` }}>
        <PhotoCard item={items[item.index]!} isMobile={isMobile} />
      </li>)}
    </ol>
  </div>;
}

function PhotoCard({ item: { photo, index, onOpen }, isMobile }: { item: GalleryItem; isMobile: boolean }) {
  const imageRef = useRef<HTMLSpanElement>(null);
  const reduced = useReducedMotion();
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); onOpen(photo, imageRef.current);
  };
  const location = photo.location?.locationName || photo.location?.city || photo.location?.country;
  const capture = photo.capture;
  return <m.a className="list-card" href={photo.src} data-photo-id={photo.id} data-gallery-index={index}
    aria-label={`查看照片：${photo.alt}`} onClick={open}
    onKeyDown={event => { if (event.key === ' ') { event.preventDefault(); onOpen(photo, imageRef.current); } }}
    initial={false} whileHover={!isMobile && !reduced ? 'hover' : 'rest'} whileTap={reduced ? undefined : { scale: .995 }} transition={Spring.presets.snappy}>
    <span ref={imageRef} tabIndex={-1} className="list-image" style={{ aspectRatio: photo.aspectRatio }} {...getViewerTransitionTriggerProps(photo.id)} data-viewer-trigger={photo.id}>
      <m.span className="list-image-content" variants={{ hover: { scale: 1.05 }, rest: { scale: 1 } }} animate={reduced ? { scale: 1 } : undefined} transition={Spring.presets.smooth}>
        <PhotoThumbnail photo={photo} eager={index < 8} />
      </m.span>
      {photo.isHDR && <span className="photo-badge list-hdr"><Icon name="sun" />HDR</span>}
      {!!photo.tags.length && <span className="list-tags">{photo.tags.map(tag => <span key={tag}><EllipsisWithTooltip>{tag}</EllipsisWithTooltip></span>)}</span>}
    </span>
    <span className="list-info"><span className="list-info-scroll">
      <strong className="list-title">{photo.title}</strong>
      <span className="list-metadata">
        {location && <span><Icon name="map-pin" /><EllipsisWithTooltip>{location}</EllipsisWithTooltip></span>}
        {photo.date && <span><Icon name="calendar" /><time dateTime={photo.date}>{photo.date.slice(0, 10)}</time></span>}
        {photo.camera && <span><Icon name="camera" /><EllipsisWithTooltip>{photo.camera}</EllipsisWithTooltip></span>}
        {photo.lens && <span><TablerAperture /><EllipsisWithTooltip>{photo.lens}</EllipsisWithTooltip></span>}
        <span><Icon name="pic" />{photo.width} × {photo.height}<span className="list-file-size">{formatBytes(photo.size)}</span></span>
      </span>
      {Object.values(capture).some(Boolean) && <span className="list-exif">
        {capture.iso && <span><CarbonIsoOutline />{capture.iso}</span>}
        {capture.aperture && <span><TablerAperture />{capture.aperture}</span>}
        {capture.shutter && <span><MaterialSymbolsShutterSpeed />{capture.shutter}</span>}
        {capture.focalLength && <span><LensIcon />{capture.focalLength}</span>}
        {capture.exposureBias && <span className="list-exposure-bias"><Icon name="settings-3" />{capture.exposureBias}</span>}
      </span>}
    </span></span>
  </m.a>;
}
