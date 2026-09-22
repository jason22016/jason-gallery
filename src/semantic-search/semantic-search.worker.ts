/// <reference lib="webworker" />
import { Tokenizer } from '@huggingface/tokenizers';
import * as ort from 'onnxruntime-web/webgpu';
import { normalizeEmbedding, parseClientModelConfig, rankSemanticVectors, type ClientSemanticModelConfig } from './contracts';
import { CLIENT_SEMANTIC_RUNTIME_MODULE_URL, CLIENT_SEMANTIC_RUNTIME_WASM_URL } from './release-contract';
import type {
  SemanticWorkerInitRequest,
  SemanticWorkerQueryRequest,
  SemanticWorkerRequest,
  SemanticWorkerResponse,
  SemanticWorkerResult,
} from './worker-protocol';
import type { SemanticBackend } from './types';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const decoder = new TextDecoder();
let session: ort.InferenceSession | undefined;
let tokenizer: Tokenizer | undefined;
let config: ClientSemanticModelConfig | undefined;
let vectors: Float32Array | undefined;
let photoIds: string[] | undefined;
let activeBackend: SemanticBackend | undefined;
let initializedRelease: string | undefined;
const cancelled = new Set<number>();
const runOptions = new Map<number, ort.InferenceSession.RunOptions>();
let queryQueue = Promise.resolve();

function respond(id: number, result: SemanticWorkerResult): void {
  scope.postMessage({ id, result } satisfies SemanticWorkerResponse);
}

function fail(id: number, error: unknown, code = 'WORKER_ERROR'): void {
  scope.postMessage({ id, error: { code, message: error instanceof Error ? error.message : String(error) } } satisfies SemanticWorkerResponse);
}

function json(bytes: ArrayBuffer): unknown {
  return JSON.parse(decoder.decode(bytes));
}

async function createSession(model: ArrayBuffer, requested: SemanticWorkerInitRequest['backend']): Promise<{ session: ort.InferenceSession; backend: SemanticBackend; fallbackReason?: string }> {
  ort.env.wasm.proxy = false;
  ort.env.wasm.numThreads = scope.crossOriginIsolated ? Math.max(1, Math.min(4, scope.navigator.hardwareConcurrency || 1)) : 1;
  ort.env.wasm.wasmPaths = {
    mjs: new URL(CLIENT_SEMANTIC_RUNTIME_MODULE_URL, scope.location.origin).href,
    wasm: new URL(CLIENT_SEMANTIC_RUNTIME_WASM_URL, scope.location.origin).href,
  };
  const options = (backend: SemanticBackend): ort.InferenceSession.SessionOptions => ({
    executionProviders: [backend],
    graphOptimizationLevel: 'all',
    logSeverityLevel: 3,
  });
  if (requested !== 'wasm') {
    if (scope.navigator.gpu) {
      try {
        const adapter = await scope.navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
        if (adapter) {
          const created = await ort.InferenceSession.create(new Uint8Array(model), options('webgpu'));
          return { session: created, backend: 'webgpu' };
        }
      } catch (error) {
        const fallbackReason = error instanceof Error ? error.message : String(error);
        const created = await ort.InferenceSession.create(new Uint8Array(model), options('wasm'));
        return { session: created, backend: 'wasm', fallbackReason };
      }
    }
    const created = await ort.InferenceSession.create(new Uint8Array(model), options('wasm'));
    return { session: created, backend: 'wasm', fallbackReason: 'WebGPU adapter unavailable' };
  }
  const created = await ort.InferenceSession.create(new Uint8Array(model), options('wasm'));
  return { session: created, backend: 'wasm' };
}

async function initialize(request: SemanticWorkerInitRequest): Promise<void> {
  if (session) {
    if (initializedRelease !== request.releaseId) throw new Error('Worker is already initialized with another semantic release');
    respond(request.id, { kind: 'ready', backend: activeBackend! });
    return;
  }
  const parsedConfig = parseClientModelConfig(json(request.modelConfig));
  const tokenizerJSON = json(request.tokenizer);
  const tokenizerConfigJSON = json(request.tokenizerConfig);
  const nextTokenizer = new Tokenizer(tokenizerJSON as object, tokenizerConfigJSON as object);
  if (nextTokenizer.get_vocab(true).size !== 65536) throw new Error('Tokenizer vocabulary size mismatch');
  const nextVectors = new Float32Array(request.vectors);
  if (nextVectors.length !== request.photoIds.length * parsedConfig.embeddingDimension) throw new Error('Semantic vector/photo mapping mismatch in worker');
  const ready = await createSession(request.model, request.backend);
  const initializedSession = ready.session;
  if (!initializedSession.inputNames.includes(parsedConfig.inputName) || !initializedSession.outputNames.includes(parsedConfig.outputName)) {
    await initializedSession.release();
    throw new Error('ONNX input/output contract mismatch');
  }
  session = initializedSession;
  tokenizer = nextTokenizer;
  config = parsedConfig;
  vectors = nextVectors;
  photoIds = request.photoIds;
  activeBackend = ready.backend;
  initializedRelease = request.releaseId;
  respond(request.id, { kind: 'ready', backend: ready.backend, ...(ready.fallbackReason ? { fallbackReason: ready.fallbackReason } : {}) });
}

function encode(text: string): number[] {
  if (!tokenizer || !config) throw new Error('Semantic worker is not initialized');
  const ids = [...tokenizer.encode(text, { add_special_tokens: false }).ids.slice(0, config.maximumTokens - 1), config.endTokenId];
  while (ids.length < config.maximumTokens) ids.push(config.paddingTokenId);
  return ids;
}

async function query(request: SemanticWorkerQueryRequest): Promise<void> {
  if (!session || !config || !vectors || !photoIds || !activeBackend) throw new Error('Semantic worker is not initialized');
  if (cancelled.delete(request.queryId)) return;
  const started = performance.now();
  const ids = encode(request.text);
  const input = new ort.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]);
  const options: ort.InferenceSession.RunOptions = { tag: `semantic-query-${request.queryId}` };
  runOptions.set(request.queryId, options);
  try {
    const output = await session.run({ [config.inputName]: input }, [config.outputName], options);
    const tensor = output[config.outputName];
    if (!(tensor instanceof ort.Tensor) || tensor.type !== 'float32') throw new Error('ONNX query output is not a Float32 tensor');
    try {
      const embedding = normalizeEmbedding(await tensor.getData() as Float32Array, config.embeddingDimension);
      if (cancelled.delete(request.queryId)) return;
      respond(request.id, {
        kind: 'query',
        queryId: request.queryId,
        results: rankSemanticVectors(embedding, photoIds, vectors, request.topK, request.scopePhotoIds),
        elapsedMs: performance.now() - started,
      });
    } finally { tensor.dispose(); }
  } catch (error) {
    if (!cancelled.delete(request.queryId)) throw error;
  } finally {
    runOptions.delete(request.queryId);
    input.dispose();
  }
}

async function dispose(id: number): Promise<void> {
  const current = session;
  session = undefined; tokenizer = undefined; config = undefined; vectors = undefined; photoIds = undefined; activeBackend = undefined; initializedRelease = undefined;
  await current?.release();
  respond(id, { kind: 'disposed' });
  scope.close();
}

scope.onmessage = ({ data }: MessageEvent<SemanticWorkerRequest>) => {
  if (data.type === 'cancel') {
    cancelled.add(data.queryId);
    const options = runOptions.get(data.queryId);
    if (options) options.terminate = true;
    return;
  }
  if (data.type === 'query') {
    queryQueue = queryQueue.then(() => query(data)).catch(error => fail(data.id, error, 'QUERY_FAILED'));
    return;
  }
  if (data.type === 'initialize') initialize(data).catch(error => fail(data.id, error, 'INITIALIZATION_FAILED'));
  else dispose(data.id).catch(error => fail(data.id, error, 'DISPOSE_FAILED'));
};
