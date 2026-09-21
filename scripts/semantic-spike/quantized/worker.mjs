import {Tokenizer} from '/tokenizers.mjs';
import {encodeInputs} from '/tokenize.mjs';
let ort, session, tokenizer, dataset, images;
const progress=message=>postMessage({kind:'progress',message});
const now=()=>performance.now();
function normalize(values) {
 const norm=Math.hypot(...values);
 if(!Number.isFinite(norm)||norm===0)throw Error('Invalid embedding');
 return Array.from(values,x=>x/norm);
}
function search(vector,k=10) {
 const scores=dataset.photos.map((p,i)=>{
  let cosine=0;for(let j=0;j<dataset.dimension;j++)cosine+=images[i*dataset.dimension+j]*vector[j];
  return {index:i,publicId:p.publicId,id:p.id,filename:p.filename,cosine};
 });
 return scores.sort((a,b)=>b.cosine-a.cosine||a.index-b.index).slice(0,k);
}
async function query(text) {
 const start=now();
 const inputs=encodeInputs(tokenizer,text,dataset.kind);
 const feeds=Object.fromEntries(Object.entries(inputs).map(([k,ids])=>[k,new ort.Tensor('int64',BigInt64Array.from(ids,BigInt),[1,ids.length])]));
 const ids=inputs.input_ids;
 const t=now();
 const result=await session.run(feeds);
 const values=await result.text_embeds.getData();
 const vector=normalize(values);
 result.text_embeds.dispose();Object.values(feeds).forEach(t=>t.dispose());
 const embeddingMs=now()-t;
 const ranked=search(vector);
 return {text,input_ids:ids,embedding:vector,top:ranked,embeddingMs,totalMs:now()-start};
}
function stats(values){const x=[...values].sort((a,b)=>a-b);return {count:x.length,mean:x.reduce((a,b)=>a+b,0)/x.length,median:x[Math.floor(x.length/2)],p95:x[Math.ceil(x.length*.95)-1],min:x[0],max:x.at(-1)}}
function resources(){return performance.getEntriesByType('resource').map(r=>({name:r.name,encodedBodySize:r.encodedBodySize,decodedBodySize:r.decodedBodySize,transferSize:r.transferSize,duration:r.duration}))}
function memory(){return performance.memory?{usedJSHeapSize:performance.memory.usedJSHeapSize,totalJSHeapSize:performance.memory.totalJSHeapSize,jsHeapSizeLimit:performance.memory.jsHeapSizeLimit}:null}
async function benchmark({candidate='v64-int8',variant='model',backend='webgpu',repeats=3,threads=4,limit=48,profile=false,simulateNoWebGPU=false,transport='raw'}={}) {
 const prefix=transport==='br'?'/br':'';
 const asset=prefix+'/assets/'+candidate+'/';
 const started=now();performance.setResourceTimingBufferSize(300);
 const requestedBackend=backend;
 let fallbackReason=null;
 if(backend==='auto') {
  backend=(!simulateNoWebGPU && await navigator.gpu?.requestAdapter())?'webgpu':'wasm';
  if(backend==='wasm')fallbackReason='WebGPU adapter unavailable';
 }
 const beforeMemory=memory();
 ort=await import(prefix+'/ort/ort.webgpu.min.mjs');
 ort.env.wasm.wasmPaths=prefix+'/ort/';
 const effectiveThreads=self.crossOriginIsolated?threads:1;
 ort.env.wasm.numThreads=effectiveThreads;
 ort.env.wasm.proxy=false;
 if(profile)ort.env.logLevel='verbose';
 let adapterInfo=null;
 if(backend==='webgpu') {
  const adapter=await navigator.gpu?.requestAdapter({powerPreference:'high-performance'});
  if(!adapter)throw Error('WebGPU adapter unavailable; choose WASM explicitly');
  adapterInfo={vendor:adapter.info.vendor,architecture:adapter.info.architecture,device:adapter.info.device,description:adapter.info.description,
   isFallbackAdapter:adapter.info.isFallbackAdapter??adapter.isFallbackAdapter,
   features:[...adapter.features],limits:{maxBufferSize:adapter.limits.maxBufferSize,maxStorageBufferBindingSize:adapter.limits.maxStorageBufferBindingSize}};
 }
 progress('Fetching tokenizer and benchmark fixture');
 const fetchStarted=now();
 const [tokenizerJSON,config,data,manifest,imageBuffer]=await Promise.all([
  fetch(asset+'tokenizer.json').then(r=>r.json()),fetch(asset+'tokenizer_config.json').then(r=>r.json()),
  fetch(asset+'dataset.json').then(r=>r.json()),fetch(asset+'manifest.json').then(r=>r.json()),fetch(asset+'images.f32').then(r=>r.arrayBuffer())]);
 dataset=data;images=new Float32Array(imageBuffer);
 if(images.length!==data.photos.length*data.dimension)throw Error('Corpus/model embedding contract mismatch');
 const tokenizerStarted=now();tokenizer=new Tokenizer(tokenizerJSON,config);
 const parity=dataset.fixtures.map(q=>({id:q.id,match:Object.entries(encodeInputs(tokenizer,q.text,dataset.kind)).every(([k,v])=>JSON.stringify(v)===JSON.stringify(q[k]))}));
 if(parity.some(x=>!x.match))throw Error('Tokenizer parity failure: '+parity.filter(x=>!x.match).map(x=>x.id).join(','));
 const tokenizerInitMs=now()-tokenizerStarted;
 const dataAndTokenizerMs=now()-fetchStarted;
 progress(`Downloading ${variant} text tower`);
 const modelFetchStarted=now();
 const response=await fetch(asset+manifest.variants[variant].file);
 if(!response.ok)throw Error('Model download failed '+response.status);
 let buffer=await response.arrayBuffer();
 const modelFetchMs=now()-modelFetchStarted;
 const modelBytes=buffer.byteLength;
 progress(`Creating ${backend} session (${variant})`);
 const sessionStarted=now();
 const sessionOptions={executionProviders:[backend],graphOptimizationLevel:'all',logSeverityLevel:profile?0:2,logVerbosityLevel:profile?1:0};
 try {session=await ort.InferenceSession.create(buffer,sessionOptions);}
 catch(error) {
  if(requestedBackend!=='auto'||backend!=='webgpu')throw error;
  fallbackReason=String(error);backend='wasm';
  session=await ort.InferenceSession.create(buffer,{...sessionOptions,executionProviders:['wasm']});
 }
 buffer=null;
 const sessionCreateMs=now()-sessionStarted;
 const afterLoadMemory=memory();
 const readyMs=now()-started;
 progress('First query / shader compilation');
 const first=await query(dataset.queries[0].text);
 const coldToFirstResultMs=now()-started;
 // Exclude explicit warmup from steady-state timings; return every stage separately.
 for(let i=0;i<3;i++)await query(dataset.queries[i].text);
 const queryRows=dataset.queries.slice(0,limit).map(q=>({query:q,latencyMs:[],embeddingLatencyMs:[]}));
 for(let repeat=0;repeat<repeats;repeat++){
  for(let i=0;i<queryRows.length;i++){
   const stride=queryRows.length%17===0?1:17;
   const index=(i*stride+repeat*7)%queryRows.length;
   const row=queryRows[index];const value=await query(row.query.text);
   row.latencyMs.push(value.totalMs);row.embeddingLatencyMs.push(value.embeddingMs);
   if(repeat===0){row.embedding=value.embedding;row.input_ids=value.input_ids;row.top=value.top;}
  }
  progress(`${variant}/${backend}: round ${repeat+1}/${repeats}`);
 }
 return {candidate,variant,transport,backend,requestedBackend,fallbackReason,simulateNoWebGPU,repeats,threads:effectiveThreads,crossOriginIsolated:self.crossOriginIsolated,userAgent:navigator.userAgent,
  adapterInfo,runtime:ort.env.versions,modelBytes,tokenizerInitMs,dataAndTokenizerMs,modelFetchMs,sessionCreateMs,
  readyMs,firstQueryMs:first.totalMs,coldToFirstResultMs,
  warmMs:stats(queryRows.flatMap(x=>x.latencyMs)),queries:queryRows,tokenizerParity:parity,
  memory:{before:beforeMemory,afterLoad:afterLoadMemory,afterQueries:memory(),scope:'JS heap if exposed; excludes GPU/native allocations'},
  profile,resources:resources(),elapsedMs:now()-started};
}
self.onmessage=async({data:{id,command,options}})=>{
 try{postMessage({id,result:await(command==='benchmark'?benchmark(options):query(options.text))})}
 catch(error){postMessage({id,error:error.stack??String(error)})}
};
