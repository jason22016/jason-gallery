import fs from 'node:fs/promises';
import { createPublicSemanticIndex } from '../../scripts/semantic/index.js';
import { sha256 } from '../../scripts/semantic/hash.js';
import { semanticModelConfig, semanticModelContractSha256 } from '../../scripts/semantic/model-config.js';

const fixtureModelContractSha256 = '8084ea0fd9642e2d18dfe5832c0467be77c2b4d3c27f31e9ba7542aa6fe97390';
const fixtureVectors = new URL('./index-vectors.f32.b64', import.meta.url);

export const semanticIndexFixturePhotoIds = [
  'AurF9dVsFmUPqefx',
  'BBijJPwxpqz_9pI1',
  'CP1txp1O9UsIKCzj',
  'IoJgKXf3_oiiL8Xz',
  'cn5AQ_QzZObYC1T6',
  'ti9q124e1ZUxwyD-',
] as const;

export async function loadSemanticIndexFixture() {
  if (semanticModelContractSha256 !== fixtureModelContractSha256) {
    throw new Error('Semantic index fixture must be regenerated for the current model contract');
  }
  const vectorBytes = Buffer.from((await fs.readFile(fixtureVectors, 'utf8')).trim(), 'base64');
  const expectedBytes = semanticIndexFixturePhotoIds.length * semanticModelConfig.embedding.dimension * Float32Array.BYTES_PER_ELEMENT;
  if (vectorBytes.byteLength !== expectedBytes) throw new Error('Semantic index fixture has an invalid vector byte length');
  const index = createPublicSemanticIndex([...semanticIndexFixturePhotoIds], vectorBytes.byteLength, sha256(vectorBytes));
  const indexBytes = Buffer.from(`${JSON.stringify(index, null, 2)}\n`);
  return { index, indexBytes, vectorBytes };
}
