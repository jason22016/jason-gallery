import { semanticModelConfig } from './model-config.js';

export function assertEmbedding(vector: Float32Array, label = 'embedding'): void {
  if (vector.length !== semanticModelConfig.embedding.dimension) {
    throw new Error(`${label} dimension mismatch: expected ${semanticModelConfig.embedding.dimension}, got ${vector.length}`);
  }
  let squaredNorm = 0;
  for (const value of vector) {
    if (!Number.isFinite(value)) throw new Error(`${label} contains a non-finite value`);
    squaredNorm += value * value;
  }
  const norm = Math.sqrt(squaredNorm);
  if (Math.abs(norm - 1) > 2e-5) throw new Error(`${label} is not L2 normalized (norm ${norm})`);
}

export function encodeFloat32LE(vectors: readonly Float32Array[]): Buffer {
  const dimension = semanticModelConfig.embedding.dimension;
  const output = Buffer.allocUnsafe(vectors.length * dimension * Float32Array.BYTES_PER_ELEMENT);
  let offset = 0;
  for (const [index, vector] of vectors.entries()) {
    assertEmbedding(vector, `embedding ${index}`);
    for (const value of vector) {
      output.writeFloatLE(value, offset);
      offset += Float32Array.BYTES_PER_ELEMENT;
    }
  }
  return output;
}

export function decodeFloat32LE(bytes: Uint8Array): Float32Array[] {
  const dimension = semanticModelConfig.embedding.dimension;
  const rowBytes = dimension * Float32Array.BYTES_PER_ELEMENT;
  if (bytes.byteLength % rowBytes !== 0) throw new Error('Semantic vector file length is not a whole number of rows');
  const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const rows: Float32Array[] = [];
  for (let offset = 0; offset < view.byteLength; offset += rowBytes) {
    const vector = new Float32Array(dimension);
    for (let i = 0; i < dimension; i++) vector[i] = view.readFloatLE(offset + i * Float32Array.BYTES_PER_ELEMENT);
    assertEmbedding(vector, `semantic vector row ${rows.length}`);
    rows.push(vector);
  }
  return rows;
}
