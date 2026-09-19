import { EllipsisWithTooltip } from './ui/EllipsisWithTooltip';
import { LinearBlur } from './ui/LinearBlur';
import { FloatingActionButton } from './FloatingActionButton';
import { ViewModeSegment } from './ViewModeSegment';
import { useMobile } from '../../hooks/useMobile';
import { SiteNavigation } from '../SiteNavigation';

export function PageHeader({ title, count, view, onView, panel, onPanel, hasFilters, customized, project }: {
  title: string; count: number; view: 'masonry' | 'list'; onView: (mode: 'masonry' | 'list') => void;
  panel: 'search' | 'map' | 'settings' | 'info' | null;
  onPanel: (panel: 'search' | 'map' | 'settings' | 'info', anchor: HTMLElement) => void;
  hasFilters: boolean; customized: boolean; project: boolean;
}) {
  const mobile = useMobile();
  return <header className="gallery-header">
    <LinearBlur className="gallery-header-blur" tint="var(--color-background)" strength={128} side="top" aria-hidden="true" />
    <div className="gallery-header-content">
      <div className="gallery-heading">
        <SiteNavigation current={project ? 'projects' : 'explore'} compact />
        <h1><EllipsisWithTooltip>{title}</EllipsisWithTooltip></h1><span className="gallery-count" aria-label="照片数量">{count}</span>
      </div>
      <div className="header-actions">
        {!mobile && <ViewModeSegment view={view} onChange={onView} />}
        <div className="gallery-action-cluster" role="group" aria-label="图库操作">
          <FloatingActionButton icon="search" label="搜索和筛选" active={hasFilters || panel === 'search'} aria-haspopup="dialog" aria-expanded={panel === 'search'} onClick={event => onPanel('search', event.currentTarget)} />
          {project && <FloatingActionButton icon="map-pin" label="地图探索" active={panel === 'map'} aria-haspopup="dialog" aria-expanded={panel === 'map'} onClick={event => onPanel('map', event.currentTarget)} />}
          <FloatingActionButton icon="settings-3" label="显示设置" active={customized || panel === 'settings'} aria-haspopup="dialog" aria-expanded={panel === 'settings'} onClick={event => onPanel('settings', event.currentTarget)} />
          {project && <FloatingActionButton icon="information" label="项目信息" active={panel === 'info'} aria-haspopup="dialog" aria-expanded={panel === 'info'} onClick={event => onPanel('info', event.currentTarget)} />}
        </div>
      </div>
    </div>
  </header>;
}
