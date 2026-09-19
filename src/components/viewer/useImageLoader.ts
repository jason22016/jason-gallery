import { useEffect, useState } from 'react';
import { ImageDownloadStalledError, ImageLoaderManager, type LoadingState } from '../../lib/image-loader-manager';

/** Separate download/conversion readiness from the viewer's first rendered frame.
 * Each effect owns its manager/lease; late results cannot update a new photo. */
export function useImageLoader(src: string) {
  const [state, setState] = useState<{ src: string; blobSrc: string | null; highResLoaded: boolean; error: 'stalled' | 'failed' | null; loading: LoadingState }>({
    src, blobSrc: null, highResLoaded: false, error: null, loading: { isVisible: true },
  });
  useEffect(() => {
    let active = true;
    const manager = new ImageLoaderManager();
    setState({ src, blobSrc: null, highResLoaded: false, error: null, loading: { isVisible: true } });
    void manager.loadImage(new URL(src, document.baseURI).href, {
      onLoadingStateUpdate: loading => { if (active) setState(previous => ({ ...previous, loading: { ...previous.loading, ...loading } })); },
    }).then(result => {
      if (active) setState(previous => ({ ...previous, blobSrc: result.blobSrc, highResLoaded: true }));
    }).catch(error => {
      if (active && error?.name !== 'AbortError') setState(previous => ({ ...previous, error: error instanceof ImageDownloadStalledError ? 'stalled' : 'failed' }));
    });
    return () => { active = false; manager.cleanup(); };
  }, [src]);
  return state.src === src ? state : { src, blobSrc: null, highResLoaded: false, error: null, loading: { isVisible: true } };
}
