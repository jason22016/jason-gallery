import type { Map } from 'maplibre-gl';
import { THEME_DURATION } from '../../../theme/theme';
import { getMapStyle, type MapTheme } from './map-style';

export function getMapTheme(): MapTheme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

type PaintName = Parameters<Map['setPaintProperty']>[1];
type PaintValue = Parameters<Map['setPaintProperty']>[2];

function applyTheme(map: Map, theme: MapTheme, duration: number) {
  // Updating paint preserves the camera, photo source, markers and loaded tiles.
  for (const layer of getMapStyle(theme).layers) {
    if (!map.getLayer(layer.id)) continue;
    for (const [property, value] of Object.entries(layer.paint ?? {})) {
      if (!property.endsWith('-color')) continue;
      map.setPaintProperty(layer.id, `${property}-transition` as PaintName, { duration, delay: 0 });
      map.setPaintProperty(layer.id, property as PaintName, value as PaintValue);
    }
  }
}

export function bindMapTheme(map: Map): () => void {
  const root = document.documentElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let loaded = map.isStyleLoaded();
  const update = () => {
    if (!loaded) return;
    const duration = root.hasAttribute('data-theme-transition') && !reduced.matches ? THEME_DURATION : 0;
    applyTheme(map, getMapTheme(), duration);
  };
  const onLoad = () => { loaded = true; applyTheme(map, getMapTheme(), 0); };
  map.on('style.load', onLoad);
  const observer = new MutationObserver(update);
  observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  reduced.addEventListener('change', update);
  return () => { observer.disconnect(); reduced.removeEventListener('change', update); map.off('style.load', onLoad); };
}
