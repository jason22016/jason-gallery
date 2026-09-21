import { SemanticSearchEngine, type SemanticSearchEngineOptions } from './engine';

const engineKey = Symbol.for('jason-gallery.semantic-search-engine');

type SemanticGlobal = typeof globalThis & { [engineKey]?: SemanticSearchEngine };

/**
 * The single document-scoped engine for future Explore and Cmd+K consumers.
 * Importing this module is side-effect free: model/index fetches begin only after `enable()`.
 */
export function getSemanticSearchEngine(): SemanticSearchEngine {
  const root = globalThis as SemanticGlobal;
  return root[engineKey] ??= new SemanticSearchEngine();
}

/** Isolated construction for tests and diagnostics. Product UI should use the shared getter. */
export function createSemanticSearchEngine(options: SemanticSearchEngineOptions = {}): SemanticSearchEngine {
  return new SemanticSearchEngine(options);
}

export { SemanticSearchEngine } from './engine';
export { SemanticSearchError } from './errors';
export type { SemanticSearchEngineOptions, SemanticRuntimeDiagnostics } from './engine';
export type {
  SemanticBackend,
  SemanticBackendPreference,
  SemanticCacheMode,
  SemanticDownloadProgress,
  SemanticEnableOptions,
  SemanticRuntimeError,
  SemanticRuntimeState,
  SemanticRuntimeStatus,
  SemanticSearchOptions,
  SemanticSearchResponse,
  SemanticSearchResult,
  SemanticStateListener,
} from './types';
