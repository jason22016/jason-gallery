import { z } from 'zod';
import { SourceSchema } from '../../src/photo-engine/source-schema';
import { digest, sourceIdentity, LEGACY_SOURCE, type PhotoSource } from '../../src/photo-engine/source-contract';
import { diffPhotos, photoInventory, reusableSources, sumCounts, type SourceDiff, type SyncPreview } from '../../src/photo-engine/sync-diff';
import { processingDigest } from './read-contract';
import type { AdminService } from './service';
import { ApiError, jsonBody } from './errors';

export const SourceIdsSchema = z.array(SourceSchema.shape.sourceId).min(1).max(50).refine(ids => new Set(ids).size === ids.length);
// Fixed GitHub host and saved source configuration only. No raw image downloads.
export async function sourceRead(service: AdminService, source: PhotoSource, suffix: string) {
  const response = await service.github.transport(`https://api.github.com/repos/${source.owner}/${source.repo}${suffix}`, {
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${service.github.env.GITHUB_TOKEN}`, 'User-Agent': 'jason-gallery-admin' },
    // Workers supports manual redirects; reject the non-OK response below without following it.
    redirect: 'manual', signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) { await response.body?.cancel(); throw new ApiError(502, 'source_read', `来源 ${source.name} 读取失败（HTTP ${response.status}），无法确定差异`); }
  return jsonBody(response, 8 * 1024 ** 2);
}
export async function syncBaseline(service: AdminService) {
  // Never turn a missing/expired historical summary into an empty library.
  const runs = await service.github.runs();
  if (!runs.length) return null;
  for (const run of [...runs].sort((a,b) => (Date.parse(b.run_started_at ?? b.updated_at) || 0) - (Date.parse(a.run_started_at ?? a.updated_at) || 0))) {
    if (run.status !== 'completed') continue;
    service.github.verifyRun(run);
    const summary = await service.summary(run);
    if (!summary) throw new ApiError(422, 'baseline_unknown', '历史同步摘要不可用，无法确定比较基线');
    if (summary.photos?.status === 'success') return service.catalog(run.id);
  }
  throw new ApiError(422, 'baseline_unknown', '未找到可验证的成功同步基线，请先完成一次全量同步');
}
export async function previewSync(service: AdminService, input: unknown, existingContent?: Awaited<ReturnType<AdminService['content']>>): Promise<SyncPreview> {
  const sourceIds = SourceIdsSchema.parse(input).sort();
  const content = existingContent ?? await service.content();
  if (sourceIds.some(id => !content.config.sources.some(s => s.sourceId === id && s.enabled))) throw new ApiError(422, 'source_selection', '只能选择已保存且启用的照片源');
  const errors: string[] = [];
  const baseline = await syncBaseline(service).catch(e => { errors.push(e instanceof Error ? e.message : '比较基线读取失败'); return undefined; });
  const sources: SourceDiff[] = []; const conflicts: SyncPreview['conflicts'] = [];
  const commits: Record<string,string> = {};
  const future = new Set<string>(); const nativeAliases = new Map<string,string>();
  let sourceFailures = 0;
  try {
    for (const source of content.config.sources.filter(s => sourceIds.includes(s.sourceId))) {
      const beforeSource = baseline?.artifact.snapshot.sources.find(s => s.sourceId === source.sourceId);
      const result: SourceDiff = { sourceId: source.sourceId, name: source.name, beforeCommit: beforeSource?.commit ?? null, commit: null, counts: null, changes: [] };
      sources.push(result);
      try {
        const repo = await sourceRead(service, source, '');
        if (repo.private !== false) throw new Error('照片源必须是可公开读取的仓库');
        const current = await sourceRead(service, source, `/commits/${encodeURIComponent(source.branch)}`);
        if (!/^[a-f0-9]{40}$/.test(current.sha)) throw new Error('来源版本无效');
        result.commit = current.sha; commits[source.sourceId] = current.sha;
        const tree = await sourceRead(service, source, `/git/trees/${current.sha}?recursive=1`);
        const after = photoInventory(source, tree);
        for (const p of after) {
          future.add(p.reference);
          if (source.sourceId === LEGACY_SOURCE.sourceId && sourceIdentity(source) === sourceIdentity(LEGACY_SOURCE)) nativeAliases.set(p.nativeId, p.reference);
        }
        if (baseline === undefined) { result.error = '历史比较基线不可用，差异数量无法确定；可全量同步重新建立基线'; continue; }

        const before = beforeSource ? photoInventory(beforeSource, sourceIdentity(source) === beforeSource.identity && current.sha === beforeSource.commit ? tree : await sourceRead(service, beforeSource, `/git/trees/${beforeSource.commit}?recursive=1`)) : [];
        Object.assign(result, diffPhotos(before, after));
        const aliases = new Map(baseline?.aliases ?? []);
        for (const change of result.changes.filter(c => c.kind === 'removed')) for (const project of content.projects) {
          if (project.photos.some(p => (aliases.get(p.photoId) ?? p.photoId) === change.reference) || (aliases.get(project.coverPhotoId) ?? project.coverPhotoId) === change.reference) conflicts.push({ sourceId: source.sourceId, key: change.key, projectId: project.id, title: project.title });
        }
      } catch (e) { sourceFailures++; result.error = e instanceof Error ? e.message : '来源读取失败，无法确定差异'; errors.push(`${source.name}：${result.error}`); }
    }
    for (const p of baseline?.photos ?? []) if (!sourceIds.includes(p.sourceId)) future.add(p.id);
    const aliases = new Map([...(baseline?.aliases ?? []), ...nativeAliases]);
    if (!sourceFailures && (sourceIds.length === content.config.sources.filter(s => s.enabled).length || baseline)) {
      for (const p of content.projects) for (const id of new Set([...p.photos.map(r => r.photoId), p.coverPhotoId])) {
        if (id && !future.has(aliases.get(id) ?? id) && !conflicts.some(c => c.projectId === p.id && c.key === id) && !sources.some(s => s.changes.some(c => c.kind === 'removed' && c.reference === (aliases.get(id) ?? id)))) {
          conflicts.push({ sourceId: id.split('--')[0]!, key: id, projectId: p.id, title: p.title });
        }
      }
    }
    const partialAllowed = !!baseline && baseline.processingDigest === processingDigest(content.tree) && reusableSources(content.config.sources, baseline.artifact.snapshot.config.sources, sourceIds);
    const partialReason = partialAllowed ? undefined : '未选来源没有可复用的完整产物，或来源配置、处理器已变化，请全选后同步';
    const revision = digest({ head: content.head, baseline: baseline?.artifact.version ?? null, sourceIds, commits, sources, conflicts });
    const canSync = !sourceFailures && !conflicts.length && (sourceIds.length === content.config.sources.filter(s => s.enabled).length || partialAllowed);
    return { baselineState: baseline === undefined ? 'unavailable' : baseline === null ? 'empty' : 'ready', canSync, head: content.head, checkedAt: new Date().toISOString(), revision, sourceIds, baselineRunId: baseline?.runId ?? null, commits, sources, conflicts, errors, partialAllowed, partialReason, counts: errors.length ? null : sumCounts(sources.map(s => s.counts!)) };
  } finally { await baseline?.close(); }
}
