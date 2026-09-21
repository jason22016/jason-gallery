import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256');
  const handle = await fs.open(file, 'r');
  try {
    for await (const chunk of handle.readableWebStream()) hash.update(new Uint8Array(chunk));
  } finally {
    await handle.close();
  }
  return hash.digest('hex');
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, child]) => [key, canonicalValue(child)]));
  }
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Canonical JSON cannot contain non-finite numbers');
  return value;
}

/** Stable UTF-8 JSON used only for identities and version contracts. */
export function canonicalJSON(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

export function canonicalHash(value: unknown): string {
  return sha256(canonicalJSON(value));
}
