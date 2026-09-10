export class RequestError extends Error { constructor(public status: number, message: string, public details?: unknown, public code?: string, public outcomeUnknown = false) { super(message); } }
export async function request(path: string, body?: unknown) {
  const write = body !== undefined;
  const unconfirmed = write ? path === '/api/save' ? '；保存结果尚未确认，当前编辑已保留，请核对仓库后再重试' : '；操作结果尚未确认，请先核对任务或仓库，避免重复提交' : '';
  let response: Response;
  let text: string;
  try {
    response = await fetch(path, { method: write ? 'POST' : 'GET', headers: write ? { 'Content-Type': 'application/json' } : {}, body: write ? JSON.stringify(body) : undefined, credentials: 'same-origin', redirect: 'error' });
    text = await response.text();
  } catch { throw new RequestError(0, '网络连接中断或登录跳转未完成，请检查连接和登录状态' + unconfirmed, undefined, 'network', write); }
  let data: any;
  try { data = JSON.parse(text); } catch { /* Platform HTML and empty bodies are not API JSON. */ }
  if (!response.ok || !data || typeof data !== 'object' || Array.isArray(data)) {
    const resourceLimit = response.status === 503 && /(?:error\s*(?:code\s*)?:?\s*1102|worker exceeded resource limits)/i.test(text.slice(0,32768).replace(/<[^>]*>/g,' '));
    const unknown = write && (response.status >= 500 || response.ok || !data);
    const message = resourceLimit ? '后台资源超限（Cloudflare 1102，HTTP 503）' : typeof data?.message === 'string' ? data.message : response.ok ? `后台响应格式无效（HTTP ${response.status}）` : `后台请求失败（HTTP ${response.status}），请稍后重试`;
    throw new RequestError(response.status, message + (unknown ? unconfirmed : ''), data?.details, resourceLimit ? 'resource_limit' : data?.error ?? 'invalid_response', unknown);
  }
  if (write && path === '/api/save' && (data.status !== 'saved' || typeof data.head !== 'string' || !/^[a-f0-9]{40}$/.test(data.head) || data.head === (body as any)?.expectedHead || data.saveProof !== undefined && (typeof data.saveProof !== 'string' || !data.saveProof.length || data.saveProof.length > 256000))) {
    throw new RequestError(response.status, '后台未返回有效的新保存版本' + unconfirmed, undefined, 'invalid_save_response', true);
  }
  return data;
}
