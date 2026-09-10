// Shared server/build contract. Never imported by a browser entry.
import { createHash } from 'node:crypto';
import { z } from 'zod';

import { SourcesSchema, SourceSchema, type PhotoSource, type SourcesConfig } from './source-schema.js';
export { SourcesSchema, SourceSchema, type PhotoSource, type SourcesConfig } from './source-schema.js';

// The only legacy alias target; never infer a source from an ID match.
export const LEGACY_SOURCE: PhotoSource = { sourceId: 'jason-photos', name: 'Jason Photos', owner: 'jason22016', repo: 'jason-photos', branch: 'main', path: 'images', enabled: true };
export const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function parseSources(value: unknown): SourcesConfig {
  const config = SourcesSchema.parse(value);
  // Valid IDs contain only lowercase ASCII letters, digits and hyphens. Their
  // ordering matches the previous English collation, without initializing ICU
  // on the first request in each Worker isolate.
  return { schemaVersion: 1, sources: config.sources.map(s => ({ ...s, owner: s.owner.toLowerCase(), repo: s.repo.toLowerCase() })).sort((a,b) => a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0) };
}
export const sourceIdentity = (s: PhotoSource) => digest({ owner: s.owner.toLowerCase(), repo: s.repo.toLowerCase(), branch: s.branch, path: s.path });
export const sourceAPI = (s: PhotoSource) => `https://api.github.com/repos/${s.owner}/${s.repo}`;
export const originalURL = (s: PhotoSource, commit: string, key: string) => `https://raw.githubusercontent.com/${s.owner}/${s.repo}/${commit}/${[s.path, key].filter(Boolean).join('/')}`;
// Full digests keep even long/non-ASCII native IDs within filesystem segment limits.
// The index retains the original ID; never recover it by heuristic string matching.
export const photoReference = (s: PhotoSource, nativeId: string) => `${s.sourceId}--${sourceIdentity(s)}--${digest(nativeId)}`;

const PinnedSourceSchema = SourceSchema.extend({ identity: z.string().regex(/^[a-f0-9]{64}$/), commit: z.string().regex(/^[a-f0-9]{40}$/) });
const SnapshotSchema = z.strictObject({ schemaVersion: z.literal(1), config: SourcesSchema, configDigest: z.string(), sources: z.array(PinnedSourceSchema), version: z.string() });
const CommitSchema = z.string().regex(/^[a-f0-9]{40}$/);
export type PhotoSnapshot = z.infer<typeof SnapshotSchema>;
export function makeSnapshot(config: SourcesConfig, commits: Record<string, string>): PhotoSnapshot {
  config = parseSources(config);
  const enabled = config.sources.filter(s => s.enabled);
  if (Object.keys(commits).sort().join('\0') !== enabled.map(s => s.sourceId).sort().join('\0')) throw new Error('Snapshot commits must exactly match all enabled sources');
  const record = { schemaVersion: 1 as const, config, configDigest: digest(config), sources: enabled.map(s => ({ ...s, identity: sourceIdentity(s), commit: CommitSchema.parse(commits[s.sourceId]) })) };
  return { ...record, version: digest(record) };
}
export function verifySnapshot(value: unknown, config?: SourcesConfig): PhotoSnapshot {
  const snapshot = SnapshotSchema.parse(value);
  const expected = makeSnapshot(snapshot.config, Object.fromEntries(snapshot.sources.map(s => [s.sourceId, s.commit])));
  if (JSON.stringify(expected) !== JSON.stringify(snapshot)) throw new Error('Invalid source snapshot/config digest');
  if (config && snapshot.configDigest !== digest(parseSources(config))) throw new Error('Source configuration mismatch; rebuild photos');
  return snapshot;
}
