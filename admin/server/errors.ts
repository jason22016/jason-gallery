export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}
export function assert(value: unknown, message: string): asserts value {
  if (!value) throw new ApiError(422, 'invalid', message);
}
export async function bytes(response: Response, limit: number) {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = []; let length = 0;
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > limit) throw new ApiError(413, 'too_large', '内容超出后台处理上限'); chunks.push(value); } }
  finally { await reader.cancel(); }
  const result = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}
export const jsonBody = async (response: Response, limit = 8 * 1024 * 1024) => JSON.parse(new TextDecoder().decode(await bytes(response, limit)));
