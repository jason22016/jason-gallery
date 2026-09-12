import * as Dialog from '@radix-ui/react-dialog';
import * as Popover from '@radix-ui/react-popover';
import { Spring } from '@afilmory/utils';
import { m, useDragControls } from 'motion/react';
import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Drawer } from 'vaul';
import { useMobile } from '../../hooks/useMobile';
import { lockPageScroll } from './modal';
import { Icon } from './ui/Icon';
import { useReducedMotion } from './ui/useReducedMotion';

const PanelDismissContext = createContext<() => void>(() => {});
export const usePanelDismiss = () => useContext(PanelDismissContext);

export default function Panel({ title, onClose, children, wide = false, kind = 'dialog', anchor }: {
  title: string; onClose: () => void; children: ReactNode; wide?: boolean;
  kind?: 'dialog' | 'search' | 'settings'; anchor?: HTMLElement | null;
}) {
  const mobile = useMobile();
  const reduced = useReducedMotion();
  const [closing, setClosing] = useState(false);
  const drag = useDragControls();
  const [viewport, setViewport] = useState({ height: window.innerHeight, bottom: 0 });
  useLayoutEffect(() => {
    if (!mobile || !window.visualViewport) return;
    const visual = window.visualViewport;
    const measure = () => setViewport({ height: visual.height, bottom: Math.max(0, window.innerHeight - visual.height - visual.offsetTop) });
    measure();
    visual.addEventListener('resize', measure); visual.addEventListener('scroll', measure);
    return () => { visual.removeEventListener('resize', measure); visual.removeEventListener('scroll', measure); };
  }, [mobile]);
  const previous = useRef<HTMLElement | null>(null);
  const surface = useRef<HTMLDivElement>(null);
  const dropdown = kind === 'settings' && !mobile;
  useLayoutEffect(() => {
    previous.current = document.activeElement as HTMLElement | null;
    const unlock = dropdown ? () => {} : lockPageScroll();
    return () => { unlock(); previous.current?.isConnected && previous.current.focus({ preventScroll: true }); };
  }, [dropdown]);
  const dismiss = () => reduced ? onClose() : setClosing(true);
  const autoFocus = (event: Event) => {
    event.preventDefault();
    (surface.current?.querySelector<HTMLElement>('input') ?? surface.current?.querySelector<HTMLElement>('[aria-checked="true"]') ?? surface.current?.querySelector<HTMLElement>('button') ?? surface.current)?.focus({ preventScroll: true });
  };
  const motion = {
    initial: reduced ? false as const : mobile ? { y: '100%', opacity: 1 } : { y: 8, scale: .96, opacity: 0 },
    animate: closing ? mobile ? { y: '100%', opacity: 1 } : { y: 8, scale: .96, opacity: 0 } : { y: 0, scale: 1, opacity: 1 },
    transition: Spring.presets.snappy,
    onAnimationComplete: () => { if (closing) onClose(); },
  };
  const Heading = dropdown ? 'h2' : mobile ? Drawer.Title : Dialog.Title;
  const content = <PanelDismissContext.Provider value={dismiss}><header className="panel-heading"><Heading>{title}</Heading><button type="button" className="icon-button" onClick={dismiss} aria-label="关闭面板"><Icon name="close" /></button></header><div className="panel-body" data-vaul-no-drag>{children}</div></PanelDismissContext.Provider>;
  const className = `gallery-panel ${wide ? 'wide-panel' : ''} ${mobile ? 'gallery-drawer' : dropdown ? 'gallery-dropdown' : 'gallery-dialog'} ${kind === 'search' ? 'search-panel' : ''}`;
  if (dropdown) return <Popover.Root open onOpenChange={open => { if (!open) dismiss(); }}>
    <Popover.Anchor virtualRef={{ current: anchor ?? previous.current }} />
    <Popover.Portal><Popover.Content forceMount asChild sideOffset={8} align="end" collisionPadding={16} onOpenAutoFocus={autoFocus} onCloseAutoFocus={event => event.preventDefault()} aria-label={title}>
      <m.div {...motion} ref={surface} className={className} aria-hidden={closing || undefined} inert={closing}>{content}</m.div>
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
  if (mobile) return <Drawer.Root open onOpenChange={open => { if (!open) dismiss(); }} handleOnly noBodyStyles autoFocus repositionInputs={false}>
    <Drawer.Portal>
      <Drawer.Overlay className="gallery-scrim" />
      <Drawer.Content asChild aria-describedby={undefined} aria-label={title} onOpenAutoFocus={autoFocus} onCloseAutoFocus={event => event.preventDefault()}>
        <m.div {...motion} ref={surface} className={className} aria-hidden={closing || undefined} inert={closing} style={{ maxHeight: viewport.height - 24, bottom: viewport.bottom }} drag={reduced ? false : 'y'} dragControls={drag} dragListener={false} dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: .5 }} dragSnapToOrigin
          onDragEnd={(_, info) => { if (info.offset.y > 80 || info.velocity.y > 500) dismiss(); }}>
          <button type="button" className="drawer-handle" aria-label="关闭面板手柄" onClick={dismiss} onPointerDown={event => drag.start(event)}><span /></button>
          {content}
        </m.div>
      </Drawer.Content>
    </Drawer.Portal>
  </Drawer.Root>;
  return <Dialog.Root open onOpenChange={open => { if (!open) dismiss(); }}>
    <Dialog.Portal><Dialog.Overlay className="gallery-scrim" /><div className={`gallery-dialog-position ${kind === 'search' ? 'search-position' : ''}`}>
      <Dialog.Content asChild aria-describedby={undefined} aria-label={title} onOpenAutoFocus={autoFocus} onCloseAutoFocus={event => event.preventDefault()}>
        <m.div {...motion} ref={surface} className={className} aria-hidden={closing || undefined} inert={closing}>{content}</m.div>
      </Dialog.Content>
    </div></Dialog.Portal>
  </Dialog.Root>;
}
