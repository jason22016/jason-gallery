import { ApiError } from './errors';
export interface PreviewProof {
  version: 1; repository: string; runId: number; id: string;
  artifactId: number; photosArtifactId: number; artifactDigest: string;
  archiveBytes: number; offset: number; length: number; hash: string; expiresAt: number;
}
const prefix = 'gallery-admin:preview:v1\0';
const key = (env: Env) => crypto.subtle.importKey('raw', new TextEncoder().encode(env.GITHUB_TOKEN), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
const message = (env: Env, body: string) => new TextEncoder().encode(prefix + env.ADMIN_ORIGIN + '\0' + env.GITHUB_REPOSITORY + '\0' + body);
export async function proofSigner(env: Env) {
  const signingKey = await key(env);
  return async (proof: PreviewProof) => {
    const body = Buffer.from(JSON.stringify(proof)).toString('base64url');
    const signature = await crypto.subtle.sign('HMAC', signingKey, message(env, body));
    return body + '.' + Buffer.from(signature).toString('base64url');
  };
}
export async function verifyProof(env: Env, token: string, runId: number, id: string): Promise<PreviewProof> {
  const invalid = () => new ApiError(403, 'preview_proof', '缩略图读取证明无效，请刷新照片目录', undefined, { stage: 'preview_proof' });
  if (token.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token)) throw invalid();
  const [body, signature] = token.split('.');
  if (!await crypto.subtle.verify('HMAC', await key(env), Buffer.from(signature!, 'base64url'), message(env, body!))) throw invalid();
  let p: PreviewProof;
  try { p = JSON.parse(Buffer.from(body!, 'base64url').toString('utf8')); } catch { throw invalid(); }
  if (p.version !== 1 || p.repository !== env.GITHUB_REPOSITORY || p.runId !== runId || p.id !== id || !Number.isSafeInteger(p.runId) || p.runId <= 0 || !Number.isSafeInteger(p.artifactId) || p.artifactId <= 0 || !Number.isSafeInteger(p.photosArtifactId) || p.photosArtifactId <= 0 || !/^sha256:[a-f0-9]{64}$/.test(p.artifactDigest) || !/^[a-f0-9]{64}$/.test(p.hash) || !Number.isSafeInteger(p.archiveBytes) || p.archiveBytes <= 0 || p.archiveBytes > 1024 ** 3 || !Number.isSafeInteger(p.offset) || p.offset < 0 || !Number.isSafeInteger(p.length) || p.length <= 0 || p.length > 8 * 1024 ** 2 || p.offset + p.length > p.archiveBytes || !Number.isFinite(p.expiresAt)) throw invalid();
  if (p.expiresAt <= Date.now()) throw new ApiError(410, 'expired', '缩略图产物已过期，请刷新照片目录', undefined, { stage: 'preview_proof' });
  return p;
}
