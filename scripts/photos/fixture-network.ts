import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { LEGACY_SOURCE } from '../../src/photo-engine/sources.js';
interface RepositoryFixture { owner?: string; repo?: string; branch?: string; ref: string; private?: boolean; fail?: boolean; rawStatus?: number; files: Record<string, { file: string; commit: string }> }
export async function installFixture(file: string) {
  const fixture = JSON.parse(await fs.readFile(file, 'utf8'));
  const repositories: RepositoryFixture[] = fixture.repositories ?? [fixture];
  const loaded = await Promise.all(repositories.map(async entry => {
    const repository = { owner: LEGACY_SOURCE.owner, repo: LEGACY_SOURCE.repo, branch: LEGACY_SOURCE.branch, ...entry };
    const data = new Map<string, { bytes: Buffer; sha: string; commit: string }>();
    for (const [key, entry] of Object.entries(repository.files)) {
      const bytes = await fs.readFile(path.resolve(path.dirname(file), entry.file));
      const sha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
      data.set(key, { bytes, sha, commit: entry.commit });
    }
    return { repository, data };
  }));
  const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (method !== 'GET') throw new Error(`Attempted repository write: ${method}`);
    const found = loaded.find(({ repository: r }) => url.hostname === 'raw.githubusercontent.com'
      ? url.pathname.startsWith(`/${r.owner}/${r.repo}/`)
      : url.hostname === 'api.github.com' && (url.pathname === `/repos/${r.owner}/${r.repo}` || url.pathname.startsWith(`/repos/${r.owner}/${r.repo}/`)));
    if (!found) throw new Error(`Unexpected fixture network: ${url}`);
    const { repository: r, data } = found;
    if (r.fail) return response({}, 403);
    if (url.hostname === 'raw.githubusercontent.com') {
      if (new Headers(init?.headers).has('authorization')) throw new Error('Credentials on public original request');
      if (r.rawStatus && r.rawStatus !== 200) return response({}, r.rawStatus);
      const prefix = `/${r.owner}/${r.repo}/${r.ref}/`;
      if (!url.pathname.startsWith(prefix)) throw new Error('Unpinned raw URL');
      const item = data.get(decodeURIComponent(url.pathname.slice(prefix.length)));
      return item ? new Response(new Uint8Array(item.bytes)) : response({}, 404);
    }
    const prefix = `/repos/${r.owner}/${r.repo}`;
    const route = decodeURIComponent(url.pathname.slice(prefix.length));
    if (route === '') return response({ private: r.private ?? false });
    if (route === `/git/trees/${r.ref}`) return response({ truncated: false, tree: [...data].map(([key, item]) => ({ path: key, type: 'blob', mode: '100644', sha: item.sha, size: item.bytes.length })) });
    if (route === `/commits/${r.branch}` || route === `/commits/${r.ref}`) return response({ sha: r.ref });
    if (route === '/commits') {
      if (url.searchParams.get('sha') !== r.ref) throw new Error('Unpinned history');
      const item = data.get(url.searchParams.get('path')!);
      return response(item ? [{ sha: item.commit }] : []);
    }
    if (url.searchParams.get('ref') !== r.ref) throw new Error('Unpinned contents');
    const key = route.replace(/^\/contents\/?/, '');
    const metadata = (key: string, type: string) => ({ type, path: key, name: path.posix.basename(key), sha: data.get(key)?.sha, size: data.get(key)?.bytes.length, download_url: `https://raw.githubusercontent.com/${r.owner}/${r.repo}/${r.ref}/${key}` });
    if (data.has(key)) return response(metadata(key, 'file'));
    const children = new Map<string, string>();
    const directory = key ? `${key}/` : '';
    for (const name of data.keys()) if (name.startsWith(directory)) {
      const suffix = name.slice(directory.length).split('/');
      children.set(`${directory}${suffix[0]}`, suffix.length > 1 ? 'dir' : 'file');
    }
    return response([...children].map(([name, type]) => metadata(name, type)));
  };
}
