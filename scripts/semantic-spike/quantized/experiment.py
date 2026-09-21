"""Official ORT N-bit operators, original FP32 weights, immutable smaller-spike baseline."""
import sys
sys.dont_write_bytecode=True
from pathlib import Path
import importlib.util
spec=importlib.util.spec_from_file_location('smaller',Path(__file__).resolve().parents[1]/'smaller/experiment.py')
e=importlib.util.module_from_spec(spec);spec.loader.exec_module(e)
import argparse, copy, gc, json, shutil
from collections import Counter
from onnxruntime.quantization.matmul_nbits_quantizer import MatMulNBitsQuantizer, DefaultWeightOnlyQuantConfig
from onnxruntime.quantization import QuantFormat
OUT=e.CACHE/'quantized';OUT.mkdir(exist_ok=True)
HERE=Path(__file__).resolve().parent

def queries():return e.all_queries()+e.read(HERE/'hard-queries.json')

def freeze():
    e.freeze()
    assert e.sha256(e.BASE/'fp32.onnx')==e.read(e.BASE/'manifest.json')['variants']['fp32']['sha256'], 'Original FP32 export changed'
    files=[HERE/'hard-queries.json',e.OUT/'trim64k/int8wo.onnx',e.OUT/'trim64k/tokenizer.json',e.OUT/'trim64k/row-map.json',e.CACHE/'siglip2/image-embeddings.npy',e.CACHE/'annotations.json']
    hashes={str(p.relative_to(e.ROOT)):e.sha256(p) for p in files}
    p=OUT/'input-hashes.json'
    if p.exists():assert e.read(p)==hashes
    else:e.write(p,hashes)
    gate=OUT/'decision-gates.json'
    if not gate.exists():e.write(gate,{'primary':'Relative to 64k INT8: each zh/en nDCG@5/10 drop <= 0.02, Hit@1 loss <=1/22, no Hit@5/10 loss.',
      'extensions':'Each existing Hant/mixed/free group nDCG@5/10 drop <=0.03 and no Hit@5/10 loss. Hard queries reported separately; no hiding regressions in pooled averages.',
      'compatibility':'Actual stock Chrome WebGPU and WASM success; no custom kernels. Unlabelled geography/equipment diagnostics have rankings but no accuracy.',
      'selection':'Among quality/compatibility passing candidates, compare bytes, latency, memory; stop smaller vocabulary routes after clear failures. Gates are screening heuristics, not statistically powered noninferiority tests.'})

def vocab(size):
    p=OUT/f'vocab{size}';p.mkdir(exist_ok=True)
    if size in (32,64):
        source=e.OUT/f'trim{size}k'
        for f in ('int8wo.onnx','tokenizer.json','tokenizer_config.json','row-map.json','trim-policy.json'):
            if not (p/f).exists():(p/f).symlink_to((source/f).resolve())
    else:
        old=e.OUT;e.OUT=OUT
        try:e.trim(size*1024)
        finally:e.OUT=old
        for f in ('int8wo.onnx','tokenizer.json','tokenizer_config.json','row-map.json','trim-policy.json'):
            if not (p/f).exists():(p/f).symlink_to((OUT/f'trim{size}k'/f).resolve())
    return p

def export(name,size,mode='int4',symmetric=True,block=32,embedding4=False):
    p=OUT/name;p.mkdir(exist_ok=True);v=OUT/f'vocab{size}'
    for f in ('tokenizer.json','tokenizer_config.json','row-map.json','trim-policy.json'):
        if not (p/f).exists():(p/f).symlink_to((v/f).resolve())
    target=p/'model.onnx';changes=[]
    if mode=='int8':
        if not target.exists():target.symlink_to((v/'int8wo.onnx').resolve())
    elif not target.exists():
        # Start from baseline INT8 embeddings. Restore selected linear weights from original FP32,
        # then quantize once. Never INT8 -> INT4 requantization.
        model=e.onnx.load(v/'int8wo.onnx');full=e.onnx.load(e.BASE/'fp32.onnx')
        original={t.name:t for t in full.graph.initializer}
        selected=[n for n in model.graph.node if mode!='embedding4' and n.op_type=='MatMul' and n.input[1] in original and (mode!='mlp4' or '/mlp/' in n.name)]
        names={n.input[1] for n in selected};changes=[n.name for n in selected]
        assert len(selected)==(0 if mode=='embedding4' else 24 if mode=='mlp4' else 72)
        keep_nodes=[n for n in model.graph.node if not(n.op_type=='DequantizeLinear' and n.output[0] in names)]
        drop={name+suffix for name in names for suffix in ('_q8','_scales','_zeros')}
        keep_initial=[t for t in model.graph.initializer if t.name not in drop]+[original[name] for name in sorted(names)]
        if embedding4:
            # Replace the baseline Gather/Gather/Cast/Mul chain with the original FP32 Gather.
            gather=next(n for n in full.graph.node if n.op_type=='Gather' and 'token_embedding' in n.input[0])
            emb_name=gather.input[0];out=gather.output[0]
            keep_nodes=[n for n in keep_nodes if not any(o==out or o.startswith(out+'_') for o in n.output)]
            # Keep the input reshape before Gather; insert immediately before its first consumer.
            index=next(i for i,n in enumerate(keep_nodes) if out in n.input)
            keep_nodes.insert(index,copy.deepcopy(gather));changes.append(gather.name)
            keep_initial=[t for t in keep_initial if not t.name.startswith(emb_name)]
            rows=e.read(v/'row-map.json');arr=e.numpy_helper.to_array(original[emb_name])[rows].copy()
            keep_initial.append(e.numpy_helper.from_array(arr,emb_name))
        del model.graph.node[:];model.graph.node.extend(keep_nodes)
        del model.graph.initializer[:];model.graph.initializer.extend(keep_initial)
        del full,original;gc.collect()
        config=DefaultWeightOnlyQuantConfig(block_size=block,is_symmetric=symmetric,accuracy_level=1,
          quant_format=QuantFormat.QOperator,op_types_to_quantize=('MatMul','Gather') if embedding4 else ('MatMul',),
          quant_axes=(('MatMul',0),('Gather',1)),bits=4)
        excluded=[n.name for n in model.graph.node if n.name not in changes]
        quant=MatMulNBitsQuantizer(model,nodes_to_include=changes,nodes_to_exclude=excluded,algo_config=config)
        quant.process();temporary=p/'model.pending.onnx'
        e.onnx.save(quant.model.model,temporary);e.onnx.checker.check_model(str(temporary));temporary.replace(target)
        del model,quant;gc.collect()
    tok=e.Tokenizer.from_file(str(p/'tokenizer.json'));tok.no_padding();tok.no_truncation()
    baseline=e.Tokenizer.from_file(str(e.OUT/'trim64k/tokenizer.json'));baseline.no_padding();baseline.no_truncation()
    rows=e.read(p/'row-map.json');base_rows=e.read(e.OUT/'trim64k/row-map.json')
    fixtures=queries()+[{'id':f'probe-{i}','text':t,'language':'probe'} for i,t in enumerate(e.PROBES)]
    data={'kind':'siglip','dimension':768,'queries':queries(),'photos':e.read(e.BASE/'dataset.json')['photos'],
      'fixtures':[dict(q,input_ids=e.encode(tok,q['text'],'siglip')['input_ids'][0].tolist()) for q in fixtures]}
    e.write(p/'dataset.json',data)
    if not (p/'images.f32').exists():(p/'images.f32').symlink_to((e.BASE/'images.f32').resolve())
    audit=[]
    for q in fixtures:
        a=tok.encode(q['text'],add_special_tokens=False);b=baseline.encode(q['text'],add_special_tokens=False)
        audit.append({'id':q['id'],'text':q['text'],'language':q.get('language'),'ids':a.ids,'old_ids':[rows[i] for i in a.ids],
          'same_tokens': [rows[i] for i in a.ids]==[base_rows[i] for i in b.ids], 'length':len(a.ids),'baseline_length':len(b.ids),
          'unk':a.ids.count(3),'truncated':len(a.ids)>63,'decoded':tok.decode(a.ids)})
    e.write(p/'tokenizer-audit.json',audit)
    model=e.onnx.load(target);counts=dict(Counter(n.op_type for n in model.graph.node));del model;gc.collect()
    token_files={f:{'bytes':(p/f).stat().st_size,'sha256':e.sha256(p/f)} for f in ('tokenizer.json','tokenizer_config.json')}
    e.write(p/'manifest.json',{'model':e.MODELS['siglip2'],'candidate':name,'size':size,'mode':mode,'symmetric':symmetric,'block':block,
      'embeddingBits':4 if embedding4 else 8,'activation':'FP32; accuracy_level=1','head':'original FP32 Gemm','operators':counts,
      'variants':{'model':{'file':'model.onnx','bytes':target.stat().st_size,'sha256':e.sha256(target)}},'tokenizer':token_files,
      'clientBytes':target.stat().st_size+sum(x['bytes'] for x in token_files.values()),
      'rowMap':{'bytes':(p/'row-map.json').stat().st_size,'sha256':e.sha256(p/'row-map.json'),'downloaded':False,'purpose':'Offline provenance/row slicing only; browser tokenizer already emits compact IDs'},
      'image_sha256':e.sha256(p/'images.f32'),'dataset_sha256':e.sha256(p/'dataset.json')})
    print(name,target.stat().st_size,counts.get('MatMulNBits',0),flush=True)

def native(name):
    p=OUT/name;rt=e.session(p/'model.onnx');data=e.read(p/'dataset.json')
    vectors=[]
    for q in data['fixtures']:
        values=rt.run(None,{'input_ids':e.np.array([q['input_ids']],dtype='int64')})[0]
        vectors.append(e.phase1.normalize(values)[0])
    e.np.save(p/'fixture-vectors.npy',vectors);e.np.save(p/'text-embeddings.npy',vectors[:len(queries())])
    ann=e.read(e.CACHE/'annotations.json')['qrels'];images=e.np.load(e.CACHE/'siglip2/image-embeddings.npy');ids=[x['id'] for x in data['photos']]
    for language in ('zh','en','zh-Hant','mixed','zh-hard','en-hard','zh-Hant-hard','mixed-hard'):
        quality=e.phase1.average([e.phase1.quality(e.phase1.ranked(images@vec),ids,ann[q['intent']]) for q,vec in zip(queries(),vectors) if q['language']==language])
        print(name,language,{k:round(quality[k],4) for k in ('hit1','hit5','ndcg5','ndcg10')},flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('step',choices=['prepare','export','native']);p.add_argument('--name');p.add_argument('--size',type=int,default=64)
    p.add_argument('--mode',default='int4',choices=['int8','int4','mlp4','embedding4']);p.add_argument('--uint4',action='store_true');p.add_argument('--block',type=int,default=32);p.add_argument('--embedding4',action='store_true');a=p.parse_args();freeze()
    if a.step=='prepare':
        for size in (64,32,16):vocab(size)
    elif a.step=='export':export(a.name,a.size,a.mode,not a.uint4,a.block,a.embedding4)
    else:native(a.name)
