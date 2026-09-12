import { useEffect, useMemo, useState } from 'react';
import { thumbHashToDataURL } from 'thumbhash';
import { decodeThumbHash } from '../../photo-engine/thumbnail';
import type { ViewerPhoto } from '../viewer/photos';
export default function PhotoThumbnail({ photo, eager = false, onReady }: { photo: ViewerPhoto; eager?: boolean; onReady?: (ready: boolean) => void }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const placeholder = useMemo(() => {
    try { return photo.thumbHash && /^(?:[0-9a-f]{2})+$/i.test(photo.thumbHash) ? thumbHashToDataURL(decodeThumbHash(photo.thumbHash)) : undefined; } catch { return undefined; }
  }, [photo.thumbHash]);
  useEffect(() => { onReady?.(loaded && !failed); }, [loaded, failed, onReady]);
  return <span className="gallery-thumbnail" style={{ aspectRatio: `${photo.width}/${photo.height}`, backgroundImage: placeholder ? `url("${placeholder}")` : undefined }}>
    {!failed && <img src={photo.thumbnail} alt={photo.alt} width={photo.width} height={photo.height} loading={eager ? 'eager' : 'lazy'} decoding="async" style={{ opacity: loaded ? 1 : 0 }} ref={element => { if (element?.complete && element.naturalWidth) setLoaded(true); }} onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />}
    {failed && <span className="thumbnail-error" role="status"><i className="gallery-icon i-mingcute-pic-line" aria-hidden="true" /><span>预览不可用</span></span>}
  </span>;
}
