import { createDefaultBuilderConfig } from '@afilmory/builder/config/defaults.js';
export const UPSTREAM_COMMIT = 'a3db486b0a8f2572de3032eabdfce24e726e83f3';
export function createPhotoConfig(ref: string) {
  const config = createDefaultBuilderConfig();
  config.user = { storage: { provider: 'github', owner: 'jason22016', repo: 'jason-photos', path: 'images', branch: ref, useRawUrl: true, ...(process.env.JASON_PHOTOS_READ_TOKEN ? { token: process.env.JASON_PHOTOS_READ_TOKEN } : {}) } };
  config.system.processing.digestSuffixLength = 8;
  config.system.processing.defaultConcurrency = 2;
  config.system.processing.enableLivePhotoDetection = false;
  // The upstream "worker" pool is in-process async concurrency. Cluster mode
  // cannot serialize our reconciliation closures and is deliberately disabled.
  config.system.observability.performance.worker.useClusterMode = false;
  return config;
}
