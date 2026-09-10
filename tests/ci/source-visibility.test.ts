import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSnapshot, sourceStatuses } from '../../scripts/photos/snapshot';
import { LEGACY_SOURCE, parseSources } from '../../src/photo-engine/sources';

test('public visibility uses read credentials without accepting private or unconfirmed repositories', async () => {
  const previous = globalThis.fetch;
  const token = process.env.JASON_PHOTOS_READ_TOKEN;
  const tokens = process.env.JASON_PHOTOS_READ_TOKENS;
  process.env.JASON_PHOTOS_READ_TOKEN = 'fixture-read-token';
  delete process.env.JASON_PHOTOS_READ_TOKENS;
  const config = parseSources({ schemaVersion: 1, sources: [LEGACY_SOURCE] });
  try {
    let visibility: unknown = { private: false };
    let status = 200;
    let commitRequests = 0;
    globalThis.fetch = async (input, init) => {
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer fixture-read-token');
      if (String(input).includes('/commits/')) {
        commitRequests++;
        return Response.json({ sha: 'a'.repeat(40) });
      }
      return Response.json(visibility, { status, headers: { 'x-ratelimit-remaining': '0' } });
    };
    assert.equal((await resolveSnapshot(config)).sources[0]!.commit, 'a'.repeat(40));
    assert.equal(commitRequests, 1);
    for (const value of [{ private: true }, {}, { private: 'false' }]) {
      visibility = value;
      await assert.rejects(resolveSnapshot(config), /must be public/);
    }
    for (const code of [403, 404, 429, 503]) {
      status = code;
      const sources = sourceStatuses(config);
      await assert.rejects(resolveSnapshot(config, undefined, sources), new RegExp(`HTTP ${code}; rate limit remaining 0`));
      assert.equal(sources[0]!.status, 'failure');
      assert(!sources[0]!.failureReason!.includes('fixture-read-token'));
    }
    assert.equal(commitRequests, 1, 'never resolve a commit after a failed visibility check');
    delete process.env.JASON_PHOTOS_READ_TOKEN;
    globalThis.fetch = async (input, init) => {
      assert.equal(new Headers(init?.headers).has('authorization'), false);
      return Response.json(String(input).includes('/commits/') ? { sha: 'b'.repeat(40) } : { private: false });
    };
    assert.equal((await resolveSnapshot(config)).sources[0]!.commit, 'b'.repeat(40));
  } finally {
    globalThis.fetch = previous;
    if (token === undefined) delete process.env.JASON_PHOTOS_READ_TOKEN; else process.env.JASON_PHOTOS_READ_TOKEN = token;
    if (tokens === undefined) delete process.env.JASON_PHOTOS_READ_TOKENS; else process.env.JASON_PHOTOS_READ_TOKENS = tokens;
  }
});
