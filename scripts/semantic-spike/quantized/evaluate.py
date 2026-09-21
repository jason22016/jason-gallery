"""Shared qrels, no labels invented for place/equipment diagnostics; real ranking first."""
import sys
sys.dont_write_bytecode=True
import experiment as x
e=x.e
import html,base64,io
from PIL import Image,ImageOps

def assess(name,vectors,reference):
    images=e.np.load(e.CACHE/'siglip2/image-embeddings.npy');data=e.read(x.OUT/name/'dataset.json');ids=[p['id'] for p in data['photos']]
    ann=e.read(e.CACHE/'annotations.json')['qrels'];rows=[]
    for q,v,b in zip(x.queries(),vectors,reference):
        rank=e.phase1.ranked(images@v);base=e.phase1.ranked(images@b);labels=ann[q['intent']] if q['intent'] else []
        rows.append({'query':q,'quality':e.phase1.quality(rank,ids,labels),'baseline_quality':e.phase1.quality(base,ids,labels),
          'cosine':float(v@b),'top1_same':bool(rank[0]==base[0]),'overlap5':len(set(rank[:5])&set(base[:5]))/5,'overlap10':len(set(rank[:10])&set(base[:10]))/10,
          'top10':[dict(data['photos'][j],score=float(images[j]@v),relevant=(ids[j] in labels) if q['intent'] else None) for j in rank[:10]],
          'baseline_top10':[ids[j] for j in base[:10]]})
    langs={}
    for language in sorted({q['language'] for q in x.queries()}):
        subset=[r for r in rows if r['query']['language']==language];a=e.phase1.average([r['quality'] for r in subset]);b=e.phase1.average([r['baseline_quality'] for r in subset])
        langs[language]={'count':len(subset),'positive_count':sum(r['quality'] is not None for r in subset),'metrics':a,'baseline':b,'delta':{k:a[k]-b[k] for k in a}}
    return {'candidate':name,'by_language':langs,'queries':rows,'original48':{k:float(e.np.mean([r[k] for r in rows[:48]])) for k in ('cosine','top1_same','overlap5','overlap10')}}

def gates(a):
    failed=[]
    for lang in ('zh','en','zh-Hant','mixed','zh-free','en-free'):
        d=a['by_language'][lang]['delta'];tol=.02 if lang in ('zh','en') else .03
        if any(d[k]<-tol-1e-6 for k in ('ndcg5','ndcg10')):failed.append(lang+':nDCG')
        if any(d[k]<-1e-6 for k in ('hit5','hit10')):failed.append(lang+':Hit@5/10')
        if lang in ('zh','en') and d['hit1'] < -1/22-1e-6:failed.append(lang+':Hit@1')
    return {'pass':not failed,'failed':failed,'scope':'Predeclared small-sample screening thresholds; hard queries remain separate checks'}

def main():
    x.freeze();ref=e.np.load(x.OUT/'v64-int8/text-embeddings.npy')
    summaries=[];reviews={};native={};failures=[]
    for p in sorted(x.OUT.glob('v*-*')):
        if p.is_dir() and (p/'text-embeddings.npy').exists():
            a=assess(p.name,e.np.load(p/'text-embeddings.npy'),ref);a['gates']=gates(a);native[p.name]=a
    e.write(x.OUT/'native-evaluation.json',native)
    for p in sorted(x.OUT.glob('v*-*.json')):
        r=e.read(p)
        if isinstance(r,dict) and r.get('status')=='error':
            failures.append({'run':p.stem,'candidate':r['candidate'],'backend':r['backend'],'error':r['error']})
        if not isinstance(r,dict) or r.get('status')!='success' or len(r.get('queries',[]))!=len(x.queries()):continue
        assert len(r['tokenizerParity'])==105 and all(t['match'] for t in r['tokenizerParity'])
        name=r['candidate'];v=e.np.asarray([q['embedding'] for q in r['queries']],dtype='float32')
        assert v.shape==(86,768);e.np.testing.assert_allclose(e.np.linalg.norm(v,axis=1),1,atol=2e-6)
        a=assess(name,v,ref);a['gates']=gates(a)
        for q,row in zip(r['queries'],a['queries']):assert [p['id'] for p in q['top']]==[p['id'] for p in row['top10']]
        a['native_alignment']=e.phase1.distribution(e.np.sum(v*e.np.load(x.OUT/name/'text-embeddings.npy'),1))
        e.write(x.OUT/'evaluation'/p.name,a);m=e.read(x.OUT/name/'manifest.json')
        summaries.append({'run':p.stem,'candidate':name,'backend':r['backend'],'clientBytes':m['clientBytes'],
          'transferBytes':sum(t['contentLength'] for t in r['transfers']),
          'modelTokenizerTransferBytes':sum(t['contentLength'] for t in r['transfers'] if any(t['url'].endswith('/'+f) for f in ('model.onnx','tokenizer.json','tokenizer_config.json'))),
          'warmMs':r['warmMs'],'coldMs':r['coldToFirstResultMs'],'modelFetchMs':r['modelFetchMs'],'sessionCreateMs':r['sessionCreateMs'],
          'peakRssBytes':r['processMemory']['peakBytes'],'quality':a['by_language'],'gates':a['gates'],'original48':a['original48'],'native_alignment':a['native_alignment']})
        if p.stem==name+'-webgpu':reviews[name]=a
    e.write(x.OUT/'summary.json',summaries)
    e.write(x.OUT/'browser-failures.json',failures)
    lines=['# Quantization experiment metrics','','| Run | Raw model+tokenizer MB | Model+tokenizer transfer MB | Total transfer MB | Cold s | Warm median/p95 ms | Peak Chrome RSS MB | Gate |','|---|---:|---:|---:|---:|---:|---:|---|']
    for r in summaries:lines.append(f"| {r['run']} | {r['clientBytes']/1e6:.3f} | {r['modelTokenizerTransferBytes']/1e6:.3f} | {r['transferBytes']/1e6:.3f} | {r['coldMs']/1000:.2f} | {r['warmMs']['median']:.2f}/{r['warmMs']['p95']:.2f} | {r['peakRssBytes']/1e6:.0f} | {r['gates']['pass']} |")
    lines+=['','| Run | Language | N positive | Hit@1/5/10 | nDCG@5/10 | nDCG delta @5/10 |','|---|---|---:|---|---|---|']
    for r in summaries:
        for lang,q in r['quality'].items():
            a=q['metrics'];d=q['delta']
            if not a:continue
            lines.append(f"| {r['run']} | {lang} | {q['positive_count']} | {a['hit1']:.4f}/{a['hit5']:.4f}/{a['hit10']:.4f} | {a['ndcg5']:.4f}/{a['ndcg10']:.4f} | {d['ndcg5']:+.4f}/{d['ndcg10']:+.4f} |")
    (x.OUT/'metrics.md').write_text('\n'.join(lines)+'\n')
    make_review(reviews)
    for name,a in native.items():print(name,a['gates'],{lang:round(a['by_language'][lang]['delta']['ndcg10'],4) for lang in ('zh','en','mixed','zh-Hant')})

def make_review(reviews):
    photos=e.read(e.CACHE/'corpus.json')['photos'];images={}
    for p in photos:
        with Image.open(e.ROOT/p['thumbnail']) as im:
            im=ImageOps.exif_transpose(im).convert('RGB');im.thumbnail((160,100));b=io.BytesIO();im.save(b,format='JPEG',quality=60);images[p['id']]=base64.b64encode(b.getvalue()).decode()
    parts=['<!doctype html><meta charset="utf-8"><title>Quantization Top-K review</title><style>body{background:#15171b;color:white;font:14px system-ui;margin:24px}.row{display:flex;gap:5px}img{width:130px;height:90px;object-fit:contain}figure{margin:0;width:130px}figcaption{font-size:10px}.r{border:2px solid #3b8}.n{border:2px solid #c66}.u{border:2px solid #aaa}</style><h1>INT4 / vocabulary Top-5 and Top-10 review</h1><p>Original AI qrels only. Gray = unlabelled diagnostics; not counted as failures or successes. Independent human review pending.</p>']
    for i,q in enumerate(x.queries()):
        parts.append(f'<h2>{html.escape(q["id"]+" · "+q["text"])}</h2>')
        for name,a in reviews.items():
            parts.append(f'<h3>{name}</h3><div class="row">')
            for k,p in enumerate(a['queries'][i]['top10']):
                if k==5:parts.append('<b>│</b>')
                parts.append(f'<figure><img class="{"u" if p["relevant"] is None else "r" if p["relevant"] else "n"}" src="data:image/jpeg;base64,{images[p["id"]]}"><figcaption>{k+1}. {html.escape(p["filename"])}</figcaption></figure>')
            parts.append('</div>')
    (x.OUT/'review.html').write_text('\n'.join(parts))

if __name__=='__main__':main()
