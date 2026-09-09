import { useEffect, useId, useRef, useState } from 'react';
import type { ImageViewer } from '../../photo-engine/browser';
import type { ViewerPhoto } from './photos';

interface Props { photos: readonly ViewerPhoto[]; projectTitle: string; }

export default function PhotoViewer({ photos, projectTitle }: Props) {
  const root = useRef<HTMLSpanElement>(null);
  const opener = useRef<HTMLAnchorElement | null>(null);
  const [index, setIndex] = useState<number | null>(null);

  useEffect(() => {
    const gallery = root.current?.closest('[data-project-gallery]');
    if (!gallery) return;
    const open = (event: Event) => {
      if (!(event instanceof MouseEvent) || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[data-gallery-index]') : null;
      if (!link || !gallery.contains(link) || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
      const selected = Number(link.dataset.galleryIndex);
      if (!Number.isInteger(selected) || !photos[selected]) return;
      event.preventDefault();
      opener.current = link;
      setIndex(selected);
    };
    gallery.addEventListener('click', open);
    root.current?.setAttribute('data-viewer-ready', 'true');
    return () => { gallery.removeEventListener('click', open); };
  }, [photos]);

  return <>
    <span ref={root} hidden />
    {index !== null && <PhotoDialog photos={photos} projectTitle={projectTitle} index={index} onIndex={setIndex} onClose={() => {
      setIndex(null);
      // Wait until the native modal is removed, then restore the exact Gallery trigger.
      requestAnimationFrame(() => opener.current?.isConnected && opener.current.focus({ preventScroll: true }));
    }} />}
  </>;
}

function PhotoDialog({ photos, projectTitle, index, onIndex, onClose }: Props & {
  index: number; onIndex: (index: number) => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const helpId = useId();
  const photo = photos[index]!;
  useEffect(() => {
    const element = dialog.current!;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    element.showModal();
    return () => { element.close(); document.body.style.overflow = previousOverflow; };
  }, []);
  useEffect(() => {
    const element = dialog.current!;
    const focused = document.activeElement;
    // A navigation button can become disabled at a boundary and lose browser focus.
    if (!element.contains(focused) || (focused instanceof HTMLButtonElement && focused.disabled)) {
      element.querySelector<HTMLButtonElement>('.viewer-close')?.focus();
    }
  }, [index]);

  return <dialog ref={dialog} className="photo-dialog" aria-labelledby={titleId} aria-describedby={helpId}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onKeyDown={event => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === 'Tab') {
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]'));
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        return;
      }
      if (event.shiftKey) return;
      if (event.key === 'ArrowLeft') { event.preventDefault(); onIndex(Math.max(0, index - 1)); }
      if (event.key === 'ArrowRight') { event.preventDefault(); onIndex(Math.min(photos.length - 1, index + 1)); }
      if (event.key === 'Home') { event.preventDefault(); onIndex(0); }
      if (event.key === 'End') { event.preventDefault(); onIndex(photos.length - 1); }
    }}>
    <div className="viewer-shell">
      <header className="viewer-toolbar">
        <h2 id={titleId}>{projectTitle}</h2>
        <button type="button" className="viewer-close" onClick={onClose} autoFocus aria-label="Close photo viewer">Close <span aria-hidden="true">×</span></button>
      </header>
      <PhotoMedia key={photo.id} photo={photo} />
      <footer className="viewer-footer">
        <div className="viewer-caption" aria-live="polite" aria-atomic="true"><span className="viewer-counter">{index + 1} / {photos.length}</span><p>{photo.caption ?? photo.alt}</p></div>
        <div className="viewer-actions">
          <a href={photo.src} target="_blank" rel="noopener noreferrer">Original ↗</a>
          <button type="button" onClick={() => onIndex(index - 1)} disabled={index === 0} aria-label="Previous photograph">←</button>
          <button type="button" onClick={() => onIndex(index + 1)} disabled={index === photos.length - 1} aria-label="Next photograph">→</button>
        </div>
      </footer>
      <p id={helpId} className="sr-only">Use left and right arrow keys to change photographs, Home and End to jump to the first and last photograph, and Escape to close.</p>
    </div>
  </dialog>;
}

function PhotoMedia({ photo }: { photo: ViewerPhoto }) {
  const [attempt, setAttempt] = useState(0);
  return <MediaAttempt key={attempt} photo={photo} onRetry={() => setAttempt(value => value + 1)} />;
}

function MediaAttempt({ photo, onRetry }: { photo: ViewerPhoto; onRetry: () => void }) {
  const [Engine, setEngine] = useState<typeof ImageViewer | null>(null);
  const [mode, setMode] = useState<'gpu' | 'image'>('gpu');
  const [state, setState] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [hdr, setHDR] = useState(false);
  const [renderer, setRenderer] = useState<string>('pending');
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    // This is the only runtime import of the engine. The closed Gallery stays lightweight.
    void import('../../photo-engine/browser').then(module => {
      if (active.current) setEngine(() => module.ImageViewer);
    }).catch(() => { if (active.current) setMode('image'); });
    return () => { active.current = false; };
  }, []);

  return <div className="viewer-media" aria-busy={state === 'loading'} data-media-state={state} data-renderer={mode === 'image' ? 'image' : renderer}>
    {mode === 'gpu' && Engine && <Engine src={photo.src} alt={photo.alt} width={photo.width} height={photo.height} smooth={false}
      onLoad={() => { if (active.current) setState('loaded'); }}
      onHDRChange={value => { if (active.current) setHDR(value); }}
      onRendererChange={value => { if (active.current) setRenderer(value); }}
      onError={() => { if (active.current) { setHDR(false); setState('loading'); setMode('image'); } }} />}
    {mode === 'image' && state !== 'error' && <img className="viewer-fallback" src={photo.src} alt={photo.alt}
      onLoad={() => setState('loaded')} onError={() => setState('error')} />}
    {state === 'loading' && <p className="viewer-status" role="status">Loading photograph…</p>}
    {state === 'error' && <div className="viewer-error"><p role="alert">This photograph could not be loaded.</p><button type="button" onClick={event => {
      // Retry removes this button; keep keyboard focus in the still-open dialog.
      event.currentTarget.closest('dialog')?.querySelector<HTMLButtonElement>('.viewer-close')?.focus();
      onRetry();
    }}>Try again</button></div>}
    {photo.isHDR && <span className="hdr-status">{hdr && state === 'loaded' ? 'HDR active' : 'HDR source'}</span>}
  </div>;
}
