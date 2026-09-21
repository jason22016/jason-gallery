// Standard HTTP Brotli encoding; original ONNX/tokenizer bytes and runtime stay unchanged.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {brotliCompress,constants} from 'node:zlib';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const out=path.join(root,'.cache/semantic-spike/quantized');
const compress=promisify(brotliCompress),rows=[];
const runtime=path.join(root,'.cache/semantic-spike/phase2a/runtime/node_modules/onnxruntime-web/dist');
const files=[];
for(const name of process.argv.slice(2)) {
 if(!/^v[0-9]+-[a-z0-9-]+$/.test(name))throw Error('Invalid candidate');
 for(const f of ['model.onnx','tokenizer.json','tokenizer_config.json','dataset.json','manifest.json','images.f32'])files.push([path.join(out,name,f),path.join(out,'brotli',name,f)+'.br']);
}
for(const f of await fs.readdir(runtime))if(/\.(mjs|wasm)$/.test(f)&&!f.includes('.bundle.'))files.push([path.join(runtime,f),path.join(out,'brotli','ort',f)+'.br']);
for(const [src,dst] of files) {
 const data=await fs.readFile(src);
 const zipped=await compress(data,{params:{[constants.BROTLI_PARAM_QUALITY]:6}});
 await fs.mkdir(path.dirname(dst),{recursive:true});await fs.writeFile(dst,zipped);
 rows.push({source:path.relative(root,src),file:path.relative(out,dst),rawBytes:data.length,bytes:zipped.length,sha256:createHash('sha256').update(data).digest('hex')});
 console.log(path.basename(src),data.length,zipped.length);
}
await fs.writeFile(path.join(out,'compression.json'),JSON.stringify({method:'HTTP Content-Encoding: br, Brotli quality 6',files:rows},null,2));
