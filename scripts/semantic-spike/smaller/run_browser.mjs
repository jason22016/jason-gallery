// Each run uses a fresh browser process/context. Captures measured transfers and process RSS.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec=promisify(execFile);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const out=path.join(root,'.cache/semantic-spike/smaller');
const args=process.argv.slice(2);
const candidate=args[0]??'trim64k',backend=args[1]??'webgpu',variant=args.includes('--fp32')?'fp32':'int8wo';
const label=args[2]??`${candidate}-${variant}-${backend}`;
if(!/^[a-z0-9-]+$/.test(label))throw Error('Invalid label');
const profile=args.includes('--profile');
const launchArgs=['--enable-precise-memory-info'];
if(args.includes('--unsafe-webgpu'))launchArgs.push('--enable-unsafe-webgpu');
const browser=await chromium.launch({channel:'chrome',headless:true,args:launchArgs});
const rows=[],logs=[],requests=[],transfers=[];
let timer,polling=false,result;
const started=Date.now();
try {
 const context=await browser.newContext();
 context.on('requestfinished',async request=>{
  const response=await request.response();
  if(response)transfers.push({url:request.url(),status:response.status(),contentLength:Number(response.headers()['content-length']??0)});
 });
 await context.route('**/*',route=>new URL(route.request().url()).origin==='http://127.0.0.1:8768'?route.continue():route.abort());
 const page=await context.newPage();
 page.setDefaultTimeout(240000);
 page.on('console',m=>{logs.push({type:m.type(),text:m.text()}); if(m.type()==='error')console.log(m.text().slice(0,600))});
 page.on('pageerror',e=>logs.push({type:'pageerror',text:e.stack}));
 page.on('request',r=>requests.push(r.url()));
 const cdp=await context.newCDPSession(page);
 await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
 const networkIndex=args.indexOf('--mbps');
 const networkMbps=networkIndex>=0?Number(args[networkIndex+1]):null;
 if(networkMbps)await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:40,
  downloadThroughput:networkMbps*1e6/8,uploadThroughput:networkMbps*1e6/8});
 const browserCDP=await browser.newBrowserCDPSession();
 const hardware=await browserCDP.send('SystemInfo.getInfo');
 async function sample() {
  if(polling)return;polling=true;
  try {
   const {processInfo}=await browserCDP.send('SystemInfo.getProcessInfo');
   const ids=processInfo.map(p=>p.id);
   const {stdout}=await exec('ps',['-o','pid=,rss=','-p',ids.join(',')]);
   const processRSS=stdout.trim().split('\n').filter(Boolean).map(line=>{const[pid,kib]=line.trim().split(/\s+/).map(Number);return {pid,type:processInfo.find(p=>p.id===pid)?.type,rssBytes:kib*1024}});
   rows.push({elapsedMs:Date.now()-started,rssSumBytes:processRSS.reduce((n,p)=>n+p.rssBytes,0),processes:processRSS});
  } catch(error){logs.push({type:'memory-sample',text:error.message})}finally{polling=false}
 }
 await page.goto('http://127.0.0.1:8768');
 await page.waitForFunction(()=>!!window.spike);
 await sample();timer=setInterval(sample,500);
 console.log(`Running ${label} on ${browser.version()}`,new Date().toISOString());
 const options={candidate,variant,backend,repeats:profile?1:3,limit:profile?1:66,profile,simulateNoWebGPU:args.includes('--simulate-no-webgpu')};
 if(args.includes('--single-thread'))options.threads=1;
 result=await Promise.race([page.evaluate(options=>window.spike.run(options),options),new Promise((_,reject)=>setTimeout(()=>reject(Error('Browser run exceeded 240 s')),240000).unref())]);
 if(options.simulateNoWebGPU && (result.backend!=='wasm'||!result.fallbackReason))throw Error('Automatic WASM fallback did not occur');
 await sample();
 result.status='success';result.hardware=hardware;result.browserVersion=browser.version();result.launchArgs=launchArgs;
 result.networkEmulation=networkMbps?{mbps:networkMbps,latencyMs:40,scope:'CDP request throttling; verify measured worker transfer rate before interpretation'}:null;
 result.freeQuery=await page.evaluate(()=>window.spike.query('湖边的树木'));
 await page.screenshot({path:path.join(out,`${label}.png`),fullPage:false});
 console.log(JSON.stringify({label,status:result.status,coldMs:result.coldToFirstResultMs,warm:result.warmMs,adapter:result.adapterInfo}));
} catch(error) {
 result={status:'error',candidate,variant,backend,error:error.stack,elapsedMs:Date.now()-started,browserVersion:browser.version()};
 console.log(label,'ERROR',error.message);
} finally {
 clearInterval(timer);
 result.processMemory={scope:'Sum of RSS of this Chrome process tree (shared pages can be counted more than once; GPU allocations not separately measurable)',samples:rows,
  baselineBytes:rows[0]?.rssSumBytes??null,peakBytes:rows.length?Math.max(...rows.map(r=>r.rssSumBytes)):null};
 result.logs=logs;result.requests=requests;result.transfers=transfers;
 await fs.writeFile(path.join(out,`${label}.json`),JSON.stringify(result,null,2));
 await browser.close();
}
