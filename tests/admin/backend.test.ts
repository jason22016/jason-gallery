import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { ZipWriter, Uint8ArrayWriter, Uint8ArrayReader } from '@zip.js/zip.js';
import { handle } from '../../admin/server/worker';
import { GitHub } from '../../admin/server/github';
import { AdminService, sourceImpacts } from '../../admin/server/service';
import { parseSources, LEGACY_SOURCE, makeSnapshot, photoReference, originalURL } from '../../src/photo-engine/source-contract';
import { createUnifiedIndex } from '../../src/photo-engine/unified-index';
import { hashBytes, readCollection } from '../../src/photo-engine/collection-contract';
import type { AfilmoryManifest } from '@afilmory/typing';
const head = 'a'.repeat(40), next = 'b'.repeat(40);
const env = { ADMIN_ORIGIN: 'https://admin.example.com', ACCESS_ISSUER: 'https://fixture.cloudflareaccess.com', ACCESS_AUD: 'fixture-audience', ADMIN_EMAILS: 'admin@example.com', GITHUB_TOKEN: 'server-only-secret-sentinel', GITHUB_REPOSITORY: 'fixture/website', PUBLISH_ENABLED: 'false', ASSETS: { fetch: async () => new Response('protected static') } } as unknown as Env;
let privateKey: CryptoKey; let jwk: any;
test.before(async () => { const pair = await generateKeyPair('RS256'); privateKey = pair.privateKey; jwk = { ...await exportJWK(pair.publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' }; });
async function token(patch: Record<string, unknown> = {}) { const now = Math.floor(Date.now()/1000); return new SignJWT({ email: 'admin@example.com', iss: env.ACCESS_ISSUER, aud: env.ACCESS_AUD, iat: now, exp: now+600, sub: 'admin', ...patch }).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).sign(privateKey); }
const config = parseSources({ schemaVersion: 1, sources: [LEGACY_SOURCE, { ...LEGACY_SOURCE, sourceId: 'second', owner: 'other', repo: 'photos' }] });
const snapshot = makeSnapshot(config, Object.fromEntries(config.sources.map(s => [s.sourceId, 'c'.repeat(40)])));
async function collection() {
  const files = new Map<string, Uint8Array>();
  const put = (name: string, value: any) => files.set(name, new TextEncoder().encode(JSON.stringify(value)));
  const manifests = new Map<string, AfilmoryManifest>();
  const statuses: any[] = [];
  for (const s of snapshot.sources) {
    const photo = { id: 'same_12345678', title: 'Same name', s3Key: 'same.jpg', width: 400, height: 300, thumbnailUrl: '/thumbnails/same_12345678.jpg', originalUrl: originalURL(s,s.commit,'same.jpg') };
    const manifest = { version: 'v10', data: [photo] } as unknown as AfilmoryManifest; manifests.set(s.sourceId,manifest);
    const prefix = `sources/${s.sourceId}/`;
    put(prefix+'photos-manifest.json',manifest); const thumb = new Uint8Array([0xff,0xd8,0xff,0xd9]); files.set(prefix+'public/thumbnails/same_12345678.jpg',thumb); files.set(`public/thumbnails/${photoReference(s,photo.id)}.jpg`,thumb);
    const native = { schemaVersion: 1, kind: 'photos', complete: true, source:'github', photoCommit:s.commit, fingerprint:'fingerprint', websiteCommit:head, photos:1, processed:1, reused:0, files: { 'photos-manifest.json':hashBytes(files.get(prefix+'photos-manifest.json')!), 'public/thumbnails/same_12345678.jpg':hashBytes(thumb) }, sourceConfig: config.sources.find(v=>v.sourceId===s.sourceId) };
    put(prefix+'artifact.json',{...native,version:hashBytes(JSON.stringify(native))}); statuses.push({sourceId:s.sourceId,status:'success',total:1,processed:1,reused:0,commit:s.commit,failureReason:null});
  }
  put('photo-index.json',createUnifiedIndex(snapshot,manifests));
  const record = { schemaVersion:2,kind:'photos',complete:true,source:'github',snapshot,fingerprint:'fingerprint',websiteCommit:head,photos:2,processed:2,reused:0,sources:statuses,files:Object.fromEntries([...files].map(([name,data])=>[name,hashBytes(data)])) };
  const artifact = {...record,version:hashBytes(JSON.stringify(record))}; put('artifact.json',artifact);
  return {files,artifact};
}
async function zip(files: Map<string,Uint8Array>) { const writer = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers:false }); for(const [name,data] of files) await writer.add(name,new Uint8ArrayReader(data)); return writer.close(); }
async function fixture() {
  const c = await collection(); let summary: any = {schemaVersion:2,action:'sync',websiteCommit:head,photos:{status:'success',artifactVersion:c.artifact.version},sources:c.artifact.sources,website:{status:'not_started'},deployment:{status:'not_requested'}};
  let currentHead = head; let race = false; let expired = false; let tamper = false; let codeStale = false;
  let projects: any[] = []; const mutations: any[] = []; const network: any[] = [];
  const photosZip = await zip(c.files);
  const run = {id:1,head_branch:'main',path:'.github/workflows/automation.yml',repository:{full_name:env.GITHUB_REPOSITORY},head_sha:head,status:'completed',event:'workflow_dispatch',conclusion:'success',display_title:'Gallery sync · fixture'};
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); const headers = new Headers(init?.headers); const method=init?.method||'GET'; network.push({url: url.origin+url.pathname,method,auth:headers.get('authorization')});
    if (url.hostname==='fixture.cloudflareaccess.com') return Response.json({keys:[jwk]});
    if (url.hostname==='fixture.blob.core.windows.net') {
      assert.equal(headers.get('authorization'),null);
      let data = url.pathname==='/photos' ? photosZip : await zip(new Map([['summary.json',new TextEncoder().encode(JSON.stringify(summary))]]));
      if (tamper && url.pathname==='/photos') data = new Uint8Array(data.length);
      if (method==='HEAD') return new Response(null,{headers:{'content-length':String(data.length)}});
      const range=headers.get('range')!.match(/bytes=(\d+)-(\d+)/)!; const start=+range[1],end=+range[2];
      return new Response(data.slice(start,end+1),{status:206,headers:{'content-range':`bytes ${start}-${end}/${data.length}`}});
    }
    assert.equal(url.origin,'https://api.github.com'); assert(url.pathname.startsWith('/repos/fixture/website/')); assert.equal(headers.get('authorization'),`Bearer ${env.GITHUB_TOKEN}`);
    const p=url.pathname.replace('/repos/fixture/website','');
    const body=init?.body ? JSON.parse(String(init.body)) : null;
    if(method!=='GET') mutations.push({p,method,body});
    if(p==='/git/ref/heads/main') return Response.json({object:{sha:currentHead}});
    if(p.startsWith('/git/trees/') && method==='GET') return Response.json({truncated:false,tree:[{path:'config/photo-sources.json',type:'blob',mode:'100644',sha:'config'},...projects.map((p,i)=>({path:`src/content/projects/${p.slug}.json`,sha:`project-${i}`,type:'blob',mode:'100644'})),{path:'pnpm-lock.yaml',type:'blob',sha:codeStale&&p.endsWith(head)?'old':'code'}]});
    if(p.startsWith('/git/blobs/')) { const value=p.endsWith('config')?config:projects[Number(p.split('-').at(-1))]; return Response.json({encoding:'base64',content:Buffer.from(JSON.stringify(value)).toString('base64')}); }
    if(p===`/git/commits/${head}`) return Response.json({tree:{sha:'tree'}});
    if(p==='/git/trees' || p==='/git/commits') return Response.json({sha:next});
    if(p==='/git/refs/heads/main') { if(race) return Response.json({}, {status:422}); currentHead=next; return Response.json({object:{sha:next}}); }
    if(p==='/actions/workflows/automation.yml/runs') return Response.json({workflow_runs:[run]});
    if(p==='/actions/runs/1') return Response.json(run);
    if(p==='/actions/runs/1/jobs') return Response.json({jobs:[{steps:[{name:'Photos',status:'completed',conclusion:'success'}]}]});
    if(p==='/actions/runs/1/artifacts') return Response.json({artifacts:[{id:10,name:'photos',expired,expires_at:new Date(Date.now()+86400000).toISOString()},{id:11,name:'execution-summary',expires_at:new Date(Date.now()+86400000).toISOString()}]});
    if(p.startsWith('/actions/artifacts/')) return new Response(null,{status:302,headers:{location:`https://fixture.blob.core.windows.net/${p.includes('/10/')?'photos':'summary'}?secret=signed-never-expose`}});
    if(p==='/actions/workflows/automation.yml/dispatches') return new Response(null,{status:204});
    throw new Error('Unexpected '+p);
  };
  return { c, fetcher, mutations, network, setProjects:(v:any[])=>projects=v, setHead:(v:string)=>currentHead=v, setRace:()=>race=true,setExpired:()=>expired=true,setTamper:()=>tamper=true,setStale:()=>{codeStale=true;currentHead=next;}, setSummary:(v:any)=>summary=v, summary, run };
}
async function api(f: Awaited<ReturnType<typeof fixture>>, path:string, body?:unknown, jwt?:string, headers:Record<string,string>={}) {
  return handle(new Request(env.ADMIN_ORIGIN+path,{method:body===undefined?'GET':'POST',headers:{'Cf-Access-Jwt-Assertion':jwt??await token(),...(body===undefined?{}:{Origin:env.ADMIN_ORIGIN,'Content-Type':'application/json'}),...headers},body:body===undefined?undefined:JSON.stringify(body)}),env,f.fetcher);
}
test('all APIs and static assets reject missing, forged, expired, wrong issuer/audience/email JWT; authenticated same-origin writes only', async()=>{
  const f=await fixture();
  for(const path of ['/','/api/state','/api/save','/api/dispatch','/api/thumbnail/1/foo']) {
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
  const f=await fixture(); const refs=f.c.artifact.snapshot.sources.map(s=>photoReference(s,'same_12345678'));const project={schemaVersion:1,id:'isolated',slug:'isolated',title:'Fixture',coverPhotoId:refs[0],photos:refs.map(photoId=>({photoId})),order:0,status:'draft'};
  assert.equal((await api(f,'/api/save',{kind:'project',expectedHead:head,project:{...project,photos:[{photoId:'missing'}],coverPhotoId:'missing'}})).status,422);
  assert.equal((await api(f,'/api/save',{kind:'project',expectedHead:head,project:{...project,slug:'../escape'}})).status,422);
  assert.equal((await api(f,'/api/save',{kind:'sources',expectedHead:head,config:{...config,sources:[{...LEGACY_SOURCE,path:'../private'}]}})).status,422);
  f.setProjects([project,{...project,id:'public',slug:'public',status:'published'}]);
  const disabled={...config,sources:config.sources.map(s=>({...s,enabled:false}))};const impacts=sourceImpacts(config,disabled,[project as any,{...project,status:'published'} as any]);assert.equal(impacts.length,4);
  assert.equal((await api(f,'/api/save',{kind:'sources',expectedHead:head,config:disabled})).status,422);
  f.setProjects([]);assert.equal((await api(f,'/api/save',{kind:'project',expectedHead:head,project})).status,200);
  assert.equal(f.mutations.at(-1).body.force,false);assert.equal(f.mutations.find(m=>m.p==='/git/trees').body.tree[0].path,'src/content/projects/isolated.json');assert(f.mutations.find(m=>m.p==='/git/commits').body.message.includes('[skip ci]'));
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
  f.setSummary({...f.summary,action:'publish',deployment:{status:'success',version:'sealed-version',url:'https://gallery.example.com'}});assert.equal((await service.tasks()).tasks[0].published,true);
  f.run.conclusion='failure';assert.equal((await service.tasks()).tasks[0].published,false);
});
