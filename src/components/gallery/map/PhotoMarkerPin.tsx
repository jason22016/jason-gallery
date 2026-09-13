import { Spring } from '@afilmory/utils';
import { m } from 'motion/react';
import { useState } from 'react';
import { Thumbhash } from '../../viewer/Thumbhash';
import type { ViewerPhoto } from '../../viewer/photos';
import { Icon } from '../ui/Icon';
import { useReducedMotion } from '../ui/useReducedMotion';

export interface PhotoMarkerPinProps {
  photo: Pick<ViewerPhoto, 'id' | 'title' | 'thumbnail' | 'thumbHash'>;
  isSelected?: boolean;
  onClick: () => void;
}

function MarkerImage({ photo }: Pick<PhotoMarkerPinProps, 'photo'>) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  return <div className="photo-marker-image" aria-hidden="true">
    {photo.thumbHash && !loaded && <Thumbhash thumbHash={photo.thumbHash} />}
    {photo.thumbnail && !failed && <img src={photo.thumbnail} alt="" loading="lazy" decoding="async" draggable={false}
      style={{ opacity: loaded ? 1 : 0 }} onLoad={() => setLoaded(true)} onError={() => setFailed(true)}
      ref={element => { if (element?.complete && element.naturalWidth) setLoaded(true); }} />}
  </div>;
}

export function PhotoMarkerPin({ photo, isSelected = false, onClick }: PhotoMarkerPinProps) {
  const reduced = useReducedMotion();
  return <m.button type="button" className="photo-marker-pin" aria-label={photo.title || photo.id} aria-pressed={isSelected}
    initial={reduced ? false : { scale: 0 }} animate={{ scale: 1 }} transition={reduced ? { duration: 0 } : Spring.presets.snappy}
    whileHover={reduced ? undefined : { scale: 1.1 }} whileFocus={reduced ? undefined : { scale: 1.1 }}
    whileTap={reduced ? undefined : { scale: 0.9 }} onClick={event => { event.stopPropagation(); onClick(); }}>
    {isSelected && <span className="photo-marker-selection" aria-hidden="true" />}
    <MarkerImage key={photo.thumbnail} photo={photo} />
    <span className="photo-marker-material" aria-hidden="true">
      <span className="photo-marker-glass" />
      <Icon name="camera" />
      <span className="photo-marker-inner" />
    </span>
  </m.button>;
}
