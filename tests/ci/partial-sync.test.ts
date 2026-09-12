import test from 'node:test';
import assert from 'node:assert/strict';
import { selectedSources, combinedSnapshot } from '../../scripts/photos/partial-sync';
import { LEGACY_SOURCE, makeSnapshot, parseSources } from '../../src/photo-engine/source-contract';
import type { PhotoCollection } from '../../scripts/photos/collection';
const config=parseSources({schemaVersion:1,sources:[LEGACY_SOURCE,{...LEGACY_SOURCE,sourceId:'second',repo:'second'}]});
const baseline={snapshot:makeSnapshot(config,{'jason-photos':'a'.repeat(40),second:'b'.repeat(40)})} as PhotoCollection;
test('partial snapshot combines selected commits with compatible unselected baseline only',()=>{
  const next=combinedSnapshot(config,['jason-photos'],{'jason-photos':'c'.repeat(40)},baseline);
  assert.equal(next.sources.find(s=>s.sourceId==='second')!.commit,'b'.repeat(40));
  assert.equal(next.sources.find(s=>s.sourceId==='jason-photos')!.commit,'c'.repeat(40));
  assert.throws(()=>combinedSnapshot(config,['jason-photos'],{'jason-photos':'c'.repeat(40)}),/full sync/);
  assert.throws(()=>combinedSnapshot({...config,sources:config.sources.map(s=>s.sourceId==='second'?{...s,path:'changed'}:s)},['jason-photos'],{'jason-photos':'c'.repeat(40)},baseline),/full sync/);
  assert.throws(()=>combinedSnapshot(config,['jason-photos'],{'jason-photos':'c'.repeat(40),second:'d'.repeat(40)},baseline),/exactly/);
  assert.throws(()=>selectedSources(config,'[]'));assert.throws(()=>selectedSources(config,'["second","second"]'));assert.throws(()=>selectedSources(config,'["unknown"]'));
  assert.deepEqual(selectedSources({...config,sources:config.sources.map(s=>({...s,enabled:false}))}),[]);
});
