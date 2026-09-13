import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PhotoMarkerImage } from '../../src/components/gallery/map/PhotoMarkerImage';

test('map previews load only a lazy thumbnail and never fall back to a missing or original-equal source', () => {
  for (const thumbnail of ['', '/original.jpg']) {
    const html = renderToStaticMarkup(createElement(PhotoMarkerImage, { photo: { src: '/original.jpg', thumbnail, thumbHash: 'malformed' } }));
    assert(!html.includes('<img'));
    assert(!html.includes('/original.jpg'));
  }
  const html = renderToStaticMarkup(createElement(PhotoMarkerImage, { photo: { src: '/original.jpg', thumbnail: '/thumb.jpg', thumbHash: null } }));
  assert(html.includes('src="/thumb.jpg"'));
  assert(html.includes('loading="lazy"'));
  assert(html.includes('decoding="async"'));
  assert(!html.includes('/original.jpg'));
});
