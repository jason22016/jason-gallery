"""Numerical, tokenizer, byte, and graph invariants for cache artifacts."""
import sys
sys.dont_write_bytecode=True
import experiment as x
e=x.e
from collections import Counter

x.freeze()
original=e.onnx.load(e.BASE/'fp32.onnx');fp={t.name:t for t in original.graph.initializer}
for p in sorted(x.OUT.glob('v*-*')):
    if not p.is_dir() or not (p/'manifest.json').exists():continue
    m=e.read(p/'manifest.json');model=e.onnx.load(p/'model.onnx');initial={t.name:t for t in model.graph.initializer}
    for key in ('text_model.head.weight','text_model.head.bias'):
        assert initial[key].SerializeToString()==fp[key].SerializeToString()
    for key,t in initial.items():
        if 'layer_norm' in key:assert t.SerializeToString()==fp[key].SerializeToString()
    assert not any('vision' in key for key in initial)
    for n in model.graph.node:
        if n.op_type=='MatMulNBits':
            attrs={a.name:e.onnx.helper.get_attribute_value(a) for a in n.attribute}
            assert attrs['bits']==4 and attrs['accuracy_level']==1 and attrs['block_size']==m['block']
    assert e.sha256(p/'model.onnx')==m['variants']['model']['sha256']
    for f,t in m['tokenizer'].items():assert e.sha256(p/f)==t['sha256']
    assert e.sha256(p/'images.f32')==m['image_sha256']==e.sha256(e.BASE/'images.f32')
    assert e.sha256(p/'dataset.json')==m['dataset_sha256']
    tok=e.read(p/'tokenizer.json');v=tok['model']['vocab'];assert len(v)==m['size']*1024
    source=e.read(e.BASE/'tokenizer.json')['model']['vocab'];assert all(t in v for t in source if t.startswith('<0x')) and '\t' in v
    assert all(a in v and b in v and a+b in v for a,b in tok['model']['merges'])
    print(p.name,'unchanged image space/head/LayerNorm and file hashes pass',flush=True)
for name in ('v64-int8','v64-int4','v32-int8','v32-int4','v16-int4'):
    for backend in ('webgpu','wasm'):
        r=e.read(x.OUT/f'{name}-{backend}.json');assert r['status']=='success';assert len(r['queries'])==86
        assert len(r['tokenizerParity'])==105 and all(t['match'] for t in r['tokenizerParity'])
        assert r['launchArgs']==['--enable-precise-memory-info']
base=e.read(x.OUT/'v64-int8-webgpu.json')['queries'];old=e.read(e.OUT/'trim64k-int8wo-webgpu.json')['queries']
assert all([p['id'] for p in a['top']]==[p['id'] for p in b['top']] for a,b in zip(base[:66],old))
print('All five required combinations pass browser parity; baseline reproduces previous 66-query Top-10')
for name in ('v64-int8','v64-int4','v64-uint4'):
    raw=e.read(x.OUT/f'{name}-webgpu.json');br=e.read(x.OUT/f'{name}-webgpu-br.json')
    assert br['status']=='success' and br['modelBytes']==raw['modelBytes']
    assert all([p['id'] for p in a['top']]==[p['id'] for p in b['top']] for a,b in zip(raw['queries'],br['queries']))
    e.np.testing.assert_allclose([q['embedding'] for q in raw['queries']],[q['embedding'] for q in br['queries']],atol=2e-6)
    assert not any(t['url'].endswith('/row-map.json') for t in br['transfers'])
    for t in br['transfers']:
        if '/br/' in t['url']:assert t['contentEncoding']=='br'
    total=0
    for f in ('model.onnx','tokenizer.json','tokenizer_config.json'):
        rows=[t for t in br['transfers'] if t['url'].endswith('/'+f)];assert len(rows)==1
        assert rows[0]['contentLength']==(x.OUT/'brotli'/name/(f+'.br')).stat().st_size
        total+=rows[0]['contentLength']
    print(name,'compressed network bytes and unchanged Top-10 verified:',total)
fallback=e.read(x.OUT/'v64-uint4-auto-no-isolation.json')
assert fallback['status']=='success' and fallback['backend']=='wasm' and fallback['threads']==1
assert not fallback['crossOriginIsolated'] and fallback['fallbackReason']
assert len(fallback['queries'])==86 and all(t['match'] for t in fallback['tokenizerParity'])
for p in (x.OUT/'evaluation').glob('*.json'):
    r=e.read(p);assert r['native_alignment']['min']>.9999
print('Native/browser vector alignment and automatic single-thread fallback pass')
