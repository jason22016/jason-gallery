import { Spring } from '@afilmory/utils';
import { AnimatePresence, m } from 'motion/react';
import { useId, useRef, useState } from 'react';
import type { SemanticRuntimeState } from '../../semantic-search/types';
import { AISearchPanel } from './AISearchPanel';
import { emptyFilters, type Filters, type FilterField, type FilterOption } from './filters';
import { FilterChip, filterIcons, filterLabels } from './FilterChip';
import { usePanelDismiss } from './Panel';
import type { MappedSemanticResult } from './semantic-results';
import type { SemanticQuerySuggestion } from './semantic-suggestions';
import { EllipsisWithTooltip } from './ui/EllipsisWithTooltip';
import { Icon } from './ui/Icon';
import { useReducedMotion } from './ui/useReducedMotion';

export interface SearchPanelSemantic {
  readonly active: boolean;
  readonly state: Readonly<SemanticRuntimeState> | null;
  readonly moduleLoading: boolean;
  readonly moduleError: string;
  readonly query: string;
  readonly suggestions: readonly SemanticQuerySuggestion[];
  readonly outcome: { readonly query: string; readonly results: readonly MappedSemanticResult[] } | null;
  readonly totalResults: number;
  readonly resultLevel: number;
  readonly nextResultLevel: number | null;
  readonly searchError: string;
  activate(seed?: string): void;
  deactivate(): void;
  setQuery(query: string): void;
  submit(): void;
  enable(): void;
  cancel(): void;
  retry(): void;
  chooseSuggestion(query: string): void;
  openResult(result: MappedSemanticResult): void;
  viewAll(): void;
  expandResults(): void;
  resetResults(): void;
  retryQuery(): void;
}

function AISearchButton({ semantic }: { semantic: SearchPanelSemantic }) {
  const reduced = useReducedMotion();
  const status = semantic.state?.status ?? (semantic.moduleLoading ? 'initializing' : 'disabled');
  return <m.button type="button" className="ai-search-button" data-active={semantic.active || undefined} data-state={status}
    aria-pressed={semantic.active} aria-label={semantic.active ? '退出 AI Search，恢复普通搜索' : '开启 AI Search'}
    title={semantic.active ? '恢复 Project、标签和元数据搜索' : '使用本机视觉语义搜索'}
    initial={false} whileTap={reduced ? undefined : { scale: .97 }} transition={Spring.presets.snappy}
    onClick={() => semantic.active ? semantic.deactivate() : semantic.activate()}>
    <Icon name="sparkles-2" /><span>AI Search</span>
  </m.button>;
}

export function SearchPanel({ options, fields, project, mapPage = false, filters, count, onChange, onAction, semantic }: {
  options: readonly FilterOption[]; fields: readonly FilterField[]; project: boolean;
  mapPage?: boolean;
  filters: Filters; count: number; onChange: (filters: Filters) => void;
  onAction: (action: 'settings' | 'info' | 'map' | 'masonry' | 'list') => void;
  semantic?: SearchPanelSemantic;
}) {
  const dismiss = usePanelDismiss();
  const id = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [category, setCategory] = useState<'all' | FilterField>('all');
  const projectLabel = options.find(option => option.field === 'project' && option.value === filters.project)?.label;
  const commands = options.filter(option => category === 'all' || option.field === category);
  const update = (field: keyof Filters, value: string) => onChange({ ...filters, [field]: value });
  const choose = (index: number) => { const option = commands[index]; if (option) update(option.field, filters[option.field] === option.value ? '' : option.value); };
  const navigate = (index: number) => {
    const next = Math.max(0, Math.min(index, commands.length - 1));
    setSelectedIndex(next);
    listRef.current?.querySelectorAll<HTMLButtonElement>('[data-command]')[next]?.scrollIntoView({ block: 'nearest' });
  };
  const aiActive = !!semantic?.active;
  const aiReady = semantic?.state?.status === 'ready' || semantic?.state?.status === 'searching';
  return <form className="search-form" data-search-mode={aiActive ? 'ai' : 'metadata'} onSubmit={event => {
    event.preventDefault();
    if (aiActive) semantic.submit(); else dismiss();
  }}>
    <div className="search-input-row" data-ai-active={aiActive || undefined}>
      <Icon name={aiActive ? 'sparkles-2' : 'search'} />
      <input type="search" aria-label={aiActive ? 'AI Search 自然语言搜索' : '搜索'}
        placeholder={aiActive ? (aiReady ? (project ? '描述当前项目中想找的画面…' : '描述想找的画面…') : '启用后可用自然语言搜索') : '标题、文件名、说明、标签…'}
        autoComplete="off" value={aiActive ? semantic.query : filters.query} disabled={aiActive && !aiReady}
        aria-controls={aiActive ? `${id}-ai-results` : `${id}-commands`}
        aria-activedescendant={!aiActive && selectedIndex >= 0 ? `${id}-${selectedIndex}` : undefined}
        onChange={event => {
          if (aiActive) semantic.setQuery(event.target.value);
          else { update('query', event.target.value); setSelectedIndex(-1); }
        }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          // Close from the focused input without relying on the dialog's
          // document-level Escape listener.
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(); return; }
          if (aiActive) return;
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); navigate(selectedIndex + (event.key === 'ArrowDown' ? 1 : -1)); }
          if (event.key === 'Enter' && selectedIndex >= 0) { event.preventDefault(); choose(selectedIndex); }
        }} />
      {aiActive && semantic.query && <button type="button" className="ai-query-clear icon-button" onClick={() => semantic.setQuery('')} aria-label="清除 AI Search 查询"><Icon name="close" /></button>}
      {!aiActive && <kbd>⌘ K</kbd>}
      {semantic && <AISearchButton semantic={semantic} />}
    </div>
    <div className="search-mode-stack">
      {semantic && <div className="search-mode-ai" id={`${id}-ai-results`} aria-hidden={!aiActive || undefined} inert={!aiActive || undefined}>
        <AISearchPanel project={project} state={semantic.state} moduleLoading={semantic.moduleLoading} moduleError={semantic.moduleError} query={semantic.query}
          suggestions={semantic.suggestions} outcome={semantic.outcome} searchError={semantic.searchError}
          totalResults={semantic.totalResults} resultLevel={semantic.resultLevel} nextResultLevel={semantic.nextResultLevel} onExpandResults={semantic.expandResults} onResetResults={semantic.resetResults}
          onEnable={semantic.enable} onCancel={semantic.cancel} onRetry={semantic.retry} onSuggestion={semantic.chooseSuggestion}
          onOpen={semantic.openResult} onViewAll={semantic.viewAll} onRetryQuery={semantic.retryQuery} />
      </div>}
      <div className="search-mode-metadata" aria-hidden={aiActive || undefined} inert={aiActive || undefined}>
      {semantic && filters.query.trim() && <button type="button" className="ai-command-entry" onClick={() => semantic.activate(filters.query.trim())}>
        <span className="command-icon"><Icon name="sparkles-2" /></span>
        <span className="command-text"><EllipsisWithTooltip>{`Search “${filters.query.trim()}” with AI`}</EllipsisWithTooltip><small>视觉语义搜索 · 查询留在此设备</small></span>
        <Icon name="arrow-right" />
      </button>}
      {Object.values(filters).some(Boolean) && <div className="filter-chips" aria-label="当前筛选"><AnimatePresence initial={false}>
        {(Object.keys(filters) as (keyof Filters)[]).filter(field => filters[field]).map(field => <FilterChip key={field} field={field} value={field === 'project' ? projectLabel ?? filters[field] : filters[field]} onRemove={() => update(field, '')} />)}
      </AnimatePresence></div>}
      <div className="search-filter-heading"><span><Icon name="filter-3" />筛选照片</span><div className="filter-categories" role="group" aria-label="筛选类别">
        {(['all', ...fields] as const).map(field => <button type="button" key={field} aria-pressed={category === field} onClick={() => { setCategory(field); setSelectedIndex(-1); }}>{field === 'all' ? '全部' : filterLabels[field]}</button>)}
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
          data-highlighted={index === selectedIndex || undefined} aria-pressed={filters[option.field] === option.value} aria-label={`${filterLabels[option.field]}：${option.label}`}
          onClick={() => choose(index)} onFocus={() => setSelectedIndex(index)}>
          <span className="command-icon"><Icon name={filterIcons[option.field]} /></span>
          <span className="command-text"><EllipsisWithTooltip>{option.label}</EllipsisWithTooltip><small>{filterLabels[option.field]}</small></span>
          <span className="command-count">{option.count}</span>{filters[option.field] === option.value && <Icon name="check" className="selected-check" />}
        </button>) : <p className="command-empty">当前图库没有这类筛选项</p>}
      </div>
      <details className="date-filter" open={!!filters.start || !!filters.end || undefined}><summary><Icon name="calendar" />拍摄日期</summary>
        <div className="date-fields"><label>开始日期<input type="date" value={filters.start} max={filters.end || undefined} onChange={event => update('start', event.target.value)} /></label><label>结束日期<input type="date" value={filters.end} min={filters.start || undefined} onChange={event => update('end', event.target.value)} /></label></div>
      </details>
      <details className="palette-actions"><summary><Icon name="settings-3" />图库操作</summary><div>
        {([['settings', '显示设置'], ['map', '地图探索'], ['info', '项目信息'], ['masonry', '瀑布流'], ['list', '列表视图']] as const).filter(([action]) => action === 'settings' || (action === 'info' ? project : !mapPage)).map(([action, label]) => <button type="button" key={action} onClick={() => onAction(action)}>{label}<Icon name="arrow-right" /></button>)}
      </div></details>
        <footer className="search-footer"><span className="keyboard-hint"><kbd>↑↓</kbd> 选择 <kbd>↵</kbd> 应用</span><div className="form-actions"><button type="button" onClick={() => { onChange(emptyFilters); setSelectedIndex(-1); }}>重置</button><button type="submit" className="primary-button">查看 {count} 张照片</button></div></footer>
      </div>
    </div>
  </form>;
}
