#!/usr/bin/env bash
set -euo pipefail
export QWEN_ROOT=${QWEN_ROOT:-/home1/huntun/kelvoy-qwen-pe}
test -f "$QWEN_ROOT/model/ARTIFACTS.json"
python3 "$QWEN_ROOT/verify-qwen-pe-runtime.py"
export HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1
export HF_HOME="$QWEN_ROOT/hf-cache"
export CUDA_CACHE_PATH="$QWEN_ROOT/cuda-cache"
cd "$QWEN_ROOT"
exec "$QWEN_ROOT/.venv-transformers/bin/uvicorn" \
  qwen-pe-transformers:app --host 127.0.0.1 --port 8110 --workers 1 --no-access-log
