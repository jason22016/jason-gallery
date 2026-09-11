import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { ZipWriter, Uint8ArrayWriter, Uint8ArrayReader } from '@zip.js/zip.js';
import { parseSources, LEGACY_SOURCE, makeSnapshot, photoReference, originalURL } from '../../src/photo-engine/source-contract';
import { createUnifiedIndex } from '../../src/photo-engine/unified-index';
import { processingInputs } from '../../src/photo-engine/processing-inputs';
import { storedFiles } from '../../admin/server/stored-archive';
import { buildReadFiles } from '../../scripts/admin/read-artifact';
import { readCollection, hashBytes } from '../../src/photo-engine/collection-contract';
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
    put(prefix+'photos-manifest.json',manifest); const thumb = new Uint8Array(await sharp({ create: { width: 4, height: 3, channels: 3, background: '#809080' } }).jpeg().toBuffer()); files.set(prefix+'public/thumbnails/same_12345678.jpg',thumb); files.set(`public/thumbnails/${photoReference(s,photo.id)}.jpg`,thumb);
    const native = { schemaVersion: 1, kind: 'photos', complete: true, source:'github', photoCommit:s.commit, fingerprint:'fingerprint', websiteCommit:head, photos:1, processed:1, reused:0, files: { 'photos-manifest.json':hashBytes(files.get(prefix+'photos-manifest.json')!), 'public/thumbnails/same_12345678.jpg':hashBytes(thumb) }, sourceConfig: config.sources.find(v=>v.sourceId===s.sourceId) };
    put(prefix+'artifact.json',{...native,version:hashBytes(JSON.stringify(native))}); statuses.push({sourceId:s.sourceId,status:'success',total:1,processed:1,reused:0,commit:s.commit,failureReason:null});
  }
  put('photo-index.json',createUnifiedIndex(snapshot,manifests));
  const record = { schemaVersion:2,kind:'photos',complete:true,source:'github',snapshot,fingerprint:'fingerprint',websiteCommit:head,photos:2,processed:2,reused:0,sources:statuses,files:Object.fromEntries([...files].map(([name,data])=>[name,hashBytes(data)])) };
  const artifact = {...record,version:hashBytes(JSON.stringify(record))}; put('artifact.json',artifact);
  return {files,artifact};
}
export async function zip(files: Map<string,Uint8Array>, level = 0) { const writer = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers:false, level, zip64: false }); for(const [name,data] of files) await writer.add(name,new Uint8ArrayReader(data)); return writer.close(); }
async function fixture(replay?: { files: Map<string, Uint8Array>; artifact: any; config: typeof config }) {
  const c = replay ?? await collection(); let activeConfig = replay?.config ?? config; let summary: any = {schemaVersion:2,runId:1,runAttempt:1,action:'sync',websiteCommit:head,photos:{status:'success',artifactVersion:c.artifact.version},sources:c.artifact.sources,website:{status:'not_started'},deployment:{status:'not_requested'}};
  let commitCount = 0;
  let currentHead = head; let race = false; let expired = false; let tamper = false; let codeStale = false;
  let projects: any[] = []; const mutations: any[] = []; const network: any[] = [];
  const photosZip = await zip(c.files);
  const readFiles = await buildReadFiles(await readCollection(async p => c.files.get(p)!, activeConfig), { repository: env.GITHUB_REPOSITORY, runId: 1, runAttempt: 1, websiteCommit: head, photosArtifactId: 10 }, [{ path: 'pnpm-lock.yaml', type: 'blob', sha: 'd'.repeat(40) }]);
  let adminZip: Uint8Array = await zip(new Map([['catalog.json', readFiles.catalog], ['previews.bin', readFiles.previews]]));
  let adminDigest = 'sha256:' + hashBytes(adminZip);
  summary.adminRead = { status: 'success', repository: env.GITHUB_REPOSITORY, runId: 1, runAttempt: 1, websiteCommit: head, photosArtifactId: 10, photosArtifactVersion: c.artifact.version, catalogHash: readFiles.catalogHash, artifactId: 12, artifactDigest: adminDigest };
  let summaryLevel = 0;
  let summaryBytes: Promise<Uint8Array> | undefined;
  const summaryZip = () => summaryBytes ??= zip(new Map([['summary.json', new TextEncoder().encode(JSON.stringify(summary))]]), summaryLevel);
  await summaryZip();
  const blob = (value: unknown) => { const text = JSON.stringify(value); const byteSize = Buffer.byteLength(text); return { text, byteSize, oid: createHash('sha1').update(`blob ${byteSize}\0`).update(text).digest('hex'), isBinary: false, isTruncated: false }; };
  const run = {id:1,run_attempt:1,head_branch:'main',path:'.github/workflows/automation.yml',repository:{full_name:env.GITHUB_REPOSITORY},head_repository:{full_name:env.GITHUB_REPOSITORY},head_sha:head,status:'completed',event:'workflow_dispatch',conclusion:'success',display_title:'Gallery sync · fixture'};
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); const headers = new Headers(init?.headers); const method=init?.method||'GET'; network.push({url: url.origin+url.pathname,method,auth:headers.get('authorization')});
    if (url.hostname==='fixture.cloudflareaccess.com') return Response.json({keys:[jwk]});
    if (url.hostname==='fixture.blob.core.windows.net') {
      assert.equal(headers.get('authorization'),null);
      let data = url.pathname==='/photos' ? photosZip : url.pathname==='/admin-read' ? adminZip : await summaryZip();
      if (tamper && url.pathname==='/admin-read') data = new Uint8Array(data.length);
      if (method==='HEAD') return new Response(null,{headers:{'content-length':String(data.length)}});
      if (!headers.has('range')) return new Response(new Uint8Array(data));
      const range=headers.get('range')!.match(/^bytes=(\d+)-(\d+)$/);assert(range,'Azure transport requires an explicit byte range'); const start=+range[1],end=+range[2];
      return new Response(data.slice(start,end+1),{status:206,headers:{'content-range':`bytes ${start}-${end}/${data.length}`}});
    }
    assert.equal(url.origin,'https://api.github.com'); assert(url.pathname.startsWith('/repos/fixture/website/') || url.pathname === '/graphql'); assert.equal(headers.get('authorization'),`Bearer ${env.GITHUB_TOKEN}`);
    const p=url.pathname.replace('/repos/fixture/website','');
    const body=init?.body ? JSON.parse(String(init.body)) : null;
    if(p==='/graphql' && body.query.startsWith('query AdminContent')) {
      const entry = (name:string,value:unknown) => ({name,oid:blob(value).oid,type:'blob',mode:0o100644,object:{__typename:'Blob',...blob(value)}});
      const source=entry('photo-sources.json',activeConfig);
      const repository:any={configDirectory:{__typename:'Tree',entries:[source]},sourceFile:source.object,projectsDirectory:{__typename:'Tree',entries:projects.map(p=>entry(p.slug+'.json',p))}};
      for(const [i,path] of processingInputs.entries()) repository[`processor${i}`]=path==='pnpm-lock.yaml'?{__typename:'Blob',oid:codeStale?'e'.repeat(40):'d'.repeat(40)}:null;
      return Response.json({data:{repository}});
    }
    if(p==='/graphql' && body.query.startsWith('mutation')) {
      mutations.push({p,method,body});
      const input=body.variables.input; assert.equal(input.branch.repositoryNameWithOwner,env.GITHUB_REPOSITORY);assert.equal(input.branch.branchName,'main');
      if(race || input.expectedHeadOid!==currentHead) return Response.json({data:{createCommitOnBranch:null},errors:[{type:'STALE_DATA'}]});
      for (const change of input.fileChanges.additions) {
        const value = JSON.parse(Buffer.from(change.contents, 'base64').toString('utf8'));
        if (change.path === 'config/photo-sources.json') activeConfig = value;
        else projects = [...projects.filter(p => `src/content/projects/${p.slug}.json` !== change.path), value];
      }
      for (const change of input.fileChanges.deletions ?? []) projects = projects.filter(p => `src/content/projects/${p.slug}.json` !== change.path);
      currentHead = ++commitCount === 1 ? next : createHash('sha1').update(currentHead + JSON.stringify(input)).digest('hex');
      return Response.json({data:{createCommitOnBranch:{commit:{oid:currentHead}}}});
    }
    if(p==='/graphql') { const repository: Record<string, unknown> = {}; for(const match of body.query.matchAll(/(b\d+): object\(oid: "([a-f\d]{40})"\)/g)) repository[match[1]] = [activeConfig, ...projects].map(blob).find(b => b.oid === match[2]) ?? null; return Response.json({data:{repository}}); }
    if(method!=='GET') mutations.push({p,method,body});
    if(p==='/git/ref/heads/main') return Response.json({object:{sha:currentHead}});
    if(p.startsWith('/git/trees/') && method==='GET') return Response.json({truncated:false,tree:[{path:'config/photo-sources.json',type:'blob',mode:'100644',sha:blob(activeConfig).oid},...projects.map((p,i)=>({path:`src/content/projects/${p.slug}.json`,sha:blob(p).oid,type:'blob',mode:'100644'})),{path:'pnpm-lock.yaml',type:'blob',sha:codeStale?'e'.repeat(40):'d'.repeat(40)}]});
    if(p.startsWith('/git/blobs/')) { const value=[activeConfig, ...projects].find(v => p.endsWith(blob(v).oid)); return Response.json({encoding:'base64',content:Buffer.from(JSON.stringify(value)).toString('base64')}); }
    if(p===`/git/commits/${head}`) return Response.json({tree:{sha:'tree'}});
    if(p==='/git/trees' || p==='/git/commits') return Response.json({sha:next});
    if(p==='/git/refs/heads/main') { if(race) return Response.json({}, {status:422}); currentHead=next; return Response.json({object:{sha:next}}); }
    if(p==='/actions/workflows/automation.yml/runs') return Response.json({workflow_runs:[run]});
    if(p==='/actions/runs/1') return Response.json(run);
    if(p==='/actions/runs/1/jobs') return Response.json({jobs:[{steps:[{name:'Photos',status:'completed',conclusion:'success'}]}]});
    if(p==='/actions/runs/1/artifacts') return Response.json({artifacts:[{id:10,name:'photos',expired,expires_at:new Date(Date.now()+86400000).toISOString()},{id:11,name:'execution-summary',digest:'sha256:'+hashBytes(await summaryZip()),expires_at:new Date(Date.now()+86400000).toISOString()},{id:12,name:'admin-read',size_in_bytes:adminZip.length,digest:adminDigest,expires_at:new Date(Date.now()+86400000).toISOString()}]});
    if(p.startsWith('/actions/artifacts/')) return new Response(null,{status:302,headers:{location:`https://fixture.blob.core.windows.net/${p.includes('/10/')?'photos':p.includes('/12/')?'admin-read':'summary'}?secret=signed-never-expose`}});
    if(p==='/actions/workflows/automation.yml/dispatches') return new Response(null,{status:204});
    throw new Error('Unexpected '+p);
  };
  return { enableSealed: () => { summary.adminRead = { ...summary.adminRead, sealedCatalogVersion: 1, catalog: readFiles.catalog.toString('utf8'), previewOffset: storedFiles(adminZip, ['catalog.json', 'previews.bin']).get('previews.bin')!.byteOffset - adminZip.byteOffset, archiveBytes: adminZip.length }; summaryBytes = undefined; }, readFiles, setSummaryLevel:(level:number)=>{summaryLevel=level;summaryBytes=undefined;}, setAdminZip:(bytes:Uint8Array)=>{adminZip=bytes;adminDigest='sha256:'+hashBytes(bytes);}, c, fetcher, mutations, network, setProjects:(v:any[])=>projects=v, setConfig:(v:typeof config)=>activeConfig=v, setHead:(v:string)=>currentHead=v, setRace:()=>race=true,setExpired:()=>expired=true,setTamper:()=>tamper=true,setStale:()=>{codeStale=true;currentHead=next;}, setSummary:(v:any)=>{summary=v;summaryBytes=undefined;}, summary, run };
}

export { head, next, env, prepareKeys, token, config, snapshot, fixture };
