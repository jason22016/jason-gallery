import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import { run, repo } from '../website/fixture';
test('actual local workerd protects static assets and every write without a signed Access session', {timeout:60000}, async()=>{
  run(['node_modules/vite/bin/vite.js','build','--config','admin/vite.config.ts'],repo);
  const probe=createServer();await new Promise<void>(r=>probe.listen(0,'127.0.0.1',r));const port=(probe.address() as any).port;await new Promise<void>(r=>probe.close(()=>r()));
  const child=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','dev','--local','--config','admin/wrangler.jsonc','--ip','127.0.0.1','--port',String(port),'--var',`ADMIN_ORIGIN:https://admin.example.com`,'--var','ACCESS_ISSUER:https://fixture.cloudflareaccess.com','--var','ACCESS_AUD:fixture-audience','--var','ADMIN_EMAILS:admin@example.com','--var','GITHUB_TOKEN:runtime-test-only-sentinel'],{cwd:repo,env:{...process.env,WRANGLER_SEND_METRICS:'false',WRANGLER_LOG_PATH:path.join(repo,'.cache/wrangler-test-logs')},stdio:['ignore','pipe','pipe']});
  let log='';child.stdout.on('data',v=>log+=v);child.stderr.on('data',v=>log+=v);
  try{
    let ready=false;
    for(let i=0;i<120;i++){try{if((await fetch(`http://127.0.0.1:${port}/api/state`)).status===401){ready=true;break;}}catch{}if(child.exitCode!==null)break;await new Promise(r=>setTimeout(r,250));}
    assert(ready,log);
    for(const [p,method] of [['/','GET'],['/api/save','POST'],['/api/impact','POST'],['/api/dispatch','POST'],['/api/tasks','GET'],['/api/thumbnail/1/test','GET']]){const r=await fetch(`http://127.0.0.1:${port}${p}`,{method});assert.equal(r.status,401);assert.equal(r.headers.get('cache-control'),'no-store');assert(!(await r.text()).includes('runtime-test-only-sentinel'));}
  }finally{child.kill('SIGTERM');await new Promise<void>(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',()=>resolve());setTimeout(()=>{child.kill('SIGKILL');resolve();},5000).unref();});}
});

// The production bundle and native fetch/Cache/ZIP paths run inside workerd. Only upstreams are fixtures.
test('authenticated workerd requests validate artifacts, thumbnails, saves and pending dispatches with cold/warm caches', {timeout:60000}, async()=>{
  run(['node_modules/wrangler/bin/wrangler.js','deploy','--dry-run','--config','admin/wrangler.jsonc','--outdir','.cache/admin-runtime-authenticated'],repo);
  run(['--import','tsx','tests/admin/profile.ts','admin/.cache/admin-runtime-authenticated/worker.js','.cache/admin-runtime-authenticated','--smoke'],repo);
});
