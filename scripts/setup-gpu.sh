#!/usr/bin/env bash
# One-time setup: pip-install the minimal CUDA 12 runtime libraries into
# `.cuda-libs/` so the ONNX Runtime CUDA execution provider (shipped as
# `libonnxruntime_providers_cuda.so` inside `node_modules/onnxruntime-node/`)
# can dlopen what it needs without polluting your system.
#
# Why: Arch Linux ships CUDA 13 via `extra/cuda`, but ORT 1.21 was compiled
#      against CUDA 12 (needs libcudart.so.12, libcublas.so.12, libcublasLt.so.12,
#      libcudnn.so.9). The official NVIDIA wheels provide exactly these.
#
# Usage:
#   scripts/setup-gpu.sh          # installs everything
#   scripts/setup-gpu.sh --check  # verify after install; list loadable libs
#
# Requirements:
#   - Python 3.9+ with pip (we use --target, no venv creation)
#   - ~1 GB free disk
#
# Result: a self-contained `.cuda-libs/` directory that `scripts/bench-gpu.sh`
# will add to LD_LIBRARY_PATH before running the benchmark.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CUDA_LIBS_DIR="${REPO_ROOT}/.cuda-libs"

# ORT 1.21 CUDA EP dependency set. Each wheel drops .so files into
# <dir>/nvidia/<pkg>/lib/.
WHEELS=(
  "nvidia-cuda-runtime-cu12"   # libcudart.so.12
  "nvidia-cublas-cu12"         # libcublas.so.12, libcublasLt.so.12
  "nvidia-cudnn-cu12"          # libcudnn.so.9 (and sub-modules)
  "nvidia-cufft-cu12"          # libcufft.so.11
  "nvidia-curand-cu12"         # libcurand.so.10 (required by ORT CUDA EP)
)

if [[ "${1:-}" == "--check" ]]; then
  echo "== libraries under ${CUDA_LIBS_DIR} =="
  find "${CUDA_LIBS_DIR}" -name "*.so*" 2>/dev/null | sort
  echo
  echo "== export snippet =="
  libpath=$(find "${CUDA_LIBS_DIR}" -type d -name lib 2>/dev/null | paste -sd ':' -)
  echo "export LD_LIBRARY_PATH=\"${libpath}\${LD_LIBRARY_PATH:+:\$LD_LIBRARY_PATH}\""
  exit 0
fi

if ! command -v pip >/dev/null 2>&1; then
  echo "error: pip not found. Install Python + pip first." >&2
  exit 1
fi

mkdir -p "${CUDA_LIBS_DIR}"
echo "Installing CUDA 12 runtime wheels into ${CUDA_LIBS_DIR}"
echo "  packages: ${WHEELS[*]}"
echo

pip install \
  --target "${CUDA_LIBS_DIR}" \
  --upgrade \
  --no-cache-dir \
  "${WHEELS[@]}"

echo
echo "Done. Verify:"
echo "  scripts/setup-gpu.sh --check"
echo
echo "Then run a GPU-accelerated bench:"
echo "  scripts/bench-gpu.sh bench:beir:scifact"
