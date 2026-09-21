import fs from 'node:fs/promises';
import path from 'node:path';
import { canonicalHash, sha256 } from './hash.js';
import { assertCurrentSemanticModel, publicSemanticModel, semanticModelConfig } from './model-config.js';
import { decodeFloat32LE } from './vector.js';

export interface PublicSemanticIndexRecord {
  schemaVersion: 1;
  kind: 'jason-gallery-public-semantic-index';
  model: typeof publicSemanticModel;
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
}

export type PublicSemanticIndex = PublicSemanticIndexRecord & { indexVersion: string };

export function comparePublicPhotoIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function createPublicSemanticIndex(photoIds: string[], vectorBytes: number, vectorSha256: string): PublicSemanticIndex {
  const record: PublicSemanticIndexRecord = {
    schemaVersion: semanticModelConfig.index.schemaVersion,
    kind: semanticModelConfig.index.kind,
    model: publicSemanticModel,
    ordering: semanticModelConfig.index.ordering,
    photoIds,
    vectors: {
      file: semanticModelConfig.index.vectorFile,
      dtype: semanticModelConfig.embedding.dtype,
      dimension: semanticModelConfig.embedding.dimension,
      normalization: semanticModelConfig.embedding.normalization,
      count: photoIds.length,
      bytes: vectorBytes,
      sha256: vectorSha256,
    },
  };
  return { ...record, indexVersion: canonicalHash(record) };
}

function exactKeys(value: Record<string, unknown>, keys: string[], label: string): void {
  const actual = Object.keys(value).sort(comparePublicPhotoIds);
  const expected = [...keys].sort(comparePublicPhotoIds);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label} contains unexpected or missing fields`);
}

function assertPublicId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{16}$/.test(id)) throw new Error('Invalid public photo ID in semantic index');
}

export async function verifyPublicSemanticIndex(directory: string, expectedPhotoIds?: readonly string[]): Promise<PublicSemanticIndex> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  if (entries.length !== 2 || entries.some(entry => !entry.isFile() || !['index.json', 'vectors.f32'].includes(entry.name))) {
    throw new Error('Public semantic output must contain only index.json and vectors.f32');
  }
  const raw: unknown = JSON.parse(await fs.readFile(path.join(directory, 'index.json'), 'utf8'));
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid public semantic index');
  const index = raw as unknown as PublicSemanticIndex;
  exactKeys(index as unknown as Record<string, unknown>, ['schemaVersion', 'kind', 'indexVersion', 'model', 'ordering', 'photoIds', 'vectors'], 'Public semantic index');
  if (index.schemaVersion !== semanticModelConfig.index.schemaVersion || index.kind !== semanticModelConfig.index.kind || index.ordering !== semanticModelConfig.index.ordering) {
    throw new Error('Semantic index schema/version mismatch');
  }
  assertCurrentSemanticModel(index.model);
  if (!Array.isArray(index.photoIds)) throw new Error('Semantic index photoIds must be an array');
  index.photoIds.forEach(assertPublicId);
  if (new Set(index.photoIds).size !== index.photoIds.length || index.photoIds.some((id, position) => position > 0 && comparePublicPhotoIds(index.photoIds[position - 1]!, id) >= 0)) {
    throw new Error('Semantic index photo IDs must be unique and deterministically ordered');
  }
  if (index.vectors === null || typeof index.vectors !== 'object' || Array.isArray(index.vectors)) throw new Error('Invalid semantic vector descriptor');
  exactKeys(index.vectors as unknown as Record<string, unknown>, ['file', 'dtype', 'dimension', 'normalization', 'count', 'bytes', 'sha256'], 'Semantic vector descriptor');
  if (index.vectors.file !== semanticModelConfig.index.vectorFile || index.vectors.dtype !== semanticModelConfig.embedding.dtype ||
      index.vectors.dimension !== semanticModelConfig.embedding.dimension || index.vectors.normalization !== semanticModelConfig.embedding.normalization ||
      index.vectors.count !== index.photoIds.length || index.vectors.bytes !== index.photoIds.length * semanticModelConfig.embedding.dimension * Float32Array.BYTES_PER_ELEMENT ||
      !/^[a-f0-9]{64}$/.test(index.vectors.sha256)) throw new Error('Semantic vector metadata mismatch');
  const { indexVersion, ...record } = index;
  if (!/^[a-f0-9]{64}$/.test(indexVersion) || canonicalHash(record) !== indexVersion) throw new Error('Semantic index version digest mismatch');
  const vectors = await fs.readFile(path.join(directory, semanticModelConfig.index.vectorFile));
  if (vectors.byteLength !== index.vectors.bytes || sha256(vectors) !== index.vectors.sha256) throw new Error('Semantic vector file digest mismatch');
  if (decodeFloat32LE(vectors).length !== index.photoIds.length) throw new Error('Semantic vector/photo count mismatch');
  if (expectedPhotoIds) {
    const expected = [...expectedPhotoIds].sort(comparePublicPhotoIds);
    if (JSON.stringify(index.photoIds) !== JSON.stringify(expected)) throw new Error('Public semantic membership mismatch');
  }
  return index;
}
