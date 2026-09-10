import { spawnSync } from 'node:child_process';
import { verifyRelease, type Release } from './release.js';
import { resolveSnapshot } from '../photos/snapshot.js';
import { type PhotoSnapshot } from '../../src/photo-engine/sources.js';
export interface Deployment { id: string; url: string; environment: string; latest_stage: { status: string }; deployment_trigger?: { metadata?: { commit_message?: string } } }
export interface PagesProject { subdomain: string; production_branch: string; canonical_deployment?: Deployment }
export interface DeployIO {
  api: (route: string, method?: string) => Promise<any>;
  heads: () => Promise<{ website: string; photos: PhotoSnapshot }>;
  upload: (directory: string, release: Release) => Promise<void>;
  version: (url: string) => Promise<{ version: string; websiteCommit: string; photoSnapshotVersion: string; runNumber: number }>;
}
export function deploymentIO(): DeployIO {
  const { CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_PAGES_PROJECT: project } = process.env;
  if (!account || !token || !project || !/^[a-z0-9-]+$/.test(project) || !/^[a-f0-9]{32}$/.test(account)) throw new Error('Configure CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN and CLOUDFLARE_PAGES_PROJECT');
  return {
    api: async (route, method = 'GET') => {
      const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects/${project}${route}`, { method, headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60_000) });
      const data = await response.json() as any;
      if (!response.ok || !data.success) throw new Error(`Cloudflare request failed (${response.status})`);
      return data.result;
    },
    heads: async () => {
      const repository = process.env.GITHUB_REPOSITORY ?? 'jason22016/jason-gallery';
      if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(repository)) throw new Error('Invalid website repository');
      const response = await fetch(`https://api.github.com/repos/${repository}/commits/main`, { headers: { Accept: 'application/vnd.github+json', ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) }, signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new Error(`Cannot verify latest website commit (${response.status})`);
      return { website: (await response.json() as {sha:string}).sha, photos: await resolveSnapshot() };
    },
    upload: async (directory, release) => {
      const result = spawnSync('pnpm', ['exec', 'wrangler', 'pages', 'deploy', `${directory}/dist`, '--project-name', project, '--branch', 'main', '--commit-hash', release.websiteCommit, '--commit-message', `gallery:${release.version}`, '--commit-dirty=false'], { stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
      if (result.error || result.status !== 0) throw new Error('Cloudflare upload failed; inspect deployment status before retry if network outcome is uncertain');
    },
    version: async url => {
      const response = await fetch(new URL('/build-version.json', url), { cache: 'no-store', signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new Error(`Deployed version check failed (${response.status})`);
      return response.json();
    },
  };
}
export async function deployRelease(directory: string, io: DeployIO = deploymentIO()) {
  const release = await verifyRelease(directory);
  const heads = await io.heads();
  if (heads.website !== release.websiteCommit || heads.photos.version !== release.photoSnapshot.version) throw new Error('Superseded code/photo snapshot; rebuild latest before publishing');
  const project: PagesProject = await io.api('');
  if (project.production_branch !== 'main') throw new Error('Pages production branch must be main');
  const previous = project.canonical_deployment;
  if (previous) {
    const current = await io.version(previous.url);
    if (current.runNumber > release.runNumber) throw new Error('Older workflow cannot overwrite a newer deployment');
    if (current.websiteCommit === release.websiteCommit && current.photoSnapshotVersion === release.photoSnapshot.version) return { status: 'unchanged', url: `https://${project.subdomain}`, deploymentUrl: previous.url, deploymentId: previous.id, version: current.version };
  }
  await verifyRelease(directory);
  await io.upload(directory, release);
  const deployments: Deployment[] = await io.api('/deployments?env=production&per_page=25');
  const deployment = deployments.find(d => d.environment === 'production' && d.latest_stage.status === 'success' && d.deployment_trigger?.metadata?.commit_message === `gallery:${release.version}`);
  if (!deployment) throw new Error('Upload outcome unconfirmed: no successful matching production deployment');
  try {
    const current = await io.version(deployment.url);
    const latest: PagesProject = await io.api('');
    if (current.version !== release.version || latest.canonical_deployment?.id !== deployment.id) throw new Error('Deployed version/canonical deployment mismatch');
  } catch {
    if (previous) { await io.api(`/deployments/${previous.id}/rollback`, 'POST'); throw new Error('Deployed verification failed; restored preceding production deployment'); }
    throw new Error('First deployment verification failed; no previous deployment exists to restore');
  }
  return { status: 'success', url: `https://${project.subdomain}`, deploymentUrl: deployment.url, deploymentId: deployment.id, version: release.version };
}
export async function rollbackDeployment(id: string, io: DeployIO = deploymentIO()) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Provide the exact Cloudflare deployment UUID');
  const deployment: Deployment = await io.api(`/deployments/${id}`);
  if (deployment.environment !== 'production' || deployment.latest_stage.status !== 'success') throw new Error('Rollback requires a successful production deployment');
  const version = await io.version(deployment.url);
  await io.api(`/deployments/${id}/rollback`, 'POST');
  const project: PagesProject = await io.api('');
  if (project.canonical_deployment?.id !== id) throw new Error('Rollback outcome unconfirmed');
  return { status: 'success', action: 'rollback', url: `https://${project.subdomain}`, deploymentUrl: deployment.url, deploymentId: id, ...version };
}
