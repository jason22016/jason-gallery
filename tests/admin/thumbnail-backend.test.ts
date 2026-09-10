import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, env, prepareKeys, token } from './backend-fixture';
import { AdminService } from '../../admin/server/service';
import { GitHub } from '../../admin/server/github';
import { handle } from '../../admin/server/worker';
import { parseCatalog } from '../../admin/server/read-contract';
test.before(prepareKeys);
async function setup() {
  const f=await fixture();f.enableSealed();
  const state=await new AdminService(new GitHub(env,f.fetcher)).bootstrap();assert.equal(state.media.state,'ready');
  const url=new URL(state.media.photos[0].photo.thumbnailUrl,env.ADMIN_ORIGIN);assert(url.searchParams.has('proof'));
  const jwt=await token();return {f,url,jwt};
}
test('signed preview URLs retain authentication and verify every image with 12/40 concurrent fresh readers', async()=>{
  const {f,url,jwt}=await setup(), p=parseCatalog(f.readFiles.catalog).photos[0]!;
  const expected=f.readFiles.previews.subarray(p.offset,p.offset+p.length);
  for(const concurrency of [12,40]){
    const before=f.network.length;
    await Promise.all(Array.from({length:concurrency},async()=>{
      const response=await handle(new Request(url,{headers:{'Cf-Access-Jwt-Assertion':jwt}}),env,f.fetcher);
      assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),expected);
    }));
    assert.equal(f.network.length-before,concurrency*4);
    const paths=f.network.slice(before).map(x=>x.url);
    assert(!paths.some(p=>p.includes('/git/')||p.includes('/runs/1/jobs')||p.includes('/11/zip')));
  }
  const denied=await handle(new Request(url),env,f.fetcher);assert.equal(denied.status,401);
});
test('proofs cannot be changed, replayed for another photo/run/origin, or bypass deleted/expired artifacts',async()=>{
  for(const mode of ['signature','photo','run','origin','expired','deleted','digest']){
    const {f,url,jwt}=await setup();let settings=env;
    if(mode==='signature'){const proof=url.searchParams.get('proof')!;url.searchParams.set('proof',(proof[0]==='A'?'B':'A')+proof.slice(1));}
    if(mode==='photo')url.pathname=url.pathname.replace(/[^/]+$/,'different-photo');
    if(mode==='run')url.pathname=url.pathname.replace('/1/','/2/');
    if(mode==='origin'){settings={...env,ADMIN_ORIGIN:'https://different.example.com'};url.hostname='different.example.com';}
    if(mode==='expired')f.setExpired();
    const response=await handle(new Request(url,{headers:{'Cf-Access-Jwt-Assertion':jwt}}),settings,async(input,init)=>{
      const r=await f.fetcher(input,init);
      if(String(input).includes('/artifacts?')){const d=await r.json();if(mode==='deleted')d.artifacts=d.artifacts.filter((a:any)=>a.name!=='photos');if(mode==='digest')d.artifacts.find((a:any)=>a.name==='admin-read').digest='sha256:'+'f'.repeat(64);return Response.json(d);}
      return r;
    });
    assert.equal(response.status,['expired','deleted'].includes(mode)?410:mode==='digest'?422:403,mode);
    assert(!JSON.stringify(await response.json()).includes(url.searchParams.get('proof')!));
  }
});
test('thumbnail failures expose bounded diagnostic stages without upstream URLs or credentials',async()=>{
  for(const mode of ['github-network','storage-network','storage-http','range','body','hash']){
    const {f,url,jwt}=await setup();
    const response=await handle(new Request(url,{headers:{'Cf-Access-Jwt-Assertion':jwt}}),env,async(input,init)=>{
      const u=String(input);
      if(mode==='github-network'&&u.includes('/artifacts?'))throw new TypeError('private upstream URL and credential');
      if(u.includes('blob.core.windows.net/admin-read')){
        if(mode==='storage-network')throw new TypeError('signed storage URL');
        if(mode==='storage-http')return new Response('secret failure',{status:502});
        const r=await f.fetcher(input,init);
        if(mode==='range'){r.headers.set('content-range','bytes 0-0/1');return r;}
        if(mode==='body')return new Response(new Uint8Array(),{status:206,headers:r.headers});
        if(mode==='hash'){const b=new Uint8Array(await r.arrayBuffer());b[0]^=1;return new Response(b,{status:206,headers:r.headers});}
        return r;
      }
      return f.fetcher(input,init);
    });
    assert.equal(response.status,['range','hash'].includes(mode)?422:502,mode);
    assert.equal(response.headers.get('X-Admin-Error-Stage'),mode==='github-network'?'github_request':mode==='storage-http'?'artifact_download':mode==='range'?'preview_range':mode==='hash'?'preview_hash':'preview_download');
    assert(response.headers.get('X-Admin-Request-Id'));
    const text=await response.text();for(const secret of ['secret failure','signed storage URL',env.GITHUB_TOKEN,url.searchParams.get('proof')!])assert(!text.includes(secret));
  }
});
