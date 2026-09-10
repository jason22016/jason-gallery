import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deploymentConfig, packageFiles, sha256, verifyPackage } from './deployment';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const output = path.join(repo, '.cache/admin-deploy');
assert(process.argv.slice(2).every(v => v === '--verify') && process.argv.length <= 3, 'Usage: pnpm admin:prepare | pnpm admin:verify-package');
if (process.argv[2] === '--verify') {
  const manifest = await verifyPackage(output);
  console.log(JSON.stringify({ packageIntegrity: 'passed', configurationReady: manifest.configurationReady, productionReady: false, message: 'File integrity only; Cloudflare/Access/Free acceptance is separate.' }, null, 2));
} else {
  const settingsFile = path.join(repo, 'admin/deployment.local.json');
  let settings;
  try { settings = JSON.parse(await fs.readFile(settingsFile, 'utf8')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    settings = JSON.parse(await fs.readFile(path.join(repo, 'admin/deployment.example.json'), 'utf8'));
  }
  const base = await fs.readFile(path.join(repo, 'admin/wrangler.jsonc'), 'utf8');
  const { config, missing } = deploymentConfig(base, settings);
  // Build in a fresh directory: a failed preparation never leaves a partial deploy config.
  await fs.mkdir(path.dirname(output), { recursive: true });
  const staging = await fs.mkdtemp(path.join(repo, '.cache/admin-deploy-build-'));
  const run = (args: string[]) => execFileSync(process.execPath, args, { cwd: repo, stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: path.join(repo, '.cache/admin-deploy-logs') } });
  try {
    run(['node_modules/vite/bin/vite.js', 'build', '--config', 'admin/vite.config.ts']);
    run(['node_modules/wrangler/bin/wrangler.js', 'deploy', '--dry-run', '--config', 'admin/wrangler.jsonc', '--outdir', path.join(staging, 'bundle')]);
    await fs.cp(path.join(repo, '.cache/admin-release'), path.join(staging, 'assets'), { recursive: true });
    const assets = await packageFiles(path.join(staging, 'assets'));
    assert(assets['index.html'] && Object.keys(assets).every(name => name === 'index.html' || /^assets\/[a-zA-Z0-9_-]+\.(?:js|css)$/.test(name)), 'Only compiled admin HTML/JS/CSS may be uploaded');
    if (missing.length === 0) {
      await fs.writeFile(path.join(staging, 'wrangler.json'), JSON.stringify(config, null, 2) + '\n');
      // Validate portable paths and no_bundle using the exact package, without upload.
      run(['node_modules/wrangler/bin/wrangler.js', 'deploy', '--dry-run', '--config', path.join(staging, 'wrangler.json')]);
    }
    const manifest = {
      schemaVersion: 1, preparedAt: new Date().toISOString(),
      sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
      sourceDirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).trim()),
      baseConfigSha256: sha256(base), configurationReady: missing.length === 0, missingSettings: missing,
      // Local builds and assertions never attest to a Cloudflare deployment or Free suitability.
      productionReady: false, freeAcceptance: 'unverified; cold CPU exceeds local 10 ms reference',
      remoteChecks: ['Cloudflare account and chosen workers.dev subdomain (or active custom zone)', 'Whole-host Access OTP application, AUD and exact email policy', 'Website-only PAT secret and GitHub permissions', 'Access Cache API limitation: verify sustained cache misses and Free CPU, expiry, conflicts and browser timings'],
      files: await packageFiles(staging),
    };
    await fs.writeFile(path.join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    await verifyPackage(staging);
    await fs.rm(output, { recursive: true, force: true });
    await fs.rename(staging, output);
    console.log(JSON.stringify({ output, packageIntegrity: 'passed', configurationReady: manifest.configurationReady, missingSettings: missing, productionReady: false, note: 'Prepared locally. No upload, secret write, domain change or deployment was performed.' }, null, 2));
  } finally { await fs.rm(staging, { recursive: true, force: true }); }
}
