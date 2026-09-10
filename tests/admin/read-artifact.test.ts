import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, env, config, head, zip } from './backend-fixture';
import { parseSources, LEGACY_SOURCE } from '../../src/photo-engine/source-contract';
import { storedFiles } from '../../admin/server/stored-archive';

test('ASCII source ordering preserves the previous snapshot collation for allowed ID characters', () => {
  const alphabet='abcdefghijklmnopqrstuvwxyz0123456789-'; const ids:string[]=[];
  for(const a of alphabet) for(const b of alphabet) {const id='a'+a+b;if(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id)) ids.push(id);}
  // Mix adjacent lexical groups so the test exercises comparisons across digits,
  // hyphens and letters, while preserving the source schema's 50-item limit.
  const mixed=ids.map((id,i)=>({id,order:(i*7919)%ids.length})).sort((a,b)=>a.order-b.order).map(x=>x.id);
  for(let i=0;i<mixed.length;i+=50) {
    const group=mixed.slice(i,i+50);
    const result=parseSources({schemaVersion:1,sources:group.map(sourceId=>({...LEGACY_SOURCE,sourceId}))});
    assert.deepEqual(result.sources.map(s=>s.sourceId),[...group].sort((a,b)=>a.localeCompare(b,'en')));
  }
});
import { AdminService } from '../../admin/server/service';
import { GitHub } from '../../admin/server/github';
import { readCollection } from '../../src/photo-engine/collection-contract';
import { parseCatalog, sha256 } from '../../admin/server/read-contract';

test('compact projection equals the full verifier, including every alias and preview byte', async () => {
  const f = await fixture();
  const original = await readCollection(async p => f.c.files.get(p)!, config);
  const catalog = parseCatalog(f.readFiles.catalog);
  assert.deepEqual(catalog.aliases, [...original.aliases]);
  assert.deepEqual(catalog.photos.map(p => [p.id,p.title,p.width,p.height]), original.photos.map(p => [p.id,p.title,p.width,p.height]));
  assert.equal(new Set(catalog.photos.map(p=>p.sourceId)).size,2);
  for (const p of catalog.photos) {
    const value = f.readFiles.previews.subarray(p.offset,p.offset+p.length);
    assert.deepEqual(value, Buffer.from(await original.read(`public/thumbnails/${p.id}.jpg`)));
    assert.equal(sha256(value),p.hash);
  }
});

test('catalog structure rejects duplicates, aliases, sizes, offsets and invalid source snapshots', async () => {
  const f = await fixture();
  for (const corrupt of [
    (c:any)=>c.photos.pop(), (c:any)=>c.photos[1].id=c.photos[0].id,
    (c:any)=>c.aliases.push([c.aliases[0][0],c.photos[0].id]), (c:any)=>c.aliases[0][1]='missing',
    (c:any)=>c.photos[0].offset=-1, (c:any)=>c.photos[1].offset++, (c:any)=>c.photos[0].length=Number.MAX_SAFE_INTEGER,
    (c:any)=>c.photos[0].sourceId='foreign', (c:any)=>c.artifact.snapshot.version='f'.repeat(64),
  ]) {
    const c=JSON.parse(f.readFiles.catalog.toString());corrupt(c);
    assert.throws(()=>parseCatalog(Buffer.from(JSON.stringify(c))));
  }
});

test('STORE inspection rejects duplicate/malformed entries and unsupported compression without extraction',async()=>{
  const files=new Map([['catalog.json',Buffer.from('{}')],['previews.bin',Buffer.from('jpeg')]]);
  const original=await zip(files);
  const inspected=storedFiles(original,[...files.keys()]);
  for(const [name,bytes] of files) assert.deepEqual(Buffer.from(inspected.get(name)!),bytes);
  assert.throws(()=>storedFiles(original,['catalog.json']));
  assert.throws(()=>storedFiles(original.subarray(0,original.length-1),[...files.keys()]));
  assert.throws(()=>storedFiles(new Uint8Array(original.length),[...files.keys()]));
  assert.throws(()=>storedFiles(original,['catalog.json','../previews.bin']));
  assert.throws(()=>storedFiles(Buffer.from(original.map((byte,i)=>i===0?0:byte)),[...files.keys()]));
  const compressed=await zip(files,6); assert.throws(()=>storedFiles(compressed,[...files.keys()]),/旧版|不支持/);
});

test('trusted summary binding rejects foreign run, attempt, repository, artifact and catalog substitution', async()=>{
  for(const field of ['runId','runAttempt','repository','photosArtifactId','artifactId','artifactDigest','catalogHash','photosArtifactVersion','websiteCommit']) {
    const f=await fixture(); const seal={...f.summary.adminRead};
    seal[field]=typeof seal[field]==='number'?seal[field]+1:'f'.repeat(64);
    f.setSummary({...f.summary,adminRead:seal});
    const s=new AdminService(new GitHub(env,f.fetcher));
    assert.notEqual((await s.bootstrap()).media.state,'ready',field);
    await assert.rejects(s.save({kind:'project',expectedHead:head,project:{schemaVersion:1,id:'test',slug:'test',title:'Test',photos:[],coverPhotoId:'missing',order:0,status:'draft'}}));
    assert.equal(f.mutations.length,0);
  }
});

test('no expensive fallback for old compression, wrong range, missing artifact, or changed previews',async()=>{
  for(const mode of ['compression','range','missing','preview','catalog']) {
    const f=await fixture();
    if(mode==='compression') f.setSummaryLevel(6);
    if(mode==='preview') {const previews=Buffer.from(f.readFiles.previews);previews[0]^=1; const altered=await zip(new Map([['catalog.json',f.readFiles.catalog],['previews.bin',previews]]));f.setAdminZip(altered);f.setSummary({...f.summary,adminRead:{...f.summary.adminRead,artifactDigest:'sha256:'+sha256(altered)}});}
    if(mode==='catalog') {const c=JSON.parse(f.readFiles.catalog.toString());c.photos[0].title='forged';const altered=await zip(new Map([['catalog.json',Buffer.from(JSON.stringify(c))],['previews.bin',f.readFiles.previews]]));f.setAdminZip(altered);f.setSummary({...f.summary,adminRead:{...f.summary.adminRead,artifactDigest:'sha256:'+sha256(altered)}});}
    // Updating only the archive identity simulates a malformed producer/storage,
    // while the independently sealed catalog and per-photo digest stay unchanged.
    const transport:typeof fetch=async(input,init)=>{
      const response=await f.fetcher(input,init);
      if(mode==='range' && String(input).includes('/admin-read')) {response.headers.set('content-range','bytes 0-0/1');}
      if(mode==='missing' && String(input).includes('/artifacts?')) {const data=await response.json();data.artifacts=data.artifacts.filter((a:any)=>a.id!==12);return Response.json(data);}
      return response;
    };
    const s=new AdminService(new GitHub(env,transport));
    await assert.rejects(s.thumbnail(1,parseCatalog(f.readFiles.catalog).photos[0]!.id),mode==='preview'?/缩略图摘要不匹配/:mode==='catalog'?/目录完整性/:Error,mode);
    assert(!f.network.some(r=>r.url.endsWith('/photos') || r.url.includes('/git/trees')));
  }
});

test('upstream failure is unavailable, not evidence of stale photos',async()=>{
  const f=await fixture();
  const s=new AdminService(new GitHub(env,async(input,init)=>{
    if(String(input).includes('/actions/')) throw new TypeError('network interrupted');
    return f.fetcher(input,init);
  }));
  const state=await s.bootstrap();assert.equal(state.media.state,'github_network');assert(!state.media.reason.includes('请重新同步'));
});


test('CI-sealed catalog avoids archive reads for state and reads only the requested verified JPEG', async () => {
  const f = await fixture(); f.enableSealed();
  const service = new AdminService(new GitHub(env, f.fetcher));
  const state = await service.bootstrap(); assert.equal(state.media.state, 'ready');
  assert.equal(state.media.photos.length, 2);
  assert(!f.network.some(r => r.url.includes('/12/zip') || r.url.endsWith('/admin-read')));
  const catalog = parseCatalog(f.readFiles.catalog), photo = catalog.photos[0]!;
  assert.deepEqual(Buffer.from(await service.thumbnail(1, photo.id)), f.readFiles.previews.subarray(photo.offset, photo.offset + photo.length));
  assert.equal(f.network.filter(r => r.url.endsWith('/admin-read')).length, 1);
});

test('sealed catalogs reject altered bytes, range proofs, removed artifacts and damaged JPEGs', async () => {
  for (const mode of ['catalog', 'offset', 'size', 'version', 'range', 'preview', 'expired']) {
    const f = await fixture(); f.enableSealed();
    if (mode === 'catalog') f.summary.adminRead.catalog += ' ';
    if (mode === 'offset') f.summary.adminRead.previewOffset = Number.MAX_SAFE_INTEGER;
    if (mode === 'size') f.summary.adminRead.archiveBytes++;
    if (mode === 'version') f.summary.adminRead.photosArtifactVersion = 'f'.repeat(64);
    if (mode === 'preview') f.setTamper();
    if (mode === 'expired') f.setExpired();
    f.setSummary(f.summary);
    const transport: typeof fetch = async (input, init) => {
      const response = await f.fetcher(input, init);
      if (mode === 'range' && String(input).includes('/admin-read')) response.headers.set('content-range', 'bytes 0-0/1');
      return response;
    };
    const service = new AdminService(new GitHub(env, transport));
    await assert.rejects(service.thumbnail(1, parseCatalog(f.readFiles.catalog).photos[0]!.id), Error, mode);
    assert.equal(f.mutations.length, 0);
  }
});

test('atomic save never retries an uncertain mutation or accepts partial GraphQL success', async () => {
  for (const mode of ['network', 'http', 'empty', 'partial', 'same-head']) {
    let calls = 0;
    const github = new GitHub(env, async () => {
      calls++;
      if (mode === 'network') throw new TypeError('connection ended after submission');
      if (mode === 'http') return new Response('upstream', { status: 503 });
      if (mode === 'empty') return Response.json({ data: { createCommitOnBranch: null } });
      if (mode === 'partial') return Response.json({ data: { createCommitOnBranch: { commit: { oid: 'b'.repeat(40) } } }, errors: [{ type: 'UNKNOWN' }] });
      return Response.json({ data: { createCommitOnBranch: { commit: { oid: head } } } });
    });
    await assert.rejects(github.commit(head, [{ path: 'config/photo-sources.json', data: config }]));
    assert.equal(calls, 1, mode);
  }
});

test('immutable content query preserves nested processor paths and rejects incomplete tree objects', async () => {
  const { processingInputs } = await import('../../src/photo-engine/processing-inputs');
  const prefix='packages/afilmory/builder', alias=`processor${processingInputs.indexOf(prefix)}`;
  for (const mode of ['valid','missing','wrong-oid','depth']) {
    const f=await fixture(); let contentQueries=0;
    const github=new GitHub(env,async (input,init)=>{
      const response=await f.fetcher(input,init);
      if (!String(input).endsWith('/graphql')) return response;
      const query=JSON.parse(String(init?.body)).query; assert(query.startsWith('query AdminContent')); assert(!query.includes('main:')); assert(query.includes(head+':')); contentQueries++;
      const result=await response.json();
      const leaf={__typename:'Blob',oid:'f'.repeat(40)};
      const child={name:'entry.ts',oid:leaf.oid,mode:0o100644,type:'blob',object:leaf};
      result.data.repository[alias]={__typename:'Tree',oid:'e'.repeat(40),entries:[{name:'nested',oid:'d'.repeat(40),mode:0o40000,type:'tree',object:{__typename:'Tree',oid:'d'.repeat(40),entries:[child]}}]};
      if(mode==='missing') delete result.data.repository[alias];
      if(mode==='wrong-oid') child.oid='a'.repeat(40);
      if(mode==='depth') {child.type='tree';child.object={__typename:'Tree',oid:child.oid};}
      return Response.json(result);
    });
    if(mode==='valid') {
      const tree=await github.contentTree(head);assert.deepEqual(tree.find(e=>e.path===prefix+'/nested/entry.ts'),{path:prefix+'/nested/entry.ts',sha:'f'.repeat(40),type:'blob',mode:'100644'});
      assert.equal(contentQueries,1);assert(!f.network.some(r=>r.url.includes('/git/trees')));
    } else await assert.rejects(github.contentTree(head));
  }
});
