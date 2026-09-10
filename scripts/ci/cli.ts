import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { verifyPhotos } from '../photos/artifact.js';
import { processingFingerprint } from '../photos/fingerprint.js';
import { buildRelease, verifyRelease } from './release.js';
import { deployRelease, rollbackDeployment } from './deploy.js';

const command = process.argv[2];
const root = path.resolve('.cache/automation');
await fs.mkdir(root, { recursive: true });
const stateFile = path.join(root, 'summary.json');
const read = async (file: string) => JSON.parse(await fs.readFile(file, 'utf8'));
const initial = { schemaVersion: 1, action: command === 'rollback' ? 'rollback' : process.env.TASK_MODE ?? 'publish', result: 'running', websiteCommit: process.env.GITHUB_SHA ?? null, photoCommit: null, photos: { status: 'not_started', total: null, processed: null, reused: null }, website: { status: 'not_started' }, deployment: { status: 'not_requested', url: null, version: null }, failureReason: null };
const state = ['resolve', 'rollback'].includes(command ?? '') ? initial : await read(stateFile).catch(() => initial);
const output = async (name: string, value: string) => { if (process.env.GITHUB_OUTPUT) await fs.appendFile(process.env.GITHUB_OUTPUT, `${name}=${value}\n`); };
try {
  if (command === 'resolve') {
    const requested = process.env.PHOTO_COMMIT ?? '';
    if (requested && !/^[a-f0-9]{40}$/.test(requested)) throw new Error('photo_commit must be empty or a full lowercase commit SHA');
    if (process.env.PHOTO_RUN_ID && (!/^\d+$/.test(process.env.PHOTO_RUN_ID) || !requested)) throw new Error('Reusing photo_run_id requires its exact photo_commit');
    if (process.env.PHOTO_RUN_ID) {
      const response = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.PHOTO_RUN_ID}`, { headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }, signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new Error(`Cannot verify photo artifact run (${response.status})`);
      const run = await response.json() as any;
      if (run.head_branch !== 'main' || run.path !== '.github/workflows/automation.yml' || run.status !== 'completed') throw new Error('Photo artifacts must come from a completed main automation run');
      // A website failure does not negate a successfully uploaded photo artifact.
    }
    const { installReadOnlyFetch } = await import('../photos/network.js'); installReadOnlyFetch([]);
    if (requested) state.photoCommit = requested;
    else {
      const response = await fetch('https://api.github.com/repos/jason22016/jason-photos/commits/main', { headers: { ...(process.env.JASON_PHOTOS_READ_TOKEN ? { Authorization: `Bearer ${process.env.JASON_PHOTOS_READ_TOKEN}` } : {}) } });
      if (!response.ok) throw new Error(`Photo ref resolution failed (${response.status})`);
      state.photoCommit = (await response.json() as {sha: string}).sha;
    }
    if (!/^[a-f0-9]{40}$/.test(state.photoCommit)) throw new Error('Invalid photo commit');
    const fingerprint = await processingFingerprint();
    await output('photo_commit', state.photoCommit); await output('fingerprint', fingerprint);
    state.fingerprint = fingerprint;
  } else if (command === 'photos') {
    if (!process.env.PHOTO_RUN_ID) {
      const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/photos/cli.ts', '--ref', state.photoCommit], { stdio: 'inherit' });
      if (result.error || result.status !== 0) throw new Error('Photo processing failed; previous successful output is not publishable for this run');
      await fs.rm(path.join(root, 'photos'), { recursive: true, force: true });
      await fs.cp(await fs.realpath('.cache/photo-engine/output'), path.join(root, 'photos'), { recursive: true });
    }
    const artifact = await verifyPhotos(path.join(root, 'photos'), { ref: state.photoCommit, fingerprint: state.fingerprint, production: true });
    state.photos = { status: 'success', total: artifact.photos, processed: process.env.PHOTO_RUN_ID ? 0 : artifact.processed, reused: process.env.PHOTO_RUN_ID ? artifact.photos : artifact.reused, artifactVersion: artifact.version, producerWebsiteCommit: artifact.websiteCommit, artifactRunId: process.env.PHOTO_RUN_ID || process.env.GITHUB_RUN_ID };
  } else if (command === 'build') {
    if (state.photos.status !== 'success') throw new Error('Current run has no verified photo artifact');
    const release = await buildRelease({ photos: path.join(root, 'photos'), root: process.cwd(), destination: path.join(root, 'release'), websiteCommit: state.websiteCommit, runId: process.env.GITHUB_RUN_ID ?? 'local', runNumber: Number(process.env.GITHUB_RUN_NUMBER ?? 0), production: true });
    state.website = { status: 'success', version: release.version, publishedProjects: release.publishedProjects, publicPhotos: release.publicPhotos };
  } else if (command === 'deploy') {
    if (state.website.status !== 'success') throw new Error('Current run has no successful website build');
    const release = await verifyRelease(path.join(root, 'release'));
    const photos = await verifyPhotos(path.join(root, 'photos'), { ref: state.photoCommit, fingerprint: state.fingerprint, production: true });
    if (release.version !== state.website.version || release.websiteCommit !== state.websiteCommit || release.photoArtifactVersion !== photos.version) throw new Error('Release does not match current run');
    state.deployment = await deployRelease(path.join(root, 'release'));
  } else if (command === 'rollback') {
    state.deployment = await rollbackDeployment(process.env.DEPLOYMENT_ID ?? '');
    state.websiteCommit = state.deployment.websiteCommit; state.photoCommit = state.deployment.photoCommit;
  } else if (command === 'summary') {
    const jobStatus = process.env.JOB_STATUS;
    state.result = jobStatus === 'success' ? 'success' : jobStatus ?? 'failure';
    if (state.result !== 'success' && !state.failureReason) state.failureReason = `Workflow ${state.result}; inspect failed/cancelled step in Actions (checkout, dependencies, checks or artifact transfer)`;
    if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `\n\`\`\`json\n${JSON.stringify(state, null, 2)}\n\`\`\`\n`);
  } else throw new Error('Expected resolve, photos, build, deploy, rollback or summary');
} catch (error) {
  state.result = 'failure';
  let reason = error instanceof Error ? error.message : 'Task failed';
  for (const key of ['JASON_PHOTOS_READ_TOKEN', 'CLOUDFLARE_API_TOKEN', 'GITHUB_TOKEN']) if (process.env[key]) reason = reason.replaceAll(process.env[key]!, '[redacted]');
  state.failureReason = `${command}: ${reason}`;
  if (command === 'photos') state.photos.status = 'failure';
  if (command === 'build') state.website.status = 'failure';
  if (command === 'deploy' || command === 'rollback') state.deployment = { status: 'failure_or_unconfirmed', url: null, version: null };
  console.error(state.failureReason); process.exitCode = 1;
} finally { await fs.writeFile(stateFile, JSON.stringify(state, null, 2)); }
