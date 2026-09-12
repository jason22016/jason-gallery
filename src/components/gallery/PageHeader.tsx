import { LinearBlur } from './ui/LinearBlur';
import { FloatingActionButton } from './FloatingActionButton';
import { ViewModeSegment } from './ViewModeSegment';

export function PageHeader({ title, count, view, onView, panel, onPanel, hasFilters, customized }: {
  title: string; count: number; view: 'masonry' | 'list'; onView: (mode: 'masonry' | 'list') => void;
  panel: 'search' | 'map' | 'settings' | 'info' | null;
  onPanel: (panel: 'search' | 'map' | 'settings' | 'info') => void;
  hasFilters: boolean; customized: boolean;
}) {
  return <header className="gallery-header">
    <LinearBlur className="gallery-header-blur" tint="var(--color-background)" strength={128} side="top" aria-hidden="true" />
    <div className="gallery-header-content">
      <div className="gallery-heading">
        <a className="gallery-action gallery-home" href="/" aria-label="返回首页" title="返回首页"><i className="gallery-icon i-mingcute-arrow-left-line" aria-hidden="true" /></a>
        <h1 title={title}>{title}</h1><span className="gallery-count" aria-label="照片数量">{count}</span>
      </div>
      <div className="header-actions">
        <ViewModeSegment view={view} onChange={onView} />
        <div className="gallery-action-cluster" role="group" aria-label="图库操作">
          <FloatingActionButton icon="search" label="搜索和筛选" active={hasFilters || panel === 'search'} aria-haspopup="dialog" aria-expanded={panel === 'search'} onClick={() => onPanel('search')} />
          <FloatingActionButton icon="map-pin" label="地图探索" active={panel === 'map'} aria-haspopup="dialog" aria-expanded={panel === 'map'} onClick={() => onPanel('map')} />
          <FloatingActionButton icon="settings-3" label="显示设置" active={customized || panel === 'settings'} aria-haspopup="dialog" aria-expanded={panel === 'settings'} onClick={() => onPanel('settings')} />
          <FloatingActionButton icon="information" label="项目信息" active={panel === 'info'} aria-haspopup="dialog" aria-expanded={panel === 'info'} onClick={() => onPanel('info')} />
        </div>
      </div>
    </div>
  </header>;
}
