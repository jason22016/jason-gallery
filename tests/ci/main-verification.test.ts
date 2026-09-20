import test from 'node:test';
import assert from 'node:assert/strict';
import { findVerifiedMainRun } from '../../scripts/ci/main-verification.js';

const repository = 'fixture/gallery';
const sha = 'a'.repeat(40);
const run = (patch: Record<string, unknown> = {}) => ({ id: 10, event: 'push', status: 'completed', conclusion: 'success', head_branch: 'main', head_sha: sha, path: '.github/workflows/automation.yml', repository: { full_name: repository }, head_repository: { full_name: repository }, ...patch });
const artifact = (name: string, runId = 10, head = sha, expired = false) => ({ name, expired, workflow_run: { id: runId, head_sha: head } });

function fixture(runs: any[], artifacts: Record<number, any[]>) {
  const requests: string[] = [];
  const fetcher = async (input: string | URL | Request) => {
    const url = new URL(String(input)); requests.push(url.toString());
    if (url.pathname.endsWith('/actions/workflows/automation.yml/runs')) {
      assert.equal(url.searchParams.get('branch'), 'main');
      assert.equal(url.searchParams.get('event'), 'push');
      assert.equal(url.searchParams.get('status'), 'success');
      assert.equal(url.searchParams.get('head_sha'), sha);
      return Response.json({ workflow_runs: runs });
    }
    const id = Number(url.pathname.match(/\/actions\/runs\/(\d+)\/artifacts$/)?.[1]);
    const values = artifacts[id] ?? [];
    return Response.json({ total_count: values.length, artifacts: values });
  };
  return { fetcher, requests };
}

test('manual publish may reuse only a successful same-commit main push with complete retained artifacts', async () => {
  const valid = [artifact('website-release'), artifact('execution-summary')];
  const f = fixture([run()], { 10: valid });
  assert.equal(await findVerifiedMainRun({ repository, sha, currentRunId: 99, token: 'token', fetcher: f.fetcher }), 10);
  assert.equal(f.requests.length, 2);
});

test('verification fails closed for wrong provenance, current runs, and incomplete or expired artifacts', async () => {
  const invalidRuns = [
    run({ id: 1, head_sha: 'b'.repeat(40) }),
    run({ id: 2, event: 'workflow_dispatch' }),
    run({ id: 3, repository: { full_name: 'other/gallery' } }),
    run({ id: 4, conclusion: 'failure' }),
    run({ id: 99 }),
    run({ id: 11 }),
    run({ id: 10 }),
  ];
  const f = fixture(invalidRuns, {
    11: [artifact('website-release', 11), artifact('execution-summary', 11, sha, true)],
    10: [artifact('website-release')],
  });
  assert.equal(await findVerifiedMainRun({ repository, sha, currentRunId: 99, token: 'token', fetcher: f.fetcher }), null);
});
