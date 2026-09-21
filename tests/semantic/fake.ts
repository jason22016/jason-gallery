import type { EmbeddingBackend, EmbeddingBackendRequest, EmbeddingBackendResult } from '../../scripts/semantic/backend.js';
import { semanticModelConfig, semanticModelContractSha256 } from '../../scripts/semantic/model-config.js';

export interface FakeEmbeddingCalls {
  batches: number;
  items: number;
  keys: string[];
}

export function deterministicVector(key: string): Float32Array {
  const vector = new Float32Array(semanticModelConfig.embedding.dimension);
  const first = Number.parseInt(key.slice(0, 4), 16) % vector.length;
  let second = Number.parseInt(key.slice(4, 8), 16) % vector.length;
  if (second === first) second = (second + 1) % vector.length;
  vector[first] = 0.8;
  vector[second] = 0.6;
  return vector;
}

export function fakeEmbeddingBackend(calls: FakeEmbeddingCalls = { batches: 0, items: 0, keys: [] }, patch: Partial<EmbeddingBackendResult> = {}): EmbeddingBackend {
  return async (request: EmbeddingBackendRequest) => {
    calls.batches++;
    calls.items += request.items.length;
    calls.keys.push(...request.items.map(item => item.cacheKey));
    return {
      device: 'cpu',
      modelContractSha256: semanticModelContractSha256,
      vectors: new Map(request.items.map(item => [item.cacheKey, deterministicVector(item.cacheKey)])),
      timing: { totalSeconds: 0.001 },
      ...patch,
    };
  };
}
