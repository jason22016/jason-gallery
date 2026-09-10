import { Reader, ZipReader, Uint8ArrayWriter, type Entry } from '@zip.js/zip.js';
import { ApiError, bytes } from './errors';
import { ArtifactCache } from './cache';
import type { GitHub } from './github';
// Only signed, time-limited GitHub artifact storage URLs are followed. No authorization header follows the redirect.
class RangeReader extends Reader<string> {
  private transferred = 0;
  constructor(readonly url: string, readonly transport: typeof fetch, readonly cache: ArtifactCache, readonly cacheKey: string, readonly ttl: number) { super(url); }
  async init() {
    const cached = await this.cache.get(this.cacheKey + '/size');
    if (cached) { this.size = Number(await cached.text()); return; }
    const res = await this.transport(this.url, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(15000) });
    const size = Number(res.headers.get('content-length'));
    if (!res.ok || !size || size > 1024 ** 3) throw new ApiError(422, 'archive', '照片包不可读取或超过 1 GB 上限');
    this.size = size;
    await this.cache.put(this.cacheKey + '/size', String(size), this.ttl);
  }
  async readUint8Array(index: number, length: number) {
    this.transferred += length;
    if (index < 0 || length < 0 || length > 8 * 1024 ** 2 || this.transferred > 32 * 1024 ** 2) throw new ApiError(413, 'archive', '照片包索引超过后台按需读取上限');
    const key = this.cacheKey + `/range/${index}-${length}`;
    const cached = await this.cache.get(key); if (cached) return bytes(cached, length);
    const res = await this.transport(this.url, { headers: { Range: `bytes=${index}-${index + length - 1}` }, redirect: 'manual', signal: AbortSignal.timeout(15000) });
    if (res.status !== 206 || res.headers.get('content-range') !== `bytes ${index}-${index + length - 1}/${this.size}`) { await res.body?.cancel(); throw new ApiError(502, 'archive', '照片存储未返回所请求的字节范围'); }
    const value = await bytes(res, length); if (value.length !== length) throw new ApiError(502, 'archive', '照片包读取不完整'); await this.cache.put(key, value, this.ttl); return value;
  }
}
export async function archive(github: GitHub, artifact: any) {
  if (!Number.isSafeInteger(artifact.id) || artifact.id <= 0 || !Number.isFinite(Date.parse(artifact.expires_at))) throw new ApiError(422, 'archive', '产物描述无效');
  if (artifact.expired || Date.parse(artifact.expires_at) <= Date.now()) throw new ApiError(410, 'expired', '照片产物已过期，请重新同步');
  const cache = new ArtifactCache(github.env.GITHUB_REPOSITORY);
  const ttl = Math.floor((Date.parse(artifact.expires_at) - Date.now()) / 1000);
  let reader: ZipReader<unknown> | undefined;
  let entries: Map<string, Entry> | undefined;
  async function open() {
    if (entries) return entries;
    const response = await github.response(`/actions/artifacts/${artifact.id}/zip`);
    const location = response.headers.get('location'); await response.body?.cancel();
    let url: URL; try { url = new URL(location ?? ''); } catch { throw new ApiError(502, 'archive', 'GitHub 未返回有效的产物下载位置'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !['.blob.core.windows.net', '.actions.githubusercontent.com'].some(s => url.hostname.endsWith(s))) throw new ApiError(502, 'archive', 'GitHub 产物存储地址不在允许范围');
    reader = new ZipReader(new RangeReader(url.href, github.transport, cache, String(artifact.id), ttl), { useWebWorkers: false });
    const found = new Map<string, Entry>();
    try {
      for await (const entry of reader.getEntriesGenerator()) {
        if (found.size >= 30000 || found.has(entry.filename) || entry.filename.startsWith('/') || entry.filename.split('/').some(p => p === '..') || entry.encrypted) throw new ApiError(422, 'archive', '不支持此照片包结构');
        if (!entry.directory) found.set(entry.filename, entry);
      }
    } catch (error) { await reader.close(); reader = undefined; throw error; }
    entries = found; return found;
  }
  let expanded = 0;
  function account(size: number) {
    expanded += size;
    if (size > 8 * 1024 ** 2 || expanded > 8 * 1024 ** 2) throw new ApiError(413, 'archive', '单次解压内容超过后台 8 MB 上限');
  }
  return { close: async () => { await reader?.close(); }, read: async (name: string) => {
    // Immutable artifact bytes only. Callers still validate metadata/file hashes every time.
    // Cache loss or failure falls back to the same bounded ZIP validation, never partial data.
    const key = `${artifact.id}/file/${encodeURIComponent(name)}`;
    const cached = await cache.get(key);
    if (cached) { const value = await bytes(cached, 8 * 1024 ** 2); account(value.length); return value; }
    const entry = (await open()).get(name);
    if (!entry || !('getData' in entry)) throw new ApiError(422, 'archive', '产物文件缺失或过大');
    account(entry.uncompressedSize);
    const value = await entry.getData!(new Uint8ArrayWriter(), { useWebWorkers: false, checkSignature: true });
    await cache.put(key, value, ttl);
    return value;
  } };
}
