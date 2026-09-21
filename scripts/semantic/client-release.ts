import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createBrotliDecompress } from 'node:zlib';
import { PassThrough, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import {
  canonicalJSON,
  manifestBundleRecord,
  parseClientModelConfig,
  parseClientReleaseManifest,
  type ClientReleaseFile,
  type ClientReleasePart,
  type ClientSemanticReleaseManifest,
} from '../../src/semantic-search/contracts.js';
import {
  CLIENT_SEMANTIC_RELEASE_BUNDLE_SHA256,
  CLIENT_SEMANTIC_RELEASE_FILES,
  CLIENT_SEMANTIC_RELEASE_ID,
  CLIENT_SEMANTIC_RELEASE_MANIFEST_SHA256,
  CLIENT_SEMANTIC_RELEASE_ROOT,
  CLIENT_SEMANTIC_RUNTIME_FILES,
  CLIENT_SEMANTIC_RUNTIME_ID,
  CLIENT_SEMANTIC_RUNTIME_MANIFEST_SHA256,
  CLIENT_SEMANTIC_RUNTIME_ROOT,
} from '../../src/semantic-search/release-contract.js';
import { sha256 } from './hash.js';
import { publicSemanticModel, semanticModelConfig, semanticModelContractSha256 } from './model-config.js';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
export const clientSemanticReleaseDirectory = path.join(repositoryRoot, 'semantic-releases', CLIENT_SEMANTIC_RELEASE_ID);
export const clientSemanticRuntimeDirectory = path.join(repositoryRoot, 'semantic-runtimes', CLIENT_SEMANTIC_RUNTIME_ID);

let verifiedRelease: Promise<ClientSemanticReleaseManifest> | undefined;
let verifiedRuntime: Promise<ClientSemanticRuntimeManifest> | undefined;

export interface ClientSemanticRuntimeManifest {
  schemaVersion: 1;
  kind: 'jason-gallery-client-semantic-runtime';
  runtimeId: string;
  onnxRuntimeWebVersion: string;
  wasmVariant: 'simd-threaded-asyncify';
  files: Array<Omit<ClientReleasePart, 'offset'> & { mediaType: 'application/wasm' | 'text/javascript' }>;
}

async function verifyPayloadPart(directory: string, descriptor: ClientReleasePart, payloadHash: ReturnType<typeof createHash>): Promise<number> {
  const filename = path.join(directory, descriptor.path);
  const stat = await fs.lstat(filename);
  if (stat.size > 25 * 1024 * 1024) throw new Error(`Semantic release transport part exceeds the Pages asset limit: ${descriptor.path}`);
  if (!stat.isFile() || stat.size !== descriptor.transportBytes) throw new Error(`Semantic release transport size mismatch: ${descriptor.path}`);
  const transportHash = createHash('sha256');
  const partPayloadHash = createHash('sha256');
  let transportBytes = 0;
  let partPayloadBytes = 0;
  const input = createReadStream(filename);
  input.on('data', chunk => { transportHash.update(chunk); transportBytes += chunk.length; });
  const decoder = descriptor.contentEncoding === 'br' ? createBrotliDecompress() : new PassThrough();
  decoder.on('data', chunk => {
    partPayloadHash.update(chunk);
    payloadHash.update(chunk);
    partPayloadBytes += chunk.length;
  });
  await pipeline(input, decoder, new Writable({ write(_chunk, _encoding, callback) { callback(); } }));
  if (transportBytes !== descriptor.transportBytes || transportHash.digest('hex') !== descriptor.transportSha256) throw new Error(`Semantic release transport digest mismatch: ${descriptor.path}`);
  if (partPayloadBytes !== descriptor.bytes || partPayloadHash.digest('hex') !== descriptor.sha256) throw new Error(`Semantic release part payload digest mismatch: ${descriptor.path}`);
  return partPayloadBytes;
}

async function verifyPayloadFile(directory: string, descriptor: ClientReleaseFile): Promise<void> {
  const payloadHash = createHash('sha256');
  let payloadBytes = 0;
  for (const part of descriptor.parts) payloadBytes += await verifyPayloadPart(directory, part, payloadHash);
  if (payloadBytes !== descriptor.bytes || payloadHash.digest('hex') !== descriptor.sha256) throw new Error(`Semantic release payload digest mismatch: ${descriptor.path}`);
}

async function decodedPart(directory: string, descriptor: ClientReleasePart): Promise<Buffer> {
  const compressed = await fs.readFile(path.join(directory, descriptor.path));
  return descriptor.contentEncoding === 'br'
    ? await new Promise<Buffer>((resolve, reject) => {
      const source = new PassThrough();
      const chunks: Buffer[] = [];
      const decoder = createBrotliDecompress();
      decoder.on('data', chunk => chunks.push(Buffer.from(chunk)));
      decoder.once('end', () => resolve(Buffer.concat(chunks)));
      decoder.once('error', reject);
      source.end(compressed); source.pipe(decoder);
    })
    : compressed;
}

async function decodedJSON(directory: string, descriptor: ClientReleaseFile): Promise<unknown> {
  const bytes = Buffer.concat(await Promise.all(descriptor.parts.map(part => decodedPart(directory, part))));
  return JSON.parse(bytes.toString('utf8'));
}

async function verifyRuntime(): Promise<ClientSemanticRuntimeManifest> {
  const entries = (await fs.readdir(clientSemanticRuntimeDirectory, { withFileTypes: true })).map(entry => {
    if (!entry.isFile()) throw new Error('Semantic runtime cannot contain directories or links');
    return entry.name;
  }).sort();
  if (JSON.stringify(entries) !== JSON.stringify([...CLIENT_SEMANTIC_RUNTIME_FILES].sort())) throw new Error('Semantic runtime file set is not exact');
  const manifestBytes = await fs.readFile(path.join(clientSemanticRuntimeDirectory, 'manifest.json'));
  if (sha256(manifestBytes) !== CLIENT_SEMANTIC_RUNTIME_MANIFEST_SHA256) throw new Error('Semantic runtime manifest digest mismatch');
  const manifest = JSON.parse(manifestBytes.toString('utf8')) as ClientSemanticRuntimeManifest;
  const files = manifest?.files;
  const moduleFile = files?.find(file => file.path === 'ort-wasm-simd-threaded.asyncify.mjs');
  const wasmFile = files?.find(file => file.path === 'ort-wasm-simd-threaded.asyncify.wasm.br');
  if (manifest.schemaVersion !== 1 || manifest.kind !== 'jason-gallery-client-semantic-runtime' || manifest.runtimeId !== CLIENT_SEMANTIC_RUNTIME_ID ||
      manifest.onnxRuntimeWebVersion !== '1.30.0' || manifest.wasmVariant !== 'simd-threaded-asyncify' ||
      files?.length !== 2 || !moduleFile || moduleFile.mediaType !== 'text/javascript' || moduleFile.contentEncoding !== null ||
      moduleFile.bytes !== 53_057 || moduleFile.sha256 !== '3d1c85995364bb643302fc6fd877a0c3ba5ae72401815e0f24828a53d9191e28' ||
      moduleFile.transportBytes !== 53_057 || moduleFile.transportSha256 !== moduleFile.sha256 ||
      !wasmFile || wasmFile.mediaType !== 'application/wasm' || wasmFile.contentEncoding !== 'br' ||
      wasmFile.bytes !== 26_781_914 || wasmFile.sha256 !== '39f9f0894d478800487ed9f7dbe92618498db320cf55c8e3d89adff8dce658da' ||
      wasmFile.transportBytes !== 3_866_678 || wasmFile.transportSha256 !== '2d2e9cb00f2ac27534ba38313060b841c64e03187329fbc9954f2fba8918a7bc') {
    throw new Error('Semantic runtime manifest contract mismatch');
  }
  for (const file of files) {
    const payloadHash = createHash('sha256');
    const bytes = await verifyPayloadPart(clientSemanticRuntimeDirectory, { ...file, offset: 0 }, payloadHash);
    if (bytes !== file.bytes || payloadHash.digest('hex') !== file.sha256) throw new Error(`Semantic runtime payload digest mismatch: ${file.path}`);
  }
  return manifest;
}

export function verifyClientSemanticRuntime(): Promise<ClientSemanticRuntimeManifest> {
  return verifiedRuntime ??= verifyRuntime().catch(error => { verifiedRuntime = undefined; throw error; });
}

async function verifyRelease(): Promise<ClientSemanticReleaseManifest> {
  const entries = (await fs.readdir(clientSemanticReleaseDirectory, { withFileTypes: true })).map(entry => {
    if (!entry.isFile()) throw new Error('Semantic release cannot contain directories or links');
    return entry.name;
  }).sort();
  const expected = [...CLIENT_SEMANTIC_RELEASE_FILES].sort();
  if (JSON.stringify(entries) !== JSON.stringify(expected)) throw new Error('Semantic release file set is not indivisible/exact');
  const manifestBytes = await fs.readFile(path.join(clientSemanticReleaseDirectory, 'manifest.json'));
  if (sha256(manifestBytes) !== CLIENT_SEMANTIC_RELEASE_MANIFEST_SHA256) throw new Error('Semantic release manifest digest mismatch');
  const manifest = parseClientReleaseManifest(JSON.parse(manifestBytes.toString('utf8')));
  const manifestFiles = manifest.files.flatMap(file => file.parts.map(part => part.path)).sort();
  const contractFiles = CLIENT_SEMANTIC_RELEASE_FILES.filter(filename => filename !== 'manifest.json').sort();
  if (JSON.stringify(manifestFiles) !== JSON.stringify(contractFiles)) throw new Error('Semantic release manifest/transport file set mismatch');
  if (manifest.releaseId !== CLIENT_SEMANTIC_RELEASE_ID || manifest.bundleSha256 !== CLIENT_SEMANTIC_RELEASE_BUNDLE_SHA256 ||
      sha256(canonicalJSON(manifestBundleRecord(manifest))) !== manifest.bundleSha256) throw new Error('Semantic release bundle identity mismatch');
  if (manifest.model.id !== semanticModelConfig.imageModel.id || manifest.model.revision !== semanticModelConfig.imageModel.revision ||
      manifest.model.semanticModelContractSha256 !== semanticModelContractSha256 ||
      manifest.model.clientModelContractSha256 !== semanticModelConfig.clientModelRelease.releaseSha256 ||
      manifest.model.publicModelSha256 !== sha256(canonicalJSON(publicSemanticModel)) ||
      manifest.model.embeddingSpace !== semanticModelConfig.embedding.space || manifest.model.embeddingDimension !== semanticModelConfig.embedding.dimension) {
    throw new Error('Semantic client release is incompatible with the Phase 2B image/index model');
  }
  const packageJSON = JSON.parse(await fs.readFile(path.join(repositoryRoot, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> };
  if (packageJSON.dependencies?.['onnxruntime-web'] !== manifest.runtime.onnxRuntimeWebVersion || packageJSON.dependencies?.['@huggingface/tokenizers'] !== manifest.runtime.tokenizerVersion) {
    throw new Error('Semantic runtime dependency/release mismatch');
  }
  const runtimeRelease = await verifyClientSemanticRuntime();
  if (runtimeRelease.onnxRuntimeWebVersion !== manifest.runtime.onnxRuntimeWebVersion) throw new Error('Semantic model/runtime release mismatch');
  const byRole = new Map(manifest.files.map(file => [file.role, file]));
  if (byRole.get('onnx')?.sha256 !== semanticModelConfig.clientModelRelease.onnx.sha256 ||
      byRole.get('tokenizer')?.sha256 !== semanticModelConfig.clientModelRelease.tokenizer.sha256) throw new Error('Phase 2B client payload digest mismatch');
  await Promise.all(manifest.files.map(file => verifyPayloadFile(clientSemanticReleaseDirectory, file)));
  const modelConfig = parseClientModelConfig(await decodedJSON(clientSemanticReleaseDirectory, byRole.get('model-config')!));
  if (modelConfig.modelId !== manifest.model.id || modelConfig.revision !== manifest.model.revision || modelConfig.embeddingDimension !== manifest.model.embeddingDimension) {
    throw new Error('Semantic model config/release mismatch');
  }
  const tokenizer = await decodedJSON(clientSemanticReleaseDirectory, byRole.get('tokenizer')!) as { model?: { vocab?: Record<string, number> }; padding?: { strategy?: { Fixed?: number }; pad_id?: number } };
  if (Object.keys(tokenizer.model?.vocab ?? {}).length !== semanticModelConfig.clientModelRelease.tokenizer.vocabularySize || tokenizer.padding?.strategy?.Fixed !== modelConfig.maximumTokens || tokenizer.padding.pad_id !== modelConfig.paddingTokenId) {
    throw new Error('Semantic tokenizer vocabulary/config mismatch');
  }
  const tokenizerConfig = await decodedJSON(clientSemanticReleaseDirectory, byRole.get('tokenizer-config')!) as { model_max_length?: number; eos_token?: string; pad_token?: string };
  if (typeof tokenizerConfig.model_max_length !== 'number' || tokenizerConfig.model_max_length < modelConfig.maximumTokens || tokenizerConfig.eos_token !== '<eos>' || tokenizerConfig.pad_token !== '<pad>') throw new Error('Semantic tokenizer runtime config mismatch');
  return manifest;
}

export function verifyClientSemanticRelease(): Promise<ClientSemanticReleaseManifest> {
  return verifiedRelease ??= verifyRelease().catch(error => { verifiedRelease = undefined; throw error; });
}

async function linkOrCopy(source: string, destination: string): Promise<void> {
  await fs.link(source, destination).catch(async error => {
    if (!['EXDEV', 'EPERM', 'EACCES'].includes(error.code)) throw error;
    await fs.copyFile(source, destination);
  });
}

export async function installClientSemanticRelease(outputDirectory: string): Promise<ClientSemanticReleaseManifest> {
  const manifest = await verifyClientSemanticRelease();
  await verifyClientSemanticRuntime();
  const modelRoot = path.join(outputDirectory, CLIENT_SEMANTIC_RELEASE_ROOT.slice(1));
  const runtimeRoot = path.join(outputDirectory, CLIENT_SEMANTIC_RUNTIME_ROOT.slice(1));
  await fs.rm(path.join(outputDirectory, 'semantic-models'), { recursive: true, force: true });
  await fs.rm(path.join(outputDirectory, 'semantic-runtimes'), { recursive: true, force: true });
  await fs.mkdir(modelRoot, { recursive: true });
  await fs.mkdir(runtimeRoot, { recursive: true });
  for (const filename of CLIENT_SEMANTIC_RELEASE_FILES) await linkOrCopy(path.join(clientSemanticReleaseDirectory, filename), path.join(modelRoot, filename));
  for (const filename of CLIENT_SEMANTIC_RUNTIME_FILES) await linkOrCopy(path.join(clientSemanticRuntimeDirectory, filename), path.join(runtimeRoot, filename));
  return manifest;
}

export function clientSemanticReleaseHeaders(): string {
  const root = CLIENT_SEMANTIC_RELEASE_ROOT;
  const encodedFiles = CLIENT_SEMANTIC_RELEASE_FILES.filter(filename => filename.endsWith('.br')).map(filename =>
    `${root}/${filename}\n  Content-Type: ${filename.includes('.json') ? 'application/json; charset=utf-8' : 'application/octet-stream'}\n  Content-Encoding: br`,
  );
  return [
    `${root}/*\n  Cache-Control: public, max-age=31536000, immutable\n  Cross-Origin-Resource-Policy: same-origin\n  X-Content-Type-Options: nosniff`,
    ...encodedFiles,
    `${CLIENT_SEMANTIC_RUNTIME_ROOT}/*\n  Cache-Control: public, max-age=31536000, immutable\n  Cross-Origin-Resource-Policy: same-origin\n  X-Content-Type-Options: nosniff`,
    `${CLIENT_SEMANTIC_RUNTIME_ROOT}/ort-wasm-simd-threaded.asyncify.mjs\n  Content-Type: text/javascript; charset=utf-8`,
    `${CLIENT_SEMANTIC_RUNTIME_ROOT}/ort-wasm-simd-threaded.asyncify.wasm.br\n  Content-Type: application/wasm\n  Content-Encoding: br`,
  ].join('\n\n') + '\n';
}
