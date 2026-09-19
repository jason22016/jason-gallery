/** Download time is unlimited while bytes keep arriving. Native <img> cannot
 * report byte progress, so its fallback attempt has a separate, generous limit. */
export const imageLoadingPolicy = {
  requestDelayMs: 300,
  downloadIdleTimeoutMs: 30_000,
  nativeImageTimeoutMs: 60_000,
} as const;
