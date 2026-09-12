import { Spring } from '@afilmory/utils';
import { m } from 'motion/react';
import type { Filters } from '../viewer/photos';
import { Icon } from './ui/Icon';
import { EllipsisWithTooltip } from './ui/EllipsisWithTooltip';
import { useReducedMotion } from './ui/useReducedMotion';

export const filterLabels: Record<keyof Filters, string> = { query: '搜索', camera: '相机', lens: '镜头', tag: '标签', start: '开始日期', end: '结束日期' };
export const filterIcons: Record<keyof Filters, string> = { query: 'search', camera: 'camera', lens: 'aperture', tag: 'tag', start: 'calendar', end: 'calendar' };
export function FilterChip({ field, value, onRemove }: { field: keyof Filters; value: string; onRemove: () => void }) {
  const reduced = useReducedMotion();
  return <m.div className="filter-chip" layout={!reduced} initial={reduced ? false : { opacity: 0, scale: .8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={Spring.presets.snappy}>
    <Icon name={filterIcons[field]} /><EllipsisWithTooltip>{`${filterLabels[field]}：${value}`}</EllipsisWithTooltip>
    <button type="button" className="icon-button" aria-label={`移除${filterLabels[field]}：${value}`} onClick={onRemove}><Icon name="close" /></button>
  </m.div>;
}
