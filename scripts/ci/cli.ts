import { selectedSources, combinedSnapshot, readBaseline } from '../photos/partial-sync.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { verifyCollection } from '../photos/collection.js';
import { loadSources } from '../../src/photo-engine/sources.js';
import { resolveSnapshot, parseCommits, sourceStatuses, safeReason } from '../photos/snapshot.js';
import { processingFingerprint } from '../photos/fingerprint.js';
import { buildRelease, verifyRelease } from './release.js';
import { deployRelease, rollbackDeployment } from './deploy.js';

const command = process.argv[2];
const root = path.resolve('.cache/automation');
await fs.mkdir(root, { recursive: true });
const stateFile = path.join(root, 'summary.json');
const read = async (file: string) => JSON.parse(await fs.readFile(file, 'utf8'));
const initial = { schemaVersion: 2, action: command === 'rollback' ? 'rollback' : process.env.TASK_MODE ?? 'publish', result: 'running', websiteCommit: process.env.GITHUB_SHA ?? null, photoSnapshot: null, sources: [], photos: { status: 'not_started', total: null, processed: null, reused: null }, website: { status: 'not_started' }, deployment: { status: 'not_requested', url: null, version: null }, failureReason: null };
const state = ['resolve', 'rollback'].includes(command ?? '') ? initial : await read(stateFile).catch(() => initial);
const output = async (name: string, value: string) => { if (process.env.GITHUB_OUTPUT) await fs.appendFile(process.env.GITHUB_OUTPUT, `${name}=${value}\n`); };
try {
  if (command === 'resolve') {
    if (process.env.EXPECTED_WEBSITE_COMMIT && process.env.EXPECTED_WEBSITE_COMMIT !== process.env.GITHUB_SHA) throw new Error('Website changed before dispatch; reload admin and retry');
    const requested = process.env.PHOTO_COMMITS ?? '';
    if (process.env.PHOTO_COMMIT) throw new Error('photo_commit is obsolete; use photo_commits keyed by every enabled sourceId');
    const config = loadSources();
    state.sources = sourceStatuses(config);
    const ids = selectedSources(config, process.env.SYNC_SOURCE_IDS);
    const fingerprint = await processingFingerprint();
    const partial = ids.length !== config.sources.filter(s => s.enabled).length;
    if ((process.env.SYNC_SOURCE_IDS || process.env.SYNC_BASELINE_RUN_ID) && (process.env.TASK_MODE !== 'sync' || process.env.PHOTO_RUN_ID)) throw new Error('Source selection is only supported for sync');
    if (process.env.SYNC_BASELINE_RUN_ID) {
      if (!/^[1-9][0-9]*$/.test(process.env.SYNC_BASELINE_RUN_ID)) throw new Error('Invalid baseline run');
      const response = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.SYNC_BASELINE_RUN_ID}`, { headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }, signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error('Baseline run cannot be verified');
      const run = await response.json() as any;
      if (run.head_branch !== 'main' || run.path !== '.github/workflows/automation.yml' || run.status !== 'completed' || run.repository?.full_name !== process.env.GITHUB_REPOSITORY || run.head_repository?.full_name !== process.env.GITHUB_REPOSITORY) throw new Error('Baseline must be a completed trusted main run');
      // A different sync may have completed while this request waited in Actions.
      // Never replace unselected sources using a superseded baseline.
      if (partial) {
        const recentResponse = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/actions/workflows/automation.yml/runs?branch=main&status=completed&per_page=100`, { headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }, signal: AbortSignal.timeout(20000) });
        if (!recentResponse.ok) throw new Error('Cannot revalidate partial-sync baseline');
        const recent = await recentResponse.json() as any;
        if (!Array.isArray(recent.workflow_runs) || !recent.workflow_runs.some((r:any) => String(r.id) === process.env.SYNC_BASELINE_RUN_ID)) throw new Error('Baseline no longer in recent history; refresh preview');
        for (const newer of recent.workflow_runs.filter((r:any) => r.id !== run.id && Date.parse(r.run_started_at ?? r.updated_at) >= Date.parse(run.run_started_at ?? run.updated_at))) {
          const response = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/actions/runs/${newer.id}/artifacts?per_page=100`, { headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }, signal: AbortSignal.timeout(20000) });
          if (!response.ok) throw new Error('Cannot check intervening photo sync');
          const artifacts = await response.json() as any;
          if (!Array.isArray(artifacts.artifacts) || artifacts.total_count > artifacts.artifacts.length || artifacts.artifacts.some((a:any) => a.name === 'photos')) throw new Error('Photo baseline changed while queued; refresh preview and retry');
        }
      }

    }
    const baseline = await readBaseline(process.env.SYNC_BASELINE_RUN_ID ? path.join(root, 'sync-baseline') : undefined, fingerprint, partial, true);
    const commits = process.env.SYNC_SOURCE_IDS && requested
      ? Object.fromEntries(combinedSnapshot(config, ids, JSON.parse(requested), baseline).sources.map(s => [s.sourceId, s.commit]))
      : parseCommits(requested, config);
    if (partial && !commits) throw new Error('Partial sync requires pinned selected commits');
    state.syncSourceIds = ids;

    if (process.env.PHOTO_RUN_ID && (!/^\d+$/.test(process.env.PHOTO_RUN_ID) || !requested)) throw new Error('Reusing photo_run_id requires its exact photo_commits');
    if (process.env.PHOTO_RUN_ID) {
      const response = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.PHOTO_RUN_ID}`, { headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }, signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new Error(`Cannot verify photo artifact run (${response.status})`);
      const run = await response.json() as any;
      if (run.head_branch !== 'main' || run.path !== '.github/workflows/automation.yml' || run.status !== 'completed') throw new Error('Photo artifacts must come from a completed main automation run');
      // A website failure does not negate a successfully uploaded photo artifact.
    }
    const { installReadOnlyFetch } = await import('../photos/network.js'); installReadOnlyFetch([]);
    state.photoSnapshot = await resolveSnapshot(config, commits, state.sources, config.sources.filter(s => s.enabled && !ids.includes(s.sourceId)).map(s => s.sourceId));
    await fs.writeFile(path.join(root, 'snapshot.json'), JSON.stringify(state.photoSnapshot));
    await output('snapshot_version', state.photoSnapshot.version);
    await output('config_digest', state.photoSnapshot.configDigest);
    await output('fingerprint', fingerprint);
    state.fingerprint = fingerprint;
  } else if (command === 'photos') {
    if (!process.env.PHOTO_RUN_ID) {
      const invocationId = randomUUID();
      const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/photos/sync.ts', '--snapshot', path.join(root, 'snapshot.json'), ...(process.env.SYNC_SOURCE_IDS ? ['--source-ids', process.env.SYNC_SOURCE_IDS] : []), ...(process.env.SYNC_FIRST_RUN === 'true' ? ['--first-sync'] : []), ...(process.env.SYNC_BASELINE_RUN_ID ? ['--baseline', path.join(root, 'sync-baseline')] : [])], { stdio: 'inherit', env: { ...process.env, JASON_PHOTO_SYNC_ID: invocationId } });
      const syncResult = await read('.cache/photo-engine/last-sync-result.json').catch(() => null);
      if (syncResult?.invocationId === invocationId) state.sources = syncResult.sources;
      if (result.error || result.status !== 0 || syncResult?.invocationId !== invocationId) throw new Error(syncResult?.invocationId === invocationId ? syncResult.failureReason ?? 'Photo processing failed' : 'Photo sync did not produce a result for this invocation; previous output is not publishable');
      state.sync = syncResult.sync;
      await fs.rm(path.join(root, 'photos'), { recursive: true, force: true });
      await fs.cp(await fs.realpath('.cache/photo-engine/output'), path.join(root, 'photos'), { recursive: true });
    }
    const artifact = await verifyCollection(path.join(root, 'photos'), { config: loadSources(), snapshot: state.photoSnapshot, fingerprint: state.fingerprint, production: true });
    state.sources = artifact.sources.map(s => process.env.PHOTO_RUN_ID && s.status === 'success' ? { ...s, processed: 0, reused: s.total } : s);
    state.photos = { status: 'success', total: artifact.photos, processed: process.env.PHOTO_RUN_ID ? 0 : artifact.processed, reused: process.env.PHOTO_RUN_ID ? artifact.photos : artifact.reused, artifactVersion: artifact.version, producerWebsiteCommit: artifact.websiteCommit, artifactRunId: process.env.PHOTO_RUN_ID || process.env.GITHUB_RUN_ID };
  } else if (command === 'build') {
    if (state.photos.status !== 'success') throw new Error('Current run has no verified photo artifact');
    const release = await buildRelease({ photos: path.join(root, 'photos'), root: process.cwd(), destination: path.join(root, 'release'), websiteCommit: state.websiteCommit, runId: process.env.GITHUB_RUN_ID ?? 'local', runNumber: Number(process.env.GITHUB_RUN_NUMBER ?? 0), production: true });
    state.website = { status: 'success', version: release.version, publishedProjects: release.publishedProjects, publicPhotos: release.publicPhotos };
  } else if (command === 'deploy') {
    if (state.website.status !== 'success') throw new Error('Current run has no successful website build');
    const release = await verifyRelease(path.join(root, 'release'));
    const photos = await verifyCollection(path.join(root, 'photos'), { config: loadSources(), snapshot: state.photoSnapshot, fingerprint: state.fingerprint, production: true });
    if (release.version !== state.website.version || release.websiteCommit !== state.websiteCommit || release.photoArtifactVersion !== photos.version) throw new Error('Release does not match current run');
    state.deployment = await deployRelease(path.join(root, 'release'));
  } else if (command === 'rollback') {
    state.deployment = await rollbackDeployment(process.env.DEPLOYMENT_ID ?? '');
    state.websiteCommit = state.deployment.websiteCommit; state.photoSnapshot = null; state.restoredPhotoSnapshotVersion = state.deployment.photoSnapshotVersion;
  } else if (command === 'summary') {
    const jobStatus = process.env.JOB_STATUS;
    state.result = jobStatus === 'success' ? 'success' : jobStatus ?? 'failure';
    if (state.result !== 'success' && !state.failureReason) state.failureReason = `Workflow ${state.result}; inspect failed/cancelled step in Actions (checkout, dependencies, checks or artifact transfer)`;
    if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `\n\`\`\`json\n${JSON.stringify(state, null, 2)}\n\`\`\`\n`);
  } else throw new Error('Expected resolve, photos, build, deploy, rollback or summary');
} catch (error) {
  state.result = 'failure';
  const reason = safeReason(error);
  state.failureReason = `${command}: ${reason}`;
  if (command === 'photos') state.photos.status = 'failure';
  if (command === 'build') state.website.status = 'failure';
  if (command === 'deploy' || command === 'rollback') state.deployment = { status: 'failure_or_unconfirmed', url: null, version: null };
  console.error(state.failureReason); process.exitCode = 1;
} finally { await fs.writeFile(stateFile, JSON.stringify(state, null, 2)); }
