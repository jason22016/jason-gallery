"""Independent smaller-tower experiment; immutable Phase 1/2A inputs, cache-only outputs."""
import sys
sys.dont_write_bytecode = True
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import importlib.util
spec = importlib.util.spec_from_file_location('phase1', Path(__file__).resolve().parents[1] / 'experiment.py')
phase1 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(phase1)
from common import CACHE, ROOT, MODELS, read, write, sha256
import argparse, copy, gc, json, shutil, unicodedata, time
from functools import lru_cache
import numpy as np
import onnx
from onnx import numpy_helper, helper, TensorProto
import onnxruntime as ort
import torch
from transformers import AutoTokenizer, AutoModel
from tokenizers import Tokenizer

OUT = CACHE / 'smaller'
BASE = CACHE / 'phase2a/assets'
HERE = Path(__file__).resolve().parent
PROBES = ['攝影師在臺灣拍攝鬱鬱蔥蔥的樹林', '香港維多利亞港的夜景與霓虹燈',
          '逆光人像、淺景深與散景', '臺北街頭的雨傘與倒影', '苍鹭掠过湿地，蜻蜓停在荷叶上',
          '雪豹、牦牛、鸬鹚与杜鹃花', '黃昏的漁船與燈塔', '長曝光瀑布和絲綢般的水流',
          'backlit portrait, bokeh and shallow depth of field', 'a kingfisher above a marsh at dawn',
          'telephoto wildlife photography with a blurred background', 'minimalist architecture in monochrome',
          '35mm f/1.4 ISO 800，雨夜 street photography', 'café 🌄 １２３', '', 'a '*100,
          '照片'*100, '<eos> a cat', '   A CAT\t水面\n樹木!']

def all_queries():
    return phase1.queries() + [dict(q, id=f'extra-{i}', absent=False, criterion='Same intent and qrels as original benchmark; paraphrase only')
                              for i,q in enumerate(read(HERE/'extra-queries.json'))]

def freeze():
    paths = [CACHE/'annotations.json', CACHE/'corpus.json', BASE/'int8wo.onnx', BASE/'tokenizer.json',
             HERE.parent/'queries.json', HERE/'extra-queries.json']
    for model in ('siglip2','clip'):
        paths += [CACHE/model/f for f in ('image-embeddings.npy','text-embeddings.npy','index.json','results.json')]
    hashes = {str(p.relative_to(ROOT)):sha256(p) for p in paths}
    target = OUT/'input-hashes.json'
    if target.exists(): assert read(target)==hashes, 'Frozen input changed'
    else: write(target,hashes)
    return hashes

def han(c):
    n=ord(c)
    return 0x3400<=n<=0x9fff or 0xf900<=n<=0xfaff or 0x20000<=n<=0x323af

def trim(size):
    """No query/corpus input. Keep Unicode bases, byte fallback, then Han/ASCII BPE closures."""
    target=OUT/f'trim{size//1024}k'; target.mkdir(exist_ok=True,parents=True)
    source=read(BASE/'tokenizer.json'); vocab=source['model']['vocab']; merges=source['model']['merges']
    allowed=lambda c: han(c) or c=='▁' or ord(c)<128 or unicodedata.category(c)[0] in 'PNSZ'
    selected={t for t in vocab if len(t)==1 and allowed(t)} | {t['content'] for t in source['added_tokens']}
    selected |= {t for t in vocab if t.startswith('<0x') and t.endswith('>')}
    parents={}
    for a,b in merges: parents.setdefault(a+b,(a,b))
    @lru_cache(maxsize=None)
    def closure(t):
        if t in selected:return set()
        return {t} | (set().union(*(closure(x) for x in parents[t])) if t in parents else set())
    mandatory=len(selected)
    # 45% of non-mandatory slots to Han compound tokens, rest to ASCII/Latin pieces.
    han_limit=mandatory+int((size-mandatory)*.45)
    candidates=sorted(vocab,key=vocab.get)
    for t in candidates:
        if not any(han(c) for c in t) or not all(allowed(c) for c in t):continue
        add=closure(t)
        if len(selected)+len(add-selected)<=han_limit:selected |= add
    for t in candidates:
        if not all(allowed(c) and not han(c) for c in t):continue
        add=closure(t)
        if len(selected)+len(add-selected)<=size:selected |= add
    for t in candidates:
        if not all(allowed(c) for c in t):continue
        add=closure(t)
        if len(selected)+len(add-selected)<=size:selected |= add
        if len(selected)==size:break
    ordered=sorted(selected,key=vocab.get); old_ids=[vocab[t] for t in ordered]; new={t:i for i,t in enumerate(ordered)}
    assert len(new)==size and [new[t] for t in ('<pad>','<eos>','<bos>','<unk>')]==[0,1,2,3]
    result=copy.deepcopy(source); result['model']['vocab']=new
    result['model']['merges']=[[a,b] for a,b in merges if a in new and b in new and a+b in new]
    for t in result['added_tokens']:t['id']=new[t['content']]
    (target/'tokenizer.json').write_text(json.dumps(result,ensure_ascii=False,separators=(',',':')))
    shutil.copyfile(BASE/'tokenizer_config.json',target/'tokenizer_config.json')
    write(target/'row-map.json',old_ids)
    # Slice the *already quantized* rows/scales: all transformer/head weights stay byte-identical.
    model=onnx.load(BASE/'int8wo.onnx'); changed=[]
    for i,t in enumerate(model.graph.initializer):
        if t.dims and t.dims[0]==256000:
            arr=numpy_helper.to_array(t)[old_ids].copy()
            model.graph.initializer[i].CopyFrom(numpy_helper.from_array(arr,t.name));changed.append(t.name)
    assert len(changed)==2,changed
    onnx.save(model,target/'int8wo.onnx');onnx.checker.check_model(str(target/'int8wo.onnx'))
    write(target/'trim-policy.json',{'size':size,'mandatory':mandatory,'han_tokens':sum(any(han(c) for c in t) for t in new),
        'merges':len(result['model']['merges']),'changed_initializers':changed,
        'policy':'No benchmark/corpus use. Preserve allowed Unicode singletons, specials, all byte fallback. Allocate 45% remaining to Han compounds, rest to ASCII/punctuation. Original ID ordering; recursive original BPE merge closure. Retain all valid original merges in original order.',
        'source_tokenizer_sha256':sha256(BASE/'tokenizer.json')})
    print(target.name,len(new),(target/'int8wo.onnx').stat().st_size,flush=True)

def encode(tokenizer,text,kind):
    if kind=='siglip':
        # The saved tokenizer has built-in padding; clear it before the explicit EOS/right-pad contract.
        tokenizer.no_padding();tokenizer.no_truncation()
        ids=tokenizer.encode(text,add_special_tokens=False).ids[:63]+[1]
        ids += [0]*(64-len(ids));return {'input_ids':np.array([ids],dtype=np.int64)}
    values=tokenizer(text,padding='max_length',max_length=128,truncation=True,return_tensors='np')
    return {k:v.astype(np.int64) for k,v in values.items() if k in ('input_ids','attention_mask')}

def session(path):
    options=ort.SessionOptions();options.intra_op_num_threads=4
    return ort.InferenceSession(str(path),sess_options=options,providers=['CPUExecutionProvider'])

def dataset(target,kind,tokenizer,images,dimension):
    queries=all_queries();fixtures=queries+[{'id':f'probe-{i}','text':t} for i,t in enumerate(PROBES)]
    data={'kind':kind,'dimension':dimension,'queries':queries,'photos':read(BASE/'dataset.json')['photos'],
          'fixtures':[dict(q,**{k:v[0].tolist() for k,v in encode(tokenizer,q['text'],kind).items()}) for q in fixtures]}
    write(target/'dataset.json',data)
    np.asarray(images,dtype='<f4').tofile(target/'images.f32')
    np.save(target/'image-embeddings.npy',images)

def assess_siglip():
    images=np.load(CACHE/'siglip2/image-embeddings.npy')
    full=Tokenizer.from_file(str(BASE/'tokenizer.json'));full.no_padding();full.no_truncation();q=all_queries()
    for name in ('baseline','trim32k','trim64k'):
        target=OUT/name;target.mkdir(exist_ok=True)
        path=BASE if name=='baseline' else target
        tokenizer=Tokenizer.from_file(str(path/'tokenizer.json'))
        if name=='baseline':
            for f in ('int8wo.onnx','tokenizer.json','tokenizer_config.json'):
                if not (target/f).exists():(target/f).symlink_to((BASE/f).resolve())
        dataset(target,'siglip',tokenizer,images,768)
        runtime=session(path/'int8wo.onnx')
        vectors=[];rows=[]
        old_ids=read(target/'row-map.json') if name!='baseline' else list(range(256000))
        for row in read(target/'dataset.json')['fixtures']:
            feeds=encode(tokenizer,row['text'],'siglip');original=encode(full,row['text'],'siglip')['input_ids'][0].tolist()
            mapped=[old_ids[i] for i in feeds['input_ids'][0]]
            vector=phase1.normalize(runtime.run(None,feeds)[0])[0];vectors.append(vector)
            rows.append({'id':row['id'],'text':row['text'],'original_ids':original,'trimmed_old_ids':mapped,
                         'same_tokens':mapped==original,'unknown_count':mapped.count(3),
                         'original_length':len(full.encode(row['text'],add_special_tokens=False).ids),
                         'length':len(tokenizer.encode(row['text'],add_special_tokens=False).ids),
                         'decoded':tokenizer.decode(feeds['input_ids'][0].tolist())})
        np.save(target/'fixture-vectors.npy',vectors);np.save(target/'text-embeddings.npy',vectors[:len(q)])
        if name!='baseline':
            baseline=np.load(OUT/'baseline/fixture-vectors.npy');cosines=np.sum(baseline*np.array(vectors),axis=1)
            for row,cos in zip(rows,cosines):row['cosine_to_baseline']=float(cos)
            # Exact mapped tokens must give effectively identical vectors after row slicing.
            assert min(r['cosine_to_baseline'] for r in rows if r['same_tokens'])>.99999
        write(target/'tokenizer-audit.json',rows)
        write(target/'model.json',{'text':MODELS['siglip2'],'image':MODELS['siglip2'],'dimension':768,'format':'ONNX opset17 INT8 weight-only','images_reused':'Phase 1 SigLIP2, unchanged'})
        print(name,'encoded',len(vectors),flush=True)
        del runtime;gc.collect()

class MultiText(torch.nn.Module):
    def __init__(self,model,weight):
        super().__init__();self.model=model;self.projection=torch.nn.Linear(768,512,bias=False)
        self.projection.weight.data.copy_(weight)
    def forward(self,input_ids,attention_mask):
        states=self.model(input_ids=input_ids,attention_mask=attention_mask).last_hidden_state
        mask=attention_mask.unsqueeze(-1).to(states.dtype)
        return self.projection((states*mask).sum(1)/mask.sum(1).clamp(min=1e-9))

def quantize_weights(source,target):
    model=onnx.load(source);initial={t.name:t for t in model.graph.initializer}
    added=[];drop=set();prefix=[];nodes=[]
    for node in model.graph.node:
        if node.op_type=='Gather' and node.input[0] in initial and len(initial[node.input[0]].dims)==2 and initial[node.input[0]].dims[0]>10000:
            name=node.input[0];v=numpy_helper.to_array(initial[name]);s=np.maximum(abs(v).max(1,keepdims=True)/127,1e-12).astype('float32')
            added += [numpy_helper.from_array(np.clip(np.rint(v/s),-127,127).astype('int8'),name+'_q'),numpy_helper.from_array(s,name+'_s')];drop.add(name)
            o=node.output[0];nodes += [helper.make_node('Gather',[name+'_q',node.input[1]],[o+'_q'],axis=0),helper.make_node('Gather',[name+'_s',node.input[1]],[o+'_s'],axis=0),helper.make_node('Cast',[o+'_q'],[o+'_f'],to=TensorProto.FLOAT),helper.make_node('Mul',[o+'_f',o+'_s'],[o])]
            continue
        if node.op_type=='MatMul' and node.input[1] in initial and node.input[1] not in drop:
            name=node.input[1];v=numpy_helper.to_array(initial[name])
            if v.ndim==2:
                s=np.maximum(abs(v).max(0)/127,1e-12).astype('float32');drop.add(name)
                added += [numpy_helper.from_array(np.clip(np.rint(v/s),-127,127).astype('int8'),name+'_q'),numpy_helper.from_array(s,name+'_s'),numpy_helper.from_array(np.zeros(s.shape,dtype='int8'),name+'_z')]
                prefix.append(helper.make_node('DequantizeLinear',[name+'_q',name+'_s',name+'_z'],[name],axis=1))
        nodes.append(node)
    kept=[t for t in model.graph.initializer if t.name not in drop]
    del model.graph.initializer[:];model.graph.initializer.extend(kept+added)
    del model.graph.node[:];model.graph.node.extend(prefix+nodes)
    onnx.save(model,target);onnx.checker.check_model(str(target))

def multiclip():
    from safetensors.torch import load_file
    meta=read(OUT/'multiclip-download.json');snapshot=Path(meta['snapshot']);target=OUT/'multiclip';target.mkdir(exist_ok=True)
    tok=AutoTokenizer.from_pretrained(snapshot,local_files_only=True)
    for f in ('tokenizer.json','tokenizer_config.json','config.json','special_tokens_map.json'):shutil.copyfile(snapshot/f,target/f)
    model=MultiText(AutoModel.from_pretrained(snapshot,local_files_only=True,attn_implementation='eager'),load_file(snapshot/'2_Dense/model.safetensors')['linear.weight']).eval()
    torch.set_num_threads(4);inputs=encode(tok,'A photo of 樹木','multiclip');dummy=tuple(torch.from_numpy(inputs[k]) for k in ('input_ids','attention_mask'))
    torch.onnx.export(model,dummy,target/'fp32.onnx',input_names=['input_ids','attention_mask'],output_names=['text_embeds'],opset_version=17,dynamo=False)
    with torch.inference_mode():values=[model(*(torch.from_numpy(v) for v in encode(tok,q['text'],'multiclip').values())).numpy()[0] for q in all_queries()]
    np.save(target/'pytorch-vectors.npy',phase1.normalize(values))
    quantize_weights(target/'fp32.onnx',target/'int8wo.onnx')
    dataset(target,'multiclip',tok,np.load(CACHE/'clip/image-embeddings.npy'),512)
    write(target/'model.json',{'text':meta,'image':MODELS['clip'],'dimension':512,'format':'ONNX opset17 INT8 weight-only + FP32 control','images_reused':'Original OpenAI CLIP ViT-B/32; official multilingual model card explicitly says image encoder unchanged. Phase 1 is same OpenAI checkpoint and preprocessing.'})
    # Official ready-made INT8 graph only produces token embeddings; apply documented pooling + dense head.
    ready=session(snapshot/'onnx/model_qint8_arm64.onnx');weight=load_file(snapshot/'2_Dense/model.safetensors')['linear.weight'].numpy();values=[]
    for q in all_queries():
        feeds=encode(tok,q['text'],'multiclip');states=ready.run(None,feeds)[0];mask=feeds['attention_mask'][...,None]
        values.append(((states*mask).sum(1)/mask.sum(1))@weight.T)
    np.save(target/'official-int8-vectors.npy',phase1.normalize(np.concatenate(values)))
    write(target/'official-int8.json',{'file':str(snapshot/'onnx/model_qint8_arm64.onnx'),'bytes':(snapshot/'onnx/model_qint8_arm64.onnx').stat().st_size,'outputs':[o.name for o in ready.get_outputs()],'postprocessing':'attention-mask mean pooling + original 768x512 projection, then L2'})
    native(target)

def native(target):
    data=read(target/'dataset.json');tok=Tokenizer.from_file(str(target/'tokenizer.json')) if data['kind']=='siglip' else AutoTokenizer.from_pretrained(target,local_files_only=True)
    for variant in ('fp32','int8wo'):
        path=target/f'{variant}.onnx'
        if not path.exists():continue
        runtime=session(path);vectors=[]
        for q in data['queries']:vectors.append(runtime.run(None,encode(tok,q['text'],data['kind']))[0][0])
        np.save(target/f'{variant}-vectors.npy',phase1.normalize(vectors))
    np.save(target/'text-embeddings.npy',phase1.normalize(vectors))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('step',choices=['freeze','trim','siglip','multiclip']);a=p.parse_args()
    freeze()
    if a.step=='trim':
        for size in (32768,65536):trim(size)
    elif a.step=='siglip':assess_siglip()
    elif a.step=='multiclip':multiclip()
