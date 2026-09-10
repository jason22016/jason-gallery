// No installed dependencies: also produces a result when installation/tests fail.
import fs from 'node:fs/promises';
const file = '.cache/automation/summary.json';
const state = await fs.readFile(file, 'utf8').then(JSON.parse).catch(() => ({
  schemaVersion: 2, action: process.env.TASK_MODE ?? 'publish', websiteCommit: process.env.GITHUB_SHA ?? null,
  photoSnapshot: null, sources: [], photos: { status: 'not_started', total: null, processed: null, reused: null },
  website: { status: 'not_started' }, deployment: { status: 'not_requested', url: null, version: null }, failureReason: null,
}));
if (state.action === 'publish' && state.website.status === 'success' && state.deployment.status === 'not_requested') state.deployment = { status: 'disabled', url: null, version: null, reason: 'Set repository variable AUTO_DEPLOY_ENABLED=true for automatic deployment, or manually dispatch mode=publish' };
state.requestId = process.env.ADMIN_REQUEST_ID || null;
state.result = process.env.JOB_STATUS ?? 'failure';
if (state.result !== 'success' && !state.failureReason) state.failureReason = `Workflow ${state.result}; inspect failed/cancelled Actions step`;
await fs.mkdir('.cache/automation', { recursive: true });
await fs.writeFile(file, JSON.stringify(state, null, 2));
if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `\n\`\`\`json\n${JSON.stringify(state, null, 2)}\n\`\`\`\n`);
