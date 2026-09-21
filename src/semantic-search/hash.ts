const encoder = new TextEncoder();

export async function sha256(value: ArrayBuffer | ArrayBufferView | string): Promise<string> {
  const bytes = typeof value === 'string'
    ? encoder.encode(value)
    : ArrayBuffer.isView(value)
      ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
      : new Uint8Array(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes.buffer instanceof ArrayBuffer ? bytes as Uint8Array<ArrayBuffer> : Uint8Array.from(bytes));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function responseBytes(response: Response, expectedBytes: number, onProgress?: (bytes: number) => void): Promise<ArrayBuffer> {
  if (!response.ok) throw new Error(`Request failed with HTTP ${response.status}`);
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    onProgress?.(buffer.byteLength);
    return buffer;
  }
  const output = new Uint8Array(expectedBytes);
  const reader = response.body.getReader();
  let offset = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      if (offset + value.byteLength > output.byteLength) throw new Error('Downloaded semantic asset is larger than its release contract');
      output.set(value, offset);
      offset += value.byteLength;
      onProgress?.(offset);
    }
  } finally {
    reader.releaseLock();
  }
  if (offset !== expectedBytes) throw new Error(`Downloaded semantic asset byte length mismatch: expected ${expectedBytes}, got ${offset}`);
  return output.buffer;
}
