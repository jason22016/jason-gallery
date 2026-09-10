// Shared validation only: no filesystem, network or credentials.
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
