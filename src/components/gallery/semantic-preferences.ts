import { semanticCacheMarkerPath, semanticCachePrefix } from '../../semantic-search/cache';
import { CLIENT_SEMANTIC_RELEASE_BUNDLE_SHA256, CLIENT_SEMANTIC_RELEASE_ID } from '../../semantic-search/release-contract';

const enabledKey = 'jason-gallery:ai-search:enabled:v1';

export function rememberSemanticEnabled(enabled: boolean): void {
  try { localStorage.setItem(enabledKey, String(enabled)); }
  catch { /* AI Search remains usable when preferences cannot be saved. */ }
}

export async function shouldRestoreSemanticSearch(): Promise<boolean> {
  try {
    const saved = localStorage.getItem(enabledKey);
    if (saved !== null) return saved === 'true';
  } catch { /* A previously downloaded model can still be available. */ }
  // Users of the previous UI already opted in by downloading a complete model.
  // Probe only the commit marker; the engine verifies every asset before use.
  try {
    const response = await caches.match(`${semanticCacheMarkerPath}${CLIENT_SEMANTIC_RELEASE_BUNDLE_SHA256}`, {
      cacheName: `${semanticCachePrefix}${CLIENT_SEMANTIC_RELEASE_ID}:${CLIENT_SEMANTIC_RELEASE_BUNDLE_SHA256}`,
    });
    if (!response) return false;
    const marker = await response.json();
    return marker?.schemaVersion === 1 && marker.releaseId === CLIENT_SEMANTIC_RELEASE_ID && marker.bundleSha256 === CLIENT_SEMANTIC_RELEASE_BUNDLE_SHA256;
  } catch { return false; }
}
