import { useState } from 'react';
import { Thumbhash } from '../../viewer/Thumbhash';
import type { ViewerPhoto } from '../../viewer/photos';

export function PhotoMarkerImage({ photo }: { photo: Pick<ViewerPhoto, 'thumbnail' | 'src' | 'thumbHash'> }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const thumbnail = photo.thumbnail && photo.thumbnail !== photo.src ? photo.thumbnail : '';
  return <span className="photo-marker-image" aria-hidden="true">
    {photo.thumbHash && !loaded && <Thumbhash thumbHash={photo.thumbHash} />}
    {thumbnail && !failed && <img src={thumbnail} alt="" loading="lazy" decoding="async" draggable={false}
      style={{ opacity: loaded ? 1 : 0 }} onLoad={() => setLoaded(true)} onError={() => setFailed(true)}
      ref={element => { if (element?.complete && element.naturalWidth) setLoaded(true); }} />}
  </span>;
}
