import { SyncPanel } from './sync-panel';
import { request, RequestError } from './api';
import { Thumbnail, ThumbnailStatus } from './thumbnail';
import { Tasks } from './tasks';
import { DeleteDialog, type DeleteTarget } from './delete-dialog';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, ChevronRight, CircleAlert, Clock3, CloudUpload, FolderOpen, GitBranch, Image, Images, Layers3, Moon, Plus, RefreshCw, Search, Settings2, Sun, X } from 'lucide-react';
import { SourceSchema, SourcesSchema, type PhotoSource } from '../../src/photo-engine/source-schema';
import { ProjectSchema, type Project } from '../../src/projects/schema';
import type { PreviewData, PreviewPhoto } from './model';

type Page = 'photos' | 'projects' | 'sources' | 'tasks';
type ProjectSwitch = { next: Project | null; dirty: boolean; clearSelection: boolean };
type ArtifactState = 'ready' | 'empty' | 'expired' | 'failed';
const names = { photos: '照片', projects: 'Project', sources: '照片源', tasks: '同步与发布' };
const icons = { photos: Images, projects: FolderOpen, sources: Layers3, tasks: RefreshCw };
const badge = (text: string, kind = '') => <span className={`badge ${kind}`}>{text}</span>;
function Modal({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} onCancel={close}><div className="dialog-head"><h2>{title}</h2><button aria-label="关闭对话框" onClick={close}><X size={18} /></button></div>{children}</dialog>;
}
function PhotoCard({ item, selected, toggle, source }: { item: PreviewPhoto; selected: boolean; toggle: () => void; source?: string }) {
  const p = item.photo;
  return <button className={`photo-card ${selected ? 'selected' : ''}`} aria-label={`选择 ${p.title}`} aria-pressed={selected} onClick={toggle}>
    <Thumbnail src={p.thumbnailUrl} alt={p.title} loading="lazy" style={{ aspectRatio: `${p.width}/${p.height}` }} />
    <span className="photo-check">{selected && <Check size={14} />}</span>
    <span className="photo-info"><strong>{p.title}</strong><small>{source}</small></span>
  </button>;
}
export function AdminPreview({ initial, management }: { initial: PreviewData; management?: { saveProof?: string; head: string; email: string; media: any; publishEnabled: boolean } }) {
  const [publishEnabled, setPublishEnabled] = useState(management?.publishEnabled ?? false);
  const [head, setHead] = useState(management?.head ?? '');
  const [saveProof, setSaveProof] = useState(management?.saveProof);
  const [photos, setPhotos] = useState(initial.photos);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ requestId: string; mode: string }>();
  const [conflict, setConflict] = useState(false);
  const [media, setMedia] = useState(management?.media);
  const [serverImpacts, setServerImpacts] = useState<any[] | null>(null);
  const [impactError, setImpactError] = useState('');
  const [photoTab, setPhotoTab] = useState<'manage' | 'sync'>('manage');
  const [page, setPage] = useState<Page>('photos');
  const [dark, setDark] = useState(true);
  const [sources, setSources] = useState(initial.sources);
  const [projects, setProjects] = useState(initial.projects);
  const [project, setProject] = useState<Project | null>(null);
  const [source, setSource] = useState<PhotoSource | null>(null);
  const [originalSource, setOriginalSource] = useState<PhotoSource | null>(null);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [state, setState] = useState<ArtifactState>(!management || management.media.state === 'ready' ? 'ready' : management.media.state === 'expired' || management.media.state === 'stale' ? 'expired' : 'failed');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [addTarget, setAddTarget] = useState(false);
  const [photoTargetId, setPhotoTargetId] = useState<string | null>(null);
  const photoTarget = project && project.id === photoTargetId ? project : null;
  const photoTargetName = photoTarget?.title || '新的 Project';
  const [task, setTask] = useState('idle');
  const [taskMode, setTaskMode] = useState('sync');
  const [publishConfirm, setPublishConfirm] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [projectSwitch, setProjectSwitch] = useState<ProjectSwitch | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const sourceName = (id: string) => sources.find(s => s.sourceId === id)?.name ?? id;
  const photo = (id: string) => photos.find(p => p.photo.id === (media?.aliases?.[id] ?? id));
  const available = photos.filter(p => sources.find(s => s.sourceId === p.sourceId)?.enabled);
  const shown = available.filter(p => (filter === 'all' || p.sourceId === filter) && (p.photo.title ?? '').toLowerCase().includes(search.toLowerCase()));
  const toggle = (id: string) => setSelected(s => s.includes(id) ? s.filter(v => v !== id) : [...s, id]);
  const navigate = (next: Page) => {
    setPage(next); setError(''); setPhotoTargetId(null); if (next === 'photos') setPhotoTab('manage');
    if (photoTargetId) setSelected([]);
  };
  function addToCurrentProject() {
    if (!project) return;
    const existing = new Set(project.photos.map(p => media?.aliases?.[p.photoId] ?? p.photoId));
    const additions = selected.filter(id => {
      const canonical = media?.aliases?.[id] ?? id;
      if (existing.has(canonical)) return false;
      existing.add(canonical); return true;
    }).map(photoId => ({ photoId }));
    if (additions.length) changeProject({ photos: [...project.photos, ...additions], coverPhotoId: project.coverPhotoId || additions[0]!.photoId });
    setSelected([]); setAddTarget(false); navigate('projects');
    setNotice(additions.length ? '照片已加入当前编排，尚未保存。完成排序和封面设置后，请点击“保存 Project”。' : '所选照片已在当前 Project 中，未重复添加。');
  }
  function finishDelete(nextHead?: string) {
    if (!deleteTarget) return;
    if (nextHead) { setHead(nextHead); setSaveProof(undefined); }
    if (deleteTarget.kind === 'project') {
      setProjects(ps => ps.filter(p => p.id !== deleteTarget.project.id));
      setProject(null); setDirty(false); setProjectSwitch(null); setAddTarget(false);
      setNotice(management ? 'Project 已删除并提交 GitHub。网站尚未发布，原图已保留。' : 'Project 已从本次预览删除。');
    } else {
      const id = deleteTarget.source.sourceId;
      setSources(ss => ss.filter(s => s.sourceId !== id));
      setPhotos(ps => ps.filter(p => p.sourceId !== id));
      setSelected([]); setFilter('all');
      if (management) { setState('expired'); setMedia((m: any) => ({ ...m, state: 'stale', reason: '照片源已删除，请同步照片以更新目录' })); }
      setNotice(management ? '照片源已删除并提交 GitHub，仓库和原图已保留。请同步照片以更新目录。' : '照片源已从本次预览删除。');
    }
    setDeleteTarget(null); setError('');
  }
  function applyProjectSwitch(intent: ProjectSwitch) {
    setProject(intent.next && structuredClone(intent.next)); setDirty(intent.dirty);
    if (intent.clearSelection) setSelected([]);
    setProjectSwitch(null); setAddTarget(false); navigate('projects');
  }
  function requestProjectSwitch(intent: ProjectSwitch) {
    if (dirty && project) { setProjectSwitch(intent); setAddTarget(false); setError(''); }
    else applyProjectSwitch(intent);
  }
  const edit = (next: Project, nextDirty = false, clearSelection = false) => requestProjectSwitch({ next, dirty: nextDirty, clearSelection });
  const changeProject = (patch: Partial<Project>) => { setProject(p => p && { ...p, ...patch }); setDirty(true); };
  const newProject = (ids = selected) => {
    requestProjectSwitch({ next: { schemaVersion: 1, id: `project-${crypto.randomUUID()}`, slug: '', title: '', summary: '', location: '', coverPhotoId: ids[0] ?? '', photos: ids.map(photoId => ({ photoId })), order: projects.length, status: 'draft' }, dirty: true, clearSelection: true });
  };
  async function saveProject() {
    if (!project) return false;
    const result = ProjectSchema.safeParse(project);
    if (!result.success) { setError(result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('\n')); return false; }
    if (projects.some(p => p.id !== project.id && p.slug === project.slug)) { setError('此 slug 已被其他 Project 使用。'); return false; }
    if (project.photos.some(p => !available.some(a => a.photo.id === (media?.aliases?.[p.photoId] ?? p.photoId)))) { setError('照片引用已失效，请检查照片源。'); return false; }
    if (management) {
      setBusy(true);
      try { const saved = await request('/api/save', { kind: 'project', expectedHead: head, project: result.data, ...(saveProof ? { saveProof } : {}) }); setHead(saved.head); setSaveProof(saved.saveProof); }
      catch (e) { fail(e); return false; } finally { setBusy(false); }
    }
    setProjects(ps => [...ps.filter(p => p.id !== project.id), result.data]); setDirty(false); setError(''); setNotice(management ? 'Project 已提交 GitHub。网站尚未发布。' : 'Project 已保存到本次预览内存。未提交 GitHub，未发布网站。');
    return true;
  }
  const localImpacts = source && originalSource && (!source.enabled || ['owner', 'repo', 'branch', 'path'].some(k => source[k as keyof PhotoSource] !== originalSource[k as keyof PhotoSource]))
    ? projects.filter(p => p.photos.some(r => photo(r.photoId)?.sourceId === originalSource.sourceId)) : [];
  const impacts = management ? (serverImpacts ?? []) : localImpacts;
  useEffect(() => {
    if (!management || !source) return;
    setServerImpacts(null); setImpactError(''); let active = true;
    const timer = setTimeout(async () => {
      try { const next = originalSource ? sources.map(s => s.sourceId === originalSource.sourceId ? source : s) : [...sources, source]; const result = await request('/api/impact', { schemaVersion: 1, sources: next }); if (active) setServerImpacts(result.impacts); }
      catch (e) { if (active) setImpactError(e instanceof Error ? e.message : '影响分析失败'); }
    }, 350);
    return () => { active = false; clearTimeout(timer); };
  }, [source, sources, originalSource]);
  function fail(e: unknown) { if (e instanceof RequestError && (e.details as any)?.requestId) { setPending(e.details as any); setPage('tasks'); } setError(e instanceof Error ? e.message : '操作失败'); if (e instanceof RequestError && e.status === 409) setConflict(true); }
  async function saveSource() {
    if (!source) return;
    const result = SourceSchema.safeParse(source);
    if (!result.success) { setError(result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('\n')); return; }
    const next = originalSource ? sources.map(s => s.sourceId === originalSource.sourceId ? result.data : s) : [...sources, result.data];
    if (!SourcesSchema.safeParse({ schemaVersion: 1, sources: next }).success) { setError('来源 ID 重复或配置无效。'); return; }
    if (impacts.length) { setError('请先从受影响的 Project 中移除或迁移照片引用，再修改来源。'); return; }
    if (management) {
      setBusy(true);
      try { const saved = await request('/api/save', { kind: 'sources', expectedHead: head, config: { schemaVersion: 1, sources: next } }); setHead(saved.head); setSaveProof(undefined); setState('expired'); setSelected([]); setMedia((m: any) => ({ ...m, reason: '来源配置已更新，请同步照片后继续选图' })); }
      catch (e) { fail(e); return; } finally { setBusy(false); }
    }
    setSources(next); setSource(null); setNotice(management ? '照片源配置已提交 GitHub。请单独同步照片。' : '照片源配置已保存到预览内存。实际接入后需单独同步照片。'); setError('');
  }
  function move(index: number, direction: number) {
    if (!project) return;
    const next = [...project.photos];
    [next[index], next[index + direction]] = [next[index + direction]!, next[index]!];
    changeProject({ photos: next });
  }
  async function startTask(mode: string) {
    if (busy) return;
    if (management) {
      if (dirty || source) { setError('请先保存或放弃当前编辑，再触发任务。'); return; }
      setBusy(true);
      try { const result = await request('/api/dispatch', { mode, expectedHead: head, ...(mode === 'publish' ? { photoRunId: media?.runId } : {}) }); setPending(result); setNotice('请求已发送，正在等待实际任务；尚未成功。'); navigate('tasks'); setPublishConfirm(false); }
      catch (e) { fail(e); } finally { setBusy(false); }
      return;
    }
    setTaskMode(mode); setTask('queued'); navigate('tasks'); setNotice('仅展示任务排队状态；未调用 GitHub Actions。'); }
  async function refreshPhotos() {
    if (dirty || source) { setError('请先保存或放弃编辑，再刷新仓库。'); return false; }
    setBusy(true);
    try { const result = await request('/api/state'); setHead(result.head); setPublishEnabled(result.publishEnabled === true); setSaveProof(result.saveProof); setSources(result.sources); setProjects(result.projects); setPhotos(result.media.photos); setMedia(result.media); setState(result.media.state === 'ready' ? 'ready' : result.media.state === 'expired' || result.media.state === 'stale' ? 'expired' : 'failed'); setSelected([]); setProject(null); return true; } catch(e) { fail(e); return false; } finally { setBusy(false); }
  }
  return <div className={`admin ${dark ? 'dark' : 'light'}`}>
    <header className="topbar"><a className="brand" href="#" onClick={e => { e.preventDefault(); navigate('photos'); }}><span className="brand-mark"><Image size={20} /></span>jason<span className="brand-tail">/ gallery</span></a>
      <nav aria-label="后台导航">{(Object.keys(names) as Page[]).map(id => { const Icon = icons[id]; return <button key={id} className={page === id ? 'active' : ''} onClick={() => navigate(id)}><Icon size={16} />{names[id]}</button>; })}</nav>
      <div className="top-tools"><button onClick={() => setDark(v => !v)} aria-label="切换明暗主题">{dark ? <Sun size={17} /> : <Moon size={17} />}</button><span className="avatar" title={management?.email ?? 'Fixture 预览，不代表已登录'}>J</span></div>
    </header>
    {management ? <div className="preview-banner"><span>管理后台 · {management.email}</span><span>Git {head.slice(0, 7)} · <button onClick={refreshPhotos} disabled={busy}>刷新仓库</button> · <a href="/cdn-cgi/access/logout">退出登录</a></span></div> : <div className="preview-banner"><span><span className="dot" />界面预览 <b>FIXTURE</b></span><span>操作仅保存在当前页面 · 未连接管理接口</span></div>}
    <main aria-busy={busy} inert={busy}>
      {busy && <div className="notice" role="status">正在与服务端通信，请稍候…</div>}
      <div className="breadcrumb">工作空间 <ChevronRight size={13} /> {names[page]} {project && page === 'projects' && <><ChevronRight size={13} />编辑</>}</div>
      <ThumbnailStatus />
      <section className="page-heading"><div><p className="eyebrow">YOUR PHOTOGRAPHY, ORGANIZED</p><h1>{page === 'photos' ? photoTab === 'sync' ? '照片库' : '每一张，都有它的位置。' : page === 'sources' ? '照片源' : page === 'tasks' ? '同步与发布' : project ? project.title || '新的摄影 Project' : '摄影 Project'}</h1><p>{page === 'photos' ? photoTab === 'sync' ? '预览并同步已有照片源，集中管理照片库的变化。' : '浏览照片，挑选片刻，将它们组织成你的摄影故事。' : page === 'sources' ? '连接你的 GitHub 照片仓库，让照片在同一处井然有序。' : page === 'tasks' ? '从保存到上线，每一步都有明确的状态。' : project ? '编排照片、设置封面，为这一组作品留下文字。' : '把散落的照片，编成值得慢慢观看的故事。'}</p></div>
        <div className="heading-actions">{page === 'photos' && photoTab === 'manage' && <button className="secondary" onClick={() => setPhotoTab('sync')}><RefreshCw size={15} />同步照片</button>}{page === 'sources' && <button className="primary" onClick={() => { setOriginalSource(null); setError(''); setSource({ sourceId: '', name: '', owner: '', repo: '', branch: 'main', path: 'images', enabled: true }); }}><Plus size={16} />新增照片源</button>}{page === 'projects' && (project ? <><span className="muted">{dirty ? '有未保存修改' : management ? '已保存到 GitHub' : '预览内已保存'}</span><button className="primary" disabled={busy || !!management && state !== 'ready'} onClick={saveProject}>保存 Project</button></> : <button className="primary" onClick={() => newProject([])}><Plus size={16} />新建 Project</button>)}</div>
      </section>
      {notice && <div className="notice" role="status"><Check size={16} /><span>{notice}</span><button aria-label="关闭通知" onClick={() => setNotice('')}><X size={15} /></button></div>}
      {error && !source && <div className="error" role="alert">{error}</div>}
      {page === 'photos' && <>
        {photoTarget && <section className="panel" aria-label="Project 选图上下文"><div className="panel-title"><div><h2>正在为「{photoTargetName}」选择照片</h2><p>加入照片仅更新未保存的编排，点击“保存 Project”后才会提交 GitHub。</p></div><button className="secondary" onClick={() => navigate('projects')}><ArrowLeft size={15} />返回 {photoTargetName}</button></div></section>}
        <div className="tabs" role="tablist" aria-label="照片库视图"><button role="tab" aria-selected={photoTab === 'manage'} className={photoTab === 'manage' ? 'current' : ''} onClick={() => setPhotoTab('manage')}>照片管理</button><button role="tab" aria-selected={photoTab === 'sync'} className={photoTab === 'sync' ? 'current' : ''} onClick={() => setPhotoTab('sync')}>同步照片</button></div>
        {photoTab === 'sync' ? <SyncPanel pending={pending?.mode === 'sync' ? pending : undefined} setPending={setPending} sources={sources} head={head} connected={!!management} dirty={dirty || !!source} refreshPhotos={refreshPhotos} /> : <>
        <div className="tabs" role="group" aria-label="照片来源筛选"><button className={filter === 'all' ? 'current' : ''} onClick={() => setFilter('all')}>所有照片 <span>{available.length}</span></button>{sources.filter(s => s.enabled).map(s => <button key={s.sourceId} className={filter === s.sourceId ? 'current' : ''} onClick={() => setFilter(s.sourceId)}>{s.name}<span>{available.filter(p => p.sourceId === s.sourceId).length}</span></button>)}</div>
        <div className="toolbar"><label className="search"><Search size={16} /><input aria-label="搜索照片" placeholder="搜索照片名称…" value={search} onChange={e => setSearch(e.target.value)} /></label><div className="toolbar-right"><span className="muted">{state === 'ready' ? `${shown.length} 张照片 · 按文件名` : '产物不可用于选图'}</span>{!management && <label className="scenario"><Settings2 size={14} /><select aria-label="预览产物状态" value={state} onChange={e => { setState(e.target.value as ArtifactState); setSelected([]); }}><option value="ready">预览：可用产物</option><option value="empty">预览：无产物</option><option value="expired">预览：产物过期</option><option value="failed">预览：同步失败</option></select></label>}</div></div>
        {state !== 'ready' ? <div className="empty panel"><CircleAlert size={30} /><h2>{management ? (media?.state === 'expired' ? '照片产物已过期' : media?.state === 'stale' ? '照片产物需要更新' : media?.state === 'empty' ? '还没有可用的照片产物' : media?.state === 'sync_failed' ? '上次同步未完成' : '照片产物暂不可用') : state === 'expired' ? '照片产物已过期' : state === 'failed' ? '上次同步未完成' : '还没有可用的照片产物'}</h2><p>{management ? media?.reason : state === 'failed' ? '示例失败：日常观察来源无法读取（HTTP 403）。请检查仓库配置后重试。' : state === 'expired' ? '照片产物超过保留期，需要重新同步后才能继续选图。' : '保存照片源后，先运行一次同步，照片就会出现在这里。'}</p><button className="primary" onClick={() => management && !['expired', 'stale', 'empty', 'sync_failed', 'format'].includes(media?.state) ? refreshPhotos() : startTask('sync')}><RefreshCw size={15} />{management && !['expired', 'stale', 'empty', 'sync_failed', 'format'].includes(media?.state) ? '重试读取' : '重新同步'}</button></div> : shown.length ? <div className="photo-grid">{shown.map(p => <PhotoCard key={p.photo.id} item={p} source={sourceName(p.sourceId)} selected={selected.includes(p.photo.id)} toggle={() => toggle(p.photo.id)} />)}</div> : <div className="empty panel"><Search /><h2>没有符合条件的照片</h2><button onClick={() => { setFilter('all'); setSearch(''); }}>清除筛选</button></div>}
        <div className="grid-footer"><span>{management ? `已验证照片产物 · 有效至 ${new Date(media?.expiresAt).toLocaleDateString()}` : initial.imageMode}</span><span>照片源只读</span></div>
        {selected.length > 0 && state === 'ready' && <div className="selection-bar"><span className="selection-count">{selected.length}</span><span>张照片已选中</span><button onClick={() => setSelected([])}>取消选择</button><button className="primary" onClick={() => photoTarget ? addToCurrentProject() : setAddTarget(true)}>加入 {photoTarget ? photoTargetName : 'Project'} <ArrowRight size={15} /></button></div>}
      </>}
      </>}
      {page === 'projects' && (!project ? <div className="project-cards">{projects.map(p => <button className="project-card panel" key={p.id} onClick={() => edit(p)}><Thumbnail src={photo(p.coverPhotoId)?.photo.thumbnailUrl} alt={p.title} /><div><span>{badge(p.status === 'draft' ? '草稿' : '待网站发布', p.status === 'draft' ? '' : 'green')}</span><h2>{p.title}</h2><p>{p.photos.length} 张照片 · {p.slug}</p></div><ArrowRight size={20} /></button>)}</div> : <>
        <button className="back" onClick={() => { if (dirty) { setError('请先保存当前预览修改，或使用下方放弃按钮。'); return; } setProject(null); }}><ArrowLeft size={14} />全部 Project</button>{dirty && <button className="back" onClick={() => requestProjectSwitch({ next: null, dirty: false, clearSelection: false })}>放弃当前修改</button>}
        <div className="project-delete-action">{projects.some(p => p.id === project.id) && <button className="danger" onClick={() => setDeleteTarget({ kind: 'project', project: projects.find(p => p.id === project.id)! })}>删除 Project</button>}</div>
        <div className="editor-layout"><aside className="panel project-form"><div className="panel-title"><h2>Project 信息</h2>{badge(project.status === 'draft' ? '草稿' : '待网站发布')}</div><label>标题<input value={project.title} onChange={e => changeProject({ title: e.target.value })} placeholder="为这组作品起个名字" /></label><label>网址标识 · slug<input disabled={!!management && projects.some(p => p.id === project.id)} value={project.slug} onChange={e => changeProject({ slug: e.target.value })} placeholder="between-places" /></label><label>简短介绍<textarea rows={3} value={project.summary ?? ''} onChange={e => changeProject({ summary: e.target.value })} /></label><label>地点<input value={project.location ?? ''} onChange={e => changeProject({ location: e.target.value })} /></label><label>状态<select aria-label="Project 状态" value={project.status} onChange={e => changeProject({ status: e.target.value as Project['status'] })}><option value="draft">Draft · 草稿</option><option value="published">Published · 下次发布时公开</option></select></label><p className="field-hint">保存 published 状态后，仍需单独发布网站才会上线。</p><div className="form-note"><GitBranch size={16} /><span>只保存 Project 内容与照片引用。<br />照片信息沿用原有产物。</span></div></aside>
          <section className="panel sequence"><div className="panel-title"><div><h2>照片编排 <span className="muted">{project.photos.length}</span></h2><p>第一眼的封面，与之后的观看顺序。</p></div><button className="secondary" onClick={() => { setSelected([]); navigate('photos'); setPhotoTargetId(project.id); setNotice(''); }}><Plus size={15} />添加照片</button></div>
            {project.photos.length === 0 && <div className="empty"><Images /><p>从照片库中选择照片，开始编排。</p></div>}
            <div className="sequence-list">{project.photos.map((p, i) => { const item = photo(p.photoId); return <div className="sequence-row" key={p.photoId}><span className="sequence-number">{String(i + 1).padStart(2, '0')}</span><Thumbnail src={item?.photo.thumbnailUrl} alt={item?.photo.title} /><div className="sequence-info"><strong>{item?.photo.title}</strong><small>{item && sourceName(item.sourceId)}</small>{project.coverPhotoId === p.photoId ? badge('封面', 'green') : <button className="text-button" onClick={() => changeProject({ coverPhotoId: p.photoId })}>设为封面</button>}</div><div className="sequence-controls"><button aria-label={`上移照片 ${i + 1}`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={15} /></button><button aria-label={`下移照片 ${i + 1}`} disabled={i === project.photos.length - 1} onClick={() => move(i, 1)}><ArrowDown size={15} /></button><button aria-label={`移除照片 ${i + 1}`} onClick={() => { const remaining = project.photos.filter(r => r.photoId !== p.photoId); changeProject({ photos: remaining, coverPhotoId: project.coverPhotoId === p.photoId ? remaining[0]?.photoId ?? '' : project.coverPhotoId }); }}><X size={15} /></button></div></div>; })}</div>
          </section></div></>)}
      {page === 'sources' && <><div className="section-line"><span>{sources.filter(s => s.enabled).length} 个启用 · {sources.length} 个来源</span><span><GitBranch size={14} /> GitHub · 只读照片仓库</span></div>{dirty && <p className="field-hint">请先保存或放弃 Project 的未保存修改，再删除照片源。</p>}<div className="source-list">{sources.map(s => <article key={s.sourceId} className={`panel source-card ${!s.enabled ? 'disabled-source' : ''}`}><div className="source-icon"><Layers3 size={22} /></div><div className="source-main"><div className="source-title"><h2>{s.name}</h2>{badge(s.enabled ? '已启用' : '已停用', s.enabled ? 'green' : '')}</div><p>{s.owner} / {s.repo}</p><div className="source-details"><span><GitBranch size={13} />{s.branch}</span><span><FolderOpen size={13} />{s.path || '/ 根目录'}</span><span>{photos.filter(p => p.sourceId === s.sourceId).length} 张照片</span></div></div><div className="source-end"><span className="muted">{projects.filter(p => p.photos.some(r => photo(r.photoId)?.sourceId === s.sourceId)).length} 个 Project 引用</span><button className="secondary" aria-label={`编辑来源 ${s.name}`} onClick={() => { setOriginalSource(s); setSource({ ...s }); setError(''); }}>编辑来源</button><button className="danger" aria-label={`删除来源 ${s.name}`} disabled={dirty} title={dirty ? '请先保存或放弃 Project 的未保存修改' : undefined} onClick={() => setDeleteTarget({ kind: 'source', source: s })}>删除来源</button></div></article>)}</div><div className="form-note source-note"><CircleAlert size={17} /><p>更换仓库、分支、图片目录，或停用、删除来源前，会检查所有 Project 引用。来源身份变化时，已有照片不会被静默替换。</p></div></>}
      {page === 'tasks' && <><div className="task-actions"><article className="panel"><span className="step">01</span><h2>保存内容</h2><p>把照片源配置与 Project 写入网站仓库。保存和删除后，需确认发布才会更新主站。</p>{badge(management ? 'GitHub 版本提交' : '仅预览内存')}<button className="secondary" onClick={() => navigate('projects')}>管理 Project <ArrowRight size={14} /></button></article><article className="panel"><span className="step">02</span><h2>同步照片</h2><p>读取启用的照片源，生成完整、可验证的照片产物。</p>{badge('不发布网站')}<button className="secondary" onClick={() => startTask('sync')}><RefreshCw size={14} />同步照片</button></article><article className="panel"><span className="step">03</span><h2>发布网站</h2><p>校验当前内容与照片快照，构建并发布网站。</p>{badge(management ? (publishEnabled ? '后台手动发布已启用' : '后台发布入口未启用') : '仅界面预览', publishEnabled ? 'green' : 'amber')}<button className="secondary" onClick={() => setPublishConfirm(true)}><CloudUpload size={14} />查看发布步骤</button></article></div>
        {management ? <Tasks pending={pending} refreshPhotos={refreshPhotos} /> : <section className="panel task-panel"><div className="panel-title"><div><h2>{taskMode === 'sync' ? '照片同步' : '网站发布'}</h2><p>以下为可切换的任务界面示例，无真实任务。</p></div><label className="scenario"><select aria-label="预览任务状态" value={task} onChange={e => setTask(e.target.value)}><option value="idle">未触发</option><option value="queued">排队中</option><option value="running">执行中</option><option value="failure">同步失败</option><option value="success">同步成功 · 尚未发布</option></select></label></div>
        <div className="task-status"><span className={`task-orb ${task === 'failure' ? 'bad' : ''}`}>{task === 'success' ? <Check /> : task === 'failure' ? <CircleAlert /> : <Clock3 />}</span><div><h3>{({ idle: '尚未触发任务', queued: '任务已排队，等待开始', running: '正在处理照片', failure: '同步失败，保留上次完整产物', success: '照片产物已就绪（示例）' } as Record<string, string>)[task]}</h3><p>{task === 'queued' ? '排队不代表成功，任务开始后会更新执行进度。' : task === 'success' ? '同步完成不代表网站已发布。网站部署状态：未请求。' : '任务状态以 GitHub Actions 和执行摘要为准。'}</p></div></div>
        <div className="task-source-head"><span>照片源</span><span>处理 / 复用 / 总数</span><span>结果</span></div>{sources.filter(s => s.enabled).map((s, i) => <div className="task-source" key={s.sourceId}><div><strong>{s.name}</strong><small>{task === 'failure' && i === 1 ? '示例：Source visibility check failed (HTTP 403)' : `${s.owner}/${s.repo}`}</small></div><span>{task === 'success' || (task === 'failure' && i === 0) ? `0 / ${available.filter(p => p.sourceId === s.sourceId).length} / ${available.filter(p => p.sourceId === s.sourceId).length}` : '— / — / —'}</span>{badge(task === 'success' || (task === 'failure' && i === 0) ? '成功' : task === 'failure' ? '失败' : task === 'running' ? '执行中' : '待执行', task === 'failure' && i === 1 ? 'amber' : '')}</div>)}
        <div className="task-bottom"><span>网站部署：未请求 · 暂无线上 URL</span>{task === 'failure' && <button className="secondary" onClick={() => startTask('sync')}><RefreshCw size={14} />重新同步</button>}</div></section>}</>}
      <footer><span>jason / gallery <span className="footer-sep">·</span> 一个安静整理作品的地方</span><span>Phase 7 · {management ? '管理后台' : '界面预览'}</span></footer>
    </main>
    {deleteTarget && <DeleteDialog target={deleteTarget} head={head} connected={!!management} sources={sources} dirty={dirty} close={() => setDeleteTarget(null)} deleted={finishDelete} localImpacts={deleteTarget.kind === 'source' ? projects.flatMap(p => { const count = p.photos.filter(r => photo(r.photoId)?.sourceId === deleteTarget.source.sourceId).length; return count ? [{ projectId: p.id, title: p.title, status: p.status, count }] : []; }) : []} />}
    {source && <Modal title={originalSource ? '编辑照片源' : '新增照片源'} close={() => { setSource(null); setError(''); }}><div className="source-form" inert={busy}><p className="muted">照片从 GitHub 只读同步，凭据在服务端配置。</p>{([['name', '显示名称'], ['sourceId', '稳定来源 ID'], ['owner', 'GitHub 用户 / 组织'], ['repo', '仓库名称'], ['branch', '分支'], ['path', '图片目录']] as const).map(([key, label]) => <label key={key}>{label}<input value={source[key]} disabled={key === 'sourceId' && !!originalSource} onChange={e => setSource({ ...source, [key]: e.target.value })} /></label>)}<label className="checkbox-label"><input type="checkbox" checked={source.enabled} onChange={e => setSource({ ...source, enabled: e.target.checked })} />启用此照片源</label><div className={impacts.length ? 'impact error' : 'impact'}><strong>Project 引用影响</strong>{impacts.length ? <><p>此修改将使以下 Project 的照片引用失效：</p>{impacts.map(p => <p key={'projectId' in p ? p.projectId : p.id}>{p.title} · {p.status} · {'count' in p ? p.count : p.photos.filter((r: any) => photo(r.photoId)?.sourceId === originalSource!.sourceId).length} 张</p>)}<p>请先迁移或移除这些引用，不能静默替换。</p></> : <p>{management ? impactError || (serverImpacts === null ? '正在检查 Project 引用影响…' : '服务端未发现失效的 Project 引用。') : '当前修改未发现失效的预览 Project 引用。'}</p>}</div>{error && <p role="alert" className="error">{error}</p>}<div className="dialog-actions"><button className="secondary" onClick={() => { setSource(null); setError(''); }}>取消</button><button className="primary" disabled={busy || impacts.length > 0 || !!management && (serverImpacts === null || !!impactError)} onClick={saveSource}>{management ? '保存配置到 GitHub' : '保存配置到预览'}</button></div></div></Modal>}
    {addTarget && <Modal title={`将 ${selected.length} 张照片加入 Project`} close={() => setAddTarget(false)}><div className="choose-project">{project && <button className="panel" onClick={addToCurrentProject}>继续编辑：{project.title || '新的 Project'}<ArrowRight size={16} /></button>}{projects.filter(p => p.id !== project?.id).map(p => <button className="panel" key={p.id} onClick={() => { const ids = [...new Set([...p.photos.map(r => r.photoId), ...selected])]; edit({ ...p, photos: ids.map(photoId => p.photos.find(r => r.photoId === photoId) ?? { photoId }) }, true, true); }}>{p.title}{badge(p.status)}<ArrowRight size={16} /></button>)}<button className="primary" onClick={() => newProject()}><Plus size={16} />新建 Project</button></div></Modal>}
    {projectSwitch && <Modal title="当前 Project 有未保存修改" close={() => { if (!busy) setProjectSwitch(null); }}><div className="publish-info" inert={busy}>
      <p>“{project?.title || '新的 Project'}”尚未保存。切换后，这些编辑将被替换。</p>
      {error && <p role="alert" className="error">{error}</p>}
      <div className="dialog-actions"><button className="secondary" onClick={() => setProjectSwitch(null)}>保留编辑，取消切换</button><button className="secondary" onClick={() => applyProjectSwitch(projectSwitch)}>放弃编辑并继续</button><button className="primary" disabled={!!management && state !== 'ready'} onClick={async () => { const intent = projectSwitch; if (await saveProject()) applyProjectSwitch(intent); }}>保存后继续</button></div>
    </div></Modal>}
    {conflict && <Modal title="保存版本冲突" close={() => setConflict(false)}><div className="publish-info"><p>其他修改已经进入仓库。当前编辑仍保留，请复制需要的文字，再加载最新内容并手动合并。</p><pre style={{ maxHeight: 250, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{JSON.stringify(source ?? project, null, 2)}</pre><button className="secondary" onClick={() => setConflict(false)}>保留编辑，返回检查</button><button className="primary" onClick={() => location.reload()}>放弃本地编辑，加载最新版本</button></div></Modal>}
    {publishConfirm && <Modal title="发布网站" close={() => setPublishConfirm(false)}><div className="publish-info"><CloudUpload size={30} /><h3>{management ? (publishEnabled ? '发布当前已保存内容' : '后台发布入口未启用') : '仅界面预览'}</h3><p>正式操作会校验当前 GitHub 版本、Project 引用和照片快照，再运行已有 publish 工作流。</p>{management ? <><p>版本 {head.slice(0, 7)} · 照片任务 #{media?.runId ?? '无'}。这会调用已有 publish 工作流。</p><p>只会公开已保存且状态为 published 的 Project；草稿不会展示。删除 Project 后，主站会在下一次发布成功后更新。</p>{!publishEnabled && <p>此开关仅控制后台能否发起发布，不代表主站尚未部署。已有发布结果请查看下方 Actions 执行记录。</p>}{publishEnabled && state !== 'ready' && <p role="status">照片产物尚未就绪，请先同步照片，完成后刷新照片产物再发布。</p>}{publishEnabled && dirty && <p role="status">请先保存或放弃当前 Project 的修改，再发布。</p>}{publishEnabled && <button className="primary" disabled={busy || dirty || !!source || state !== 'ready'} onClick={() => startTask('publish')}>确认发布已保存版本</button>}</> : <p>本预览无法执行发布，也没有线上成功状态。</p>}<button className="primary" onClick={() => setPublishConfirm(false)}>知道了</button></div></Modal>}
  </div>;
}
