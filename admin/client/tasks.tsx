import { useEffect, useRef, useState } from 'react';
import { request } from './api';
export function Tasks({ pending, refreshPhotos, completed }: { pending?: { requestId: string; mode: string }; refreshPhotos: () => void; completed?: (success: boolean) => Promise<void> }) {
  const completion = useRef(completed); completion.current = completed;
  const reported = useRef<string | null>(null);
  const [data, setData] = useState<any>(null); const [error, setError] = useState('');
  useEffect(() => {
    let active = true; let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      let keepPolling = true;
      try { const result = await request('/api/tasks' + (pending ? `?requestId=${pending.requestId}` : '')); if (active) { setData(result); setError(''); } keepPolling = result.pending || result.tasks.some((task: any) => task.state !== 'completed'); if (active && pending && !keepPolling && result.tasks.length && reported.current !== pending.requestId) { reported.current = pending.requestId; await completion.current?.(result.tasks[0].summary?.photos?.status === 'success' && result.tasks[0].summary?.adminRead?.status === 'success'); } }
      catch (e) { if (active) setError(e instanceof Error ? e.message : '任务读取失败'); }
      if (active && keepPolling) timer = setTimeout(poll, 8000);
    }
    void poll(); return () => { active = false; clearTimeout(timer); };
  }, [pending]);
  return <section className="panel task-panel"><div className="panel-title"><div><h2>Actions 执行记录</h2><p>运行中每 8 秒刷新，完成后停止轮询；每源结果来自执行摘要。</p></div><button className="secondary" onClick={refreshPhotos}>刷新后台数据</button></div>
    {data?.historyUrl && <p><a href={data.historyUrl} target="_blank" rel="noreferrer">在 GitHub 查看全部任务 ↗</a></p>}
    {error && <p role="alert" className="error">{error} · 任务结果尚未确认。</p>}
    {!data && !error && <p>正在读取任务…</p>}
    {data?.pending && <p role="status">请求已发送，等待 GitHub 创建任务。尚未确认排队或成功，请勿重复触发。</p>}
    {data && !data.pending && !data.tasks.length && <p>暂无执行记录。需要导入照片时，请前往“照片 → 同步照片”。</p>}
    {data?.tasks.map((task: any) => <article className="task-record" key={task.id}>
      <div className="panel-title"><h3>{task.title}</h3><a href={task.url} target="_blank" rel="noreferrer">查看 Actions ↗</a></div>
      <p>{task.state === 'completed' ? `执行结束：${task.conclusion}` : task.state === 'in_progress' ? '执行中' : '排队中'} · {task.event} · {task.head.slice(0, 7)}</p>
      <p role="status">{task.published ? `网站发布已确认：${task.summary.deployment.url}` : '网站发布未确认'}</p>
      {task.summaryError && <p className="error">{task.summaryError}</p>}
      {task.summary?.failureReason && <p className="error">{task.summary.failureReason}</p>}
      {task.summary && <p>照片：{task.summary.photos?.status} · 构建：{task.summary.website?.status} · 部署：{task.summary.deployment?.status}</p>}
      <details open={task.state !== 'completed'}><summary>执行阶段</summary>{task.steps.map((s: any, i: number) => <p key={i}>{s.name} — {s.conclusion || s.status}</p>)}</details>
      {(task.summary?.sources ?? []).map((s: any) => <div className="task-source" key={s.sourceId}><div><strong>{s.sourceId}</strong><small>{s.failureReason}</small></div><span>{s.processed ?? '—'} / {s.reused ?? '—'} / {s.total ?? '—'}</span><span>{s.status}</span></div>)}
      {task.state === 'completed' && !task.summary && <p>摘要缺失或已过期；不能据此认定发布成功。</p>}
    </article>)}
  </section>;
}
