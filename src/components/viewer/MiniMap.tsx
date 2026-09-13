// Afilmory/Afilmory, apps/web/src/modules/metadata/MiniMap.tsx
// 1f65cde6672e5231599182620116ac904e39f548; AGPL-3.0-or-later + ANL §4. See THIRD_PARTY_NOTICES.md.
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';
import type { Map as MapInstance } from 'maplibre-gl';
import { getMapStyle } from '../gallery/map/map-style';
import { validLocation } from './metadata';
import { MapPhotoLink } from '../gallery/MapNavigation';

export function MiniMap({ latitude, longitude }: { latitude: number; longitude: number }) {
  const container = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const valid = validLocation({ latitude, longitude });
  useEffect(() => {
    if (!valid || !container.current) return;
    let active = true;
    let failed = false;
    let map: MapInstance | undefined;
    let observer: ResizeObserver | undefined;
    let timeout: number | undefined;
    setState('loading');
    const fail = () => { if (active) { failed = true; clearTimeout(timeout); setState('error'); } };
    const initialize = () => {
      timeout = window.setTimeout(fail, 15000);
      void import('maplibre-gl').then(({ Map }) => {
      if (!active || !container.current) return;
      map = new Map({ container: container.current, center: [longitude, latitude], zoom: 15,
        style: getMapStyle(), interactive: false, attributionControl: false });
      map.on('error', fail);
      map.getCanvas().addEventListener('webglcontextlost', fail);
      map.once('idle', () => { if (active && !failed) { clearTimeout(timeout); setState('ready'); } });
      observer = new ResizeObserver(() => map?.resize());
      observer.observe(container.current);
      }).catch(fail);
    };
    const visibility = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { visibility.disconnect(); initialize(); }
    });
    visibility.observe(container.current);
    return () => { active = false; clearTimeout(timeout); visibility.disconnect(); observer?.disconnect(); map?.getCanvas().removeEventListener('webglcontextlost', fail); map?.remove(); };
  }, [latitude, longitude, valid]);
  if (!valid) return null;
  return <div className="viewer-minimap" data-map-state={state} aria-busy={state === 'loading'}>
    <div className="viewer-minimap-canvas" ref={container} aria-hidden="true"/>
    {state === 'ready' && <div className="viewer-minimap-marker" aria-hidden="true"/>}
    {state !== 'ready' && <div className="viewer-minimap-status" role="status">{state === 'loading' ? '地图加载中…' : '底图暂时不可用'}<span>{latitude.toFixed(4)}, {longitude.toFixed(4)}</span></div>}
    <MapPhotoLink className="viewer-minimap-link"/>
    <div className="viewer-minimap-attribution"><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a> · <a href="https://carto.com/attributions" target="_blank" rel="noreferrer">© CARTO</a></div>
  </div>;
}
