import { useEffect, useRef, useState } from 'react';
import type { Sort } from '../viewer/photos';
import { ViewModeSegment } from './ViewModeSegment';
import { Icon } from './ui/Icon';
import { LinearDivider } from './ui/LinearDivider';

export function ViewPanel({ sort, columns, view, onSort, onView }: {
  sort: Sort; columns: number; view: 'masonry' | 'list';
  onSort: (sort: Sort) => void; onView: (view: 'masonry' | 'list', columns?: number) => void;
}) {
  const [preview, setPreview] = useState(columns);
  const latest = useRef(columns);
  useEffect(() => { setPreview(columns); latest.current = columns; }, [columns]);
  const sorts = [
    { value: 'project', label: '项目编排顺序', icon: 'list-ordered' },
    { value: 'desc', label: '拍摄时间：从新到旧', icon: 'sort-descending' },
    { value: 'asc', label: '拍摄时间：从旧到新', icon: 'sort-ascending' },
  ] as const;
  return <div className="view-panel">
    <section><h3>照片视图</h3><ViewModeSegment view={view} onChange={value => onView(value)} /></section>
    <LinearDivider />
    <section><h3>照片排序</h3><div className="sort-options" role="radiogroup" aria-label="照片排序">
      {sorts.map((option, index) => <button type="button" role="radio" aria-checked={sort === option.value} tabIndex={sort === option.value ? 0 : -1} key={option.value}
        onClick={() => onSort(option.value)} onKeyDown={event => {
          const offset = ['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : ['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 0;
          if (!offset) return;
          event.preventDefault();
          const next = (index + offset + sorts.length) % sorts.length;
          onSort(sorts[next]!.value);
          event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus();
        }}><Icon name={option.icon} /><span>{option.label}</span>{sort === option.value && <Icon name="check" className="selected-check" />}</button>)}
    </div></section>
    <LinearDivider />
    <section><h3>瀑布流列数 <output>{preview ? `${preview} 列` : '自动适配'}</output></h3>
      <input className="columns-slider" type="range" style={{ backgroundImage: `linear-gradient(to right, var(--color-accent) ${preview / 8 * 100}%, var(--color-fill) ${preview / 8 * 100}%)` }} min={0} max={8} step={1} value={preview} aria-label="瀑布流列数" aria-valuetext={preview ? `${preview} 列` : '自动适配'}
        onChange={event => { latest.current = Number(event.target.value); setPreview(latest.current); }}
        onPointerUp={() => onView(view, latest.current)} onKeyUp={() => onView(view, latest.current)} onBlur={() => { if (latest.current !== columns) onView(view, latest.current); }} />
      <div className="column-labels" aria-hidden="true"><span>自动</span>{[1,2,3,4,5,6,7,8].map(value => <span key={value} data-active={preview === value || undefined}>{value}</span>)}</div>
      <p className="muted">列数根据屏幕宽度限制；视图偏好保存在此设备。</p>
    </section>
  </div>;
}
