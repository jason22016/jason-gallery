import assert from 'node:assert/strict';
import { installReadOnlyFetch, type RequestAudit } from './network.js';
const original = globalThis.fetch;
const audit: RequestAudit[] = [];
let calls = 0;
try {
  installReadOnlyFetch(audit, async () => { calls++; return new Response('ok', { status: calls === 1 ? 503 : 200 }); }, async () => {});
  assert.equal((await fetch('https://api.github.com/test')).status, 200);
  assert.deepEqual(audit.map(x => x.status), [503, 200]);
  await assert.rejects(fetch('https://api.github.com/test', { method: 'PUT' }), /Read-only/);
  assert.equal(calls, 2, 'Write must never reach transport');
  installReadOnlyFetch(audit, async () => new Response('quota', { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '123' } }), async () => {});
  assert.equal((await fetch('https://api.github.com/test')).status, 403);
  assert.equal(audit.at(-1)?.rateLimitRemaining, '0');
  calls = 0;
  installReadOnlyFetch(audit, async () => { calls++; throw new Error('offline'); }, async () => {});
  await assert.rejects(fetch('https://api.github.com/test'), /offline/);
  assert.equal(calls, 3, 'Retries must be bounded');
  console.log('PASS: read-only transport, bounded retries and quota audit');
} finally { globalThis.fetch = original; }
