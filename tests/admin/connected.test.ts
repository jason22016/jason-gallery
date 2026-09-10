// Isolated API response fixtures exercise UI requests; this is not Cloudflare login/deployment acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { preparePreview, fixtureRoot } from './prepare';
import { run, repo } from '../website/fixture';
import { serve } from '../website/server';
import { softwareGPUOptions } from '../browser';
test('connected UI sends versioned saves, preserves conflicts, checks impact and distinguishes pending from deployment', async()=>{
  await preparePreview();
  run(['node_modules/vite/bin/vite.js','build','--config','admin/vite.config.ts'],repo);
  const data=JSON.parse(await fs.readFile(path.join(fixtureRoot,'fixture.json'),'utf8'));
  const state={head:'a'.repeat(40),email:'admin@example.com',sources:data.sources,projects:data.projects,publishEnabled:false,media:{state:'ready',photos:data.photos,aliases:{},runId:17,expiresAt:new Date(Date.now()+86400000).toISOString()}};
  const host=await serve(path.resolve('.cache/admin-release'));const browser=await chromium.launch(softwareGPUOptions('webgl'));
  try {
    const page=await browser.newPage({viewport:{width:1280,height:900}});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    let conflict=true; const writes:any[]=[]; let impact=false; let taskData:any={pending:true,tasks:[]};
    await page.route('**/api/**',async route=>{
      const p=new URL(route.request().url()).pathname;
      const body=route.request().method()==='POST'?route.request().postDataJSON():null;
      if(body)writes.push({p,body});
      let response:any=state,status=200;
      if(p==='/api/save'){status=conflict?409:200;response=conflict?{message:'仓库已有更新，请合并编辑'}:{head:'b'.repeat(40)};}
      if(p==='/api/impact')response={impacts:impact?[{sourceId:data.sources[0].sourceId,projectId:'affected',title:'受影响的草稿',status:'draft',count:2}]:[]};
      if(p==='/api/dispatch')response={requestId:'f274873e-f93d-4511-83d3-2468d2b105c6',mode:body.mode,state:'pending'};
      if(p==='/api/tasks')response=taskData;
      await route.fulfill({status,json:response});
    });
    await page.route('**/thumbnails/*',async route=>route.fulfill({contentType:'image/jpeg',body:await fs.readFile(path.join(fixtureRoot,new URL(route.request().url()).pathname))}));
    await page.goto(host.url);await page.getByRole('heading',{name:'每一张，都有它的位置。'}).waitFor();
    assert.equal(await page.getByLabel('预览产物状态').count(),0);
    await page.getByRole('navigation').getByRole('button',{name:'Project',exact:true}).click();await page.getByRole('button',{name:/在路上/}).click();
    await page.getByLabel('标题',{exact:true}).fill('本地编辑不会丢失');await page.getByRole('button',{name:'保存 Project',exact:true}).click();
    await page.getByRole('heading',{name:'保存版本冲突'}).waitFor();await page.getByRole('button',{name:'保留编辑，返回检查'}).click();assert.equal(await page.getByLabel('标题',{exact:true}).inputValue(),'本地编辑不会丢失');
    const save=writes.find(v=>v.p==='/api/save');assert.equal(save.body.expectedHead,state.head);assert.equal(save.body.project.title,'本地编辑不会丢失');
    conflict=false;await page.getByRole('button',{name:'保存 Project',exact:true}).click();await page.getByText('Project 已提交 GitHub。网站尚未发布。',{exact:true}).waitFor();
    await page.getByRole('navigation').getByRole('button',{name:'照片源',exact:true}).click();await page.getByRole('button',{name:`编辑来源 ${data.sources[0].name}`,exact:true}).click();
    impact=true;await page.getByLabel('仓库名称',{exact:true}).fill('replacement');await page.getByText(/受影响的草稿/).waitFor();assert(await page.getByRole('button',{name:'保存配置到 GitHub',exact:true}).isDisabled());await page.getByRole('button',{name:'取消',exact:true}).click();
    await page.getByRole('navigation').getByRole('button',{name:'同步与发布',exact:true}).click();await page.getByRole('button',{name:'同步照片',exact:true}).click();await page.getByText('请求已发送，等待 GitHub 创建任务。尚未确认排队或成功，请勿重复触发。',{exact:true}).waitFor();assert(!await page.getByText('网站发布已确认',{exact:true}).count());
    taskData={pending:false,tasks:[{id:1,title:'Gallery sync',state:'completed',conclusion:'failure',event:'workflow_dispatch',head:state.head,url:host.url,steps:[],published:false,summary:{photos:{status:'failure'},website:{status:'not_started'},deployment:{status:'not_requested'},failureReason:'第二个来源读取失败 HTTP 403',sources:[{sourceId:'second',status:'failure',failureReason:'HTTP 403'}]}}]};
    await page.getByRole('navigation').getByRole('button',{name:'照片源',exact:true}).click();await page.getByRole('navigation').getByRole('button',{name:'同步与发布',exact:true}).click();await page.getByText('第二个来源读取失败 HTTP 403',{exact:true}).waitFor();await page.getByText('网站发布未确认',{exact:true}).waitFor();
    assert.equal(writes.find(v=>v.p==='/api/dispatch').body.expectedHead,'b'.repeat(40));assert.deepEqual(errors,[]);
    await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    const bundle=(await fs.readdir('.cache/admin-release/assets')).find(p=>p.endsWith('.js'))!;const js=await fs.readFile(path.join('.cache/admin-release/assets',bundle),'utf8');for(const sentinel of ['server-only-secret-sentinel','BEGIN PRIVATE KEY','fixture-travel','node:crypto','GITHUB_TOKEN'])assert(!js.includes(sentinel),sentinel);
    assert(!(await fs.readdir('.cache/admin-release')).includes('fixture.json'));
  }finally{await browser.close();await host.close();}
});
