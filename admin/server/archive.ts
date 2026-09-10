import { Reader, ZipReader, Uint8ArrayWriter, type Entry } from '@zip.js/zip.js';
import { ApiError, bytes } from './errors';
import type { GitHub } from './github';
// Only signed, time-limited GitHub artifact storage URLs are followed. No authorization header follows the redirect.
class RangeReader extends Reader<string> {
  private transferred = 0;
  constructor(readonly url: string, readonly transport: typeof fetch) { super(url); }
  async init() {
    const res = await this.transport(this.url, { method: 'HEAD', redirect: 'error', signal: AbortSignal.timeout(15000) });
    const size = Number(res.headers.get('content-length'));
    if (!res.ok || !size || size > 1024 ** 3) throw new ApiError(422, 'archive', '照片包不可读取或超过 1 GB 上限');
    this.size = size;
  }
  async readUint8Array(index: number, length: number) {
    this.transferred += length;
    if (index < 0 || length < 0 || length > 8 * 1024 ** 2 || this.transferred > 32 * 1024 ** 2) throw new ApiError(413, 'archive', '照片包索引超过后台按需读取上限');
    const res = await this.transport(this.url, { headers: { Range: `bytes=${index}-${index + length - 1}` }, redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (res.status !== 206 || res.headers.get('content-range') !== `bytes ${index}-${index + length - 1}/${this.size}`) { await res.body?.cancel(); throw new ApiError(502, 'archive', '照片存储未返回所请求的字节范围'); }
    const value = await bytes(res, length); if (value.length !== length) throw new ApiError(502, 'archive', '照片包读取不完整'); return value;
  }
}
export async function archive(github: GitHub, artifact: any) {
  if (artifact.expired || Date.parse(artifact.expires_at) <= Date.now()) throw new ApiError(410, 'expired', '照片产物已过期，请重新同步');
  const response = await github.response(`/actions/artifacts/${artifact.id}/zip`);
  const location = response.headers.get('location'); await response.body?.cancel();
  let url: URL; try { url = new URL(location ?? ''); } catch { throw new ApiError(502, 'archive', 'GitHub 未返回有效的产物下载位置'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !['.blob.core.windows.net', '.actions.githubusercontent.com'].some(s => url.hostname.endsWith(s))) throw new ApiError(502, 'archive', 'GitHub 产物存储地址不在允许范围');
  const reader = new ZipReader(new RangeReader(url.href, github.transport), { useWebWorkers: false });
  const entries = new Map<string, Entry>();
  for await (const entry of reader.getEntriesGenerator()) {
    if (entries.size >= 30000 || entries.has(entry.filename) || entry.filename.startsWith('/') || entry.filename.split('/').some(p => p === '..') || entry.encrypted) throw new ApiError(422, 'archive', '不支持此照片包结构');
    if (!entry.directory) entries.set(entry.filename, entry);
  }
  return { close: () => reader.close(), read: async (name: string) => {
    const entry = entries.get(name);
    if (!entry || !('getData' in entry) || entry.uncompressedSize > 8 * 1024 ** 2) throw new ApiError(422, 'archive', '产物文件缺失或过大');
    return entry.getData!(new Uint8ArrayWriter(), { useWebWorkers: false, checkSignature: true });
  } };
}
