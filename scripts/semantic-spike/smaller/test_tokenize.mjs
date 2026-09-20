import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {encodeInputs} from './tokenize.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const {Tokenizer}=await import(path.join(root,'.cache/semantic-spike/phase2a/runtime/node_modules/@huggingface/tokenizers/dist/tokenizers.mjs'));
for(const name of ['baseline','trim32k','trim64k','multiclip','mobileclip2']) {
 test(`${name}: 66 queries and 19 Unicode/photography/boundary probes match Python`,()=>{
  const p=path.join(root,'.cache/semantic-spike/smaller',name);
  const read=f=>JSON.parse(fs.readFileSync(path.join(p,f)));
  const data=read('dataset.json');const tok=new Tokenizer(read('tokenizer.json'),read('tokenizer_config.json'));
  assert.equal(data.fixtures.length,85);
  for(const q of data.fixtures)for(const [key,value] of Object.entries(encodeInputs(tok,q.text,data.kind)))assert.deepEqual(value,q[key],`${q.id}: ${key}`);
 });
}
