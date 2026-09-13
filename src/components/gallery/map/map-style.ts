import type { StyleSpecification } from 'maplibre-gl';
import mapStyle from '../../viewer/MapLibreStyle.json';

export function getMapStyle(): StyleSpecification {
  return structuredClone(mapStyle) as StyleSpecification;
}
