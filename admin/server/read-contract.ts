import { createHash } from 'node:crypto';
import { processingInputs } from '../../src/photo-engine/processing-inputs';
import { verifySnapshot, type PhotoSnapshot } from '../../src/photo-engine/source-contract';

export const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
export const processingDigest = (tree: { path: string; type: string; sha: string }[]) => sha256(JSON.stringify(tree
  .filter(e => e.type === 'blob' && processingInputs.some(p => e.path === p || e.path.startsWith(p + '/')))
  .map(e => [e.path, e.sha]).sort((a, b) => a[0]! < b[0]! ? -1 : a[0]! > b[0]! ? 1 : 0)));

export interface ReadCatalog {
  schemaVersion: 1;
  repository: string;
  runId: number;
  runAttempt: number;
  websiteCommit: string;
  photosArtifactId: number;
  processingDigest: string;
  artifact: { version: string; websiteCommit: string; snapshot: PhotoSnapshot };
  aliases: [string, string][];
  photos: { id: string; sourceId: string; title: string; width: number; height: number; offset: number; length: number; hash: string }[];
  previewBytes: number;
}
const hex = (value: unknown, length: number): value is string => typeof value === 'string' && new RegExp(`^[a-f0-9]{${length}}$`).test(value);
const positive = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
function check(value: unknown): asserts value { if (!value) throw new Error('Invalid admin read catalog'); }

// Validate the compact wire representation without cloning/re-projecting EXIF data.
// Authenticity comes from the trusted run's immutable artifact + execution-summary,
// not from the catalog's own claims or a self-supplied checksum.
export function parseCatalog(bytes: Uint8Array): ReadCatalog {
  const c = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  check(c && c.schemaVersion === 1 && typeof c.repository === 'string' && positive(c.runId) && positive(c.runAttempt));
  check(hex(c.websiteCommit, 40) && positive(c.photosArtifactId) && hex(c.processingDigest, 64));
  check(c.artifact && hex(c.artifact.version, 64) && hex(c.artifact.websiteCommit, 40));
  const snapshot = verifySnapshot(c.artifact.snapshot);
  check(Array.isArray(c.photos) && Array.isArray(c.aliases) && Number.isSafeInteger(c.previewBytes) && c.previewBytes >= 0 && c.previewBytes <= 1024 ** 3);
  const sources = new Set(snapshot.sources.map(s => s.sourceId));
  const ids = new Set<string>(); let end = 0;
  for (const p of c.photos) {
    check(p && typeof p.id === 'string' && /^[a-z][a-z0-9-]*--[a-f0-9]{64}--[a-f0-9]{64}$/.test(p.id) && !ids.has(p.id));
    check(sources.has(p.sourceId) && p.id.startsWith(p.sourceId + '--') && typeof p.title === 'string');
    check(positive(p.width) && positive(p.height) && p.offset === end && positive(p.length) && p.length <= 8 * 1024 ** 2 && hex(p.hash, 64));
    ids.add(p.id); end += p.length;
    check(Number.isSafeInteger(end) && end <= c.previewBytes);
  }
  check(end === c.previewBytes);
  const aliases = new Set<string>();
  for (const pair of c.aliases) {
    check(Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'string' && pair[0].length > 0 && !ids.has(pair[0]) && !aliases.has(pair[0]) && ids.has(pair[1]));
    aliases.add(pair[0]);
  }
  return c;
}
