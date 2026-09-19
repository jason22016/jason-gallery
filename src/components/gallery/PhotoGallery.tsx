import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, LazyMotion, domMax } from 'motion/react';
import { MasonryView } from './MasonryView';
import { PageHeader } from './PageHeader';
import type { GalleryPhoto } from './photos';
import { ListView } from './ListView';
import { SearchPanel } from './SearchPanel';
import { ViewPanel } from './ViewPanel';
import { FilterChip } from './FilterChip';
import { Icon } from './ui/Icon';
import { mapPhotoURL, mapPhotoViewport, resolveMapPhoto, type MapViewport } from './map-state';
import { MapNavigationContext } from './MapNavigation';
import PhotoViewer from '../viewer/PhotoViewer';
import type { GalleryProject, ViewerPhoto } from '../viewer/photos';
import { emptyFilters, galleryFilterOptions, selectPhotos, type Filters, type Sort, type FilterField } from './filters';
import { galleryStateURL, readGalleryState } from './url-state';
import Panel from './Panel';
import { ViewerAttribution } from '../viewer/ViewerAttribution';
import { MapLoadingState } from './map/MapLoadingState';
import { MapPhotoList } from './map/MapPhotoList';
import { validLocation } from '../viewer/metadata';

type MapComponent = typeof import('./PhotoMap').default;
const settingsKey = 'jason-gallery:view:v1';
const projectFields: readonly FilterField[] = ['camera', 'lens', 'tag'];
const globalFields: readonly FilterField[] = ['project', ...projectFields];
export default function PhotoGallery({ photos, title, project }: { photos: readonly GalleryPhoto[]; title: string; project?: GalleryProject }) {
  const root = useRef<HTMLDivElement>(null);
  const panelAnchor = useRef<HTMLElement | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const scrollPosition = useRef(0);
  const mapViewport = useRef<{ key: string; viewport: MapViewport } | null>(null);
  const mapFocusPhoto = useRef<string | null>(null);
  const ownHistoryEntry = useRef(false);
  const historyOwner = useRef(crypto.randomUUID());
  const [initialState] = useState(() => readGalleryState(new URLSearchParams(typeof location === 'undefined' ? '' : location.search)));
  const [filters, setFilters] = useState<Filters>(initialState.filters);
  const [sort, setSort] = useState<Sort>(initialState.sort);
  const [view, setView] = useState<'masonry' | 'list'>('masonry');
  const [columns, setColumns] = useState(0);
  const [panelRequest, setPanelRequest] = useState(0);
  const [panel, setPanel] = useState<'info' | 'search' | 'settings' | 'map' | null>(null);
  const [mapPhotoId, setMapPhotoId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [PhotoMap, setPhotoMap] = useState<MapComponent | null>(null);
  const [mapError, setMapError] = useState(false);
  const [notice, setNotice] = useState('');
  const fields = project ? projectFields : globalFields;
  const options = useMemo(() => galleryFilterOptions(photos, fields), [photos, fields]);
  const projectLabel = options.find(option => option.field === 'project' && option.value === filters.project)?.label;
  const visible = useMemo(() => selectPhotos(photos, filters, sort), [photos, filters, sort]);
  const mapKey = project ? visible.map(photo => photo.id).join(',') : '';
  const selectedMapPhoto = resolveMapPhoto(visible, mapPhotoId);
  const selectedPhoto = (project ? photos : visible).find(p => p.id === selected);
  const sequence = project && selectedPhoto && !visible.some(p => p.id === selected) ? photos : visible;
  const setPhotoURL = useCallback((id: string | null, push = false) => {
    const url = new URL(location.href);
    if (id) url.searchParams.set('photo', id); else url.searchParams.delete('photo');
    history[push ? 'pushState' : 'replaceState']({ ...history.state, galleryViewer: id ? (push ? historyOwner.current : history.state?.galleryViewer) : null }, '', url);
  }, []);
  useEffect(() => {
    root.current?.closest('[data-photo-gallery], [data-project-gallery]')?.setAttribute('data-enhanced', 'true');
    try {
      const settings = JSON.parse(localStorage.getItem(settingsKey) || '{}');
      if (settings.view === 'list' || settings.view === 'masonry') setView(settings.view);
      if (Number.isInteger(settings.columns) && settings.columns >= 0 && settings.columns <= 8) setColumns(settings.columns);
    } catch { /* Storage can be disabled; defaults remain usable. */ }
    const sync = () => {
      const params = new URL(location.href).searchParams;
      const nextView = params.get('view');
      if (nextView === 'list' || nextView === 'masonry') setView(nextView);
      const nextColumns = params.get('columns');
      if (nextColumns !== null && /^[0-8]$/.test(nextColumns)) setColumns(Number(nextColumns));
      const { filters: nextFilters, sort: nextSort } = readGalleryState(params);
      setFilters(nextFilters);
      setSort(nextSort);
      const nextPanel = project && params.get('panel') === 'map' ? 'map' : null;
      setPanel(nextPanel);
      const mapPhoto = nextPanel ? resolveMapPhoto(selectPhotos(photos, nextFilters, 'project'), params.get('mapPhoto')) : null;
      setMapPhotoId(mapPhoto?.id ?? null);
      if ((params.has('mapPhoto') && !mapPhoto) || (!project && params.get('panel') === 'map')) {
        const url = new URL(location.href);
        url.searchParams.delete('mapPhoto');
        if (!project) url.searchParams.delete('panel');
        history.replaceState(history.state, '', url);
      }
      const id = params.get('photo');
      ownHistoryEntry.current = history.state?.galleryViewer === historyOwner.current;
      if (id && !photos.some(p => p.id === id)) {
        setPhotoURL(null); setNotice(project ? '此照片不在当前项目中。' : '此照片不在公开图库中。'); setSelected(null); return;
      }
      if (id && nextPanel !== 'map' && !selectPhotos(photos, nextFilters, 'project').some(photo => photo.id === id)) {
        if (!project) {
          setPhotoURL(null); setNotice('此照片不符合当前筛选条件。'); setSelected(null); return;
        }
        setFilters(emptyFilters);
        const url = galleryStateURL(new URL(location.href), { filters: emptyFilters, sort: nextSort });
        history.replaceState(history.state, '', url);
        setNotice('此照片不符合链接中的筛选条件，已清除筛选。');
      }
      if (id) scrollPosition.current = window.scrollY;
      if (!id) {
        if (nextPanel !== 'map') requestAnimationFrame(() => { window.scrollTo(0, scrollPosition.current); opener.current?.isConnected && opener.current.focus({ preventScroll: true }); });
        ownHistoryEntry.current = false;
      }
      setSelected(id);
    };
    sync(); window.addEventListener('popstate', sync);
    return () => { window.removeEventListener('popstate', sync); };
  }, [photos, project, setPhotoURL]);
  useEffect(() => {
    if (panel !== 'map' || PhotoMap || mapError) return;
    let active = true;
    void import('./PhotoMap').then(module => { if (active) setPhotoMap(() => module.default); }).catch(() => { if (active) setMapError(true); });
    return () => { active = false; };
  }, [panel, PhotoMap, mapError]);
  const open = useCallback((photo: ViewerPhoto, element: HTMLElement | null) => {
    opener.current = element; scrollPosition.current = window.scrollY;
    ownHistoryEntry.current = true; setPhotoURL(photo.id, true); setSelected(photo.id);
  }, [setPhotoURL]);
  const close = useCallback(() => {
    if (ownHistoryEntry.current) { ownHistoryEntry.current = false; history.back(); }
    else { setSelected(null); setPhotoURL(null); }
    requestAnimationFrame(() => { window.scrollTo(0, scrollPosition.current); opener.current?.isConnected && opener.current.focus({ preventScroll: true }); });
  }, [setPhotoURL]);
  const showPhotoOnMap = (photo: ViewerPhoto) => {
    if (!resolveMapPhoto(visible, photo.id)) return;
    history.pushState({ ...history.state, galleryViewer: null }, '', mapPhotoURL(new URL(location.href), photo.id));
    ownHistoryEntry.current = false;
    mapViewport.current = null;
    mapFocusPhoto.current = null;
    setMapPhotoId(photo.id);
    setPanel('map');
    setPanelRequest(value => value + 1);
    setSelected(null);
  };
  const selectMapPhoto = (photo: ViewerPhoto) => {
    if (photo.id === mapPhotoId || !resolveMapPhoto(visible, photo.id)) return;
    history.pushState({ ...history.state, galleryViewer: null }, '', mapPhotoURL(new URL(location.href), photo.id));
    setMapPhotoId(photo.id);
  };
  const clearMapSelection = () => {
    if (!mapPhotoId) return;
    const url = new URL(location.href);
    url.searchParams.delete('mapPhoto');
    history.pushState({ ...history.state, galleryViewer: null }, '', url);
    setMapPhotoId(null);
  };
  const items = useMemo(() => visible.map((photo, index) => ({ photo, index, onOpen: open })), [visible, open]);
  const saveView = (nextView: typeof view, nextColumns = columns) => {
    setView(nextView); setColumns(nextColumns);
    const url = new URL(location.href);
    url.searchParams.set('view', nextView);
    url.searchParams.set('columns', String(nextColumns));
    history.replaceState(history.state, '', url);
    try { localStorage.setItem(settingsKey, JSON.stringify({ view: nextView, columns: nextColumns })); } catch { /* Optional preference. */ }
  };
  const replaceContext = (nextFilters: Filters, nextSort: Sort, map = false) => {
    const url = galleryStateURL(new URL(location.href), { filters: nextFilters, sort: nextSort });
    if (map) url.searchParams.set('panel', 'map'); else url.searchParams.delete('panel');
    if (!map || !resolveMapPhoto(selectPhotos(photos, nextFilters, nextSort), mapPhotoId)) {
      url.searchParams.delete('mapPhoto');
      setMapPhotoId(null);
    }
    history.replaceState(history.state, '', url);
  };
  const changeFilters = (value: Filters) => { setFilters(value); replaceContext(value, sort, panel === 'map'); };
  const closePanel = () => { mapFocusPhoto.current = null; setPanel(null); replaceContext(filters, sort); };
  const hasFilters = Object.values(filters).some(Boolean);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (selected || event.isComposing) return;
      const editing = (event.target as HTMLElement)?.closest('input, textarea, select, [contenteditable="true"]');
      if (((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') || (event.key === '/' && !editing)) {
        event.preventDefault();
        if (panel === 'search') closePanel();
        else { panelAnchor.current = root.current?.querySelector<HTMLElement>('[aria-label="搜索和筛选"]') ?? null; setPanel('search'); replaceContext(filters, sort); }
      }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [selected, panel, filters, sort]);
  const mapNavigation = project && selectedPhoto && resolveMapPhoto(visible, selectedPhoto.id) ? {
    href: mapPhotoURL(new URL(location.href), selectedPhoto.id).href,
    navigate: () => showPhotoOnMap(selectedPhoto),
  } : null;
  return <MapNavigationContext.Provider value={mapNavigation}><LazyMotion features={domMax}><div ref={root} className="gallery-live" data-viewer-ready="true">
    <PageHeader title={title} count={visible.length} view={view} onView={saveView} panel={panel} project={!!project}
      onPanel={(next, anchor) => { setPanelRequest(value => value + 1); panelAnchor.current = anchor; setPanel(next); replaceContext(filters, sort, next === 'map'); }}
      hasFilters={hasFilters} customized={columns !== 0 || sort !== 'project'} />
    {notice && <p className="gallery-notice" role="status">{notice}<button className="icon-button" onClick={() => setNotice('')} aria-label="关闭提示"><Icon name="close" /></button></p>}
    {hasFilters && <div className="filter-summary"><div className="filter-chips"><AnimatePresence initial={false}>{(Object.keys(filters) as (keyof Filters)[]).filter(field => filters[field]).map(field => <FilterChip key={field} field={field} value={field === 'project' ? projectLabel ?? filters[field] : filters[field]} onRemove={() => changeFilters({ ...filters, [field]: '' })} />)}</AnimatePresence></div><div className="filter-summary-count"><span role="status">找到 {visible.length} / {photos.length} 张照片</span><button onClick={() => changeFilters(emptyFilters)}>清除筛选 <Icon name="close" /></button></div></div>}
    {visible.length === 0 ? <div className="gallery-empty"><Icon name="search" /><h2>{photos.length ? '没有符合条件的照片' : '尚无公开照片'}</h2><p>{photos.length ? '试试其他关键词，或清除筛选。' : '发布后的照片会展示在这里。'}</p>{hasFilters && <button onClick={() => changeFilters(emptyFilters)}>清除筛选</button>}</div> : view === 'masonry' ? (
      <MasonryView items={items} columns={columns} />
    ) : <ListView items={items} />}
    {panel && !selected && <Panel key={`${panel}-${panelRequest}`} anchor={panelAnchor.current} kind={panel === 'settings' ? 'settings' : panel === 'search' ? 'search' : panel === 'map' ? 'map' : 'dialog'} title={{ info: '项目信息', search: '搜索和筛选', settings: '显示设置', map: '地图探索' }[panel]} onClose={closePanel} wide={panel === 'map'}>
      {panel === 'info' && project && <><h3 className="project-panel-title">{project.title}</h3>{project.summary && <p>{project.summary}</p>}<dl className="metadata-rows project-details">{project.location && <><dt>地点</dt><dd>{project.location}</dd></>}{project.period && <><dt>日期</dt><dd>{project.period.start}{project.period.end && project.period.end !== project.period.start && ` — ${project.period.end}`}</dd></>}<dt>照片</dt><dd>{photos.length}</dd></dl>{project.description && <p className="project-description">{project.description}</p>}<ul className="tags">{project.tags?.map(tag => <li key={tag}>{tag}</li>)}</ul><ViewerAttribution /></>}
      {panel === 'search' && <SearchPanel options={options} fields={fields} project={!!project} filters={filters} count={visible.length} onChange={changeFilters} onAction={action => {
        if (action === 'masonry' || action === 'list') { saveView(action); closePanel(); }
        else { setPanel(action); replaceContext(filters, sort, action === 'map'); }
      }} />}
      {panel === 'settings' && <ViewPanel sort={sort} columns={columns} view={view} onView={saveView} onSort={value => { setSort(value); replaceContext(filters, value); }} />}
      {panel === 'map' && project && (PhotoMap ? <PhotoMap photos={visible} projectTitle={project.title} onSelect={selectMapPhoto} onClearSelection={clearMapSelection} selectedPhotoId={selectedMapPhoto?.id ?? null} initialViewport={mapViewport.current?.key === mapKey ? mapViewport.current.viewport : mapPhotoViewport(selectedMapPhoto)} onViewport={viewport => { mapViewport.current = { key: mapKey, viewport }; }} restoreFocusPhotoId={mapFocusPhoto.current} onOpen={(photo, element) => { mapFocusPhoto.current = element ? photo.id : null; open(photo, element ?? root.current?.querySelector<HTMLButtonElement>('[aria-label="地图探索"]') ?? null); }} /> : mapError ? <div className="map-experience"><div className="map-right-chrome"><section className="map-fallback"><p role="alert">地图组件加载失败。<button onClick={() => setMapError(false)}>重试</button></p><MapPhotoList photos={visible.filter(photo => validLocation(photo.location))} onOpen={photo => open(photo, null)} /></section></div></div> : <MapLoadingState />)}
    </Panel>}
    {selectedPhoto && <PhotoViewer photos={sequence} collectionTitle={title} index={sequence.findIndex(p => p.id === selected)} trigger={opener.current} onIndex={index => { const photo = sequence[index]; if (photo) { setSelected(photo.id); setPhotoURL(photo.id); } }} onClose={close} />}
  </div></LazyMotion></MapNavigationContext.Provider>;
}
