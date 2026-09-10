// Disposable Worker Cache API entries, not source-of-truth storage. No tokens or signed URLs are cached.
import { hashBytes } from '../../src/photo-engine/collection-contract';
import { bytes } from './errors';
export class ArtifactCache {
  constructor(readonly repository: string, readonly storage: Cache | undefined = typeof caches === 'undefined' ? undefined : (caches as CacheStorage & { default?: Cache }).default) {}
  key(path: string) { return new Request(`https://gallery-artifacts.invalid/v1/${this.repository}/${path}`); }
  async get(path: string) { try { return await this.storage?.match(this.key(path)); } catch { return undefined; } }
  // Only server-produced, fully verified derived data belongs here. The envelope detects
  // corruption and enforces expiry even when a test/storage implementation ignores HTTP TTL.
  async derived<T>(path: string): Promise<T | undefined> {
    try {
      const response = await this.get(path);
      if (!response) return;
      const envelope = JSON.parse(new TextDecoder().decode(await bytes(response, 8 * 1024 ** 2)));
      if (!Number.isFinite(envelope.until) || envelope.until <= Date.now() || typeof envelope.data !== 'string' || hashBytes(JSON.stringify([this.repository, path, envelope.until, envelope.data])) !== envelope.hash) return;
      return JSON.parse(envelope.data) as T;
    } catch { return; }
  }
  async putDerived(path: string, value: unknown, seconds: number) {
    const data = JSON.stringify(value);
    const until = Date.now() + Math.min(seconds, 3600) * 1000;
    await this.put(path, JSON.stringify({ until, data, hash: hashBytes(JSON.stringify([this.repository, path, until, data])) }), seconds);
  }
  async put(path: string, value: Uint8Array | string, seconds: number) {
    if (!this.storage || seconds <= 0) return;
    try { await this.storage.put(this.key(path), new Response(value as BodyInit, { headers: { 'Cache-Control': `public, max-age=${Math.min(seconds, 3600)}` } })); } catch { /* Cache eviction/failure only affects speed. */ }
  }
}
