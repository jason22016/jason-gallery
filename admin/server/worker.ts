import { ZodError } from 'zod';
import { authenticate } from './auth';
import { ApiError, jsonBody } from './errors';
import { GitHub } from './github';
import { AdminService } from './service';
function secure(response: Response, env: Env) {
  const result = new Response(response.body, response);
  result.headers.set('Cache-Control', 'no-store');
  result.headers.set('X-Content-Type-Options', 'nosniff');
  result.headers.set('Referrer-Policy', 'no-referrer');
  result.headers.set('Content-Security-Policy', "default-src 'self'; img-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  return result;
}
// Dependency injection is only for transport-level tests; no development login or auth bypass exists.
async function route(request: Request, env: Env, transport: typeof fetch, assetRead: () => void) {
  try {
    const email = await authenticate(request, env, transport);
    const url = new URL(request.url);
    if (url.origin !== env.ADMIN_ORIGIN) throw new ApiError(403, 'origin', '此管理入口不在配置的域名上');
    if (!['GET', 'POST'].includes(request.method)) throw new ApiError(405, 'method', '不支持的请求方法');
    if (request.method === 'POST' && (request.headers.get('Origin') !== env.ADMIN_ORIGIN || request.headers.get('Content-Type')?.split(';')[0] !== 'application/json')) throw new ApiError(403, 'csrf', '写请求必须来自后台同源 JSON 表单');
    const service = new AdminService(new GitHub(env, transport));
    let response: Response;
    if (url.pathname.startsWith('/api/')) {
      let data: unknown;
      if (request.method === 'GET' && url.pathname === '/api/state') data = { ...await service.bootstrap(), email };
      else if (request.method === 'GET' && url.pathname === '/api/tasks') data = await service.tasks(url.searchParams.get('requestId') ?? undefined);
      else if (request.method === 'POST' && ['/api/save', '/api/impact', '/api/dispatch'].includes(url.pathname)) {
        const body = await jsonBody(request as unknown as Response, 512000);
        data = await (url.pathname === '/api/save' ? service.save(body) : url.pathname === '/api/impact' ? service.impact(body) : service.dispatch(body));
      } else if (request.method === 'GET' && /^\/api\/thumbnail\/\d+\/[a-z\d-]+$/.test(url.pathname)) {
        const [, , , run, reference] = url.pathname.split('/');
        response = new Response(await service.thumbnail(Number(run), reference) as BodyInit, { headers: { 'Content-Type': 'image/jpeg' } });
        return secure(response!, env);
      } else throw new ApiError(404, 'route', '管理接口不存在');
      // Never echo token text even if a remote error/summary includes it.
      response = new Response(JSON.stringify(data).split(env.GITHUB_TOKEN).join('[redacted]'), { headers: { 'Content-Type': 'application/json' } });
    } else if (request.method === 'GET') { assetRead(); response = await env.ASSETS.fetch(request as any) as unknown as Response; }
    else throw new ApiError(404, 'route', '管理接口不存在');
    return secure(response, env);
  } catch (error) {
    const api = error instanceof ApiError ? error : error instanceof ZodError ? new ApiError(422, 'validation', '配置或 Project 格式无效', error.issues.map(i => ({ path: i.path, message: i.message }))) : new ApiError(502, 'unavailable', '服务暂不可用或产物验证失败，请检查配置并重试');
    const body = JSON.stringify({ error: api.code, message: api.message, details: api.details });
    return secure(new Response(env.GITHUB_TOKEN ? body.split(env.GITHUB_TOKEN).join('[redacted]') : body, { status: api.status, headers: { 'Content-Type': 'application/json' } }), env);
  }
}
export async function handle(request: Request, env: Env, transport: typeof fetch = fetch) {
  const requestId = crypto.randomUUID(), started = Date.now();
  let upstreamRequests = 0, assetRequests = 0;
  const counted: typeof fetch = async (input, init) => {
    if (upstreamRequests >= 48) throw new ApiError(413, 'request_budget', '单次操作的上游请求超过安全预算');
    upstreamRequests++;
    return transport.call(globalThis, input, init);
  };
  const response = await route(request, env, counted, () => { assetRequests++; });
  response.headers.set('X-Admin-Request-Id', requestId);
  const pathname = new URL(request.url).pathname;
  const label = /^\/api\/thumbnail\//.test(pathname) ? '/api/thumbnail/*' : ['/api/state', '/api/save', '/api/impact', '/api/dispatch', '/api/tasks'].includes(pathname) ? pathname : 'asset-or-unknown';
  // No URLs, identities, cookies, tokens, signed locations or payloads. CPU/outcome
  // are Cloudflare invocation fields, never inferred from this wall-clock duration.
  console.info(JSON.stringify({ event: 'admin-request', requestId, route: label, method: request.method, status: response.status, upstreamRequests, assetRequests, cacheOperations: 0, wallMs: Date.now() - started }));
  return response;
}
export default { fetch: (request: Request, env: Env) => handle(request, env) };
