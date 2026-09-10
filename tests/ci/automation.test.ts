import test from 'node:test';
import sharp from 'sharp';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { jpeg } from '../../scripts/photos/fixtures.js';
import { verifyPhotos, fileHashes, sha256 } from '../../scripts/photos/artifact.js';
import { sealCollection } from '../../scripts/photos/collection.js';
import { loadSources, makeSnapshot, photoReference, LEGACY_SOURCE } from '../../src/photo-engine/sources.js';
import { processingFingerprint } from '../../scripts/photos/fingerprint.js';
import { buildRelease, verifyRelease, type Release } from '../../scripts/ci/release.js';
import { deployRelease, rollbackDeployment, type DeployIO } from '../../scripts/ci/deploy.js';

const root = path.resolve('.cache/automation-test');
const engine = path.join(root, 'engine');
const photoOutput = path.join(engine, 'output');
const collection = path.join(root, 'collection');
const codeCommit = 'a'.repeat(40);
const read = async (file: string) => JSON.parse(await fs.readFile(file, 'utf8'));

test('Phase 6 immutable snapshots, incremental processing, release gates and deployment transaction', { timeout: 240_000 }, async () => {
  await fs.rm(root, { recursive: true, force: true }); await fs.mkdir(root, { recursive: true });
  const fixture = { ref: '1'.repeat(40), files: {} as Record<string, {file: string; commit: string}> };
  async function add(name: string, color: string, width = 96) {
    await fs.writeFile(path.join(root, name), await jpeg(color, width));
    fixture.files[`images/${name}`] = { file: name, commit: fixture.ref };
  }
  await add('one.jpg', '#224466'); await add('hidden.jpg', '#446688');
  await fs.writeFile(path.join(root, 'one.jpg'), await sharp(await jpeg('#224466')).withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:subject><rdf:Bag><rdf:li>fixture-keyword</rdf:li></rdf:Bag></dc:subject></rdf:Description></rdf:RDF></x:xmpmeta>').jpeg().toBuffer());
  async function photos(label: string, failed = false) {
    await fs.writeFile(path.join(root, 'fixture.json'), JSON.stringify(fixture));
    const before = await Promise.all(Object.values(fixture.files).map(async x => sha256(await fs.readFile(path.join(root,x.file)))));
    const run = spawnSync(process.execPath, ['--import','tsx','scripts/photos/cli.ts','--fixture',path.join(root,'fixture.json'),'--root',engine], { encoding: 'utf8', timeout: 90_000, env: { ...process.env, JASON_PHOTOS_READ_TOKEN: 'ci-secret-sentinel-do-not-emit' } });
    await fs.writeFile(path.join(root, `${label}.log`), run.stdout + run.stderr);
    assert(!(run.stdout + run.stderr).includes('ci-secret-sentinel-do-not-emit'));
    assert.equal(run.status === 0, !failed, `${label}: ${run.stderr}`);
    assert.deepEqual(await Promise.all(Object.values(fixture.files).map(async x => sha256(await fs.readFile(path.join(root,x.file))))), before);
    if (!failed) {
      const native = await verifyPhotos(photoOutput, { ref: fixture.ref });
      await fs.rm(collection, { recursive:true, force:true });
      await fs.cp(await fs.realpath(photoOutput), path.join(collection, 'sources/jason-photos'), { recursive:true });
      await sealCollection(collection, makeSnapshot(loadSources(), { 'jason-photos':fixture.ref }), native.fingerprint, 'fixture', [{ sourceId:'jason-photos', status:'success', commit:fixture.ref, total:native.photos, processed:native.processed, reused:native.reused, failureReason:null }]);
      return native;
    }
  }
  const cold = (await photos('cold'))!; assert.equal(cold.processed, 2); assert.equal(cold.reused, 0);
  const coldTags = (await read(path.join(photoOutput, 'photos-manifest.json'))).data.find((x: any) => x.s3Key === 'one.jpg').tags;
  assert(coldTags.includes('fixture-keyword'));
  const warm = (await photos('warm'))!; assert.equal(warm.processed, 0); assert.equal(warm.reused, 2);
  assert.deepEqual((await read(path.join(photoOutput, 'photos-manifest.json'))).data.find((x: any) => x.s3Key === 'one.jpg').tags, coldTags);
  await assert.rejects(verifyPhotos(photoOutput, { production: true }), /Fixture/);
  await assert.rejects(verifyPhotos(photoOutput, { ref: 'f'.repeat(40) }), /commit mismatch/);
  await assert.rejects(verifyPhotos(photoOutput, { fingerprint: 'obsolete' }), /fingerprint mismatch/);
  fixture.ref = '2'.repeat(40);
  const refreshed = (await photos('ref-only'))!; assert.equal(refreshed.processed, 0);
  const unchanged = await read(path.join(photoOutput,'photos-manifest.json'));
  assert(unchanged.data.every((x: any) => x.originalUrl.includes(fixture.ref)));
  await add('new.jpg','#775533');
  const added = (await photos('added'))!; assert.equal(added.photos,3); assert.equal(added.processed,1);
  fixture.ref = '3'.repeat(40); await add('one.jpg','#775511',128);
  const updated = (await photos('updated'))!; assert.equal(updated.processed,1); assert.equal(updated.reused,2);
  assert.equal((await read(path.join(photoOutput,'photos-manifest.json'))).data.find((x:any) => x.s3Key === 'one.jpg').width,128);
  delete fixture.files['images/new.jpg']; fixture.ref = '4'.repeat(40);
  const deleted = (await photos('deleted'))!; assert.equal(deleted.photos,2); assert.equal(deleted.processed,0);
  assert.equal((await fs.readdir(path.join(photoOutput,'public/thumbnails'))).length,2);
  const statePath = path.join(engine,'cache/state.json'); const cache = await read(statePath); cache.fingerprint = 'old-processor-or-dependency';
  await fs.writeFile(statePath,JSON.stringify(cache));
  assert.equal((await photos('processor-invalidated'))!.processed,2);
  const metadataFiles = await fs.readdir(path.join(engine,'cache/metadata'));
  await fs.writeFile(path.join(engine,'cache/metadata',metadataFiles.find(x => x.startsWith('one_'))!), '{}');
  assert.equal((await photos('metadata-corrupt'))!.processed,1);
  await fs.rm(path.join(engine,'cache'),{recursive:true});
  assert.equal((await photos('cache-lost'))!.processed,2);
  const success = await fileHashes(photoOutput);
  await fs.writeFile(path.join(root,'one.jpg'),'broken original');
  await photos('broken-source',true); assert.deepEqual(await fileHashes(photoOutput),success);
  await add('one.jpg','#775511',128);
  await fs.mkdir(path.join(engine,'build.lock')); await photos('concurrent-writer',true); await fs.rm(path.join(engine,'build.lock'),{recursive:true});
  await photos('restored');

  const site = path.join(root,'site');
  await fs.cp('src',path.join(site,'src'),{recursive:true,filter: name => !['content','data'].includes(path.relative('src',name).split(path.sep)[0]!)});
  await fs.mkdir(path.join(site,'src/content/projects'),{recursive:true});
  await fs.copyFile('package.json',path.join(site,'package.json'));
  await fs.cp('config',path.join(site,'config'),{recursive:true});
  await fs.writeFile(path.join(site,'astro.config.mjs'),`export {default} from ${JSON.stringify(new URL('../../astro.config.mjs',import.meta.url).href)};`);
  const manifest = await read(path.join(photoOutput,'photos-manifest.json'));
  const id = photoReference(LEGACY_SOURCE, manifest.data.find((x:any)=>x.s3Key==='one.jpg').id);
  const hiddenId = photoReference(LEGACY_SOURCE, manifest.data.find((x:any)=>x.s3Key==='hidden.jpg').id);
  const project = {schemaVersion:1,id:'test-project',slug:'test-project',title:'CI fixture',coverPhotoId:id,photos:[{photoId:id}],order:0,status:'published'};
  const projectFile = path.join(site,'src/content/projects/test-project.json');
  await fs.writeFile(projectFile,JSON.stringify(project));
  await fs.writeFile(path.join(site,'src/content/projects/draft.json'),JSON.stringify({...project,id:'draft',slug:'draft',status:'draft',coverPhotoId:hiddenId,photos:[{photoId:hiddenId}]}));
  const destination = path.join(root,'release');
  const build = () => buildRelease({photos:collection,root:site,destination,websiteCommit:codeCommit,runId:'test',runNumber:10,production:false});
  const release = await build(); assert.equal(release.publicPhotos,1); assert.equal(release.publishedProjects,1);
  await verifyRelease(destination,false); await assert.rejects(verifyRelease(destination,true),/provenance/);
  assert(!(await fileHashes(path.join(destination,'dist')))[`thumbnails/${hiddenId}.jpg`]);
  const beforeFingerprint = await processingFingerprint();
  project.title = 'Only Project changed'; await fs.writeFile(projectFile,JSON.stringify(project));
  assert.equal(await processingFingerprint(),beforeFingerprint);
  assert.equal((await photos('project-only'))!.processed,0);
  const projectRelease = await build(); assert.notEqual(projectRelease.projectDigest,release.projectDigest);
  const previousRelease = await fileHashes(destination);
  project.photos = [{photoId:'missing'}]; project.coverPhotoId = 'missing'; await fs.writeFile(projectFile,JSON.stringify(project));
  await assert.rejects(build(),/missing/); assert.deepEqual(await fileHashes(destination),previousRelease);
  project.photos = [{photoId:id}]; project.coverPhotoId = id; await fs.writeFile(projectFile,JSON.stringify(project));
  await fs.mkdir(path.join(site,'public/previews'),{recursive:true}); await fs.writeFile(path.join(site,'public/previews/selection.json'),'{}');
  await assert.rejects(build(),/Unexpected public file/); assert.deepEqual(await fileHashes(destination),previousRelease);
  await fs.rm(path.join(site,'public/previews'),{recursive:true});
  await fs.mkdir(path.join(site,'public/_astro'),{recursive:true}); await fs.writeFile(path.join(site,'public/_astro/fixture.json'),'{}');
  await assert.rejects(build(),/Unexpected public file/); await fs.rm(path.join(site,'public/_astro'),{recursive:true});

  // All remote behavior below is injected. No real hosting/photo repository mutation.
  // Promote ONLY this isolated test descriptor to exercise production validation gates.
  const original: Release = await read(path.join(destination,'release.json'));
  const {version: _, ...record} = original; record.source = 'github';
  const simulated: Release = {...record,version:sha256(JSON.stringify(record))};
  await fs.writeFile(path.join(destination,'release.json'),JSON.stringify(simulated));
  await fs.writeFile(path.join(destination,'dist/build-version.json'),JSON.stringify({version:simulated.version,websiteCommit:codeCommit,photoSnapshotVersion:simulated.photoSnapshot.version,runNumber:10}));
  let uploads = 0, rollback = false, wrongVersion = false;
  const old = {id:'00000000-0000-0000-0000-000000000001',url:'https://old.example',environment:'production',latest_stage:{status:'success'}};
  const next = {...old,id:'00000000-0000-0000-0000-000000000002',url:'https://new.example',deployment_trigger:{metadata:{commit_message:`gallery:${simulated.version}`}}};
  let latest = old;
  const io: DeployIO = {
    heads: async()=>({website:codeCommit,photos:simulated.photoSnapshot}),
    upload: async()=>{uploads++;latest=next;},
    version: async url => ({version:url===old.url?'old':wrongVersion?'wrong':simulated.version,websiteCommit:url===old.url?'b'.repeat(40):codeCommit,photoSnapshotVersion:simulated.photoSnapshot.version,runNumber:url===old.url?9:10}),
    api: async(route,method)=>{
      if (method==='POST') {rollback=true;latest=old;return old;}
      if (route.startsWith('/deployments?')) return [next,old];
      if (route===`/deployments/${old.id}`) return old;
      return {subdomain:'fixture.example',production_branch:'main',canonical_deployment:latest};
    },
  };
  await assert.rejects(deployRelease(destination,{...io,heads:async()=>({website:'f'.repeat(40),photos:simulated.photoSnapshot})}),/Superseded/); assert.equal(uploads,0);
  await assert.rejects(deployRelease(destination,{...io,heads:async()=>({website:codeCommit,photos:makeSnapshot(loadSources(), {'jason-photos':'f'.repeat(40)})})}),/Superseded/); assert.equal(uploads,0);
  await assert.rejects(deployRelease(destination,{...io,version:async()=>({version:'newer',websiteCommit:'b'.repeat(40),photoSnapshotVersion:simulated.photoSnapshot.version,runNumber:11})}),/Older workflow/); assert.equal(uploads,0);
  await assert.rejects(deployRelease(destination,{...io,upload:async()=>{throw new Error('upload failed');}}),/upload failed/); assert.equal(latest.id,old.id);
  const deployed = await deployRelease(destination,io); assert.equal(deployed.status,'success'); assert.equal(deployed.version,simulated.version);
  assert.equal((await deployRelease(destination,io)).status,'unchanged'); assert.equal(uploads,1);
  latest=old;wrongVersion=true;
  await assert.rejects(deployRelease(destination,io),/restored preceding/); assert(rollback); assert.equal(latest.id,old.id);
  wrongVersion=false;latest=next;
  const rolled = await rollbackDeployment(old.id,io); assert.equal(rolled.deploymentId,old.id); assert.equal(latest.id,old.id);
  await fs.writeFile(path.join(destination,'dist/index.html'),'tampered');
  const count=uploads;await assert.rejects(deployRelease(destination,io),/digest mismatch/);assert.equal(uploads,count);
  const summaryRoot = path.join(root, 'summary-job'); await fs.mkdir(summaryRoot);
  // This child owns a synthetic website snapshot. Workflow-dispatch inputs from
  // the parent job must not change which failure its summary test exercises.
  const summaryEnv = { ...process.env, GITHUB_SHA: codeCommit, EXPECTED_WEBSITE_COMMIT: codeCommit, TASK_MODE: 'sync', PHOTO_COMMIT: 'invalid', PHOTO_COMMITS: '', PHOTO_RUN_ID: '', GITHUB_OUTPUT: '', GITHUB_STEP_SUMMARY: '' };
  const raced = spawnSync(process.execPath, ['--import', 'tsx', path.resolve('scripts/ci/cli.ts'), 'resolve'], { cwd: summaryRoot, encoding: 'utf8', env: { ...summaryEnv, EXPECTED_WEBSITE_COMMIT: 'b'.repeat(40) } });
  assert.equal(raced.status, 1);
  assert.match((await read(path.join(summaryRoot, '.cache/automation/summary.json'))).failureReason, /Website changed before dispatch/);
  const failed = spawnSync(process.execPath, ['--import', 'tsx', path.resolve('scripts/ci/cli.ts'), 'resolve'], { cwd: summaryRoot, encoding: 'utf8', env: summaryEnv });
  assert.equal(failed.status, 1);
  const summarized = spawnSync(process.execPath, [path.resolve('scripts/ci/summary.mjs')], { cwd: summaryRoot, encoding: 'utf8', env: { ...process.env, JOB_STATUS: 'failure', GITHUB_STEP_SUMMARY: '' } });
  assert.equal(summarized.status, 0);
  const summary = await read(path.join(summaryRoot, '.cache/automation/summary.json'));
  assert.equal(summary.result, 'failure'); assert.equal(summary.websiteCommit, codeCommit);
  assert.equal(summary.photos.processed, null); assert.equal(summary.deployment.url, null); assert.match(summary.failureReason, /photo_commit/);
  await fs.writeFile(path.join(root,'report.json'),JSON.stringify({status:'PASS',cases:['cold','warm zero processing with native XMP tags preserved','commit URL refresh','add/update/delete','processor fingerprint','metadata corruption','cache loss','bad original preserves success','concurrent writer rejection','Project-only zero processing','all-photo artifact vs public filtering','dangling references preserve prior release','preview artifact rejection','superseded code/photo rejection','older run rejection','upload failure preserves live','provider-confirmed deploy version','unchanged deploy skip','verification failure rollback','explicit rollback','tampered release rejection','machine-readable failure summary']},null,2));
});
