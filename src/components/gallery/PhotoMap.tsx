import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { validLocation } from '../viewer/metadata';
import type { ViewerPhoto } from '../viewer/photos';
import type { MapViewport } from './map-state';
import { PhotoMarkerPin } from './map/PhotoMarkerPin';
import { PhotoMarkerRegistry, type MarkerCandidate, type PhotoMarkerEntry } from './map/photo-marker-registry';
import { useMobile } from '../../hooks/useMobile';
import { ClusterMarker } from './map/ClusterMarker';
import { ClusterMarkerRegistry, type ClusterCandidate, type ClusterMarkerEntry } from './map/cluster-marker-registry';
import { clusterCaptureProperties, clusterDateProperties } from './map/cluster-preview';
import './map/ClusterMarker.css';
import { getMapStyle } from './map/map-style';
import { calculateMapBounds } from './map/map-bounds';
import { MapControls } from './map/MapControls';
import { MapInfoPanel } from './map/MapInfoPanel';
import { MapLoadingState } from './map/MapLoadingState';
import { MapPhotoList } from './map/MapPhotoList';
import { Icon } from './ui/Icon';

export default function PhotoMap({ photos, projectTitle, onOpen, onSelect, onClearSelection, selectedPhotoId, initialViewport, onViewport }: { photos: readonly ViewerPhoto[]; projectTitle: string; onOpen: (photo: ViewerPhoto, element?: HTMLElement) => void; onSelect: (photo: ViewerPhoto) => void; onClearSelection: () => void; selectedPhotoId: string | null; initialViewport?: MapViewport; onViewport?: (viewport: MapViewport) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const mobile = useMobile();
  const [error, setError] = useState(false);
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [mapInstance, setMapInstance] = useState<maplibregl.Map | null>(null);
  const [markers, setMarkers] = useState<PhotoMarkerEntry[]>([]);
  const [clusters, setClusters] = useState<ClusterMarkerEntry[]>([]);
  const clusterRegistry = useRef<ClusterMarkerRegistry | null>(null);
  const located = useMemo(() => photos.filter(p => validLocation(p.location)), [photos]);
  const byId = useMemo(() => new Map(located.map(photo => [photo.id, photo])), [located]);
  const photoBounds = useMemo(() => calculateMapBounds(located), [located]);
  const photosKey = JSON.stringify(located.map(photo => [photo.id, photo.location!.longitude, photo.location!.latitude]));
  const currentProps = useRef({ located, byId, selectedPhotoId, onViewport });
  currentProps.current = { located, byId, selectedPhotoId, onViewport };
  const updateSelection = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!container.current || !located.length) return;
    let map: maplibregl.Map | undefined;
    let registry: PhotoMarkerRegistry | undefined;
    let nativeClusters: ClusterMarkerRegistry | undefined;
    let observer: ResizeObserver | undefined;
    let active = true;
    setError(false); setReady(false);
    const failed = () => { if (active) setError(true); };
    const timeout = window.setTimeout(failed, 15_000);
    setMarkers([]);
    setClusters([]);
    const sourceData = () => ({ type: 'FeatureCollection' as const, features: currentProps.current.located
      .filter(photo => photo.id !== currentProps.current.selectedPhotoId)
      .map(photo => ({ type: 'Feature' as const, properties: { id: photo.id, ...clusterCaptureProperties(photo.date) }, geometry: { type: 'Point' as const, coordinates: [photo.location!.longitude, photo.location!.latitude] } })) });
    try {
      map = new maplibregl.Map({ container: container.current, style: getMapStyle(), center: [located[0]!.location!.longitude, located[0]!.location!.latitude], zoom: 9, ...initialViewport, attributionControl: { compact: true } });
      setMapInstance(map);
      observer = new ResizeObserver(() => map?.resize());
      observer.observe(container.current);
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
        current.addSource('photos', { type: 'geojson', cluster: true, clusterRadius: 45, clusterProperties: clusterDateProperties, data: sourceData() });
        current.addLayer({ id: 'clusters', type: 'circle', source: 'photos', paint: { 'circle-opacity': 0 } });
        nativeClusters = new ClusterMarkerRegistry(current.getSource('photos') as maplibregl.GeoJSONSource,
          () => currentProps.current.byId,
          candidate => {
            const element = document.createElement('div');
            element.className = 'cluster-marker-host'; element.dataset.clusterId = String(candidate.clusterId);
            const marker = new maplibregl.Marker({ element, anchor: 'center' }).setLngLat(candidate.coordinates).addTo(current);
            return { ...candidate, element, marker, photos: [], previewFailed: false };
          }, setClusters, options => current.easeTo(options), failed);
        clusterRegistry.current = nativeClusters;
        const clearClusters = () => { nativeClusters?.clear(); setClusters([]); };
        current.on('zoomstart', clearClusters);
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
          const clusterCandidates: ClusterCandidate[] = [];
          if (!current.isZooming() && current.isSourceLoaded('photos')) {
            const clusterIds = new Set<number>();
            for (const feature of current.querySourceFeatures('photos', { filter: ['has', 'point_count'] })) {
              if (feature.geometry.type !== 'Point') continue;
              const { cluster_id: clusterId, point_count: pointCount, capture_start: firstDay, capture_end: lastDay } = feature.properties;
              if (!Number.isFinite(clusterId) || !Number.isFinite(pointCount) || clusterIds.has(clusterId)) continue;
              const [longitude, latitude] = feature.geometry.coordinates as [number, number];
              const coordinates: [number, number] = [longitude + Math.round((center - longitude) / 360) * 360, latitude];
              const point = current.project(coordinates);
              if (point.x < -40 || point.x > width + 40 || point.y < -40 || point.y > height + 40) continue;
              clusterIds.add(clusterId);
              clusterCandidates.push({ clusterId, pointCount, coordinates, firstDay, lastDay });
            }
          }
          const nextClusters = nativeClusters?.sync(clusterCandidates);
          if (nextClusters) setClusters(nextClusters);
        };
        updateSelection.current = () => {
          clearClusters();
          (current.getSource('photos') as maplibregl.GeoJSONSource).setData(sourceData());
          syncMarkers();
        };
        current.on('render', syncMarkers);
        syncMarkers();
      });
    } catch { failed(); }
    return () => { active = false; clearTimeout(timeout); observer?.disconnect(); setMapInstance(null); updateSelection.current = null; clusterRegistry.current = null; nativeClusters?.clear(); registry?.clear(); map?.getCanvas().removeEventListener('webglcontextlost', failed); map?.remove(); };
  }, [photosKey, attempt]);
  useEffect(() => { updateSelection.current?.(); }, [selectedPhotoId]);
  if (!located.length) return <div className="map-experience"><div className="map-right-chrome"><MapInfoPanel projectTitle={projectTitle} markersCount={0} bounds={null} /></div><div className="map-empty gallery-empty"><Icon name="map-pin" /><h3>没有可显示的位置</h3><p>当前照片没有 GPS 坐标。</p></div></div>;
  return <div className="map-experience"><div className="photo-map" ref={container} aria-label="照片位置地图" data-selected-photo={selectedPhotoId ?? undefined} aria-busy={!ready && !error} data-map-state={error ? 'error' : ready ? 'ready' : 'loading'} />
    <div className="map-right-chrome">
    <MapInfoPanel projectTitle={projectTitle} markersCount={located.length} bounds={photoBounds} />
    {error ? <section className="map-fallback" aria-label="地图照片列表"><p className="map-error" role="status">底图暂时不可用，你仍可从下方打开照片。<button onClick={() => setAttempt(n => n + 1)}>重试地图</button></p><MapPhotoList photos={located} selectedPhotoId={selectedPhotoId} onOpen={onOpen} /></section>
      : <details className="map-photo-drawer"><summary><Icon name="pic" />照片列表 · {located.length}</summary><MapPhotoList photos={located} selectedPhotoId={selectedPhotoId} onOpen={onOpen} /></details>}
    </div>
    <MapControls map={mapInstance} disabled={!ready || error} />
    {!ready && !error && <MapLoadingState />}
    {markers.map(entry => createPortal(<PhotoMarkerPin photo={entry.photo}
      isSelected={entry.photo.id === selectedPhotoId} enableHover={!mobile} onClick={() => onSelect(entry.photo)} onClose={onClearSelection} onOpen={onOpen} />, entry.element, entry.photo.id))}
    {clusters.map(entry => createPortal(<ClusterMarker cluster={entry} enableHover={!mobile}
      onPreview={() => { void clusterRegistry.current?.load(entry); }} onExpand={() => { void clusterRegistry.current?.expand(entry); }} />, entry.element, String(entry.clusterId)))}
  </div>;
}
