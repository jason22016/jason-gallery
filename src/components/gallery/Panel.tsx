import * as Dialog from '@radix-ui/react-dialog';
import { Spring } from '@afilmory/utils';
import { m } from 'motion/react';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useMobile } from '../../hooks/useMobile';
import { lockPageScroll } from './modal';
import { Icon } from './ui/Icon';
import { useReducedMotion } from './ui/useReducedMotion';
import { MapBackButton } from './map/MapBackButton';
import './map/MapExperience.css';

const PanelDismissContext = createContext<() => void>(() => {});
export const usePanelDismiss = () => useContext(PanelDismissContext);

export default function Panel({ title, onClose, children, wide = false, kind = 'dialog', anchor }: {
  title: string; onClose: () => void; children: ReactNode; wide?: boolean;
  kind?: 'dialog' | 'search' | 'settings' | 'map'; anchor?: HTMLElement | null;
}) {
  const mobile = useMobile();
  const reduced = useReducedMotion();
  const search = kind === 'search';
  const map = kind === 'map';
  const [closing, setClosing] = useState(false);
  const closeCallback = useRef(onClose);
  const closeTimer = useRef<number | undefined>(undefined);
  const closed = useRef(false);
  useLayoutEffect(() => { closeCallback.current = onClose; }, [onClose]);
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);
  const finishClose = useCallback(() => {
    if (closed.current) return;
    closed.current = true;
    window.clearTimeout(closeTimer.current);
    closeCallback.current();
  }, []);
  const [viewportHeight, setViewportHeight] = useState(window.innerHeight);
  useLayoutEffect(() => {
    if (!window.visualViewport) return;
    const visual = window.visualViewport;
    const measure = () => setViewportHeight(visual.height);
    measure();
    visual.addEventListener('resize', measure); visual.addEventListener('scroll', measure);
    return () => { visual.removeEventListener('resize', measure); visual.removeEventListener('scroll', measure); };
  }, []);
  const previous = useRef<HTMLElement | null>(null);
  const surface = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    previous.current = anchor ?? document.activeElement as HTMLElement | null;
    return lockPageScroll();
  }, [anchor]);
  const restoreFocus = (event: Event) => {
    event.preventDefault();
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected && !surface.current?.contains(active)) return;
    previous.current?.isConnected && previous.current.focus({ preventScroll: true });
  };
  const dismiss = () => {
    if (reduced) { finishClose(); return; }
    // Start one deadline at dismissal. Parent renders must not postpone cleanup
    // when the compositor drops an animation-complete callback.
    closeTimer.current ??= window.setTimeout(finishClose, 1_000);
    setClosing(true);
  };
  const autoFocus = (event: Event) => {
    event.preventDefault();
    // Enter the focus trap without opening a touch keyboard. The input remains
    // one tap away; desktop command shortcuts still focus it immediately.
    if (search && (mobile || window.matchMedia('(pointer: coarse)').matches)) {
      surface.current?.focus({ preventScroll: true });
      return;
    }
    (surface.current?.querySelector<HTMLElement>('input:not(:disabled)') ?? surface.current?.querySelector<HTMLElement>('[aria-checked="true"]') ?? surface.current?.querySelector<HTMLElement>('button:not(:disabled)') ?? surface.current)?.focus({ preventScroll: true });
  };
  // Every panel uses the search palette's focus-in transition, including the
  // full-screen map. Mobile panels never translate in from the bottom.
  const motion = {
    initial: reduced ? false as const : { opacity: 0, scale: mobile ? 1.02 : 1.04, filter: `blur(${mobile ? 4 : 8}px)` },
    animate: closing ? { opacity: 0, scale: .98, filter: `blur(${mobile ? 3 : 6}px)` } : { opacity: 1, scale: 1, filter: 'blur(0px)', transitionEnd: { filter: 'none' } },
    transition: reduced ? { duration: 0 } : Spring.smooth(closing ? .22 : .32),
    onAnimationComplete: () => { if (closing) finishClose(); },
  };
  const content = <PanelDismissContext.Provider value={dismiss}>{map ? <><Dialog.Title className="map-panel-title">{title}</Dialog.Title><MapBackButton onBack={dismiss} /></> : <header className="panel-heading"><Dialog.Title>{title}</Dialog.Title><button type="button" className="icon-button" onClick={dismiss} aria-label="关闭面板"><Icon name="close" /></button></header>}<div className="panel-body">{children}</div></PanelDismissContext.Provider>;
  const className = `gallery-panel gallery-dialog ${wide ? 'wide-panel' : ''} ${search ? 'search-panel' : ''} ${map ? 'map-panel' : ''}`;
  // Release Radix's focus trap when closing starts, retaining the surface only
  // for the exit animation. An inert panel cannot remain an open focus scope.
  return <Dialog.Root open={!closing} onOpenChange={open => { if (!open) dismiss(); }}>
    <Dialog.Portal forceMount><Dialog.Overlay asChild><m.div className="gallery-scrim" initial={reduced ? false : { opacity: 0 }} animate={{ opacity: closing ? 0 : 1 }} transition={{ duration: reduced ? 0 : .18, ease: 'easeOut' }} /></Dialog.Overlay>
    <div className={`gallery-dialog-position ${map ? 'map-position' : 'popup-position'}`} style={{ '--panel-viewport-height': `${viewportHeight}px` } as CSSProperties}>
      <Dialog.Content asChild aria-describedby={undefined} aria-label={title} onOpenAutoFocus={autoFocus} onCloseAutoFocus={restoreFocus}>
        <m.div {...motion} ref={surface} tabIndex={-1} className={className} aria-hidden={closing || undefined} inert={closing}>{content}</m.div>
      </Dialog.Content>
    </div></Dialog.Portal>
  </Dialog.Root>;
}
