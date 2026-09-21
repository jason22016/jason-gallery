import {
  assertExpectedPublicPhotoIds,
  canonicalJSON,
  decodeAndValidateVectors,
  indexVersionRecord,
  manifestBundleRecord,
  parseClientReleaseManifest,
  parseSemanticIndex,
  type ClientSemanticIndex,
  type ClientSemanticReleaseManifest,
} from './contracts';
import { SemanticSearchError } from './errors';
import { responseBytes, sha256 } from './hash';
import {
  CLIENT_SEMANTIC_RELEASE_BUNDLE_SHA256,
  CLIENT_SEMANTIC_RELEASE_ID,
  CLIENT_SEMANTIC_RELEASE_MANIFEST_SHA256,
} from './release-contract';

export interface LoadedSemanticIndex {
  index: ClientSemanticIndex;
  vectors: Float32Array;
}

export async function loadClientReleaseManifest(fetcher: typeof fetch, manifestURL: URL, signal: AbortSignal): Promise<ClientSemanticReleaseManifest> {
  const response = await fetcher(manifestURL, { cache: 'no-cache', credentials: 'same-origin', signal });
  if (!response.ok) throw new SemanticSearchError('RELEASE_UNAVAILABLE', `Semantic release manifest request failed with HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength < 1 || bytes.byteLength > 64 * 1024 || await sha256(bytes) !== CLIENT_SEMANTIC_RELEASE_MANIFEST_SHA256) {
    throw new SemanticSearchError('RELEASE_INTEGRITY', 'Semantic release manifest failed integrity verification');
  }
  let manifest: ClientSemanticReleaseManifest;
  try {
    manifest = parseClientReleaseManifest(JSON.parse(new TextDecoder().decode(bytes)));
  } catch (error) {
    throw new SemanticSearchError('RELEASE_INTEGRITY', 'Semantic release manifest is malformed', { cause: error });
  }
  if (manifest.releaseId !== CLIENT_SEMANTIC_RELEASE_ID || manifest.bundleSha256 !== CLIENT_SEMANTIC_RELEASE_BUNDLE_SHA256 ||
      await sha256(canonicalJSON(manifestBundleRecord(manifest))) !== manifest.bundleSha256) {
    throw new SemanticSearchError('UPDATE_REQUIRED', 'The site runtime and semantic model release do not match', { recoverable: false });
  }
  return manifest;
}

export async function loadSemanticIndex(
  fetcher: typeof fetch,
  indexURL: URL,
  manifest: ClientSemanticReleaseManifest,
  signal: AbortSignal,
  expectedPhotoIds?: readonly string[],
): Promise<LoadedSemanticIndex> {
  const response = await fetcher(indexURL, { cache: 'no-cache', credentials: 'same-origin', signal });
  if (!response.ok) throw new SemanticSearchError('INDEX_UNAVAILABLE', `Semantic index request failed with HTTP ${response.status}`);
  const indexBytes = await response.arrayBuffer();
  if (indexBytes.byteLength < 1 || indexBytes.byteLength > 2 * 1024 * 1024) throw new SemanticSearchError('INDEX_INTEGRITY', 'Semantic index manifest byte length is invalid');
  let raw: unknown;
  try { raw = JSON.parse(new TextDecoder().decode(indexBytes)); }
  catch (error) { throw new SemanticSearchError('INDEX_INTEGRITY', 'Semantic index manifest is not valid JSON', { cause: error }); }
  const header = raw as { schemaVersion?: unknown; kind?: unknown } | null;
  if (!header || header.schemaVersion !== manifest.compatibleIndex.schemaVersion || header.kind !== manifest.compatibleIndex.kind) {
    throw new SemanticSearchError('UPDATE_REQUIRED', 'The semantic index schema is not supported by this runtime', { recoverable: false });
  }
  let index: ClientSemanticIndex;
  try { index = parseSemanticIndex(raw); }
  catch (error) { throw new SemanticSearchError('INDEX_INTEGRITY', 'Semantic index manifest failed schema validation', { cause: error }); }
  if (await sha256(canonicalJSON(indexVersionRecord(index))) !== index.indexVersion) throw new SemanticSearchError('INDEX_INTEGRITY', 'Semantic index version digest mismatch');
  if (await sha256(canonicalJSON(index.model)) !== manifest.model.publicModelSha256) {
    throw new SemanticSearchError('UPDATE_REQUIRED', 'The semantic text model is incompatible with the current image index', { recoverable: false });
  }
  if (index.ordering !== manifest.compatibleIndex.ordering || index.vectors.file !== manifest.compatibleIndex.vectorFile ||
      index.vectors.dtype !== manifest.compatibleIndex.dtype || index.vectors.normalization !== manifest.compatibleIndex.normalization ||
      index.vectors.dimension !== manifest.model.embeddingDimension) {
    throw new SemanticSearchError('UPDATE_REQUIRED', 'The semantic vector format is incompatible with this runtime', { recoverable: false });
  }
  if (expectedPhotoIds) {
    try { assertExpectedPublicPhotoIds(index.photoIds, expectedPhotoIds); }
    catch (error) { throw new SemanticSearchError('INDEX_INTEGRITY', 'Semantic index/public photo mapping mismatch', { cause: error }); }
  }
  const vectorURL = new URL(index.vectors.file, indexURL);
  const vectorResponse = await fetcher(vectorURL, { cache: 'no-cache', credentials: 'same-origin', signal });
  let buffer: ArrayBuffer;
  try { buffer = await responseBytes(vectorResponse, index.vectors.bytes); }
  catch (error) { throw new SemanticSearchError('INDEX_UNAVAILABLE', 'Semantic vector download failed', { cause: error }); }
  if (await sha256(buffer) !== index.vectors.sha256) throw new SemanticSearchError('INDEX_INTEGRITY', 'Semantic vector SHA-256 mismatch');
  try {
    return { index, vectors: decodeAndValidateVectors(buffer, index) };
  } catch (error) {
    throw new SemanticSearchError('INDEX_INTEGRITY', 'Semantic vectors violate the finite/unit-vector contract', { cause: error });
  }
}
