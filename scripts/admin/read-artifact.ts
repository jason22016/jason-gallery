import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { readCollection } from '../../src/photo-engine/collection-contract';
import { verifyCollection } from '../photos/collection';
import { processingFingerprint } from '../photos/fingerprint';
import { loadSources } from '../../src/photo-engine/sources';
import { processingDigest, parseCatalog, sha256, type ReadCatalog } from '../../admin/server/read-contract';
import { storedArchive, storedFiles } from '../../admin/server/stored-archive';
import { GitHub } from '../../admin/server/github';

type Identity = Pick<ReadCatalog, 'repository' | 'runId' | 'runAttempt' | 'websiteCommit' | 'photosArtifactId'>;
export async function buildReadFiles(collection: Awaited<ReturnType<typeof readCollection>>, identity: Identity, tree: Parameters<typeof processingDigest>[0]) {
  const sourceIds = new Map(collection.index.entries.map(e => [e.reference, e.sourceId]));
  const parts: Uint8Array[] = []; let offset = 0;
  const photos: ReadCatalog['photos'] = [];
  for (const p of collection.photos) {
    const bytes = await collection.read(`public/thumbnails/${p.id}.jpg`);
    assert(bytes.length <= 8 * 1024 ** 2 && bytes.length > 0);
    photos.push({ id: p.id, sourceId: sourceIds.get(p.id)!, title: p.title, width: p.width, height: p.height, offset, length: bytes.length, hash: sha256(bytes) });
    parts.push(bytes); offset += bytes.length; assert(offset <= 1024 ** 3);
  }
  const catalog: ReadCatalog = { schemaVersion: 1, ...identity, processingDigest: processingDigest(tree), artifact: { version: collection.artifact.version, websiteCommit: collection.artifact.websiteCommit!, snapshot: collection.artifact.snapshot }, aliases: [...collection.aliases], photos, previewBytes: offset };
  const catalogBytes = Buffer.from(JSON.stringify(catalog)); assert(catalogBytes.length <= 8 * 1024 ** 2);
  assert.deepEqual(parseCatalog(catalogBytes), catalog);
  const previews = Buffer.concat(parts);
  // Check the final layout and each byte, independently of the offset accumulation.
  for (const p of photos) assert.deepEqual(previews.subarray(p.offset, p.offset + p.length), Buffer.from(await collection.read(`public/thumbnails/${p.id}.jpg`)));
  return { catalog: catalogBytes, previews, catalogHash: sha256(catalogBytes) };
}

async function main() {
  const root = path.resolve('.cache/automation');
  const statePath = path.join(root, 'summary.json');
  const state = JSON.parse(await fs.readFile(statePath, 'utf8'));
  try {
    if (process.argv[2] === 'generate') {
      const directory = path.join(root, 'photos');
      const config = loadSources();
      await verifyCollection(directory, { config, snapshot: state.photoSnapshot, fingerprint: await processingFingerprint(), production: true });
      const collection = await readCollection(p => fs.readFile(path.join(directory, p)), config);
      const websiteCommit = process.env.GITHUB_SHA!;
      const tree = execFileSync('git', ['ls-tree', '-r', '-z', websiteCommit], { encoding: 'utf8' }).split('\0').filter(Boolean).map(line => {
        const [meta, name] = line.split('\t'); const [, type, sha] = meta!.split(' '); return { path: name!, type: type!, sha: sha! };
      });
      const identity = { repository: process.env.GITHUB_REPOSITORY!, runId: Number(process.env.GITHUB_RUN_ID), runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT), websiteCommit, photosArtifactId: Number(process.env.PHOTOS_ARTIFACT_ID) };
      const files = await buildReadFiles(collection, identity, tree);
      const target = path.join(root, 'admin-read');
      await fs.rm(target, { recursive: true, force: true }); await fs.mkdir(target, { recursive: true });
      await fs.writeFile(path.join(target, 'catalog.json'), files.catalog);
      await fs.writeFile(path.join(target, 'previews.bin'), files.previews);
      state.adminRead = { status: 'pending', ...identity, photosArtifactVersion: collection.artifact.version, catalogHash: files.catalogHash };
    } else if (process.argv[2] === 'verify-upload') {
      assert(state.adminRead?.status === 'pending');
      const artifactId = Number(process.env.ADMIN_READ_ARTIFACT_ID);
      const github = new GitHub({ GITHUB_REPOSITORY: process.env.GITHUB_REPOSITORY!, GITHUB_TOKEN: process.env.GITHUB_TOKEN! } as Env);
      const info = await github.call(`/actions/artifacts/${artifactId}`);
      assert.equal(info.name, 'admin-read');
      assert.equal(info.workflow_run.id, state.adminRead.runId);
      assert.equal(info.digest, process.env.ADMIN_READ_ARTIFACT_DIGEST?.startsWith('sha256:') ? process.env.ADMIN_READ_ARTIFACT_DIGEST : `sha256:${process.env.ADMIN_READ_ARTIFACT_DIGEST}`);
      const archive = await storedArchive(github, info, ['catalog.json', 'previews.bin']);
      const catalog = await archive.read('catalog.json');
      assert.equal(sha256(catalog), state.adminRead.catalogHash);
      const parsed = parseCatalog(catalog);
      assert.equal(archive.size('previews.bin'), parsed.previewBytes);
      // CI verifies the full uploaded archive independently of the Worker's
      // bounded catalog/preview reads.
      const response = await github.response(`/actions/artifacts/${artifactId}/zip`);
      const location = response.headers.get('location'); await response.body?.cancel();
      assert(location);
      // storedArchive already validated this artifact's redirect host. Validate this
      // fresh redirect too; credentials are never forwarded to storage.
      const url = new URL(location);
      assert(url.protocol === 'https:' && !url.username && !url.password && !url.port && ['.blob.core.windows.net', '.actions.githubusercontent.com'].some(s => url.hostname.endsWith(s)));
      const uploaded = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(120000) });
      assert(uploaded.ok);
      const { createHash } = await import('node:crypto'); const hash = createHash('sha256'); let size = 0;
      const chunks: Uint8Array[] = [];
      for await (const chunk of uploaded.body!) { size += chunk.length; assert(size <= 1024 ** 3); hash.update(chunk); chunks.push(chunk); }
      assert.equal(size, info.size_in_bytes);
      assert.equal(`sha256:${hash.digest('hex')}`, info.digest);
      const contents = storedFiles(Buffer.concat(chunks), ['catalog.json', 'previews.bin']);
      assert.deepEqual(Buffer.from(contents.get('catalog.json')!), await fs.readFile(path.join(root, 'admin-read/catalog.json')));
      assert.deepEqual(Buffer.from(contents.get('previews.bin')!), await fs.readFile(path.join(root, 'admin-read/previews.bin')));
      for (const p of parsed.photos) assert.equal(sha256(contents.get('previews.bin')!.subarray(p.offset, p.offset + p.length)), p.hash);
      state.adminRead = { ...state.adminRead, status: 'success', artifactId, artifactDigest: info.digest };
    } else throw new Error('Expected generate or verify-upload');
  } catch (error) {
    state.adminRead = { ...state.adminRead, status: 'failure' };
    throw error;
  } finally { await fs.writeFile(statePath, JSON.stringify(state, null, 2)); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
