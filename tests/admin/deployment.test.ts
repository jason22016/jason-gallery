import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { deploymentConfig, packageFiles, verifyPackage } from '../../scripts/admin/deployment';
import { repo, run } from '../website/fixture';

const base = await fs.readFile(new URL('../../admin/wrangler.jsonc', import.meta.url), 'utf8');
const settings = { accountId: 'a'.repeat(32), adminOrigin: 'https://admin.gallery-owner.net', accessIssuer: 'https://gallery-owner.cloudflareaccess.com', accessAud: 'b'.repeat(64), adminEmails: ['owner@gallery-owner.net'] };

test('deployment preparation keeps whole-host authentication, repository isolation and publishing disabled', () => {
  const { config, missing } = deploymentConfig(base, settings);
  assert.deepEqual(missing, []);
  assert.equal(config.account_id, settings.accountId);
  assert.deepEqual(config.routes, [{ pattern: 'admin.gallery-owner.net', custom_domain: true }]);
  assert.equal(config.vars.ADMIN_ORIGIN, settings.adminOrigin);
  assert.equal(config.vars.ACCESS_AUD, settings.accessAud);
  assert.equal(config.vars.ADMIN_EMAILS, settings.adminEmails[0]);
  assert.equal(config.vars.GITHUB_REPOSITORY, 'jason22016/jason-gallery');
  assert.equal(config.vars.PUBLISH_ENABLED, 'false');
  assert.equal(config.assets.run_worker_first, true);
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.equal(config.no_bundle, true);
  assert.equal(config.main, 'bundle/worker.js');
  assert.equal(config.assets.directory, 'assets');
  assert.equal(config.vars.GITHUB_TOKEN, undefined);
});

test('manual publishing is an explicit deployment setting and defaults off', () => {
  assert.equal(deploymentConfig(base, { ...settings, publishEnabled: true }).config.vars.PUBLISH_ENABLED, 'true');
  assert.deepEqual(deploymentConfig(base, { ...settings, publishEnabled: true }).missing, []);
  assert.equal(deploymentConfig(base, { ...settings, publishEnabled: false }).config.vars.PUBLISH_ENABLED, 'false');
  for (const publishEnabled of ['true', 'false', 1, null]) assert.throws(() => deploymentConfig(base, { ...settings, publishEnabled }));
});

test('blank configuration remains incomplete; malformed origins, secrets and unsafe base changes are rejected', () => {
  assert.deepEqual(deploymentConfig(base, { accountId: '', adminOrigin: '', accessIssuer: '', accessAud: '', adminEmails: [] }).missing, ['accountId', 'adminOrigin', 'accessIssuer', 'accessAud', 'adminEmails']);
  for (const adminOrigin of ['http://admin.gallery-owner.net', 'https://admin.gallery-owner.net/', 'https://admin.gallery-owner.net/api', 'https://user:password@admin.gallery-owner.net', 'https://admin.gallery-owner.net:8443', 'https://worker.workers.dev', 'https://admin.example.com', 'https://127.0.0.1']) {
    assert.throws(() => deploymentConfig(base, { ...settings, adminOrigin }));
  }
  for (const changed of [{ GITHUB_TOKEN: 'must-not-enter-package' }, { accountId: 'wrong' }, { accessIssuer: 'https://identity.attacker.net' }, { accessAud: 'placeholder' }, { adminEmails: ['*@gallery-owner.net'] }, { adminEmails: ['Owner@gallery-owner.net', 'owner@gallery-owner.net'] }]) {
    assert.throws(() => deploymentConfig(base, { ...settings, ...changed }));
  }
  for (const changed of [base.replace('"workers_dev": false', '"workers_dev": true'), base.replace('"preview_urls": false', '"preview_urls": true'), base.replace('"run_worker_first": true', '"run_worker_first": false'), base.replace('"PUBLISH_ENABLED": "false"', '"PUBLISH_ENABLED": "true"'), base.replace('"observability":', '"limits": {"cpu_ms": 30000}, "observability":')]) {
    assert.throws(() => deploymentConfig(changed, settings));
  }
});

test('default workers.dev hostname enables only the named Worker and retains Access server checks', () => {
  const { config, missing } = deploymentConfig(base, { ...settings, adminOrigin: 'https://jason-gallery-admin.gallery-owner.workers.dev' });
  assert.deepEqual(missing, []);
  assert.equal(config.workers_dev, true);
  assert.equal(config.preview_urls, false);
  assert.equal(config.routes, undefined);
  assert.equal(config.assets.run_worker_first, true);
  assert.equal(config.vars.ACCESS_AUD, settings.accessAud);
  assert.equal(config.vars.ADMIN_ORIGIN, 'https://jason-gallery-admin.gallery-owner.workers.dev');
  assert.equal(config.vars.PUBLISH_ENABLED, 'false');
  for (const host of ['other-worker.gallery-owner.workers.dev', '123-jason-gallery-admin.gallery-owner.workers.dev', 'jason-gallery-admin.gallery.owner.workers.dev']) assert.throws(() => deploymentConfig(base, { ...settings, adminOrigin: `https://${host}` }));
});

test('deployment manifest detects missing, extra, changed files and symlinks, including an unexpected asset manifest', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gallery-deploy-test-'));
  try {
    await fs.mkdir(path.join(root, 'bundle'));
    await fs.mkdir(path.join(root, 'assets'));
    await fs.writeFile(path.join(root, 'bundle/worker.js'), 'export default {};');
    await fs.writeFile(path.join(root, 'assets/index.html'), '<!doctype html>');
    const manifest = { schemaVersion: 1, configurationReady: false, files: await packageFiles(root) };
    await fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest));
    await verifyPackage(root);
    await fs.writeFile(path.join(root, 'assets/manifest.json'), 'unexpected');
    assert((await packageFiles(path.join(root, 'assets')))['manifest.json']);
    await assert.rejects(verifyPackage(root), /Package changed/);
    await fs.rm(path.join(root, 'assets/manifest.json'));
    await fs.writeFile(path.join(root, 'bundle/worker.js'), 'tampered');
    await assert.rejects(verifyPackage(root), /Package changed/);
    await fs.rm(path.join(root, 'bundle/worker.js'));
    await assert.rejects(verifyPackage(root), /Package changed/);
    await fs.symlink('../assets/index.html', path.join(root, 'bundle/worker.js'));
    await assert.rejects(verifyPackage(root), /symlinks/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('portable deployment config resolves the formal bundle and assets in Wrangler dry-run', { timeout: 60000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gallery-deploy-dry-run-'));
  try {
    run(['node_modules/vite/bin/vite.js', 'build', '--config', 'admin/vite.config.ts'], repo);
    run(['node_modules/wrangler/bin/wrangler.js', 'deploy', '--dry-run', '--config', 'admin/wrangler.jsonc', '--outdir', path.join(root, 'bundle')], repo);
    await fs.cp(path.join(repo, '.cache/admin-release'), path.join(root, 'assets'), { recursive: true });
    for (const adminOrigin of [settings.adminOrigin, 'https://jason-gallery-admin.gallery-owner.workers.dev']) {
      await fs.writeFile(path.join(root, 'wrangler.json'), JSON.stringify(deploymentConfig(base, { ...settings, adminOrigin }).config));
      run(['node_modules/wrangler/bin/wrangler.js', 'deploy', '--dry-run', '--config', path.join(root, 'wrangler.json')], repo);
    }
    assert((await fs.stat(path.join(root, 'bundle/worker.js'))).size > 0);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
