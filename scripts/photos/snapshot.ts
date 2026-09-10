import { loadSources, makeSnapshot, sourceAPI, type SourcesConfig, type PhotoSnapshot } from '../../src/photo-engine/sources.js';

export interface SourceStatus { sourceId: string; status: 'disabled' | 'pending' | 'resolved' | 'success' | 'failure'; commit: string | null; total: number | null; processed: number | null; reused: number | null; failureReason: string | null }
export const sourceStatuses = (config: SourcesConfig): SourceStatus[] => config.sources.map(s => ({ sourceId: s.sourceId, status: s.enabled ? 'pending' : 'disabled', commit: null, total: null, processed: null, reused: null, failureReason: null }));
export function sourceToken(sourceId: string) {
  const tokens = JSON.parse(process.env.JASON_PHOTOS_READ_TOKENS || '{}');
  if (!tokens || Array.isArray(tokens) || typeof tokens !== 'object' || Object.values(tokens).some(t => typeof t !== 'string')) throw new Error('JASON_PHOTOS_READ_TOKENS must be a JSON object of strings');
  return tokens[sourceId] || process.env.JASON_PHOTOS_READ_TOKEN;
}
export function safeReason(error: unknown) {
  let reason = error instanceof Error ? error.message : String(error);
  const secrets = ['JASON_PHOTOS_READ_TOKEN', 'JASON_PHOTOS_READ_TOKENS', 'GITHUB_TOKEN', 'CLOUDFLARE_API_TOKEN'].map(k => process.env[k]);
  try { secrets.push(...Object.values(JSON.parse(process.env.JASON_PHOTOS_READ_TOKENS || '{}')) as string[]); } catch {}
  for (const secret of secrets) if (secret) reason = reason.replaceAll(secret, '[redacted]');
  return reason;
}
export function parseCommits(input: string, config: SourcesConfig) {
  if (!input) return undefined;
  const commits = JSON.parse(input);
  if (!commits || typeof commits !== 'object' || Array.isArray(commits)) throw new Error('photo_commits must be an object keyed by every enabled sourceId');
  makeSnapshot(config, commits);
  return commits as Record<string,string>;
}
export async function resolveSnapshot(config: SourcesConfig = loadSources(), requested?: Record<string,string>, statuses = sourceStatuses(config)): Promise<PhotoSnapshot> {
  if (requested) makeSnapshot(config, requested);
  const commits: Record<string,string> = {};
  for (const source of config.sources.filter(s => s.enabled)) {
    const status = statuses.find(s => s.sourceId === source.sourceId)!;
    try {
      // Public originals are a contract, including when a build token is supplied.
      const publicRepo = await fetch(sourceAPI(source), { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(60_000) });
      if (!publicRepo.ok || (await publicRepo.json() as {private?: boolean}).private !== false) throw new Error('Photo repository must be anonymously readable');
      const token = sourceToken(source.sourceId);
      const target = requested?.[source.sourceId] ?? source.branch;
      const response = await fetch(`${sourceAPI(source)}/commits/${encodeURIComponent(target)}`, { headers: { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new Error(`Source commit resolution failed (${response.status})`);
      const commit = (await response.json() as {sha: string}).sha;
      if (!/^[a-f0-9]{40}$/.test(commit) || (requested && commit !== target)) throw new Error('Invalid/unmatched source commit');
      commits[source.sourceId] = commit; status.commit = commit; status.status = 'resolved';
    } catch (error) { status.status = 'failure'; status.failureReason = safeReason(error); }
  }
  if (statuses.some(s => s.status === 'failure')) throw new Error(`Source resolution failed: ${statuses.filter(s => s.status === 'failure').map(s => `${s.sourceId}: ${s.failureReason}`).join('; ')}`);
  return makeSnapshot(config, commits);
}
