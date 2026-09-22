import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildSemanticIndex, inspectSemanticCache, type PublicSemanticPhotoInput } from '../../scripts/semantic/build.js';
import { verifyPublicSemanticIndex } from '../../scripts/semantic/index.js';
import { embeddingCacheIdentity, semanticModelConfig, semanticModelContractSha256 } from '../../scripts/semantic/model-config.js';
import { assertEmbedding, decodeFloat32LE } from '../../scripts/semantic/vector.js';
import { canonicalHash } from '../../scripts/semantic/hash.js';
import { deterministicVector, fakeEmbeddingBackend, type FakeEmbeddingCalls } from './fake.js';

const root = path.resolve('.cache/semantic-pipeline-test');
const cacheDirectory = path.join(root, '.cache/semantic');
const outputDirectory = path.join(root, 'public/semantic');
const thumbnails = path.join(root, 'public/thumbnails');
const ids = ['zzzzzzzzzzzzzzzz', 'AAAAAAAAAAAAAAAA', 'mmmmmmmmmmmmmmmm'];

async function write(name: string, value: string) {
  const file = path.join(thumbnails, `${name}.jpg`);
  await fs.writeFile(file, value);
  return file;
}

test('formal model release binds the image space, tokenizer and ONNX as one validated contract', () => {
  assert.equal(semanticModelConfig.imageModel.id, semanticModelConfig.clientModelRelease.modelId);
  assert.equal(semanticModelConfig.imageModel.revision, semanticModelConfig.clientModelRelease.revision);
  assert.equal(semanticModelConfig.clientModelRelease.indivisible, true);
  assert.equal(semanticModelConfig.clientModelRelease.tokenizer.vocabularySize, 65536);
  assert.equal(semanticModelConfig.clientModelRelease.onnx.transformerQuantization, 'asymmetric-uint4-block-32');
  assert.equal(semanticModelConfig.clientModelRelease.onnx.tokenEmbedding, 'int8');
  assert.equal(semanticModelConfig.clientModelRelease.onnx.projectionHeadDtype, 'float32');
  assert.equal(semanticModelConfig.clientModelRelease.onnx.layerNormDtype, 'float32');
  assert.equal(semanticModelConfig.clientModelRelease.onnx.activationDtype, 'float32');
  assert.equal(semanticModelConfig.embedding.dimension, 768);
  assert.match(semanticModelContractSha256, /^[a-f0-9]{64}$/);
  const identity = embeddingCacheIdentity('a'.repeat(64));
  assert.deepEqual(Object.keys(identity).sort(), ['embeddingSchemaVersion', 'imageModelId', 'imageModelRevision', 'preprocessingVersion', 'thumbnailSha256']);
  assert.notEqual(canonicalHash(identity), canonicalHash(embeddingCacheIdentity('b'.repeat(64))));
});

test('incremental cache, public membership, ordering, privacy and CPU fail-fast contracts', { timeout: 60_000 }, async () => {
  await fs.rm(root, { recursive: true, force: true });
  await fs.mkdir(thumbnails, { recursive: true });
  const a = await write('a', 'thumbnail-a-v1');
  const b = await write('b', 'thumbnail-b-v1');
  const c = await write('c', 'thumbnail-c-v1');
  let photos: Array<PublicSemanticPhotoInput & { internalId?: string; caption?: string; project?: string; tags?: string[] }> = [
    { publicId: ids[0]!, thumbnailPath: a, internalId: 'PRIVATE-SOURCE-ID-A', caption: 'PRIVATE CAPTION A', project: 'published-one', tags: ['old-tag'] },
    { publicId: ids[1]!, thumbnailPath: b, internalId: 'PRIVATE-SOURCE-ID-B', caption: 'PRIVATE CAPTION B', project: 'published-one', tags: ['old-tag'] },
  ];
  const calls: FakeEmbeddingCalls = { batches: 0, items: 0, keys: [] };
  const embedder = fakeEmbeddingBackend(calls);
  const build = () => buildSemanticIndex({ root, cacheDirectory, outputDirectory, photos, embedder });
  const inspect = () => inspectSemanticCache({ root, cacheDirectory, photos });

  const coldPlan = await inspect();
  assert.equal(coldPlan.photos, 2); assert.equal(coldPlan.cacheHits, 0); assert.equal(coldPlan.misses, 2); assert.equal(coldPlan.needsEncoder, true); assert.equal(calls.items, 0, 'cache inspection must not invoke the embedder');
  const cold = await build();
  assert.equal(cold.photos, 2); assert.equal(cold.computed, 2); assert.equal(cold.cacheHits, 0); assert.equal(calls.items, 2);
  const warmPlan = await inspect();
  assert.equal(warmPlan.cacheHits, 2); assert.equal(warmPlan.misses, 0); assert.equal(warmPlan.needsEncoder, false); assert.equal(calls.items, 2, 'warm cache inspection must not invoke the embedder');
  const warm = await build();
  assert.equal(warm.computed, 0); assert.equal(warm.cacheHits, 2); assert.equal(calls.items, 2, 'second run must be all cache hits');

  photos = [...photos, { publicId: ids[2]!, thumbnailPath: c, internalId: 'PRIVATE-SOURCE-ID-C', caption: 'PRIVATE CAPTION C', project: 'published-two' }];
  const addedPlan = await inspect();
  assert.equal(addedPlan.cacheHits, 2); assert.equal(addedPlan.misses, 1); assert.equal(addedPlan.needsEncoder, true);
  const added = await build();
  assert.equal(added.computed, 1); assert.equal(added.cacheHits, 2); assert.equal(calls.items, 3, 'only the new photo is embedded');

  await fs.writeFile(a, 'thumbnail-a-v2');
  const changedPlan = await inspect();
  assert.equal(changedPlan.cacheHits, 2); assert.equal(changedPlan.misses, 1); assert.equal(changedPlan.needsEncoder, true);
  const changed = await build();
  assert.equal(changed.computed, 1); assert.equal(changed.cacheHits, 2); assert.equal(calls.items, 4, 'only the changed thumbnail is embedded');

  photos = photos.map(photo => ({ ...photo, caption: `edited ${photo.caption}`, project: 'renamed-project', tags: ['edited-tag'] }));
  const editorialPlan = await inspect();
  assert.equal(editorialPlan.misses, 0); assert.equal(editorialPlan.needsEncoder, false);
  const editorial = await build();
  assert.equal(editorial.computed, 0); assert.equal(calls.items, 4, 'Project/caption/tag edits must not invalidate image vectors');
  assert.equal(editorial.indexVersion, changed.indexVersion, 'editorial-only changes do not alter the image index');

  const published = [...photos];
  photos = photos.filter(photo => photo.publicId !== ids[1]);
  const drafted = await build();
  assert.equal(drafted.photos, 2); assert.equal(drafted.computed, 0, 'published to draft only changes index membership');
  assert.notEqual(drafted.indexVersion, editorial.indexVersion);
  assert.deepEqual((await verifyPublicSemanticIndex(outputDirectory)).photoIds, [ids[2]!, ids[0]!].sort());
  photos = published;
  const republished = await build();
  assert.equal(republished.photos, 3); assert.equal(republished.computed, 0, 'draft to published reuses the retained content cache');

  photos = [...published, { ...published[0]!, project: 'second-project', caption: 'different shared caption' }];
  const shared = await build();
  assert.equal(shared.photos, 3); assert.equal(shared.duplicateMemberships, 1); assert.equal(shared.computed, 0, 'one photo shared by projects has one public vector row');
  const index = await verifyPublicSemanticIndex(outputDirectory, ids);
  assert.deepEqual(index.photoIds, [...ids].sort(), 'photo ID to vector ordering is deterministic');
  const vectors = decodeFloat32LE(await fs.readFile(path.join(outputDirectory, 'vectors.f32')));
  assert.equal(vectors.length, 3);
  vectors.forEach((vector, position) => assertEmbedding(vector, `row ${position}`));

  const publicJSON = await fs.readFile(path.join(outputDirectory, 'index.json'), 'utf8');
  for (const secret of ['PRIVATE-SOURCE-ID', 'PRIVATE CAPTION', 'renamed-project', 'thumbnailSha256', '/thumbnails/', 'internalId']) assert(!publicJSON.includes(secret), secret);
  assert.deepEqual((await fs.readdir(outputDirectory)).sort(), ['index.json', 'vectors.f32']);
  const cacheJSON = (await fs.readdir(path.join(cacheDirectory, 'embeddings'), { recursive: true })).find(name => String(name).endsWith('.json'));
  assert(cacheJSON, 'non-public cache metadata must exist');

  const preserved = index.indexVersion;
  const newFile = await write('new', 'new-thumbnail-for-mismatch');
  photos = [...published, { publicId: 'NNNNNNNNNNNNNNNN', thumbnailPath: newFile }];
  await assert.rejects(buildSemanticIndex({ root, cacheDirectory, outputDirectory, photos, embedder: fakeEmbeddingBackend(undefined, { modelContractSha256: '0'.repeat(64) }) }), /model version mismatch/);
  assert.equal((await verifyPublicSemanticIndex(outputDirectory)).indexVersion, preserved, 'failed generation preserves preceding public index');
  await assert.rejects(buildSemanticIndex({ root, cacheDirectory, outputDirectory, photos, embedder: fakeEmbeddingBackend(undefined, { device: 'cpu-gpu' as 'cpu' }) }), /CPU-only/);

  const malformed = deterministicVector('a'.repeat(64)); malformed[0] = Number.NaN;
  assert.throws(() => assertEmbedding(malformed), /non-finite/);
  assert.throws(() => assertEmbedding(new Float32Array(2)), /dimension mismatch/);
  const notUnit = deterministicVector('b'.repeat(64)); notUnit.fill(0);
  assert.throws(() => assertEmbedding(notUnit), /not L2 normalized/);

  const descriptor = JSON.parse(await fs.readFile(path.join(outputDirectory, 'index.json'), 'utf8'));
  descriptor.schemaVersion = 99;
  await fs.writeFile(path.join(outputDirectory, 'index.json'), JSON.stringify(descriptor));
  await assert.rejects(verifyPublicSemanticIndex(outputDirectory), /schema\/version mismatch/);
});
