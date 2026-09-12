// Afilmory image-only loader adapter. Upstream source/commit: licenses/viewer-upstream.json.
import { fileTypeFromBlob } from 'file-type';
import { imageConverterManager } from './image-convert';

export interface LoadingState {
  isVisible: boolean;
  loadingProgress?: number;
  loadedBytes?: number;
  totalBytes?: number;
  isConverting?: boolean;
  isQueueWaiting?: boolean;
  isHeicFormat?: boolean;
}
export interface LoadingCallbacks {
  onProgress?: (progress: number) => void;
  onError?: () => void;
  onLoadingStateUpdate?: (state: Partial<LoadingState>) => void;
}
export interface ImageLoadResult { blobSrc: string; convertedUrl?: string }
type Entry = { result: ImageLoadResult; sourceBytes: number; refs: number; cached: boolean };

/** LRU ownership is separate from a mounted viewer's lease. Eviction must not
 * revoke a URL still being read by a GPU worker, native image or another viewer. */
export class ImageBlobCache {
  private entries = new Map<string, Entry>();
  constructor(private maxSize = 10) {}
  acquire(key: string): { result: ImageLoadResult; sourceBytes: number; release: () => void } | undefined {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key); this.entries.set(key, entry);
    return this.lease(entry);
  }
  store(key: string, blob: Blob, converted: boolean, sourceBytes = blob.size) {
    const existing = this.acquire(key);
    if (existing) return existing;
    const blobSrc = URL.createObjectURL(blob);
    const entry: Entry = { result: { blobSrc, ...(converted ? { convertedUrl: blobSrc } : {}) }, sourceBytes, refs: 0, cached: true };
    this.entries.set(key, entry);
    const lease = this.lease(entry);
    while (this.entries.size > this.maxSize) this.delete(this.entries.keys().next().value!);
    return lease;
  }
  private lease(entry: Entry) {
    entry.refs++;
    let released = false;
    return { result: entry.result, sourceBytes: entry.sourceBytes, release: () => {
      if (released) return;
      released = true; entry.refs--;
      if (!entry.cached && !entry.refs) URL.revokeObjectURL(entry.result.blobSrc);
    } };
  }
  delete(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    this.entries.delete(key); entry.cached = false;
    if (!entry.refs) URL.revokeObjectURL(entry.result.blobSrc);
    return true;
  }
  clear() { for (const key of this.entries.keys()) this.delete(key); }
  getStats() { return { size: this.entries.size, maxSize: this.maxSize, keys: [...this.entries.keys()] }; }
}
const regularImageCache = new ImageBlobCache(10);
const convertedImageCache = new ImageBlobCache(10);
export const clearImageCaches = () => { regularImageCache.clear(); convertedImageCache.clear(); };
export function removeImageCacheByUrl(src: string) {
  regularImageCache.delete(src); convertedImageCache.delete(src);
}
export const getImageCacheStats = () => ({ regular: regularImageCache.getStats(), converted: convertedImageCache.getStats() });

export class ImageLoaderManager {
  private controller: AbortController | null = null;
  private release: (() => void) | null = null;

  async loadImage(src: string, callbacks: LoadingCallbacks = {}): Promise<ImageLoadResult> {
    this.cleanup();
    const controller = new AbortController();
    this.controller = controller;
    const { signal } = controller;
    const update = (state: Partial<LoadingState>) => { if (!signal.aborted) callbacks.onLoadingStateUpdate?.(state); };
    update({ isVisible: true, loadingProgress: 0, loadedBytes: 0, totalBytes: undefined, isConverting: false, isQueueWaiting: false });
    // Unlike upstream, a hit also avoids downloading the same original again.
    const cached = regularImageCache.acquire(src) ?? convertedImageCache.acquire(src);
    if (cached) {
      this.release = cached.release;
      update({ isVisible: false, loadingProgress: 100, loadedBytes: cached.sourceBytes, totalBytes: cached.sourceBytes }); callbacks.onProgress?.(100);
      return cached.result;
    }
    // Race the *entire* pipeline so cleanup settles even during an uninterruptible decoder.
    let onAbort: () => void = () => {};
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener('abort', onAbort, { once: true });
    });
    const process = async () => {
      const blob = await this.download(src, signal, state => {
        update(state);
        if (state.loadingProgress !== undefined && !signal.aborted) callbacks.onProgress?.(state.loadingProgress);
      });
      update({ loadingProgress: 100, loadedBytes: blob.size, totalBytes: blob.size });
      const type = blob.size ? await fileTypeFromBlob(blob, { signal }) : undefined;
      signal.throwIfAborted();
      if (!type?.mime.startsWith('image/')) throw new Error('Response is not a valid image');
      // Some storage servers send octet-stream; set the detected MIME without changing bytes.
      const original = blob.type === type.mime ? blob : blob.slice(0, blob.size, type.mime);
      let converted: Blob | null = null;
      try { converted = await imageConverterManager.convertImage(original, src, type.mime, signal, update); }
      catch (error) {
        signal.throwIfAborted();
        // Preserve upstream's attempt to render the original if conversion fails.
        console.warn('Image conversion failed; trying original image', error);
      }
      signal.throwIfAborted();
      const lease = (converted ? convertedImageCache : regularImageCache).store(src, converted ?? original, !!converted, original.size);
      this.release = lease.release;
      update({ isVisible: false, isConverting: false, isQueueWaiting: false, loadingProgress: 100 });
      return lease.result;
    };
    try { return await Promise.race([process(), aborted]); }
    catch (error) {
      if (!signal.aborted) { update({ isVisible: false, isConverting: false, isQueueWaiting: false }); callbacks.onError?.(); }
      throw error;
    } finally { signal.removeEventListener('abort', onAbort); }
  }

  private download(src: string, signal: AbortSignal, update: (state: Partial<LoadingState>) => void): Promise<Blob> {
    return new Promise((resolve, reject) => {
      let xhr: XMLHttpRequest | null = null;
      const finish = (error?: unknown, blob?: Blob) => {
        signal.removeEventListener('abort', cancel);
        if (error) reject(error); else resolve(blob!);
      };
      const cancel = () => { clearTimeout(timer); xhr?.abort(); finish(signal.reason); };
      // Upstream's 300ms delay avoids downloads during quick photo navigation.
      const timer = setTimeout(() => {
        try {
          xhr = new XMLHttpRequest();
          xhr.open('GET', src); xhr.responseType = 'blob';
          xhr.onload = () => xhr!.status === 200 ? finish(undefined, xhr!.response as Blob) : finish(new Error(`HTTP ${xhr!.status}`));
          xhr.onerror = () => finish(new Error('Network error'));
          xhr.onabort = () => finish(new DOMException('Image request aborted', 'AbortError'));
          xhr.onprogress = event => update({ loadedBytes: event.loaded, totalBytes: event.lengthComputable && event.total > 0 ? event.total : undefined,
            loadingProgress: event.lengthComputable && event.total > 0 ? event.loaded / event.total * 100 : undefined });
          xhr.send();
        } catch (error) { finish(error); }
      }, 300);
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) cancel();
    });
  }

  cleanup() {
    this.controller?.abort(new DOMException('Image load cancelled', 'AbortError'));
    this.controller = null;
    this.release?.(); this.release = null;
  }
}
