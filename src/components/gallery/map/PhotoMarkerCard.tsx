import * as Popover from '@radix-ui/react-popover';
import { Spring } from '@afilmory/utils';
import { m } from 'motion/react';
import { useLayoutEffect, useRef, type MouseEvent, type RefObject } from 'react';
import { captureDate, validLocation } from '../../viewer/metadata';
import type { ViewerPhoto } from '../../viewer/photos';
import { EllipsisWithTooltip } from '../ui/EllipsisWithTooltip';
import { Icon } from '../ui/Icon';
import { PhotoMarkerImage } from './PhotoMarkerImage';

const cardSideOffset = 12;
const cardCollisionPadding = 16;

export interface PhotoMarkerCardProps {
  photo: ViewerPhoto;
  onOpen: (photo: ViewerPhoto, element: HTMLElement) => void;
  onClose?: () => void;
  reduced: boolean;
}

export function PhotoMarkerCardContent({ photo, onOpen, onClose, reduced }: PhotoMarkerCardProps) {
  const title = photo.title || photo.id;
  const date = captureDate({ DateTimeOriginal: photo.date });
  const day = date ? new Date(`${date.slice(0, 10)}T00:00:00Z`).toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }) : '';
  const url = new URL(location.href);
  url.searchParams.set('photo', photo.id);
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onOpen(photo, event.currentTarget);
  };
  return <div className="photo-marker-card-content" data-card-photo={photo.id}>
    {onClose && <m.button type="button" className="photo-marker-card-close" aria-label={`取消选择：${title}`}
      whileHover={reduced ? undefined : { scale: 1.1 }} whileTap={reduced ? undefined : { scale: .95 }}
      transition={reduced ? { duration: 0 } : Spring.presets.smooth} onClick={onClose}>
      <span className="photo-marker-card-close-glass" /><Icon name="close" />
    </m.button>}
    <a className="photo-marker-card-image" href={url.href} onClick={open} aria-label={`查看照片：${title}`} data-viewer-trigger={photo.id}>
      <PhotoMarkerImage key={photo.thumbnail} photo={photo} />
      <span className="photo-marker-card-image-shade" />
    </a>
    <div className="photo-marker-card-body">
      <a className="photo-marker-card-title" href={url.href} onClick={open} aria-label={`查看照片：${title}`}>
        <h3><EllipsisWithTooltip>{title}</EllipsisWithTooltip></h3><Icon name="arrow-right" />
      </a>
      <div className="photo-marker-card-metadata">
        {day && <div className="photo-marker-card-row" data-card-field="date"><Icon name="calendar" /><time dateTime={date}>{day}</time></div>}
        {photo.camera?.trim() && <div className="photo-marker-card-row" data-card-field="camera"><Icon name="camera" /><EllipsisWithTooltip>{photo.camera}</EllipsisWithTooltip></div>}
        {validLocation(photo.location) && <div className="photo-marker-card-row" data-card-field="coordinates"><Icon name="map-pin" /><span className="photo-marker-card-number">
          {Math.abs(photo.location!.latitude).toFixed(4)}°{photo.location!.latitude < 0 ? 'S' : 'N'}, {Math.abs(photo.location!.longitude).toFixed(4)}°{photo.location!.longitude < 0 ? 'W' : 'E'}
        </span></div>}
        {typeof photo.altitude === 'number' && Number.isFinite(photo.altitude) && <div className="photo-marker-card-row" data-card-field="altitude"><Icon name="mountain-2" /><span className="photo-marker-card-number">{photo.altitude.toFixed(1)} m</span></div>}
      </div>
    </div>
  </div>;
}

export function AnchoredPhotoMarkerCard({ anchor, id, ...props }: PhotoMarkerCardProps & { anchor: RefObject<HTMLButtonElement | null>; id: string }) {
  const content = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    let frame = 0;
    const trapTab = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return;
      const panel = anchor.current?.closest('[role="dialog"]');
      const card = content.current;
      const focused = document.activeElement;
      if (!panel || !card || !focused || !panel.contains(focused) && !card.contains(focused)) return;
      const selector = 'button, a[href], input, select, textarea, [tabindex="0"]';
      const controls = [...new Set([...panel.querySelectorAll<HTMLElement>(selector), ...card.querySelectorAll<HTMLElement>(selector)])]
        .filter(element => element.tabIndex >= 0 && !element.matches(':disabled') && element.getClientRects().length && !element.closest('[inert]'));
      const index = controls.indexOf(focused as HTMLElement);
      if (index < 0 || !controls.length) return;
      event.preventDefault();
      event.stopPropagation();
      controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus();
    };
    const measure = () => {
      if (anchor.current && content.current) {
        const height = `${Math.max(48, Math.floor(anchor.current.getBoundingClientRect().top - (window.visualViewport?.offsetTop ?? 0) - cardSideOffset - cardCollisionPadding))}px`;
        if (content.current.style.maxHeight !== height) content.current.style.maxHeight = height;
      }
      frame = requestAnimationFrame(measure);
    };
    document.addEventListener('keydown', trapTab, true);
    measure();
    return () => { cancelAnimationFrame(frame); document.removeEventListener('keydown', trapTab, true); };
  }, [anchor]);
  return <Popover.Portal><Popover.Content asChild side="top" align="center" sideOffset={cardSideOffset} collisionPadding={cardCollisionPadding}
    updatePositionStrategy="always" aria-label={`已选择照片：${props.photo.title || props.photo.id}`}
    onOpenAutoFocus={event => event.preventDefault()} onCloseAutoFocus={event => event.preventDefault()}
    onInteractOutside={event => event.preventDefault()} onEscapeKeyDown={event => { event.preventDefault(); props.onClose?.(); anchor.current?.focus({ preventScroll: true }); }}>
    <m.div ref={content} id={id} className="photo-marker-card photo-marker-card-anchored" data-card-kind="selected"
      initial={props.reduced ? false : { opacity: 0, scale: .96, y: 4 }} animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={props.reduced ? { duration: 0 } : Spring.presets.smooth}
      onClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}>
      <PhotoMarkerCardContent {...props} />
    </m.div>
  </Popover.Content></Popover.Portal>;
}
