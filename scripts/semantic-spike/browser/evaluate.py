"""Compare browser vectors with the immutable Phase 1 space and relevance labels."""
import sys
sys.dont_write_bytecode = True
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import CACHE, read, sha256, write
from experiment import average, quality, ranked, distribution, normalize
import numpy as np

OUT = CACHE / 'phase2a'


def assess(result):
    images = np.load(CACHE / 'siglip2/image-embeddings.npy')
    baseline = np.load(CACHE / 'siglip2/text-embeddings.npy')
    original = read(CACHE / 'siglip2/results.json')
    ids = read(CACHE / 'siglip2/index.json')['ids']
    annotations = read(CACHE / 'annotations.json')
    provenance = read(OUT / 'provenance.json')
    assert sha256(CACHE / 'siglip2/image-embeddings.npy') == provenance['baseline_image_sha256']
    assert sha256(CACHE / 'siglip2/text-embeddings.npy') == provenance['baseline_text_sha256']
    assert sha256(CACHE / 'annotations.json') == provenance['annotations_sha256']
    assert annotations['corpusFingerprint'] == original['corpusFingerprint'] == provenance['corpusFingerprint']
    assert len(result['queries']) == 48 and len(result['tokenizerParity']) == 57
    assert all(x['match'] for x in result['tokenizerParity'])
    vectors = np.array([r['embedding'] for r in result['queries']], dtype=np.float32)
    assert vectors.shape == baseline.shape == (48, 768)
    np.testing.assert_allclose(np.linalg.norm(vectors, axis=1), 1, atol=2e-6)
    cosines = np.sum(vectors * baseline, axis=1)
    rows = []
    for i, row in enumerate(result['queries']):
        q = row['query']
        assert q['id'] == original['queries'][i]['query']['id']
        assert q['text'] == original['queries'][i]['query']['text']
        a = ranked(images @ baseline[i]); b = ranked(images @ vectors[i])
        assert [ids[j] for j in b[:10]] == [p['id'] for p in row['top']]
        relevant = annotations['qrels'][q['intent']]
        base_quality, browser_quality = quality(a, ids, relevant), quality(b, ids, relevant)
        rows.append({'query': q, 'cosine': float(cosines[i]), 'top1_same': bool(a[0] == b[0]),
            'overlap5': len(set(a[:5]) & set(b[:5])) / 5, 'overlap10': len(set(a[:10]) & set(b[:10])) / 10,
            'exact_order5': bool(np.array_equal(a[:5], b[:5])), 'exact_order10': bool(np.array_equal(a[:10], b[:10])),
            'baseline_top10': [ids[j] for j in a[:10]], 'browser_top10': [ids[j] for j in b[:10]],
            'baseline_quality': base_quality, 'browser_quality': browser_quality})
    langs = {}
    for lang in ('zh', 'en'):
        subset = [r for r in rows if r['query']['language'] == lang]
        a = average([r['baseline_quality'] for r in subset]); b = average([r['browser_quality'] for r in subset])
        langs[lang] = {'count': len(subset), 'positive_count': sum(r['browser_quality'] is not None for r in subset),
            'baseline': a, 'browser': b, 'delta': {k:b[k]-a[k] for k in a},
            'cosine': distribution([r['cosine'] for r in subset])}
    return {'variant': result['variant'], 'backend': result['backend'], 'cosine': distribution(cosines.tolist()),
        'rank_stability_all_48': {key:float(np.mean([r[key] for r in rows])) for key in
            ('top1_same','overlap5','overlap10','exact_order5','exact_order10')},
        'by_language': langs, 'queries': rows}


def main():
    outputs = []
    for path in sorted(OUT.glob('*.json')):
        result = read(path)
        if not isinstance(result, dict) or result.get('status') != 'success' or len(result.get('queries', [])) != 48:
            continue
        assessment = assess(result)
        write(OUT / 'evaluation' / path.name, assessment)
        rows = {key: result[key] for key in ('variant','backend','modelBytes','modelFetchMs','tokenizerInitMs',
            'dataAndTokenizerMs','sessionCreateMs','firstQueryMs','readyMs','coldToFirstResultMs','warmMs')}
        rows.update({'run':path.stem,'process_rss_peak_mb':result['processMemory']['peakBytes']/1e6,
                     'process_rss_baseline_mb':result['processMemory']['baselineBytes']/1e6,
                     'cosine':assessment['cosine'],'ranks':assessment['rank_stability_all_48'],
                     'quality':assessment['by_language']})
        outputs.append(rows)
    write(OUT / 'summary.json',outputs)
    lines=['# Browser measurements','',
        '| Run | Model MB | Cold first s | Warm median / p95 ms | Chrome RSS peak MB | Mean/min cosine | Top1 same | Top5/10 overlap |',
        '|---|---:|---:|---:|---:|---:|---:|---:|']
    for r in outputs:
        lines.append(f'| {r["run"]} | {r["modelBytes"]/1e6:.2f} | {r["coldToFirstResultMs"]/1000:.2f} | {r["warmMs"]["median"]:.2f} / {r["warmMs"]["p95"]:.2f} | {r["process_rss_peak_mb"]:.0f} | {r["cosine"]["mean"]:.7f} / {r["cosine"]["min"]:.7f} | {r["ranks"]["top1_same"]:.4f} | {r["ranks"]["overlap5"]:.4f} / {r["ranks"]["overlap10"]:.4f} |')
    lines += ['', '| Run | Language | Hit@1 | Hit@5 | Hit@10 | nDCG@5 delta | nDCG@10 delta |', '|---|---|---:|---:|---:|---:|---:|']
    for r in outputs:
        for lang, q in r['quality'].items():
            lines.append(f'| {r["run"]} | {lang} | {q["browser"]["hit1"]:.4f} | {q["browser"]["hit5"]:.4f} | {q["browser"]["hit10"]:.4f} | {q["delta"]["ndcg5"]:+.5f} | {q["delta"]["ndcg10"]:+.5f} |')
    (OUT / 'metrics.md').write_text('\n'.join(lines)+'\n')
    print('\n'.join(lines))


if __name__ == '__main__':main()
