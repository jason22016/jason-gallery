// Afilmory/Afilmory, packages/ui/src/button/ActionButton.tsx
// 1f65cde6672e5231599182620116ac904e39f548; MIT. See THIRD_PARTY_NOTICES.md.
import { clsxm } from '@afilmory/utils';
import type { ButtonHTMLAttributes } from 'react';

export interface ActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  pill?: boolean;
}

export function ActionButton({ className, active = false, pill = false, type = 'button', children, ...props }: ActionButtonProps) {
  return <button type={type} className={clsxm('icon-button viewer-action-button', pill && 'viewer-action-pill', active && 'viewer-action-active', className)} {...props}>{children}</button>;
}
