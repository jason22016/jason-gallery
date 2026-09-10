// Disposable Worker Cache API entries, not source-of-truth storage. No tokens or signed URLs are cached.
export class ArtifactCache {
  constructor(readonly repository: string, readonly storage: Cache | undefined = typeof caches === 'undefined' ? undefined : (caches as CacheStorage & { default?: Cache }).default) {}
  key(path: string) { return new Request(`https://gallery-artifacts.invalid/v1/${this.repository}/${path}`); }
  async get(path: string) { try { return await this.storage?.match(this.key(path)); } catch { return undefined; } }
  async put(path: string, value: Uint8Array | string, seconds: number) {
    if (!this.storage || seconds <= 0) return;
    try { await this.storage.put(this.key(path), new Response(value as BodyInit, { headers: { 'Cache-Control': `public, max-age=${Math.min(seconds, 3600)}` } })); } catch { /* Cache eviction/failure only affects speed. */ }
  }
}
