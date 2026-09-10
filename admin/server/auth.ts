import { createRemoteJWKSet, jwtVerify, customFetch } from 'jose';
import { ApiError } from './errors';
export async function authenticate(request: Request, env: Env, transport: typeof fetch = fetch) {
  if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_ISSUER) || !env.ACCESS_AUD || !env.ADMIN_EMAILS || !env.GITHUB_TOKEN || !/^https:\/\/[^/]+$/.test(env.ADMIN_ORIGIN)) throw new ApiError(503, 'not_configured', '后台尚未配置 Cloudflare Access 与服务端凭据');
  // The edge supplies this signed assertion. Never accept an email header or a client role.
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token || token.length > 16384) throw new ApiError(401, 'unauthorized', '请通过 Cloudflare Access 登录');
  try {
    const keys = createRemoteJWKSet(new URL(`${env.ACCESS_ISSUER}/cdn-cgi/access/certs`), { [customFetch]: transport, timeoutDuration: 5000 });
    const { payload } = await jwtVerify(token, keys, { issuer: env.ACCESS_ISSUER, audience: env.ACCESS_AUD, algorithms: ['RS256'], requiredClaims: ['exp', 'iat', 'sub', 'email'], clockTolerance: 5 });
    if (typeof payload.iat !== 'number' || payload.iat > Date.now() / 1000 + 5) throw new Error('future token');
    const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : '';
    if (!env.ADMIN_EMAILS.split(',').map(v => v.trim().toLowerCase()).includes(email) || !email) throw new Error('not admin');
    return email;
  } catch { throw new ApiError(401, 'unauthorized', '管理员身份验证失败或登录已过期'); }
}
