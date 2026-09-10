import assert from 'node:assert/strict';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { ZipWriter, Uint8ArrayWriter, Uint8ArrayReader } from '@zip.js/zip.js';
import { parseSources, LEGACY_SOURCE, makeSnapshot, photoReference, originalURL } from '../../src/photo-engine/source-contract';
import { createUnifiedIndex } from '../../src/photo-engine/unified-index';
import { hashBytes } from '../../src/photo-engine/collection-contract';
import type { AfilmoryManifest } from '@afilmory/typing';
const head = 'a'.repeat(40), next = 'b'.repeat(40);
const env = { ADMIN_ORIGIN: 'https://admin.example.com', ACCESS_ISSUER: 'https://fixture.cloudflareaccess.com', ACCESS_AUD: 'fixture-audience', ADMIN_EMAILS: 'admin@example.com', GITHUB_TOKEN: 'server-only-secret-sentinel', GITHUB_REPOSITORY: 'fixture/website', PUBLISH_ENABLED: 'false', ASSETS: { fetch: async () => new Response('protected static') } } as unknown as Env;
let privateKey: CryptoKey; let jwk: any;
async function prepareKeys() { const pair = await generateKeyPair('RS256'); privateKey = pair.privateKey; jwk = { ...await exportJWK(pair.publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' }; }
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
async function fixture(replay?: { files: Map<string, Uint8Array>; artifact: any; config: typeof config }) {
  const c = replay ?? await collection(); const activeConfig = replay?.config ?? config; let summary: any = {schemaVersion:2,action:'sync',websiteCommit:head,photos:{status:'success',artifactVersion:c.artifact.version},sources:c.artifact.sources,website:{status:'not_started'},deployment:{status:'not_requested'}};
  let currentHead = head; let race = false; let expired = false; let tamper = false; let codeStale = false;
  let projects: any[] = []; const mutations: any[] = []; const network: any[] = [];
  const photosZip = await zip(c.files);
  const run = {id:1,head_branch:'main',path:'.github/workflows/automation.yml',repository:{full_name:env.GITHUB_REPOSITORY},head_repository:{full_name:env.GITHUB_REPOSITORY},head_sha:head,status:'completed',event:'workflow_dispatch',conclusion:'success',display_title:'Gallery sync · fixture'};
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
    if(p.startsWith('/git/blobs/')) { const value=p.endsWith('config')?activeConfig:projects[Number(p.split('-').at(-1))]; return Response.json({encoding:'base64',content:Buffer.from(JSON.stringify(value)).toString('base64')}); }
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

export { head, next, env, prepareKeys, token, config, snapshot, fixture };
