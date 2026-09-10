import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import ts from 'typescript';
const require=createRequire(import.meta.url);
const { Miniflare, convertV4MiniflareOptions }=await import(require.resolve('miniflare',{paths:[dirname(require.resolve('wrangler/package.json'))]}));
test('native bounded stream reader handles fragments, EOF and overflow without losing bytes', async () => {
const directory=await mkdtemp(resolve(tmpdir(),'admin-stream-test-'));
const source=ts.transpileModule(await readFile('admin/server/errors.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const scriptPath=resolve(directory,'worker.mjs');
await writeFile(scriptPath,source+`
export default {async fetch(req) {
 const p=new URL(req.url).searchParams,n=Number(p.get('n')),limit=Number(p.get('limit'));
 let sent=0,cancelled=false;
 const stream=new ReadableStream({type:'bytes',pull(controller){if(sent===n){controller.close();return;}const size=Math.min(997,n-sent);controller.enqueue(new Uint8Array(size).fill(42));sent+=size;},cancel(){cancelled=true;}});
 const probe=stream.getReader({mode:'byob'}); const native=typeof probe.readAtLeast==='function';probe.releaseLock();
 try{const value=await bytes(new Response(stream),limit);return Response.json({native,length:value.length,valid:value.every(b=>b===42),cancelled});}
 catch(e){return Response.json({native,code:e.code,cancelled});}
}};`);
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,modulesRoot:directory,scriptPath,compatibilityDate:'2026-09-10'}));
try {for(const [n,limit] of [[0,0],[1,1],[997,1000],[1000,1000],[1001,1000],[262144,262144],[262145,262145],[600000,600000],[600001,600000]]){const r=await(await mf.dispatchFetch(`http://test/?n=${n}&limit=${limit}`)).json() as any;assert.equal(r.native,true);if(n>limit){assert.equal(r.code,'too_large');assert.equal(r.cancelled,true);}else{assert.equal(r.length,n);assert.equal(r.valid,true);}}}finally{await mf.dispose();await rm(directory,{recursive:true,force:true});}
});
