"""Download fixed public model snapshots and a deterministic 24-photo original sample."""
import sys
sys.dont_write_bytecode = True
import argparse
import hashlib
import time
from concurrent.futures import ThreadPoolExecutor

from common import CACHE, MODELS, read, sha256, write
from huggingface_hub import snapshot_download
from PIL import Image
import requests


def models():
    for key, spec in MODELS.items():
        started = time.perf_counter()
        snapshot = snapshot_download(spec['id'], revision=spec['revision'], token=False,
                                     allow_patterns=['*.json', '*.txt', '*.model', spec['weights']],
                                     max_workers=3)
        from pathlib import Path
        files = {p.name: p.stat().st_size for p in Path(snapshot).iterdir() if p.is_file()}
        write(CACHE / 'downloads' / f'{key}.json', {
            **spec, 'snapshot': snapshot, 'files': files,
            'download_or_cache_seconds': time.perf_counter() - started,
            'weight_bytes': files[spec['weights']], 'snapshot_bytes': sum(files.values()),
            'weight_sha256': sha256(Path(snapshot) / spec['weights']),
        })
        print(f'{key}: ready, {sum(files.values()) / 1e6:.1f} MB', flush=True)


def originals():
    corpus = read(CACHE / 'corpus.json')
    # Hash ordering is independent of Python RNG versions and current input ordering.
    seed = 'semantic-spike-20260921'
    selected = sorted(corpus['photos'], key=lambda p: hashlib.sha256(
        (seed + ':' + p['id']).encode()).hexdigest())[:24]
    folder = CACHE / 'originals'
    folder.mkdir(exist_ok=True)

    def fetch(photo):
        path = folder / (photo['publicId'] + '.jpg')
        start = time.perf_counter()
        try:
            cached = path.exists()
            if not cached:
                for attempt in range(3):
                    try:
                        with requests.get(photo['originalUrl'], stream=True, timeout=(15, 120)) as response:
                            response.raise_for_status()
                            size = 0
                            with path.with_suffix('.part').open('wb') as f:
                                for chunk in response.iter_content(1024 * 1024):
                                    size += len(chunk)
                                    if size > 100 * 1024 * 1024:
                                        raise ValueError('Original exceeds 100 MiB download limit')
                                    f.write(chunk)
                        with Image.open(path.with_suffix('.part')) as im:
                            im.verify()
                        path.with_suffix('.part').replace(path)
                        break
                    except Exception:
                        path.with_suffix('.part').unlink(missing_ok=True)
                        if attempt == 2:
                            raise
                        time.sleep(attempt + 1)
            with Image.open(path) as im:
                width, height = im.size
            print(f'original {photo["ordinal"]}: {path.stat().st_size / 1e6:.1f} MB', flush=True)
            return {'id': photo['id'], 'publicId': photo['publicId'], 'ordinal': photo['ordinal'],
                    'url': photo['originalUrl'], 'path': str(path.relative_to(CACHE)),
                    'bytes': path.stat().st_size, 'sha256': sha256(path), 'width': width, 'height': height,
                    'cached': cached, 'seconds': time.perf_counter() - start, 'status': 'ok'}
        except Exception as error:
            return {'id': photo['id'], 'status': 'error', 'error': str(error)}

    with ThreadPoolExecutor(max_workers=3) as executor:
        results = list(executor.map(fetch, selected))
    write(CACHE / 'originals.json', {'seed': seed, 'corpusFingerprint': corpus['fingerprint'],
                                  'sampling': 'uniform hash order without replacement', 'photos': results})
    failures = [p for p in results if p['status'] != 'ok']
    if failures:
        raise RuntimeError(f'{len(failures)} originals failed; see originals.json')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('target', choices=['models', 'originals'])
    args = parser.parse_args()
    {'models': models, 'originals': originals}[args.target]()
