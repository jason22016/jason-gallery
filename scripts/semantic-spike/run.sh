#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
export PYTHONDONTWRITEBYTECODE=1
export PIP_CACHE_DIR="$PWD/.cache/semantic-spike/pip-cache"
python_bin="$PWD/.cache/semantic-spike/venv/bin/python"
if [ ! -x "$python_bin" ]; then
  "${SPIKE_PYTHON:-python3}" -c 'import sys; assert (3, 10) <= sys.version_info[:2] <= (3, 13), "Use Python 3.10–3.13 (tested 3.12); set SPIKE_PYTHON to its executable"'
  "${SPIKE_PYTHON:-python3}" -m venv .cache/semantic-spike/venv
fi
"$python_bin" -m pip install -r scripts/semantic-spike/requirements.txt
node --import tsx scripts/semantic-spike/prepare.ts
"$python_bin" scripts/semantic-spike/download.py models
"$python_bin" scripts/semantic-spike/download.py originals
"$python_bin" -m unittest discover -s scripts/semantic-spike -p 'test_*.py'
# Sequential measurements avoid competition for GPU / unified memory.
for model in siglip2 clip; do
  "$python_bin" scripts/semantic-spike/experiment.py benchmark --model "$model" --device "${SPIKE_DEVICE:-mps}"
done
"$python_bin" scripts/semantic-spike/review.py
"$python_bin" -m pip freeze > .cache/semantic-spike/environment-lock.txt
