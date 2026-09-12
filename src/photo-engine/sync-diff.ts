import path from 'node:path';
import { createHash } from 'node:crypto';
import { SUPPORTED_FORMATS } from '../../packages/afilmory/builder/src/constants/index';
import { photoReference, sourceIdentity, type PhotoSource } from './source-contract';

export type InventoryPhoto = { key: string; sha: string; companion?: string; reference: string; nativeId: string };
export type SyncCounts = { total: number; previous: number; added: number; updated: number; removed: number; unchanged: number };
export type SyncChange = { kind: 'added' | 'updated' | 'removed'; key: string; reference: string };
export type SourceDiff = { sourceId: string; name: string; beforeCommit: string | null; commit: string | null; counts: SyncCounts | null; changes: SyncChange[]; error?: string };
export type SyncPreview = {
  head: string; checkedAt: string; revision: string; sourceIds: string[]; baselineRunId: number | null;
  baselineState: 'empty' | 'ready' | 'unavailable'; canSync: boolean; commits: Record<string, string>; sources: SourceDiff[]; counts: SyncCounts | null;
  conflicts: { sourceId: string; key: string; projectId: string; title: string }[];
  errors: string[]; partialAllowed: boolean; partialReason?: string;
};
export function photoInventory(source: PhotoSource, input: { truncated?: boolean; tree?: { path: string; sha: string; type: string; mode: string }[] }): InventoryPhoto[] {
  if (input.truncated !== false || !Array.isArray(input.tree)) throw new Error('照片源目录不完整，无法确定差异');
  const prefix = source.path ? source.path + '/' : '';
  const entries = input.tree.filter(e => e.path.startsWith(prefix) && !e.path.split('/').includes('.afilmory'));
  const files = new Map<string, { sha: string; companion?: string }>();
  const groups = new Map<string, { image?: string; video?: string }>();
  for (const e of entries) {
    const key = e.path.slice(prefix.length), ext = path.posix.extname(key).toLowerCase();
    if (!SUPPORTED_FORMATS.has(ext) && !['.mov', '.mp4'].includes(ext)) continue;
    if (e.type !== 'blob' || !['100644', '100755'].includes(e.mode) || !/^[a-f0-9]{40}$/.test(e.sha) || key.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('照片源包含无效文件');
    if (files.has(key)) throw new Error('照片源包含重复路径');
    files.set(key, { sha: e.sha });
    const groupKey = path.posix.join(path.posix.dirname(key), path.posix.parse(key).name);
    const group = groups.get(groupKey) ?? {};
    if (SUPPORTED_FORMATS.has(ext)) group.image = key; else group.video = key;
    groups.set(groupKey, group);
  }
  for (const group of groups.values()) if (group.image && group.video) files.get(group.image)!.companion = group.video + ':' + files.get(group.video)!.sha;
  return [...files].filter(([key]) => SUPPORTED_FORMATS.has(path.posix.extname(key).toLowerCase())).map(([key, value]) => {
    const nativeId = `${path.posix.basename(key, path.posix.extname(key))}_${createHash('sha256').update(key).digest('hex').slice(0, 8)}`;
    return { key, ...value, nativeId, reference: photoReference(source, nativeId) };
  }).sort((a,b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}
export function diffPhotos(before: InventoryPhoto[], after: InventoryPhoto[]) {
  const old = new Map(before.map(p => [p.reference, p]));
  const changes: SyncChange[] = [];
  const counts: SyncCounts = { total: after.length, previous: before.length, added: 0, updated: 0, removed: 0, unchanged: 0 };
  for (const p of after) {
    const previous = old.get(p.reference); old.delete(p.reference);
    const kind = !previous ? 'added' : previous.sha !== p.sha || previous.companion !== p.companion ? 'updated' : 'unchanged';
    counts[kind]++;
    if (kind !== 'unchanged') changes.push({ kind, key: p.key, reference: p.reference });
  }
  for (const p of old.values()) { counts.removed++; changes.push({ kind: 'removed', key: p.key, reference: p.reference }); }
  return { counts, changes };
}
export function sumCounts(values: SyncCounts[]): SyncCounts {
  return values.reduce((a,b) => Object.fromEntries(Object.keys(a).map(k => [k, a[k as keyof SyncCounts] + b[k as keyof SyncCounts]])) as SyncCounts, { total: 0, previous: 0, added: 0, updated: 0, removed: 0, unchanged: 0 });
}
export function reusableSources(current: PhotoSource[], previous: PhotoSource[], selected: string[]) {
  return current.filter(s => s.enabled && !selected.includes(s.sourceId)).every(s => {
    const old = previous.find(p => p.sourceId === s.sourceId && p.enabled);
    return old && sourceIdentity(old) === sourceIdentity(s) && JSON.stringify(old) === JSON.stringify(s);
  });
}
