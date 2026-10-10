#!/usr/bin/env bash
set -euo pipefail
QWEN_ROOT=${QWEN_ROOT:-/home1/huntun/kelvoy-qwen-pe}
test -f "$QWEN_ROOT/model/ARTIFACTS.json"
python3 "$QWEN_ROOT/verify-qwen-pe-runtime.py"
export HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1
export HF_HOME="$QWEN_ROOT/hf-cache"
export VLLM_CACHE_ROOT="$QWEN_ROOT/vllm-cache"
export CUDA_CACHE_PATH="$QWEN_ROOT/cuda-cache"
export VLLM_WORKER_MULTIPROC_METHOD=spawn
# GB10 shares host RAM with the GPU: 30% budget plus a fixed 8 GiB KV cache.
# One sequence, two references, 32768 context leaves room for official 24000 output.
exec "$QWEN_ROOT/.venv/bin/vllm" serve "$QWEN_ROOT/model" \
  --served-model-name Qwen/Qwen-Image-2.1-PE-I2I \
  --host 127.0.0.1 --port 8110 --dtype bfloat16 \
  --max-model-len 32768 --max-num-seqs 1 \
  --gpu-memory-utilization 0.30 --kv-cache-memory-bytes 8589934592 \
  --limit-mm-per-prompt '{"image":2}' \
  --generation-config vllm --disable-log-requests \
  --reasoning-parser qwen3
