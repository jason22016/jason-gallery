import { Spring } from '@afilmory/utils';
import { LayoutGroup, m } from 'motion/react';
import { useId } from 'react';
import { useReducedMotion } from './ui/useReducedMotion';

export function ViewModeSegment({ view, onChange }: { view: 'masonry' | 'list'; onChange: (view: 'masonry' | 'list') => void }) {
  const id = useId();
  const reducedMotion = useReducedMotion();
  return <LayoutGroup id={id}><div className="view-segment" role="group" aria-label="照片视图">
    {(['masonry', 'list'] as const).map(mode => <button key={mode} type="button" aria-label={mode === 'masonry' ? '瀑布流' : '列表视图'}
      title={mode === 'masonry' ? '瀑布流' : '列表视图'} aria-pressed={view === mode} onClick={() => onChange(mode)}>
      {view === mode && (reducedMotion ? <span className="segment-indicator" /> : <m.span layoutId="segment-indicator" className="segment-indicator" transition={Spring.presets.snappy} />)}
      <i className={`gallery-icon i-mingcute-${mode === 'masonry' ? 'grid' : 'list-ordered'}-line`} aria-hidden="true" />
    </button>)}
  </div></LayoutGroup>;
}
