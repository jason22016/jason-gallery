import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const workflowPath = '.github/workflows/automation.yml';
const requiredArtifacts = new Set(['website-release', 'execution-summary']);

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type VerificationOptions = {
  repository: string;
  sha: string;
  currentRunId: number;
  token: string;
  fetcher?: Fetch;
};

async function json(fetcher: Fetch, url: URL, token: string) {
  const response = await fetcher(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'jason-gallery-actions',
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`GitHub verification request failed (${response.status})`);
  }
  return response.json() as Promise<any>;
}

export async function findVerifiedMainRun(options: VerificationOptions) {
  const { repository, sha, currentRunId, token, fetcher = fetch } = options;
  if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(repository)) throw new Error('Invalid GITHUB_REPOSITORY');
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Invalid GITHUB_SHA');
  if (!Number.isSafeInteger(currentRunId) || currentRunId <= 0) throw new Error('Invalid GITHUB_RUN_ID');
  if (!token) throw new Error('GITHUB_TOKEN is required');

  const runsURL = new URL(`https://api.github.com/repos/${repository}/actions/workflows/automation.yml/runs`);
  runsURL.search = new URLSearchParams({ branch: 'main', event: 'push', status: 'success', head_sha: sha, per_page: '100' }).toString();
  const listed = await json(fetcher, runsURL, token);
  if (!Array.isArray(listed.workflow_runs)) throw new Error('GitHub workflow run response is incomplete');

  const candidates = listed.workflow_runs
    .filter((run: any) => Number.isSafeInteger(run.id) && run.id !== currentRunId && run.event === 'push' && run.status === 'completed' && run.conclusion === 'success' && run.head_branch === 'main' && run.head_sha === sha && run.path === workflowPath && run.repository?.full_name?.toLowerCase() === repository.toLowerCase() && run.head_repository?.full_name?.toLowerCase() === repository.toLowerCase())
    .sort((a: any, b: any) => b.id - a.id);

  for (const run of candidates) {
    const artifactsURL = new URL(`https://api.github.com/repos/${repository}/actions/runs/${run.id}/artifacts?per_page=100`);
    const listedArtifacts = await json(fetcher, artifactsURL, token);
    if (!Number.isSafeInteger(listedArtifacts.total_count) || !Array.isArray(listedArtifacts.artifacts) || listedArtifacts.total_count > listedArtifacts.artifacts.length) continue;
    const names = new Set(listedArtifacts.artifacts.filter((artifact: any) => artifact?.expired === false && artifact.workflow_run?.id === run.id && artifact.workflow_run?.head_sha === sha).map((artifact: any) => artifact.name));
    if ([...requiredArtifacts].every(name => names.has(name))) return run.id as number;
  }
  return null;
}

function setOutput(name: string, value: string) {
  const output = process.env.GITHUB_OUTPUT;
  if (output) fs.appendFileSync(output, `${name}=${value}\n`);
  else console.log(`${name}=${value}`);
}

async function main() {
  setOutput('reuse_regression', 'false');
  const manualPublish = process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' && process.env.TASK_MODE === 'publish';
  if (!manualPublish) return;
  try {
    const runId = await findVerifiedMainRun({
      repository: process.env.GITHUB_REPOSITORY ?? '',
      sha: process.env.GITHUB_SHA ?? '',
      currentRunId: Number(process.env.GITHUB_RUN_ID),
      token: process.env.GITHUB_TOKEN ?? '',
    });
    if (!runId) {
      console.log('No successful main push with a complete release was found for this commit; the full regression suite will run.');
      return;
    }
    setOutput('reuse_regression', 'true');
    setOutput('verified_run_id', String(runId));
    console.log(`Reusing the complete regression result from successful main push run ${runId}.`);
  } catch (error) {
    console.warn(`Could not reuse a previous regression result; the full suite will run. ${error instanceof Error ? error.message : 'Unknown verification error'}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
