"""Rescore saved vectors after review-label edits; never rerun inference to change labels."""
import sys
sys.dont_write_bytecode = True
import csv
from common import CACHE, HERE, MODELS, read, sha256, write
from experiment import average, corpus, load_annotations, quality, ranked, render
import numpy as np


def rescore(key):
    data = corpus()
    annotations = load_annotations(data)
    folder = CACHE / key
    result = read(folder / 'results.json')
    index = read(folder / 'index.json')
    ids = [p['id'] for p in data['photos']]
    assert result['corpusFingerprint'] == index['corpusFingerprint'] == data['fingerprint']
    assert result['environment']['queries_sha256'] == sha256(HERE / 'queries.json')
    assert result['model']['revision'] == MODELS[key]['revision']
    assert index['ids'] == ids
    images = np.load(folder / 'image-embeddings.npy', allow_pickle=False)
    texts = np.load(folder / 'text-embeddings.npy', allow_pickle=False)
    originals = np.load(folder / 'original-embeddings.npy', allow_pickle=False)
    sample = result['original_comparison']['sample']['photos']
    assert images.shape == (len(ids), MODELS[key]['dimension'])
    assert texts.shape == (len(result['queries']), MODELS[key]['dimension'])
    assert originals.shape == (len(sample), MODELS[key]['dimension'])
    for vectors in (images, texts, originals):
        assert np.isfinite(vectors).all()
        np.testing.assert_allclose(np.linalg.norm(vectors, axis=1), 1, atol=2e-6)
    sample_ids = [p['id'] for p in sample]
    sample_indices = [ids.index(id_) for id_ in sample_ids]
    hybrid = images.copy()
    hybrid[sample_indices] = originals
    all_scores = texts @ images.T
    small_scores = texts @ images[sample_indices].T
    original_scores = texts @ originals.T
    hybrid_scores = texts @ hybrid.T
    for i, row in enumerate(result['queries']):
        relevant = annotations['qrels'][row['query']['intent']]
        order = ranked(all_scores[i])
        assert row['top_ids'] == [ids[j] for j in order[:10]]
        row['quality'] = quality(order, ids, relevant)
        small_relevant = set(relevant) & set(sample_ids)
        small = result['original_comparison']['queries'][i]
        assert small['query']['id'] == row['query']['id']
        small['thumbnail_quality'] = quality(ranked(small_scores[i]), sample_ids, small_relevant)
        small['original_quality'] = quality(ranked(original_scores[i]), sample_ids, small_relevant)
        small['hybrid_thumbnail_quality'] = row['quality']
        small['hybrid_original_quality'] = quality(ranked(hybrid_scores[i]), ids, relevant)
    result['quality'] = {lang: average([r['quality'] for r in result['queries'] if r['query']['language'] == lang])
                         for lang in ('zh', 'en')}
    comparison = result['original_comparison']
    for field in ('thumbnail_quality', 'original_quality', 'hybrid_thumbnail_quality', 'hybrid_original_quality'):
        comparison[field] = average([r[field] for r in comparison['queries']])
    comparison['sample_positive_query_count'] = sum(r['thumbnail_quality'] is not None for r in comparison['queries'])
    result['annotation_provenance'] = annotations['annotator']
    result['annotation_corrections'] = annotations.get('corrections', [])
    result['environment']['annotations_sha256'] = sha256(CACHE / 'annotations.json') if (CACHE / 'annotations.json').exists() else None
    write(folder / 'results.json', result)
    render(result, data, folder)
    by_id = {p['id']: p for p in data['photos']}
    with (folder / 'top10.csv').open('w', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(['query_id','language','query','rank','public_id','ordinal','filename','cosine','preliminary_relevant'])
        for row in result['queries']:
            q = row['query']
            for rank, (id_, score) in enumerate(zip(row['top_ids'], row['top_scores']), 1):
                p = by_id[id_]
                writer.writerow([q['id'],q['language'],q['text'],rank,p['publicId'],p['ordinal'],p['filename'],score,
                                 id_ in annotations['qrels'][q['intent']]])
    return result


def summary(results):
    lines = ['# Measured benchmark summary', '',
        'Quality uses preliminary visual labels. Empty metrics mean unlabeled; absent controls are excluded. See the full Spike report for interpretation.', '',
        '| Model | Images / s | Total image s | ms / image | Query median / p95 ms | Weight MB | Snapshot MB | Dimension |',
        '|---|---:|---:|---:|---:|---:|---:|---:|']
    for r in results:
        m, t, q = r['model'], r['image_timing'], r['query_timing']['all_ms']
        lines.append(f'| {m["id"]} | {t["images_per_second"]:.2f} | {t["total_seconds"]:.3f} | {t["seconds_per_image"]*1000:.2f} | {q["median"]:.2f} / {q["p95"]:.2f} | {m["download"]["weight_bytes"]/1e6:.1f} | {m["download"]["snapshot_bytes"]/1e6:.1f} | {m["dimension"]} |')
    lines += ['', '| Model | Language | Hit@1 | Hit@5 | Hit@10 | nDCG@5 | nDCG@10 | P@5 | R@5 |', '|---|---|---:|---:|---:|---:|---:|---:|---:|']
    for r in results:
        for lang, q in r['quality'].items():
            if q:
                lines.append(f'| {r["model"]["id"]} | {lang} | {q["hit1"]:.4f} | {q["hit5"]:.4f} | {q["hit10"]:.4f} | {q["ndcg5"]:.4f} | {q["ndcg10"]:.4f} | {q["precision5"]:.4f} | {q["recall5"]:.4f} |')
    lines += ['', '| Model | Mean vector cosine | Top-1 same | Top-5 overlap | Top-10 overlap | Sample thumbnail / original nDCG@5 |', '|---|---:|---:|---:|---:|---:|']
    for r in results:
        c = r['original_comparison']; s = c['stability_all_queries']
        lines.append(f'| {r["model"]["id"]} | {c["vector_cosine"]["mean"]:.5f} | {s["top1_same"]:.4f} | {s["overlap5"]:.4f} | {s["overlap10"]:.4f} | {c["thumbnail_quality"].get("ndcg5", "unlabeled")} / {c["original_quality"].get("ndcg5", "unlabeled")} |')
    (CACHE / 'metrics.md').write_text('\n'.join(lines) + '\n')


if __name__ == '__main__':
    results = [rescore(key) for key in MODELS]
    summary(results)
    print('Verified stored vectors, rescored labels, regenerated HTML/CSV and metrics.md; no inference rerun.')
