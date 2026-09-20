"""Artifact integration checks: space preservation, numerical fidelity, frozen inputs."""
import sys
sys.dont_write_bytecode=True
import experiment as e

e.freeze()
full=e.onnx.load(e.BASE/'int8wo.onnx')
initial={t.name:t for t in full.graph.initializer}
for name,size in (('trim32k',32768),('trim64k',65536)):
    p=e.OUT/name;rows=e.read(p/'row-map.json');assert len(rows)==size and rows==sorted(set(rows))
    tok=e.read(p/'tokenizer.json');v=tok['model']['vocab']
    assert len(v)==size
    original_vocab=e.read(e.BASE/'tokenizer.json')['model']['vocab']
    byte_tokens={t for t in original_vocab if t.startswith('<0x') and t.endswith('>')}
    # Official tokenizer encodes tab as a literal token, not <0x09>.
    assert len(byte_tokens)==255 and byte_tokens<=v.keys() and '\t' in v
    assert all(a in v and b in v and a+b in v for a,b in tok['model']['merges'])
    trimmed=e.onnx.load(p/'int8wo.onnx');assert [n.SerializeToString() for n in trimmed.graph.node]==[n.SerializeToString() for n in full.graph.node]
    changed=[]
    for t in trimmed.graph.initializer:
        source=initial[t.name]
        if source.SerializeToString()!=t.SerializeToString():
            e.np.testing.assert_array_equal(e.numpy_helper.to_array(t),e.numpy_helper.to_array(source)[rows]);changed.append(t.name)
    assert sorted(changed)==sorted(e.read(p/'trim-policy.json')['changed_initializers'])
    # Mapped identical token sequences should yield the same *browser* embedding/ranking.
    base=e.read(e.OUT/'baseline-int8wo-webgpu.json')['queries'];candidate=e.read(e.OUT/f'{name}-int8wo-webgpu.json')['queries']
    for a,b in zip(base,candidate):
        if a['input_ids']==[rows[i] for i in b['input_ids']]:
            assert e.np.dot(a['embedding'],b['embedding'])>.99999
            assert [x['id'] for x in a['top']]==[x['id'] for x in b['top']]
    print(name,'only two embedding initializers sliced; unchanged-input browser equivalence passes')
for name in ('multiclip','mobileclip2'):
    p=e.OUT/name;a=e.np.load(p/'pytorch-vectors.npy');b=e.np.load(p/'fp32-vectors.npy')
    assert e.np.sum(a*b,1).min()>.99999
    print(name,'FP32 export aligned to original PyTorch')
for name in ('baseline','trim32k','trim64k','multiclip','mobileclip2'):
    p=e.OUT/name;m=e.read(p/'manifest.json')
    for variant,meta in m['variants'].items():assert e.sha256(p/meta['file'])==meta['sha256']
    assert e.sha256(p/'images.f32')==m['images_sha256']
    assert e.sha256(p/'dataset.json')==m['dataset_sha256']
print('All immutable-input and exported-file hashes pass')
