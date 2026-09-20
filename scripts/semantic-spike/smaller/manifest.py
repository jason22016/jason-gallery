import sys
sys.dont_write_bytecode=True
import experiment as e
from collections import Counter
for name in ('baseline','trim32k','trim64k','multiclip','mobileclip2'):
    p=e.OUT/name
    variants={}
    for variant in ('int8wo','fp32'):
        f=p/f'{variant}.onnx'
        if not f.exists():continue
        m=e.onnx.load(f)
        assert not any('vision' in t.name for t in m.graph.initializer)
        variants[variant]={'file':f.name,'bytes':f.stat().st_size,'sha256':e.sha256(f),'ops':dict(Counter(n.op_type for n in m.graph.node))}
    toks={f:{'bytes':(p/f).stat().st_size,'sha256':e.sha256(p/f)} for f in ('tokenizer.json','tokenizer_config.json')}
    e.write(p/'manifest.json',{'model':e.read(p/'model.json'),'variants':variants,'tokenizer':toks,
       'clientBytes':variants['int8wo']['bytes']+sum(x['bytes'] for x in toks.values()),
       'dataset_sha256':e.sha256(p/'dataset.json'),'images_sha256':e.sha256(p/'images.f32')})
    print(name,variants['int8wo']['bytes']+sum(x['bytes'] for x in toks.values()))
compact=e.json.dumps(e.read(e.BASE/'tokenizer.json'),ensure_ascii=False,separators=(',',':')).encode()
e.write(e.OUT/'serialization-control.json',{'full_tokenizer_original_bytes':(e.BASE/'tokenizer.json').stat().st_size,
    'full_tokenizer_compact_bytes':len(compact),'full_model_plus_compact_tokenizer_bytes':(e.BASE/'int8wo.onnx').stat().st_size+len(compact)+(e.BASE/'tokenizer_config.json').stat().st_size,
    'note':'Serialization-size control only; no additional model variant or browser run.'})
