import fs from 'node:fs/promises';
import path from 'node:path';
import { availableParallelism } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decodeFloat32LE } from './vector.js';
import { semanticModelConfigFile, semanticModelContractSha256 } from './model-config.js';

export interface EmbeddingRequestItem {
  cacheKey: string;
  thumbnail: string;
}

export interface EmbeddingBackendRequest {
  items: readonly EmbeddingRequestItem[];
  cacheDirectory: string;
}

export interface EmbeddingBackendResult {
  device: 'cpu';
  modelContractSha256: string;
  vectors: ReadonlyMap<string, Float32Array>;
  timing?: Readonly<Record<string, number>>;
}

export type EmbeddingBackend = (request: EmbeddingBackendRequest) => Promise<EmbeddingBackendResult>;

function positiveInteger(value: string | undefined, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) throw new Error(`Invalid positive integer: ${value}`);
  return parsed;
}

async function pythonExecutable(cacheDirectory: string): Promise<string> {
  if (process.env.SEMANTIC_PYTHON) return process.env.SEMANTIC_PYTHON;
  const managed = path.join(cacheDirectory, 'venv/bin/python');
  if (await fs.access(managed).then(() => true, () => false)) return managed;
  return 'python3';
}

async function run(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; process.stderr.write(chunk); });
    child.on('error', reject);
    child.on('close', status => {
      if (status === 0) resolve(stdout);
      else reject(new Error(`Semantic CPU encoder failed (${status ?? 'signal'}): ${stderr.trim().slice(-4000)}`));
    });
  });
}

export const pythonEmbeddingBackend: EmbeddingBackend = async request => {
  if (!request.items.length) throw new Error('Python embedding backend received an empty request');
  const runDirectory = await fs.mkdtemp(path.join(request.cacheDirectory, 'python-'));
  try {
    const outputDirectory = path.join(runDirectory, 'vectors');
    const modelCache = path.resolve(process.env.SEMANTIC_MODEL_CACHE ?? path.join(request.cacheDirectory, 'huggingface/hub'));
    const batchSize = positiveInteger(process.env.SEMANTIC_BATCH_SIZE, 8, 64);
    const threads = positiveInteger(process.env.SEMANTIC_THREADS, Math.min(4, availableParallelism()), 64);
    const descriptor = {
      schemaVersion: 1,
      device: 'cpu',
      modelConfig: semanticModelConfigFile,
      modelContractSha256: semanticModelContractSha256,
      modelCache,
      outputDirectory,
      batchSize,
      threads,
      items: request.items,
    };
    const requestFile = path.join(runDirectory, 'request.json');
    await fs.writeFile(requestFile, JSON.stringify(descriptor));
    const script = fileURLToPath(new URL('./embed.py', import.meta.url));
    const stdout = await run(await pythonExecutable(request.cacheDirectory), ['-B', script, requestFile], {
      ...process.env,
      SEMANTIC_DEVICE: 'cpu',
      HF_HUB_DISABLE_TELEMETRY: '1',
      HF_HUB_DISABLE_IMPLICIT_TOKEN: '1',
      HF_HUB_DISABLE_XET: '1',
      TOKENIZERS_PARALLELISM: 'false',
      PYTHONPYCACHEPREFIX: path.join(request.cacheDirectory, 'pycache'),
      XDG_CACHE_HOME: path.join(request.cacheDirectory, 'xdg'),
      TORCH_HOME: path.join(request.cacheDirectory, 'torch'),
    });
    const response = JSON.parse(stdout.trim()) as Record<string, unknown>;
    if (response.schemaVersion !== 1 || response.device !== 'cpu' || response.modelContractSha256 !== semanticModelContractSha256 || response.count !== request.items.length) {
      throw new Error('Semantic CPU encoder returned a mismatched model/runtime contract');
    }
    const names = (await fs.readdir(outputDirectory)).sort();
    const expected = request.items.map(item => `${item.cacheKey}.f32`).sort();
    if (JSON.stringify(names) !== JSON.stringify(expected)) throw new Error('Semantic CPU encoder returned an unexpected vector set');
    const vectors = new Map<string, Float32Array>();
    for (const item of request.items) {
      const rows = decodeFloat32LE(await fs.readFile(path.join(outputDirectory, `${item.cacheKey}.f32`)));
      if (rows.length !== 1) throw new Error(`Semantic CPU encoder returned invalid output for ${item.cacheKey}`);
      vectors.set(item.cacheKey, rows[0]!);
    }
    const timing: Record<string, number> = {};
    for (const key of ['modelLoadSeconds', 'inferenceSeconds', 'totalSeconds']) {
      const value = response[key];
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) timing[key] = value;
    }
    return { device: 'cpu', modelContractSha256: semanticModelContractSha256, vectors, timing };
  } finally {
    await fs.rm(runDirectory, { recursive: true, force: true });
  }
};
