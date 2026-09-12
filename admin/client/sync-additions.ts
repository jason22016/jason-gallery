import type { PreviewPhoto } from './model';

export interface SyncedLibrary {
  ready: boolean;
  runId?: number;
  photos: PreviewPhoto[];
  aliases?: Record<string, string>;
}

/** Only actual applied changes from the loaded run are eligible, never preview counts. */
export function syncAdditions(task: any, library: SyncedLibrary): { ids: string[]; count?: number; reason?: string } | null {
  const summary = task?.summary;
  const sync = summary?.sync;
  if (task?.state !== 'completed' || task.conclusion !== 'success' || summary?.action !== 'sync'
    || summary.photos?.status !== 'success' || summary.adminRead?.status !== 'success' || sync?.applied !== true) return null;
  const count = sync.counts?.added;
  if (!Number.isSafeInteger(count) || count < 0) return { ids: [], reason: '本次同步的历史基线不可用，无法确定新增照片。' };
  if (count === 0) return { ids: [], count: 0 };
  if (!Array.isArray(sync.sources) || !sync.sources.length || !Array.isArray(sync.sourceIds)
    || sync.sourceIds.length !== sync.sources.length || new Set(sync.sourceIds).size !== sync.sourceIds.length
    || new Set(sync.sources.map((s: any) => s?.sourceId)).size !== sync.sources.length
    || sync.sources.some((s: any) => !s || !sync.sourceIds.includes(s.sourceId) || !Array.isArray(s.changes)
      || s.changes.some((c: any) => !c || typeof c.reference !== 'string' || !['added', 'updated', 'removed'].includes(c.kind)))) {
    return { ids: [], count, reason: '这次同步未记录完整的新增照片明细，无法整批添加。' };
  }
  const added = sync.sources.flatMap((s: any) => s.changes.filter((c: any) => c.kind === 'added').map((c: any) => ({ sourceId: s.sourceId, id: c.reference })));
  const resolve = (id: string) => library.aliases?.[id] ?? id;
  const ids = added.map((p: any) => typeof p.id === 'string' ? resolve(p.id) : '');
  if (ids.length !== count || ids.some((id: string) => !id) || new Set(ids).size !== count) {
    return { ids: [], count, reason: '新增照片明细与同步数量不一致，请刷新执行记录后重试。' };
  }
  if (!library.ready || library.runId !== task.id) return { ids: [], count, reason: '请先刷新照片库，加载这次同步的结果后再添加。' };
  const photos = new Map(library.photos.map(p => [p.photo.id, p.sourceId]));
  if (added.some((p: any) => photos.get(resolve(p.id)) !== p.sourceId)) {
    return { ids: [], count, reason: '当前照片库未包含这批新增照片的完整结果，请刷新后重试。' };
  }
  return { ids, count };
}
