import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { createPhotoConfig, UPSTREAM_COMMIT } from '../../builder.config.js';

// Includes local engine patches and exact dependency/native runtime versions; excludes UI/Projects.
export async function processingFingerprint() {
  const digest = createHash('sha256');
  async function add(name: string) {
    const stat = await fs.lstat(name);
    if (stat.isDirectory()) {
      for (const entry of (await fs.readdir(name)).sort()) if (entry !== 'node_modules') await add(path.join(name, entry));
    } else if (stat.isFile()) { digest.update(name); digest.update(await fs.readFile(name)); }
  }
  for (const name of ['builder.config.ts', 'pnpm-lock.yaml', 'src/photo-engine/sources.ts', 'src/photo-engine/unified-index.ts', ...['engine', 'fingerprint', 'network', 'cli', 'artifact', 'snapshot', 'sync', 'collection'].map(x => `scripts/photos/${x}.ts`), ...['builder', 'typing', 'utils', 'renderer'].map(x => `packages/afilmory/${x}`)]) await add(name);
  digest.update(JSON.stringify({ upstream: UPSTREAM_COMMIT, system: createPhotoConfig('0'.repeat(40)).system, node: process.version, platform: process.platform, arch: process.arch, sharp: sharp.versions }));
  return digest.digest('hex');
}
