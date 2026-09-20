import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Tokenizer} from '../../../.cache/semantic-spike/phase2a/runtime/node_modules/@huggingface/tokenizers/dist/tokenizers.mjs';
import {encodeQuery} from './tokenize.mjs';
const base=new URL('../../../.cache/semantic-spike/phase2a/assets/',import.meta.url);
const read=name=>JSON.parse(fs.readFileSync(new URL(name,base)));
const tokenizer=new Tokenizer(read('tokenizer.json'),read('tokenizer_config.json'));
test('all bilingual, Unicode, special-token and long-input IDs match the fixed PyTorch tokenizer',()=>{
 const fixtures=read('dataset.json').fixtures;
 assert.equal(fixtures.length,57);
 for(const fixture of fixtures)assert.deepEqual(encodeQuery(tokenizer,fixture.text),fixture.input_ids,fixture.id);
});
test('truncation reserves the EOS position, then pads to exactly 64',()=>{
 const fake={encode:()=>({ids:Array.from({length:100},(_,i)=>i+5)})};
 const ids=encodeQuery(fake,'long');
 assert.equal(ids.length,64);assert.equal(ids[62],67);assert.equal(ids[63],1);
 assert.deepEqual(encodeQuery({encode:()=>({ids:[]})},''),[1,...Array(63).fill(0)]);
});
