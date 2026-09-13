import { Spring } from '@afilmory/utils';
import { m } from 'motion/react';
import { ActionButton } from '../../viewer/ActionButton';
import { Icon } from '../ui/Icon';
import { useReducedMotion } from '../ui/useReducedMotion';

export function MapBackButton({ onBack }: { onBack: () => void }) {
  const reduced = useReducedMotion();
  return <m.div className="map-back" initial={reduced ? false : { opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}
    whileHover={reduced ? undefined : { scale: 1.1 }} whileTap={reduced ? undefined : { scale: .95 }} transition={Spring.presets.smooth}>
    <ActionButton className="map-glass-button" onClick={onBack} title="返回项目相册" aria-label="返回项目相册"><Icon name="arrow-left" /></ActionButton>
  </m.div>;
}
