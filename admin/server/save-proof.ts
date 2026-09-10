import { createHmac, timingSafeEqual } from 'node:crypto';
import { ApiError } from './errors';
import type { Project } from '../../src/projects/schema';

export type ProjectReferences = Pick<Project, 'id' | 'slug' | 'coverPhotoId' | 'photos'> & { bytes: number };
export interface SaveProof {
  version: 1;
  head: string;
  runId: number;
  runAttempt: number;
  runHead: string;
  artifactId: number;
  photosArtifactId: number;
  artifactDigest: string;
  archiveBytes: number;
  expiresAt: number;
  ids: string[];
  aliases: [string, string][];
  projects: ProjectReferences[];
}
const maximum = 256000;
const mac = (env: Env, body: string) => createHmac('sha256', env.GITHUB_TOKEN)
  .update('gallery-admin:save:v1\0').update(env.ADMIN_ORIGIN).update('\0')
  .update(env.GITHUB_REPOSITORY).update('\0').update(body).digest();

// The browser carries a signed, immutable editing snapshot. It is usable only at
// this exact Git HEAD; GitHub's atomic expectedHeadOid check enforces that boundary.
// No authentication decision, secret, or download URL is present in the snapshot.
export function signSaveProof(env: Env, proof: SaveProof): string | undefined {
  const body = Buffer.from(JSON.stringify(proof)).toString('base64url');
  if (body.length + 44 > maximum) return undefined; // Large collections retain the full read path.
  return body + '.' + mac(env, body).toString('base64url');
}
export function verifySaveProof(env: Env, token: string, expectedHead: string): SaveProof {
  const invalid = () => new ApiError(403, 'save_proof', '保存校验信息无效，请保留编辑并重新加载仓库', undefined, { stage: 'save_proof' });
  if (token.length > maximum || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token)) throw invalid();
  const [body, signature] = token.split('.');
  const actual = Buffer.from(signature!, 'base64url'), expected = mac(env, body!);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw invalid();
  let proof: SaveProof;
  try { proof = JSON.parse(Buffer.from(body!, 'base64url').toString('utf8')); } catch { throw invalid(); }
  if (!proof || proof.version !== 1 || !/^[a-f0-9]{40}$/.test(proof.head) || !Array.isArray(proof.ids) || !Array.isArray(proof.aliases) || !Array.isArray(proof.projects) || !Number.isFinite(proof.expiresAt)) throw invalid();
  if (proof.head !== expectedHead) throw new ApiError(409, 'conflict', '保存校验版本与编辑版本不一致，请保留编辑并重新加载');
  if (proof.expiresAt <= Date.now()) throw new ApiError(410, 'expired', '照片产物已过期，请保留编辑并重新同步');
  return proof;
}
export function projectReferences(project: Project, bytes: number): ProjectReferences {
  return { id: project.id, slug: project.slug, coverPhotoId: project.coverPhotoId, photos: project.photos.map(p => ({ photoId: p.photoId })), bytes };
}
