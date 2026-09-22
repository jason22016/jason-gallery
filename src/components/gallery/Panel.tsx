import * as Dialog from '@radix-ui/react-dialog';
import * as Popover from '@radix-ui/react-popover';
import { Spring } from '@afilmory/utils';
import { m, useDragControls } from 'motion/react';
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Drawer } from 'vaul';
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
  const drawer = mobile && !search;
  const [closing, setClosing] = useState(false);
  const drag = useDragControls();
  const [viewport, setViewport] = useState({ height: window.innerHeight, bottom: 0 });
  useLayoutEffect(() => {
    if ((!mobile && !search) || !window.visualViewport) return;
    const visual = window.visualViewport;
    const measure = () => setViewport({ height: visual.height, bottom: Math.max(0, window.innerHeight - visual.height - visual.offsetTop) });
    measure();
    visual.addEventListener('resize', measure); visual.addEventListener('scroll', measure);
    return () => { visual.removeEventListener('resize', measure); visual.removeEventListener('scroll', measure); };
  }, [mobile, search]);
  const previous = useRef<HTMLElement | null>(null);
  const surface = useRef<HTMLDivElement>(null);
  const dropdown = kind === 'settings' && !mobile;
  useLayoutEffect(() => {
    previous.current = anchor ?? document.activeElement as HTMLElement | null;
    const unlock = dropdown ? () => {} : lockPageScroll();
    return unlock;
  }, [dropdown, anchor]);
  useEffect(() => {
    if (!closing || reduced) return;
    // A dropped animation-complete callback must not leave a controlled
    // Radix modal mounted, inert, and hiding the page from the accessibility tree.
    const fallback = window.setTimeout(onClose, 1_000);
    return () => window.clearTimeout(fallback);
  }, [closing, onClose, reduced]);
  const restoreFocus = (event: Event) => {
    event.preventDefault();
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected && !surface.current?.contains(active)) return;
    previous.current?.isConnected && previous.current.focus({ preventScroll: true });
  };
  const dismiss = () => reduced ? onClose() : setClosing(true);
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
  // Afilmory's CommandPalette focus-in transition, with a lighter blur on mobile.
  const searchMotion = {
    initial: reduced ? false as const : { opacity: 0, scale: mobile ? 1.02 : 1.04, filter: `blur(${mobile ? 4 : 8}px)` },
    animate: closing ? { opacity: 0, scale: .98, filter: `blur(${mobile ? 3 : 6}px)` } : { opacity: 1, scale: 1, filter: 'blur(0px)', transitionEnd: { filter: 'none' } },
    transition: reduced ? { duration: 0 } : Spring.smooth(closing ? .22 : .32),
  };
  const motion = {
    initial: reduced ? false as const : mobile ? { y: '100%', opacity: 1 } : kind === 'map' ? { scale: 1.02, opacity: 0 } : { y: 8, scale: .96, opacity: 0 },
    animate: closing ? mobile ? { y: '100%', opacity: 1 } : { y: 8, scale: .96, opacity: 0 } : { y: 0, scale: 1, opacity: 1 },
    transition: kind === 'map' ? Spring.presets.smooth : Spring.presets.snappy,
    ...(search ? searchMotion : {}),
    onAnimationComplete: () => { if (closing) onClose(); },
  };
  const Heading = dropdown ? 'h2' : drawer ? Drawer.Title : Dialog.Title;
  const content = <PanelDismissContext.Provider value={dismiss}>{kind === 'map' ? <><Heading className="map-panel-title">{title}</Heading><MapBackButton onBack={dismiss} /></> : <header className="panel-heading"><Heading>{title}</Heading><button type="button" className="icon-button" onClick={dismiss} aria-label="关闭面板"><Icon name="close" /></button></header>}<div className="panel-body" data-vaul-no-drag>{children}</div></PanelDismissContext.Provider>;
  const className = `gallery-panel ${wide ? 'wide-panel' : ''} ${drawer ? 'gallery-drawer' : dropdown ? 'gallery-dropdown' : 'gallery-dialog'} ${search ? 'search-panel' : ''} ${kind === 'map' ? 'map-panel' : ''}`;
  if (dropdown) return <Popover.Root open onOpenChange={open => { if (!open) dismiss(); }}>
    <Popover.Anchor virtualRef={{ current: anchor ?? previous.current }} />
    <Popover.Portal><Popover.Content forceMount asChild sideOffset={8} align="end" collisionPadding={16} onOpenAutoFocus={autoFocus} onCloseAutoFocus={restoreFocus} aria-label={title}>
      <m.div {...motion} ref={surface} className={className} aria-hidden={closing || undefined} inert={closing}>{content}</m.div>
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
  if (drawer) return <Drawer.Root open onOpenChange={open => { if (!open) dismiss(); }} handleOnly noBodyStyles autoFocus repositionInputs={false}>
    <Drawer.Portal>
      <Drawer.Overlay className="gallery-scrim" />
      <Drawer.Content asChild aria-describedby={undefined} aria-label={title} onOpenAutoFocus={autoFocus} onCloseAutoFocus={restoreFocus}>
        <m.div {...motion} ref={surface} className={className} aria-hidden={closing || undefined} inert={closing} style={{ maxHeight: viewport.height - 24, bottom: viewport.bottom }} drag={reduced ? false : 'y'} dragControls={drag} dragListener={false} dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: .5 }} dragSnapToOrigin
          onDragEnd={(_, info) => { if (info.offset.y > 80 || info.velocity.y > 500) dismiss(); }}>
          <button type="button" className="drawer-handle" aria-label="关闭面板手柄" onClick={dismiss} onPointerDown={event => drag.start(event)}><span /></button>
          {content}
        </m.div>
      </Drawer.Content>
    </Drawer.Portal>
  </Drawer.Root>;
  return <Dialog.Root open onOpenChange={open => { if (!open) dismiss(); }}>
    <Dialog.Portal>{search ? <Dialog.Overlay asChild><m.div className="gallery-scrim" initial={reduced ? false : { opacity: 0 }} animate={{ opacity: closing ? 0 : 1 }} transition={{ duration: reduced ? 0 : .18, ease: 'easeOut' }} /></Dialog.Overlay> : <Dialog.Overlay className="gallery-scrim" />}
    <div className={`gallery-dialog-position ${search ? 'search-position' : ''} ${kind === 'map' ? 'map-position' : ''}`} style={search ? { '--search-viewport-height': `${viewport.height}px` } as CSSProperties : undefined}>
      <Dialog.Content asChild aria-describedby={undefined} aria-label={title} onOpenAutoFocus={autoFocus} onCloseAutoFocus={restoreFocus}>
        <m.div {...motion} ref={surface} tabIndex={-1} className={className} aria-hidden={closing || undefined} inert={closing}>{content}</m.div>
      </Dialog.Content>
    </div></Dialog.Portal>
  </Dialog.Root>;
}
