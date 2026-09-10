import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { LazyMotion, domAnimation, motion, useReducedMotion } from 'motion/react';
import { SharedElementTransitionPreview, useViewerTransitions, useViewerMobileInteractions, computeViewerMediaFrame, projectDismissedViewerMediaFrame, type AnimationFrameRect } from '@afilmory/viewer-motion';
import { X, ChevronLeft, ChevronRight, Share2, PanelRightClose, PanelRightOpen, Info, ExternalLink, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import type { ImageViewer } from '../../photo-engine/browser';
import type { ViewerPhoto } from './photos';
import PhotoThumbnail from '../gallery/PhotoThumbnail';
import { lockPageScroll } from '../gallery/modal';
import MetadataPanel from './MetadataPanel';

export interface ViewerProps {
  photos: readonly ViewerPhoto[]; projectTitle: string; index: number; trigger: HTMLElement | null;
  onIndex: (index: number) => void; onClose: () => void;
}
type Controls = { zoomIn: (animated?: boolean) => void; zoomOut: (animated?: boolean) => void; resetView: () => void; getScale: () => number };
export default function PhotoViewer(props: ViewerProps) {
  return <LazyMotion features={domAnimation}><PhotoDialog {...props} /></LazyMotion>;
}
function PhotoDialog({ photos, projectTitle, index, trigger, onIndex, onClose }: ViewerProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const engine = useRef<Controls | null>(null);
  const navigationFrame = useRef<number | null>(null);
  const titleId = useId();
  const helpId = useId();
  const reduced = !!useReducedMotion();
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 767px), (pointer: coarse)').matches);
  const [inspector, setInspector] = useState(true);
  const [closing, setClosing] = useState(false);
  const [exitFrame, setExitFrame] = useState<AnimationFrameRect | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const [multiplePointers, setMultiplePointers] = useState(false);
  const [message, setMessage] = useState('');
  const [controlsReady, setControlsReady] = useState(false);
  const pointerStart = useRef<{ x: number; y: number; blocked: boolean } | null>(null);
  const pointers = useRef(new Set<number>());
  const photo = photos[index]!;
  const frameLayout = useMemo(() => ({ desktopSidebarWidthRem: inspector ? 20 : 0, desktopThumbnailStripHeight: 76, mobileThumbnailStripHeight: 76 }), [inspector]);
  useLayoutEffect(() => {
    const element = dialog.current!;
    const unlock = lockPageScroll(); element.showModal();
    element.querySelector<HTMLButtonElement>('.viewer-close')?.focus();
    const resize = () => setMobile(window.matchMedia('(max-width: 767px), (pointer: coarse)').matches);
    window.addEventListener('resize', resize);
    return () => { if (navigationFrame.current !== null) cancelAnimationFrame(navigationFrame.current); element.close(); unlock(); window.removeEventListener('resize', resize); };
  }, []);
  const requestClose = useCallback(() => {
    if (closing) return;
    if (navigationFrame.current !== null) cancelAnimationFrame(navigationFrame.current);
    if (reduced) { onClose(); return; }
    setExitFrame(computeViewerMediaFrame(photo, dialog.current?.getBoundingClientRect() ?? null, mobile, frameLayout));
    setClosing(true);
  }, [closing, reduced, onClose, photo, mobile, frameLayout]);
  const transitions = useViewerTransitions({ currentItem: { ...photo, previewSrc: photo.thumbnail, fullSrc: photo.src }, isMobile: mobile, isOpen: !closing, triggerElement: trigger, triggerAttribute: 'data-viewer-trigger', disableEntryTransition: reduced, exitOverrideFrame: exitFrame, layout: frameLayout, onExitComplete: onClose });
  const gestures = useViewerMobileInteractions({ enabled: mobile && !closing && !multiplePointers && !reduced, isImageZoomed: zoomed, onDismiss: snapshot => {
    if (navigationFrame.current !== null) cancelAnimationFrame(navigationFrame.current);
    setExitFrame(projectDismissedViewerMediaFrame({ item: photo, isMobile: mobile, layout: frameLayout, snapshot, viewportRect: dialog.current?.getBoundingClientRect() ?? null }));
    setClosing(true);
  } });
  const detailsVisible = mobile ? gestures.isInspectorVisible || (reduced && inspector) : inspector;
  useLayoutEffect(() => { dialog.current?.querySelector<HTMLElement>('.viewer-inspector')?.scrollTo(0, 0); }, [photo.id, detailsVisible]);
  // In reduced motion mode the mobile inspector is controlled without spring animation.
  useEffect(() => { if (mobile) setInspector(false); else setInspector(true); }, [mobile]);
  useEffect(() => {
    setZoomed(false); setControlsReady(false); setMessage('');
    const focused = document.activeElement;
    if (!dialog.current?.contains(focused) || (focused instanceof HTMLButtonElement && focused.disabled)) dialog.current?.querySelector<HTMLButtonElement>('.viewer-close')?.focus();
    dialog.current?.querySelector<HTMLElement>(`[data-filmstrip-id="${CSS.escape(photo.id)}"]`)?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: reduced ? 'instant' : 'smooth' });
  }, [photo.id, reduced]);
  const navigate = useCallback((next: number) => { if (!closing && next >= 0 && next < photos.length) onIndex(next); }, [closing, photos.length, onIndex]);
  const toggleInspector = () => {
    if (mobile && !reduced) { if (gestures.isInspectorVisible) gestures.reset(); else gestures.openInspector(); } else setInspector(value => !value);
  };
  const share = async () => {
    const url = location.href;
    try {
      if (navigator.share && mobile) await navigator.share({ title: `${photo.title} — ${projectTitle}`, url });
      else if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(url); setMessage('照片链接已复制'); }
      else setMessage(url);
    } catch (error) { if ((error as Error).name !== 'AbortError') setMessage(url); }
  };
  return <dialog ref={dialog} className="photo-dialog" aria-labelledby={titleId} aria-describedby={helpId} onCancel={event => { event.preventDefault(); if (detailsVisible && mobile) toggleInspector(); else requestClose(); }} onKeyDown={event => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'Tab') {
      const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input, select, [tabindex="0"]')].filter(element => element.getClientRects().length && !element.closest('[inert]') && element.tabIndex >= 0);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      return;
    }
    if (event.shiftKey || (event.target instanceof Element && event.target.matches('input, textarea, select'))) return;
    if (event.key === 'ArrowLeft' && !zoomed) { event.preventDefault(); navigate(index - 1); }
    if (event.key === 'ArrowRight' && !zoomed) { event.preventDefault(); navigate(index + 1); }
    if (event.key === 'Home') { event.preventDefault(); navigate(0); }
    if (event.key === 'End') { event.preventDefault(); navigate(photos.length - 1); }
    if (event.key.toLowerCase() === 'i') toggleInspector();
  }}>
    <motion.div className="viewer-backdrop" style={{ backgroundImage: `url("${photo.thumbnail}")`, opacity: mobile ? gestures.backdropOpacity : 1 }} />
    <div ref={transitions.containerRef} className={`viewer-shell ${!mobile && detailsVisible ? 'with-inspector' : ''}`}>
      <div className="viewer-stage">
        <div className="viewer-toolbar"><h2 id={titleId} className="sr-only">{projectTitle} — {photo.title}</h2>
          <span className="viewer-counter" aria-live="polite">{index + 1} / {photos.length}</span>
          <div className="viewer-actions">
            <button className="icon-button" aria-label="放大" title="放大" disabled={!controlsReady} onClick={() => engine.current?.zoomIn(!reduced)}><ZoomIn size={18}/></button>
            <button className="icon-button" aria-label="缩小" title="缩小" disabled={!controlsReady} onClick={() => engine.current?.zoomOut(!reduced)}><ZoomOut size={18}/></button>
            <button className="icon-button" aria-label="适应屏幕" title="适应屏幕" disabled={!controlsReady} onClick={() => engine.current?.resetView()}><RotateCcw size={17}/></button>
            <a className="icon-button" href={photo.src} target="_blank" rel="noreferrer" aria-label="打开原图" title="打开原图"><ExternalLink size={17}/></a>
            <button className="icon-button" aria-label="分享照片" title="分享照片" onClick={share}><Share2 size={17}/></button>
            <button className="icon-button" aria-label="照片信息" title="照片信息 (I)" aria-expanded={detailsVisible} onClick={toggleInspector}>{mobile ? <Info size={18}/> : <PanelRightOpen size={18}/>}</button>
            <button type="button" className="icon-button viewer-close" onClick={requestClose} autoFocus aria-label="关闭照片" title="关闭 (Esc)"><X size={20}/></button>
          </div>
        </div>
        <div className="viewer-gesture-stage" {...gestures.bindStage()} style={{ opacity: transitions.isViewerContentVisible && !closing ? 1 : 0 }}
          onPointerDownCapture={event => {
            pointers.current.add(event.pointerId);
            if (pointers.current.size > 1) { setMultiplePointers(true); if (pointerStart.current) pointerStart.current.blocked = true; }
            else pointerStart.current = { x: event.clientX, y: event.clientY, blocked: zoomed || !!(event.target as Element).closest('button, a') };
          }}
          onPointerCancelCapture={event => { pointers.current.delete(event.pointerId); pointerStart.current = null; if (!pointers.current.size) setMultiplePointers(false); }}
          onPointerUpCapture={event => {
            pointers.current.delete(event.pointerId);
            const start = pointerStart.current;
            if (!pointers.current.size) { setMultiplePointers(false); pointerStart.current = null; }
            if (!start || start.blocked || zoomed || detailsVisible && mobile) return;
            const dx = event.clientX - start.x, dy = event.clientY - start.y;
            // Let touchend reach the gesture recognizer before replacing its image target.
            if (Math.abs(dx) > 65 && Math.abs(dx) > Math.abs(dy) * 1.5) navigationFrame.current = requestAnimationFrame(() => navigate(index + (dx < 0 ? 1 : -1)));
            else if (mobile && reduced && dy < -100 && Math.abs(dy) > Math.abs(dx) * 1.5) setInspector(true);
            else if ((!mobile || reduced) && dy > 120 && Math.abs(dy) > Math.abs(dx) * 1.5) requestClose();
          }}>
          <motion.div className="viewer-drag-content" style={{ x: mobile ? gestures.dismissX : 0, y: mobile ? gestures.viewerLiftY : 0, scale: mobile ? gestures.viewerScale : 1, rotate: mobile ? gestures.viewerRotate : 0 }}><PhotoMedia key={photo.id} photo={photo} engineRef={engine} smooth={!reduced} onZoom={setZoomed} onReady={setControlsReady}/></motion.div>
        </div>
        <button className="icon-button viewer-previous" onClick={() => navigate(index - 1)} disabled={index === 0 || closing} aria-label="上一张照片"><ChevronLeft size={22}/></button>
        <button className="icon-button viewer-next" onClick={() => navigate(index + 1)} disabled={index === photos.length - 1 || closing} aria-label="下一张照片"><ChevronRight size={22}/></button>
        {message && <p className="viewer-message" role="status">{message}</p>}
        <div className="viewer-filmstrip" aria-label="照片缩略图导航">{photos.map((item, i) => <button key={item.id} data-filmstrip-id={item.id} tabIndex={i === index ? 0 : -1} className={i === index ? 'selected' : ''} aria-label={`跳至照片：${item.title}`} aria-current={i === index ? 'true' : undefined} onClick={() => navigate(i)}><PhotoThumbnail photo={item}/></button>)}</div>
      </div>
      {detailsVisible && <aside className={`viewer-inspector ${mobile ? 'mobile-inspector' : ''}`} aria-label="照片信息"><header><span><Info size={14}/> 照片信息</span><button className="icon-button" onClick={toggleInspector} aria-label="收起照片信息">{mobile ? <X size={18}/> : <PanelRightClose size={18}/>}</button></header><MetadataPanel key={photo.id} photo={photo}/></aside>}
      <p id={helpId} className="sr-only">左右方向键切换，Home 和 End 跳至首尾，Escape 关闭。I 显示信息。双击或双指缩放，放大后拖动平移。</p>
    </div>
    {transitions.entryTransition && !reduced && <SharedElementTransitionPreview transition={transitions.entryTransition} onReady={transitions.handleEntryTransitionReady} onComplete={transitions.handleEntryTransitionComplete}/>}
    {transitions.exitTransition && !reduced && <SharedElementTransitionPreview transition={transitions.exitTransition} onComplete={transitions.handleExitAnimationComplete}/>}
  </dialog>;
}
function PhotoMedia({ photo, ...props }: { photo: ViewerPhoto; engineRef: React.RefObject<Controls | null>; onZoom: (zoomed: boolean) => void; onReady: (ready: boolean) => void; smooth: boolean }) {
  const [attempt, setAttempt] = useState(0);
  return <MediaAttempt key={attempt} photo={photo} {...props} onRetry={() => setAttempt(value => value + 1)} />;
}
function MediaAttempt({ photo, onRetry, engineRef, onZoom, onReady, smooth }: { photo: ViewerPhoto; onRetry: () => void; engineRef: React.RefObject<Controls | null>; onZoom: (zoomed: boolean) => void; onReady: (ready: boolean) => void; smooth: boolean }) {
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
  const failed = () => { if (active.current) { setHDR(false); setState('loading'); setMode('image'); onZoom(false); } };
  return <div className="viewer-media" aria-busy={state === 'loading'} data-media-state={state} data-renderer={mode === 'image' ? 'image' : renderer}>
    {state === 'loading' && <img className="viewer-preview" src={photo.thumbnail} alt=""/>}
    {mode === 'gpu' && Engine && <Engine ref={engineRef} src={photo.src} alt={photo.alt} width={photo.width} height={photo.height} smooth={smooth}
      onLoad={() => { if (active.current) { setState('loaded'); onReady(true); } }} onZoomChange={(_original, relative) => onZoom(relative > 1.02)}
      onHDRChange={value => { if (active.current) setHDR(value); }} onRendererChange={value => { if (active.current) setRenderer(value); }} onError={failed} />}
    {mode === 'image' && state !== 'error' && <FallbackImage photo={photo} engineRef={engineRef} onZoom={onZoom} onLoad={() => { setState('loaded'); onReady(true); }} onError={() => { setState('error'); onReady(false); }}/ >}
    {state === 'loading' && <p className="viewer-status" role="status"><span className="loading-dot"/>正在加载照片…</p>}
    {state === 'error' && <div className="viewer-error"><p role="alert">照片加载失败</p><button type="button" onClick={event => { event.currentTarget.closest('dialog')?.querySelector<HTMLButtonElement>('.viewer-close')?.focus(); onRetry(); }}>重新加载</button><a href={photo.src} target="_blank" rel="noreferrer">打开原图 ↗</a></div>}
    {photo.isHDR && <span className="hdr-status">{hdr && state === 'loaded' ? 'HDR active' : 'HDR source'}</span>}
  </div>;
}
function FallbackImage({ photo, engineRef, onZoom, onLoad, onError }: { photo: ViewerPhoto; engineRef: React.RefObject<Controls | null>; onZoom: (zoomed: boolean) => void; onLoad: () => void; onError: () => void }) {
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
    <img className="viewer-fallback" src={photo.src} alt={photo.alt} draggable={false} style={{ transform: `translate(${position.x}px, ${position.y}px) scale(${position.scale})` }} onLoad={onLoad} onError={onError}/>
  </div>;
}
