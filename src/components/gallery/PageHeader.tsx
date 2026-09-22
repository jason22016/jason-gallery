import { EllipsisWithTooltip } from './ui/EllipsisWithTooltip';
import { LinearBlur } from './ui/LinearBlur';
import { FloatingActionButton } from './FloatingActionButton';
import { ViewModeSegment } from './ViewModeSegment';
import { useMobile } from '../../hooks/useMobile';
import { SiteNavigation } from '../SiteNavigation';
import type { GalleryState } from './filters';
import { globalGalleryHref } from './url-state';
import { Icon } from './ui/Icon';
import type { ReactNode } from 'react';

export function PageHeaderFrame({ children }: { children: ReactNode }) {
  return <header className="gallery-header">
    <LinearBlur className="gallery-header-blur" tint="var(--color-background)" strength={128} side="top" aria-hidden="true" />
    <div className="gallery-header-content">{children}</div>
  </header>;
}

type HeaderActionsProps = {
  view: 'masonry' | 'list'; onView: (mode: 'masonry' | 'list') => void;
  panel: 'search' | 'map' | 'settings' | 'info' | null;
  onPanel: (panel: 'search' | 'map' | 'settings' | 'info', anchor: HTMLElement) => void;
  hasFilters: boolean; customized: boolean; project: boolean;
  mapPage?: boolean; state?: GalleryState;
};

// Also rendered by Astro while the gallery bundle loads. Native project details
// can occupy the info button's slot; JavaScript-only actions stay disabled.
export function PageHeaderActions({ view = 'masonry', onView, panel = null, onPanel, hasFilters = false, customized = false, project, mapPage = false, state, mobile = false, children }: Partial<HeaderActionsProps> & { project: boolean; mobile?: boolean; children?: ReactNode }) {
  return <div className="header-actions">
    {!mobile && !mapPage && <ViewModeSegment view={view} onChange={onView} />}
    <div className="gallery-action-cluster" role="group" aria-label="图库操作">
      <FloatingActionButton icon="search" label="搜索和筛选" disabled={!onPanel} active={hasFilters || panel === 'search'} aria-haspopup="dialog" aria-expanded={panel === 'search'} onClick={event => onPanel?.('search', event.currentTarget)} />
      {project && <FloatingActionButton icon="map-pin" label="地图探索" disabled={!onPanel} active={panel === 'map'} aria-haspopup="dialog" aria-expanded={panel === 'map'} onClick={event => onPanel?.('map', event.currentTarget)} />}
      {!project && <a className="gallery-action" href={globalGalleryHref(mapPage ? 'explore' : 'map', state)} aria-label={mapPage ? '浏览全部照片' : '地图探索'} title={mapPage ? 'Explore' : 'Global Map'}><Icon name={mapPage ? 'grid' : 'map-pin'} /></a>}
      <FloatingActionButton icon="settings-3" label="显示设置" disabled={!onPanel} active={customized || panel === 'settings'} aria-haspopup="dialog" aria-expanded={panel === 'settings'} onClick={event => onPanel?.('settings', event.currentTarget)} />
      {project && (children ?? <FloatingActionButton icon="information" label="项目信息" disabled={!onPanel} active={panel === 'info'} aria-haspopup="dialog" aria-expanded={panel === 'info'} onClick={event => onPanel?.('info', event.currentTarget)} />)}
    </div>
  </div>;
}

export function PageHeader({ title, count, ...actions }: HeaderActionsProps & { title: string; count: number }) {
  const { project, mapPage, state } = actions;
  const mobile = useMobile();
  return <PageHeaderFrame>
    <div className="gallery-heading">
      <SiteNavigation current={project ? 'projects' : mapPage ? 'map' : 'explore'} state={project ? undefined : state} compact />
      <h1><EllipsisWithTooltip>{title}</EllipsisWithTooltip></h1><span className="gallery-count" aria-label="照片数量">{count}</span>
    </div>
    <PageHeaderActions {...actions} mobile={mobile} />
  </PageHeaderFrame>;
}
