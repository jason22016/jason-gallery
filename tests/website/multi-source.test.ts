import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';
import { chromium } from 'playwright';
import { expect } from 'playwright/test';
import { softwareGPUOptions } from '../browser.js';
import { serve } from './server.js';
import { LEGACY_SOURCE, parseSources, makeSnapshot } from '../../src/photo-engine/sources.js';
import { loadPhotoIndex } from '../../src/photo-engine/index.js';
import { buildRelease } from '../../scripts/ci/release.js';
import { deployRelease } from '../../scripts/ci/deploy.js';
import { jpeg } from '../../scripts/photos/fixtures.js';
import { fileHashes, sha256 } from '../../scripts/photos/artifact.js';

test('cross-source Gallery, metadata, Viewer sharing and map use the same qualified photo identity', { timeout: 120_000 }, async t => {
  const root = path.resolve('.cache/multi-source-website');
  await fs.rm(root, { recursive:true, force:true }); await fs.mkdir(root, { recursive:true });
  const site = path.join(root,'site');
  await fs.cp('src',path.join(site,'src'),{recursive:true,filter:file => !['data','content'].includes(path.relative('src',file).split(path.sep)[0]!)});
  await fs.copyFile('package.json',path.join(site,'package.json'));
  await fs.writeFile(path.join(site,'astro.config.mjs'), `export {default} from ${JSON.stringify(new URL('../../astro.config.mjs',import.meta.url).href)};`);
  const config = parseSources({schemaVersion:1,sources:[LEGACY_SOURCE,{...LEGACY_SOURCE,sourceId:'travel',name:'Travel',owner:'fixture',repo:'travel'}]});
  await fs.mkdir(path.join(site,'config')); await fs.writeFile(path.join(site,'config/photo-sources.json'),JSON.stringify(config));
  const projects = path.join(site,'src/content/projects'); await fs.mkdir(projects,{recursive:true});
  const repositories = [];
  for (const [i,s] of config.sources.entries()) {
    const bytes = await sharp(await jpeg(i ? '#a54e21' : '#225ea5',320,240)).withExif({ IFD0:{Make:`Source ${i}`,Artist:`Artist ${i}`}, IFD3:{GPSLatitudeRef:'N',GPSLatitude:`${22+i}/1 18/1 0/1`,GPSLongitudeRef:'E',GPSLongitude:'114/1 10/1 0/1'} }).jpeg().toBuffer();
    await fs.writeFile(path.join(root,`${s.sourceId}.jpg`),bytes);
    repositories.push({owner:s.owner,repo:s.repo,ref:String(i+1).repeat(40),files:{'images/same.jpg':{file:`${s.sourceId}.jpg`,commit:String(i+1).repeat(40)}}});
  }
  await fs.writeFile(path.join(root,'fixture.json'),JSON.stringify({repositories}));
  const run = spawnSync(process.execPath,['--import','tsx','scripts/photos/sync.ts','--root',path.join(root,'engine'),'--fixture',path.join(root,'fixture.json'),'--config',path.join(site,'config/photo-sources.json'),'--projects',projects],{encoding:'utf8',timeout:60_000});
  assert.equal(run.status,0,run.stdout+run.stderr);
  const photoRoot = path.join(root,'engine/output');
  const photos = loadPhotoIndex(path.join(photoRoot,'photo-index.json')).listPhotos();
  assert.equal(photos.length,2); assert.notEqual(photos[0]!.id,photos[1]!.id);
  assert(photos.every(p => typeof p.exif?.GPSLatitude === 'number'), 'Fixture GPS must pass through the native Builder');
  const project = {schemaVersion:1,id:'mixed',slug:'mixed',title:'Mixed sources fixture',coverPhotoId:photos[0]!.id,photos:photos.map((p,i)=>({photoId:p.id,alt:`Source ${i} photo`})),order:0,status:'published'};
  await fs.writeFile(path.join(projects,'mixed.json'),JSON.stringify(project));
  const releaseRoot = path.join(root,'release');
  const release = await buildRelease({photos:photoRoot,root:site,destination:releaseRoot,websiteCommit:'a'.repeat(40),runId:'fixture',runNumber:1,production:false});
  assert.equal(release.publicPhotos,2);
  const files = await fileHashes(path.join(releaseRoot,'dist'));
  assert(!Object.keys(files).some(name=>name.includes('photo-index') || name.includes('manifest') || name.startsWith('sources/')));
  for (const p of photos) assert(files[`projects/mixed/photos/${p.id}.json`] && files[`thumbnails/${p.id}.jpg`]);
  const server = await serve(path.join(releaseRoot,'dist')); t.after(()=>server.close());
  const browser = await chromium.launch(softwareGPUOptions('webgl')); t.after(()=>browser.close());
  const context = await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'}); t.after(()=>context.close());
  // Exercise the normal image fallback with native source URLs; route bytes only
  // in this isolated browser so no real fixture repository is created or read.
  await context.addInitScript({content: `
    Object.defineProperty(navigator, 'gpu', {configurable:true, value:undefined});
    Object.defineProperty(navigator, 'clipboard', {configurable:true, value:undefined});
    const nativeContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) {
      return ['webgl','webgl2','experimental-webgl'].includes(type) && this.closest('.viewer-drag-content')
        ? null : nativeContext.call(this, type, ...args);
    };
  `});
  const page = await context.newPage();
  const errors:string[]=[]; page.on('pageerror',error=>errors.push(error.message));
  for (const [i,p] of photos.entries()) await page.route(p.originalUrl,route=>route.fulfill({contentType:'image/jpeg',path:path.join(root,`${config.sources[i]!.sourceId}.jpg`)}));
  await page.route('**/dark-matter-gl-style/style.json',route=>route.fulfill({json:{version:8,glyphs:`${server.url}/fixture-font/{fontstack}/{range}.pbf`,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#102030'}}]}}));
  await page.route('**/fixture-font/**',route=>route.fulfill({contentType:'application/x-protobuf',body:Buffer.alloc(0)}));
  await page.goto(server.url); await page.getByRole('link',{name:/Mixed sources fixture/}).first().click();
  await expect(page.locator('.gallery-live [data-gallery-index]')).toHaveCount(2);
  await page.locator('.gallery-live [data-gallery-index="0"]').click();
  for (const [i,p] of photos.entries()) {
    await expect(page.locator('.viewer-fallback')).toHaveAttribute('src',p.originalUrl);
    await expect(page.locator('.metadata-content')).toContainText(`Artist ${i}`);
    assert.equal(new URL(page.url()).searchParams.get('photo'),p.id);
    const details = await context.request.get(`${server.url}/projects/mixed/photos/${p.id}.json`);
    assert.equal(details.status(),200); assert.equal((await details.json()).exif.Artist,`Artist ${i}`);
    await page.getByRole('button',{name:'分享照片'}).click(); await expect(page.locator('.viewer-message')).toContainText(p.id);
    await page.reload(); await expect(page.locator('.viewer-fallback')).toHaveAttribute('src',p.originalUrl);
    if (i===0) await page.keyboard.press('ArrowRight');
  }
  await page.getByRole('button',{name:'关闭照片'}).click();
  await page.getByRole('button',{name:'地图探索'}).click();
  await expect(page.locator('.photo-map')).toHaveAttribute('data-map-state','ready');
  await expect(page.locator('.map-photo-list button')).toHaveCount(2);
  await page.locator('.map-photo-list button').nth(1).click();
  await expect(page.locator('.viewer-fallback')).toHaveAttribute('src',photos[1]!.originalUrl);
  assert.equal(new URL(page.url()).searchParams.get('photo'),photos[1]!.id);
  assert.deepEqual(errors,[]);
  // Isolated deployment gate only: no hosting account, API or uploader is used.
  const { version: _, ...record } = release;
  const simulated = { ...record, source:'github' as const };
  const version = sha256(JSON.stringify(simulated));
  await fs.writeFile(path.join(releaseRoot,'release.json'),JSON.stringify({...simulated,version}));
  await fs.writeFile(path.join(releaseRoot,'dist/build-version.json'),JSON.stringify({version,websiteCommit:release.websiteCommit,photoSnapshotVersion:release.photoSnapshot.version,runNumber:1}));
  let uploads = 0;
  const commits = Object.fromEntries(release.photoSnapshot.sources.map(s=>[s.sourceId,s.commit]));
  for (const snapshot of [makeSnapshot(config,{...commits,travel:'f'.repeat(40)}),makeSnapshot(parseSources({...config,sources:config.sources.slice(0,1)}),{'jason-photos':commits['jason-photos']!})]) {
    await assert.rejects(deployRelease(releaseRoot,{
      heads:async()=>({website:release.websiteCommit,photos:snapshot}),
      api:async()=>{throw new Error('Must reject before provider access');},
      upload:async()=>{uploads++;},
      version:async()=>{throw new Error('Must reject before version lookup');},
    }),/Superseded/);
  }
  assert.equal(uploads,0,'Changed second source or source set must never upload');
});
