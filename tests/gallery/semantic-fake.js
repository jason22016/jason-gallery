globalThis.installSemanticFake = function installSemanticFake(publicIds, initialMode) {
  const totalBytes = 111_166_042;
  const transportBytes = 100_655_930;
  const base = { releaseId: 'test-release', modelVersion: 'test-model', cache: 'unknown', progress: { downloadedBytes: 0, totalBytes: 0, transportBytes: 0 } };
  let state = { ...base, status: 'disabled' };
  let operation = 0;
  let activeInitialization = null;
  let activeSearch = null;
  const listeners = new Set();
  const counts = { enables: 0, retries: 0, cancels: 0, queries: 0, abortedQueries: 0, workerStarts: 0, sessionInitializations: 0, modelDownloads: 0, persistentCacheHits: 0 };
  const control = { enableMode: initialMode, counts, enabledPhotoIds: [], queries: [], queryOptions: [], resultSets: {} };
  const publish = patch => {
    state = { ...state, ...patch, progress: patch.progress ?? state.progress };
    for (const listener of listeners) listener(state);
  };
  const abort = (message = 'Aborted') => new DOMException(message, 'AbortError');
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const initialize = async (options = {}) => {
    const current = ++operation;
    control.enabledPhotoIds = [...(options.publicPhotoIds ?? [])];
    publish({ ...base, status: 'not-downloaded', error: undefined });
    await pause(40); if (current !== operation) throw abort();
    if (control.enableMode === 'update') {
      publish({ status: 'update-required', error: { code: 'UPDATE_REQUIRED', message: '测试索引需要新模型', recoverable: false } });
      throw new Error('UPDATE_REQUIRED');
    }
    if (control.enableMode === 'cache') {
      counts.persistentCacheHits++;
      publish({ status: 'verifying', cache: 'persistent', progress: { downloadedBytes: totalBytes, totalBytes, transportBytes, file: 'onnx' } });
    } else {
      counts.modelDownloads++;
      publish({ status: 'downloading', cache: 'unknown', progress: { downloadedBytes: 25_000_000, totalBytes, transportBytes, file: 'onnx.part-1.br' } });
      if (counts.enables === 1) {
        await new Promise((_resolve, reject) => {
          activeInitialization = { cancel: () => { activeInitialization = null; reject(abort()); } };
        });
      } else {
        await pause(600); if (current !== operation) throw abort();
      }
      publish({ status: 'downloading', progress: { downloadedBytes: 76_000_000, totalBytes, transportBytes, file: 'onnx.part-4.br' } });
    }
    await pause(50); if (current !== operation) throw abort();
    publish({ status: 'verifying', cache: 'persistent', progress: { downloadedBytes: totalBytes, totalBytes, transportBytes, file: 'onnx' } });
    await pause(40); if (current !== operation) throw abort();
    publish({ status: 'initializing' });
    await pause(40); if (current !== operation) throw abort();
    if (!counts.workerStarts) counts.workerStarts = 1;
    if (!counts.sessionInitializations) counts.sessionInitializations = 1;
    publish({ status: 'ready', cache: 'persistent', backend: 'wasm', indexVersion: 'test-index', progress: { downloadedBytes: totalBytes, totalBytes, transportBytes } });
    return state;
  };
  const engine = {
    getState: () => state,
    subscribe(listener) { listeners.add(listener); listener(state); return () => listeners.delete(listener); },
    async enable(options) {
      counts.enables++;
      if (state.status === 'ready' || state.status === 'searching') return state;
      return initialize(options);
    },
    async retry(options) { counts.retries++; return initialize(options); },
    dispose() {
      operation++;
      counts.cancels++;
      activeInitialization?.cancel();
      if (activeSearch) { clearTimeout(activeSearch.timer); activeSearch.detach?.(); activeSearch.reject(abort()); activeSearch = null; }
      publish({ ...base, status: 'disabled', error: undefined });
    },
    search(query, options = {}) {
      counts.queries++;
      control.queries.push(query);
      control.queryOptions.push({ topK: options.topK, scopePhotoIds: options.scopePhotoIds ? [...options.scopePhotoIds] : undefined });
      if (activeSearch) { clearTimeout(activeSearch.timer); activeSearch.detach?.(); activeSearch.reject(abort('Superseded')); counts.abortedQueries++; activeSearch = null; }
      publish({ status: 'searching' });
      return new Promise((resolve, reject) => {
        const finish = () => {
          activeSearch?.detach?.(); activeSearch = null;
          if (query.toLowerCase().includes('error')) {
            publish({ status: 'error', error: { code: 'QUERY_FAILED', message: '测试查询失败', recoverable: true } });
            reject(new Error('测试查询失败')); return;
          }
          const ids = query.toLowerCase().includes('none') ? [] : [publicIds[2], publicIds[0], publicIds[1]].filter(Boolean);
          const results = control.resultSets[query] ?? ids.map((publicId, index) => ({ publicId, rank: index + 1, score: .9 - index * .1 }));
          const scope = options.scopePhotoIds ? new Set(options.scopePhotoIds) : null;
          const eligible = scope ? results.filter(result => scope.has(result.publicId)).map((result, index) => ({ ...result, rank: index + 1 })) : results;
          publish({ status: 'ready', error: undefined });
          resolve({ query, results: eligible.slice(0, options.topK ?? eligible.length), elapsedMs: 8, backend: 'wasm', releaseId: 'test-release', indexVersion: 'test-index' });
        };
        const timer = window.setTimeout(finish, query.toLowerCase().includes('slow') ? 700 : 35);
        const onAbort = () => {
          if (activeSearch?.timer !== timer) return;
          clearTimeout(timer); activeSearch = null; counts.abortedQueries++; publish({ status: 'ready' }); reject(abort());
        };
        options.signal?.addEventListener('abort', onAbort, { once: true });
        activeSearch = { timer, reject, detach: options.signal ? () => options.signal.removeEventListener('abort', onAbort) : undefined };
      });
    },
    getDiagnostics: () => ({ workerStarts: counts.workerStarts, sessionInitializations: counts.sessionInitializations, queries: counts.queries, modelDownloads: counts.modelDownloads, persistentCacheHits: counts.persistentCacheHits, stateListeners: listeners.size }),
  };
  control.engine = engine;
  globalThis[Symbol.for('jason-gallery.semantic-search-engine')] = engine;
  globalThis.semanticFake = control;
  return control;
};
