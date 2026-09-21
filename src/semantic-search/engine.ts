import { SemanticAssetCache, type CacheStorageLike } from './cache';
import type { ClientSemanticIndex, ClientSemanticReleaseManifest } from './contracts';
import { abortError, semanticError, SemanticSearchError } from './errors';
import { loadClientReleaseManifest, loadSemanticIndex } from './index-loader';
import {
  CLIENT_SEMANTIC_RELEASE_ID,
  CLIENT_SEMANTIC_RELEASE_MANIFEST_URL,
  CLIENT_SEMANTIC_RELEASE_ROOT,
  SEMANTIC_INDEX_URL,
} from './release-contract';
import { downloadReleaseAssets } from './release-loader';
import type {
  SemanticBackendPreference,
  SemanticEnableOptions,
  SemanticRuntimeState,
  SemanticSearchOptions,
  SemanticSearchResponse,
  SemanticStateListener,
} from './types';
import { SemanticWorkerClient, type WorkerLike } from './worker-client';

const MODEL_VERSION = 'google/siglip2-base-patch16-224@75de2d55ec2d0b4efc50b3e9ad70dba96a7b2fa2';

export interface SemanticSearchEngineOptions {
  baseURL?: string | URL;
  fetch?: typeof fetch;
  /** `null` explicitly disables persistent storage; undefined uses global Cache Storage when available. */
  cacheStorage?: CacheStorageLike | null;
  workerFactory?: () => WorkerLike;
  manifestURL?: string;
  indexURL?: string;
  initializationTimeoutMs?: number;
}

export interface SemanticRuntimeDiagnostics {
  workerStarts: number;
  sessionInitializations: number;
  queries: number;
  modelDownloads: number;
  persistentCacheHits: number;
  /** Active UI/runtime state subscriptions in this document. */
  stateListeners: number;
}

interface ActiveQuery {
  id: number;
  reject: (error: unknown) => void;
  detachSignal?: () => void;
}

function initialState(): SemanticRuntimeState {
  return {
    status: 'disabled',
    releaseId: CLIENT_SEMANTIC_RELEASE_ID,
    modelVersion: MODEL_VERSION,
    cache: 'unknown',
    progress: { downloadedBytes: 0, totalBytes: 0, transportBytes: 0 },
  };
}

function frozenState(value: SemanticRuntimeState): Readonly<SemanticRuntimeState> {
  return Object.freeze({
    ...value,
    progress: Object.freeze({ ...value.progress }),
    ...(value.error ? { error: Object.freeze({ ...value.error }) } : {}),
  });
}

function defaultWorker(): WorkerLike {
  return new Worker(new URL('./semantic-search.worker.ts', import.meta.url), { type: 'module', name: 'jason-gallery-semantic-search' });
}

export class SemanticSearchEngine {
  private readonly options: SemanticSearchEngineOptions;
  private readonly fetcher: typeof fetch;
  private readonly listeners = new Set<SemanticStateListener>();
  private readonly diagnostics: Omit<SemanticRuntimeDiagnostics, 'stateListeners'> = { workerStarts: 0, sessionInitializations: 0, queries: 0, modelDownloads: 0, persistentCacheHits: 0 };
  private state = frozenState(initialState());
  private enablePromise?: Promise<Readonly<SemanticRuntimeState>>;
  private operation = 0;
  private controller?: AbortController;
  private worker?: SemanticWorkerClient;
  private manifest?: ClientSemanticReleaseManifest;
  private index?: ClientSemanticIndex;
  private backendPreference: SemanticBackendPreference = 'auto';
  private querySequence = 0;
  private activeQuery?: ActiveQuery;
  private lastEnableOptions: SemanticEnableOptions = {};

  constructor(options: SemanticSearchEngineOptions = {}) {
    this.options = options;
    this.fetcher = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  }

  getState(): Readonly<SemanticRuntimeState> {
    return this.state;
  }

  subscribe(listener: SemanticStateListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => { this.listeners.delete(listener); };
  }

  getDiagnostics(): Readonly<SemanticRuntimeDiagnostics> {
    return Object.freeze({ ...this.diagnostics, stateListeners: this.listeners.size });
  }

  private publish(patch: Partial<SemanticRuntimeState> & Pick<SemanticRuntimeState, 'status'>): void {
    this.state = frozenState({ ...this.state, ...patch, progress: patch.progress ?? this.state.progress });
    for (const listener of this.listeners) {
      try { listener(this.state); } catch { /* A UI subscriber cannot break the shared runtime. */ }
    }
  }

  private baseURL(): URL {
    const value = this.options.baseURL ?? globalThis.location?.href;
    if (!value) throw new SemanticSearchError('UNSUPPORTED', 'Semantic search requires a browser URL');
    return value instanceof URL ? value : new URL(value);
  }

  private cache(): SemanticAssetCache {
    if (this.options.cacheStorage === null) return new SemanticAssetCache();
    if (this.options.cacheStorage) return new SemanticAssetCache(this.options.cacheStorage);
    try { return new SemanticAssetCache(globalThis.caches); }
    catch { return new SemanticAssetCache(); }
  }

  private assertCurrent(operation: number): void {
    if (operation !== this.operation || this.controller?.signal.aborted) throw abortError('Semantic initialization was superseded');
  }

  async enable(options: SemanticEnableOptions = {}): Promise<Readonly<SemanticRuntimeState>> {
    if (this.state.status === 'ready' || this.state.status === 'searching') return this.state;
    if (this.enablePromise) return this.enablePromise;
    this.lastEnableOptions = { ...options, ...(options.publicPhotoIds ? { publicPhotoIds: [...options.publicPhotoIds] } : {}) };
    this.backendPreference = options.backend ?? this.backendPreference;
    const operation = ++this.operation;
    this.controller?.abort();
    this.controller = new AbortController();
    const promise = this.initialize(operation, this.controller.signal, this.lastEnableOptions);
    const wrapped = promise.finally(() => { if (this.enablePromise === wrapped) this.enablePromise = undefined; });
    this.enablePromise = wrapped;
    return wrapped;
  }

  private async initialize(operation: number, signal: AbortSignal, options: SemanticEnableOptions): Promise<Readonly<SemanticRuntimeState>> {
    let manifest: ClientSemanticReleaseManifest | undefined;
    const cache = this.cache();
    try {
      this.publish({ status: 'not-downloaded', cache: cache.storage ? 'unknown' : 'memory', error: undefined, backend: undefined, fallbackReason: undefined, indexVersion: undefined, progress: { downloadedBytes: 0, totalBytes: 0, transportBytes: 0 } });
      const base = this.baseURL();
      const manifestURL = new URL(this.options.manifestURL ?? CLIENT_SEMANTIC_RELEASE_MANIFEST_URL, base);
      const releaseURL = new URL(`${CLIENT_SEMANTIC_RELEASE_ROOT}/`, base);
      const indexURL = new URL(this.options.indexURL ?? SEMANTIC_INDEX_URL, base);
      manifest = await loadClientReleaseManifest(this.fetcher, manifestURL, signal);
      this.assertCurrent(operation);
      this.manifest = manifest;
      this.publish({ status: 'verifying', progress: { downloadedBytes: 0, totalBytes: manifest.payloadBytes, transportBytes: manifest.transportBytes } });
      const loadedIndex = await loadSemanticIndex(this.fetcher, indexURL, manifest, signal, options.publicPhotoIds);
      this.assertCurrent(operation);
      this.index = loadedIndex.index;
      this.publish({ status: 'verifying', indexVersion: loadedIndex.index.indexVersion });

      let verifiedBytes = 0;
      let cached = await cache.read(manifest, releaseURL, (file, bytes) => {
        verifiedBytes += bytes;
        this.publish({ status: 'verifying', progress: { downloadedBytes: verifiedBytes, totalBytes: manifest!.payloadBytes, transportBytes: manifest!.transportBytes, file } });
      });
      this.assertCurrent(operation);
      let assets: Map<string, ArrayBuffer>;
      let cacheMode: 'persistent' | 'memory';
      if (cached) {
        this.diagnostics.persistentCacheHits++;
        assets = cached.assets;
        cacheMode = 'persistent';
      } else {
        this.diagnostics.modelDownloads++;
        this.publish({ status: 'downloading', cache: cache.storage ? 'unknown' : 'memory', progress: { downloadedBytes: 0, totalBytes: manifest.payloadBytes, transportBytes: manifest.transportBytes } });
        assets = await downloadReleaseAssets(this.fetcher, releaseURL, manifest, signal, progress => {
          this.publish({ status: 'downloading', progress });
        });
        this.assertCurrent(operation);
        this.publish({ status: 'verifying', progress: { downloadedBytes: manifest.payloadBytes, totalBytes: manifest.payloadBytes, transportBytes: manifest.transportBytes } });
        const committed = await cache.write(manifest, releaseURL, assets);
        cacheMode = committed && await cache.verify(manifest, releaseURL) ? 'persistent' : 'memory';
      }
      await cache.clearObsolete(manifest);
      this.assertCurrent(operation);
      this.publish({ status: 'initializing', cache: cacheMode, progress: { downloadedBytes: manifest.payloadBytes, totalBytes: manifest.payloadBytes, transportBytes: manifest.transportBytes } });

      this.worker?.dispose();
      this.worker = new SemanticWorkerClient((this.options.workerFactory ?? defaultWorker)());
      this.diagnostics.workerStarts++;
      const required = (role: string) => {
        const value = assets.get(role);
        if (!value) throw new SemanticSearchError('MODEL_INTEGRITY', `Semantic release is missing ${role}`);
        return value;
      };
      const initialization = this.worker.initialize({
        releaseId: manifest.releaseId,
        backend: this.backendPreference,
        model: required('onnx'),
        tokenizer: required('tokenizer'),
        tokenizerConfig: required('tokenizer-config'),
        modelConfig: required('model-config'),
        vectors: loadedIndex.vectors.buffer as ArrayBuffer,
        photoIds: [...loadedIndex.index.photoIds],
      });
      const timeoutMs = this.options.initializationTimeoutMs ?? 120_000;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const ready = await Promise.race([
        initialization,
        new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new SemanticSearchError('INITIALIZATION_TIMEOUT', 'Semantic runtime initialization timed out')), timeoutMs); }),
      ]).finally(() => { if (timeout) clearTimeout(timeout); });
      this.diagnostics.sessionInitializations++;
      this.assertCurrent(operation);
      this.publish({
        status: 'ready',
        backend: ready.backend,
        cache: cacheMode,
        fallbackReason: ready.fallbackReason,
        indexVersion: loadedIndex.index.indexVersion,
        progress: { downloadedBytes: manifest.payloadBytes, totalBytes: manifest.payloadBytes, transportBytes: manifest.transportBytes },
      });
      return this.state;
    } catch (error) {
      const failure = semanticError(error, 'INITIALIZATION_FAILED');
      if (operation !== this.operation || signal.aborted) throw failure;
      this.worker?.dispose(); this.worker = undefined;
      if (failure.code === 'UPDATE_REQUIRED') {
        this.publish({ status: 'update-required', error: { code: failure.code, message: failure.message, recoverable: failure.recoverable } });
      } else {
        if (manifest && failure.code === 'MODEL_INTEGRITY') await cache.clearCurrent(manifest);
        this.publish({ status: 'error', error: { code: failure.code, message: failure.message, recoverable: failure.recoverable } });
      }
      throw failure;
    }
  }

  async retry(options: SemanticEnableOptions = this.lastEnableOptions): Promise<Readonly<SemanticRuntimeState>> {
    this.cancelActive(abortError('Semantic runtime is retrying'));
    this.worker?.dispose(); this.worker = undefined;
    this.controller?.abort();
    this.enablePromise = undefined;
    this.publish({ status: 'disabled', error: undefined, backend: undefined, fallbackReason: undefined, progress: { downloadedBytes: 0, totalBytes: this.manifest?.payloadBytes ?? 0, transportBytes: this.manifest?.transportBytes ?? 0 } });
    return this.enable(options);
  }

  search(query: string, options: SemanticSearchOptions = {}): Promise<SemanticSearchResponse> {
    const text = query.trim();
    if (!text) return Promise.reject(new SemanticSearchError('INVALID_QUERY', 'Semantic query cannot be empty'));
    if (Array.from(text).length > 2_048) return Promise.reject(new SemanticSearchError('INVALID_QUERY', 'Semantic query is too long'));
    if (!this.worker || !this.index || !this.state.backend || (this.state.status !== 'ready' && this.state.status !== 'searching')) {
      return Promise.reject(new SemanticSearchError('NOT_READY', 'Semantic search is not ready'));
    }
    const topK = options.topK ?? 20;
    if (!Number.isSafeInteger(topK) || topK < 1 || topK > Math.min(100, this.index.photoIds.length)) return Promise.reject(new SemanticSearchError('INVALID_TOP_K', 'Semantic Top-K must be between 1 and 100 and no larger than the index'));
    if (options.signal?.aborted) return Promise.reject(abortError());
    this.cancelActive(abortError('A newer semantic query superseded this result'));
    const id = ++this.querySequence;
    const backend = this.state.backend;
    const indexVersion = this.index.indexVersion;
    this.diagnostics.queries++;
    this.publish({ status: 'searching' });
    return new Promise<SemanticSearchResponse>((resolve, reject) => {
      const onAbort = () => {
        if (this.activeQuery?.id !== id) return;
        this.worker?.cancel(id);
        this.activeQuery = undefined;
        this.publish({ status: 'ready' });
        reject(abortError());
      };
      if (options.signal) options.signal.addEventListener('abort', onAbort, { once: true });
      this.activeQuery = { id, reject, ...(options.signal ? { detachSignal: () => options.signal!.removeEventListener('abort', onAbort) } : {}) };
      this.worker!.query(id, text, topK).then(result => {
        if (this.activeQuery?.id !== id) throw abortError('Stale semantic query result was discarded');
        this.activeQuery.detachSignal?.(); this.activeQuery = undefined;
        this.publish({ status: 'ready' });
        resolve({ query: text, results: result.results, elapsedMs: result.elapsedMs, backend, releaseId: CLIENT_SEMANTIC_RELEASE_ID, indexVersion });
      }).catch(error => {
        if (this.activeQuery?.id !== id) return;
        this.activeQuery.detachSignal?.(); this.activeQuery = undefined;
        if (error instanceof DOMException && error.name === 'AbortError') {
          this.publish({ status: 'ready' }); reject(error); return;
        }
        const failure = semanticError(error, 'QUERY_FAILED');
        this.worker?.dispose(); this.worker = undefined;
        this.publish({ status: 'error', error: { code: failure.code, message: failure.message, recoverable: true } });
        reject(failure);
      });
    });
  }

  private cancelActive(error: unknown): void {
    const active = this.activeQuery;
    if (!active) return;
    this.activeQuery = undefined;
    active.detachSignal?.();
    this.worker?.cancel(active.id);
    active.reject(error);
  }

  dispose(): void {
    ++this.operation;
    this.controller?.abort(); this.controller = undefined;
    this.enablePromise = undefined;
    this.cancelActive(abortError('Semantic runtime was disposed'));
    this.worker?.dispose(); this.worker = undefined;
    this.manifest = undefined; this.index = undefined;
    this.publish({ ...initialState(), status: 'disabled' });
  }
}
