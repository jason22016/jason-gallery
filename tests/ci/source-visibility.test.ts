import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSnapshot, sourceStatuses } from '../../scripts/photos/snapshot';
import { createReadOnlyFetch, type RequestAudit } from '../../scripts/photos/network';
import { LEGACY_SOURCE, parseSources } from '../../src/photo-engine/sources';

const sha = 'a'.repeat(40);
const config = parseSources({ schemaVersion: 1, sources: [LEGACY_SOURCE] });
const photo = { path: 'images/photo 一.jpg', type: 'blob', mode: '100644' };

test('source visibility, API diagnostics and anonymous pinned originals are independent gates', async t => {
  const previous = globalThis.fetch;
  const env = { token: process.env.JASON_PHOTOS_READ_TOKEN, tokens: process.env.JASON_PHOTOS_READ_TOKENS };
  process.env.JASON_PHOTOS_READ_TOKEN = 'fallback-secret';
  process.env.JASON_PHOTOS_READ_TOKENS = JSON.stringify({ 'jason-photos': 'source-secret' });
  let override: (url: string, call: number) => Response | undefined = () => undefined;
  let requests: Array<{ url: string; auth: string | null }> = [];
  let audit: RequestAudit[] = [];
  let expectedToken: string | null = 'Bearer source-secret';
  function reset() {
    requests = []; audit = [];
    globalThis.fetch = createReadOnlyFetch(audit, async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      const auth = headers.get('authorization');
      requests.push({ url, auth });
      assert.equal(init?.redirect, 'error');
      assert.equal(init?.credentials, 'omit');
      assert(init?.signal, 'shared timeout applied');
      if (url.startsWith('https://raw.')) {
        assert.equal(auth, null);
        assert.equal(headers.get('cookie'), null);
        assert.equal(headers.get('range'), 'bytes=0-0');
        assert.equal(url, `https://raw.githubusercontent.com/jason22016/jason-photos/${sha}/images/photo%20%E4%B8%80.jpg`);
      } else assert.equal(auth, expectedToken);
      const special = override(url, requests.filter(r => r.url === url).length);
      if (special) return special;
      if (url.includes('/commits/')) return Response.json({ sha });
      if (url.includes('/git/trees/')) {
        assert(url.includes(`${sha}?recursive=1`));
        return Response.json({ truncated: false, tree: [photo, { ...photo, path: 'images/.afilmory/thumbnails/old.jpg' }, { ...photo, path: 'outside/ignored.jpg' }] });
      }
      if (url.startsWith('https://raw.')) return new Response('x', { status: 206 });
      return Response.json({ private: false });
    }, async () => {});
  }
  try {
    await t.test('per-source token, complete SHA and anonymous URL without metadata download_url', async () => {
      reset();
      assert.equal((await resolveSnapshot(config, { 'jason-photos': sha })).sources[0]!.commit, sha);
      assert.equal(requests.length, 4);
    });
    for (const [name, response, pattern, attempts] of [
      ['private', () => Response.json({ private: true }), /private_repository/, 1],
      ['unknown visibility', () => Response.json({}), /unknown_visibility/, 1],
      ['invalid JSON', () => new Response('not JSON'), /invalid JSON/, 1],
      ['authentication', () => new Response('source-secret', { status: 401 }), /authentication_failed; HTTP 401/, 1],
      ['missing or hidden', () => new Response('', { status: 404 }), /not_found_or_inaccessible/, 1],
      ['forbidden without quota evidence', () => new Response('', { status: 403 }), /forbidden \(rate limiting not established\)/, 1],
      ['primary quota', () => new Response('', { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1234', 'x-github-request-id': 'AB:CD' } }), /rate_limited.*x-ratelimit-reset=1234.*x-github-request-id=AB:CD/, 1],
      ['secondary quota', () => Response.json({ message: 'You have exceeded a secondary rate limit. source-secret' }, { status: 403 }), /rate_limited/, 1],
      ['429 quota', () => new Response('', { status: 429 }), /rate_limited; HTTP 429/, 3],
      ['temporary server error', () => new Response('', { status: 503 }), /temporary_server_error; HTTP 503/, 3],
    ] as const) await t.test(name, async () => {
      override = () => response(); reset();
      const statuses = sourceStatuses(config);
      await assert.rejects(resolveSnapshot(config, undefined, statuses), pattern);
      assert.equal(statuses[0]!.status, 'failure');
      assert(!statuses[0]!.failureReason!.includes('source-secret'));
      assert.equal(requests.length, attempts);
      assert(requests.every(r => !r.url.includes('/commits/')));
    });
    await t.test('network failure is bounded and does not echo transport secrets', async () => {
      override = () => { throw new Error('network source-secret'); }; reset();
      await assert.rejects(resolveSnapshot(config), e => /temporary network/.test(String(e)) && !String(e).includes('source-secret'));
      assert.equal(requests.length, 3);
    });
    await t.test('temporary failures recover using the existing retry policy', async () => {
      override = (_url, call) => call === 1 ? new Response('', { status: 502 }) : undefined; reset();
      await resolveSnapshot(config);
      assert.equal(requests.length, 8);
      assert.equal(audit.filter(r => r.status === 502).length, 4);
    });
    await t.test('public API success cannot hide an unreadable original', async () => {
      override = url => url.startsWith('https://raw.') ? new Response('', { status: 404 }) : undefined; reset();
      const statuses = sourceStatuses(config);
      await assert.rejects(resolveSnapshot(config), /anonymous original.*HTTP 404.*auth=anonymous/);
      await assert.rejects(resolveSnapshot(config, undefined, statuses));
      assert.equal(statuses[0]!.commit, sha);
      assert.equal(statuses[0]!.status, 'failure');
    });
    await t.test('empty or redirected originals cannot pass a public API check', async () => {
      for (const code of [204, 302]) {
        override = url => url.startsWith('https://raw.') ? new Response(null, { status: code }) : undefined; reset();
        await assert.rejects(resolveSnapshot(config), /anonymous original/);
      }
    });
    await t.test('commit failure and incomplete tree stop before raw requests', async () => {
      for (const route of ['/commits/', '/git/trees/']) {
        override = url => url.includes(route) ? (route === '/commits/' ? new Response('', { status: 401 }) : Response.json({ truncated: true, tree: [photo] })) : undefined; reset();
        await assert.rejects(resolveSnapshot(config), route === '/commits/' ? /source commit API: authentication_failed/ : /Incomplete Git tree/);
        assert(!requests.some(r => r.url.startsWith('https://raw.')));
      }
    });
    await t.test('missing token still supports public repositories; fallback remains explicit', async () => {
      override = () => undefined;
      delete process.env.JASON_PHOTOS_READ_TOKENS;
      expectedToken = 'Bearer fallback-secret'; reset(); await resolveSnapshot(config);
      delete process.env.JASON_PHOTOS_READ_TOKEN;
      expectedToken = null; reset(); await resolveSnapshot(config);
    });
  } finally {
    globalThis.fetch = previous;
    if (env.token === undefined) delete process.env.JASON_PHOTOS_READ_TOKEN; else process.env.JASON_PHOTOS_READ_TOKEN = env.token;
    if (env.tokens === undefined) delete process.env.JASON_PHOTOS_READ_TOKENS; else process.env.JASON_PHOTOS_READ_TOKENS = env.tokens;
  }
});
