#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
export PYTHONDONTWRITEBYTECODE=1
export PIP_CACHE_DIR="$PWD/.cache/semantic-spike/pip-cache"
experiment_python="$PWD/.cache/semantic-spike/venv/bin/python"
if [ ! -x "$experiment_python" ] || [ ! -f .cache/semantic-spike/siglip2/results.json ] || [ ! -f .cache/semantic-spike/annotations.json ]; then
  echo 'Phase 1 venv, benchmark and annotations are required. See scripts/semantic-spike/README.md.' >&2
  exit 1
fi
"$experiment_python" -m pip install -r scripts/semantic-spike/browser/requirements.txt
mkdir -p .cache/semantic-spike/phase2a/runtime
cp scripts/semantic-spike/browser/package.json .cache/semantic-spike/phase2a/runtime/package.json
npm install --prefix .cache/semantic-spike/phase2a/runtime --cache .cache/semantic-spike/phase2a/npm-cache --ignore-scripts --no-audit --no-fund
for step in export fp16 int8 int8wo manifest; do
  "$experiment_python" -B scripts/semantic-spike/browser/export_text.py "$step"
done
node --test scripts/semantic-spike/browser/test_tokenize.mjs
"$experiment_python" -m pip freeze > .cache/semantic-spike/phase2a/environment-lock.txt
echo 'Prepared. Start browser/server.mjs, then run browser/run_browser.mjs; see browser/README.md.'
