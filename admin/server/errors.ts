export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}
export function assert(value: unknown, message: string): asserts value {
  if (!value) throw new ApiError(422, 'invalid', message);
}
export async function bytes(response: Response, limit: number) {
  if (!response.body) return new Uint8Array();
  // Workers' native reader can coalesce small network fragments before entering
  // JavaScript. Keep the same hard byte limit and bound each allocation to 256 KiB.
  let native: ReadableStreamBYOBReader | undefined;
  try { native = response.body.getReader({ mode: 'byob' }); } catch { /* Non-byte test streams use the standard reader. */ }
  const readAtLeast = (native as any)?.readAtLeast;
  if (native && typeof readAtLeast !== 'function') { native.releaseLock(); native = undefined; }
  const reader = native ?? response.body.getReader();
  const chunks: Uint8Array[] = []; let length = 0; let complete = false;
  try { for (;;) {
    const size = Math.min(256 * 1024, limit - length + 1);
    const { done, value } = native ? await readAtLeast.call(native, size, new Uint8Array(size)) : await (reader as ReadableStreamDefaultReader<Uint8Array>).read();
    if (value?.length) { length += value.length; if (length > limit) throw new ApiError(413, 'too_large', '内容超出后台处理上限'); chunks.push(value); }
    // readAtLeast returns a partial final buffer with done:false at EOF.
    if (done || native && value.length < size) { complete = true; break; }
  } }
  finally { if (!complete) await reader.cancel().catch(() => {}); reader.releaseLock(); }
  if (chunks.length === 1) return chunks[0]!;
  const result = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}
export const jsonBody = async (response: Response, limit = 8 * 1024 * 1024) => JSON.parse(new TextDecoder().decode(await bytes(response, limit)));
