import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadPublicPhotoCollection } from '../../src/website/public-photos.js';
import { canonicalHash, canonicalJSON, sha256, sha256File } from './hash.js';
import { embeddingCacheIdentity, semanticModelConfig, semanticModelContractSha256 } from './model-config.js';
import { comparePublicPhotoIds, createPublicSemanticIndex, verifyPublicSemanticIndex } from './index.js';
import { assertEmbedding, decodeFloat32LE, encodeFloat32LE } from './vector.js';
import { pythonEmbeddingBackend, type EmbeddingBackend } from './backend.js';

export interface PublicSemanticPhotoInput {
  publicId: string;
  thumbnailPath: string;
}

export interface SemanticBuildOptions {
  root?: string;
  cacheDirectory?: string;
  outputDirectory?: string;
  projectDirectory?: string;
  manifestFile?: string;
  photos?: readonly PublicSemanticPhotoInput[];
  embedder?: EmbeddingBackend;
}

export interface SemanticBuildResult {
  indexVersion: string;
  modelContractSha256: string;
  photos: number;
  uniqueContents: number;
  cacheHits: number;
  computed: number;
  duplicateMemberships: number;
  indexBytes: number;
  vectorBytes: number;
  durationSeconds: number;
  backendTiming?: Readonly<Record<string, number>>;
}

export interface SemanticCacheInspection {
  modelContractSha256: string;
  photos: number;
  uniqueContents: number;
  cacheHits: number;
  misses: number;
  duplicateMemberships: number;
  needsEncoder: boolean;
}

interface PreparedPhoto extends PublicSemanticPhotoInput {
  thumbnailSha256: string;
  cacheKey: string;
}

interface PreparedSemanticInputs {
  photos: PreparedPhoto[];
  representatives: Map<string, PreparedPhoto>;
  duplicateMemberships: number;
}

interface CachedSemanticVectors {
  vectors: Map<string, Float32Array>;
  misses: PreparedPhoto[];
}

interface CacheEntry {
  schemaVersion: 1;
  kind: 'siglip2-image-embedding-cache';
  cacheKey: string;
  identity: ReturnType<typeof embeddingCacheIdentity>;
  vector: { dtype: 'float32-le'; dimension: 768; normalization: 'l2'; bytes: number; sha256: string };
}

function validPublicId(value: string): boolean {
  return /^[A-Za-z0-9_-]{16}$/.test(value);
}

export function collectPublicSemanticPhotos(root: string, projectDirectory?: string, manifestFile?: string): PublicSemanticPhotoInput[] {
  const collection = loadPublicPhotoCollection({
    directory: projectDirectory ?? path.join(root, 'src/content/projects'),
    manifestFile: manifestFile ?? path.join(root, 'src/data/photo-index.json'),
  });
  return collection.listPhotos().map(photo => {
    if (!/^\/thumbnails\/[^/]+\.jpg$/.test(photo.thumbnail)) throw new Error(`Semantic input is not a public JPEG thumbnail: ${photo.publicId}`);
    return { publicId: photo.publicId, thumbnailPath: path.join(root, 'public', photo.thumbnail.slice(1)) };
  });
}

function normalizeMembership(inputs: readonly PublicSemanticPhotoInput[], root: string): { photos: PublicSemanticPhotoInput[]; duplicates: number } {
  const thumbnails = path.resolve(root, 'public/thumbnails');
  const byId = new Map<string, PublicSemanticPhotoInput>();
  let duplicates = 0;
  for (const input of inputs) {
    if (!validPublicId(input.publicId)) throw new Error(`Invalid public photo ID for semantic index: ${input.publicId}`);
    const thumbnailPath = path.resolve(input.thumbnailPath);
    if (thumbnailPath !== thumbnails && !thumbnailPath.startsWith(`${thumbnails}${path.sep}`)) throw new Error('Semantic image input must come from public/thumbnails');
    const previous = byId.get(input.publicId);
    if (previous) {
      if (path.resolve(previous.thumbnailPath) !== thumbnailPath) throw new Error(`Public semantic photo ID maps to multiple thumbnails: ${input.publicId}`);
      duplicates++;
    } else byId.set(input.publicId, { publicId: input.publicId, thumbnailPath });
  }
  return { photos: [...byId.values()].sort((a, b) => comparePublicPhotoIds(a.publicId, b.publicId)), duplicates };
}

function cachePaths(cacheDirectory: string, key: string) {
  const directory = path.join(cacheDirectory, 'embeddings', key.slice(0, 2));
  return { directory, vector: path.join(directory, `${key}.f32`), metadata: path.join(directory, `${key}.json`) };
}

async function readCachedVector(cacheDirectory: string, photo: PreparedPhoto): Promise<Float32Array | undefined> {
  const files = cachePaths(cacheDirectory, photo.cacheKey);
  try {
    const metadata = JSON.parse(await fs.readFile(files.metadata, 'utf8')) as CacheEntry;
    const expectedIdentity = embeddingCacheIdentity(photo.thumbnailSha256);
    if (metadata.schemaVersion !== 1 || metadata.kind !== 'siglip2-image-embedding-cache' || metadata.cacheKey !== photo.cacheKey ||
        canonicalJSON(metadata.identity) !== canonicalJSON(expectedIdentity) || metadata.vector.dtype !== semanticModelConfig.embedding.dtype ||
        metadata.vector.dimension !== semanticModelConfig.embedding.dimension || metadata.vector.normalization !== semanticModelConfig.embedding.normalization ||
        metadata.vector.bytes !== semanticModelConfig.embedding.dimension * Float32Array.BYTES_PER_ELEMENT || !/^[a-f0-9]{64}$/.test(metadata.vector.sha256)) return undefined;
    const bytes = await fs.readFile(files.vector);
    if (bytes.byteLength !== metadata.vector.bytes || sha256(bytes) !== metadata.vector.sha256) return undefined;
    const rows = decodeFloat32LE(bytes);
    return rows.length === 1 ? rows[0] : undefined;
  } catch {
    return undefined;
  }
}

async function writeCachedVector(cacheDirectory: string, photo: PreparedPhoto, vector: Float32Array): Promise<void> {
  assertEmbedding(vector, `embedding cache ${photo.cacheKey}`);
  const files = cachePaths(cacheDirectory, photo.cacheKey);
  await fs.mkdir(files.directory, { recursive: true });
  const bytes = encodeFloat32LE([vector]);
  const metadata: CacheEntry = {
    schemaVersion: 1,
    kind: 'siglip2-image-embedding-cache',
    cacheKey: photo.cacheKey,
    identity: embeddingCacheIdentity(photo.thumbnailSha256),
    vector: {
      dtype: semanticModelConfig.embedding.dtype,
      dimension: semanticModelConfig.embedding.dimension,
      normalization: semanticModelConfig.embedding.normalization,
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
    },
  };
  const suffix = `.pending-${process.pid}-${randomUUID()}`;
  const vectorTemporary = `${files.vector}${suffix}`;
  const metadataTemporary = `${files.metadata}${suffix}`;
  await fs.writeFile(vectorTemporary, bytes);
  await fs.rename(vectorTemporary, files.vector);
  await fs.writeFile(metadataTemporary, `${JSON.stringify(metadata, null, 2)}\n`);
  await fs.rename(metadataTemporary, files.metadata);
}

async function prepareSemanticInputs(options: SemanticBuildOptions, root: string): Promise<PreparedSemanticInputs> {
  const source = options.photos ?? collectPublicSemanticPhotos(root, options.projectDirectory, options.manifestFile);
  const normalized = normalizeMembership(source, root);
  const photos: PreparedPhoto[] = [];
  for (const photo of normalized.photos) {
    const thumbnail = await fs.lstat(photo.thumbnailPath);
    if (!thumbnail.isFile()) throw new Error(`Semantic image input must be a regular thumbnail file: ${photo.publicId}`);
    const thumbnailSha256 = await sha256File(photo.thumbnailPath);
    const identity = embeddingCacheIdentity(thumbnailSha256);
    photos.push({ ...photo, thumbnailSha256, cacheKey: canonicalHash(identity) });
  }
  const representatives = new Map<string, PreparedPhoto>();
  for (const photo of photos) if (!representatives.has(photo.cacheKey)) representatives.set(photo.cacheKey, photo);
  return { photos, representatives, duplicateMemberships: normalized.duplicates };
}

async function loadCachedSemanticVectors(cacheDirectory: string, representatives: ReadonlyMap<string, PreparedPhoto>): Promise<CachedSemanticVectors> {
  const vectors = new Map<string, Float32Array>();
  const misses: PreparedPhoto[] = [];
  for (const photo of representatives.values()) {
    const cached = await readCachedVector(cacheDirectory, photo);
    if (cached) vectors.set(photo.cacheKey, cached);
    else misses.push(photo);
  }
  return { vectors, misses };
}

export async function inspectSemanticCache(options: SemanticBuildOptions = {}): Promise<SemanticCacheInspection> {
  const root = path.resolve(options.root ?? '.');
  const cacheDirectory = path.resolve(options.cacheDirectory ?? path.join(root, '.cache/semantic'));
  const prepared = await prepareSemanticInputs(options, root);
  const cached = await loadCachedSemanticVectors(cacheDirectory, prepared.representatives);
  return {
    modelContractSha256: semanticModelContractSha256,
    photos: prepared.photos.length,
    uniqueContents: prepared.representatives.size,
    cacheHits: prepared.representatives.size - cached.misses.length,
    misses: cached.misses.length,
    duplicateMemberships: prepared.duplicateMemberships,
    needsEncoder: cached.misses.length > 0,
  };
}

async function installOutput(staging: string, destination: string): Promise<void> {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const backup = `${destination}.previous-${randomUUID()}`;
  let saved = false;
  try {
    if (await fs.lstat(destination).catch(() => null)) { await fs.rename(destination, backup); saved = true; }
    await fs.rename(staging, destination);
    if (saved) await fs.rm(backup, { recursive: true, force: true });
  } catch (error) {
    if (await fs.lstat(destination).catch(() => null)) await fs.rm(destination, { recursive: true, force: true });
    if (saved) await fs.rename(backup, destination);
    throw error;
  }
}

export async function buildSemanticIndex(options: SemanticBuildOptions = {}): Promise<SemanticBuildResult> {
  const started = performance.now();
  const root = path.resolve(options.root ?? '.');
  const cacheDirectory = path.resolve(options.cacheDirectory ?? path.join(root, '.cache/semantic'));
  const outputDirectory = path.resolve(options.outputDirectory ?? path.join(root, 'public/semantic'));
  await fs.mkdir(cacheDirectory, { recursive: true });
  const lock = path.join(cacheDirectory, 'build.lock');
  await fs.mkdir(lock).catch(() => { throw new Error('Semantic build already running; verify the writer before clearing build.lock'); });
  let staging: string | undefined;
  try {
    const prepared = await prepareSemanticInputs(options, root);
    const { vectors, misses } = await loadCachedSemanticVectors(cacheDirectory, prepared.representatives);
    let backendTiming: Readonly<Record<string, number>> | undefined;
    if (misses.length) {
      const result = await (options.embedder ?? pythonEmbeddingBackend)({
        cacheDirectory,
        items: misses.map(photo => ({ cacheKey: photo.cacheKey, thumbnail: photo.thumbnailPath })),
      });
      if (result.device !== 'cpu') throw new Error('Semantic production backend must be CPU-only');
      if (result.modelContractSha256 !== semanticModelContractSha256) throw new Error('Semantic embedding model version mismatch');
      if (result.vectors.size !== misses.length || misses.some(photo => !result.vectors.has(photo.cacheKey))) throw new Error('Semantic embedding backend returned an incomplete or unexpected vector set');
      for (const photo of misses) {
        const vector = result.vectors.get(photo.cacheKey)!;
        assertEmbedding(vector, `new embedding ${photo.cacheKey}`);
        await writeCachedVector(cacheDirectory, photo, vector);
        vectors.set(photo.cacheKey, vector);
      }
      backendTiming = result.timing;
    }
    const orderedVectors = prepared.photos.map(photo => {
      const vector = vectors.get(photo.cacheKey);
      if (!vector) throw new Error(`Missing semantic vector for ${photo.publicId}`);
      return vector;
    });
    const vectorData = encodeFloat32LE(orderedVectors);
    const index = createPublicSemanticIndex(prepared.photos.map(photo => photo.publicId), vectorData.byteLength, sha256(vectorData));
    staging = await fs.mkdtemp(path.join(cacheDirectory, 'public-output-'));
    await fs.writeFile(path.join(staging, semanticModelConfig.index.vectorFile), vectorData);
    await fs.writeFile(path.join(staging, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
    await verifyPublicSemanticIndex(staging, prepared.photos.map(photo => photo.publicId));
    await installOutput(staging, outputDirectory); staging = undefined;
    const result: SemanticBuildResult = {
      indexVersion: index.indexVersion,
      modelContractSha256: semanticModelContractSha256,
      photos: prepared.photos.length,
      uniqueContents: prepared.representatives.size,
      cacheHits: prepared.representatives.size - misses.length,
      computed: misses.length,
      duplicateMemberships: prepared.duplicateMemberships,
      indexBytes: Buffer.byteLength(JSON.stringify(index, null, 2) + '\n'),
      vectorBytes: vectorData.byteLength,
      durationSeconds: (performance.now() - started) / 1000,
      ...(backendTiming ? { backendTiming } : {}),
    };
    await fs.writeFile(path.join(cacheDirectory, 'last-build.json'), `${JSON.stringify(result, null, 2)}\n`);
    return result;
  } finally {
    if (staging) await fs.rm(staging, { recursive: true, force: true });
    await fs.rm(lock, { recursive: true, force: true });
  }
}
