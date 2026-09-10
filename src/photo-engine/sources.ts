// Node/build-only source contract. Never imported by the browser entry.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { z } from 'zod';

const segment = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
export const SourceSchema = z.strictObject({
  sourceId: z.string().max(48).regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/),
  name: z.string().min(1).max(120).refine(s => s === s.trim() && !/[\x00-\x1f]/.test(s)),
  owner: z.string().max(39).regex(/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/),
  repo: z.string().max(100).regex(segment).refine(s => s !== '.' && s !== '..' && !s.endsWith('.git')),
  branch: z.string().min(1).max(200).refine(s => !/[\x00-\x20\x7f~^:?*\[\\]/.test(s) && !s.includes('..') && !s.includes('@{') && s !== '@' && s.split('/').every(p => p && !p.startsWith('.') && !p.endsWith('.') && !p.endsWith('.lock'))),
  path: z.string().max(400).refine(s => s === '' || s.split('/').every(p => p && p !== '.' && p !== '..' && !/[\x00-\x1f\x7f\\%?#]/.test(p) && p === p.trim())),
  enabled: z.boolean(),
});
export const SourcesSchema = z.strictObject({ schemaVersion: z.literal(1), sources: z.array(SourceSchema).max(50) }).superRefine(({ sources }, ctx) => {
  const ids = new Set<string>();
  for (const [i, source] of sources.entries()) {
    if (ids.has(source.sourceId)) ctx.addIssue({ code: 'custom', path: ['sources', i, 'sourceId'], message: 'Duplicate sourceId' });
    ids.add(source.sourceId);
  }
});
export type PhotoSource = z.infer<typeof SourceSchema>;
export type SourcesConfig = z.infer<typeof SourcesSchema>;
// The only legacy alias target; never infer a source from an ID match.
export const LEGACY_SOURCE: PhotoSource = { sourceId: 'jason-photos', name: 'Jason Photos', owner: 'jason22016', repo: 'jason-photos', branch: 'main', path: 'images', enabled: true };
export const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function parseSources(value: unknown): SourcesConfig {
  const config = SourcesSchema.parse(value);
  return { schemaVersion: 1, sources: config.sources.map(s => ({ ...s, owner: s.owner.toLowerCase(), repo: s.repo.toLowerCase() })).sort((a,b) => a.sourceId.localeCompare(b.sourceId, 'en')) };
}
export const loadSources = (file: string | URL = 'config/photo-sources.json') => parseSources(JSON.parse(fs.readFileSync(file, 'utf8')));
export const sourceIdentity = (s: PhotoSource) => digest({ owner: s.owner.toLowerCase(), repo: s.repo.toLowerCase(), branch: s.branch, path: s.path });
export const sourceAPI = (s: PhotoSource) => `https://api.github.com/repos/${s.owner}/${s.repo}`;
export const originalURL = (s: PhotoSource, commit: string, key: string) => `https://raw.githubusercontent.com/${s.owner}/${s.repo}/${commit}/${[s.path, key].filter(Boolean).join('/')}`;
// Full digests keep even long/non-ASCII native IDs within filesystem segment limits.
// The index retains the original ID; never recover it by heuristic string matching.
export const photoReference = (s: PhotoSource, nativeId: string) => `${s.sourceId}--${sourceIdentity(s)}--${digest(nativeId)}`;

const PinnedSourceSchema = SourceSchema.extend({ identity: z.string().regex(/^[a-f0-9]{64}$/), commit: z.string().regex(/^[a-f0-9]{40}$/) });
const SnapshotSchema = z.strictObject({ schemaVersion: z.literal(1), config: SourcesSchema, configDigest: z.string(), sources: z.array(PinnedSourceSchema), version: z.string() });
export type PhotoSnapshot = z.infer<typeof SnapshotSchema>;
export function makeSnapshot(config: SourcesConfig, commits: Record<string, string>): PhotoSnapshot {
  config = parseSources(config);
  const enabled = config.sources.filter(s => s.enabled);
  if (Object.keys(commits).sort().join('\0') !== enabled.map(s => s.sourceId).sort().join('\0')) throw new Error('Snapshot commits must exactly match all enabled sources');
  const record = { schemaVersion: 1 as const, config, configDigest: digest(config), sources: enabled.map(s => ({ ...s, identity: sourceIdentity(s), commit: z.string().regex(/^[a-f0-9]{40}$/).parse(commits[s.sourceId]) })) };
  return { ...record, version: digest(record) };
}
export function verifySnapshot(value: unknown, config?: SourcesConfig): PhotoSnapshot {
  const snapshot = SnapshotSchema.parse(value);
  const expected = makeSnapshot(snapshot.config, Object.fromEntries(snapshot.sources.map(s => [s.sourceId, s.commit])));
  if (JSON.stringify(expected) !== JSON.stringify(snapshot)) throw new Error('Invalid source snapshot/config digest');
  if (config && snapshot.configDigest !== digest(parseSources(config))) throw new Error('Source configuration mismatch; rebuild photos');
  return snapshot;
}
