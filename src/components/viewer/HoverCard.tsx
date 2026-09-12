// Adapted from Afilmory/Afilmory, packages/ui/src/hover-card/index.tsx
// Upstream 1f65cde6672e5231599182620116ac904e39f548; MIT, Copyright (c) 2025 Afilmory Team.
// Portal targets the native dialog top layer. See THIRD_PARTY_NOTICES.md.
import * as HoverCardPrimitive from '@radix-ui/react-hover-card';
import { m, useReducedMotion } from 'motion/react';
import { Spring } from '@afilmory/utils';
import type { ComponentPropsWithoutRef } from 'react';
export const HoverCard = HoverCardPrimitive.Root;
export const HoverCardTrigger = HoverCardPrimitive.Trigger;
export function HoverCardContent({ container, children, ...props }: ComponentPropsWithoutRef<typeof HoverCardPrimitive.Content> & { container?: HTMLElement | null }) {
  const reduced = useReducedMotion();
  return <HoverCardPrimitive.Portal container={container}>
    <HoverCardPrimitive.Content align="center" sideOffset={4} {...props} asChild>
      <m.div initial={reduced ? false : { opacity: 0, scale: .95, y: 4 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: .95, y: 4 }} transition={reduced ? { duration: 0 } : Spring.presets.smooth}>
        {children}
      </m.div>
    </HoverCardPrimitive.Content>
  </HoverCardPrimitive.Portal>;
}
