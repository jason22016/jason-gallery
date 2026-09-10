import { z } from 'zod';
import { parseSources, sourceIdentity, LEGACY_SOURCE, type SourcesConfig } from '../../src/photo-engine/source-contract';
import { readCollection } from '../../src/photo-engine/collection-contract';
import { processingInputs } from '../../src/photo-engine/processing-inputs';
import { ProjectSchema, type Project } from '../../src/projects/schema';
import { resolveProjects } from '../../src/projects/resolver';
import { GitHub } from './github';
import { archive } from './archive';
import { ApiError, assert } from './errors';
import { ArtifactCache } from './cache';
import { hashBytes } from '../../src/photo-engine/collection-contract';
const projectPath = /^src\/content\/projects\/([a-z0-9]+(?:-[a-z0-9]+)*)\.json$/;
const headSchema = z.string().regex(/^[a-f\d]{40}$/);
const idSchema = z.number().int().positive();
export function sourceImpacts(before: SourcesConfig, after: SourcesConfig, projects: Project[]) {
  const changed = before.sources.filter(s => { const next = after.sources.find(n => n.sourceId === s.sourceId); return !next || !next.enabled || sourceIdentity(s) !== sourceIdentity(next); });
  return changed.flatMap(s => projects.flatMap(p => {
    // Bare legacy IDs have exactly one fixed source; unknown IDs are never guessed by filename.
    const count = p.photos.filter(r => (/^([a-z][a-z0-9]*(?:-[a-z0-9]+)*)--[a-f0-9]{64}--[a-f0-9]{64}$/.exec(r.photoId)?.[1] === s.sourceId) || !/^([a-z][a-z0-9]*(?:-[a-z0-9]+)*)--[a-f0-9]{64}--[a-f0-9]{64}$/.test(r.photoId) && s.sourceId === LEGACY_SOURCE.sourceId && sourceIdentity(s) === sourceIdentity(LEGACY_SOURCE)).length;
    return count ? [{ sourceId: s.sourceId, projectId: p.id, title: p.title, status: p.status, count }] : [];
  }));
}
export class AdminService {
  readonly cache: ArtifactCache;
  constructor(readonly github: GitHub) { this.cache = new ArtifactCache(github.env.GITHUB_REPOSITORY); }
  async content() {
    const head = await this.github.head(); const tree = await this.github.tree(head);
    const entry = tree.find(e => e.path === 'config/photo-sources.json'); assert(entry, '缺少照片源配置');
    const config = parseSources(await this.github.file(entry));
    const entries = tree.filter(e => projectPath.test(e.path));
    assert(entries.length <= 500, 'Project 超过后台 500 个上限');
    const projects: Project[] = []; let contentBytes = 0;
    for (const entry of entries) { const p = ProjectSchema.parse(await this.github.file(entry)); contentBytes += Buffer.byteLength(JSON.stringify(p)); assert(contentBytes <= 4 * 1024 ** 2, 'Project 总内容超过后台 4 MB 上限'); assert(p.slug === entry.path.match(projectPath)![1], 'Project slug 与文件名不一致'); projects.push(p); }
    assert(new Set(projects.map(p => p.id)).size === projects.length, 'Project ID 重复');
    return { head, tree, config, projects };
  }
  async summary(run: any) {
    const artifact = (await this.github.artifacts(run.id)).find(a => a.name === 'execution-summary' && !a.expired);
    if (!artifact) return null;
    const zip = await archive(this.github, artifact);
    try { const value = JSON.parse(new TextDecoder().decode(await zip.read('summary.json'))); assert(value.schemaVersion === 2 && value.websiteCommit === run.head_sha, '执行摘要与任务版本不匹配'); return value; } finally { await zip.close(); }
  }
  async photos(content: Awaited<ReturnType<AdminService['content']>>, requestedRun?: number) {
    const runs = requestedRun ? [await this.github.run(requestedRun)] : await this.github.runs();
    const run = runs.find(r => r.status === 'completed' && r.event !== 'pull_request');
    if (!run) throw new ApiError(404, 'empty', '还没有完整照片产物，请先同步');
    await this.github.run(run.id);
    const summary = await this.summary(run);
    if (!summary || summary.photos?.status !== 'success') throw new ApiError(422, 'sync_failed', summary?.failureReason || '最近任务未生成完整照片产物，请查看任务失败原因并重新同步');
    const artifactInfo = (await this.github.artifacts(run.id)).find(a => a.name === 'photos');
    if (!artifactInfo) throw new ApiError(410, 'expired', '照片产物缺失或已过期，请重新同步');
    const zip = await archive(this.github, artifactInfo);
    try {
      const collection = await readCollection(zip.read, content.config);
      assert(collection.artifact.version === summary.photos.artifactVersion, '产物与执行摘要不匹配');
      // A Project-only commit does not age photos; any processor input/dependency change does.
      const producer = collection.artifact.websiteCommit;
      assert(producer && /^[a-f\d]{40}$/.test(producer), '照片产物缺少处理器版本');
      const before = await this.github.tree(producer);
      const code = (tree: typeof before) => JSON.stringify(tree.filter(e => e.type === 'blob' && processingInputs.some(p => e.path === p || e.path.startsWith(p + '/'))).map(e => [e.path, e.sha]).sort());
      if (code(before) !== code(content.tree)) throw new ApiError(409, 'stale', '照片处理器或依赖已更新，请重新同步');
      await this.cache.put(`verified/${run.id}`, JSON.stringify({ info: { id: artifactInfo.id, expires_at: artifactInfo.expires_at, expired: false }, files: Object.fromEntries(collection.photos.map(p => [p.id, collection.artifact.files[`public/thumbnails/${p.id}.jpg`]])) }), Math.floor((Date.parse(artifactInfo.expires_at)-Date.now())/1000));
      return { ...collection, close: zip.close, runId: run.id as number, expiresAt: artifactInfo.expires_at as string };
    } catch (e) { await zip.close(); throw e; }
  }
  async thumbnail(runId: number, reference: string) {
    const cached = await this.cache.get(`verified/${runId}`);
    if (cached) {
      const proof = await cached.json() as { info: any; files: Record<string,string> };
      if (Date.parse(proof.info.expires_at) > Date.now() && Object.hasOwn(proof.files, reference)) {
        const zip = await archive(this.github, proof.info);
        try { const value = await zip.read(`public/thumbnails/${reference}.jpg`); assert(hashBytes(value) === proof.files[reference], '缩略图摘要不匹配'); return value; } finally { await zip.close(); }
      }
    }
    const photos = await this.photos(await this.content(), runId);
    try { if (!photos.photos.some(p => p.id === reference)) throw new ApiError(404, 'photo', '照片不存在'); return await photos.read(`public/thumbnails/${reference}.jpg`); } finally { await photos.close(); }
  }
  async bootstrap() {
    const content = await this.content();
    let media: any = { state: 'empty', reason: '请先同步照片', photos: [], aliases: {} };
    try { const p = await this.photos(content); try { media = { state: 'ready', reason: '', runId: p.runId, expiresAt: p.expiresAt, snapshot: p.artifact.snapshot, aliases: Object.fromEntries(p.aliases), photos: p.photos.map(photo => ({ sourceId: p.index.entries.find(e => e.reference === photo.id)!.sourceId, photo: { id: photo.id, title: photo.title, width: photo.width, height: photo.height, thumbnailUrl: `/api/thumbnail/${p.runId}/${encodeURIComponent(photo.id)}` } })) }; } finally { await p.close(); } }
    catch (e) { media.state = e instanceof ApiError ? e.code : 'stale'; media.reason = e instanceof ApiError ? e.message : '照片产物验证未通过或与当前来源配置不符，请重新同步'; }
    return { head: content.head, sources: content.config.sources, projects: content.projects, media, publishEnabled: this.github.env.PUBLISH_ENABLED === 'true' };
  }
  async save(input: unknown) {
    const body = z.discriminatedUnion('kind', [z.strictObject({ kind: z.literal('sources'), expectedHead: headSchema, config: z.unknown() }), z.strictObject({ kind: z.literal('project'), expectedHead: headSchema, project: ProjectSchema })]).parse(input);
    const content = await this.content();
    if (body.expectedHead !== content.head) throw new ApiError(409, 'conflict', '仓库已有更新；当前编辑已保留，请重新加载并合并后再保存');
    let changes: { path: string; data: unknown }[];
    if (body.kind === 'sources') {
      const config = parseSources(body.config); const impacts = sourceImpacts(content.config, config, content.projects);
      if (impacts.length) throw new ApiError(422, 'source_impact', '请先迁移或移除受影响的 Project 引用，不能替换或停用该来源', impacts);
      changes = [{ path: 'config/photo-sources.json', data: config }];
    } else {
      const p = body.project;
      const existing = content.projects.find(v => v.id === p.id);
      assert(p.slug.length <= 120, 'Project slug 超过后台 120 字符上限');
      assert(existing || content.projects.length < 500, 'Project 超过后台 500 个上限');
      assert(!existing || existing.slug === p.slug, '已保存 Project 的 slug 不可更改');
      assert(!content.projects.some(v => v.slug === p.slug && v.id !== p.id), 'Project slug 已存在');
      const photos = await this.photos(content);
      try {
        const map = new Map(photos.photos.map(p => [p.id, p]));
        resolveProjects([...content.projects.filter(v => v.id !== p.id), p].map(p => ({ source: p.slug + '.json', data: p, expectedSlug: p.slug })), { getPhoto: id => map.get(photos.aliases.get(id) ?? id) });
      } catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(422, 'project_reference', 'Project 引用校验失败；照片缺失、重复或来源已变化'); } finally { await photos.close(); }
      changes = [{ path: `src/content/projects/${p.slug}.json`, data: p }];
    }
    return { head: await this.github.commit(content.head, changes), status: 'saved' };
  }
  async impact(input: unknown) { const config = parseSources(input); const content = await this.content(); return { head: content.head, impacts: sourceImpacts(content.config, config, content.projects) }; }
  async dispatch(input: unknown) {
    const body = z.strictObject({ mode: z.enum(['sync', 'publish']), expectedHead: headSchema, photoRunId: idSchema.optional() }).parse(input);
    const content = await this.content();
    if (content.head !== body.expectedHead) throw new ApiError(409, 'conflict', '网站仓库已更新，请重新加载后触发');
    if (body.mode === 'publish' && this.github.env.PUBLISH_ENABLED !== 'true') throw new ApiError(503, 'publish_disabled', 'Cloudflare 发布尚未启用，请先完成上线配置与验收');
    const requestId = crypto.randomUUID();
    const inputs: Record<string, string> = { mode: body.mode, request_id: requestId, expected_website_commit: content.head };
    if (body.mode === 'publish') {
      assert(body.photoRunId, '发布前请先同步并选择完整照片产物');
      const photos = await this.photos(content, body.photoRunId);
      try { const map = new Map(photos.photos.map(p => [p.id, p])); resolveProjects(content.projects.map(p => ({ source: p.slug, data: p })), { getPhoto: id => map.get(photos.aliases.get(id) ?? id) }); inputs.photo_run_id = String(photos.runId); inputs.photo_commits = JSON.stringify(Object.fromEntries(photos.artifact.snapshot.sources.map(s => [s.sourceId, s.commit]))); } finally { await photos.close(); }
    }
    try { await this.github.call('/actions/workflows/automation.yml/dispatches', 'POST', { ref: 'main', inputs }); }
    catch { throw new ApiError(502, 'dispatch_unconfirmed', 'GitHub 触发结果尚未确认；请先查看任务记录，避免重复触发', { requestId, mode: body.mode }); }
    return { requestId, state: 'pending', mode: body.mode, head: content.head };
  }
  async tasks(requestId?: string) {
    if (requestId) z.uuid().parse(requestId);
    const runs = await this.github.runs();
    const selected = requestId ? runs.filter(r => r.display_title === `Gallery ${r.display_title.includes('publish') ? 'publish' : 'sync'} · ${requestId}`).slice(0, 1) : runs.slice(0, 10);
    const tasks = [];
    for (const run of selected) {
      await this.github.run(run.id);
      let summary = null; let summaryError = '';
      if (run.status === 'completed') { try { summary = await this.summary(run); } catch { summaryError = '执行摘要不可读取；请查看 Actions。部署未确认。'; } }
      const jobs = await this.github.call(`/actions/runs/${run.id}/jobs?per_page=10`);
      tasks.push({ id: run.id, title: run.display_title, state: run.status, conclusion: run.conclusion, event: run.event, head: run.head_sha, url: `https://github.com/${this.github.env.GITHUB_REPOSITORY}/actions/runs/${run.id}`, steps: jobs.jobs.flatMap((j: any) => (j.steps ?? []).map((s: any) => ({ name: s.name, status: s.status, conclusion: s.conclusion }))), summary, summaryError, published: run.status === 'completed' && run.conclusion === 'success' && summary?.action === 'publish' && ['success', 'unchanged'].includes(summary?.deployment?.status) && !!summary?.deployment?.version && !!summary?.deployment?.url });
    }
    return { tasks, pending: !!requestId && !tasks.length };
  }
}
