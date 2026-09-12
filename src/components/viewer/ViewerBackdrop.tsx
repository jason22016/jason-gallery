// Afilmory/Afilmory, apps/web/src/modules/viewer/PhotoViewer.tsx (backdrop / thumbhash presence)
// 1f65cde6672e5231599182620116ac904e39f548; AGPL-3.0-or-later + ANL §4. See THIRD_PARTY_NOTICES.md.
import { AnimatePresence, m, type MotionValue } from 'motion/react';
import { Spring } from '@afilmory/utils';
import { useEffect, useState } from 'react';
import { dataUrlFromThumbhash } from './color';
import type { ViewerPhoto } from './photos';

type Background = { id: string; src: string; placeholder: boolean };

export function ViewerBackdrop({ photo, closing, reduced, opacity, baseOpacity }: { photo: ViewerPhoto; closing: boolean; reduced: boolean; opacity: number | MotionValue<number>; baseOpacity: number | MotionValue<number> }) {
  const [background, setBackground] = useState<Background | null>(() => {
    const src = photo.thumbHash && dataUrlFromThumbhash(photo.thumbHash);
    return src ? { id: photo.id, src, placeholder: true } : null;
  });
  useEffect(() => {
    const hash = photo.thumbHash && dataUrlFromThumbhash(photo.thumbHash);
    if (hash) {
      setBackground({ id: photo.id, src: hash, placeholder: true });
      return;
    }
    let active = true;
    const image = new Image();
    image.onload = () => { if (active) setBackground({ id: photo.id, src: photo.thumbnail, placeholder: false }); };
    image.onerror = () => { if (active) setBackground(null); };
    image.src = photo.thumbnail;
    return () => { active = false; image.onload = null; image.onerror = null; };
  }, [photo.id, photo.thumbHash, photo.thumbnail]);
  return <m.div className="viewer-backdrop-presence" initial={reduced ? false : { opacity: 0 }} animate={{ opacity: closing ? 0 : 1 }} transition={reduced ? { duration: 0 } : Spring.presets.snappy}>
    <m.div className="viewer-backdrop-base" style={{ opacity: baseOpacity }}/>
    <m.div className="viewer-backdrop" style={{ opacity }}>
      <AnimatePresence initial={false} mode="sync">
        {background && <m.div key={background.id} className="viewer-background-layer" data-background-photo={background.id} initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={reduced ? { duration: 0 } : Spring.presets.snappy}>
          <img src={background.src} alt="" draggable={false} className={background.placeholder ? 'viewer-background-hash' : 'viewer-background-thumbnail'}/>
        </m.div>}
      </AnimatePresence>
    </m.div>
  </m.div>;
}
