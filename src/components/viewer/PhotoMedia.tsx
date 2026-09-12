import { useCallback, useEffect, useRef, useState } from 'react';
import type { ImageViewer } from '../../photo-engine/browser';
import type { ViewerPhoto } from './photos';
import { useImageLoader } from './useImageLoader';
import { removeImageCacheByUrl } from '../../lib/image-loader-manager';
import { imageViewerConfig } from './image-viewer-config';
export type Controls = { zoomIn: (animated?: boolean) => void; zoomOut: (animated?: boolean) => void; resetView: () => void; getScale: () => number };
export function PhotoMedia({ photo, ...props }: { photo: ViewerPhoto; engineRef: React.RefObject<Controls | null>; onZoom: (zoomed: boolean) => void; onReady: (ready: boolean) => void; smooth: boolean; enablePan?: boolean; onDisplaySrc?: (src: string | null) => void }) {
  const [attempt, setAttempt] = useState(0);
  return <MediaAttempt key={`${photo.src}:${attempt}`} photo={photo} {...props} onRetry={() => { removeImageCacheByUrl(new URL(photo.src, document.baseURI).href); setAttempt(value => value + 1); }} />;
}
function MediaAttempt({ photo, onRetry, engineRef, onZoom, onReady, smooth, enablePan = true, onDisplaySrc }: { photo: ViewerPhoto; onRetry: () => void; engineRef: React.RefObject<Controls | null>; onZoom: (zoomed: boolean) => void; onReady: (ready: boolean) => void; smooth: boolean; enablePan?: boolean; onDisplaySrc?: (src: string | null) => void }) {
  const { blobSrc, highResLoaded, error: loadError, loading } = useImageLoader(photo.src);
  useEffect(() => { onDisplaySrc?.(blobSrc); }, [blobSrc, onDisplaySrc]);
  const [Engine, setEngine] = useState<typeof ImageViewer | null>(null);
  const [mode, setMode] = useState<'gpu' | 'image'>('gpu');
  const [state, setState] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [hdr, setHDR] = useState(false);
  const [renderer, setRenderer] = useState('pending');
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    void import('../../photo-engine/browser').then(module => { if (active.current) setEngine(() => module.ImageViewer); }).catch(() => { if (active.current) setMode('image'); });
    return () => { active.current = false; engineRef.current = null; };
  }, [engineRef]);
  useEffect(() => { if (loadError) setMode('image'); }, [loadError]);
  const failed = () => { if (active.current) { setHDR(false); setState('loading'); setMode('image'); onZoom(false); onReady(false); } };
  return <div className="viewer-media" aria-busy={state === 'loading'} data-media-state={state} data-renderer={mode === 'image' ? 'image' : renderer} data-load-progress={loading.loadingProgress} data-converting={loading.isConverting || undefined} data-queue-waiting={loading.isQueueWaiting || undefined}>
    {state !== 'loaded' && <img className="viewer-preview" src={photo.thumbnail} alt=""/>}
    {mode === 'gpu' && Engine && highResLoaded && blobSrc && <Engine {...imageViewerConfig} style={{ opacity: state === 'loaded' ? 1 : 0 }} ref={engineRef} src={blobSrc} alt={photo.alt} width={photo.width} height={photo.height} smooth={smooth} panning={{ ...imageViewerConfig.panning, disabled: !enablePan }} doubleClick={{ ...imageViewerConfig.doubleClick, animationTime: smooth ? 200 : 0 }}
      onLoadStart={() => { if (active.current) { setState('loading'); setHDR(false); onReady(false); } }}
      onLoad={() => { if (active.current) { setState('loaded'); onReady(true); } }} onZoomChange={(_original, relative) => onZoom(relative > 1.02)}
      onHDRChange={value => { if (active.current) setHDR(value); }} onRendererChange={value => { if (active.current) setRenderer(value); }} onError={failed} />}
    {mode === 'image' && (blobSrc || loadError) && state !== 'error' && <FallbackImage src={blobSrc ?? photo.src} photo={photo} engineRef={engineRef} onZoom={onZoom} onLoad={() => { setState('loaded'); onReady(true); }} onError={() => { setState('error'); onReady(false); }}/ >}
    {state === 'loading' && <p className="viewer-status" role="status"><span className="loading-dot"/>正在加载照片…</p>}
    {state === 'error' && <div className="viewer-error"><p role="alert">照片加载失败</p><button type="button" onClick={event => { event.currentTarget.closest('dialog')?.querySelector<HTMLButtonElement>('.viewer-close')?.focus(); onRetry(); }}>重新加载</button><a href={photo.src} target="_blank" rel="noreferrer">打开原图 ↗</a></div>}
    {photo.isHDR && <span className="hdr-status">{hdr && state === 'loaded' ? 'HDR active' : 'HDR source'}</span>}
  </div>;
}
function FallbackImage({ src, photo, engineRef, onZoom, onLoad, onError }: { src: string; photo: ViewerPhoto; engineRef: React.RefObject<Controls | null>; onZoom: (zoomed: boolean) => void; onLoad: () => void; onError: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const transform = useRef({ scale: 1, x: 0, y: 0 });
  const points = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef(0);
  const lastTap = useRef(0);
  const tapStart = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const [position, setPosition] = useState(transform.current);
  const update = useCallback((scale: number, x = transform.current.x, y = transform.current.y) => {
    const box = ref.current?.getBoundingClientRect();
    scale = Math.max(1, Math.min(10, scale));
    const maxX = (box?.width ?? 0) * (scale - 1) / 2, maxY = (box?.height ?? 0) * (scale - 1) / 2;
    transform.current = { scale, x: Math.max(-maxX, Math.min(maxX, x)), y: Math.max(-maxY, Math.min(maxY, y)) };
    setPosition(transform.current); onZoom(scale > 1.02);
  }, [onZoom]);
  useEffect(() => {
    engineRef.current = { zoomIn: () => update(transform.current.scale * 1.5), zoomOut: () => update(transform.current.scale / 1.5), resetView: () => update(1, 0, 0), getScale: () => transform.current.scale };
    const element = ref.current!;
    const wheel = (event: WheelEvent) => { event.preventDefault(); update(transform.current.scale * Math.exp(-event.deltaY * 0.002)); };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => { element.removeEventListener('wheel', wheel); engineRef.current = null; };
  }, [engineRef, update]);
  return <div ref={ref} className="fallback-stage" onDoubleClick={() => update(transform.current.scale > 1 ? 1 : 2)}
    onPointerDown={e => { points.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); ref.current?.setPointerCapture(e.pointerId); tapStart.current = { x: e.clientX, y: e.clientY, moved: points.current.size > 1 }; pinch.current = 0; }}
    onPointerMove={e => {
      const previous = points.current.get(e.pointerId); if (!previous) return;
      if (tapStart.current && Math.hypot(e.clientX - tapStart.current.x, e.clientY - tapStart.current.y) > 8) tapStart.current.moved = true;
      points.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const fingers = [...points.current.values()];
      if (fingers.length === 2) { const distance = Math.hypot(fingers[0]!.x - fingers[1]!.x, fingers[0]!.y - fingers[1]!.y); if (pinch.current) update(transform.current.scale * distance / pinch.current); pinch.current = distance; }
      else if (transform.current.scale > 1) update(transform.current.scale, transform.current.x + e.clientX - previous.x, transform.current.y + e.clientY - previous.y);
    }}
    onPointerUp={e => {
      points.current.delete(e.pointerId); pinch.current = 0;
      if (e.pointerType === 'touch' && tapStart.current && !tapStart.current.moved) { const now = performance.now(); if (now - lastTap.current < 300) { update(transform.current.scale > 1 ? 1 : 2); lastTap.current = 0; } else lastTap.current = now; }
      tapStart.current = null;
    }} onPointerCancel={e => { points.current.delete(e.pointerId); pinch.current = 0; tapStart.current = null; }}>
    <img className="viewer-fallback" src={src} alt={photo.alt} draggable={false} style={{ transform: `translate(${position.x}px, ${position.y}px) scale(${position.scale})` }} onLoad={onLoad} onError={onError}/>
  </div>;
}
