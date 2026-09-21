import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { canonicalHash, canonicalJSON } from './hash.js';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const fileDigest = z.strictObject({ file: z.string().min(1), sha256: digest });
const ModelConfigSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('jason-gallery-semantic-model'),
  imageModel: z.strictObject({
    id: z.literal('google/siglip2-base-patch16-224'),
    revision: z.literal('75de2d55ec2d0b4efc50b3e9ad70dba96a7b2fa2'),
    config: fileDigest,
    weights: fileDigest,
  }),
  preprocessing: z.strictObject({
    version: z.literal('siglip2-thumbnail-official-v1'),
    source: z.literal('pinned-hugging-face-image-processor'),
    config: fileDigest,
    input: z.literal('public-thumbnail-jpeg'),
    steps: z.tuple([
      z.literal('pillow-exif-transpose'),
      z.literal('convert-rgb'),
      z.literal('resize-224x224-bilinear'),
      z.literal('rescale-1-over-255'),
      z.literal('normalize-mean-0.5-std-0.5'),
    ]),
  }),
  embedding: z.strictObject({
    schemaVersion: z.literal(1),
    dimension: z.literal(768),
    dtype: z.literal('float32-le'),
    normalization: z.literal('l2'),
    space: z.literal('siglip2-base-patch16-224-shared'),
  }),
  clientModelRelease: z.strictObject({
    schemaVersion: z.literal(1),
    id: z.literal('siglip2-base-v64k-uint4-b32-r1'),
    modelId: z.literal('google/siglip2-base-patch16-224'),
    revision: z.literal('75de2d55ec2d0b4efc50b3e9ad70dba96a7b2fa2'),
    indivisible: z.literal(true),
    tokenizer: z.strictObject({ file: z.literal('tokenizer.json'), vocabularySize: z.literal(65536), sha256: digest }),
    onnx: z.strictObject({
      file: z.literal('model.onnx'),
      opset: z.literal(17),
      transformerQuantization: z.literal('asymmetric-uint4-block-32'),
      tokenEmbedding: z.literal('int8'),
      projectionHeadDtype: z.literal('float32'),
      layerNormDtype: z.literal('float32'),
      activationDtype: z.literal('float32'),
      sha256: digest,
    }),
    transportEncoding: z.literal('br'),
    releaseSha256: digest,
  }),
  index: z.strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal('jason-gallery-public-semantic-index'),
    ordering: z.literal('public-photo-id-bytewise-ascending'),
    vectorFile: z.literal('vectors.f32'),
  }),
});

export type SemanticModelConfig = z.infer<typeof ModelConfigSchema>;
export const semanticModelConfigFile = fileURLToPath(new URL('./model.json', import.meta.url));

function freezeDeep<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

function loadModelConfig(): Readonly<SemanticModelConfig> {
  const parsed = ModelConfigSchema.parse(JSON.parse(fs.readFileSync(semanticModelConfigFile, 'utf8')));
  const { releaseSha256, ...release } = parsed.clientModelRelease;
  if (canonicalHash(release) !== releaseSha256) throw new Error('Semantic client release contract/hash mismatch');
  if (release.modelId !== parsed.imageModel.id || release.revision !== parsed.imageModel.revision) {
    throw new Error('Semantic image and client model releases are not in the same shared embedding space');
  }
  return freezeDeep(parsed);
}

export const semanticModelConfig = loadModelConfig();
export const semanticModelContractSha256 = canonicalHash(semanticModelConfig);

/** This exact public projection is the Phase 3 image/text alignment contract. */
export const publicSemanticModel = freezeDeep({
  imageModel: {
    id: semanticModelConfig.imageModel.id,
    revision: semanticModelConfig.imageModel.revision,
  },
  preprocessingVersion: semanticModelConfig.preprocessing.version,
  embedding: semanticModelConfig.embedding,
  clientModelRelease: semanticModelConfig.clientModelRelease,
});

export function assertCurrentSemanticModel(value: unknown): asserts value is typeof publicSemanticModel {
  if (canonicalJSON(value) !== canonicalJSON(publicSemanticModel)) throw new Error('Semantic model/index version mismatch');
}

export interface EmbeddingCacheIdentity {
  thumbnailSha256: string;
  imageModelId: string;
  imageModelRevision: string;
  preprocessingVersion: string;
  embeddingSchemaVersion: number;
}

export function embeddingCacheIdentity(thumbnailSha256: string): EmbeddingCacheIdentity {
  if (!/^[a-f0-9]{64}$/.test(thumbnailSha256)) throw new Error('Invalid thumbnail content hash');
  return {
    thumbnailSha256,
    imageModelId: semanticModelConfig.imageModel.id,
    imageModelRevision: semanticModelConfig.imageModel.revision,
    preprocessingVersion: semanticModelConfig.preprocessing.version,
    embeddingSchemaVersion: semanticModelConfig.embedding.schemaVersion,
  };
}
