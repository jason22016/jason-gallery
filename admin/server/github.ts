import { ApiError, jsonBody } from './errors';
import { createHash } from 'node:crypto';
export const workflow = '.github/workflows/automation.yml';
export type TreeEntry = { path: string; sha: string; type: string; mode: string; size?: number };
export class GitHub {
  readonly base: string;
  readonly fileSizes = new Map<string, number>();
  private readonly reads = new Map<string, Promise<any>>();
  constructor(readonly env: Env, readonly transport: typeof fetch = fetch) {
    // workerd fetch requires its global receiver; storing it as a method changes `this`.
    this.transport = transport.bind(globalThis);
    if (!/^[a-z\d-]+\/[a-z\d_.-]+$/i.test(env.GITHUB_REPOSITORY)) throw new ApiError(503, 'not_configured', '网站仓库配置无效');
    this.base = `https://api.github.com/repos/${env.GITHUB_REPOSITORY}`;
  }
  async response(path: string, method = 'GET', body?: unknown) {
    if (!path.startsWith('/') || path.includes('://')) throw new Error('Invalid internal GitHub path');
    const response = await this.transport(this.base + path, { method, redirect: 'manual', headers: { Authorization: `Bearer ${this.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'jason-gallery-admin', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
    if (!response.ok && response.status !== 302) { await response.body?.cancel(); throw new ApiError(response.status === 409 || response.status === 422 && path === '/git/refs/heads/main' ? 409 : 502, 'github', `GitHub 请求失败（HTTP ${response.status}）；请检查权限或稍后重试`); }
    return response;
  }
  async call(path: string, method = 'GET', body?: unknown): Promise<any> { const res = await this.response(path, method, body); return res.status === 204 ? null : jsonBody(res); }
  // Request-local deduplication only; branch HEAD and all writes always go to GitHub.
  private read(path: string) {
    let result = this.reads.get(path);
    if (!result) { result = this.call(path); this.reads.set(path, result); }
    return result;
  }
  async head() { return (await this.call('/git/ref/heads/main')).object.sha as string; }
  async tree(sha: string): Promise<TreeEntry[]> { const tree = await this.read(`/git/trees/${sha}?recursive=1`); if (tree.truncated) throw new ApiError(413, 'tree_limit', '仓库目录超过读取上限'); return tree.tree; }
  async file(entry: TreeEntry) { if (entry.type !== 'blob' || entry.mode === '120000' || (entry.size ?? 0) > 512000) throw new ApiError(422, 'file', '管理文件必须是小于 512 KB 的普通文件'); const blob = await this.read(`/git/blobs/${entry.sha}`); if (blob.encoding !== 'base64') throw new Error('Invalid blob'); return JSON.parse(Buffer.from(blob.content, 'base64').toString('utf8')); }
  async files(entries: TreeEntry[]): Promise<unknown[]> {
    for (const e of entries) if (e.type !== 'blob' || !['100644', '100755'].includes(e.mode) || (e.size ?? 0) > 512000 || !/^[a-f\d]{40}$/.test(e.sha)) throw new ApiError(422, 'file', '管理文件必须是小于 512 KB 的普通 Git blob');
    const [owner, name] = this.env.GITHUB_REPOSITORY.split('/');
    const result: unknown[] = []; let total = 0;
    // Alias queries address immutable blob OIDs, never branch expressions. A missing,
    // truncated, binary, mismatched or partial GraphQL result fails the entire read.
    for (let offset = 0; offset < entries.length; offset += 50) {
      const batch = entries.slice(offset, offset + 50);
      const query = `query { repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { ${batch.map((e, i) => `b${i}: object(oid: "${e.sha}") { ... on Blob { oid byteSize isBinary isTruncated text } }`).join(' ')} } }`;
      const response = await this.transport('https://api.github.com/graphql', { method: 'POST', redirect: 'manual', headers: { Authorization: `Bearer ${this.env.GITHUB_TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': 'jason-gallery-admin' }, body: JSON.stringify({ query }), signal: AbortSignal.timeout(20000) });
      if (!response.ok) { await response.body?.cancel(); throw new ApiError(502, 'github', `GitHub 批量读取失败（HTTP ${response.status}）`); }
      const data = await jsonBody(response);
      if (data.errors?.length || !data.data?.repository) throw new ApiError(502, 'github', 'GitHub 批量读取不完整');
      for (const [i, entry] of batch.entries()) {
        const blob = data.data.repository[`b${i}`];
        if (!blob || blob.oid !== entry.sha || blob.isBinary !== false || blob.isTruncated !== false || typeof blob.text !== 'string') throw new ApiError(422, 'file', 'Git blob 缺失、截断或版本不匹配');
        const size = Buffer.byteLength(blob.text);
        total += size;
        if (size !== blob.byteSize || size > 512000 || total > 4 * 1024 ** 2 + 512000 || createHash('sha1').update(`blob ${size}\0`).update(blob.text).digest('hex') !== entry.sha) throw new ApiError(422, 'file', 'Git blob 摘要或大小不匹配');
        this.fileSizes.set(entry.sha, size);
        result.push(JSON.parse(blob.text));
      }
    }
    return result;
  }
  async runs() { return (await this.call('/actions/workflows/automation.yml/runs?branch=main&per_page=30')).workflow_runs as any[]; }
  async run(id: number) { return this.verifyRun(await this.read(`/actions/runs/${id}`)); }
  verifyRun(run: any) { if (!Number.isSafeInteger(run.id) || run.id <= 0 || !Number.isSafeInteger(run.run_attempt) || run.run_attempt <= 0 || !/^[a-f0-9]{40}$/.test(run.head_sha) || run.head_branch !== 'main' || run.path !== workflow || run.repository?.full_name?.toLowerCase() !== this.env.GITHUB_REPOSITORY.toLowerCase() || run.head_repository?.full_name?.toLowerCase() !== this.env.GITHUB_REPOSITORY.toLowerCase() || !['push', 'schedule', 'workflow_dispatch'].includes(run.event)) throw new ApiError(422, 'run', '只接受本站 main 的 Gallery automation 任务'); return run; }
  async artifacts(id: number) { const data = await this.read(`/actions/runs/${id}/artifacts?per_page=100`); if (data.total_count > data.artifacts.length) throw new ApiError(413, 'artifact_limit', '任务产物列表不完整'); return data.artifacts as any[]; }
  async commit(expected: string, changes: { path: string; data: unknown }[]) {
    if (await this.head() !== expected) throw new ApiError(409, 'conflict', '仓库已有更新，请保留当前编辑并重新加载后合并');
    for (const change of changes) if (change.path !== 'config/photo-sources.json' && !/^src\/content\/projects\/[a-z0-9]+(?:-[a-z0-9]+)*\.json$/.test(change.path)) throw new ApiError(403, 'path', '不允许写入此路径');
    const parent = await this.call(`/git/commits/${expected}`);
    const tree = await this.call('/git/trees', 'POST', { base_tree: parent.tree.sha, tree: changes.map(c => ({ path: c.path, mode: '100644', type: 'blob', content: JSON.stringify(c.data, null, 2) + '\n' })) });
    const commit = await this.call('/git/commits', 'POST', { message: 'Save gallery admin content [skip ci]', tree: tree.sha, parents: [expected] });
    // Non-force fast-forward is a compare-and-swap: a sibling commit cannot overwrite a new head.
    await this.call('/git/refs/heads/main', 'PATCH', { sha: commit.sha, force: false });
    return commit.sha as string;
  }
}
