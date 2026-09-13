import { Spring } from '@afilmory/utils';
import { m } from 'motion/react';
import * as Popover from '@radix-ui/react-popover';
import { useEffect, useId, useRef, useState } from 'react';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '../../viewer/HoverCard';
import type { ViewerPhoto } from '../../viewer/photos';
import { Icon } from '../ui/Icon';
import { useReducedMotion } from '../ui/useReducedMotion';
import { AnchoredPhotoMarkerCard, PhotoMarkerCardContent } from './PhotoMarkerCard';
import { PhotoMarkerImage } from './PhotoMarkerImage';
import { resolvePhotoMarkerCardBehavior } from './photo-marker-card-behavior';

export interface PhotoMarkerPinProps {
  photo: ViewerPhoto;
  isSelected?: boolean;
  enableHover?: boolean;
  onClick: () => void;
  onClose: () => void;
  onOpen: (photo: ViewerPhoto, element: HTMLElement) => void;
}

export function PhotoMarkerPin({ photo, isSelected = false, enableHover = true, onClick, onClose, onOpen }: PhotoMarkerPinProps) {
  const reduced = useReducedMotion();
  const anchor = useRef<HTMLButtonElement>(null);
  const cardId = useId();
  const [hoverOpen, setHoverOpen] = useState(false);
  const cardBehavior = resolvePhotoMarkerCardBehavior({ isSelected });
  useEffect(() => { setHoverOpen(false); }, [isSelected, enableHover]);
  const close = () => { onClose(); anchor.current?.focus({ preventScroll: true }); };
  return <Popover.Root open={cardBehavior.renderAnchoredCard}>
    <HoverCard open={enableHover && !isSelected && hoverOpen} onOpenChange={setHoverOpen} openDelay={cardBehavior.hoverCardOpenDelay} closeDelay={cardBehavior.hoverCardCloseDelay}>
      <HoverCardTrigger asChild><Popover.Anchor asChild><m.button ref={anchor} type="button" className="photo-marker-pin" aria-label={photo.title || photo.id} aria-pressed={isSelected}
        aria-haspopup="dialog" aria-expanded={isSelected} aria-controls={isSelected ? cardId : undefined}
        initial={reduced ? false : { scale: 0 }} animate={{ scale: 1 }} transition={reduced ? { duration: 0 } : Spring.presets.snappy}
        whileHover={reduced ? undefined : { scale: 1.1 }} whileFocus={reduced ? undefined : { scale: 1.1 }}
        whileTap={reduced ? undefined : { scale: 0.9 }} onClick={event => { event.stopPropagation(); onClick(); }}>
        {isSelected && <span className="photo-marker-selection" aria-hidden="true" />}
        <PhotoMarkerImage key={photo.thumbnail} photo={photo} />
        <span className="photo-marker-material" aria-hidden="true">
          <span className="photo-marker-glass" />
          <Icon name="camera" />
          <span className="photo-marker-inner" />
        </span>
      </m.button></Popover.Anchor></HoverCardTrigger>
      {enableHover && !cardBehavior.renderAnchoredCard && <HoverCardContent reducedMotion={reduced} className="photo-marker-card photo-marker-card-hover" side="top" align="center" sideOffset={8} collisionPadding={16}
        updatePositionStrategy="always" data-card-kind="hover" onClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}>
        <PhotoMarkerCardContent photo={photo} onOpen={onOpen} reduced={reduced} />
      </HoverCardContent>}
    </HoverCard>
    {cardBehavior.renderAnchoredCard && <AnchoredPhotoMarkerCard id={cardId} photo={photo} anchor={anchor} onOpen={onOpen} onClose={close} reduced={reduced} />}
  </Popover.Root>;
}
