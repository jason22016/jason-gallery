import test from 'node:test';
import assert from 'node:assert/strict';
import { photoInventory, diffPhotos } from '../../src/photo-engine/sync-diff';
import { LEGACY_SOURCE, makeSnapshot } from '../../src/photo-engine/source-contract';
import { AdminService } from '../../admin/server/service';
import { GitHub } from '../../admin/server/github';
import { previewSync } from '../../admin/server/sync-preview';
import { processingDigest } from '../../admin/server/read-contract';
const source = { ...LEGACY_SOURCE, sourceId: 'travel', name: '旅行' };
const tree = (files: Record<string,string>) => ({ truncated:false, tree:Object.entries(files).map(([key,sha]) => ({ path:'images/'+key, sha:sha.repeat(40), type:'blob', mode:'100644' })) });
test('inventory diff covers extensions, excludes, content, rename, companion and source identity', () => {
  const a = photoInventory(source,tree({'keep.JPG':'a','old.jpg':'b','live.heic':'c','live.MOV':'d','edit.png':'e','.afilmory/skip.jpg':'f','readme.md':'1'}));
  const b = photoInventory(source,tree({'keep.JPG':'a','new.jpg':'b','live.heic':'c','live.MOV':'e','edit.png':'f'}));
  const delta = diffPhotos(a,b);
  assert.deepEqual(delta.counts,{total:4,previous:4,added:1,updated:2,removed:1,unchanged:1});
  assert.equal(diffPhotos(a,photoInventory({...source,sourceId:'other'},tree({'keep.JPG':'a'}))).counts.added,1);
  assert.deepEqual(diffPhotos([],[]).counts,{total:0,previous:0,added:0,updated:0,removed:0,unchanged:0});
  assert.throws(()=>photoInventory(source,{...tree({}),truncated:true}),/不完整/);
  assert.throws(()=>photoInventory(source,{truncated:false,tree:[{path:'images/evil.jpg',sha:'a'.repeat(40),type:'blob',mode:'120000'}]}),/无效/);
});
function fixture() {
  const requests: {url:string;method:string}[]=[];
  let current = tree({'keep.jpg':'a','new.jpg':'c'});
  const old = tree({'keep.jpg':'a','old.jpg':'b'});
  let runs:any[]=[{id:1,status:'completed'}]; let summary:any={photos:{status:'success'}};
  const github=new GitHub({GITHUB_REPOSITORY:'owner/site',GITHUB_TOKEN:'site-secret'} as Env,async(input,init)=>{
    const url=String(input);requests.push({url,method:init?.method??'GET'});
    if(url.endsWith('/dispatches')) return new Response(null,{status:204});
    return Response.json(url.endsWith('?recursive=1') ? url.includes('b'.repeat(40)) ? old : current : url.includes('/commits/') ? {sha:'c'.repeat(40)} : {private:false});
  });
  github.runs=async()=>runs; github.verifyRun=(r:any)=>r;
  const service=new AdminService(github);
  const config={schemaVersion:1 as const,sources:[source]};
  const removed=photoInventory(source,old).find(p=>p.key==='old.jpg')!.reference;
  const content:any={head:'a'.repeat(40),tree:[],config,projects:[]};
  const catalog:any={runId:1,artifact:{version:'v1',snapshot:makeSnapshot(config,{travel:'b'.repeat(40)})},processingDigest:processingDigest([]),aliases:[],close:async()=>{}};
  service.content=async()=>content; service.catalog=async()=>catalog; service.summary=async()=>summary;
  return {service,requests,content,catalog,removed,setCurrent:(value:typeof current)=>current=value,setRuns:(value:any[])=>runs=value,setSummary:(value:any)=>summary=value};
}
test('preview is read-only; deleted Project references block dispatch; changed previews cannot dispatch',async()=>{
  const f=fixture();
  let result=await previewSync(f.service,['travel']);
  assert.equal(result.counts?.added,1);assert.equal(result.counts?.removed,1);
  assert(f.requests.every(r=>r.method==='GET'));
  f.content.projects=[{id:'p',title:'Project A',photos:[{photoId:f.removed}],coverPhotoId:f.removed}];
  result=await previewSync(f.service,['travel']);assert.equal(result.conflicts.length,1);
  await assert.rejects(()=>f.service.dispatch({mode:'sync',expectedHead:f.content.head,sourceIds:['travel'],previewRevision:result.revision}),/引用/);
  f.content.projects=[]; result=await previewSync(f.service,['travel']);
  f.setCurrent(tree({'keep.jpg':'a','new.jpg':'d'}));
  // Revision includes commits and changes; same pinned commit must never change contents in real Git.
  f.content.head='d'.repeat(40);
  await assert.rejects(()=>f.service.dispatch({mode:'sync',expectedHead:f.content.head,sourceIds:['travel'],previewRevision:result.revision}),/变化/);
  assert(f.requests.every(r=>r.method==='GET'));
  result=await previewSync(f.service,['travel']);
  await f.service.dispatch({mode:'sync',expectedHead:f.content.head,sourceIds:['travel'],previewRevision:result.revision});
  assert.equal(f.requests.filter(r=>r.method==='POST').length,1);
});
test('unknown historical baseline is not empty; disabled and duplicate selection rejected',async()=>{
  const f=fixture(); f.setSummary(null);
  const unknown=await previewSync(f.service,['travel']);assert.equal(unknown.counts,null);assert(unknown.errors.length);
  await assert.rejects(()=>previewSync(f.service,['travel','travel']));
  f.content.config.sources[0]={...source,enabled:false};await assert.rejects(()=>previewSync(f.service,['travel']));
  f.content.config.sources[0]=source; f.setRuns([]);
  assert.equal((await previewSync(f.service,['travel'])).counts?.added,2);
});

test('unavailable history permits safe full recovery, but partial sync requires a compatible baseline',async()=>{
  const f=fixture(); f.setSummary(null);
  const recovery=await previewSync(f.service,['travel']);
  assert.equal(recovery.baselineState,'unavailable');assert.equal(recovery.counts,null);assert.equal(recovery.canSync,true);
  const second={...source,sourceId:'second',repo:'second'};
  f.content.config.sources=[source,second];
  const partial=await previewSync(f.service,['travel']);assert.equal(partial.canSync,false);assert.equal(partial.partialAllowed,false);
  await assert.rejects(()=>f.service.dispatch({mode:'sync',expectedHead:f.content.head,sourceIds:['travel'],previewRevision:partial.revision}));
  f.setSummary({photos:{status:'success'}});
  f.catalog.artifact.snapshot=makeSnapshot(f.content.config,{travel:'b'.repeat(40),second:'b'.repeat(40)});
  assert.equal((await previewSync(f.service,['travel'])).partialAllowed,true);
  f.catalog.processingDigest='changed';
  assert.equal((await previewSync(f.service,['travel'])).partialAllowed,false);
});
