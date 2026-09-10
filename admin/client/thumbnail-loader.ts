/** View-local sharing. Four fetches maximum; no Cache API or persistent storage. */
export type ImageState = { url?: string; error?: string; status?: number; requestId?: string };
type Entry = { src: string; listeners: Set<(state: ImageState) => void>; phase: 'queued'|'active'|'ready'|'error'; state: ImageState };
const entries = new Map<string, Entry>(), queue: Entry[] = [], observers = new Set<() => void>();
let active = 0;
const notify = (e: Entry) => { for (const listener of e.listeners) listener(e.state); for (const observer of observers) observer(); };
const remove = (e: Entry) => { if (e.state.url) URL.revokeObjectURL(e.state.url); entries.delete(e.src); };
async function download(src: string): Promise<Blob> {
  const response = await fetch(src, { credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20000) });
  const requestId = response.headers.get('X-Admin-Request-Id') ?? undefined;
  if (!response.ok) {
    const text = (await response.text()).slice(0,32768);
    let code = ''; try { code = JSON.parse(text)?.error ?? ''; } catch { /* HTML is never displayed. */ }
    const error = response.status === 401 ? '登录已失效，请重新登录后重试' : response.status === 503 && /1102|Worker exceeded resource limits/i.test(text) ? '后台资源超限，请稍后重试' : code === 'expired' ? '照片产物已过期，请刷新目录' : `缩略图加载失败（HTTP ${response.status}）`;
    throw Object.assign(new Error(error), { status: response.status, requestId });
  }
  if (!response.headers.get('Content-Type')?.toLowerCase().startsWith('image/jpeg')) { await response.body?.cancel(); throw Object.assign(new Error('缩略图响应格式无效'), {status:422,requestId}); }
  const blob = await response.blob();
  if (!blob.size || blob.size > 8 * 1024 ** 2) throw Object.assign(new Error('缩略图响应大小无效'), {status:422,requestId});
  return blob;
}
function pump() {
  while (active < 4 && queue.length) {
    const e = queue.shift()!;
    if (!e.listeners.size || entries.get(e.src) !== e) continue;
    active++; e.phase = 'active';
    void (async () => {
      try {
        let blob: Blob | undefined;
        for (let attempt=0;attempt<2;attempt++) {
          try { blob = await download(e.src); break; }
          catch(error) { const status=(error as any).status; if (attempt || !e.listeners.size || status && ![502,503,504].includes(status)) throw error; await new Promise(resolve=>setTimeout(resolve,350+Math.random()*350)); }
        }
        e.state = {url:URL.createObjectURL(blob!)}; e.phase='ready';
      } catch (error) { e.state = {error: (error as any).status && error instanceof Error ? error.message : '缩略图网络连接失败，请检查连接和登录状态',status:(error as any).status,requestId:(error as any).requestId}; e.phase='error'; }
      finally { active--; if (!e.listeners.size) remove(e); else notify(e); pump(); }
    })();
  }
}
export function subscribeThumbnail(src: string, listener: (state: ImageState)=>void) {
  let e=entries.get(src);
  if (!e) { e={src,listeners:new Set(),phase:'queued',state:{}};entries.set(src,e);queue.push(e); }
  e.listeners.add(listener); listener(e.state);pump();
  return () => { e!.listeners.delete(listener); if (!e!.listeners.size && e!.phase!=='active') remove(e!); for(const observer of observers) observer(); };
}
export const thumbnailFailures = () => [...entries.values()].filter(e=>e.phase==='error'&&e.listeners.size).map(e=>e.state);
export const observeThumbnails = (callback:()=>void) => {observers.add(callback);return()=>{observers.delete(callback);};};
export function retryThumbnails() { for(const e of entries.values()) if(e.phase==='error'&&e.listeners.size){e.state={};e.phase='queued';queue.push(e);notify(e);}pump(); }

export function markThumbnailBroken(src:string) {const e=entries.get(src);if(e?.phase==='ready'){if(e.state.url)URL.revokeObjectURL(e.state.url);e.state={error:'缩略图无法解码，请重试',status:422};e.phase='error';notify(e);}}
