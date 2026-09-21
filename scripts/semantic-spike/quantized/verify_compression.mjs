// Verify lossless standard HTTP compression, including the shared runtime assets.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {brotliDecompressSync} from 'node:zlib';
import assert from 'node:assert/strict';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const out=path.join(root,'.cache/semantic-spike/quantized');
const manifest=JSON.parse(await fs.readFile(path.join(out,'compression.json')));
for(const f of manifest.files){
  const packed=await fs.readFile(path.join(out,f.file));
  assert.equal(packed.length,f.bytes);
  const decoded=brotliDecompressSync(packed);
  assert.equal(decoded.length,f.rawBytes);
  assert.equal(createHash('sha256').update(decoded).digest('hex'),f.sha256);
}
console.log(`${manifest.files.length} compressed assets decode to their exact original SHA-256`);
