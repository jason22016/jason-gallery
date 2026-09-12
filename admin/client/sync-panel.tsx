import { useEffect, useRef, useState } from 'react';
import { Eye, RefreshCw } from 'lucide-react';
import type { PhotoSource } from '../../src/photo-engine/source-schema';
import type { SyncCounts, SyncPreview } from '../../src/photo-engine/sync-diff';
import { request, RequestError } from './api';
import { Tasks } from './tasks';

const countLabels: [keyof SyncCounts, string][] = [['total', '来源照片数'], ['previous', '当前已同步'], ['added', '新增照片'], ['updated', '更新照片'], ['removed', '移除照片'], ['unchanged', '未变化']];
function Stats({ counts, preview, conflicts = 0, errors = 0 }: { counts: SyncCounts | null; preview?: boolean; conflicts?: number; errors?: number }) {
  return <div className="sync-stats">{countLabels.map(([key,label]) => <div className="sync-stat" key={key}><span>{preview && ['added','updated','removed'].includes(key) ? '预计' : ''}{label}</span><strong>{counts ? counts[key] : '—'}</strong></div>)}<div className="sync-stat"><span>引用冲突</span><strong className={conflicts ? 'sync-warning' : ''}>{conflicts}</strong></div><div className="sync-stat"><span>读取失败</span><strong className={errors ? 'sync-warning' : ''}>{errors}</strong></div></div>;
}
export function SyncPanel({ sources, head, connected, dirty, refreshPhotos, pending, setPending }: { sources: PhotoSource[]; head: string; connected: boolean; dirty: boolean; refreshPhotos: () => Promise<boolean>; pending?: { requestId: string; mode: string }; setPending: (value: { requestId: string; mode: string } | undefined) => void }) {
  const enabled = sources.filter(s => s.enabled).map(s => s.sourceId);
  const [ids, setIds] = useState(enabled);
  const [preview, setPreview] = useState<SyncPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [history, setHistory] = useState<any>(null);
  const [historyError, setHistoryError] = useState('');
  const lastHead = useRef(head);
  useEffect(() => { if (lastHead.current !== head) { setPreview(null); lastHead.current = head; } }, [head]);
  useEffect(() => { setIds(s => s.filter(id => enabled.includes(id))); setPreview(null); }, [sources]);
  const loadHistory = async () => {
    if (!connected) return;
    try { setHistory(await request('/api/tasks')); setHistoryError(''); } catch(e) { setHistoryError(e instanceof Error ? e.message : '执行记录读取失败'); }
  };
  useEffect(() => { void loadHistory(); }, [connected]);
  async function readPreview() {
    if (!connected) { setNotice('界面预览未连接 GitHub，无法检查真实文件差异。'); return null; }
    const query = new URLSearchParams(ids.map(id => ['sourceId', id]));
    const result: SyncPreview = await request('/api/sync-preview?' + query);
    setPreview(result); return result;
  }
  async function inspect() {
    setBusy(true); setError(''); setNotice('');
    try { await readPreview(); } catch(e) { setError(e instanceof Error ? e.message : '预览失败'); } finally { setBusy(false); }
  }
  async function sync() {
    setBusy(true); setError(''); setNotice('');
    try {
      if (!connected) { setNotice('界面预览不能执行同步。'); return; }
      const checked = preview ?? await readPreview();
      if (!checked) return;
      if (checked.canSync === false || checked.canSync === undefined && (checked.errors.length || checked.conflicts.length)) { setError('请先处理预览中的读取失败或 Project 引用冲突。'); return; }
      if (ids.length !== enabled.length && !checked.partialAllowed) { setError(checked.partialReason!); return; }
      const result = await request('/api/dispatch', { mode: 'sync', expectedHead: head, sourceIds: ids, previewRevision: checked.revision });
      setPending(result); setNotice('同步请求已发送，等待实际执行结果。');
    } catch(e) {
      if (e instanceof RequestError) {
        const details = e.details as { preview?: SyncPreview; requestId?: string; mode?: string } | undefined;
        if (details?.preview) setPreview(details.preview);
        if (details?.requestId) setPending({ requestId: details.requestId, mode: 'sync' });
      }
      setError(e instanceof Error ? e.message : '同步请求失败');
    } finally { setBusy(false); }
  }
  const latest = history?.tasks?.find((t: any) => t.state === 'completed' && t.summary?.action === 'sync');
  const duration = latest?.completedAt && latest?.startedAt ? Math.max(0, Math.round((Date.parse(latest.completedAt) - Date.parse(latest.startedAt)) / 1000)) : null;
  const working = busy || !!pending;
  return <section className="sync-panel" aria-label="照片同步面板">
    <div className="panel-title"><div><h2>同步已有照片源</h2><p>先查看文件差异，再将所选来源更新到照片库。同步完成后仍需单独发布网站。</p></div><div className="sync-actions"><button className="secondary" disabled={working || !ids.length} onClick={inspect}><Eye size={16} />{busy ? '正在检查…' : '预览同步'}</button><button className="primary" disabled={working || !ids.length || dirty} onClick={sync}><RefreshCw size={16} />同步照片</button></div></div>
    {dirty && <p className="field-hint">可以预览已保存来源的变化；请先保存或放弃当前编辑，再正式同步。</p>}
    {notice && <p className="notice" role="status">{notice}</p>}{error && <p className="error" role="alert">{error}</p>}
    <section className="panel sync-sources"><div className="panel-title"><h2>选择照片源 <span className="muted">{ids.length} / {enabled.length}</span></h2><button disabled={working} onClick={() => { setIds(ids.length === enabled.length ? [] : enabled); setPreview(null); }}>{ids.length === enabled.length ? '取消全选' : '全选启用来源'}</button></div>{sources.map(s => <label className="sync-source" key={s.sourceId}><input type="checkbox" aria-label={`同步来源 ${s.name}`} checked={ids.includes(s.sourceId)} disabled={!s.enabled || working} onChange={e => { setIds(v => e.target.checked ? [...v,s.sourceId] : v.filter(id => id !== s.sourceId)); setPreview(null); setError(''); }} /><span><strong>{s.name}</strong><small>{s.owner}/{s.repo} · {s.branch} · {s.path || '/'}</small></span><span className="badge">{s.enabled ? '已启用' : '已停用'}</span></label>)}{!enabled.length && <p>暂无启用的照片源，请先在“照片源”页面配置。</p>}</section>
    {preview && <section className="panel sync-result" aria-label="本次预览"><div className="panel-title"><div><h2>本次预览 <span className="badge">未应用任何更改</span></h2><p>{new Date(preview.checkedAt).toLocaleString()} · {preview.baselineRunId ? `比较同步 #${preview.baselineRunId}` : preview.baselineState === 'empty' ? '首次同步 · 空照片库基线' : '历史基线不可用'} · 仅检查文件差异，图片可用性由正式同步验证。</p></div></div><Stats counts={preview.counts} preview conflicts={preview.conflicts.length} errors={preview.sources.filter(s => s.error).length} />{preview.errors.map((e,i) => <p className="error" key={i}>{e}</p>)}{preview.conflicts.map((c,i) => <p className="error" key={i}>{c.key} 仍被「{c.title}」引用，请先编辑该 Project。</p>)}{!preview.partialAllowed && ids.length !== enabled.length && <p className="error">{preview.partialReason}</p>}{preview.sources.map(s => <details className="sync-files" key={s.sourceId}><summary>{s.name} · {s.counts ? `新增 ${s.counts.added} / 更新 ${s.counts.updated} / 移除 ${s.counts.removed} / 未变化 ${s.counts.unchanged}` : '无法确定'}</summary><p className="muted">{s.beforeCommit?.slice(0,7) ?? '无基线'} → {s.commit?.slice(0,7) ?? '未知'}</p>{s.changes.length ? <ul>{s.changes.map(c => <li key={c.kind + c.reference}><span className="badge">{{ added:'新增',updated:'更新',removed:'移除' }[c.kind]}</span> {c.key}</li>)}</ul> : <p>{s.error || '没有文件变化'}</p>}</details>)}</section>}
    <section className="panel sync-result" aria-label="最近完成的同步"><div className="panel-title"><div><h2>最近完成的同步</h2><p>{latest ? `${latest.title} · ${latest.conclusion}${latest.completedAt ? ' · ' + new Date(latest.completedAt).toLocaleString() : ''}${duration !== null ? ' · 耗时 ' + duration + ' 秒' : ''}` : '暂无可验证的同步记录'}</p></div></div>{historyError && <p className="error">{historyError}</p>}{latest?.summary?.sync?.applied && latest?.summary?.adminRead?.status === 'success' ? <><p className="muted">{(latest.summary.sync.sourceIds ?? []).map((id: string) => sources.find(s => s.sourceId === id)?.name ?? id).join('、')} · 已应用到照片库</p><Stats counts={latest.summary.sync.counts} />{!latest.summary.sync.counts && <p className="muted">同步已完成；旧基线不可用，无法确定本次增减数量。</p>}</> : <p className="muted">暂无统计{latest && latest.conclusion !== 'success' ? '，同步未完成或结果尚未确认。' : '，历史任务可能未记录文件差异。'}</p>}</section>
    {connected && <Tasks pending={pending} refreshPhotos={refreshPhotos} completed={async success => { const refreshed = success && !dirty ? await refreshPhotos() : false; if (success) setPreview(null); await loadHistory(); setPending(undefined); setNotice(success && dirty ? '同步已完成。当前未保存编辑已保留，请保存后刷新照片库。' : success && !refreshed ? '同步已完成，但照片库刷新失败，请重试刷新。网站尚未发布。' : success ? '同步已完成，照片库已刷新。网站尚未发布。' : '同步未完成，请检查执行记录；原照片库保留。'); }} />}
  </section>;
}
