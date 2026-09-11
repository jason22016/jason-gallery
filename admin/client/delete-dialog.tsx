import { useEffect, useRef, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import { z } from 'zod';
import { request, RequestError } from './api';
import type { PhotoSource } from '../../src/photo-engine/source-schema';
import type { Project } from '../../src/projects/schema';

export type DeleteTarget = { kind: 'project'; project: Project } | { kind: 'source'; source: PhotoSource };
const ImpactSchema = z.array(z.object({ projectId: z.string(), title: z.string(), status: z.enum(['draft', 'published']), count: z.number().int().positive() }));
const SourceImpactSchema = z.array(ImpactSchema.element.extend({ sourceId: z.string() }));
type Impact = z.infer<typeof ImpactSchema>[number];

export function DeleteDialog({ target, head, connected, sources, localImpacts, dirty, close, deleted }: {
  target: DeleteTarget;
  head: string;
  connected: boolean;
  sources: PhotoSource[];
  localImpacts: Impact[];
  dirty: boolean;
  close: () => void;
  deleted: (head?: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [mustRefresh, setMustRefresh] = useState(false);
  const [impacts, setImpacts] = useState<Impact[] | null>(target.kind === 'project' ? [] : connected ? null : localImpacts);
  const [checkVersion, setCheckVersion] = useState(0);
  const name = target.kind === 'project' ? target.project.title : target.source.name;
  const label = target.kind === 'project' ? 'Project' : '照片源';
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    if (target.kind !== 'source' || !connected) return;
    let active = true;
    setImpacts(null); setError('');
    const config = { schemaVersion: 1, sources: sources.filter(s => s.sourceId !== target.source.sourceId) };
    request('/api/impact', config).then(result => {
      if (!active) return;
      if (result.head !== head) { setMustRefresh(true); setError('仓库已有更新，请关闭弹窗并刷新仓库后重新检查。'); return; }
      setImpacts(SourceImpactSchema.parse(result.impacts).filter(p => p.sourceId === target.source.sourceId));
    }).catch(e => { if (active) setError(e instanceof Error ? e.message : '引用检查失败，请重试。'); });
    return () => { active = false; };
  }, [target, head, connected, sources, checkVersion]);

  async function confirm() {
    if (submitting.current || mustRefresh || impacts === null || impacts.length > 0) return;
    submitting.current = true; setBusy(true); setError('');
    try {
      let nextHead: string | undefined;
      if (connected) {
        const result = await request('/api/delete', {
          expectedHead: head,
          ...(target.kind === 'project' ? { kind: 'project', projectId: target.project.id } : { kind: 'source', sourceId: target.source.sourceId }),
        });
        nextHead = result.head;
      }
      deleted(nextHead);
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败，请检查后重试。');
      if (e instanceof RequestError) {
        if (e.outcomeUnknown || e.status === 409 || e.status === 404) setMustRefresh(true);
        if (e.code === 'source_impact') {
          const parsed = ImpactSchema.safeParse(e.details);
          // A failed impact response must never leave deletion enabled.
          setImpacts(parsed.success && parsed.data.length ? parsed.data : null);
        }
      }
    } finally { submitting.current = false; setBusy(false); }
  }

  return <dialog ref={dialog} aria-labelledby="delete-title" onCancel={e => { e.preventDefault(); if (!submitting.current) close(); }}>
    <div className="dialog-head"><h2 id="delete-title">删除{label}</h2><button aria-label="关闭删除确认" disabled={busy} onClick={close}><X size={18} /></button></div>
    <div className="delete-info" aria-busy={busy}>
      <p>确认删除“<strong>{name}</strong>”？</p>
      {target.kind === 'project' ? <>
        <p>将删除这个 Project 的文字、封面和照片编排，照片库与 GitHub 原图会保留。</p>
        {dirty && <p>当前 Project 的未保存修改也会在删除成功后放弃。</p>}
        {target.project.status === 'published' && <p>主站会在下一次成功发布后移除这个 Project。</p>}
      </> : <>
        <p>将解除与 {target.source.owner}/{target.source.repo} 的连接，仓库和原图会保留。</p>
        {impacts === null && !error && <p role="status">正在检查 Project 引用…</p>}
        {impacts?.length === 0 && <p>没有 Project 引用此照片源，可以删除。</p>}
        {!!impacts?.length && <div className="impact error"><strong>暂时无法删除：仍有 Project 引用</strong><ul>{impacts.map(p => <li key={p.projectId}>{p.title} · {p.status === 'draft' ? '草稿' : '已设为发布'} · {p.count} 张照片</li>)}</ul><p>请先删除这些 Project，或移除、迁移其中的照片引用。</p></div>}
      </>}
      {!connected && <p>这是界面预览，删除仅影响当前页面。</p>}
      {error && <p role="alert" className="error">{error}</p>}
      {mustRefresh && <p>请先关闭弹窗，保留需要的编辑后刷新仓库，核对实际结果。</p>}
      {target.kind === 'source' && impacts === null && error && !mustRefresh && <button className="secondary" disabled={busy} onClick={() => setCheckVersion(v => v + 1)}>重新检查引用</button>}
      <div className="dialog-actions"><button className="secondary" disabled={busy} onClick={close}>取消</button><button className="danger" disabled={busy || mustRefresh || impacts === null || impacts.length > 0} onClick={confirm}><Trash2 size={15} />{busy ? '正在删除…' : '确认删除'}</button></div>
    </div>
  </dialog>;
}
