import * as Tooltip from '@radix-ui/react-tooltip';
import { Spring } from '@afilmory/utils';
import { m } from 'motion/react';
import { useEffect, useState } from 'react';
import { useReducedMotion } from './useReducedMotion';

export function EllipsisWithTooltip({ children, className = '', multiline = false }: { children: string; className?: string; multiline?: boolean }) {
  const [element, setElement] = useState<HTMLSpanElement | null>(null);
  const [overflowed, setOverflowed] = useState(false);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (!element) return;
    const update = () => setOverflowed(multiline ? element.offsetHeight < element.scrollHeight : element.offsetWidth < element.scrollWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, children, multiline]);
  const text = <span ref={setElement} className={`${multiline ? "ellipsis-multiline" : "ellipsis-text"} ${className}`}>{children}</span>;
  if (!overflowed) return text;
  return <Tooltip.Provider delayDuration={400}><Tooltip.Root><Tooltip.Trigger asChild>{text}</Tooltip.Trigger>
    <Tooltip.Portal><Tooltip.Content asChild sideOffset={4}><m.div className="gallery-tooltip"
      initial={reduced ? false : { opacity: 0, scale: .95, y: 4 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={Spring.presets.snappy}>{children}</m.div></Tooltip.Content></Tooltip.Portal>
  </Tooltip.Root></Tooltip.Provider>;
}
