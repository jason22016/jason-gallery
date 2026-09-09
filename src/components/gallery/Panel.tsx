import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { lockPageScroll } from './modal';
import { X } from 'lucide-react';
export default function Panel({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const unlock = lockPageScroll(); ref.current?.showModal();
    ref.current?.querySelector<HTMLElement>('input, select')?.focus();
    return () => { unlock(); ref.current?.close(); previous?.isConnected && previous.focus({ preventScroll: true }); };
  }, []);
  return <dialog ref={ref} className={`gallery-panel ${wide ? 'wide-panel' : ''}`} aria-label={title} onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="panel-content"><header className="panel-heading"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="关闭面板"><X size={18} /></button></header><div className="panel-body">{children}</div></div>
  </dialog>;
}
