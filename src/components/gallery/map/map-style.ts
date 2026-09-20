import type { StyleSpecification } from 'maplibre-gl';
import mapStyle from '../../viewer/MapLibreStyle.json';

export type MapTheme = 'light' | 'dark';

// Local light palette. The pinned Dark Matter style is never edited.
function lightColor(id: string, property: string): string {
  if (property === 'text-halo-color') return '#f7f8fa';
  if (property === 'icon-color') return '#62768a';
  if (property === 'text-color') {
    if (id.startsWith('water')) return '#54768c';
    if (id.startsWith('poi_')) return '#627969';
    if (id.startsWith('roadname')) return '#697784';
    if (/country|continent|state/.test(id)) return '#586b7c';
    return '#43576b';
  }
  if (id === 'background') return '#f3f5f7';
  if (id === 'water' || id === 'waterway') return '#c6dce8';
  if (id.startsWith('boundary')) return id.includes('country') ? '#a8b5c3' : '#c2ccd5';
  if (id.startsWith('park_')) return '#e1ebe3';
  if (id === 'landcover') return '#eaf0e9';
  if (id === 'landuse_residential') return '#dce2e8';
  if (id === 'landuse') return '#edf0ec';
  if (id.startsWith('building')) return property === 'fill-outline-color' ? '#ccd5de' : '#e0e6ec';
  if (id.startsWith('aeroway')) return '#dce3e9';
  if (id.includes('rail')) return id.endsWith('dash') ? '#f3f5f7' : '#bbc6d0';
  if (id.endsWith('path')) return '#b8c8c0';
  if (id.includes('_case')) return '#d2dbe3';
  if (/_mot_|_trunk_|_pri_/.test(id)) return '#e9d9bc';
  return '#ffffff';
}

function recolor(value: unknown, color: string): unknown {
  if (typeof value === 'string') {
    if (value === 'transparent') return value;
    const alpha = value.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)$/)?.[1];
    return alpha && Number(alpha) < 1 ? color + Math.round(Number(alpha) * 255).toString(16).padStart(2, '0') : color;
  }
  // Preserve zoom stops and transparent values in the original style.
  if (value && typeof value === 'object' && 'stops' in value) {
    return { ...value, stops: (value.stops as [number, unknown][]).map(([zoom, stop]) => [zoom, recolor(stop, color)]) };
  }
  return value;
}

export function getMapStyle(theme: MapTheme = 'dark'): StyleSpecification {
  const style = structuredClone(mapStyle) as StyleSpecification;
  if (theme === 'light') {
    style.name = 'Jason Gallery Light';
    for (const layer of style.layers) {
      const paint = layer.paint as Record<string, unknown> | undefined;
      for (const property of Object.keys(paint ?? {})) {
        if (property.endsWith('-color')) paint![property] = recolor(paint![property], lightColor(layer.id, property));
      }
    }
  }
  return style;
}
