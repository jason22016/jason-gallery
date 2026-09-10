import { ApiError, jsonBody } from './errors';
export const workflow = '.github/workflows/automation.yml';
export type TreeEntry = { path: string; sha: string; type: string; mode: string; size?: number };
export class GitHub {
  readonly base: string;
  constructor(readonly env: Env, readonly transport: typeof fetch = fetch) {
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
  async head() { return (await this.call('/git/ref/heads/main')).object.sha as string; }
  async tree(sha: string): Promise<TreeEntry[]> { const tree = await this.call(`/git/trees/${sha}?recursive=1`); if (tree.truncated) throw new ApiError(413, 'tree_limit', '仓库目录超过读取上限'); return tree.tree; }
  async file(entry: TreeEntry) { if (entry.type !== 'blob' || entry.mode === '120000' || (entry.size ?? 0) > 512000) throw new ApiError(422, 'file', '管理文件必须是小于 512 KB 的普通文件'); const blob = await this.call(`/git/blobs/${entry.sha}`); if (blob.encoding !== 'base64') throw new Error('Invalid blob'); return JSON.parse(Buffer.from(blob.content, 'base64').toString('utf8')); }
  async runs() { return (await this.call('/actions/workflows/automation.yml/runs?branch=main&per_page=30')).workflow_runs as any[]; }
  async run(id: number) { const run = await this.call(`/actions/runs/${id}`); if (run.head_branch !== 'main' || run.path !== workflow || run.repository.full_name.toLowerCase() !== this.env.GITHUB_REPOSITORY.toLowerCase() || run.head_repository?.full_name?.toLowerCase() !== this.env.GITHUB_REPOSITORY.toLowerCase() || !['push', 'schedule', 'workflow_dispatch'].includes(run.event)) throw new ApiError(422, 'run', '只接受本站 main 的 Gallery automation 任务'); return run; }
  async artifacts(id: number) { return (await this.call(`/actions/runs/${id}/artifacts?per_page=100`)).artifacts as any[]; }
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
