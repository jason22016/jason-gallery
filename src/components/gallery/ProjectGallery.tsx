import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type MouseEvent } from 'react';
import { type RenderComponentProps } from 'masonic';
import { LazyMotion, domMax } from 'motion/react';
import { MasonryView } from './MasonryView';
import { PageHeader } from './PageHeader';
import type { GalleryPhoto } from './photos';
import { Search, X, Camera } from 'lucide-react';
import type { MapViewport } from './PhotoMap';
import type { ViewerProps } from '../viewer/PhotoViewer';
import { emptyFilters, formatBytes, selectPhotos, type Filters, type GalleryProject, type Sort, type ViewerPhoto } from '../viewer/photos';
import PhotoThumbnail from './PhotoThumbnail';
import Panel from './Panel';
import { ViewerAttribution } from '../viewer/ViewerAttribution';

type MapComponent = typeof import('./PhotoMap').default;
type Item = { photo: ViewerPhoto; index: number; onOpen: (photo: ViewerPhoto, element: HTMLElement | null) => void };
function PhotoItem({ data: { photo, index, onOpen } }: RenderComponentProps<Item>) {
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); onOpen(photo, event.currentTarget);
  };
  return <a className="photo-link" href={photo.src} data-photo-id={photo.id} data-gallery-index={index} data-viewer-trigger={photo.id} aria-label={`查看照片：${photo.alt}`} onClick={open}>
    <PhotoThumbnail photo={photo} eager={index < 8} />
    {photo.isHDR && <span className="photo-badge">HDR</span>}
    <span className="photo-hover"><strong>{photo.title}</strong><span>{photo.format.toUpperCase()} · {photo.width} × {photo.height} · {formatBytes(photo.size)}</span><span>{photo.exposure.join('　')}</span></span>
  </a>;
}
const settingsKey = 'jason-gallery:view:v1';
export default function ProjectGallery({ photos, project }: { photos: readonly GalleryPhoto[]; project: GalleryProject }) {
  const root = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const scrollPosition = useRef(0);
  const mapViewport = useRef<{ key: string; viewport: MapViewport } | null>(null);
  const ownHistoryEntry = useRef(false);
  const historyOwner = useRef(crypto.randomUUID());
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [sort, setSort] = useState<Sort>('project');
  const [view, setView] = useState<'masonry' | 'list'>('masonry');
  const [columns, setColumns] = useState(0);
  const [panel, setPanel] = useState<'info' | 'search' | 'settings' | 'map' | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [Viewer, setViewer] = useState<ComponentType<ViewerProps> | null>(null);
  const [PhotoMap, setPhotoMap] = useState<MapComponent | null>(null);
  const [loadError, setLoadError] = useState('');
  const [mapError, setMapError] = useState(false);
  const [notice, setNotice] = useState('');
  const visible = useMemo(() => selectPhotos(photos, filters, sort), [photos, filters, sort]);
  const mapKey = visible.map(photo => photo.id).join(',');
  const selectedPhoto = photos.find(p => p.id === selected);
  const sequence = selectedPhoto && !visible.some(p => p.id === selected) ? [...photos] : visible;
  const setPhotoURL = useCallback((id: string | null, push = false) => {
    const url = new URL(location.href);
    if (id) url.searchParams.set('photo', id); else url.searchParams.delete('photo');
    history[push ? 'pushState' : 'replaceState']({ ...history.state, galleryViewer: id ? (push ? historyOwner.current : history.state?.galleryViewer) : null }, '', url);
  }, []);
  useEffect(() => {
    root.current?.closest('[data-project-gallery]')?.setAttribute('data-enhanced', 'true');
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
      const nextFilters = { ...emptyFilters };
      for (const key of Object.keys(nextFilters) as (keyof Filters)[]) nextFilters[key] = params.get(key) || '';
      setFilters(nextFilters);
      setSort(params.get('sort') === 'asc' ? 'asc' : params.get('sort') === 'desc' ? 'desc' : 'project');
      setPanel(params.get('panel') === 'map' ? 'map' : null);
      const id = params.get('photo');
      ownHistoryEntry.current = history.state?.galleryViewer === historyOwner.current;
      if (id && !photos.some(p => p.id === id)) {
        setPhotoURL(null); setNotice('此照片不在当前项目中。'); setSelected(null); return;
      }
      if (id && !selectPhotos(photos, nextFilters, 'project').some(photo => photo.id === id)) {
        setFilters(emptyFilters);
        const url = new URL(location.href);
        for (const key of Object.keys(emptyFilters)) url.searchParams.delete(key);
        history.replaceState(history.state, '', url);
        setNotice('此照片不符合链接中的筛选条件，已清除筛选。');
      }
      if (id) scrollPosition.current = window.scrollY;
      if (!id) {
        requestAnimationFrame(() => { window.scrollTo(0, scrollPosition.current); opener.current?.isConnected && opener.current.focus({ preventScroll: true }); });
        ownHistoryEntry.current = false;
      }
      setSelected(id);
    };
    sync(); window.addEventListener('popstate', sync);
    return () => { window.removeEventListener('popstate', sync); };
  }, [photos, setPhotoURL]);
  useEffect(() => {
    if (!selected || Viewer) return;
    let active = true;
    void import('../viewer/PhotoViewer').then(module => { if (active) setViewer(() => module.default); }).catch(() => { if (active) setLoadError('看图组件加载失败，请重试或打开原图。'); });
    return () => { active = false; };
  }, [selected, Viewer, loadError]);
  useEffect(() => {
    if (panel !== 'map' || PhotoMap || mapError) return;
    let active = true;
    void import('./PhotoMap').then(module => { if (active) setPhotoMap(() => module.default); }).catch(() => { if (active) setMapError(true); });
    return () => { active = false; };
  }, [panel, PhotoMap, mapError]);
  const open = useCallback((photo: ViewerPhoto, element: HTMLElement | null) => {
    opener.current = element; scrollPosition.current = window.scrollY;
    ownHistoryEntry.current = true; setPhotoURL(photo.id, true); setSelected(photo.id); setLoadError('');
  }, [setPhotoURL]);
  const close = useCallback(() => {
    if (ownHistoryEntry.current) { ownHistoryEntry.current = false; history.back(); }
    else { setSelected(null); setPhotoURL(null); }
    requestAnimationFrame(() => { window.scrollTo(0, scrollPosition.current); opener.current?.isConnected && opener.current.focus({ preventScroll: true }); });
  }, [setPhotoURL]);
  const items = useMemo(() => visible.map((photo, index) => ({ photo: photo as GalleryPhoto, index, onOpen: open })), [visible, open]);
  const saveView = (nextView: typeof view, nextColumns = columns) => {
    setView(nextView); setColumns(nextColumns);
    const url = new URL(location.href);
    url.searchParams.set('view', nextView);
    url.searchParams.set('columns', String(nextColumns));
    history.replaceState(history.state, '', url);
    try { localStorage.setItem(settingsKey, JSON.stringify({ view: nextView, columns: nextColumns })); } catch { /* Optional preference. */ }
  };
  const replaceContext = (nextFilters: Filters, nextSort: Sort, map = false) => {
    const url = new URL(location.href);
    for (const key of Object.keys(nextFilters) as (keyof Filters)[]) {
      if (nextFilters[key]) url.searchParams.set(key, nextFilters[key]); else url.searchParams.delete(key);
    }
    if (nextSort !== 'project') url.searchParams.set('sort', nextSort); else url.searchParams.delete('sort');
    if (map) url.searchParams.set('panel', 'map'); else url.searchParams.delete('panel');
    history.replaceState(history.state, '', url);
  };
  const changeFilters = (value: Filters) => { setFilters(value); replaceContext(value, sort); };
  const updateFilter = (key: keyof Filters, value: string) => changeFilters({ ...filters, [key]: value });
  const closePanel = () => { setPanel(null); replaceContext(filters, sort); };
  const options = (key: 'camera' | 'lens' | 'tags') => [...new Set(photos.flatMap(p => p[key]).filter(Boolean))].sort();
  const hasFilters = Object.values(filters).some(Boolean);
  return <LazyMotion features={domMax}><div ref={root} className="gallery-live" data-viewer-ready="true">
    <PageHeader title={project.title} count={visible.length} view={view} onView={saveView} panel={panel}
      onPanel={next => { setPanel(next); if (next === 'map') replaceContext(filters, sort, true); }}
      hasFilters={hasFilters} customized={columns !== 0 || sort !== 'project'} />
    {notice && <p className="gallery-notice" role="status">{notice}<button className="icon-button" onClick={() => setNotice('')} aria-label="关闭提示"><X size={16}/></button></p>}
    {hasFilters && <div className="filter-summary"><span>找到 {visible.length} / {photos.length} 张照片</span><button onClick={() => changeFilters(emptyFilters)}>清除筛选 <X size={13}/></button></div>}
    {visible.length === 0 ? <div className="gallery-empty"><Search size={28} /><h2>没有符合条件的照片</h2><p>试试其他关键词，或清除筛选。</p><button onClick={() => changeFilters(emptyFilters)}>清除筛选</button></div> : view === 'masonry' ? (
      <MasonryView items={items} columns={columns} />
    ) : <ol className="photo-list">{items.map(item => <li key={item.photo.id}><PhotoItem data={item} index={item.index} width={200}/><div className="list-info"><h2>{item.photo.title}</h2><p>{item.photo.date?.slice(0, 10)}　{item.photo.tags.join(' · ')}</p><p>{item.photo.caption || item.photo.description}</p><span><Camera size={14}/> {item.photo.camera || '未记录相机'}　{item.photo.exposure.join('　')}</span></div><span className="list-size">{formatBytes(item.photo.size)}</span></li>)}</ol>}
    {panel && !selected && <Panel title={{ info: '项目信息', search: '搜索和筛选', settings: '显示设置', map: '地图探索' }[panel]} onClose={closePanel} wide={panel === 'map'}>
      {panel === 'info' && <><h3 className="project-panel-title">{project.title}</h3>{project.summary && <p>{project.summary}</p>}<dl className="metadata-rows project-details">{project.location && <><dt>地点</dt><dd>{project.location}</dd></>}{project.period && <><dt>日期</dt><dd>{project.period.start}{project.period.end && project.period.end !== project.period.start && ` — ${project.period.end}`}</dd></>}<dt>照片</dt><dd>{photos.length}</dd></dl>{project.description && <p className="project-description">{project.description}</p>}<ul className="tags">{project.tags?.map(tag => <li key={tag}>{tag}</li>)}</ul><ViewerAttribution /></>}
      {panel === 'search' && <form onSubmit={e => { e.preventDefault(); setPanel(null); }} className="filter-form">
        <label>搜索<input type="search" placeholder="标题、文件名、说明、标签…" value={filters.query} onChange={e => updateFilter('query', e.target.value)} autoFocus /></label>
        <div className="date-fields"><label>开始日期<input type="date" value={filters.start} max={filters.end || undefined} onChange={e => updateFilter('start', e.target.value)} /></label><label>结束日期<input type="date" value={filters.end} min={filters.start || undefined} onChange={e => updateFilter('end', e.target.value)} /></label></div>
        {(['camera', 'lens', 'tag'] as const).map((field, i) => <label key={field}>{['相机', '镜头', '标签'][i]}<select aria-label={['相机', '镜头', '标签'][i]} value={filters[field]} onChange={e => updateFilter(field, e.target.value)}><option value="">全部</option>{options(field === 'tag' ? 'tags' : field).map(value => <option key={value}>{value}</option>)}</select></label>)}
        <div className="form-actions"><button type="button" onClick={() => changeFilters(emptyFilters)}>重置</button><button type="submit" className="primary-button">查看 {visible.length} 张照片</button></div>
      </form>}
      {panel === 'settings' && <div className="filter-form"><label>照片排序<select aria-label="照片排序" value={sort} onChange={e => { setSort(e.target.value as Sort); replaceContext(filters, e.target.value as Sort); }}><option value="project">项目编排顺序</option><option value="desc">拍摄时间：从新到旧</option><option value="asc">拍摄时间：从旧到新</option></select></label><label>瀑布流列数<select aria-label="瀑布流列数" value={columns} onChange={e => saveView(view, Number(e.target.value))}><option value={0}>自动适配</option>{[1,2,3,4,5,6,7,8].map(n => <option key={n} value={n}>{n} 列</option>)}</select></label><p className="muted">列数会根据屏幕宽度自动限制；视图偏好保存在此设备。</p></div>}
      {panel === 'map' && (PhotoMap ? <PhotoMap photos={visible} initialViewport={mapViewport.current?.key === mapKey ? mapViewport.current.viewport : undefined} onViewport={viewport => { mapViewport.current = { key: mapKey, viewport }; }} onOpen={photo => open(photo, root.current?.querySelector<HTMLButtonElement>('[aria-label="地图探索"]') ?? null)} /> : mapError ? <div><p role="alert">地图组件加载失败。<button onClick={() => setMapError(false)}>重试</button></p><ul className="map-photo-list">{visible.filter(photo => photo.location).map(photo => <li key={photo.id}><button onClick={() => open(photo, null)}>{photo.title}</button></li>)}</ul></div> : <p role="status">正在加载地图…</p>)}
    </Panel>}
    {selectedPhoto && (Viewer ? <Viewer photos={sequence} projectTitle={project.title} index={sequence.findIndex(p => p.id === selected)} trigger={opener.current} onIndex={index => { const photo = sequence[index]; if (photo) { setSelected(photo.id); setPhotoURL(photo.id); } }} onClose={close} /> : <Panel title="打开照片" onClose={close}><p role={loadError ? 'alert' : 'status'}>{loadError || '正在加载看图组件…'}</p>{loadError && <button onClick={() => setLoadError('')}>重试</button>}<a className="text-link" href={selectedPhoto.src} target="_blank" rel="noreferrer">打开原图 ↗</a></Panel>)}
  </div></LazyMotion>;
}
