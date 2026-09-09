import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { ViewerPhoto } from '../viewer/photos';
export default function PhotoMap({ photos, onOpen }: { photos: readonly ViewerPhoto[]; onOpen: (photo: ViewerPhoto) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const located = photos.filter(p => p.location && Number.isFinite(p.location.latitude) && Number.isFinite(p.location.longitude) && Math.abs(p.location.latitude) <= 90 && Math.abs(p.location.longitude) <= 180);
  const open = useRef(onOpen); open.current = onOpen;
  useEffect(() => {
    if (!container.current || !located.length) return;
    let map: maplibregl.Map | undefined;
    setError(false);
    try {
      map = new maplibregl.Map({ container: container.current, style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json', center: [located[0]!.location!.longitude, located[0]!.location!.latitude], zoom: 9, attributionControl: { compact: true } });
      map.addControl(new maplibregl.NavigationControl(), 'top-right');
      const bounds = new maplibregl.LngLatBounds();
      located.forEach(p => bounds.extend([p.location!.longitude, p.location!.latitude]));
      if (located.length > 1) map.fitBounds(bounds, { padding: 60, maxZoom: 13, duration: 0 });
      map.on('error', () => setError(true));
      map.on('load', () => {
        if (!map) return;
        const current = map;
        current.addSource('photos', { type: 'geojson', cluster: true, clusterRadius: 45, data: { type: 'FeatureCollection', features: located.map(p => ({ type: 'Feature', properties: { id: p.id }, geometry: { type: 'Point', coordinates: [p.location!.longitude, p.location!.latitude] } })) } });
        current.addLayer({ id: 'clusters', type: 'circle', source: 'photos', filter: ['has', 'point_count'], paint: { 'circle-color': '#dddddd', 'circle-radius': 23, 'circle-stroke-width': 5, 'circle-stroke-color': '#ffffff33' } });
        current.addLayer({ id: 'counts', type: 'symbol', source: 'photos', filter: ['has', 'point_count'], layout: { 'text-field': '{point_count_abbreviated}', 'text-size': 12 }, paint: { 'text-color': '#171717' } });
        current.addLayer({ id: 'photo', type: 'circle', source: 'photos', filter: ['!', ['has', 'point_count']], paint: { 'circle-color': '#ffffff', 'circle-radius': 8, 'circle-stroke-width': 5, 'circle-stroke-color': '#ffffff44' } });
        current.on('click', 'photo', event => { const photo = located.find(p => p.id === event.features?.[0]?.properties.id); if (photo) open.current(photo); });
        current.on('click', 'clusters', async event => {
          const feature = event.features?.[0]; if (!feature || feature.geometry.type !== 'Point') return;
          try { const zoom = await (current.getSource('photos') as maplibregl.GeoJSONSource).getClusterExpansionZoom(feature.properties.cluster_id); current.easeTo({ center: feature.geometry.coordinates as [number, number], zoom }); } catch { setError(true); }
        });
        for (const layer of ['photo', 'clusters']) {
          current.on('mouseenter', layer, () => { current.getCanvas().style.cursor = 'pointer'; });
          current.on('mouseleave', layer, () => { current.getCanvas().style.cursor = ''; });
        }
      });
    } catch { setError(true); }
    return () => { map?.remove(); };
    // The panel gets a new instance when its filtered result changes.
  }, [photos, attempt]);
  if (!located.length) return <div className="gallery-empty"><h3>没有可显示的位置</h3><p>当前照片没有 GPS 坐标。</p></div>;
  return <><div className="photo-map" ref={container} aria-label="照片位置地图" />{error && <p className="map-error" role="status">底图暂时不可用，你仍可从下方打开照片。<button onClick={() => setAttempt(n => n + 1)}>重试地图</button></p>}<p className="muted">{located.length} 张照片有位置记录</p><ul className="map-photo-list">{located.map(p => <li key={p.id}><button onClick={() => onOpen(p)}><img src={p.thumbnail} alt=""/><span>{p.title}<small>{p.location?.locationName || p.location?.city || `${p.location!.latitude.toFixed(3)}, ${p.location!.longitude.toFixed(3)}`}</small></span></button></li>)}</ul></>;
}
