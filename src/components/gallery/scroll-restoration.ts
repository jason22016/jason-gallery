import { useEffect, type RefObject } from 'react';

export function useGalleryScrollRestoration(root: RefObject<HTMLElement | null>, position: RefObject<number>, activePhoto: RefObject<string | null>, mapPage: boolean) {
  useEffect(() => {
    if (mapPage) return;
    let frame = 0;
    let observer: ResizeObserver | undefined;
    const inputEvents = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;
    const stop = () => {
      cancelAnimationFrame(frame); observer?.disconnect();
      for (const event of inputEvents) window.removeEventListener(event, stop);
    };
    const save = () => {
      stop();
      try { sessionStorage.setItem(storageKey(), String(activePhoto.current ? position.current : window.scrollY)); } catch { /* Native restoration remains available without storage. */ }
    };
    const storageKey = () => {
      const url = new URL(location.href);
      url.searchParams.delete('photo');
      return `jason-gallery:scroll:${url.href}`;
    };
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    let saved = 0;
    try { if (navigation?.type === 'reload' || navigation?.type === 'back_forward') saved = Number(sessionStorage.getItem(storageKey())); } catch { /* Optional restoration hint. */ }
    if (Number.isFinite(saved) && saved > 0) {
      position.current = saved;
      const restore = () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          window.scrollTo({ top: saved, behavior: 'instant' });
          if (Math.abs(window.scrollY - saved) < 1) stop();
        });
      };
      observer = new ResizeObserver(restore);
      if (root.current) observer.observe(root.current);
      for (const event of inputEvents) window.addEventListener(event, stop, { passive: true });
      restore();
    }
    window.addEventListener('pagehide', save);
    return () => { stop(); window.removeEventListener('pagehide', save); };
  }, [root, position, activePhoto, mapPage]);
}
