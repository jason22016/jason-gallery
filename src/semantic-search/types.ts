export type SemanticRuntimeStatus =
  | 'disabled'
  | 'not-downloaded'
  | 'downloading'
  | 'verifying'
  | 'initializing'
  | 'ready'
  | 'searching'
  | 'error'
  | 'update-required';

export type SemanticBackend = 'webgpu' | 'wasm';
export type SemanticBackendPreference = 'auto' | SemanticBackend;
export type SemanticCacheMode = 'unknown' | 'persistent' | 'memory';

export interface SemanticDownloadProgress {
  /** Verified payload bytes after HTTP content decoding. */
  downloadedBytes: number;
  totalBytes: number;
  /** Expected encoded transfer size from the immutable release manifest. */
  transportBytes: number;
  file?: string;
}

export interface SemanticRuntimeError {
  code: string;
  message: string;
  recoverable: boolean;
}

export interface SemanticRuntimeState {
  status: SemanticRuntimeStatus;
  releaseId: string;
  modelVersion: string;
  indexVersion?: string;
  backend?: SemanticBackend;
  cache: SemanticCacheMode;
  progress: SemanticDownloadProgress;
  error?: SemanticRuntimeError;
  fallbackReason?: string;
}

export interface SemanticSearchResult {
  publicId: string;
  score: number;
  rank: number;
}

export interface SemanticSearchResponse {
  query: string;
  results: SemanticSearchResult[];
  elapsedMs: number;
  backend: SemanticBackend;
  releaseId: string;
  indexVersion: string;
}

export interface SemanticSearchOptions {
  topK?: number;
  signal?: AbortSignal;
  /** Restrict eligible public photos before ranking and taking Top-K. Omit for the full index. */
  scopePhotoIds?: readonly string[];
}

export interface SemanticEnableOptions {
  backend?: SemanticBackendPreference;
  /** When a caller already owns the public catalog, require exact membership parity. */
  publicPhotoIds?: readonly string[];
}

export type SemanticStateListener = (state: Readonly<SemanticRuntimeState>) => void;
