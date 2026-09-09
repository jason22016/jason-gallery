import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
const params = new URLSearchParams(location.search);
const mode = params.get('mode') ?? 'auto';
const src = params.get('src') ?? '/hdr.jpg';
const result: Record<string, unknown> = { mode, src, userAgent: navigator.userAgent, dynamicRange: matchMedia('(dynamic-range: high)').matches, nativeWebGPU: Boolean(navigator.gpu), events: [] };
function update(event: string, value: unknown) {
  (result.events as unknown[]).push({ event, value }); result[event] = value;
  document.querySelector('#result')!.textContent = JSON.stringify(result, null, 2);
}
if (mode === 'webgl') Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });
if (mode === 'webgpu-failure') Object.defineProperty(navigator, 'gpu', { value: { requestAdapter: async () => { throw new Error('Injected WebGPU initialization failure'); } }, configurable: true });
if (mode === 'no-gpu') {
  Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...args: unknown[]) {
    if (kind === 'webgl' || kind === 'webgl2' || kind === 'experimental-webgl' || kind === 'webgpu') return null;
    return Reflect.apply(getContext, this, [kind, ...args]);
  } as typeof getContext;
}
// Exercise the site's browser-only facade, independently of any Afilmory app.
const { ImageViewer } = await import('../../src/photo-engine/browser');
update('import', 'ok');
try {
  const r = await fetch(src, { mode: 'cors' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const blob = await r.blob();
  const image = await createImageBitmap(blob);
  const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1;
  const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0, 1, 1); context.getImageData(0, 0, 1, 1);
  update('cors', { status: r.status, type: r.type, bytes: blob.size, canvasReadable: true });
  image.close();
} catch (error) { update('corsError', String(error)); }
function Fixture() {
  const [failed, setFailed] = useState(false);
  if (failed) return <img src={src} alt="SDR fallback fixture" style={{ width: 320 }} onLoad={() => update('fallbackLoaded', true)} onError={() => update('fallbackError', true)} />;
  return <div style={{ width: 640, height: 420 }}><ImageViewer src={src} width={640} height={420} onLoad={() => update('loaded', true)} onHDRChange={hdr => update('hdr', hdr)} onRendererChange={renderer => update('renderer', renderer)} onError={error => { update('viewerError', error.message); setFailed(true); }} /></div>;
}
createRoot(document.querySelector('#root')!).render(<Fixture />);
