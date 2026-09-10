import { z } from 'zod';
import { proofSigner, verifyProof, type PreviewProof } from './preview-proof';
import { signSaveProof, verifySaveProof, projectReferences, type SaveProof } from './save-proof';
import { parseSources, sourceIdentity, LEGACY_SOURCE, type SourcesConfig } from '../../src/photo-engine/source-contract';
import { parseCatalog, processingDigest, sha256, type ReadCatalog } from './read-contract';
import { ProjectSchema, type Project } from '../../src/projects/schema';
import { validateProjectReferences } from '../../src/projects/resolver';
import { GitHub } from './github';
import { storedArchive, sealedPreview, alive } from './stored-archive';
import { ApiError, assert } from './errors';
import { digest } from '../../src/photo-engine/source-contract';
const projectPath = /^src\/content\/projects\/([a-z0-9]+(?:-[a-z0-9]+)*)\.json$/;
const headSchema = z.string().regex(/^[a-f\d]{40}$/);
const idSchema = z.number().int().positive();
const SaveSchema = z.discriminatedUnion('kind', [z.strictObject({ kind: z.literal('sources'), expectedHead: headSchema, config: z.unknown() }), z.strictObject({ kind: z.literal('project'), expectedHead: headSchema, project: ProjectSchema, saveProof: z.string().max(256000).optional() })]);
const DispatchSchema = z.strictObject({ mode: z.enum(['sync', 'publish']), expectedHead: headSchema, photoRunId: idSchema.optional() });
export function sourceImpacts(before: SourcesConfig, after: SourcesConfig, projects: Project[]) {
  const changed = before.sources.filter(s => { const next = after.sources.find(n => n.sourceId === s.sourceId); return !next || !next.enabled || sourceIdentity(s) !== sourceIdentity(next); });
  return changed.flatMap(s => projects.flatMap(p => {
    // Bare legacy IDs have exactly one fixed source; unknown IDs are never guessed by filename.
    const count = p.photos.filter(r => (/^([a-z][a-z0-9]*(?:-[a-z0-9]+)*)--[a-f0-9]{64}--[a-f0-9]{64}$/.exec(r.photoId)?.[1] === s.sourceId) || !/^([a-z][a-z0-9]*(?:-[a-z0-9]+)*)--[a-f0-9]{64}--[a-f0-9]{64}$/.test(r.photoId) && s.sourceId === LEGACY_SOURCE.sourceId && sourceIdentity(s) === sourceIdentity(LEGACY_SOURCE)).length;
    return count ? [{ sourceId: s.sourceId, projectId: p.id, title: p.title, status: p.status, count }] : [];
  }));
}
function validateReferences(projects: Project[], catalog: ReadCatalog) {
  const ids = new Set(catalog.photos.map(p => p.id)); const aliases = new Map(catalog.aliases);
  validateProjectReferences(projects, id => { const ref = aliases.get(id) ?? id; return ids.has(ref) ? ref : undefined; });
}
export class AdminService {
  constructor(readonly github: GitHub) {}
  async content() {
    const head = await this.github.head(); const tree = await this.github.contentTree(head);
    const entry = tree.find(e => e.path === 'config/photo-sources.json'); assert(entry, '缺少照片源配置');
    const entries = tree.filter(e => projectPath.test(e.path));
    assert(entries.length <= 500, 'Project 超过后台 500 个上限');
    const [sourceFile, ...projectFiles] = await this.github.files([entry, ...entries]);
    const config = parseSources(sourceFile);
    const projects: Project[] = []; let contentBytes = 0;
    for (const [i, entry] of entries.entries()) { const p = ProjectSchema.parse(projectFiles[i]); contentBytes += this.github.fileSizes.get(entry.sha)!; assert(contentBytes <= 4 * 1024 ** 2, 'Project 总内容超过后台 4 MB 上限'); assert(p.slug === entry.path.match(projectPath)![1], 'Project slug 与文件名不一致'); projects.push(p); }
    assert(new Set(projects.map(p => p.id)).size === projects.length, 'Project ID 重复');
    return { head, tree, config, projects };
  }
  async summary(run: any) {
    const matches = (await this.github.artifacts(run.id)).filter(a => a.name === 'execution-summary');
    if (!matches.length) return null;
    if (matches.length !== 1) throw new ApiError(422, 'integrity', '执行摘要身份不唯一');
    const zip = await storedArchive(this.github, matches[0], ['summary.json'], true);
    try {
      const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await zip.read('summary.json')));
      if (value.schemaVersion !== 2 || value.websiteCommit !== run.head_sha || value.runId !== run.id || value.runAttempt !== run.run_attempt) throw new ApiError(422, 'format', '执行摘要版本不兼容；请运行一次新版同步，历史摘要可在 Actions 查看');
      return value;
    } catch (e) { if (e instanceof ApiError) throw e; throw new ApiError(422, 'integrity', '执行摘要验证失败'); }
  }
  async catalog(requestedRun?: number) {
    const runs = requestedRun ? [await this.github.run(requestedRun)] : await this.github.runs(true);
    const selected = runs.find(r => r.status === 'completed' && r.event !== 'pull_request');
    if (!selected) throw new ApiError(404, 'empty', '还没有完整照片产物，请先同步');
    const run = this.github.verifyRun(selected);
    const summary = await this.summary(run);
    if (!summary || summary.photos?.status !== 'success') throw new ApiError(422, 'sync_failed', summary?.failureReason || '最近任务未生成完整照片产物，请查看任务失败原因并重新同步');
    const seal = summary.adminRead;
    if (seal?.status !== 'success') throw new ApiError(422, 'format', '缺少已验证的新版后台读取产物，请运行一次新版同步');
    const artifacts = await this.github.artifacts(run.id);
    const originals = artifacts.filter(a => a.name === 'photos');
    const reads = artifacts.filter(a => a.name === 'admin-read');
    if (!originals.length || !reads.length) throw new ApiError(410, 'expired', '照片或后台读取产物缺失，请重新同步');
    if (originals.length !== 1 || reads.length !== 1) throw new ApiError(422, 'integrity', '照片产物身份不唯一');
    const original = originals[0], info = reads[0]; alive(original); alive(info);
    if (seal.repository !== this.github.env.GITHUB_REPOSITORY || seal.runId !== run.id || seal.runAttempt !== run.run_attempt || seal.websiteCommit !== run.head_sha || seal.artifactId !== info.id || seal.artifactDigest !== info.digest || seal.photosArtifactId !== original.id || seal.photosArtifactVersion !== summary.photos.artifactVersion || !/^[a-f0-9]{64}$/.test(seal.catalogHash)) throw new ApiError(422, 'integrity', '后台产物与可信任务摘要不匹配');
    const sealed = seal.sealedCatalogVersion === 1;
    if (sealed && (typeof seal.catalog !== 'string' || seal.archiveBytes !== info.size_in_bytes || !Number.isSafeInteger(seal.previewOffset) || seal.previewOffset < 0)) throw new ApiError(422, 'integrity', '后台目录封存范围无效');
    const zip = sealed ? null : await storedArchive(this.github, info, ['catalog.json', 'previews.bin']);
    let catalog: ReadCatalog;
    try {
      const bytes = sealed ? seal.catalog : await zip!.read('catalog.json');
      if (sha256(bytes) !== seal.catalogHash) throw new Error('catalog digest');
      catalog = parseCatalog(bytes);
      if (catalog.repository !== seal.repository || catalog.runId !== run.id || catalog.runAttempt !== run.run_attempt || catalog.websiteCommit !== run.head_sha || catalog.photosArtifactId !== original.id || catalog.artifact.version !== seal.photosArtifactVersion || (sealed ? seal.previewOffset + catalog.previewBytes > info.size_in_bytes : catalog.previewBytes !== zip!.size('previews.bin'))) throw new Error('catalog identity');
    } catch (e) { if (e instanceof ApiError) throw e; throw new ApiError(422, 'integrity', '后台照片目录完整性验证失败'); }
    return { ...catalog, previewSeal: sealed ? { artifactId: info.id, photosArtifactId: original.id, artifactDigest: info.digest, archiveBytes: info.size_in_bytes, offset: seal.previewOffset } : undefined, read: async (path: string) => {
      const photo = catalog.photos.find(p => `public/thumbnails/${p.id}.jpg` === path);
      if (!photo) throw new ApiError(404, 'photo', '照片不存在');
      const value = sealed ? await sealedPreview(this.github, info, seal.previewOffset + photo.offset, photo.length) : await zip!.read('previews.bin', photo.offset, photo.length);
      if (sha256(value) !== photo.hash) throw new ApiError(422, 'integrity', '缩略图摘要不匹配');
      return value;
    }, close: zip?.close ?? (async () => {}), runId: run.id as number, expiresAt: new Date(Math.min(Date.parse(info.expires_at), Date.parse(original.expires_at))).toISOString() };
  }
  async photos(content: Awaited<ReturnType<AdminService['content']>>, requestedRun?: number, _withPreviews = true) {
    const catalog = await this.catalog(requestedRun);
    if (catalog.artifact.snapshot.configDigest !== digest(content.config)) throw new ApiError(409, 'stale', '照片来源配置已更新，请重新同步');
    if (catalog.processingDigest !== processingDigest(content.tree)) throw new ApiError(409, 'stale', '照片处理器或依赖已更新，请重新同步');
    return catalog;
  }
  async thumbnail(runId: number, reference: string, token?: string) {
    if (token !== undefined) {
      const proof = await verifyProof(this.github.env, token, runId, reference);
      const artifacts = await this.github.artifacts(runId);
      const reads = artifacts.filter(a => a.name === 'admin-read'), originals = artifacts.filter(a => a.name === 'photos');
      if (!reads.length || !originals.length) throw new ApiError(410, 'expired', '缩略图产物缺失，请刷新照片目录', undefined, { stage: 'preview_artifacts' });
      if (reads.length !== 1 || originals.length !== 1) throw new ApiError(422, 'integrity', '缩略图产物身份不唯一', undefined, { stage: 'preview_artifacts' });
      const info = reads[0], original = originals[0]; alive(info); alive(original);
      if (info.id !== proof.artifactId || original.id !== proof.photosArtifactId || info.digest !== proof.artifactDigest || info.size_in_bytes !== proof.archiveBytes) throw new ApiError(422, 'integrity', '缩略图产物与读取证明不匹配', undefined, { stage: 'preview_artifacts' });
      const value = await sealedPreview(this.github, info, proof.offset, proof.length);
      if (sha256(value) !== proof.hash) throw new ApiError(422, 'integrity', '缩略图摘要不匹配', undefined, { stage: 'preview_hash' });
      return value;
    }
    const catalog = await this.catalog(runId);
    return catalog.read(`public/thumbnails/${reference}.jpg`);
  }
  async bootstrap() {
    const content = await this.content();
    let saveProof: string | undefined;
    let media: any = { state: 'empty', reason: '请先同步照片', photos: [], aliases: {} };
    try {
      const p = await this.photos(content);
      try {
        const sign = await proofSigner(this.github.env);
        if (p.previewSeal) {
          const entries = new Map(content.tree.map(e => [e.path, e]));
          const proof: SaveProof = {
            version: 1, head: content.head, runId: p.runId, runAttempt: p.runAttempt, runHead: p.websiteCommit,
            artifactId: p.previewSeal.artifactId, photosArtifactId: p.previewSeal.photosArtifactId,
            artifactDigest: p.previewSeal.artifactDigest, archiveBytes: p.previewSeal.archiveBytes,
            expiresAt: Date.parse(p.expiresAt), ids: p.photos.map(photo => photo.id), aliases: p.aliases,
            projects: content.projects.map(project => projectReferences(project, this.github.fileSizes.get(entries.get(`src/content/projects/${project.slug}.json`)!.sha)!)),
          };
          saveProof = signSaveProof(this.github.env, proof);
        }
        media = {
          state: 'ready', reason: '', runId: p.runId, expiresAt: p.expiresAt, snapshot: p.artifact.snapshot,
          aliases: Object.fromEntries(p.aliases), photos: await Promise.all(p.photos.map(async photo => ({
            sourceId: photo.sourceId, photo: {
              id: photo.id, title: photo.title, width: photo.width, height: photo.height,
              thumbnailUrl: `/api/thumbnail/${p.runId}/${encodeURIComponent(photo.id)}` + (p.previewSeal ? '?proof=' + await sign({
                version: 1, repository: this.github.env.GITHUB_REPOSITORY, runId: p.runId, id: photo.id,
                ...p.previewSeal, offset: p.previewSeal.offset + photo.offset, length: photo.length, hash: photo.hash, expiresAt: Date.parse(p.expiresAt),
              } as PreviewProof) : ''),
            },
          }))),
        };
      } finally { await p.close(); }
    }
    catch (e) { media.state = e instanceof ApiError ? e.code : 'unavailable'; media.reason = e instanceof ApiError ? e.message : '照片读取暂时失败，请稍后重试；尚未确认产物需要更新'; }
    return { head: content.head, sources: content.config.sources, projects: content.projects, media, saveProof, publishEnabled: this.github.env.PUBLISH_ENABLED === 'true' };
  }
  private async saveWithProof(project: Project, expectedHead: string, token: string) {
    const proof = verifySaveProof(this.github.env, token, expectedHead);
    const existing = proof.projects.find(p => p.id === project.id);
    assert(project.slug.length <= 120, 'Project slug 超过后台 120 字符上限');
    assert(existing || proof.projects.length < 500, 'Project 超过后台 500 个上限');
    assert(!existing || existing.slug === project.slug, '已保存 Project 的 slug 不可更改');
    const size = Buffer.byteLength(JSON.stringify(project, null, 2) + '\n');
    assert(size <= 512000, 'Project 内容超过后台 512 KB 上限');
    const projects = [...proof.projects.filter(p => p.id !== project.id), projectReferences(project, size)];
    assert(projects.reduce((sum, p) => sum + p.bytes, 0) <= 4 * 1024 ** 2, 'Project 总内容超过后台 4 MB 上限');
    const ids = new Set(proof.ids), aliases = new Map(proof.aliases);
    try { validateProjectReferences(projects, id => { const canonical = aliases.get(id) ?? id; return ids.has(canonical) ? canonical : undefined; }); }
    catch { throw new ApiError(422, 'project_reference', 'Project 引用校验失败；照片缺失、重复或来源已变化'); }
    const latest = (await this.github.runs(true))[0];
    if (!latest || latest.status !== 'completed') throw new ApiError(409, 'stale', '照片任务已变化，请保留编辑并重新加载仓库');
    this.github.verifyRun(latest);
    if (latest.id !== proof.runId || latest.run_attempt !== proof.runAttempt || latest.head_sha !== proof.runHead) throw new ApiError(409, 'stale', '照片任务已变化，请保留编辑并重新加载仓库');
    const artifacts = await this.github.artifacts(proof.runId);
    const reads = artifacts.filter(a => a.name === 'admin-read'), originals = artifacts.filter(a => a.name === 'photos');
    if (!reads.length || !originals.length) throw new ApiError(410, 'expired', '照片产物缺失，请保留编辑并重新同步');
    if (reads.length !== 1 || originals.length !== 1) throw new ApiError(422, 'integrity', '照片产物身份不唯一');
    const info = reads[0], original = originals[0]; alive(info); alive(original);
    if (info.id !== proof.artifactId || original.id !== proof.photosArtifactId || info.digest !== proof.artifactDigest || info.size_in_bytes !== proof.archiveBytes) throw new ApiError(422, 'integrity', '照片产物与保存校验信息不匹配');
    // This mutation is the authoritative HEAD check: any intervening content,
    // source or processor update conflicts, including a race during validation.
    const head = await this.github.commit(expectedHead, [{ path: `src/content/projects/${project.slug}.json`, data: project }]);
    return { head, status: 'saved', saveProof: signSaveProof(this.github.env, { ...proof, head, projects }) };
  }
  async save(input: unknown) {
    const body = SaveSchema.parse(input);
    if (body.kind === 'project' && body.saveProof !== undefined) return this.saveWithProof(body.project, body.expectedHead, body.saveProof);
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
      const photos = await this.photos(content, undefined, false);
      try {
        validateReferences([...content.projects.filter(v => v.id !== p.id), p], photos);
      } catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(422, 'project_reference', 'Project 引用校验失败；照片缺失、重复或来源已变化'); } finally { await photos.close(); }
      changes = [{ path: `src/content/projects/${p.slug}.json`, data: p }];
    }
    return { head: await this.github.commit(content.head, changes), status: 'saved' };
  }
  async impact(input: unknown) { const config = parseSources(input); const content = await this.content(); return { head: content.head, impacts: sourceImpacts(content.config, config, content.projects) }; }
  async dispatch(input: unknown) {
    const body = DispatchSchema.parse(input);
    const content = await this.content();
    if (content.head !== body.expectedHead) throw new ApiError(409, 'conflict', '网站仓库已更新，请重新加载后触发');
    if (body.mode === 'publish' && this.github.env.PUBLISH_ENABLED !== 'true') throw new ApiError(503, 'publish_disabled', 'Cloudflare 发布尚未启用，请先完成上线配置与验收');
    const requestId = crypto.randomUUID();
    const inputs: Record<string, string> = { mode: body.mode, request_id: requestId, expected_website_commit: content.head };
    if (body.mode === 'publish') {
      assert(body.photoRunId, '发布前请先同步并选择完整照片产物');
      const photos = await this.photos(content, body.photoRunId, false);
      try { validateReferences(content.projects, photos); inputs.photo_run_id = String(photos.runId); inputs.photo_commits = JSON.stringify(Object.fromEntries(photos.artifact.snapshot.sources.map(s => [s.sourceId, s.commit]))); } finally { await photos.close(); }
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
      this.github.verifyRun(run);
      let summary = null; let summaryError = '';
      if (run.status === 'completed') { try { summary = await this.summary(run); } catch (e) { summaryError = e instanceof ApiError ? e.message : '执行摘要暂时不可读取；请重试或查看 Actions。部署未确认。'; } }
      if (summary?.adminRead?.catalog) summary = { ...summary, adminRead: { ...summary.adminRead, catalog: undefined } };
      const jobs = await this.github.call(`/actions/runs/${run.id}/jobs?per_page=10`);
      const task = { id: run.id, title: run.display_title, state: run.status, conclusion: run.conclusion, event: run.event, head: run.head_sha, url: `https://github.com/${this.github.env.GITHUB_REPOSITORY}/actions/runs/${run.id}`, steps: jobs.jobs.flatMap((j: any) => (j.steps ?? []).map((s: any) => ({ name: s.name, status: s.status, conclusion: s.conclusion }))), summary, summaryError, published: run.status === 'completed' && run.conclusion === 'success' && summary?.action === 'publish' && ['success', 'unchanged'].includes(summary?.deployment?.status) && !!summary?.deployment?.version && !!summary?.deployment?.url };
      tasks.push(task);
    }
    return { tasks, pending: !!requestId && !tasks.length, historyUrl: `https://github.com/${this.github.env.GITHUB_REPOSITORY}/actions/workflows/automation.yml` };
  }
}
