import { Spring } from '@afilmory/utils';
import { m } from 'motion/react';
import { useReducedMotion } from '../ui/useReducedMotion';

export function MapLoadingState() {
  const reduced = useReducedMotion();
  return <div className="map-loading" role="status"><m.div initial={reduced ? false : { opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }} transition={Spring.presets.smooth}>
    <m.div className="map-loading-icon" aria-hidden="true" initial={reduced ? false : { scale: .8 }} animate={{ scale: 1 }} transition={Spring.presets.smooth}>📍</m.div>
    <h3>正在加载地图…</h3><p>正在读取照片位置</p>
  </m.div></div>;
}
