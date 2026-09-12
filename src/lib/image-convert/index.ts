// Adapted from Afilmory's image-convert strategies; see licenses/viewer-upstream.json.
// Return Blobs instead of owning URLs: the loader owns all URL leases and eviction.
import { ImageConversionPipeline } from './pipeline';
import type { LoadingState } from '../image-loader-manager';

type Update = (state: Partial<LoadingState>) => void;
export function needsImageConversion(mime: string, userAgent = navigator.userAgent): boolean {
  const safari = /Safari/.test(userAgent) && !/Chrome/.test(userAgent);
  if (mime === 'image/heic' || mime === 'image/heif') {
    const version = Number.parseInt(userAgent.match(/version\/(\d+)/i)?.[1] ?? '0', 10);
    return !(safari && version >= 17);
  }
  return (mime === 'image/tiff' || mime === 'image/tif') && !safari;
}

export class ImageConverterManager {
  private pipeline = new ImageConversionPipeline({ maxConcurrent: 2 });
  private pending = new Map<string, { promise: Promise<Blob>; listeners: Map<AbortSignal, Update> }>();

  async convertImage(blob: Blob, src: string, mime: string, signal: AbortSignal, update: Update): Promise<Blob | null> {
    if (!needsImageConversion(mime)) return null;
    signal.throwIfAborted();
    const key = `${mime}::${src}`;
    let task = this.pending.get(key);
    if (!task) {
      const listeners = new Map<AbortSignal, Update>([[signal, update]]);
      const notify: Update = state => { for (const [s, fn] of listeners) if (!s.aborted) fn(state); };
      const promise = this.pipeline.enqueue(async () => {
        if (![...listeners.keys()].some(s => !s.aborted)) throw new DOMException('Conversion cancelled', 'AbortError');
        notify({ isConverting: true, isQueueWaiting: false, isHeicFormat: mime === 'image/heic' || mime === 'image/heif' });
        return mime === 'image/tiff' || mime === 'image/tif' ? convertTiff(blob) : convertHeic(blob);
      }).finally(() => { if (this.pending.get(key)?.listeners === listeners) this.pending.delete(key); });
      task = { promise, listeners };
      this.pending.set(key, task);
    } else task.listeners.set(signal, update);
    update({ isConverting: true, isQueueWaiting: this.pipeline.getPendingCount() > 0 });
    // CPU decoders cannot be interrupted mid-call. Detach cancelled subscribers;
    // their eventual Blob is discarded without ever allocating an object URL.
    const detach = () => {
      task!.listeners.delete(signal);
      if (!task!.listeners.size && this.pending.get(key) === task) this.pending.delete(key);
    };
    signal.addEventListener('abort', detach, { once: true });
    try { return await task.promise; }
    finally { signal.removeEventListener('abort', detach); detach(); }
  }
}

async function convertHeic(blob: Blob): Promise<Blob> {
  const { heicTo, isHeic } = await import('heic-to');
  if (!await isHeic(blob as File)) throw new Error('File is not in HEIC/HEIF format');
  return heicTo({ blob, type: 'image/jpeg', quality: 1 });
}

async function convertTiff(blob: Blob): Promise<Blob> {
  const { decode } = await import('tiff');
  const frame = decode(await blob.arrayBuffer())[0];
  if (!frame) throw new Error('Failed to decode TIFF image');
  const { width, height, data, bitsPerSample, alpha, samplesPerPixel } = frame;
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get canvas context');
  const image = ctx.createImageData(width, height);
  // Same full-size, 8-bit JPEG quality=1 output as upstream. Also support
  // grayscale TIFF and preserve alpha=0 (upstream's `||` treats it as opaque).
  const channels = samplesPerPixel;
  const grayscale = channels <= 2;
  const sample = (index: number) => {
    const value = data[index] ?? 0;
    if (bitsPerSample === 8) return value;
    if (bitsPerSample === 16) return Math.round(value / 257);
    if (bitsPerSample === 32) return Math.round(value * 255);
    throw new Error(`Unsupported TIFF bit depth: ${bitsPerSample}`);
  };
  for (let i = 0; i < width * height; i++) {
    const from = i * channels, to = i * 4;
    image.data[to] = sample(from);
    image.data[to + 1] = sample(from + (grayscale ? 0 : 1));
    image.data[to + 2] = sample(from + (grayscale ? 0 : 2));
    image.data[to + 3] = alpha ? sample(from + channels - 1) : 255;
  }
  ctx.putImageData(image, 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob(result => {
    // Release the temporary full-size conversion canvas promptly.
    canvas.width = 0; canvas.height = 0;
    if (result) resolve(result); else reject(new Error('Failed to convert TIFF to JPEG'));
  }, 'image/jpeg', 1));
}
export const imageConverterManager = new ImageConverterManager();
