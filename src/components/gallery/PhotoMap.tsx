import { EllipsisWithTooltip } from './ui/EllipsisWithTooltip';
import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { validLocation } from '../viewer/metadata';
import type { ViewerPhoto } from '../viewer/photos';
export interface MapViewport { center: [number, number]; zoom: number; bearing: number; pitch: number }
export default function PhotoMap({ photos, onOpen, initialViewport, onViewport }: { photos: readonly ViewerPhoto[]; onOpen: (photo: ViewerPhoto) => void; initialViewport?: MapViewport; onViewport?: (viewport: MapViewport) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const located = photos.filter(p => validLocation(p.location));
  const open = useRef(onOpen); open.current = onOpen;
  useEffect(() => {
    if (!container.current || !located.length) return;
    let map: maplibregl.Map | undefined;
    let active = true;
    setError(false); setReady(false);
    const failed = () => { if (active) setError(true); };
    const timeout = window.setTimeout(failed, 15_000);
    try {
      map = new maplibregl.Map({ container: container.current, style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json', center: [located[0]!.location!.longitude, located[0]!.location!.latitude], zoom: 9, ...initialViewport, attributionControl: { compact: true } });
      map.addControl(new maplibregl.NavigationControl(), 'top-right');
      const bounds = new maplibregl.LngLatBounds();
      located.forEach(p => bounds.extend([p.location!.longitude, p.location!.latitude]));
      if (!initialViewport && located.length > 1) map.fitBounds(bounds, { padding: 60, maxZoom: 13, duration: 0 });
      map.on('moveend', () => { if (active && map) onViewport?.({ center: map.getCenter().toArray(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() }); });
      map.on('error', failed);
      map.getCanvas().addEventListener('webglcontextlost', failed);
      map.once('idle', () => { if (active) { clearTimeout(timeout); setReady(true); } });
      map.on('load', () => {
        if (!map) return;
        const current = map;
        const tokens = getComputedStyle(container.current!);
        const accent = tokens.getPropertyValue('--color-accent').trim();
        const background = tokens.getPropertyValue('--color-background').trim();
        current.addSource('photos', { type: 'geojson', cluster: true, clusterRadius: 45, data: { type: 'FeatureCollection', features: located.map(p => ({ type: 'Feature', properties: { id: p.id }, geometry: { type: 'Point', coordinates: [p.location!.longitude, p.location!.latitude] } })) } });
        current.addLayer({ id: 'clusters', type: 'circle', source: 'photos', filter: ['has', 'point_count'], paint: { 'circle-color': accent, 'circle-radius': 23, 'circle-stroke-width': 5, 'circle-stroke-color': accent, 'circle-stroke-opacity': .2 } });
        current.addLayer({ id: 'counts', type: 'symbol', source: 'photos', filter: ['has', 'point_count'], layout: { 'text-field': '{point_count_abbreviated}', 'text-size': 12 }, paint: { 'text-color': background } });
        current.addLayer({ id: 'photo', type: 'circle', source: 'photos', filter: ['!', ['has', 'point_count']], paint: { 'circle-color': accent, 'circle-radius': 8, 'circle-stroke-width': 5, 'circle-stroke-color': accent, 'circle-stroke-opacity': .3 } });
        current.on('click', 'photo', event => { const photo = located.find(p => p.id === event.features?.[0]?.properties.id); if (photo) open.current(photo); });
        current.on('click', 'clusters', async event => {
          const feature = event.features?.[0]; if (!feature || feature.geometry.type !== 'Point') return;
          try { const zoom = await (current.getSource('photos') as maplibregl.GeoJSONSource).getClusterExpansionZoom(feature.properties.cluster_id); if (active) current.easeTo({ center: feature.geometry.coordinates as [number, number], zoom }); } catch { failed(); }
        });
        for (const layer of ['photo', 'clusters']) {
          current.on('mouseenter', layer, () => { current.getCanvas().style.cursor = 'pointer'; });
          current.on('mouseleave', layer, () => { current.getCanvas().style.cursor = ''; });
        }
      });
    } catch { failed(); }
    return () => { active = false; clearTimeout(timeout); map?.remove(); };
    // The panel gets a new instance when its filtered result changes.
  }, [photos, attempt]);
  if (!located.length) return <div className="gallery-empty"><h3>没有可显示的位置</h3><p>当前照片没有 GPS 坐标。</p></div>;
  return <><div className="photo-map" ref={container} aria-label="照片位置地图" aria-busy={!ready && !error} data-map-state={error ? 'error' : ready ? 'ready' : 'loading'} />{error && <p className="map-error" role="status">底图暂时不可用，你仍可从下方打开照片。<button onClick={() => setAttempt(n => n + 1)}>重试地图</button></p>}<p className="muted">{located.length} 张照片有位置记录</p><ul className="map-photo-list">{located.map(p => <li key={p.id}><button onClick={() => onOpen(p)}><img src={p.thumbnail} alt=""/><span><EllipsisWithTooltip>{p.title}</EllipsisWithTooltip><small><EllipsisWithTooltip>{p.location?.locationName || p.location?.city || `${p.location!.latitude.toFixed(3)}, ${p.location!.longitude.toFixed(3)}`}</EllipsisWithTooltip></small></span></button></li>)}</ul></>;
}
