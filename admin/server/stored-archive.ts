import type { GitHub } from './github';
import { ApiError, bytes } from './errors';
import { sha256 } from './read-contract';

export function alive(info: any) {
  if (!info || !Number.isSafeInteger(info.id) || info.id <= 0 || !Number.isFinite(Date.parse(info.expires_at))) throw new ApiError(422, 'integrity', '产物身份或期限无效');
  if (info.expired || Date.parse(info.expires_at) <= Date.now()) throw new ApiError(410, 'expired', '照片产物缺失或已过期，请重新同步');
}
function invalid(): never { throw new ApiError(422, 'integrity', '后台读取产物结构或字节范围无效', undefined, { stage: 'archive_structure' }); }
function unsupported(): never { throw new ApiError(422, 'format', '这是旧版或不支持的后台产物；请运行一次新版同步，历史摘要可在 Actions 查看'); }
interface StoredEntry { name: string; offset: number; size: number; flags: number }
function text(value: Uint8Array) { try { return new TextDecoder('utf-8', { fatal: true }).decode(value); } catch { return invalid(); } }

// Only the two explicitly generated files (or a single summary) are accepted.
// No codecs, ZIP64, archive extraction, or directory scans proportional to photos.
function directory(tail: Uint8Array, base: number, size: number, names: string[]) {
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let eocd = -1;
  for (let p = tail.length - 22; p >= 0; p--) {
    if (view.getUint32(p, true) === 0x06054b50 && p + 22 + view.getUint16(p + 20, true) === tail.length) { eocd = p; break; }
  }
  if (eocd < 0) invalid();
  const count = view.getUint16(eocd + 10, true), length = view.getUint32(eocd + 12, true), start = view.getUint32(eocd + 16, true);
  if (view.getUint16(eocd + 4, true) || view.getUint16(eocd + 6, true) || view.getUint16(eocd + 8, true) !== count || count !== names.length || start < base || start + length !== base + eocd) invalid();
  const entries = new Map<string, StoredEntry>(); let p = start - base;
  for (let i = 0; i < count; i++) {
    if (p + 46 > eocd || view.getUint32(p, true) !== 0x02014b50) invalid();
    const flags = view.getUint16(p + 8, true), method = view.getUint16(p + 10, true);
    const compressed = view.getUint32(p + 20, true), uncompressed = view.getUint32(p + 24, true);
    const nameLength = view.getUint16(p + 28, true), extra = view.getUint16(p + 30, true), comment = view.getUint16(p + 32, true);
    const end = p + 46 + nameLength + extra + comment, offset = view.getUint32(p + 42, true);
    if (method !== 0) unsupported();
    if ((flags & ~0x0808) || compressed !== uncompressed || offset >= start || end > eocd || view.getUint16(p + 34, true)) invalid();
    const name = text(tail.subarray(p + 46, p + 46 + nameLength));
    if (!names.includes(name) || entries.has(name) || [...entries.values()].some(e => e.offset === offset)) invalid();
    // ZIP64 sentinel values and extra fields are rejected even for tiny files.
    for (let x = p + 46 + nameLength; x < p + 46 + nameLength + extra;) {
      if (x + 4 > end || view.getUint16(x, true) === 1) invalid();
      x += 4 + view.getUint16(x + 2, true);
      if (x > p + 46 + nameLength + extra) invalid();
    }
    entries.set(name, { name, offset, size: uncompressed, flags }); p = end;
  }
  if (p !== eocd || size > 1024 ** 3) invalid();
  return { entries, start };
}

function localOffset(header: Uint8Array, entry: StoredEntry, start: number, entries: Map<string, StoredEntry>) {
  if (header.length < 30) invalid();
  const h = new DataView(header.buffer, header.byteOffset, header.byteLength);
  if (h.getUint32(0, true) !== 0x04034b50 || h.getUint16(6, true) !== entry.flags || h.getUint16(8, true) !== 0 || h.getUint16(26, true) !== header.length - 30 || text(header.subarray(30)) !== entry.name) invalid();
  const offset = entry.offset + header.length + h.getUint16(28, true);
  const next = Math.min(start, ...[...entries.values()].filter(e => e.offset > entry.offset).map(e => e.offset));
  if (offset + entry.size > next || (!(entry.flags & 8) && (h.getUint32(18, true) !== entry.size || h.getUint32(22, true) !== entry.size))) invalid();
  return offset;
}

// CI-only full-file inspection. The Worker exclusively uses bounded ranges below.
export function storedFiles(archive: Uint8Array, names: string[]) {
  const { entries, start } = directory(archive, 0, archive.length, names);
  return new Map([...entries].map(([name, entry]) => {
    const offset = localOffset(archive.subarray(entry.offset, entry.offset + 30 + new TextEncoder().encode(name).length), entry, start, entries);
    return [name, archive.subarray(offset, offset + entry.size)];
  }));
}

export async function storedArchive(github: GitHub, info: any, names: string[], small = false) {
  alive(info);
  const redirected = await github.response(`/actions/artifacts/${info.id}/zip`);
  const location = redirected.headers.get('location'); await redirected.body?.cancel();
  let url: URL;
  try { url = new URL(location ?? ''); } catch { throw new ApiError(502, 'unavailable', 'GitHub 未返回有效的产物下载位置'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !['.blob.core.windows.net', '.actions.githubusercontent.com'].some(s => url.hostname.endsWith(s))) invalid();
  const fetchBytes = async (range?: string, limit = 8 * 1024 ** 2) => {
    const response = await github.transport(url.href, { redirect: 'manual', headers: range ? { Range: range } : {}, signal: AbortSignal.timeout(15000) });
    if (response.status !== (range ? 206 : 200)) { await response.body?.cancel(); throw new ApiError(502, 'storage_http', '产物存储读取失败，请稍后重试', undefined, { stage: 'artifact_download', upstreamStatus: response.status }); }
    const value = await bytes(response, limit);
    return { value, contentRange: response.headers.get('content-range') };
  };
  let whole: Uint8Array | undefined, size: number, tail: Uint8Array, tailStart: number;
  if (small) {
    whole = (await fetchBytes(undefined, 512000)).value;
    if (typeof info.digest !== 'string' || info.digest !== `sha256:${sha256(whole)}`) throw new ApiError(422, 'integrity', '执行摘要的 GitHub 产物摘要不匹配');
    size = whole.length; tail = whole; tailStart = 0;
  } else {
    // Azure Blob documents explicit start/end ranges, not HTTP suffix ranges.
    // GitHub's size is the finalized ZIP upload size; verify it against storage's
    // Content-Range rather than treating an unverified response length as truth.
    size = info.size_in_bytes;
    if (!Number.isSafeInteger(size) || size <= 0 || size > 1024 ** 3) invalid();
    tailStart = Math.max(0, size - 65536);
    const end = await fetchBytes(`bytes=${tailStart}-${size - 1}`, 65536);
    tail = end.value;
    if (end.contentRange !== `bytes ${tailStart}-${size - 1}/${size}` || tail.length !== size - tailStart) invalid();
  }
  const { entries, start } = directory(tail, tailStart, size, names);
  let transferred = tail.length;
  const range = async (offset: number, length: number) => {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || length > 8 * 1024 ** 2 || offset + length > size) invalid();
    if (!length) return new Uint8Array();
    if (whole) return whole.subarray(offset, offset + length);
    if (offset >= tailStart) return tail.subarray(offset - tailStart, offset - tailStart + length);
    transferred += length;
    if (transferred > 16 * 1024 ** 2) throw new ApiError(413, 'too_large', '后台产物单次读取超过上限');
    const result = await fetchBytes(`bytes=${offset}-${offset + length - 1}`, length);
    if (result.contentRange !== `bytes ${offset}-${offset + length - 1}/${size}` || result.value.length !== length) invalid();
    return result.value;
  };
  const offsets = new Map<string, number>();
  const dataOffset = async (entry: StoredEntry) => {
    const prior = offsets.get(entry.name); if (prior !== undefined) return prior;
    const header = await range(entry.offset, 30 + new TextEncoder().encode(entry.name).length);
    const offset = localOffset(header, entry, start, entries);
    offsets.set(entry.name, offset); return offset;
  };
  return {
    size: (name: string) => { const e = entries.get(name); if (!e) invalid(); return e.size; },
    read: async (name: string, offset = 0, length?: number) => {
      const e = entries.get(name); if (!e) invalid();
      length ??= e.size;
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 0 || offset + length > e.size) invalid();
      return range(await dataOffset(e) + offset, length);
    },
    close: async () => {},
  };
}

// CI seals this absolute range only after verifying the entire uploaded STORE ZIP.
// The immutable artifact identity, exact storage range and JPEG hash are checked
// on every read; no archive directory needs to be downloaded again.
export async function sealedPreview(github: GitHub, info: any, offset: number, length: number) {
  alive(info);
  if (!Number.isSafeInteger(info.size_in_bytes) || info.size_in_bytes > 1024 ** 3 || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length <= 0 || length > 8 * 1024 ** 2 || offset + length > info.size_in_bytes) invalid();
  const redirect = await github.response(`/actions/artifacts/${info.id}/zip`);
  const location = redirect.headers.get('location'); await redirect.body?.cancel();
  let url: URL;
  try { url = new URL(location ?? ''); } catch { invalid(); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !['.blob.core.windows.net', '.actions.githubusercontent.com'].some(s => url.hostname.endsWith(s))) invalid();
  const range = `bytes=${offset}-${offset + length - 1}`;
  let response: Response;
  try { response = await github.transport(url.href, { redirect: 'manual', headers: { Range: range }, signal: AbortSignal.timeout(15000) }); } catch { throw new ApiError(502, 'storage_network', '缩略图存储连接失败或超时，请稍后重试', undefined, { stage: 'preview_download' }); }
  if (response.status !== 206) { await response.body?.cancel(); throw new ApiError(502, 'storage_http', '产物存储读取失败，请稍后重试', undefined, { stage: 'artifact_download', upstreamStatus: response.status }); }
  if (response.headers.get('content-range') !== `bytes ${offset}-${offset + length - 1}/${info.size_in_bytes}`) { await response.body?.cancel(); throw new ApiError(422, 'integrity', '缩略图响应范围不匹配', undefined, { stage: 'preview_range' }); }
  let value: Uint8Array;
  try { value = await bytes(response, length); } catch (e) { if (e instanceof ApiError) throw e; throw new ApiError(502, 'storage_body', '缩略图下载中断，请稍后重试', undefined, { stage: 'preview_download' }); }
  if (value.length !== length) throw new ApiError(502, 'storage_body', '缩略图下载不完整，请稍后重试', undefined, { stage: 'preview_download' });
  return value;
}
