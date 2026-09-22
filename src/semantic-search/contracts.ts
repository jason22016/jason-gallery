import type { SemanticSearchResult } from './types';

const SHA256 = /^[a-f0-9]{64}$/;
const PUBLIC_PHOTO_ID = /^[A-Za-z0-9_-]{16}$/;

export type ClientReleaseFileRole = 'tokenizer' | 'tokenizer-config' | 'model-config' | 'onnx';

export interface ClientReleasePart {
  path: string;
  offset: number;
  bytes: number;
  sha256: string;
  contentEncoding: 'br' | null;
  transportBytes: number;
  transportSha256: string;
}

export interface ClientReleaseFile {
  role: ClientReleaseFileRole;
  path: string;
  mediaType: 'application/json' | 'application/octet-stream';
  bytes: number;
  sha256: string;
  parts: ClientReleasePart[];
}

export interface ClientSemanticReleaseManifest {
  schemaVersion: 1;
  kind: 'jason-gallery-client-semantic-release';
  releaseId: string;
  bundleSha256: string;
  indivisible: true;
  model: {
    id: string;
    revision: string;
    semanticModelContractSha256: string;
    clientModelContractSha256: string;
    publicModelSha256: string;
    embeddingSpace: string;
    embeddingDimension: 768;
  };
  compatibleIndex: {
    schemaVersion: 1;
    kind: 'jason-gallery-public-semantic-index';
    ordering: 'public-photo-id-bytewise-ascending';
    vectorFile: 'vectors.f32';
    dtype: 'float32-le';
    normalization: 'l2';
  };
  runtime: {
    onnxRuntimeWebVersion: string;
    tokenizerPackage: '@huggingface/tokenizers';
    tokenizerVersion: string;
    backendOrder: ['webgpu', 'wasm'];
  };
  payloadBytes: number;
  transportBytes: number;
  files: ClientReleaseFile[];
}

export interface ClientSemanticModelConfig {
  schemaVersion: 1;
  modelId: string;
  revision: string;
  inputName: 'input_ids';
  outputName: 'text_embeds';
  maximumTokens: 64;
  endTokenId: 1;
  paddingTokenId: 0;
  embeddingDimension: 768;
  embeddingNormalization: 'l2';
  opset: 17;
  transformerQuantization: 'asymmetric-uint4-block-32';
  tokenEmbedding: 'int8';
  projectionHeadDtype: 'float32';
  layerNormDtype: 'float32';
  activationDtype: 'float32';
}

export interface ClientSemanticIndex {
  schemaVersion: 1;
  kind: 'jason-gallery-public-semantic-index';
  model: Record<string, unknown>;
  ordering: 'public-photo-id-bytewise-ascending';
  photoIds: string[];
  vectors: {
    file: 'vectors.f32';
    dtype: 'float32-le';
    dimension: 768;
    normalization: 'l2';
    count: number;
    bytes: number;
    sha256: string;
  };
  indexVersion: string;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  if (actual.length !== sorted.length || actual.some((key, index) => key !== sorted[index])) {
    throw new Error(`${label} contains unexpected or missing fields`);
  }
}

function positiveInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new Error(`${label} must be a positive integer`);
}

function nonNegativeInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${label} must be a non-negative integer`);
}

function digest(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !SHA256.test(value)) throw new Error(`${label} must be a SHA-256 digest`);
}

function literal<T extends string | number | boolean | null>(value: unknown, expected: T, label: string): asserts value is T {
  if (value !== expected) throw new Error(`${label} is incompatible`);
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, child]) => [key, canonicalValue(child)]));
  }
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Canonical JSON cannot contain non-finite numbers');
  return value;
}

export function canonicalJSON(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

export function manifestBundleRecord(manifest: ClientSemanticReleaseManifest): Omit<ClientSemanticReleaseManifest, 'bundleSha256'> {
  const { bundleSha256: _bundleSha256, ...bundle } = manifest;
  return bundle;
}

export function parseClientReleaseManifest(value: unknown): ClientSemanticReleaseManifest {
  const manifest = record(value, 'Semantic release manifest');
  exactKeys(manifest, ['schemaVersion', 'kind', 'releaseId', 'bundleSha256', 'indivisible', 'model', 'compatibleIndex', 'runtime', 'payloadBytes', 'transportBytes', 'files'], 'Semantic release manifest');
  literal(manifest.schemaVersion, 1, 'Semantic release schema');
  literal(manifest.kind, 'jason-gallery-client-semantic-release', 'Semantic release kind');
  if (typeof manifest.releaseId !== 'string' || !/^[a-z0-9-]+$/.test(manifest.releaseId)) throw new Error('Invalid semantic release ID');
  digest(manifest.bundleSha256, 'Semantic bundle digest');
  literal(manifest.indivisible, true, 'Semantic indivisible release flag');

  const model = record(manifest.model, 'Semantic release model');
  exactKeys(model, ['id', 'revision', 'semanticModelContractSha256', 'clientModelContractSha256', 'publicModelSha256', 'embeddingSpace', 'embeddingDimension'], 'Semantic release model');
  for (const key of ['id', 'revision', 'embeddingSpace'] as const) if (typeof model[key] !== 'string' || !model[key]) throw new Error(`Invalid semantic model ${key}`);
  for (const key of ['semanticModelContractSha256', 'clientModelContractSha256', 'publicModelSha256'] as const) digest(model[key], `Semantic model ${key}`);
  literal(model.embeddingDimension, 768, 'Semantic embedding dimension');

  const compatibleIndex = record(manifest.compatibleIndex, 'Compatible semantic index');
  exactKeys(compatibleIndex, ['schemaVersion', 'kind', 'ordering', 'vectorFile', 'dtype', 'normalization'], 'Compatible semantic index');
  literal(compatibleIndex.schemaVersion, 1, 'Semantic index schema');
  literal(compatibleIndex.kind, 'jason-gallery-public-semantic-index', 'Semantic index kind');
  literal(compatibleIndex.ordering, 'public-photo-id-bytewise-ascending', 'Semantic index ordering');
  literal(compatibleIndex.vectorFile, 'vectors.f32', 'Semantic vector file');
  literal(compatibleIndex.dtype, 'float32-le', 'Semantic vector dtype');
  literal(compatibleIndex.normalization, 'l2', 'Semantic vector normalization');

  const runtime = record(manifest.runtime, 'Semantic runtime');
  exactKeys(runtime, ['onnxRuntimeWebVersion', 'tokenizerPackage', 'tokenizerVersion', 'backendOrder'], 'Semantic runtime');
  for (const key of ['onnxRuntimeWebVersion', 'tokenizerVersion'] as const) if (typeof runtime[key] !== 'string' || !runtime[key]) throw new Error(`Invalid semantic runtime ${key}`);
  literal(runtime.tokenizerPackage, '@huggingface/tokenizers', 'Semantic tokenizer package');
  if (!Array.isArray(runtime.backendOrder) || runtime.backendOrder.length !== 2 || runtime.backendOrder[0] !== 'webgpu' || runtime.backendOrder[1] !== 'wasm') throw new Error('Semantic backend order is incompatible');
  positiveInteger(manifest.payloadBytes, 'Semantic payload bytes');
  positiveInteger(manifest.transportBytes, 'Semantic transport bytes');

  if (!Array.isArray(manifest.files) || manifest.files.length !== 4) throw new Error('Semantic release must contain exactly four payload files');
  const roles = new Set<ClientReleaseFileRole>();
  const paths = new Set<string>();
  const partPaths = new Set<string>();
  const files = manifest.files.map((raw, index) => {
    const file = record(raw, `Semantic release file ${index}`);
    exactKeys(file, ['role', 'path', 'mediaType', 'bytes', 'sha256', 'parts'], `Semantic release file ${index}`);
    if (!['tokenizer', 'tokenizer-config', 'model-config', 'onnx'].includes(String(file.role))) throw new Error('Invalid semantic release file role');
    if (typeof file.path !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(file.path)) throw new Error('Invalid semantic release file path');
    if (file.mediaType !== 'application/json' && file.mediaType !== 'application/octet-stream') throw new Error('Invalid semantic release media type');
    positiveInteger(file.bytes, 'Semantic release file bytes');
    digest(file.sha256, 'Semantic release file digest');
    if (!Array.isArray(file.parts) || file.parts.length === 0) throw new Error('Semantic release file must contain at least one transport part');
    let nextOffset = 0;
    const parts = file.parts.map((rawPart, partIndex) => {
      const part = record(rawPart, `Semantic release file ${index} part ${partIndex}`);
      exactKeys(part, ['path', 'offset', 'bytes', 'sha256', 'contentEncoding', 'transportBytes', 'transportSha256'], `Semantic release file ${index} part ${partIndex}`);
      if (typeof part.path !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(part.path)) throw new Error('Invalid semantic release part path');
      nonNegativeInteger(part.offset, 'Semantic release part offset');
      positiveInteger(part.bytes, 'Semantic release part bytes');
      positiveInteger(part.transportBytes, 'Semantic release part transport bytes');
      digest(part.sha256, 'Semantic release part digest');
      digest(part.transportSha256, 'Semantic release part transport digest');
      if (part.contentEncoding !== null && part.contentEncoding !== 'br') throw new Error('Invalid semantic release part content encoding');
      if (part.offset !== nextOffset) throw new Error('Semantic release parts must be contiguous and ordered');
      if (part.contentEncoding === null && (part.bytes !== part.transportBytes || part.sha256 !== part.transportSha256)) throw new Error('Unencoded semantic release part transport must match its payload');
      if (partPaths.has(part.path)) throw new Error('Duplicate semantic release transport part');
      partPaths.add(part.path);
      nextOffset += part.bytes;
      return part;
    });
    if (nextOffset !== file.bytes) throw new Error('Semantic release part byte size mismatch');
    const parsed = { ...file, parts } as unknown as ClientReleaseFile;
    if (roles.has(parsed.role) || paths.has(parsed.path)) throw new Error('Duplicate semantic release payload entry');
    roles.add(parsed.role); paths.add(parsed.path);
    return parsed;
  });
  for (const role of ['tokenizer', 'tokenizer-config', 'model-config', 'onnx'] as const) if (!roles.has(role)) throw new Error(`Semantic release is missing ${role}`);
  if (files.reduce((sum, file) => sum + file.bytes, 0) !== manifest.payloadBytes || files.reduce((sum, file) => sum + file.parts.reduce((partSum, part) => partSum + part.transportBytes, 0), 0) !== manifest.transportBytes) {
    throw new Error('Semantic release aggregate byte size mismatch');
  }
  return { ...manifest, files } as unknown as ClientSemanticReleaseManifest;
}

export function parseClientModelConfig(value: unknown): ClientSemanticModelConfig {
  const config = record(value, 'Semantic model config');
  exactKeys(config, ['schemaVersion', 'modelId', 'revision', 'inputName', 'outputName', 'maximumTokens', 'endTokenId', 'paddingTokenId', 'embeddingDimension', 'embeddingNormalization', 'opset', 'transformerQuantization', 'tokenEmbedding', 'projectionHeadDtype', 'layerNormDtype', 'activationDtype'], 'Semantic model config');
  literal(config.schemaVersion, 1, 'Semantic model config schema');
  if (typeof config.modelId !== 'string' || typeof config.revision !== 'string') throw new Error('Invalid semantic model identity');
  literal(config.inputName, 'input_ids', 'Semantic model input');
  literal(config.outputName, 'text_embeds', 'Semantic model output');
  literal(config.maximumTokens, 64, 'Semantic maximum tokens');
  literal(config.endTokenId, 1, 'Semantic end token');
  literal(config.paddingTokenId, 0, 'Semantic padding token');
  literal(config.embeddingDimension, 768, 'Semantic model output dimension');
  literal(config.embeddingNormalization, 'l2', 'Semantic model normalization');
  literal(config.opset, 17, 'Semantic ONNX opset');
  literal(config.transformerQuantization, 'asymmetric-uint4-block-32', 'Semantic transformer quantization');
  literal(config.tokenEmbedding, 'int8', 'Semantic token embedding quantization');
  for (const key of ['projectionHeadDtype', 'layerNormDtype', 'activationDtype'] as const) literal(config[key], 'float32', `Semantic ${key}`);
  return config as unknown as ClientSemanticModelConfig;
}

export function parseSemanticIndex(value: unknown): ClientSemanticIndex {
  const index = record(value, 'Public semantic index');
  exactKeys(index, ['schemaVersion', 'kind', 'model', 'ordering', 'photoIds', 'vectors', 'indexVersion'], 'Public semantic index');
  literal(index.schemaVersion, 1, 'Public semantic index schema');
  literal(index.kind, 'jason-gallery-public-semantic-index', 'Public semantic index kind');
  record(index.model, 'Public semantic model');
  literal(index.ordering, 'public-photo-id-bytewise-ascending', 'Public semantic index ordering');
  digest(index.indexVersion, 'Public semantic index version');
  if (!Array.isArray(index.photoIds) || index.photoIds.some(id => typeof id !== 'string' || !PUBLIC_PHOTO_ID.test(id))) throw new Error('Invalid public photo ID mapping');
  const photoIds = index.photoIds as string[];
  if (photoIds.some((id, position) => position > 0 && photoIds[position - 1]! >= id)) throw new Error('Public photo IDs must be unique and bytewise ordered');
  const vectors = record(index.vectors, 'Semantic vector descriptor');
  exactKeys(vectors, ['file', 'dtype', 'dimension', 'normalization', 'count', 'bytes', 'sha256'], 'Semantic vector descriptor');
  literal(vectors.file, 'vectors.f32', 'Semantic vector file');
  literal(vectors.dtype, 'float32-le', 'Semantic vector dtype');
  literal(vectors.dimension, 768, 'Semantic vector dimension');
  literal(vectors.normalization, 'l2', 'Semantic vector normalization');
  positiveInteger(vectors.count, 'Semantic vector count');
  positiveInteger(vectors.bytes, 'Semantic vector bytes');
  digest(vectors.sha256, 'Semantic vector digest');
  if (vectors.count !== photoIds.length || vectors.bytes !== photoIds.length * 768 * Float32Array.BYTES_PER_ELEMENT) throw new Error('Semantic vector/photo count mismatch');
  return index as unknown as ClientSemanticIndex;
}

export function indexVersionRecord(index: ClientSemanticIndex): Omit<ClientSemanticIndex, 'indexVersion'> {
  const { indexVersion: _indexVersion, ...record } = index;
  return record;
}

export function assertExpectedPublicPhotoIds(actual: readonly string[], expected: readonly string[]): void {
  const normalized = [...expected].sort();
  if (normalized.length !== new Set(normalized).size || normalized.some(id => !PUBLIC_PHOTO_ID.test(id)) || canonicalJSON(actual) !== canonicalJSON(normalized)) {
    throw new Error('Semantic index does not match the active public photo mapping');
  }
}

const littleEndian = new Uint8Array(new Uint32Array([0x01020304]).buffer)[0] === 4;

export function decodeAndValidateVectors(buffer: ArrayBuffer, index: ClientSemanticIndex): Float32Array {
  if (buffer.byteLength !== index.vectors.bytes) throw new Error('Semantic vector byte length mismatch');
  let vectors: Float32Array;
  if (littleEndian) vectors = new Float32Array(buffer);
  else {
    const view = new DataView(buffer);
    vectors = new Float32Array(buffer.byteLength / Float32Array.BYTES_PER_ELEMENT);
    for (let position = 0; position < vectors.length; position++) vectors[position] = view.getFloat32(position * 4, true);
  }
  for (let row = 0; row < index.vectors.count; row++) {
    let squaredNorm = 0;
    const offset = row * index.vectors.dimension;
    for (let column = 0; column < index.vectors.dimension; column++) {
      const value = vectors[offset + column]!;
      if (!Number.isFinite(value)) throw new Error(`Semantic vector row ${row} contains a non-finite value`);
      squaredNorm += value * value;
    }
    const norm = Math.sqrt(squaredNorm);
    if (Math.abs(norm - 1) > 2e-5) throw new Error(`Semantic vector row ${row} is not L2 normalized`);
  }
  return vectors;
}

export function normalizeEmbedding(values: ArrayLike<number>, dimension = 768): Float32Array {
  if (values.length !== dimension) throw new Error(`Semantic query dimension mismatch: expected ${dimension}, got ${values.length}`);
  let squaredNorm = 0;
  const normalized = new Float32Array(dimension);
  for (let index = 0; index < dimension; index++) {
    const value = Number(values[index]);
    if (!Number.isFinite(value)) throw new Error('Semantic query embedding contains a non-finite value');
    normalized[index] = value;
    squaredNorm += value * value;
  }
  const norm = Math.sqrt(squaredNorm);
  if (!Number.isFinite(norm) || norm === 0) throw new Error('Semantic query embedding has zero or invalid norm');
  for (let index = 0; index < normalized.length; index++) normalized[index] /= norm;
  return normalized;
}

export function rankSemanticVectors(query: Float32Array, photoIds: readonly string[], vectors: Float32Array, topK: number, scopePhotoIds?: readonly string[]): SemanticSearchResult[] {
  if (query.length !== 768 || vectors.length !== photoIds.length * query.length) throw new Error('Semantic rank input dimension mismatch');
  if (!Number.isSafeInteger(topK) || topK < 1 || topK > photoIds.length) throw new Error('Semantic Top-K is out of range');
  const scope = scopePhotoIds === undefined ? undefined : new Set(scopePhotoIds);
  const scores: Array<{ publicId: string; score: number; row: number }> = [];
  for (const [row, publicId] of photoIds.entries()) {
    if (scope && !scope.has(publicId)) continue;
    let score = 0;
    const offset = row * query.length;
    for (let column = 0; column < query.length; column++) score += vectors[offset + column]! * query[column]!;
    if (!Number.isFinite(score)) throw new Error('Semantic cosine score is non-finite');
    scores.push({ publicId, score, row });
  }
  scores.sort((left, right) => right.score - left.score || left.row - right.row);
  return scores.slice(0, topK).map(({ publicId, score }, index) => ({ publicId, score, rank: index + 1 }));
}
