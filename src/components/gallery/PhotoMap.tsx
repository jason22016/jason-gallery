import { EllipsisWithTooltip } from './ui/EllipsisWithTooltip';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { validLocation } from '../viewer/metadata';
import type { ViewerPhoto } from '../viewer/photos';
import type { MapViewport } from './map-state';
import { PhotoMarkerPin } from './map/PhotoMarkerPin';
import { PhotoMarkerRegistry, type MarkerCandidate, type PhotoMarkerEntry } from './map/photo-marker-registry';

export default function PhotoMap({ photos, onOpen, onSelect, selectedPhotoId, initialViewport, onViewport }: { photos: readonly ViewerPhoto[]; onOpen: (photo: ViewerPhoto) => void; onSelect: (photo: ViewerPhoto) => void; selectedPhotoId: string | null; initialViewport?: MapViewport; onViewport?: (viewport: MapViewport) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [markers, setMarkers] = useState<PhotoMarkerEntry[]>([]);
  const located = useMemo(() => photos.filter(p => validLocation(p.location)), [photos]);
  const byId = useMemo(() => new Map(located.map(photo => [photo.id, photo])), [located]);
  const photosKey = JSON.stringify(located.map(photo => [photo.id, photo.location!.longitude, photo.location!.latitude]));
  const currentProps = useRef({ located, byId, selectedPhotoId, onViewport });
  currentProps.current = { located, byId, selectedPhotoId, onViewport };
  const updateSelection = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!container.current || !located.length) return;
    let map: maplibregl.Map | undefined;
    let registry: PhotoMarkerRegistry | undefined;
    let active = true;
    setError(false); setReady(false);
    const failed = () => { if (active) setError(true); };
    const timeout = window.setTimeout(failed, 15_000);
    setMarkers([]);
    const sourceData = () => ({ type: 'FeatureCollection' as const, features: currentProps.current.located
      .filter(photo => photo.id !== currentProps.current.selectedPhotoId)
      .map(photo => ({ type: 'Feature' as const, properties: { id: photo.id }, geometry: { type: 'Point' as const, coordinates: [photo.location!.longitude, photo.location!.latitude] } })) });
    try {
      map = new maplibregl.Map({ container: container.current, style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json', center: [located[0]!.location!.longitude, located[0]!.location!.latitude], zoom: 9, ...initialViewport, attributionControl: { compact: true } });
      map.addControl(new maplibregl.NavigationControl(), 'top-right');
      const bounds = new maplibregl.LngLatBounds();
      located.forEach(p => bounds.extend([p.location!.longitude, p.location!.latitude]));
      if (!initialViewport && located.length > 1) map.fitBounds(bounds, { padding: 60, maxZoom: 13, duration: 0 });
      const saveViewport = () => { if (active && map) currentProps.current.onViewport?.({ center: map.getCenter().toArray(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() }); };
      map.on('moveend', saveViewport);
      map.on('error', failed);
      map.getCanvas().addEventListener('webglcontextlost', failed);
      map.once('idle', () => { if (active) { clearTimeout(timeout); saveViewport(); setReady(true); } });
      map.on('load', () => {
        if (!active || !map) return;
        const current = map;
        const tokens = getComputedStyle(container.current!);
        const accent = tokens.getPropertyValue('--color-accent').trim();
        const background = tokens.getPropertyValue('--color-background').trim();
        current.addSource('photos', { type: 'geojson', cluster: true, clusterRadius: 45, data: sourceData() });
        current.addLayer({ id: 'clusters', type: 'circle', source: 'photos', filter: ['has', 'point_count'], paint: { 'circle-color': accent, 'circle-radius': 23, 'circle-stroke-width': 5, 'circle-stroke-color': accent, 'circle-stroke-opacity': .2 } });
        current.addLayer({ id: 'counts', type: 'symbol', source: 'photos', filter: ['has', 'point_count'], layout: { 'text-field': '{point_count_abbreviated}', 'text-size': 12 }, paint: { 'text-color': background } });
        registry = new PhotoMarkerRegistry(candidate => {
          const element = document.createElement('div');
          element.className = 'photo-marker-host';
          element.dataset.photoId = candidate.photo.id;
          const marker = new maplibregl.Marker({ element, anchor: 'center' }).setLngLat(candidate.coordinates).addTo(current);
          return { ...candidate, element, marker };
        });
        const syncMarkers = () => {
          if (!active || !registry) return;
          const { byId: currentPhotos, selectedPhotoId: selectedId } = currentProps.current;
          const candidates: MarkerCandidate[] = [];
          const seen = new Set<string>();
          const center = current.getCenter().lng;
          const width = current.getContainer().clientWidth, height = current.getContainer().clientHeight;
          const addCandidate = (photo: ViewerPhoto) => {
            if (seen.has(photo.id)) return;
            seen.add(photo.id);
            const { longitude, latitude } = photo.location!;
            const coordinates: [number, number] = [longitude + Math.round((center - longitude) / 360) * 360, latitude];
            const point = current.project(coordinates);
            if (point.x >= -40 && point.x <= width + 40 && point.y >= -40 && point.y <= height + 40) candidates.push({ photo, coordinates });
          };
          if (current.isSourceLoaded('photos')) {
            for (const feature of current.querySourceFeatures('photos', { filter: ['!', ['has', 'point_count']] })) {
              const photo = currentPhotos.get(feature.properties?.id);
              if (photo && photo.id !== selectedId) addCandidate(photo);
            }
          } else for (const entry of registry.values()) {
            const photo = currentPhotos.get(entry.photo.id);
            if (photo) addCandidate(photo);
          }
          const selected = selectedId ? currentPhotos.get(selectedId) : undefined;
          if (selected) addCandidate(selected);
          const next = registry.sync(candidates, selectedId);
          if (next) setMarkers(next);
        };
        updateSelection.current = () => {
          (current.getSource('photos') as maplibregl.GeoJSONSource).setData(sourceData());
          syncMarkers();
        };
        current.on('render', syncMarkers);
        syncMarkers();
        current.on('click', 'clusters', async event => {
          const feature = event.features?.[0]; if (!feature || feature.geometry.type !== 'Point') return;
          try { const zoom = await (current.getSource('photos') as maplibregl.GeoJSONSource).getClusterExpansionZoom(feature.properties.cluster_id); if (active) current.easeTo({ center: feature.geometry.coordinates as [number, number], zoom }); } catch { failed(); }
        });
        current.on('mouseenter', 'clusters', () => { current.getCanvas().style.cursor = 'pointer'; });
        current.on('mouseleave', 'clusters', () => { current.getCanvas().style.cursor = ''; });
      });
    } catch { failed(); }
    return () => { active = false; clearTimeout(timeout); updateSelection.current = null; registry?.clear(); map?.getCanvas().removeEventListener('webglcontextlost', failed); map?.remove(); };
  }, [photosKey, attempt]);
  useEffect(() => { updateSelection.current?.(); }, [selectedPhotoId]);
  if (!located.length) return <div className="gallery-empty"><h3>没有可显示的位置</h3><p>当前照片没有 GPS 坐标。</p></div>;
  return <><div className="photo-map" ref={container} aria-label="照片位置地图" data-selected-photo={selectedPhotoId ?? undefined} aria-busy={!ready && !error} data-map-state={error ? 'error' : ready ? 'ready' : 'loading'} />
    {markers.map(entry => createPortal(<PhotoMarkerPin photo={{ id: entry.photo.id, title: entry.photo.title, thumbHash: entry.photo.thumbHash, thumbnail: entry.photo.thumbnail !== entry.photo.src ? entry.photo.thumbnail : '' }}
      isSelected={entry.photo.id === selectedPhotoId} onClick={() => onSelect(entry.photo)} />, entry.element, entry.photo.id))}
    {error && <p className="map-error" role="status">底图暂时不可用，你仍可从下方打开照片。<button onClick={() => setAttempt(n => n + 1)}>重试地图</button></p>}<p className="muted">{located.length} 张照片有位置记录</p><ul className="map-photo-list">{located.map(p => <li key={p.id}><button aria-current={p.id === selectedPhotoId ? 'location' : undefined} onClick={() => onOpen(p)}><img src={p.thumbnail} alt="" loading="lazy" decoding="async"/><span><EllipsisWithTooltip>{p.title}</EllipsisWithTooltip><small><EllipsisWithTooltip>{p.location?.locationName || p.location?.city || `${p.location!.latitude.toFixed(3)}, ${p.location!.longitude.toFixed(3)}`}</EllipsisWithTooltip></small></span></button></li>)}</ul></>;
}
