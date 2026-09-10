import test from 'node:test';
import assert from 'node:assert/strict';
import { request, RequestError } from '../../admin/client/api';

test('platform HTML, empty/bad JSON and network failures retain meaningful status and uncertain writes',async()=>{
  const original=globalThis.fetch;
  try {
    for(const [status,body] of [[503,'<!doctype html><h1>Error 1102</h1>Worker exceeded resource limits'],[502,'<html>upstream secret body</html>'],[503,''],[200,'not json']] as const) {
      let calls=0;globalThis.fetch=async()=>{calls++;return new Response(body,{status});};
      await assert.rejects(request('/api/save',{kind:'project'}),(error:unknown)=>{
        assert(error instanceof RequestError);assert.equal(error.status,status);assert.equal(error.outcomeUnknown,true);assert.match(error.message,/保存结果尚未确认/);assert(!error.message.includes('upstream secret body'));
        if(status===503 && body.includes('1102')) assert.equal(error.code,'resource_limit');return true;
      });assert.equal(calls,1);
    }
    globalThis.fetch=async()=>{throw new TypeError('socket');};
    await assert.rejects(request('/api/save',{}),(e:unknown)=>e instanceof RequestError&&e.outcomeUnknown&&e.status===0);
    globalThis.fetch=async()=>Response.json({error:'conflict',message:'版本冲突'},{status:409});
    await assert.rejects(request('/api/save',{}),(e:unknown)=>e instanceof RequestError&&!e.outcomeUnknown&&e.status===409);
    globalThis.fetch=async()=>new Response('<html>Error 1102</html>',{status:503});
    await assert.rejects(request('/api/state'),(e:unknown)=>e instanceof RequestError&&!e.outcomeUnknown&&e.code==='resource_limit');
  }finally{globalThis.fetch=original;}
});


test('HTTP 200 is not save success without a confirmed new HEAD', async () => {
  const original = globalThis.fetch;
  try {
    for (const data of [{}, { head: 'b'.repeat(40) }, { status: 'saved', head: 'bad' }, { status: 'saved', head: 'a'.repeat(40) }, { status: 'saved', head: 'b'.repeat(40), saveProof: 123 }]) {
      let calls = 0;
      globalThis.fetch = async () => { calls++; return Response.json(data); };
      await assert.rejects(request('/api/save', { expectedHead: 'a'.repeat(40) }), (error: unknown) => error instanceof RequestError && error.outcomeUnknown && error.code === 'invalid_save_response');
      assert.equal(calls, 1);
    }
    globalThis.fetch = async () => Response.json({ status: 'saved', head: 'b'.repeat(40) });
    assert.equal((await request('/api/save', { expectedHead: 'a'.repeat(40) })).head, 'b'.repeat(40));
  } finally { globalThis.fetch = original; }
});
