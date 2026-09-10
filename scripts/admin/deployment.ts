import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { z } from 'zod';

// These are non-secret deployment coordinates, never credentials or Wrangler overrides.
const Settings = z.strictObject({
  accountId: z.string(), adminOrigin: z.string(), accessIssuer: z.string(),
  accessAud: z.string(), adminEmails: z.array(z.string()),
});
export function deploymentConfig(text: string, settings: unknown) {
  const parsed = ts.parseConfigFileTextToJson('admin/wrangler.jsonc', text);
  assert(!parsed.error, 'Invalid Wrangler JSONC');
  const base = parsed.config;
  assert(base.name === 'jason-gallery-admin' && base.main === 'server/worker.ts', 'Unexpected Worker entry');
  assert(base.workers_dev === false && base.preview_urls === false, 'Alternate public entry points must stay disabled');
  assert(base.assets?.run_worker_first === true && base.assets?.binding === 'ASSETS', 'Every asset must pass server authentication');
  assert(base.assets.directory === '../.cache/admin-release' && base.assets.not_found_handling === 'single-page-application', 'Unexpected admin assets');
  assert(base.vars?.PUBLISH_ENABLED === 'false', 'Initial deployment must keep publishing disabled');
  assert(base.vars.GITHUB_REPOSITORY === 'jason22016/jason-gallery', 'Unexpected website repository');
  assert.deepEqual(Object.keys(base.vars).sort(), ['ACCESS_AUD', 'ACCESS_ISSUER', 'ADMIN_EMAILS', 'ADMIN_ORIGIN', 'GITHUB_REPOSITORY', 'PUBLISH_ENABLED']);
  assert.deepEqual(base.secrets, { required: ['GITHUB_TOKEN'] });
  // Do not silently drop a newly added binding or route: require review of preparation too.
  const supported = new Set(['$schema', 'name', 'main', 'compatibility_date', 'compatibility_flags', 'workers_dev', 'preview_urls', 'assets', 'vars', 'secrets', 'observability']);
  assert(Object.keys(base).every(key => supported.has(key)), 'Review new Wrangler configuration fields before preparing deployment');
  const s = Settings.parse(settings);
  const missing = Object.entries(s).filter(([, value]) => value.length === 0).map(([key]) => key);
  if (s.accountId) assert(/^[a-f0-9]{32}$/.test(s.accountId), 'accountId must be a Cloudflare account ID');
  let workersDev = false;
  if (s.adminOrigin) {
    const url = new URL(s.adminOrigin);
    assert(url.protocol === 'https:' && url.origin === s.adminOrigin && !url.port && !url.username && !url.password, 'adminOrigin must be an HTTPS origin without path, port or credentials');
    assert(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(url.hostname), 'adminOrigin must use a DNS hostname');
    assert(!/(?:^|\.)(?:example\.(?:com|net|org)|example|test|invalid|localhost)$/.test(url.hostname), 'Use a real admin hostname');
    workersDev = url.hostname.endsWith('.workers.dev');
    if (workersDev) assert(/^jason-gallery-admin\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.workers\.dev$/.test(url.hostname), 'Use this Worker name and the account workers.dev subdomain, not a preview URL');
  }
  if (s.accessIssuer) assert(/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(s.accessIssuer), 'Invalid Access team issuer');
  if (s.accessAud) assert(/^[a-f0-9]{64}$/.test(s.accessAud), 'Use the Access application AUD tag');
  for (const email of s.adminEmails) assert(z.email().safeParse(email).success && email === email.trim(), 'Use explicit administrator email addresses');
  assert(new Set(s.adminEmails.map(email => email.toLowerCase())).size === s.adminEmails.length, 'Duplicate administrator email');
  const config = {
    ...base,
    workers_dev: workersDev,
    main: 'bundle/worker.js', no_bundle: true,
    assets: { ...base.assets, directory: 'assets' },
    vars: { ...base.vars, ADMIN_ORIGIN: s.adminOrigin, ACCESS_ISSUER: s.accessIssuer, ACCESS_AUD: s.accessAud, ADMIN_EMAILS: s.adminEmails.join(',') },
    ...(s.accountId ? { account_id: s.accountId } : {}),
    ...(s.adminOrigin && !workersDev ? { routes: [{ pattern: new URL(s.adminOrigin).hostname, custom_domain: true }] } : {}),
  };
  delete config.$schema; // This portable package does not include node_modules.
  return { config, missing };
}

export const sha256 = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export async function packageFiles(root: string, excludeManifest = false) {
  const files: Record<string, { bytes: number; sha256: string }> = {};
  async function walk(relative: string) {
    for (const entry of (await fs.readdir(path.join(root, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = path.posix.join(relative, entry.name);
      assert(!entry.isSymbolicLink(), 'Package cannot contain symlinks');
      if (entry.isDirectory()) await walk(name);
      else {
        assert(entry.isFile(), 'Package must contain regular files');
        if (excludeManifest && name === 'manifest.json') continue;
        const data = await fs.readFile(path.join(root, name));
        files[name] = { bytes: data.byteLength, sha256: sha256(data) };
      }
    }
  }
  await walk('');
  return files;
}
export async function verifyPackage(root: string) {
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'));
  assert(manifest.schemaVersion === 1, 'Unsupported package manifest');
  assert.deepEqual(await packageFiles(root, true), manifest.files, 'Package changed: regenerate with pnpm admin:prepare');
  assert(manifest.files['bundle/worker.js'] && manifest.files['assets/index.html'], 'Incomplete package');
  assert(manifest.configurationReady === Boolean(manifest.files['wrangler.json']), 'Configuration status mismatch');
  return manifest;
}
