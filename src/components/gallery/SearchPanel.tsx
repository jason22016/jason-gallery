import { usePanelDismiss } from './Panel';
import { AnimatePresence } from 'motion/react';
import { useId, useMemo, useRef, useState } from 'react';
import { emptyFilters, type Filters } from '../viewer/photos';
import type { GalleryPhoto } from './photos';
import { FilterChip, filterIcons, filterLabels } from './FilterChip';
import { EllipsisWithTooltip } from './ui/EllipsisWithTooltip';
import { Icon } from './ui/Icon';

export function SearchPanel({ photos, filters, count, onChange, onAction }: {
  photos: readonly GalleryPhoto[]; filters: Filters; count: number; onChange: (filters: Filters) => void;
  onAction: (action: 'settings' | 'info' | 'map' | 'masonry' | 'list') => void;
}) {
  const dismiss = usePanelDismiss();
  const id = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [category, setCategory] = useState<'all' | 'camera' | 'lens' | 'tag'>('all');
  const options = useMemo(() => (['camera', 'lens', 'tag'] as const).flatMap(field => {
    const values = [...new Set(photos.flatMap(photo => field === 'tag' ? photo.tags : photo[field]).filter(Boolean))].sort();
    return values.map(value => ({ field, value, count: photos.filter(photo => field === 'tag' ? photo.tags.includes(value) : photo[field] === value).length }));
  }), [photos]);
  const commands = options.filter(option => category === 'all' || option.field === category);
  const update = (field: keyof Filters, value: string) => onChange({ ...filters, [field]: value });
  const choose = (index: number) => { const option = commands[index]; if (option) update(option.field, filters[option.field] === option.value ? '' : option.value); };
  const navigate = (index: number) => {
    const next = Math.max(0, Math.min(index, commands.length - 1));
    setSelectedIndex(next);
    listRef.current?.querySelectorAll<HTMLButtonElement>('[data-command]')[next]?.scrollIntoView({ block: 'nearest' });
  };
  return <form className="search-form" onSubmit={event => { event.preventDefault(); dismiss(); }}>
    <div className="search-input-row"><Icon name="search" /><input type="search" aria-label="搜索" placeholder="标题、文件名、说明、标签…" autoComplete="off" value={filters.query}
      aria-controls={`${id}-commands`} aria-activedescendant={selectedIndex >= 0 ? `${id}-${selectedIndex}` : undefined}
      onChange={event => { update('query', event.target.value); setSelectedIndex(-1); }}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); navigate(selectedIndex + (event.key === 'ArrowDown' ? 1 : -1)); }
        if (event.key === 'Enter' && selectedIndex >= 0) { event.preventDefault(); choose(selectedIndex); }
      }} /><kbd>⌘ K</kbd></div>
    {Object.values(filters).some(Boolean) && <div className="filter-chips" aria-label="当前筛选"><AnimatePresence initial={false}>
      {(Object.keys(filters) as (keyof Filters)[]).filter(field => filters[field]).map(field => <FilterChip key={field} field={field} value={filters[field]} onRemove={() => update(field, '')} />)}
    </AnimatePresence></div>}
    <div className="search-filter-heading"><span><Icon name="filter-3" />筛选照片</span><div className="filter-categories" role="group" aria-label="筛选类别">
      {(['all', 'camera', 'lens', 'tag'] as const).map(field => <button type="button" key={field} aria-pressed={category === field} onClick={() => { setCategory(field); setSelectedIndex(-1); }}>{field === 'all' ? '全部' : filterLabels[field]}</button>)}
    </div></div>
    <div className="command-list" ref={listRef} id={`${id}-commands`} role="group" aria-label="筛选选项" onKeyDown={event => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-command]')];
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)));
      setSelectedIndex(next); buttons[next]?.focus();
    }}>
      {commands.length ? commands.map((option, index) => <button type="button" data-command key={`${option.field}-${option.value}`} id={`${id}-${index}`} className="command-item"
        data-highlighted={index === selectedIndex || undefined} aria-pressed={filters[option.field] === option.value} aria-label={`${filterLabels[option.field]}：${option.value}`}
        onClick={() => choose(index)} onFocus={() => setSelectedIndex(index)}>
        <span className="command-icon"><Icon name={filterIcons[option.field]} /></span>
        <span className="command-text"><EllipsisWithTooltip>{option.value}</EllipsisWithTooltip><small>{filterLabels[option.field]}</small></span>
        <span className="command-count">{option.count}</span>{filters[option.field] === option.value && <Icon name="check" className="selected-check" />}
      </button>) : <p className="command-empty">当前项目没有这类筛选项</p>}
    </div>
    <details className="date-filter" open={!!filters.start || !!filters.end || undefined}><summary><Icon name="calendar" />拍摄日期</summary>
      <div className="date-fields"><label>开始日期<input type="date" value={filters.start} max={filters.end || undefined} onChange={event => update('start', event.target.value)} /></label><label>结束日期<input type="date" value={filters.end} min={filters.start || undefined} onChange={event => update('end', event.target.value)} /></label></div>
    </details>
    <details className="palette-actions"><summary><Icon name="settings-3" />图库操作</summary><div>
      {([['settings', '显示设置'], ['map', '地图探索'], ['info', '项目信息'], ['masonry', '瀑布流'], ['list', '列表视图']] as const).map(([action, label]) => <button type="button" key={action} onClick={() => onAction(action)}>{label}<Icon name="arrow-right" /></button>)}
    </div></details>
    <footer className="search-footer"><span className="keyboard-hint"><kbd>↑↓</kbd> 选择 <kbd>↵</kbd> 应用</span><div className="form-actions"><button type="button" onClick={() => { onChange(emptyFilters); setSelectedIndex(-1); }}>重置</button><button type="submit" className="primary-button">查看 {count} 张照片</button></div></footer>
  </form>;
}
