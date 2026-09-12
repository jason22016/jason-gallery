import fs from 'node:fs/promises';
import path from 'node:path';
import { makeSnapshot, type SourcesConfig } from '../../src/photo-engine/source-contract';
import { photoInventory, diffPhotos, reusableSources, sumCounts, type SourceDiff } from '../../src/photo-engine/sync-diff';
import { verifyCollection, type PhotoCollection } from './collection';

export function selectedSources(config: SourcesConfig, input?: string): string[] {
  const ids: unknown = input ? JSON.parse(input) : config.sources.filter(s => s.enabled).map(s => s.sourceId);
  if (!Array.isArray(ids) || !!input && !ids.length || ids.some(id => typeof id !== 'string' || !config.sources.some(s => s.sourceId === id && s.enabled)) || new Set(ids).size !== ids.length) throw new Error('Select saved enabled sources only');
  return ids.sort();
}
export function combinedSnapshot(config: SourcesConfig, ids: string[], commits: Record<string,string>, baseline?: PhotoCollection) {
  if (Object.keys(commits).sort().join('\0') !== [...ids].sort().join('\0')) throw new Error('Selected source commits must exactly match selection');
  if (ids.length !== config.sources.filter(s => s.enabled).length && (!baseline || !reusableSources(config.sources, baseline.snapshot.config.sources, ids))) throw new Error('Unselected source artifact unavailable or incompatible; run full sync');
  return makeSnapshot(config, Object.fromEntries(config.sources.filter(s => s.enabled).map(s => [s.sourceId, ids.includes(s.sourceId) ? commits[s.sourceId]! : baseline!.snapshot.sources.find(p => p.sourceId === s.sourceId)!.commit])));
}
export async function readBaseline(directory: string | undefined, fingerprint: string, partial: boolean, production: boolean) {
  if (!directory) { if (partial) throw new Error('Partial sync requires complete baseline; run full sync'); return undefined; }
  return verifyCollection(directory, { ...(partial ? { fingerprint } : {}), production });
}
async function inventory(directory: string, sourceId: string) {
  const s = JSON.parse(await fs.readFile(path.join(directory, 'sources', sourceId, 'source-snapshot.json'), 'utf8'));
  return photoInventory(s.source, { truncated: false, tree: s.all.map((o: {key: string; etag: string}) => ({ path: [s.source.path, o.key].filter(Boolean).join('/'), sha: o.etag, type: 'blob', mode: '100644' })) });
}
export async function actualSyncDiff(directory: string, ids: string[], baselineDirectory?: string) {
  const current = await verifyCollection(directory);
  const previous = baselineDirectory ? await verifyCollection(baselineDirectory) : undefined;
  const sources: SourceDiff[] = [];
  for (const id of ids) {
    const source = current.snapshot.sources.find(s => s.sourceId === id)!;
    const old = previous?.snapshot.sources.find(s => s.sourceId === id);
    const delta = diffPhotos(old ? await inventory(baselineDirectory!, id) : [], await inventory(directory, id));
    sources.push({ sourceId: id, name: source.name, beforeCommit: old?.commit ?? null, commit: source.commit, ...delta });
  }
  return { sourceIds: ids, sources, counts: sumCounts(sources.map(s => s.counts!)) };
}
