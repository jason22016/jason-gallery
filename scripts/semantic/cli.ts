import path from 'node:path';
import { buildSemanticIndex, collectPublicSemanticPhotos } from './build.js';
import { verifyPublicSemanticIndex } from './index.js';
import { semanticModelConfig, semanticModelContractSha256 } from './model-config.js';
import { verifyClientSemanticRelease } from './client-release.js';

const args = process.argv.slice(2);
const command = args[0]?.startsWith('--') || !args[0] ? 'build' : args.shift()!;
const value = (name: string) => {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const result = args[index + 1];
  if (!result || result.startsWith('--')) throw new Error(`Missing value for ${name}`);
  return result;
};
const allowed = new Set(['--root', '--cache', '--output']);
for (let i = 0; i < args.length; i += 2) {
  if (!allowed.has(args[i]!)) throw new Error(`Unknown semantic option: ${args[i]}`);
  if (!args[i + 1] || args[i + 1]!.startsWith('--')) throw new Error(`Missing value for ${args[i]}`);
}
const root = path.resolve(value('--root') ?? '.');
const cacheDirectory = path.resolve(value('--cache') ?? path.join(root, '.cache/semantic'));
const outputDirectory = path.resolve(value('--output') ?? path.join(root, 'public/semantic'));

if (command === 'build') {
  console.log(JSON.stringify(await buildSemanticIndex({ root, cacheDirectory, outputDirectory })));
} else if (command === 'verify') {
  const ids = collectPublicSemanticPhotos(root).map(photo => photo.publicId);
  const index = await verifyPublicSemanticIndex(outputDirectory, ids);
  const release = await verifyClientSemanticRelease();
  console.log(JSON.stringify({ status: 'ok', photos: index.photoIds.length, indexVersion: index.indexVersion, clientReleaseId: release.releaseId, clientBundleSha256: release.bundleSha256 }));
} else if (command === 'contract') {
  console.log(JSON.stringify({ modelContractSha256: semanticModelContractSha256, model: semanticModelConfig }));
} else throw new Error('Expected semantic command: build, verify, or contract');
