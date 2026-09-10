import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
interface Fixture { ref: string; files: Record<string, { file: string; commit: string }> }
export async function installFixture(file: string) {
  const fixture: Fixture = JSON.parse(await fs.readFile(file, 'utf8'));
  const data = new Map<string, { bytes: Buffer; sha: string; commit: string }>();
  for (const [key, entry] of Object.entries(fixture.files)) {
    const bytes = await fs.readFile(path.resolve(path.dirname(file), entry.file));
    const sha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    data.set(key, { bytes, sha, commit: entry.commit });
  }
  const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (method !== 'GET') throw new Error(`Attempted repository write: ${method}`);
    if (url.hostname === 'raw.githubusercontent.com') {
      const prefix = `/jason22016/jason-photos/${fixture.ref}/`;
      if (!url.pathname.startsWith(prefix)) throw new Error('Unpinned raw URL');
      const item = data.get(decodeURIComponent(url.pathname.slice(prefix.length)));
      return item ? new Response(new Uint8Array(item.bytes)) : response({}, 404);
    }
    const prefix = '/repos/jason22016/jason-photos';
    if (url.hostname !== 'api.github.com' || !url.pathname.startsWith(prefix)) throw new Error(`Unexpected network: ${url}`);
    const route = decodeURIComponent(url.pathname.slice(prefix.length));
    if (route === `/git/trees/${fixture.ref}`) return response({ truncated: false, tree: [...data].map(([key, item]) => ({ path: key, type: 'blob', mode: '100644', sha: item.sha, size: item.bytes.length })) });
    if (route === '/commits/main') return response({ sha: fixture.ref });
    if (route === '/commits') {
      if (url.searchParams.get('sha') !== fixture.ref) throw new Error('Unpinned history');
      const item = data.get(url.searchParams.get('path')!);
      return response(item ? [{ sha: item.commit }] : []);
    }
    if (url.searchParams.get('ref') !== fixture.ref) throw new Error('Unpinned contents');
    const key = route.replace(/^\/contents\//, '');
    const metadata = (key: string, type: string) => ({ type, path: key, name: path.posix.basename(key), sha: data.get(key)?.sha, size: data.get(key)?.bytes.length, download_url: `https://raw.githubusercontent.com/jason22016/jason-photos/${fixture.ref}/${key}` });
    if (data.has(key)) return response(metadata(key, 'file'));
    const children = new Map<string, string>();
    for (const name of data.keys()) if (name.startsWith(`${key}/`)) {
      const suffix = name.slice(key.length + 1).split('/');
      children.set(`${key}/${suffix[0]}`, suffix.length > 1 ? 'dir' : 'file');
    }
    return response([...children].map(([name, type]) => metadata(name, type)));
  };
}
