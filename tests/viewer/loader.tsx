import React, { createRef, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PhotoMedia } from '../../src/components/viewer/PhotoViewer';
import type { ViewerPhoto } from '../../src/components/viewer/photos';
import type { ImageViewerRef } from '@afilmory/webgl-viewer';
import { ImageLoaderManager, clearImageCaches, getImageCacheStats } from '../../src/lib/image-loader-manager';
import '../../src/styles/gallery.css';

const engineRef = createRef<ImageViewerRef>();
const root = createRoot(document.querySelector('#root')!);
const events: unknown[] = [];
let ready = false;
function mount(src: string) {
  ready = false;
  const photo = { id: src, src, thumbnail: '/ordinary.jpg', alt: src, width: 96, height: 64, isHDR: src.includes('hdr') } as ViewerPhoto;
  root.render(<StrictMode><PhotoMedia key="same-media-instance" photo={photo} engineRef={engineRef} smooth={true} onZoom={zoomed => events.push({ zoomed })} onReady={value => {
    ready = value; events.push({ ready: value });
    document.querySelector('#result')!.textContent = JSON.stringify({ ready, events });
  }}/></StrictMode>);
}
const api = { mount, close: () => root.render(null), clearImageCaches, getImageCacheStats, ImageLoaderManager,
  getState: () => ({ ready, scale: engineRef.current?.getScale(), events }), zoomIn: () => engineRef.current?.zoomIn(false) };
declare global { interface Window { mediaTest: typeof api } }
window.mediaTest = api;
mount(new URLSearchParams(location.search).get('src') ?? '/ordinary.jpg');
