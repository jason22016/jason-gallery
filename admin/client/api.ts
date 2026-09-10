export class RequestError extends Error { constructor(public status: number, message: string, public details?: unknown) { super(message); } }
export async function request(path: string, body?: unknown) {
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin', redirect: 'error' });
  const data = await response.json();
  if (!response.ok) throw new RequestError(response.status, data.message || '请求失败', data.details);
  return data;
}
