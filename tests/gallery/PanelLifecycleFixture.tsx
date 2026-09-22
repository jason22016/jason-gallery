import { domMax, LazyMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import Panel from '../../src/components/gallery/Panel';

export function PanelLifecycleFixture() {
  const [open, setOpen] = useState(false);
  const [updates, setUpdates] = useState(0);
  const [closed, setClosed] = useState(0);
  const anchor = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // Loading/progress updates can keep the parent rendering during dismissal.
    const interval = window.setInterval(() => setUpdates(value => value + 1), 50);
    return () => window.clearInterval(interval);
  }, []);
  return <LazyMotion features={domMax}>
    <main data-panel-updates={updates}>
      <button ref={anchor} onClick={() => setOpen(true)}>Open test panel</button>
      <p role="status">Closed {closed} times</p>
    </main>
    {open && <Panel title="Panel lifecycle" anchor={anchor.current} onClose={() => { setClosed(value => value + 1); setOpen(false); }}>
      <p>Panel content</p>
    </Panel>}
  </LazyMotion>;
}
