export const CLIENT_SEMANTIC_RELEASE_ID = 'siglip2-base-v64k-uint4-b32-r1' as const;
export const CLIENT_SEMANTIC_RELEASE_BUNDLE_SHA256 = 'eafe74e07e24fcd43b90f211910702885c55430706efa40ceb5e4b09611e83e0' as const;
export const CLIENT_SEMANTIC_RELEASE_MANIFEST_SHA256 = '084d97bf8c3e36ed230fd68f05846afb1878e2d304e224921fb6796293e2e371' as const;
export const CLIENT_SEMANTIC_RELEASE_ROOT = `/semantic-models/${CLIENT_SEMANTIC_RELEASE_ID}` as const;
export const CLIENT_SEMANTIC_RELEASE_MANIFEST_URL = `${CLIENT_SEMANTIC_RELEASE_ROOT}/manifest.json` as const;

export const CLIENT_SEMANTIC_RELEASE_FILES = [
  'manifest.json',
  'model-config.json',
  'model.onnx.part-000.br',
  'model.onnx.part-001.br',
  'model.onnx.part-002.br',
  'model.onnx.part-003.br',
  'model.onnx.part-004.br',
  'model.onnx.part-005.br',
  'tokenizer.json.br',
  'tokenizer_config.json.br',
] as const;

export const CLIENT_SEMANTIC_RELEASE_PUBLIC_PATHS = CLIENT_SEMANTIC_RELEASE_FILES.map(
  file => `${CLIENT_SEMANTIC_RELEASE_ROOT.slice(1)}/${file}`,
);

export const CLIENT_SEMANTIC_RUNTIME_ID = 'onnxruntime-web-1.30.0-asyncify-r1' as const;
export const CLIENT_SEMANTIC_RUNTIME_MANIFEST_SHA256 = 'd25f8e59d7e115b56d9a6052d1c27786ee3f7753db876bbd4d35c781fb503e05' as const;
export const CLIENT_SEMANTIC_RUNTIME_ROOT = `/semantic-runtimes/${CLIENT_SEMANTIC_RUNTIME_ID}` as const;
export const CLIENT_SEMANTIC_RUNTIME_FILES = [
  'manifest.json',
  'ort-wasm-simd-threaded.asyncify.mjs',
  'ort-wasm-simd-threaded.asyncify.wasm.br',
] as const;
export const CLIENT_SEMANTIC_RUNTIME_PUBLIC_PATHS = CLIENT_SEMANTIC_RUNTIME_FILES.map(
  file => `${CLIENT_SEMANTIC_RUNTIME_ROOT.slice(1)}/${file}`,
);
export const CLIENT_SEMANTIC_RUNTIME_WASM_URL = `${CLIENT_SEMANTIC_RUNTIME_ROOT}/ort-wasm-simd-threaded.asyncify.wasm.br` as const;
export const CLIENT_SEMANTIC_RUNTIME_MODULE_URL = `${CLIENT_SEMANTIC_RUNTIME_ROOT}/ort-wasm-simd-threaded.asyncify.mjs` as const;

export const SEMANTIC_INDEX_URL = '/semantic/index.json' as const;
export const SEMANTIC_VECTOR_URL = '/semantic/vectors.f32' as const;
