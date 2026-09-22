import type { ClientSemanticReleaseManifest } from './contracts';
import { sha256 } from './hash';

const CACHE_PREFIX = 'jason-gallery-semantic-model-v1:';
export const semanticCacheMarkerPath = '/.semantic-cache/complete/';

export interface CacheStorageLike {
  open(cacheName: string): Promise<Cache>;
  delete(cacheName: string): Promise<boolean>;
  keys(): Promise<string[]>;
}

export interface CachedRelease {
  assets: Map<string, ArrayBuffer>;
  cacheMode: 'persistent';
}

interface CompleteMarker {
  schemaVersion: 1;
  releaseId: string;
  bundleSha256: string;
  files: Array<{ path: string; bytes: number; sha256: string }>;
}

function cacheName(manifest: ClientSemanticReleaseManifest): string {
  return `${CACHE_PREFIX}${manifest.releaseId}:${manifest.bundleSha256}`;
}

function assetURL(releaseURL: URL, path: string): string {
  return new URL(path, releaseURL.href.endsWith('/') ? releaseURL : new URL(`${releaseURL.href}/`)).href;
}

function markerURL(releaseURL: URL, manifest: ClientSemanticReleaseManifest): string {
  return new URL(`${semanticCacheMarkerPath}${manifest.bundleSha256}`, releaseURL.origin).href;
}

function expectedMarker(manifest: ClientSemanticReleaseManifest): CompleteMarker {
  return {
    schemaVersion: 1,
    releaseId: manifest.releaseId,
    bundleSha256: manifest.bundleSha256,
    files: manifest.files.map(({ path, bytes, sha256: digest }) => ({ path, bytes, sha256: digest })),
  };
}

export class SemanticAssetCache {
  readonly storage?: CacheStorageLike;

  constructor(storage?: CacheStorageLike) {
    this.storage = storage;
  }

  async read(manifest: ClientSemanticReleaseManifest, releaseURL: URL, onVerified?: (path: string, bytes: number) => void): Promise<CachedRelease | undefined> {
    if (!this.storage) return undefined;
    const name = cacheName(manifest);
    try {
      const cache = await this.storage.open(name);
      const markerResponse = await cache.match(markerURL(releaseURL, manifest));
      if (!markerResponse) {
        await this.storage.delete(name);
        return undefined;
      }
      const marker: unknown = await markerResponse.json();
      if (JSON.stringify(marker) !== JSON.stringify(expectedMarker(manifest))) {
        await this.storage.delete(name);
        return undefined;
      }
      const assets = new Map<string, ArrayBuffer>();
      for (const descriptor of manifest.files) {
        const response = await cache.match(assetURL(releaseURL, descriptor.path));
        if (!response) throw new Error(`Incomplete cached semantic release: ${descriptor.path}`);
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength !== descriptor.bytes || await sha256(bytes) !== descriptor.sha256) throw new Error(`Corrupt cached semantic release: ${descriptor.path}`);
        assets.set(descriptor.role, bytes);
        onVerified?.(descriptor.path, bytes.byteLength);
      }
      return { assets, cacheMode: 'persistent' };
    } catch {
      await this.storage.delete(name).catch(() => false);
      return undefined;
    }
  }

  async write(manifest: ClientSemanticReleaseManifest, releaseURL: URL, assets: ReadonlyMap<string, ArrayBuffer>): Promise<boolean> {
    if (!this.storage) return false;
    const name = cacheName(manifest);
    try {
      await this.storage.delete(name);
      const cache = await this.storage.open(name);
      for (const descriptor of manifest.files) {
        const bytes = assets.get(descriptor.role);
        if (!bytes || bytes.byteLength !== descriptor.bytes) throw new Error(`Missing semantic release asset: ${descriptor.role}`);
        await cache.put(assetURL(releaseURL, descriptor.path), new Response(bytes, {
          headers: {
            'Content-Type': descriptor.mediaType,
            'Content-Length': String(descriptor.bytes),
            'X-Semantic-SHA256': descriptor.sha256,
          },
        }));
      }
      await cache.put(markerURL(releaseURL, manifest), new Response(JSON.stringify(expectedMarker(manifest)), {
        headers: { 'Content-Type': 'application/json' },
      }));
      return true;
    } catch {
      await this.storage.delete(name).catch(() => false);
      return false;
    }
  }

  /**
   * Re-read a just-committed generation without retaining a second full model in memory.
   * Some engines resolve Cache.put() and then silently evict earlier large entries in the same
   * transaction. Persistence is only truthful after every file and the marker survive a readback.
   */
  async verify(manifest: ClientSemanticReleaseManifest, releaseURL: URL): Promise<boolean> {
    if (!this.storage) return false;
    const name = cacheName(manifest);
    try {
      const cache = await this.storage.open(name);
      const markerResponse = await cache.match(markerURL(releaseURL, manifest));
      if (!markerResponse || JSON.stringify(await markerResponse.json()) !== JSON.stringify(expectedMarker(manifest))) throw new Error('Incomplete semantic cache marker');
      for (const descriptor of manifest.files) {
        const response = await cache.match(assetURL(releaseURL, descriptor.path));
        if (!response) throw new Error(`Incomplete cached semantic release: ${descriptor.path}`);
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength !== descriptor.bytes || await sha256(bytes) !== descriptor.sha256) throw new Error(`Corrupt cached semantic release: ${descriptor.path}`);
      }
      return true;
    } catch {
      await this.storage.delete(name).catch(() => false);
      return false;
    }
  }

  async clearObsolete(manifest: ClientSemanticReleaseManifest): Promise<void> {
    if (!this.storage) return;
    const current = cacheName(manifest);
    try {
      const names = await this.storage.keys();
      await Promise.all(names.filter(name => name.startsWith(CACHE_PREFIX) && name !== current).map(name => this.storage!.delete(name)));
    } catch {
      // Storage can disappear or become quota-blocked at any time. A ready in-memory session remains valid.
    }
  }

  async clearCurrent(manifest: ClientSemanticReleaseManifest): Promise<void> {
    await this.storage?.delete(cacheName(manifest)).catch(() => false);
  }
}

export const semanticCachePrefix = CACHE_PREFIX;
