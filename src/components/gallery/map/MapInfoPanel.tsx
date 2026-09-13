import { Spring } from '@afilmory/utils';
import { m } from 'motion/react';
import { useId, useState } from 'react';
import { Icon } from '../ui/Icon';
import { EllipsisWithTooltip } from '../ui/EllipsisWithTooltip';
import { LinearDivider } from '../ui/LinearDivider';
import { useReducedMotion } from '../ui/useReducedMotion';
import { approximateCoverage, type MapBounds } from './map-bounds';

export function MapInfoPanel({ projectTitle, markersCount, bounds }: { projectTitle: string; markersCount: number; bounds: MapBounds | null }) {
  const [expanded, setExpanded] = useState(false);
  const reduced = useReducedMotion();
  const rangeId = useId();
  const showBounds = expanded && !!bounds;
  return <m.aside className="map-info-panel" aria-label="项目地图信息" initial={reduced ? false : { opacity: 0, x: 20 }}
    animate={{ opacity: 1, x: 0 }} transition={Spring.presets.smooth}>
    <div className="map-info-header">
      <span className="map-info-icon"><Icon name="map-pin" /></span>
      <div className="map-info-summary"><h3><EllipsisWithTooltip>{projectTitle}</EllipsisWithTooltip></h3>
        <span className="map-info-count" role="status" data-map-photo-count={markersCount}><span aria-hidden="true" />{markersCount} 张照片有位置记录</span>
      </div>
      <button type="button" className="icon-button" onClick={() => setExpanded(!expanded)} disabled={!bounds}
        aria-label={expanded ? '收起拍摄范围' : '展开拍摄范围'} aria-expanded={showBounds} aria-controls={rangeId}>
        <m.span animate={{ rotate: showBounds ? 180 : 0 }} transition={reduced ? { duration: 0 } : Spring.presets.snappy}><Icon name="down" /></m.span>
      </button>
    </div>
    <m.div id={rangeId} className="map-info-range" initial={false} animate={{ height: showBounds ? 'auto' : 0, opacity: showBounds ? 1 : 0 }}
      transition={reduced ? { duration: 0 } : Spring.presets.smooth} aria-hidden={!showBounds} inert={!showBounds}>
      {bounds && <><LinearDivider /><div className="map-info-details"><h4><Icon name="map-pin" />拍摄范围</h4>
        <section className="map-coordinate-card" aria-label="Southwest"><h5>Southwest · 西南</h5><dl><dt>Lat</dt><dd data-map-bound="minLat">{bounds.minLat.toFixed(6)}°</dd><dt>Lng</dt><dd data-map-bound="minLng">{bounds.minLng.toFixed(6)}°</dd></dl></section>
        <section className="map-coordinate-card" aria-label="Northeast"><h5>Northeast · 东北</h5><dl><dt>Lat</dt><dd data-map-bound="maxLat">{bounds.maxLat.toFixed(6)}°</dd><dt>Lng</dt><dd data-map-bound="maxLng">{bounds.maxLng.toFixed(6)}°</dd></dl></section>
        <p className="map-coverage"><Icon name="grid" />覆盖面积约 {approximateCoverage(bounds)} km²</p>
      </div></>}
    </m.div>
  </m.aside>;
}
