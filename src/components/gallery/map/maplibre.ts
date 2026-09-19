import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

// v6 ships a separate ESM worker. Vite must bundle its shared imports too;
// plain ?url works in dev but leaves those imports missing in production.
setWorkerUrl(workerUrl);

export { Map, Marker, LngLatBounds } from 'maplibre-gl';
export type { GeoJSONSource } from 'maplibre-gl';
