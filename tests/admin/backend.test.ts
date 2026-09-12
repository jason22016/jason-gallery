import test from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../../admin/server/worker';
import { GitHub } from '../../admin/server/github';
import { AdminService, sourceImpacts } from '../../admin/server/service';
import { LEGACY_SOURCE, photoReference } from '../../src/photo-engine/source-contract';
import { readCollection } from '../../src/photo-engine/collection-contract';
import { head, next, env, prepareKeys, token, config, snapshot, fixture } from './backend-fixture';
test.before(prepareKeys);
async function api(f: Awaited<ReturnType<typeof fixture>>, path:string, body?:unknown, jwt?:string, headers:Record<string,string>={}) {
  return handle(new Request(env.ADMIN_ORIGIN+path,{method:body===undefined?'GET':'POST',headers:{'Cf-Access-Jwt-Assertion':jwt??await token(),...(body===undefined?{}:{Origin:env.ADMIN_ORIGIN,'Content-Type':'application/json'}),...headers},body:body===undefined?undefined:JSON.stringify(body)}),env,f.fetcher);
}
test('all APIs and static assets reject missing, forged, expired, wrong issuer/audience/email JWT; authenticated same-origin writes only', async()=>{
  const f=await fixture();
  for(const path of ['/','/api/state','/api/save','/api/dispatch','/api/sync-preview','/api/thumbnail/1/foo']) {
    const r=await api(f,path,path==='/api/save'?{}:undefined,''); assert.equal(r.status,401);
  }
  for(const claims of [{exp:1},{aud:'wrong'},{iss:'https://evil.com'},{email:'reader@example.com'},{nbf:Math.floor(Date.now()/1000)+1000}]) assert.equal((await api(f,'/api/state',undefined,await token(claims))).status,401);
  assert.equal((await api(f,'/api/state',undefined,'forged',{'Cf-Access-Authenticated-User-Email':'admin@example.com'})).status,401);
  assert.equal((await api(f,'/api/save',{},undefined,{Origin:'https://evil.com'})).status,403);
  assert.equal((await api(f,'/api/save',{},undefined,{'Content-Type':'text/plain'})).status,403);
  assert.equal((await api(f,'/')).status,200);
  assert.equal(f.mutations.length,0);
  const r=await handle(new Request(env.ADMIN_ORIGIN+'/api/save',{method:'POST'}),{...env,GITHUB_TOKEN:''},f.fetcher); assert.equal(r.status,503);
});
test('range-read verified cross-source artifact, thumbnail integrity, no credential or signed URL exposure',async()=>{
  const f=await fixture(); const r=await api(f,'/api/state'); assert.equal(r.status,200); const text=await r.text(); assert(!text.includes(env.GITHUB_TOKEN));assert(!text.includes('signed-never-expose'));
  const data=JSON.parse(text); assert.equal(data.media.state,'ready'); assert.equal(data.media.photos.length,2); assert.notEqual(data.media.photos[0].photo.id,data.media.photos[1].photo.id);
  const thumb=await api(f,data.media.photos[0].photo.thumbnailUrl); assert.equal(thumb.status,200);assert.equal(thumb.headers.get('content-type'),'image/jpeg');assert.equal(thumb.headers.get('cache-control'),'no-store');
  assert(f.network.filter(n=>n.url.includes('blob.core')).every(n=>n.auth===null));
  const bad=new Map(f.c.files);bad.set('photo-index.json',new TextEncoder().encode('{}')); await assert.rejects(readCollection(async p=>bad.get(p)!,config),/摘要/);
});
test('source/project validation, impact for draft and published, strict paths, atomic save and two conflict windows',async()=>{
  const f=await fixture(); const refs=f.c.artifact.snapshot.sources.map((s: typeof snapshot.sources[number])=>photoReference(s,'same_12345678'));const project={schemaVersion:1,id:'isolated',slug:'isolated',title:'Fixture',coverPhotoId:refs[0],photos:refs.map((photoId: string)=>({photoId})),order:0,status:'draft'};
  assert.equal((await api(f,'/api/save',{kind:'project',expectedHead:head,project:{...project,photos:[{photoId:'missing'}],coverPhotoId:'missing'}})).status,422);
  assert.equal((await api(f,'/api/save',{kind:'project',expectedHead:head,project:{...project,slug:'../escape'}})).status,422);
  assert.equal((await api(f,'/api/save',{kind:'sources',expectedHead:head,config:{...config,sources:[{...LEGACY_SOURCE,path:'../private'}]}})).status,422);
  f.setProjects([project,{...project,id:'public',slug:'public',status:'published'}]);
  const disabled={...config,sources:config.sources.map(s=>({...s,enabled:false}))};const impacts=sourceImpacts(config,disabled,[project as any,{...project,status:'published'} as any]);assert.equal(impacts.length,4);
  assert.equal((await api(f,'/api/save',{kind:'sources',expectedHead:head,config:disabled})).status,422);
  f.setProjects([]);assert.equal((await api(f,'/api/save',{kind:'project',expectedHead:head,project})).status,200);
  const mutation=f.mutations.at(-1);assert.equal(mutation.p,'/graphql');assert.equal(mutation.body.variables.input.expectedHeadOid,head);assert.equal(mutation.body.variables.input.fileChanges.additions[0].path,'src/content/projects/isolated.json');assert.deepEqual(JSON.parse(Buffer.from(mutation.body.variables.input.fileChanges.additions[0].contents,'base64').toString()),project);assert(mutation.body.variables.input.message.headline.includes('[skip ci]'));
  const count=f.mutations.length;assert.equal((await api(f,'/api/save',{kind:'sources',expectedHead:head,config})).status,409);assert.equal(f.mutations.length,count);
  const race=await fixture();race.setRace();assert.equal((await api(race,'/api/save',{kind:'sources',expectedHead:head,config})).status,409);
  await assert.rejects(new GitHub(env,f.fetcher).commit(next,[{path:'.github/workflows/evil.yml',data:{}}]),/路径/);
});
test('expired, stale, corrupt and failed artifacts cannot be selected or published; dispatch pending differs from verified deployment',async()=>{
  for(const kind of ['expired','stale','tamper','failed']) {
    const f=await fixture();if(kind==='expired')f.setExpired();if(kind==='stale')f.setStale();if(kind==='tamper')f.setTamper();if(kind==='failed')f.setSummary({...f.summary,photos:{status:'failure'},failureReason:'fixture source failed HTTP 403'});
    const data=await (await api(f,'/api/state')).json();assert.notEqual(data.media.state,'ready',kind);assert.equal(data.media.photos.length,0);
  }
  const f=await fixture();assert.equal((await api(f,'/api/dispatch',{mode:'publish',expectedHead:head,photoRunId:1})).status,503);
  const queued=await (await api(f,'/api/dispatch',{mode:'sync',expectedHead:head})).json();assert.equal(queued.state,'pending');assert.match(queued.requestId,/^[a-f\d-]{36}$/);assert.equal(f.mutations.at(-1).body.ref,'main');assert.equal(f.mutations.at(-1).body.inputs.expected_website_commit,head);
  const service=new AdminService(new GitHub(env,f.fetcher));assert.equal((await service.tasks(queued.requestId)).pending,true);
  assert.equal((await service.tasks()).tasks[0].published,false);
  f.setSummary({...f.summary,action:'publish',deployment:{status:'success',version:'sealed-version',url:'https://gallery.example.com'}});assert.equal((await new AdminService(new GitHub(env,f.fetcher)).tasks()).tasks[0].published,true);
  const enabled=new AdminService(new GitHub({...env,PUBLISH_ENABLED:'true'},f.fetcher));
  const publish=await enabled.dispatch({mode:'publish',expectedHead:head,photoRunId:1});assert.equal(publish.state,'pending');assert.equal(f.mutations.at(-1).body.inputs.photo_run_id,'1');assert.deepEqual(JSON.parse(f.mutations.at(-1).body.inputs.photo_commits),Object.fromEntries(snapshot.sources.map(s=>[s.sourceId,s.commit])));
  f.run.conclusion='failure';assert.equal((await service.tasks()).tasks[0].published,false);
});
test('authenticated thumbnails remain bounded without Cache API, never read content, and reject expiry',async()=>{
  const prior=globalThis.caches; let operations=0;
  Object.defineProperty(globalThis,'caches',{value:{default:{match:async()=>{operations++;throw new Error('unavailable');},put:async()=>{operations++;throw new Error('unavailable');}}},configurable:true});
  try {
    const f=await fixture();const state=await(await api(f,'/api/state')).json();assert.equal(state.media.state,'ready');
    const path=state.media.photos[0].photo.thumbnailUrl;
    for(let i=0;i<3;i++) {
      const before=f.network.length; assert.equal((await api(f,path)).status,200);
      const requests=f.network.slice(before);assert(requests.length<=12);
      assert(!requests.some(r=>/graphql|git\/trees|git\/ref|\/photos$/.test(r.url)), 'thumbnail must never rebuild content or original photos');
    }
    assert.equal(operations,0);
    const deniedBefore=f.network.length;assert.equal((await api(f,path,undefined,'')).status,401);assert.equal(f.network.length,deniedBefore);
    f.setExpired();assert.equal((await api(f,path)).status,410);
    const legacy={schemaVersion:1,id:'legacy',slug:'legacy',title:'Legacy dash filename',coverPhotoId:'file--with-dashes_abcd',photos:[{photoId:'file--with-dashes_abcd'}],order:0,status:'draft'} as const;
    assert.equal(sourceImpacts(config,{...config,sources:config.sources.filter(s=>s.sourceId!=='jason-photos')},[legacy as any]).length,1);
  } finally {Object.defineProperty(globalThis,'caches',{value:prior,configurable:true});}
});

test('authenticated sync preview only reads metadata and never changes repository or dispatches', async()=>{
  const f=await fixture(); const jwt=await token(); const original=f.fetcher;
  f.fetcher=async(input,init)=>{
    const url=new URL(String(input));
    if(url.hostname==='api.github.com' && !url.pathname.startsWith('/repos/fixture/website') && url.pathname!=='/graphql') {
      f.network.push({url:url.origin+url.pathname,method:init?.method??'GET'});
      assert.equal(init?.method??'GET','GET');
      if(url.pathname.includes('/git/trees/'))return Response.json({truncated:false,tree:[{path:'images/new.jpg',type:'blob',mode:'100644',sha:'d'.repeat(40)}]});
      if(url.pathname.includes('/commits/'))return Response.json({sha:'c'.repeat(40)});
      return Response.json({private:false});
    }
    return original(input,init);
  };
  const response=await api(f,'/api/sync-preview?sourceId=jason-photos',undefined,jwt);
  assert.equal(response.status,200,await response.clone().text());
  const value=await response.json() as any;
  assert.equal(value.counts.unchanged,1);assert.equal(value.sourceIds.length,1);assert.equal(value.partialAllowed,true);
  assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(f.mutations.length,0);
  assert(!f.network.some(n=>n.url.includes('raw.githubusercontent.com')));
  assert.equal((await api(f,'/api/sync-preview?sourceId=jason-photos',undefined,'')).status,401);
});

test('a failed newer sync keeps the preceding verified library available',async()=>{
  const f=await fixture();const github=new GitHub(env,f.fetcher);const service=new AdminService(github);
  github.runs=async()=>[{...f.run,id:2,conclusion:'failure'},f.run];
  const summary=service.summary.bind(service);
  service.summary=async(run:any)=>run.id===2?{photos:{status:'failure'},failureReason:'source unavailable'}:summary(run);
  const library=await service.catalog();
  try {assert.equal(library.runId,1);assert.equal(library.photos.length,2);}finally{await library.close();}
});
