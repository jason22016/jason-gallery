// Adapted from Afilmory/Afilmory, apps/web/src/modules/viewer/ProgressiveImage.tsx
// Upstream 1f65cde6672e5231599182620116ac904e39f548; AGPL-3.0-or-later + ANL §4, Copyright (c) 2025 Afilmory Team.
// Retains upstream slide/visual-readiness lifecycle around Jason's HDR/GPU/fallback renderer.
import { useLayoutEffect, useRef, useState } from 'react';
import { getProgressiveImageVisualReady, isThumbnailElementVisuallyReady } from './entry-animation-state';
import { PhotoMedia, type Controls } from './PhotoMedia';
import { Thumbhash } from './Thumbhash';
import type { ViewerPhoto } from './photos';
const loadedThumbnailSrcSet = new Set<string>();
export function ProgressiveImage({ photo, isCurrentImage, shouldRenderHighRes, engineRef, smooth, enablePan,
  onZoomChange, onReady, onBlobSrcChange, onVisualReadyChange,
}: { photo: ViewerPhoto; isCurrentImage: boolean; shouldRenderHighRes: boolean; engineRef: React.RefObject<Controls | null>;
  smooth: boolean; enablePan: boolean; onZoomChange: (zoomed: boolean) => void; onReady: (ready: boolean) => void;
  onBlobSrcChange: (src: string | null) => void; onVisualReadyChange: (ready: boolean) => void }) {
  const thumbnailRef = useRef<HTMLImageElement>(null);
  const [isThumbnailLoaded, setIsThumbnailLoaded] = useState(loadedThumbnailSrcSet.has(photo.thumbnail));
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const [isHighResImageRendered, setIsHighResImageRendered] = useState(false);
  const isActiveImage = isCurrentImage && shouldRenderHighRes;
  useLayoutEffect(() => {
    const image = thumbnailRef.current;
    setIsThumbnailLoaded(loadedThumbnailSrcSet.has(photo.thumbnail) || isThumbnailElementVisuallyReady({
      currentSrc: image?.currentSrc, naturalWidth: image?.naturalWidth, src: image?.src, thumbnailSrc: photo.thumbnail,
    }));
  }, [photo.thumbnail]);
  useLayoutEffect(() => {
    if (!isActiveImage) setIsHighResImageRendered(false);
  }, [isActiveImage]);
  const visualReady = thumbnailFailed || getProgressiveImageVisualReady({ isHighResImageRendered, isThumbnailLoaded, thumbnailSrc: photo.thumbnail });
  useLayoutEffect(() => { if (isCurrentImage) onVisualReadyChange(visualReady); }, [isCurrentImage, visualReady, onVisualReadyChange]);
  return <div className="viewer-progressive-image">
    {(!isActiveImage || !isHighResImageRendered) && <div className="viewer-slide-preview">
      {photo.thumbHash && <Thumbhash thumbHash={photo.thumbHash}/>}
      <img ref={thumbnailRef} className="viewer-preview" src={photo.thumbnail} alt={photo.alt} draggable={false}
        onError={() => setThumbnailFailed(true)} onLoad={() => { loadedThumbnailSrcSet.add(photo.thumbnail); setIsThumbnailLoaded(true); }}/>
    </div>}
    {isActiveImage && <PhotoMedia photo={photo} engineRef={engineRef} smooth={smooth} enablePan={enablePan}
      onZoom={onZoomChange} onDisplaySrc={onBlobSrcChange} onReady={ready => { setIsHighResImageRendered(ready); onReady(ready); }}/ >}
  </div>;
}
