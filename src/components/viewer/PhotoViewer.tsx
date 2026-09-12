// Adapted from Afilmory/Afilmory, apps/web/src/modules/viewer/PhotoViewer.tsx
// Upstream 1f65cde6672e5231599182620116ac904e39f548; AGPL-3.0-or-later + ANL §4, Copyright (c) 2025 Afilmory Team.
// Jason adapter: project/history owner, native dialog, existing media renderer and metadata.
import 'swiper/css';
import './PhotoViewer.css';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { LazyMotion, domAnimation, m, useReducedMotion, useTransform, AnimatePresence } from 'motion/react';
import { Spring } from '@afilmory/utils';
import { SharedElementTransitionPreview, useViewerTransitions, useViewerMobileInteractions, computeViewerMediaFrame,
  projectDismissedViewerMediaFrame, DEFAULT_MOBILE_VIEWER_MEDIA_TRANSFORM_ORIGIN, type AnimationFrameRect } from '@afilmory/viewer-motion';
import { ViewerIcon } from './ViewerIcon';
import { ActionButton } from './ActionButton';
import { ViewerBackdrop } from './ViewerBackdrop';
import { DesktopInspector } from './DesktopInspector';
import { deriveAccentFromSources } from './color';
import type { Swiper as SwiperType } from 'swiper';
import { Navigation, Virtual } from 'swiper/modules';
import { Swiper, SwiperSlide } from 'swiper/react';
import type { ViewerPhoto } from './photos';
import type { Controls } from './PhotoMedia';
import { ProgressiveImage } from './ProgressiveImage';
import { GalleryThumbnail } from './GalleryThumbnail';
import { MobilePhotoInspectorSheet } from './MobilePhotoInspectorSheet';
import { resolvePhotoViewerEntryState, shouldHideCurrentViewerImage } from './entry-animation-state';
import { Thumbhash } from './Thumbhash';
import { useMobile } from '../../hooks/useMobile';
import { lockPageScroll } from '../gallery/modal';
export { PhotoMedia } from './PhotoMedia';

export interface ViewerProps {
  photos: readonly ViewerPhoto[]; projectTitle: string; index: number; trigger: HTMLElement | null;
  onIndex: (index: number) => void; onClose: () => void;
}
export default function PhotoViewer(props: ViewerProps) {
  return <LazyMotion features={domAnimation}><PhotoDialog {...props} /></LazyMotion>;
}
function PhotoDialog({ photos, projectTitle, index, trigger, onIndex, onClose }: ViewerProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const engine = useRef<Controls | null>(null);
  const swiperRef = useRef<SwiperType | null>(null);
  const titleId = useId(), helpId = useId();
  const reduced = !!useReducedMotion();
  const mobile = useMobile();
  const [inspector, setInspector] = useState(false);
  const [closing, setClosing] = useState(false);
  const [exitFrame, setExitFrame] = useState<AnimationFrameRect | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const [multiplePointers, setMultiplePointers] = useState(false);
  const pointers = useRef(new Set<number>());
  const pendingSlide = useRef<number | null>(null);
  const navigationFrame = useRef<number | null>(null);
  const indexOwner = useRef({ index, onIndex });
  indexOwner.current = { index, onIndex };
  const [message, setMessage] = useState('');
  const [controlsReady, setControlsReady] = useState(false);
  const [visualReady, setVisualReady] = useState(false);
  const [currentBlobSrc, setCurrentBlobSrc] = useState<string | null>(null);
  const photo = photos[index]!;
  const [accent, setAccent] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void deriveAccentFromSources({ thumbHash: photo.thumbHash, thumbnailUrl: photo.thumbnail }).then(color => { if (active) setAccent(color); });
    return () => { active = false; };
  }, [photo.thumbHash, photo.thumbnail]);
  const frameLayout = useMemo(() => ({
    get desktopSidebarWidthRem() {
      const width = dialog.current?.querySelector<HTMLElement>('.viewer-inspector-slot')?.getBoundingClientRect().width ?? (inspector ? 320 : 0);
      const rootFontSize = typeof document === 'undefined' ? 16 : parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      return width / rootFontSize;
    },
    get desktopThumbnailStripHeight() { return dialog.current?.querySelector<HTMLElement>('.viewer-thumbnail-bar')?.offsetHeight || 64; },
    get mobileThumbnailStripHeight() { return dialog.current?.querySelector<HTMLElement>('.viewer-thumbnail-bar')?.offsetHeight || 48; },
  }), [inspector]);
  useLayoutEffect(() => {
    const element = dialog.current!;
    const unlock = lockPageScroll(); element.showModal();
    element.querySelector<HTMLButtonElement>('.viewer-close')?.focus();
    return () => { if (navigationFrame.current !== null) cancelAnimationFrame(navigationFrame.current); element.close(); unlock(); };
  }, []);
  const requestClose = useCallback(() => {
    if (closing) return;
    if (reduced) { onClose(); return; }
    setExitFrame(computeViewerMediaFrame(photo, dialog.current?.getBoundingClientRect() ?? null, mobile, frameLayout));
    setClosing(true);
  }, [closing, reduced, onClose, photo, mobile, frameLayout]);
  const transitions = useViewerTransitions({ currentItem: { ...photo, previewSrc: photo.thumbnail, fullSrc: photo.src },
    currentDisplaySrc: currentBlobSrc, isMobile: mobile, isOpen: !closing, triggerElement: trigger,
    triggerAttribute: 'data-viewer-trigger', disableEntryTransition: reduced, exitOverrideFrame: exitFrame,
    layout: frameLayout, onExitComplete: onClose });
  const gestures = useViewerMobileInteractions({ enabled: mobile && !closing && !multiplePointers, reducedMotion: reduced,
    isImageZoomed: zoomed, onDismiss: snapshot => {
      if (reduced) { onClose(); return; }
      setExitFrame(projectDismissedViewerMediaFrame({ item: photo, isMobile: mobile, layout: frameLayout, snapshot,
        viewportRect: dialog.current?.getBoundingClientRect() ?? null }));
      setClosing(true);
    } });
  const opaqueBackdropOpacity = useTransform(() => Math.min(1, gestures.backdropOpacity.get() + Math.max(0, Math.min(1, gestures.inspectorProgress.get())) * .08));
  const detailsVisible = mobile ? gestures.isInspectorVisible : inspector;
  const canSwipe = !zoomed && !multiplePointers && !closing && !(mobile && (gestures.isVerticalGestureActive || detailsVisible));
  useEffect(() => { setInspector(false); }, [mobile]);
  useLayoutEffect(() => { dialog.current?.querySelector<HTMLElement>('.viewer-inspector')?.scrollTo(0, 0); }, [photo.id, detailsVisible]);
  useLayoutEffect(() => { setControlsReady(false); setCurrentBlobSrc(null); }, [photo.id]);
  useEffect(() => {
    if (swiperRef.current && swiperRef.current.activeIndex !== index) swiperRef.current.slideTo(index, reduced ? 0 : 300);
    setZoomed(false); setMessage(''); setExitFrame(null);
    if (mobile) gestures.reset();
    const focused = document.activeElement;
    if (!dialog.current?.contains(focused) || (focused instanceof HTMLButtonElement && focused.disabled)) dialog.current?.querySelector<HTMLButtonElement>('.viewer-close')?.focus();
  }, [photo.id, index, mobile, reduced, gestures.reset]);
  useEffect(() => { if (swiperRef.current) swiperRef.current.allowTouchMove = canSwipe; }, [canSwipe]);
  useEffect(() => { if (mobile && zoomed && detailsVisible) gestures.closeInspector(); }, [mobile, zoomed, detailsVisible, gestures.closeInspector]);
  const navigate = useCallback((next: number) => {
    if (closing || next < 0 || next >= photos.length) return;
    swiperRef.current?.slideTo(next, reduced ? 0 : 300);
  }, [closing, photos.length, reduced]);
  const previous = () => { if (!closing && index > 0) swiperRef.current?.slidePrev(reduced ? 0 : 300); };
  const next = () => { if (!closing && index < photos.length - 1) swiperRef.current?.slideNext(reduced ? 0 : 300); };
  const toggleInspector = () => {
    if (mobile) gestures.toggleInspector();
    else {
      if (inspector && dialog.current?.querySelector('.viewer-inspector')?.contains(document.activeElement)) dialog.current?.querySelector<HTMLButtonElement>('[aria-label="照片信息"]')?.focus();
      setInspector(value => !value);
    }
  };
  const closeInspector = () => { gestures.closeInspector(); dialog.current?.querySelector<HTMLButtonElement>('.viewer-close')?.focus(); };
  const share = async () => {
    const url = location.href;
    try {
      if (navigator.share && mobile) await navigator.share({ title: `${photo.title} — ${projectTitle}`, url });
      else if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(url); setMessage('照片链接已复制'); }
      else setMessage(url);
    } catch (error) { if ((error as Error).name !== 'AbortError') setMessage(url); }
  };
  const { shouldMountImageStage, shouldShowEntryImageCatchup } = resolvePhotoViewerEntryState({
    hasTransitionTrigger: transitions.hasTransitionTrigger, isCurrentImageVisualReady: visualReady,
    isEntryTransitionActive: !!transitions.entryTransition, isOpen: !closing, isViewerContentVisible: transitions.isViewerContentVisible,
  });
  const chromeVisible = transitions.isViewerContentVisible && !closing;
  const blocked = closing || !transitions.isViewerContentVisible || transitions.isEntryAnimating;
  const releasePointer = (pointerId: number) => {
    pointers.current.delete(pointerId);
    if (!pointers.current.size) {
      setMultiplePointers(false);
      if (pendingSlide.current !== null) {
        // Virtual emits slideChange during setTranslate. Keep the native touch target
        // alive until touchend reaches Swiper, then publish its final active index.
        navigationFrame.current = requestAnimationFrame(() => {
          pendingSlide.current = null;
          const activeIndex = swiperRef.current?.activeIndex;
          if (activeIndex !== undefined && activeIndex !== indexOwner.current.index) indexOwner.current.onIndex(activeIndex);
        });
      }
    }
  };
  const handleKeyDown = (event: KeyboardEvent) => {
      if (!dialog.current?.open) return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === 'Escape') { event.preventDefault(); if (detailsVisible && mobile) closeInspector(); else requestClose(); return; }
      if (event.key === 'Tab') {
        const controls = [...dialog.current.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input, select, [tabindex="0"]')].filter(element => element.getClientRects().length && !element.closest('[inert]') && element.tabIndex >= 0);
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        return;
      }
      if (event.shiftKey || (event.target instanceof Element && event.target.matches('input, textarea, select'))) return;
      if (event.key === 'ArrowLeft' && !zoomed) { event.preventDefault(); previous(); }
      if (event.key === 'ArrowRight' && !zoomed) { event.preventDefault(); next(); }
      if (event.key === 'Home') { event.preventDefault(); navigate(0); }
      if (event.key === 'End') { event.preventDefault(); navigate(photos.length - 1); }
      if (event.key.toLowerCase() === 'i') toggleInspector();
  };
  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  });
  useEffect(() => {
    const release = (event: PointerEvent) => releasePointer(event.pointerId);
    document.addEventListener('pointerup', release, true);
    document.addEventListener('pointercancel', release, true);
    return () => { document.removeEventListener('pointerup', release, true); document.removeEventListener('pointercancel', release, true); };
  }, []);
  return <dialog ref={dialog} className="photo-dialog" data-mobile={mobile} data-closing={closing || undefined}
    aria-labelledby={titleId} aria-describedby={helpId} style={{ '--color-accent': accent ?? undefined } as CSSProperties}
    onCancel={event => { event.preventDefault(); if (detailsVisible && mobile) closeInspector(); else requestClose(); }}
>
    <ViewerBackdrop photo={photo} closing={closing} reduced={reduced} opacity={mobile ? gestures.backdropOpacity : 1} baseOpacity={mobile ? opaqueBackdropOpacity : 1}/>
    <div ref={transitions.containerRef} className={`viewer-shell ${!mobile && detailsVisible ? 'with-inspector' : ''}`} style={{ pointerEvents: blocked ? 'none' : 'auto' }}>
      <div className="viewer-stage" {...(mobile ? gestures.bindStage() : {})}
        onPointerDownCapture={event => { pointers.current.add(event.pointerId); if (pointers.current.size > 1) { setMultiplePointers(true); if (swiperRef.current) swiperRef.current.allowTouchMove = false; } }}>
        <m.div className="viewer-drag-content" style={mobile ? { x: gestures.dismissX, y: gestures.viewerLiftY, scale: gestures.viewerScale,
          rotate: gestures.viewerRotate, borderRadius: gestures.viewerBorderRadius, transformOrigin: DEFAULT_MOBILE_VIEWER_MEDIA_TRANSFORM_ORIGIN } : undefined}>
          <div className="viewer-image-stage">
            <div className="viewer-chrome-presence" style={{ opacity: chromeVisible ? 1 : 0 }}>
              <m.div className="viewer-toolbar" inert={mobile && detailsVisible} style={mobile ? { opacity: gestures.chromeOpacity, y: gestures.chromeY } : undefined}>
                <h2 id={titleId} className="sr-only">{projectTitle} — {photo.title}</h2>
                <span className="viewer-counter" aria-live="polite">{index + 1} / {photos.length}</span>
                <div className="viewer-actions">
                  <ActionButton className="viewer-secondary-action" aria-label="放大" title="放大" disabled={!controlsReady} onClick={() => engine.current?.zoomIn(!reduced)}><ViewerIcon name="zoom-in-line" size={18}/></ActionButton>
                  <ActionButton className="viewer-secondary-action" aria-label="缩小" title="缩小" disabled={!controlsReady} onClick={() => engine.current?.zoomOut(!reduced)}><ViewerIcon name="zoom-out-line" size={18}/></ActionButton>
                  <ActionButton className="viewer-secondary-action" aria-label="适应屏幕" title="适应屏幕" disabled={!controlsReady} onClick={() => engine.current?.resetView()}><ViewerIcon name="refresh-2-line" size={17}/></ActionButton>
                  <a className="icon-button viewer-action-button viewer-secondary-action" href={photo.src} target="_blank" rel="noreferrer" aria-label="打开原图" title="打开原图"><ViewerIcon name="external-link-line" size={17}/></a>
                  <ActionButton className="icon-button" aria-label="分享照片" title="分享照片" onClick={share}><ViewerIcon name="share-2-line" size={17}/></ActionButton>
                  <ActionButton className="viewer-info-button" active={detailsVisible} aria-label="照片信息" title="照片信息 (I)" aria-expanded={detailsVisible} onClick={toggleInspector}>{mobile ? <ViewerIcon name="information-line" size={18}/> : <ViewerIcon name="layout-right-line" size={18}/>}</ActionButton>
                  <ActionButton type="button" className="icon-button viewer-close" onClick={requestClose} autoFocus aria-label="关闭照片" title="关闭 (Esc)"><ViewerIcon name="close-line" size={20}/></ActionButton>
                </div>
              </m.div>
            </div>
            <div className="viewer-gesture-stage" data-photo-viewer-stage="true" style={{ opacity: chromeVisible ? 1 : 0 }}>
              {shouldShowEntryImageCatchup && <div className="viewer-entry-catchup" data-photo-viewer-entry-catchup="true">
                {photo.thumbHash && <Thumbhash thumbHash={photo.thumbHash}/>}
                <img className="viewer-preview" src={photo.thumbnail || photo.src} alt="" draggable={false}/>
              </div>}
              {shouldMountImageStage && <Swiper modules={[Navigation, Virtual]} spaceBetween={0} slidesPerView={1} initialSlide={index} virtual
                speed={reduced ? 0 : 300} allowTouchMove={canSwipe} className="viewer-swiper"
                onSwiper={swiper => { swiperRef.current = swiper; swiper.allowTouchMove = canSwipe; }}
                onBeforeDestroy={() => { swiperRef.current = null; }}
                onSlideChange={swiper => {
                  if (closing) return;
                  if (pointers.current.size) pendingSlide.current = swiper.activeIndex;
                  else if (swiper.activeIndex !== index) onIndex(swiper.activeIndex);
                }}>
                {photos.map((item, slideIndex) => {
                  const isCurrentImage = slideIndex === index;
                  const hidden = shouldHideCurrentViewerImage({ isCurrentImage, isEntryImageCatchupVisible: shouldShowEntryImageCatchup });
                  const suppressEntry = reduced || (isCurrentImage && !!transitions.entryTransition);
                  return <SwiperSlide key={item.id} virtualIndex={slideIndex} data-photo-id={item.id} inert={!isCurrentImage} aria-hidden={!isCurrentImage}>
                    <m.div className="viewer-slide-content" initial={suppressEntry ? false : { opacity: .5, scale: .95 }}
                      animate={suppressEntry ? undefined : { opacity: 1, scale: 1 }} transition={suppressEntry ? undefined : Spring.presets.smooth}>
                      <div className="viewer-slide-visibility" style={{ opacity: hidden ? 0 : 1, pointerEvents: hidden ? 'none' : undefined }}>
                        <ProgressiveImage photo={item} isCurrentImage={isCurrentImage} shouldRenderHighRes={isCurrentImage && chromeVisible}
                          engineRef={engine} smooth={!reduced} enablePan={!mobile || zoomed} onZoomChange={setZoomed}
                          onReady={setControlsReady} onBlobSrcChange={setCurrentBlobSrc} onVisualReadyChange={setVisualReady}/>
                      </div>
                    </m.div>
                  </SwiperSlide>;
                })}
              </Swiper>}
              {mobile && <m.div className="viewer-gesture-hint" aria-hidden="true" style={{ opacity: gestures.stageHintOpacity, y: gestures.stageHintY }}>
                <ViewerIcon name="arrow-up-line" size={14}/><span>信息</span><ViewerIcon name="information-line" size={14}/><span className="hint-divider"/><ViewerIcon name="arrow-down-line" size={14}/><span>关闭</span><ViewerIcon name="close-line" size={14}/>
              </m.div>}
            </div>
            {!mobile && <><ActionButton className="viewer-previous" onClick={previous} disabled={index === 0 || closing} aria-label="上一张照片"><ViewerIcon name="left-line" size={20}/></ActionButton>
              <ActionButton className="viewer-next" onClick={next} disabled={index === photos.length - 1 || closing} aria-label="下一张照片"><ViewerIcon name="right-line" size={20}/></ActionButton></>}
            {message && <p className="viewer-message" role="status">{message}</p>}
          </div>
          <m.div className="viewer-thumbnails-motion" data-viewer-interactive inert={mobile && detailsVisible} style={mobile ? { opacity: gestures.thumbnailsOpacity, y: gestures.thumbnailsY } : undefined}>
            <AnimatePresence><GalleryThumbnail key="thumbnails" currentIndex={index} photos={photos} onIndexChange={navigate} visible={chromeVisible} disableEntryTransition={reduced}/></AnimatePresence>
          </m.div>
        </m.div>
      </div>
      {mobile ? <MobilePhotoInspectorSheet currentPhoto={photo} isInteractive={detailsVisible && !closing} progress={gestures.inspectorProgress} onClose={closeInspector}/>
        : <DesktopInspector photo={photo} open={detailsVisible} visible={chromeVisible} reduced={reduced} onClose={toggleInspector}/>}

      <p id={helpId} className="sr-only">左右方向键切换，Home 和 End 跳至首尾，Escape 关闭。I 显示信息。双击或双指缩放，放大后拖动平移。</p>
    </div>
    {transitions.entryTransition && !reduced && <SharedElementTransitionPreview key={`entry-${transitions.entryTransition.itemId}`} transition={transitions.entryTransition} onReady={transitions.handleEntryTransitionReady} onComplete={transitions.handleEntryTransitionComplete} renderPlaceholder={hash => <Thumbhash thumbHash={hash}/>}/>}
    {transitions.exitTransition && !reduced && <SharedElementTransitionPreview key={`exit-${transitions.exitTransition.itemId}`} transition={transitions.exitTransition} onComplete={transitions.handleExitAnimationComplete} renderPlaceholder={hash => <Thumbhash thumbHash={hash}/>}/>}
  </dialog>;
}
