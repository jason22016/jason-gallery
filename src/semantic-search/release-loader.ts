import type { ClientSemanticReleaseManifest } from './contracts';
import { SemanticSearchError } from './errors';
import { responseBytes, sha256 } from './hash';

export interface ReleaseDownloadProgress {
  file: string;
  downloadedBytes: number;
  totalBytes: number;
  transportBytes: number;
}

export async function downloadReleaseAssets(
  fetcher: typeof fetch,
  releaseURL: URL,
  manifest: ClientSemanticReleaseManifest,
  signal: AbortSignal,
  onProgress: (progress: ReleaseDownloadProgress) => void,
): Promise<Map<string, ArrayBuffer>> {
  const assets = new Map<string, ArrayBuffer>();
  let completed = 0;
  for (const descriptor of manifest.files) {
    const assembled = new Uint8Array(descriptor.bytes);
    for (const part of descriptor.parts) {
      const url = new URL(part.path, releaseURL.href.endsWith('/') ? releaseURL : `${releaseURL.href}/`);
      let response: Response;
      try { response = await fetcher(url, { cache: 'no-store', credentials: 'same-origin', signal }); }
      catch (error) { throw new SemanticSearchError('MODEL_DOWNLOAD', `Could not download semantic release part ${part.path}`, { cause: error }); }
      let bytes: ArrayBuffer;
      try {
        bytes = await responseBytes(response, part.bytes, current => onProgress({
          file: part.path,
          downloadedBytes: completed + part.offset + current,
          totalBytes: manifest.payloadBytes,
          transportBytes: manifest.transportBytes,
        }));
      } catch (error) {
        throw new SemanticSearchError('MODEL_DOWNLOAD', `Semantic release part ${part.path} is incomplete`, { cause: error });
      }
      if (await sha256(bytes) !== part.sha256) throw new SemanticSearchError('MODEL_INTEGRITY', `Semantic release part ${part.path} failed SHA-256 verification`);
      assembled.set(new Uint8Array(bytes), part.offset);
    }
    if (await sha256(assembled) !== descriptor.sha256) throw new SemanticSearchError('MODEL_INTEGRITY', `Semantic release file ${descriptor.path} failed SHA-256 verification`);
    assets.set(descriptor.role, assembled.buffer);
    completed += assembled.byteLength;
    onProgress({ file: descriptor.path, downloadedBytes: completed, totalBytes: manifest.payloadBytes, transportBytes: manifest.transportBytes });
  }
  if (assets.size !== manifest.files.length || completed !== manifest.payloadBytes) throw new SemanticSearchError('MODEL_INTEGRITY', 'Semantic release is incomplete');
  return assets;
}
