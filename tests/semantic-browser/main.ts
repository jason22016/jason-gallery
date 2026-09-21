import { createSemanticSearchEngine, type SemanticBackendPreference, type SemanticRuntimeState, type SemanticSearchEngineOptions } from '../../src/semantic-search';
import { semanticCachePrefix } from '../../src/semantic-search/cache';
import { CLIENT_SEMANTIC_RELEASE_ID, CLIENT_SEMANTIC_RELEASE_ROOT } from '../../src/semantic-search/release-contract';

const parameters = new URLSearchParams(location.search);
const backend = (parameters.get('backend') ?? 'auto') as SemanticBackendPreference;
const states: Array<Readonly<SemanticRuntimeState>> = [];

function storageOption(): SemanticSearchEngineOptions['cacheStorage'] | undefined {
  const mode = parameters.get('storage');
  if (mode === 'off') return null;
  if (mode === 'unavailable') return {
    open: async () => { throw new DOMException('Cache Storage is unavailable', 'SecurityError'); },
    delete: async () => false,
    keys: async () => { throw new DOMException('Cache Storage is unavailable', 'SecurityError'); },
  };
  if (mode === 'quota') return {
    async open(name: string) {
      const cache = await caches.open(name);
      return {
        match: cache.match.bind(cache),
        matchAll: cache.matchAll.bind(cache),
        add: cache.add.bind(cache),
        addAll: cache.addAll.bind(cache),
        keys: cache.keys.bind(cache),
        delete: cache.delete.bind(cache),
        put: async () => { throw new DOMException('Simulated semantic cache quota failure', 'QuotaExceededError'); },
      } as Cache;
    },
    delete: name => caches.delete(name),
    keys: () => caches.keys(),
  };
  return undefined;
}

function engineOptions(): SemanticSearchEngineOptions {
  const cacheStorage = storageOption();
  return {
    ...(cacheStorage !== undefined ? { cacheStorage } : {}),
    ...(parameters.get('worker') === 'no-webgpu' ? {
      workerFactory: () => new Worker(new URL('./no-webgpu.worker.ts', import.meta.url), { type: 'module' }),
    } : {}),
  };
}

let engine = createSemanticSearchEngine(engineOptions());
let unsubscribe = engine.subscribe(state => states.push(structuredClone(state)));

function recreate() {
  unsubscribe(); engine.dispose(); states.length = 0;
  engine = createSemanticSearchEngine(engineOptions());
  unsubscribe = engine.subscribe(state => states.push(structuredClone(state)));
}

async function currentCache() {
  const name = (await caches.keys()).find(value => value.startsWith(semanticCachePrefix) && value.includes(CLIENT_SEMANTIC_RELEASE_ID));
  return name ? caches.open(name) : undefined;
}

const api = {
  states,
  enable: () => engine.enable({ backend }),
  retry: () => engine.retry({ backend }),
  search: (text: string, topK = 5) => engine.search(text, { topK }),
  state: () => engine.getState(),
  diagnostics: () => engine.getDiagnostics(),
  cycleSubscriptions(count = 100) {
    const releases = Array.from({ length: count }, () => engine.subscribe(() => {}));
    for (const release of releases) release();
    return engine.getDiagnostics();
  },
  dispose: () => engine.dispose(),
  recreate,
  async clearCaches() { await Promise.all((await caches.keys()).filter(name => name.startsWith(semanticCachePrefix)).map(name => caches.delete(name))); },
  cacheNames: () => caches.keys(),
  async addOldCache() { await caches.open(`${semanticCachePrefix}obsolete-r0:${'0'.repeat(64)}`); },
  async corruptCache(path: string, mode: 'delete' | 'corrupt') {
    const cache = await currentCache();
    if (!cache) throw new Error('No current semantic cache');
    const url = new URL(`${CLIENT_SEMANTIC_RELEASE_ROOT}/${path}`, location.origin).href;
    if (mode === 'delete') await cache.delete(url);
    else await cache.put(url, new Response('corrupt'));
  },
  async cancel(text: string) {
    const controller = new AbortController();
    const pending = engine.search(text, { topK: 5, signal: controller.signal }).then(() => 'resolved', error => error.name);
    controller.abort();
    return pending;
  },
  async rapid(first: string, second: string) {
    const stale = engine.search(first, { topK: 5 }).then(() => 'resolved', error => error.name);
    const latest = engine.search(second, { topK: 5 });
    return { stale: await stale, latest: await latest };
  },
};

declare global { interface Window { semanticTest: typeof api } }
window.semanticTest = api;
