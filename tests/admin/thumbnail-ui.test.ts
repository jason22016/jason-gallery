import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { preparePreview, fixtureRoot } from './prepare';
import { run, repo } from '../website/fixture';
import { serve } from '../website/server';
import { softwareGPUOptions } from '../browser';
test('154 visible thumbnails are queued at four, retry transient reads once, surface auth failures and share duplicate covers',async()=>{
  await preparePreview();run(['node_modules/vite/bin/vite.js','build','--config','admin/vite.config.ts'],repo);
  const fixture=JSON.parse(await fs.readFile(path.join(fixtureRoot,'fixture.json'),'utf8'));
  const bodies=await Promise.all(fixture.photos.map((p:any)=>fs.readFile(path.join(fixtureRoot,p.photo.thumbnailUrl))));
  const photos=Array.from({length:154},(_,i)=>({...fixture.photos[i%18],photo:{...fixture.photos[i%18].photo,id:`photo-${i}`,title:`Photo ${i}`,thumbnailUrl:`/api/thumbnail/1/p-${i}?proof=isolated-ui-test`}}));
  const projects=Array.from({length:40},(_,i)=>({...fixture.projects[0],id:`project-${i}`,slug:`project-${i}`,title:`Project ${i}`,coverPhotoId:photos[0].photo.id,photos:[{photoId:photos[0].photo.id}]}));
  const state={head:'a'.repeat(40),email:'admin@example.com',sources:fixture.sources,projects,publishEnabled:false,media:{state:'ready',photos,aliases:{},runId:1}};
  const host=await serve(path.resolve('.cache/admin-release')),browser=await chromium.launch(softwareGPUOptions('webgl'));
  try{
    const page=await browser.newPage({viewport:{width:1280,height:20000}});let active=0,maxActive=0,repaired=false;const attempts=new Map<number,number>();
    await page.route('**/api/state',route=>route.fulfill({json:state}));
    await page.route('**/api/thumbnail/**',async route=>{
      const i=Number(new URL(route.request().url()).pathname.split('/p-')[1]);attempts.set(i,(attempts.get(i)??0)+1);active++;maxActive=Math.max(maxActive,active);
      try{await new Promise(resolve=>setTimeout(resolve,30));
        if(i===1&&attempts.get(i)===1)return await route.fulfill({status:502,json:{error:'storage_http',message:'storage transient'}});
        if(!repaired&&i===2)return await route.fulfill({status:401,json:{error:'unauthorized'}});
        if(!repaired&&i===3)return await route.fulfill({status:200,contentType:'text/html',body:'not an image'});
        await route.fulfill({contentType:'image/jpeg',body:bodies[i%18],headers:{'X-Admin-Request-Id':`thumbnail-test-${i}`}});
      }finally{active--;}
    });
    await page.goto(host.url);await page.getByRole('heading',{name:'每一张，都有它的位置。'}).waitFor();
    await page.waitForFunction(()=>document.querySelectorAll('img[data-thumbnail-status="ready"]').length===152,{},{timeout:30000});
    assert.equal(maxActive,4);assert.equal(attempts.size,154);assert.equal(attempts.get(1),2);assert.equal(attempts.get(2),1);assert.equal(attempts.get(3),1);
    await page.getByText(/2 张缩略图加载失败/).waitFor();await page.getByText(/请重新登录后重试/).waitFor();
    repaired=true;await page.getByRole('button',{name:'重试失败缩略图',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('img[data-thumbnail-status="ready"]').length===154&&[...document.images].every(i=>i.complete&&i.naturalWidth>0),{},{timeout:30000});
    assert.equal(attempts.get(2),2);assert.equal(attempts.get(3),2);assert.equal(await page.getByRole('button',{name:'重试失败缩略图',exact:true}).count(),0);
    const previous=attempts.get(0)!;
    await page.getByRole('navigation').getByRole('button',{name:'Project',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('.project-card img[data-thumbnail-status="ready"]').length===40);
    assert.equal(attempts.get(0)!-previous,1,'40 identical covers must share one image request');assert.equal(maxActive,4);
  }finally{await browser.close();await host.close();}
});
