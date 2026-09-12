import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { preparePreview, fixtureRoot } from './prepare';
import { run, repo } from '../website/fixture';
import { serve } from '../website/server';
import { softwareGPUOptions } from '../browser';

test('sync panel previews selected sources without mutations, handles stale previews and completed sync', async()=>{
  await preparePreview();run(['node_modules/vite/bin/vite.js','build','--config','admin/vite.config.ts'],repo);
  const data=JSON.parse(await fs.readFile(path.join(fixtureRoot,'fixture.json'),'utf8'));
  const state={head:'a'.repeat(40),email:'admin@example.com',sources:data.sources,projects:data.projects,publishEnabled:false,media:{state:'ready',photos:data.photos,aliases:{},runId:1,expiresAt:'2030-01-01'}};
  const host=await serve(path.resolve('.cache/admin-release'));const browser=await chromium.launch(softwareGPUOptions('webgl'));
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1100}});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    const writes:any[]=[];let version='b';let completed=false;let failRefresh=false;let reads=0;let selection:string[]=[];
    const counts={total:12,previous:10,added:2,updated:1,removed:0,unchanged:9};
    const preview=()=>({head:state.head,revision:version.repeat(64),checkedAt:'2026-09-11T12:00:00Z',sourceIds:selection,baselineRunId:1,commits:{},counts,conflicts:[],errors:[],partialAllowed:true,sources:selection.map(id=>({sourceId:id,name:data.sources.find((s:any)=>s.sourceId===id).name,beforeCommit:'1'.repeat(40),commit:'2'.repeat(40),counts,changes:[{kind:'added',key:'new-image.jpg',reference:id+'new'}]}))});
    await page.route('**/api/**',async route=>{
      const req=route.request(),url=new URL(req.url());
      if(req.method()==='POST')writes.push({url:url.pathname,body:req.postDataJSON()});
      if(url.pathname==='/api/state'){reads++;if(failRefresh && completed)return route.fulfill({status:503,json:{message:'刷新服务暂不可用'}});return route.fulfill({json:state});}
      if(url.pathname==='/api/sync-preview'){selection=url.searchParams.getAll('sourceId');return route.fulfill({json:preview()});}
      if(url.pathname==='/api/dispatch'){
        if(version==='b'){version='c';return route.fulfill({status:409,json:{error:'preview_changed',message:'来源已变化，请检查更新后的预览，再点击同步照片',details:{preview:preview()}}});}
        completed=true;return route.fulfill({json:{requestId:'f274873e-f93d-4511-83d3-2468d2b105c6',mode:'sync',state:'pending'}});
      }
      if(url.pathname==='/api/tasks')return route.fulfill({json:{pending:false,tasks:completed?[{id:2,title:'Gallery sync',state:'completed',conclusion:'success',head:state.head,url:host.url,steps:[],summary:{action:'sync',photos:{status:'success'},adminRead:{status:'success'},sync:{applied:true,counts}}}]:[]}});
      throw new Error('Unexpected API '+url.pathname);
    });
    await page.route('**/thumbnails/*',async route=>route.fulfill({contentType:'image/jpeg',body:await fs.readFile(path.join(fixtureRoot,new URL(route.request().url()).pathname))}));
    await page.goto(host.url);await page.getByRole('tab',{name:'同步照片',exact:true}).click();
    assert(await page.getByLabel('同步来源 旧时光',{exact:true}).isDisabled());
    assert.equal(await page.locator('.sync-source').first().evaluate(el=>getComputedStyle(el).flexDirection),'row');
    await page.getByLabel('同步来源 日常观察',{exact:true}).uncheck();
    await page.getByRole('button',{name:'预览同步',exact:true}).click();
    await page.getByRole('heading',{name:/本次预览/}).waitFor();
    assert.deepEqual(selection,['fixture-travel']);assert.equal(writes.length,0);
    await page.getByText('旅行手记 · 新增 2 / 更新 1 / 移除 0 / 未变化 9',{exact:true}).click();
    await page.getByText('new-image.jpg',{exact:false}).waitFor();
    assert(await page.getByText('未应用任何更改',{exact:true}).isVisible());
    await page.screenshot({path:'.cache/sync-panel-desktop.png',fullPage:true});
    await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.screenshot({path:'.cache/sync-panel-mobile.png',fullPage:true});
    await page.getByRole('button',{name:'同步照片',exact:true}).click();
    await page.getByRole('alert').filter({hasText:'来源已变化'}).waitFor();
    assert.equal(writes.length,1);assert.equal(completed,false);
    await page.getByRole('button',{name:'同步照片',exact:true}).click();
    await page.getByText('同步已完成，照片库已刷新。网站尚未发布。',{exact:true}).waitFor();
    assert.equal(writes.length,2);assert.equal(reads,2);assert.equal(writes[1].body.previewRevision,'c'.repeat(64));
    assert.equal(await page.getByRole('region',{name:'本次预览',exact:true}).count(),0);
    const recent=page.getByRole('region',{name:'最近完成的同步',exact:true});assert(await recent.getByText('新增照片',{exact:true}).isVisible());
    completed=false;failRefresh=true;await page.reload();
    await page.getByRole('tab',{name:'同步照片',exact:true}).click();
    await page.getByRole('button',{name:'同步照片',exact:true}).click();
    await page.getByText('同步已完成，但照片库刷新失败，请重试刷新。网站尚未发布。',{exact:true}).waitFor();
    assert.equal(await page.getByText('同步已完成，照片库已刷新。网站尚未发布。',{exact:true}).count(),0);
    assert(writes.every(w=>w.url==='/api/dispatch'));
    assert.deepEqual(errors,[]);
  }finally{await browser.close();await host.close();}
});
