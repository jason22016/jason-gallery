import type { ButtonHTMLAttributes } from 'react';

export function FloatingActionButton({ icon, label, active, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: string; label: string; active?: boolean }) {
  return <button type="button" {...props} className="gallery-action" aria-label={label} title={label} data-active={active || undefined}>
    <i className={`gallery-icon i-mingcute-${icon}-line`} aria-hidden="true" />
  </button>;
}
