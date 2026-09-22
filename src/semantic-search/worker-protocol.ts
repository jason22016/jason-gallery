import type { SemanticBackend, SemanticBackendPreference, SemanticSearchResult } from './types';

export interface SemanticWorkerInitRequest {
  type: 'initialize';
  id: number;
  releaseId: string;
  backend: SemanticBackendPreference;
  model: ArrayBuffer;
  tokenizer: ArrayBuffer;
  tokenizerConfig: ArrayBuffer;
  modelConfig: ArrayBuffer;
  vectors: ArrayBuffer;
  photoIds: string[];
}

export interface SemanticWorkerQueryRequest {
  type: 'query';
  id: number;
  queryId: number;
  text: string;
  topK: number;
  scopePhotoIds?: readonly string[];
}

export interface SemanticWorkerCancelRequest {
  type: 'cancel';
  queryId: number;
}

export interface SemanticWorkerDisposeRequest {
  type: 'dispose';
  id: number;
}

export type SemanticWorkerRequest = SemanticWorkerInitRequest | SemanticWorkerQueryRequest | SemanticWorkerCancelRequest | SemanticWorkerDisposeRequest;

export interface SemanticWorkerReadyResult {
  kind: 'ready';
  backend: SemanticBackend;
  fallbackReason?: string;
}

export interface SemanticWorkerQueryResult {
  kind: 'query';
  queryId: number;
  results: SemanticSearchResult[];
  elapsedMs: number;
}

export interface SemanticWorkerDisposedResult {
  kind: 'disposed';
}

export type SemanticWorkerResult = SemanticWorkerReadyResult | SemanticWorkerQueryResult | SemanticWorkerDisposedResult;

export interface SemanticWorkerResponse {
  id: number;
  result?: SemanticWorkerResult;
  error?: { message: string; code: string };
}
