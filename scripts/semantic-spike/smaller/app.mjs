let worker;
const pending = new Map();
let sequence = 0;
const status = document.querySelector('#status');
const output = document.querySelector('#results');
window.spike = {
 async run(options={}) {
  worker?.terminate();
  worker = new Worker('/worker.mjs',{type:'module'});
  worker.onmessage = ({data})=>{
   if(data.kind==='progress') {status.textContent=data.message; return;}
   const callback=pending.get(data.id); if(!callback)return;
   pending.delete(data.id);
   if(data.error)callback.reject(new Error(data.error)); else callback.resolve(data.result);
  };
  worker.onerror = event=>{for(const callback of pending.values())callback.reject(new Error(event.message));pending.clear()};
  const result=await request('benchmark',options);
  window.lastResult=result;
  status.textContent='Complete';
  output.textContent=JSON.stringify({...result,queries:`${result.queries.length} query records (available via window.lastResult)`},null,2);
  document.querySelector('#search').disabled=false;
  return result;
 },
 query(text) {return request('query',{text})},
 terminate() {worker?.terminate();worker=null;}
};
function request(command,options) {
 const id=++sequence;
 return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});worker.postMessage({id,command,options})});
}
document.querySelector('#run').onclick=()=>window.spike.run({candidate:document.querySelector('#candidate').value,variant:document.querySelector('#variant').value,limit:66,backend:document.querySelector('#backend').value}).catch(error=>status.textContent=error.stack);
document.querySelector('#search').onclick=()=>window.spike.query(document.querySelector('#query').value).then(({embedding,input_ids,...r})=>output.textContent=JSON.stringify(r,null,2)).catch(e=>status.textContent=e.stack);
