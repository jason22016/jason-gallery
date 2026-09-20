import assert from 'node:assert/strict';
import { test } from 'node:test';
import { approximateCoverage, calculateMapBounds } from '../../src/components/gallery/map/map-bounds';
import { getMapStyle } from '../../src/components/gallery/map/map-style';
import originalMapStyle from '../../src/components/viewer/MapLibreStyle.json';

test('Project map bounds validate GPS including zero, southern coordinates, and the filtered subset', () => {
  const photos = [{ location: { latitude: 0, longitude: 0 } }, { location: { latitude: -33.5, longitude: -70.5 } },
    { location: null }, { location: { latitude: 91, longitude: 180 } }, { location: { latitude: 0, longitude: Infinity } }];
  assert.equal(calculateMapBounds([]), null);
  assert.equal(calculateMapBounds(photos.slice(2)), null);
  assert.deepEqual(calculateMapBounds(photos), { minLat: -33.5, maxLat: 0, minLng: -70.5, maxLng: 0 });
  const filtered = calculateMapBounds(photos.slice(0, 1))!;
  assert.deepEqual(filtered, { minLat: 0, maxLat: 0, minLng: 0, maxLng: 0 });
  assert.equal(approximateCoverage(filtered), '0.0');
  assert.equal(approximateCoverage({ minLat: 22.3, maxLat: 22.34, minLng: 114.17, maxLng: 114.22 }), '24.6');
});

test('MiniMap and PhotoMap style instances cannot mutate the shared configuration', () => {
  const first = getMapStyle(), second = getMapStyle();
  assert.deepEqual(first, second);
  first.layers.length = 0;
  delete first.sources.carto;
  assert(second.layers.length > 0);
  assert(second.sources.carto);
  assert.deepEqual(getMapStyle(), second);
});

test('light map changes only colors; the complete original dark style remains identical', () => {
  assert.deepEqual(getMapStyle('dark'), originalMapStyle);
  const light = getMapStyle('light');
  const dark = getMapStyle('dark');
  assert.deepEqual(light.sources, dark.sources);
  assert.equal(light.sprite, dark.sprite);
  assert.equal(light.glyphs, dark.glyphs);
  assert.equal(light.layers.length, dark.layers.length);
  for (const [index, layer] of light.layers.entries()) {
    const { paint, ...configuration } = layer;
    const { paint: originalPaint, ...originalConfiguration } = dark.layers[index]!;
    assert.deepEqual(configuration, originalConfiguration);
    for (const [key, value] of Object.entries(originalPaint ?? {})) {
      if (!key.endsWith('-color')) assert.deepEqual((paint as Record<string, unknown>)[key], value);
    }
  }
  assert.notDeepEqual(light.layers[0]!.paint, dark.layers[0]!.paint);
  assert.deepEqual(getMapStyle('dark'), originalMapStyle, 'light derivation cannot mutate the dark source');
});
