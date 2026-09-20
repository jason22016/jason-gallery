"""All mutable state stays in the ignored, repository-local experiment cache."""
import hashlib
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
CACHE = ROOT / '.cache' / 'semantic-spike'
CACHE.mkdir(parents=True, exist_ok=True)
sys.dont_write_bytecode = True
for name, suffix in {'HF_HOME': 'huggingface', 'HF_HUB_CACHE': 'huggingface/hub',
                     'XDG_CACHE_HOME': 'xdg', 'TORCH_HOME': 'torch', 'TMPDIR': 'tmp',
                     'PYTHONPYCACHEPREFIX': 'pycache'}.items():
    location = CACHE / suffix
    location.mkdir(parents=True, exist_ok=True)
    os.environ[name] = str(location)
os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
os.environ['HF_HUB_DISABLE_IMPLICIT_TOKEN'] = '1'
os.environ['HF_HUB_DISABLE_XET'] = '1'
os.environ['TOKENIZERS_PARALLELISM'] = 'false'
os.environ['HF_HUB_DOWNLOAD_TIMEOUT'] = '120'


def read(path):
    return json.loads(Path(path).read_text())


def write(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_text(json.dumps(data, indent=2, ensure_ascii=False, allow_nan=False) + '\n')
    temp.replace(path)


def sha256(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


MODELS = read(HERE / 'models.json')
