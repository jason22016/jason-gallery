"""Relevance metrics use the same frozen qrels; browser quality is authoritative."""
import sys
sys.dont_write_bytecode=True
import experiment as e
import html
from PIL import Image, ImageOps, ImageDraw
import base64, io

def assess(name,vectors,baseline):
    p=e.OUT/name;data=e.read(p/'dataset.json');photos=data['photos'];ids=[p['id'] for p in photos]
    images=e.np.load(p/'image-embeddings.npy');ann=e.read(e.CACHE/'annotations.json')['qrels']
    vectors=e.phase1.normalize(vectors);rows=[]
    baseline_images=e.np.load(e.OUT/'baseline/image-embeddings.npy')
    for i,(q,vector) in enumerate(zip(data['queries'],vectors)):
        order=e.phase1.ranked(images@vector);base=e.phase1.ranked(baseline_images@baseline[i])
        rows.append({'query':q,'quality':e.phase1.quality(order,ids,ann[q['intent']]),
             'baseline_quality':e.phase1.quality(base,ids,ann[q['intent']]),
             'top10':[dict(photos[j],score=float(images[j]@vector),relevant=ids[j] in ann[q['intent']]) for j in order[:10]],
             'baseline_top10':[ids[j] for j in base[:10]],
             'top1_same':bool(order[0]==base[0]),'overlap5':len(set(order[:5])&set(base[:5]))/5,'overlap10':len(set(order[:10])&set(base[:10]))/10,
             'cosine_to_baseline':float(vector@baseline[i]) if name in ('baseline','trim32k','trim64k') else None})
    langs={}
    for lang in sorted({q['language'] for q in data['queries']}):
        subset=[r for r in rows if r['query']['language']==lang];a=e.phase1.average([r['quality'] for r in subset]);b=e.phase1.average([r['baseline_quality'] for r in subset])
        langs[lang]={'count':len(subset),'positive_count':sum(r['quality'] is not None for r in subset),'metrics':a,'baseline':b,'delta':{k:a[k]-b[k] for k in a}}
    return {'candidate':name,'by_language':langs,'queries':rows,'rank_stability_48':{k:float(e.np.mean([r[k] for r in rows[:48]])) for k in ('top1_same','overlap5','overlap10')}}

def main():
    e.freeze()
    for name in ('baseline','trim32k','trim64k','multiclip','mobileclip2'):
        for backend in ('webgpu','wasm'):
            required=e.read(e.OUT/f'{name}-int8wo-{backend}.json')
            assert required['status']=='success',f'Missing successful run: {name}/{backend}'
    reference=e.read(e.OUT/'baseline-int8wo-webgpu.json')
    assert reference['status']=='success' and len(reference['queries'])==66
    baseline=e.np.array([q['embedding'] for q in reference['queries']],dtype='float32')
    old=e.read(e.CACHE/'phase2a/int8wo-webgpu-stock.json')
    old_vectors=e.np.array([q['embedding'] for q in old['queries']],dtype='float32')
    assert (baseline[:48]*old_vectors).sum(1).min()>.99999
    assert all([p['id'] for p in q['top']]==[p['id'] for p in old['queries'][i]['top']] for i,q in enumerate(reference['queries'][:48]))
    summaries=[];review={}
    for path in sorted(e.OUT.glob('*-int8wo-*.json')):
        result=e.read(path)
        if result.get('status')!='success' or len(result.get('queries',[]))!=66:continue
        assert all(p['match'] for p in result['tokenizerParity']) and len(result['tokenizerParity'])==85
        name=result['candidate'];vectors=e.np.array([q['embedding'] for q in result['queries']],dtype='float32')
        assert vectors.shape==(66,e.read(e.OUT/name/'dataset.json')['dimension'])
        assert e.np.isfinite(vectors).all()
        e.np.testing.assert_allclose(e.np.linalg.norm(vectors,axis=1),1,atol=2e-6)
        a=assess(name,vectors,baseline)
        for r,q in zip(a['queries'],result['queries']):assert [p['id'] for p in r['top10']]==[p['id'] for p in q['top']]
        native=e.np.load(e.OUT/name/'text-embeddings.npy')
        a['cosine_to_native']=e.phase1.distribution(e.np.sum(vectors*native,1))
        e.write(e.OUT/'evaluation'/path.name,a)
        manifest=e.read(e.OUT/name/'manifest.json')
        summary={'run':path.stem,'candidate':name,'backend':result['backend'],'clientBytes':manifest['clientBytes'],
          'fullTransferBytes':sum(t['contentLength'] for t in result['transfers']),
          **{k:result[k] for k in ('warmMs','coldToFirstResultMs','modelFetchMs','sessionCreateMs','firstQueryMs','adapterInfo','threads','networkEmulation')},
          'rssPeakBytes':result['processMemory']['peakBytes'],'quality':a['by_language'],'ranks':a['rank_stability_48'],
          'cosine_to_native':a['cosine_to_native']}
        summaries.append(summary)
        if path.stem==f'{name}-int8wo-webgpu':review[name]=a
    e.write(e.OUT/'summary.json',summaries)
    native_results={}
    for name in ('multiclip','mobileclip2'):
        for f in ('pytorch-vectors.npy','fp32-vectors.npy','int8wo-vectors.npy','official-int8-vectors.npy'):
            path=e.OUT/name/f
            if path.exists():native_results[name+'/'+f]=assess(name,e.np.load(path),baseline)
    e.write(e.OUT/'native-evaluation.json',native_results)
    lines=['# Smaller text encoder measurements','', 'All MB are decimal, bytes measured; 48 original + 18 frozen paraphrases. Original AI qrels, no independent human validation.','',
      '| Run | Model+tokenizer MB | Full harness MB | Cold s | Warm median / p95 ms | RSS peak MB |', '|---|---:|---:|---:|---:|---:|']
    for r in summaries:lines.append(f"| {r['run']} | {r['clientBytes']/1e6:.3f} | {r['fullTransferBytes']/1e6:.3f} | {r['coldToFirstResultMs']/1000:.2f} | {r['warmMs']['median']:.2f} / {r['warmMs']['p95']:.2f} | {r['rssPeakBytes']/1e6:.0f} |")
    lines += ['', '| Run | Language | N positive | Hit@1 / 5 / 10 | nDCG@5 / 10 | nDCG@5 / 10 delta |','|---|---|---:|---|---|---|']
    for r in summaries:
        for lang,q in r['quality'].items():
            m=q['metrics'];d=q['delta'];lines.append(f"| {r['run']} | {lang} | {q['positive_count']} | {m['hit1']:.4f} / {m['hit5']:.4f} / {m['hit10']:.4f} | {m['ndcg5']:.4f} / {m['ndcg10']:.4f} | {d['ndcg5']:+.4f} / {d['ndcg10']:+.4f} |")
    (e.OUT/'metrics.md').write_text('\n'.join(lines)+'\n')
    make_review(review)
    print('\n'.join(lines[:16]))

def make_review(results):
    # Embed small thumbnails so review works locally without a broader file server.
    photos=e.read(e.CACHE/'corpus.json')['photos'];thumbs={}
    for p in photos:
        with Image.open(e.ROOT/p['thumbnail']) as im:
            im=ImageOps.exif_transpose(im).convert('RGB');im.thumbnail((180,115));b=io.BytesIO();im.save(b,format='JPEG',quality=65)
            thumbs[p['id']]='data:image/jpeg;base64,'+base64.b64encode(b.getvalue()).decode()
    out=['<!doctype html><meta charset="utf-8"><title>Smaller encoder Top-5 / Top-10 review</title><style>body{font:14px system-ui;background:#15171b;color:white;margin:24px}.row{display:flex;gap:5px;overflow:auto}figure{margin:0;min-width:140px;width:140px}img{width:140px;height:95px;object-fit:contain;background:#222}.rel{border:2px solid #36b98f}.no{border:2px solid #ce6565}figcaption{font-size:11px}h2{margin-top:40px}summary{cursor:pointer}</style><h1>Top-5 / Top-10 visual review</h1><p>Green/red indicates existing AI qrels, not a new human decision. Ranks 1–5 and 6–10 are separated. Independent human review is pending.</p>']
    for i,q in enumerate(e.all_queries()):
        out.append(f'<details open><summary><h2>{html.escape(q["id"]+" · "+q["text"])}</h2></summary>')
        for name,a in results.items():
            row=a['queries'][i];out.append(f'<h3>{name}</h3><div class="row">')
            for rank,p in enumerate(row['top10'],1):
                if rank==6:out.append('<span style="min-width:20px">│</span>')
                out.append(f'<figure><img class="{"rel" if p["relevant"] else "no"}" src="{thumbs[p["id"]]}"><figcaption>#{rank} {html.escape(p["filename"])}<br>{p["score"]:.4f}</figcaption></figure>')
            out.append('</div>')
        out.append('</details>')
    (e.OUT/'review.html').write_text('\n'.join(out))
    e.write(e.OUT/'human-review.json',{'status':'pending','reason':'No independent human annotator supplied judgements in this task; all computed metrics reuse Phase 1 AI visual qrels.','artifact':'review.html','queries':66,'ranks_per_candidate':10})

if __name__=='__main__':main()
