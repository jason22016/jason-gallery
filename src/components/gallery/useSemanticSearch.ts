import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  SemanticEnableOptions,
  SemanticRuntimeState,
  SemanticSearchOptions,
  SemanticSearchResponse,
  SemanticStateListener,
} from '../../semantic-search/types';

interface SemanticRuntimeDiagnostics {
  readonly workerStarts: number;
  readonly sessionInitializations: number;
  readonly queries: number;
  readonly modelDownloads: number;
  readonly persistentCacheHits: number;
  readonly stateListeners: number;
}

interface SharedSemanticEngine {
  getState(): Readonly<SemanticRuntimeState>;
  subscribe(listener: SemanticStateListener): () => void;
  enable(options?: SemanticEnableOptions): Promise<Readonly<SemanticRuntimeState>>;
  retry(options?: SemanticEnableOptions): Promise<Readonly<SemanticRuntimeState>>;
  search(query: string, options?: SemanticSearchOptions): Promise<SemanticSearchResponse>;
  dispose(): void;
  getDiagnostics(): Readonly<SemanticRuntimeDiagnostics>;
}

export interface SemanticSearchClient {
  readonly state: Readonly<SemanticRuntimeState> | null;
  readonly moduleLoading: boolean;
  readonly moduleError: string;
  enable(publicPhotoIds?: readonly string[]): Promise<void>;
  retry(publicPhotoIds?: readonly string[]): Promise<void>;
  cancelSetup(): void;
  search(query: string, options?: SemanticSearchOptions): Promise<SemanticSearchResponse>;
  diagnostics(): Readonly<SemanticRuntimeDiagnostics> | null;
}

/**
 * The import is intentionally inside the explicit enable action. Merely rendering a gallery or
 * opening Cmd+K cannot fetch the semantic module, Worker, index, model, tokenizer, or ORT runtime.
 */
export function useSemanticSearch(): SemanticSearchClient {
  const engine = useRef<SharedSemanticEngine | null>(null);
  const unsubscribe = useRef<(() => void) | null>(null);
  const loading = useRef<Promise<SharedSemanticEngine> | null>(null);
  const setupOperation = useRef(0);
  const [state, setState] = useState<Readonly<SemanticRuntimeState> | null>(null);
  const [moduleLoading, setModuleLoading] = useState(false);
  const [moduleError, setModuleError] = useState('');

  const attach = useCallback(async () => {
    if (engine.current) return engine.current;
    if (loading.current) return loading.current;
    setModuleLoading(true);
    setModuleError('');
    const promise = import('../../semantic-search').then(module => {
      const shared = module.getSemanticSearchEngine() as SharedSemanticEngine;
      engine.current = shared;
      unsubscribe.current?.();
      unsubscribe.current = shared.subscribe(setState);
      return shared;
    }).catch(error => {
      const message = error instanceof Error ? error.message : '无法加载 AI Search 模块';
      setModuleError(message);
      throw error;
    }).finally(() => {
      loading.current = null;
      setModuleLoading(false);
    });
    loading.current = promise;
    return promise;
  }, []);

  useEffect(() => () => { unsubscribe.current?.(); }, []);

  const enable = useCallback(async (publicPhotoIds?: readonly string[]) => {
    const operation = ++setupOperation.current;
    const shared = await attach();
    if (operation !== setupOperation.current) return;
    await shared.enable({ publicPhotoIds });
  }, [attach]);

  const retry = useCallback(async (publicPhotoIds?: readonly string[]) => {
    const operation = ++setupOperation.current;
    const shared = await attach();
    if (operation !== setupOperation.current) return;
    await shared.retry({ publicPhotoIds });
  }, [attach]);

  const cancelSetup = useCallback(() => {
    setupOperation.current++;
    engine.current?.dispose();
  }, []);
  const search = useCallback(async (query: string, options?: SemanticSearchOptions) => {
    if (!engine.current) throw new Error('AI Search is not enabled');
    return engine.current.search(query, options);
  }, []);
  const diagnostics = useCallback(() => engine.current?.getDiagnostics() ?? null, []);

  return { state, moduleLoading, moduleError, enable, retry, cancelSetup, search, diagnostics };
}
