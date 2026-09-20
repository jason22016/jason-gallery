"""Local, offline inference: normalized image/text vectors and exact cosine search."""
import sys
sys.dont_write_bytecode = True
import argparse
import gc
import html
import importlib.metadata
import json
import platform
import random
import subprocess
import time

from common import CACHE, HERE, MODELS, ROOT, read, sha256, write
import numpy as np
from PIL import Image, ImageOps
import torch
from transformers import AutoModel, AutoProcessor


def normalize(vectors):
    vectors = np.asarray(vectors, dtype=np.float32)
    norms = np.linalg.norm(vectors, axis=-1, keepdims=True)
    if not np.isfinite(vectors).all() or np.any(norms < 1e-8):
        raise ValueError('Invalid/zero embedding')
    return vectors / norms


def ranked(scores):
    return np.argsort(-scores, kind='stable')


def quality(order, ids, relevant):
    relevant = set(relevant)
    if not relevant:
        return None  # Absence is not a failed positive query.
    hits = np.array([ids[int(i)] in relevant for i in order], dtype=float)
    first = np.flatnonzero(hits)
    result = {'hit1': float(hits[0]), 'mrr': float(1 / (first[0] + 1)) if len(first) else 0.0}
    for k in (5, 10):
        actual_k = min(k, len(order))
        dcg = np.sum(hits[:actual_k] / np.log2(np.arange(2, actual_k + 2)))
        ideal = np.sum(1 / np.log2(np.arange(2, min(actual_k, len(relevant)) + 2)))
        result.update({f'hit{k}': float(hits[:actual_k].any()),
                       f'precision{k}': float(hits[:actual_k].mean()),
                       f'recall{k}': float(hits[:actual_k].sum() / len(relevant)),
                       f'ndcg{k}': float(dcg / ideal)})
    return result


def average(rows):
    rows = [r for r in rows if r is not None]
    return {key: float(np.mean([r[key] for r in rows])) for key in rows[0]} if rows else {}


def distribution(values):
    return {'count': len(values), 'mean': float(np.mean(values)), 'median': float(np.median(values)),
            'p95': float(np.percentile(values, 95)), 'min': float(np.min(values)), 'max': float(np.max(values))}


def corpus():
    data = read(CACHE / 'corpus.json')
    for photo in data['photos']:
        if sha256(ROOT / photo['thumbnail']) != photo['thumbnailSha256']:
            raise ValueError('Thumbnail changed; rerun prepare.ts and benchmark')
    return data


class Encoder:
    def __init__(self, key, device):
        self.spec = MODELS[key]
        self.key = key
        self.device = device
        torch.set_num_threads(4)
        if device == 'mps' and not torch.backends.mps.is_available():
            raise RuntimeError('MPS unavailable; run outside sandbox or explicitly choose --device cpu')
        metadata = read(CACHE / 'downloads' / f'{key}.json')
        if metadata['revision'] != self.spec['revision']:
            raise ValueError('Downloaded revision differs from model lock')
        snapshot = metadata['snapshot']
        start = time.perf_counter()
        self.processor = AutoProcessor.from_pretrained(snapshot, local_files_only=True, use_fast=False,
                                                       trust_remote_code=False)
        self.model = AutoModel.from_pretrained(snapshot, local_files_only=True, trust_remote_code=False,
                                              dtype=torch.float32, attn_implementation='eager',
                                              use_safetensors=self.spec['weights'].endswith('.safetensors'))
        self.model.eval().to(device)
        self.sync()
        self.load_seconds = time.perf_counter() - start

    def sync(self):
        if self.device == 'mps':
            torch.mps.synchronize()

    def image(self, paths):
        images = []
        for path in paths:
            with Image.open(path) as image:
                images.append(ImageOps.exif_transpose(image).convert('RGB'))
        try:
            inputs = self.processor(images=images, return_tensors='pt').to(self.device)
            with torch.inference_mode():
                features = self.model.get_image_features(**inputs)
            return normalize(features.float().cpu().numpy())
        finally:
            for image in images:
                image.close()

    def text(self, query):
        # Natural language retrieval uses raw queries, no translation or classification template.
        inputs = self.processor(text=[query], padding='max_length', truncation=True,
                                max_length=self.spec['max_length'], return_tensors='pt').to(self.device)
        with torch.inference_mode():
            features = self.model.get_text_features(**inputs)
        return normalize(features.float().cpu().numpy())[0]

    def describe(self):
        return {**self.spec, 'device': self.device, 'dtype': 'float32', 'attention': 'eager',
                'load_seconds': self.load_seconds,
                'parameters': sum(p.numel() for p in self.model.parameters()),
                'image_processor': self.processor.image_processor.to_dict(),
                'text_preprocessing': {'template': None, 'translation': False, 'padding': 'max_length',
                    'max_length': self.spec['max_length'], 'truncation': True,
                    'tokenizer': type(self.processor.tokenizer).__name__},
                'image_preprocessing': 'Pillow EXIF transpose + RGB, then fixed revision AutoProcessor (slow)',
                'download': read(CACHE / 'downloads' / f'{self.key}.json')}


def embed_images(encoder, paths, batch_size):
    # Warm-up deliberately excluded. Decode and preprocessing are included in all measured batches.
    start = time.perf_counter()
    for _ in range(2):
        encoder.image(paths[:batch_size])
    encoder.sync()
    warmup = time.perf_counter() - start
    vectors, batches = [], []
    total_start = time.perf_counter()
    for offset in range(0, len(paths), batch_size):
        encoder.sync()
        start = time.perf_counter()
        vectors.append(encoder.image(paths[offset:offset + batch_size]))
        encoder.sync()
        batches.append(time.perf_counter() - start)
        print(f'{encoder.key}: images {min(offset + batch_size, len(paths))}/{len(paths)}', flush=True)
    total = time.perf_counter() - total_start
    return np.concatenate(vectors), {'count': len(paths), 'batch_size': batch_size,
        'warmup_seconds': warmup, 'total_seconds': total, 'seconds_per_image': total / len(paths),
        'images_per_second': len(paths) / total, 'batch_seconds': batches,
        'scope': 'warm inference, local file decode + preprocessing + GPU + synchronization + normalization + CPU copy; excludes model load/download/index serialization'}


def queries():
    return [{'id': f'{q["id"]}-{lang}', 'intent': q['id'], 'language': lang, 'text': q[lang],
             'absent': q.get('absent', False), 'criterion': q['criterion']}
            for q in read(HERE / 'queries.json') for lang in ('zh', 'en')]


def load_annotations(data):
    path = CACHE / 'annotations.json'
    if not path.exists():
        return {'corpusFingerprint': data['fingerprint'], 'annotator': 'Unlabeled: quality metrics unavailable',
                'qrels': {q['id']: [] for q in read(HERE / 'queries.json')}}
    annotations = read(path)
    if annotations['corpusFingerprint'] != data['fingerprint']:
        raise ValueError('Annotations belong to another corpus')
    ids = {p['id'] for p in data['photos']}
    for q in read(HERE / 'queries.json'):
        labels = annotations['qrels'][q['id']]
        if len(set(labels)) != len(labels) or not set(labels) <= ids:
            raise ValueError(f'Invalid relevance IDs for {q["id"]}')
        if q.get('absent') and labels:
            raise ValueError('Absent controls must have no relevant photos')
    return annotations


def original_comparison(encoder, data, image_vectors, text_vectors, query_list, annotations, batch_size, out):
    manifest = read(CACHE / 'originals.json')
    if manifest['corpusFingerprint'] != data['fingerprint']:
        raise ValueError('Original sample belongs to another corpus')
    sample = manifest['photos']
    if any(p['status'] != 'ok' for p in sample):
        raise ValueError('Original sample incomplete; rerun download.py originals')
    for p in sample:
        if sha256(CACHE / p['path']) != p['sha256']:
            raise ValueError('Original changed')
    index_by_id = {p['id']: i for i, p in enumerate(data['photos'])}
    sample_indices = [index_by_id[p['id']] for p in sample]
    sample_ids = [p['id'] for p in sample]
    original_vectors, timing = embed_images(encoder, [CACHE / p['path'] for p in sample], batch_size)
    np.save(out / 'original-embeddings.npy', original_vectors)
    thumbnail_vectors = image_vectors[sample_indices]
    cosines = np.sum(thumbnail_vectors * original_vectors, axis=1)
    thumbnail_scores = text_vectors @ thumbnail_vectors.T
    original_scores = text_vectors @ original_vectors.T
    hybrid = image_vectors.copy()
    hybrid[sample_indices] = original_vectors
    hybrid_scores = text_vectors @ hybrid.T
    base_scores = text_vectors @ image_vectors.T
    ids = [p['id'] for p in data['photos']]
    rows = []
    for i, query in enumerate(query_list):
        a, b = ranked(thumbnail_scores[i]), ranked(original_scores[i])
        ar, br = ranked(a), ranked(b)
        full_a, full_b = ranked(base_scores[i]), ranked(hybrid_scores[i])
        relevant = annotations['qrels'][query['intent']]
        sample_relevant = set(relevant) & set(sample_ids)
        rows.append({'query': query, 'top1_same': bool(a[0] == b[0]),
            'overlap5': len(set(a[:5]) & set(b[:5])) / 5,
            'overlap10': len(set(a[:10]) & set(b[:10])) / 10,
            'spearman': float(np.corrcoef(ar, br)[0, 1]),
            'thumbnail_top10': [sample_ids[j] for j in a[:10]],
            'original_top10': [sample_ids[j] for j in b[:10]],
            'thumbnail_quality': quality(a, sample_ids, sample_relevant),
            'original_quality': quality(b, sample_ids, sample_relevant),
            'hybrid_top1_same': bool(full_a[0] == full_b[0]),
            'hybrid_overlap5': len(set(full_a[:5]) & set(full_b[:5])) / 5,
            'hybrid_thumbnail_quality': quality(full_a, ids, relevant),
            'hybrid_original_quality': quality(full_b, ids, relevant)})
    return {'sample': manifest, 'timing': timing, 'vector_cosine': distribution(cosines.tolist()),
            'per_photo_cosine': dict(zip(sample_ids, cosines.tolist())),
            'image_self_retrieval_hit1': float(np.mean(np.argmax(original_vectors @ thumbnail_vectors.T, axis=1) == np.arange(len(sample)))),
            'stability_all_queries': average([{k: float(row[k]) for k in (
                'top1_same', 'overlap5', 'overlap10', 'spearman', 'hybrid_top1_same', 'hybrid_overlap5')} for row in rows]),
            'sample_positive_query_count': sum(r['thumbnail_quality'] is not None for r in rows),
            'thumbnail_quality': average([r['thumbnail_quality'] for r in rows]),
            'original_quality': average([r['original_quality'] for r in rows]),
            'hybrid_thumbnail_quality': average([r['hybrid_thumbnail_quality'] for r in rows]),
            'hybrid_original_quality': average([r['hybrid_original_quality'] for r in rows]), 'queries': rows}


def render(results, data, out):
    photos = {p['id']: p for p in data['photos']}
    def cards(ids, scores=None, offset=0):
        tiles = []
        for n, id_ in enumerate(ids):
            p = photos[id_]
            score = f' · {scores[n]:.4f}' if scores is not None else ''
            tiles.append(f'<figure><a href="../../../{html.escape(p["thumbnail"], quote=True)}"><img loading="lazy" src="../../../{html.escape(p["thumbnail"], quote=True)}"></a><figcaption>#{n+1+offset} · {p["ordinal"]} · {html.escape(p["publicId"])}{score}<br>{html.escape(p["filename"])}</figcaption></figure>')
        return '<div class="grid">' + ''.join(tiles) + '</div>'
    parts = ['<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Semantic Spike review</title>',
             '<style>body{font:15px system-ui;max-width:1500px;margin:24px auto;padding:16px;background:#161616;color:#eee}.grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px}figure{margin:0}img{width:100%;height:170px;object-fit:contain;background:#080808}figcaption{font-size:11px;overflow-wrap:anywhere}section{margin:40px 0}summary{cursor:pointer;margin:16px 0}pre{white-space:pre-wrap}@media(max-width:700px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}</style>',
             f'<h1>{html.escape(results["model"]["id"])} · {len(data["photos"])}-photo spike</h1>',
             '<p>Cosine scores are not probabilities. Top-5 shown first; expand for ranks 6–10. Annotations are preliminary AI visual review, not independent human judgments.</p>',
             '<pre>' + html.escape(json.dumps(results['quality'], indent=2, ensure_ascii=False)) + '</pre>']
    for row in results['queries']:
        q = row['query']
        parts.extend([f'<section id="{q["id"]}"><h2>{html.escape(q["text"])} · {q["language"]}</h2>',
                      f'<p>{html.escape(q["criterion"])} · {"ABSENT CONTROL" if q["absent"] else "positive query"}</p>',
                      cards(row['top_ids'][:5], row['top_scores'][:5]), '<details><summary>Ranks 6–10</summary>',
                      cards(row['top_ids'][5:10], row['top_scores'][5:10], 5), '</details></section>'])
    parts.append('<h1>24 originals vs thumbnails — same candidate set</h1>')
    for row in results['original_comparison']['queries']:
        parts.extend([f'<section><h2>{html.escape(row["query"]["text"])}</h2><h3>Thumbnail embedding</h3>',
                      cards(row['thumbnail_top10'][:5]), '<h3>Original embedding</h3>',
                      cards(row['original_top10'][:5]), '</section>'])
    (out / 'review.html').write_text('\n'.join(parts))


def benchmark(args):
    data = corpus()
    annotations = load_annotations(data)
    query_list = queries()
    encoder = Encoder(args.model, args.device)
    out = CACHE / args.model
    out.mkdir(exist_ok=True)
    image_vectors, image_timing = embed_images(encoder, [ROOT / p['thumbnail'] for p in data['photos']], args.batch_size)
    if image_vectors.shape != (len(data['photos']), encoder.spec['dimension']):
        raise ValueError('Unexpected embedding shape')
    np.save(out / 'image-embeddings.npy', image_vectors)
    write(out / 'index.json', {'corpusFingerprint': data['fingerprint'], 'ids': [p['id'] for p in data['photos']],
                             'model': encoder.describe()})
    start = time.perf_counter()
    for q in query_list[:4]:
        encoder.text(q['text'])
    query_warmup = time.perf_counter() - start
    latencies = [[] for _ in query_list]
    embed_latencies = [[] for _ in query_list]
    vectors = [None] * len(query_list)
    for repeat in range(args.repeats):
        order = list(range(len(query_list)))
        random.Random(20260921 + repeat).shuffle(order)
        for i in order:
            encoder.sync()
            start = time.perf_counter()
            v = encoder.text(query_list[i]['text'])
            encoder.sync()
            embed_latencies[i].append((time.perf_counter() - start) * 1000)
            scores = image_vectors @ v
            ranked(scores)[:10]
            latencies[i].append((time.perf_counter() - start) * 1000)
            vectors[i] = v
        print(f'{args.model}: query round {repeat+1}/{args.repeats}', flush=True)
    text_vectors = np.stack(vectors)
    np.save(out / 'text-embeddings.npy', text_vectors)
    scores = text_vectors @ image_vectors.T
    ids = [p['id'] for p in data['photos']]
    rows = []
    for i, q in enumerate(query_list):
        order = ranked(scores[i])
        rows.append({'query': q, 'top_ids': [ids[j] for j in order[:10]],
                     'top_scores': scores[i, order[:10]].tolist(),
                     'quality': quality(order, ids, annotations['qrels'][q['intent']]),
                     'embedding_latency_ms': embed_latencies[i], 'query_latency_ms': latencies[i]})
    bilingual = []
    for i in range(0, len(rows), 2):
        a, b = rows[i]['top_ids'], rows[i+1]['top_ids']
        bilingual.append({'intent': rows[i]['query']['intent'], 'top1_same': a[0] == b[0],
                          'overlap5': len(set(a[:5]) & set(b[:5])) / 5,
                          'overlap10': len(set(a) & set(b)) / 10})
    results = {'model': encoder.describe(), 'corpusFingerprint': data['fingerprint'], 'image_timing': image_timing,
               'query_timing': {'warmup_seconds': query_warmup, 'repeats': args.repeats,
                   'all_ms': distribution([x for row in latencies for x in row]),
                   'by_language_ms': {lang: distribution([x for i,q in enumerate(query_list) if q['language'] == lang for x in latencies[i]]) for lang in ('zh', 'en')},
                   'scope': 'warm batch-one tokenize + text GPU + sync + CPU normalize + exact cosine/ranking; no model load or HTML rendering'},
               'quality': {lang: average([r['quality'] for r in rows if r['query']['language'] == lang]) for lang in ('zh','en')},
               'annotation_provenance': annotations['annotator'], 'bilingual_consistency': bilingual, 'queries': rows}
    results['original_comparison'] = original_comparison(encoder, data, image_vectors, text_vectors,
                                                       query_list, annotations, args.batch_size, out)
    def sysctl(name):
        try:
            return subprocess.check_output(['sysctl', '-n', name], text=True).strip()
        except (subprocess.CalledProcessError, FileNotFoundError):
            return 'unavailable'
    results['environment'] = {'platform': platform.platform(), 'python': platform.python_version(),
        'chip': sysctl('machdep.cpu.brand_string'), 'memory_bytes': sysctl('hw.memsize'),
        'packages': {name: importlib.metadata.version(name) for name in ('torch','transformers','numpy','pillow','huggingface-hub','tokenizers')},
        'timestamp_utc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'git_commit': subprocess.check_output(['git','rev-parse','HEAD'], cwd=ROOT, text=True).strip(),
        'queries_sha256': sha256(HERE / 'queries.json'),
        'annotations_sha256': sha256(CACHE / 'annotations.json') if (CACHE / 'annotations.json').exists() else None}
    write(out / 'results.json', results)
    render(results, data, out)
    print(json.dumps({'model': args.model, 'image_timing': image_timing, 'query_timing': results['query_timing'], 'quality': results['quality']}, indent=2), flush=True)
    del encoder
    gc.collect()


def search(args):
    if not args.query.strip():
        raise ValueError('Query must not be empty')
    if not 1 <= args.top_k <= 100:
        raise ValueError('--top-k must be in 1..100')
    data = corpus()
    out = CACHE / args.model
    index = read(out / 'index.json')
    if index['corpusFingerprint'] != data['fingerprint'] or index['model']['revision'] != MODELS[args.model]['revision']:
        raise ValueError('Stale embedding index; rerun benchmark')
    encoder = Encoder(args.model, args.device)
    vectors = np.load(out / 'image-embeddings.npy', allow_pickle=False)
    scores = vectors @ encoder.text(args.query)
    order = ranked(scores)[:args.top_k]
    by_id = {p['id']: p for p in data['photos']}
    print(json.dumps([{'rank': rank+1, 'cosine': float(scores[j]), **by_id[index['ids'][j]]}
                      for rank,j in enumerate(order)], ensure_ascii=False, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['benchmark', 'search'])
    parser.add_argument('--model', choices=list(MODELS), required=True)
    parser.add_argument('--device', choices=['mps','cpu'], default='mps')
    parser.add_argument('--batch-size', type=int, default=8)
    parser.add_argument('--repeats', type=int, default=3)
    parser.add_argument('--query', default='')
    parser.add_argument('--top-k', type=int, default=10)
    args = parser.parse_args()
    if args.batch_size < 1 or args.repeats < 1:
        parser.error('Batch size and repeats must be positive')
    {'benchmark': benchmark, 'search': search}[args.command](args)
