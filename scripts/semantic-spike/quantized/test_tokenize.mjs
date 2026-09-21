import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {encodeInputs} from './tokenize.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const {Tokenizer}=await import(path.join(root,'.cache/semantic-spike/phase2a/runtime/node_modules/@huggingface/tokenizers/dist/tokenizers.mjs'));
const out=path.join(root,'.cache/semantic-spike/quantized');
for(const name of fs.readdirSync(out).filter(n=>/^v\d+-/.test(n)&&fs.statSync(path.join(out,n)).isDirectory())) {
 test(`${name}: exact Python IDs for 105 queries and probes`,()=>{
  const r=f=>JSON.parse(fs.readFileSync(path.join(out,name,f)));const d=r('dataset.json'),t=new Tokenizer(r('tokenizer.json'),r('tokenizer_config.json'));
  assert.equal(d.fixtures.length,105);
  for(const q of d.fixtures)assert.deepEqual(encodeInputs(t,q.text,'siglip').input_ids,q.input_ids,q.id);
 });
}
