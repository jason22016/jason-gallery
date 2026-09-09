export interface RequestAudit {
  url: string;
  method: string;
  attempt: number;
  status?: number;
  elapsedMs: number;
  error?: string;
  rateLimitRemaining?: string;
  rateLimitReset?: string;
}

/** Applies to the complete Builder process, including upstream providers/plugins. */
export function installReadOnlyFetch(
  audit: RequestAudit[],
  transport: typeof fetch = globalThis.fetch,
  delay: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)),
) {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (!['GET', 'HEAD'].includes(method)) {
      audit.push({ url, method, attempt: 0, elapsedMs: 0, error: 'Blocked non-read request' });
      throw new Error(`Read-only network: ${method}`);
    }
    for (let attempt = 1; attempt <= 3; attempt++) {
      const start = Date.now();
      const record: RequestAudit = { url, method, attempt, elapsedMs: 0 };
      audit.push(record);
      let retryDelay = 500 * 2 ** (attempt - 1);
      try {
        const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
        const response = await transport(input, { ...init, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000) });
        record.status = response.status;
        record.rateLimitRemaining = response.headers.get('x-ratelimit-remaining') ?? undefined;
        record.rateLimitReset = response.headers.get('x-ratelimit-reset') ?? undefined;
        if (![408, 429, 500, 502, 503, 504].includes(response.status) || attempt === 3) return response;
        const after = Number(response.headers.get('retry-after'));
        if (Number.isFinite(after) && after > 0) retryDelay = Math.min(30_000, after * 1000);
        await response.body?.cancel();
        console.warn(`Retrying read (${response.status}, attempt ${attempt}): ${url}`);
      } catch (error) {
        record.error = error instanceof Error ? error.message : String(error);
        if (attempt === 3 || init?.signal?.aborted || (input instanceof Request && input.signal.aborted)) throw error;
        console.warn(`Retrying read (network error, attempt ${attempt}): ${url}`);
      } finally { record.elapsedMs = Date.now() - start; }
      await delay(retryDelay);
    }
    throw new Error('Read retries exhausted');
  };
}
