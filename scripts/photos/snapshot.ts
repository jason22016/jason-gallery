import path from 'node:path';
import { SUPPORTED_FORMATS } from '@afilmory/builder/constants/index.js';
import { createReadOnlyFetch } from './network.js';
import { loadSources, makeSnapshot, sourceAPI, originalURL, type SourcesConfig, type PhotoSnapshot } from '../../src/photo-engine/sources.js';

export interface SourceStatus { sourceId: string; status: 'disabled' | 'pending' | 'resolved' | 'success' | 'failure'; commit: string | null; total: number | null; processed: number | null; reused: number | null; failureReason: string | null; retained?: boolean }
export const sourceStatuses = (config: SourcesConfig): SourceStatus[] => config.sources.map(s => ({ sourceId: s.sourceId, status: s.enabled ? 'pending' : 'disabled', commit: null, total: null, processed: null, reused: null, failureReason: null }));
export function sourceToken(sourceId: string) {
  const tokens = JSON.parse(process.env.JASON_PHOTOS_READ_TOKENS || '{}');
  if (!tokens || Array.isArray(tokens) || typeof tokens !== 'object' || Object.values(tokens).some(t => typeof t !== 'string')) throw new Error('JASON_PHOTOS_READ_TOKENS must be a JSON object of strings');
  return (Object.hasOwn(tokens, sourceId) ? tokens[sourceId] : undefined) || process.env.JASON_PHOTOS_READ_TOKEN;
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
// Never print response bodies, authorization headers or transport error messages.
// GitHub deliberately makes inaccessible private repositories indistinguishable
// from missing repositories (404); only private:true confirms a private source.
async function checkedRead(request: typeof fetch, url: string, stage: string, token?: string, original = false) {
  let response: Response;
  try {
    response = await request(url, {
      headers: original ? { Range: 'bytes=0-0' } : { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      redirect: 'error', credentials: 'omit',
    });
  } catch {
    throw new Error(`${stage}: temporary network/timeout or rejected redirect; bounded reads exhausted`);
  }
  if (response.ok) return response;
  const fields = ['x-ratelimit-remaining', 'x-ratelimit-reset', 'retry-after', 'x-github-request-id']
    .map(key => `${key}=${(response.headers.get(key) ?? 'unknown').replace(/[^a-zA-Z0-9:.-]/g, '').slice(0, 100)}`).join(', ');
  const body = await response.text().catch(() => '');
  const limited = response.status === 429 || (response.status === 403 &&
    (response.headers.get('x-ratelimit-remaining') === '0' || /(?:secondary |API )?rate limit|abuse detection/i.test(body)));
  const cause = limited ? 'rate_limited' : response.status === 401 ? 'authentication_failed'
    : response.status === 404 ? 'not_found_or_inaccessible (404 cannot distinguish missing from private)'
    : response.status === 403 ? 'forbidden (rate limiting not established)'
    : response.status === 408 || response.status >= 500 ? 'temporary_server_error' : 'http_error';
  throw new Error(`${stage}: ${cause}; HTTP ${response.status}; auth=${token ? 'source-token' : 'anonymous'}; ${fields}`);
}
async function apiJSON(request: typeof fetch, url: string, stage: string, token?: string): Promise<any> {
  const response = await checkedRead(request, url, stage, token);
  try { return await response.json(); } catch { throw new Error(`${stage}: invalid JSON response`); }
}

export async function resolveSnapshot(config: SourcesConfig = loadSources(), requested?: Record<string,string>, statuses = sourceStatuses(config), retained: string[] = []): Promise<PhotoSnapshot> {
  if (requested) makeSnapshot(config, requested);
  const request = createReadOnlyFetch([]);
  const commits: Record<string,string> = {};
  for (const source of config.sources.filter(s => s.enabled)) {
    const status = statuses.find(s => s.sourceId === source.sourceId)!;
    try {
      if (retained.includes(source.sourceId)) {
        if (!requested?.[source.sourceId]) throw new Error('Retained source requires pinned baseline');
        commits[source.sourceId] = requested[source.sourceId]!; status.commit = commits[source.sourceId]!; status.status = 'resolved'; continue;
      }
      const token = sourceToken(source.sourceId);
      const repository = await apiJSON(request, sourceAPI(source), 'repository visibility API', token);
      if (repository?.private === true) throw new Error('private_repository: public photo sources required');
      if (repository?.private !== false) throw new Error('unknown_visibility: repository API must explicitly return private:false');
      const target = requested?.[source.sourceId] ?? source.branch;
      const data = await apiJSON(request, `${sourceAPI(source)}/commits/${encodeURIComponent(target)}`, 'source commit API', token);
      const commit = data?.sha;
      if (typeof commit !== 'string' || !/^[a-f0-9]{40}$/.test(commit) || (requested && commit !== target)) throw new Error('Invalid/unmatched source commit');
      status.commit = commit;
      console.info(`Source ${source.sourceId}: repository API confirmed private=false; commit=${commit}`);
      // API visibility and actual public delivery are independent gates. Inspect
      // every original, including cache hits, at this exact immutable snapshot.
      const tree = await apiJSON(request, `${sourceAPI(source)}/git/trees/${commit}?recursive=1`, 'source tree API', token);
      if (tree?.truncated !== false || !Array.isArray(tree.tree)) throw new Error('Incomplete Git tree');
      const prefix = source.path ? `${source.path}/` : '';
      const originals = tree.tree.filter((entry: any) => typeof entry.path === 'string' && entry.path.startsWith(prefix)
        && !entry.path.split('/').includes('.afilmory') && SUPPORTED_FORMATS.has(path.extname(entry.path).toLowerCase()));
      for (const entry of originals) {
        if (entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode) || entry.path.split('/').some((p: string) => !p || p === '.' || p === '..')) throw new Error('Invalid original in pinned tree');
        const url = new URL(originalURL(source, commit, entry.path.slice(prefix.length)));
        if (url.hash || url.search) throw new Error('Original URL contains a fragment/query; cannot verify public delivery');
        const response = await checkedRead(request, url.href, `anonymous original ${entry.path} at ${commit}`, undefined, true);
        const reader = response.body?.getReader();
        try {
          const first = await reader?.read();
          if (![200, 206].includes(response.status) || !first?.value?.byteLength) throw new Error('empty original');
        } catch { throw new Error(`anonymous original ${entry.path} at ${commit}: unreadable/empty response body`); }
        finally { await reader?.cancel().catch(() => {}); }
      }
      console.info(`Source ${source.sourceId}: private=false; commit=${commit}; anonymous originals verified=${originals.length}`);
      commits[source.sourceId] = commit; status.status = 'resolved';
    } catch (error) { status.status = 'failure'; status.failureReason = safeReason(error); }
  }
  if (statuses.some(s => s.status === 'failure')) throw new Error(`Source resolution failed: ${statuses.filter(s => s.status === 'failure').map(s => `${s.sourceId}: ${s.failureReason}`).join('; ')}`);
  return makeSnapshot(config, commits);
}
