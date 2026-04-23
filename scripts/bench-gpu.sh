#!/usr/bin/env bash
# Run a Context Fabric command with the ONNX Runtime CUDA execution provider
# enabled. Composes with any existing `npm run <script>`.
#
# Prereq: `scripts/setup-gpu.sh` has been run once to populate `.cuda-libs/`.
#
# Usage examples:
#   scripts/bench-gpu.sh bench:beir:scifact
#   scripts/bench-gpu.sh bench:beir:fiqa
#   scripts/bench-gpu.sh bench:longmemeval:s
#   scripts/bench-gpu.sh bench:quality      # works for any npm script in package.json
#   scripts/bench-gpu.sh -- node --experimental-strip-types benchmarks/public/beir.ts fiqa
#
# Env (all optional, all honored):
#   CONTEXT_FABRIC_EMBED_EP=cuda     (set automatically; override if needed)
#   BENCH_INGEST_BATCH=128           (bigger batches help more on GPU than CPU)
#   BENCH_LIMIT, BENCH_QUERY_LIMIT, ... see benchmarks/public/*.ts

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CUDA_LIBS_DIR="${REPO_ROOT}/.cuda-libs"

if [[ ! -d "${CUDA_LIBS_DIR}" ]]; then
  cat >&2 <<EOF
error: ${CUDA_LIBS_DIR} does not exist.

Run this first:
  scripts/setup-gpu.sh
EOF
  exit 1
fi

# Build LD_LIBRARY_PATH from every nvidia/*/lib directory under .cuda-libs/.
CUDA_LD=$(find "${CUDA_LIBS_DIR}" -type d -name lib 2>/dev/null | paste -sd ':' -)
if [[ -z "${CUDA_LD}" ]]; then
  echo "error: no library directories under ${CUDA_LIBS_DIR}. Re-run scripts/setup-gpu.sh." >&2
  exit 1
fi

export LD_LIBRARY_PATH="${CUDA_LD}${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}"
export CONTEXT_FABRIC_EMBED_EP="${CONTEXT_FABRIC_EMBED_EP:-cuda}"

# Bigger default batch — GPU only pays off when we feed it work in bulk.
export BENCH_INGEST_BATCH="${BENCH_INGEST_BATCH:-128}"

echo "[bench-gpu] LD_LIBRARY_PATH=${CUDA_LD}"
echo "[bench-gpu] CONTEXT_FABRIC_EMBED_EP=${CONTEXT_FABRIC_EMBED_EP}"
echo "[bench-gpu] BENCH_INGEST_BATCH=${BENCH_INGEST_BATCH}"
echo

if [[ "${1:-}" == "--" ]]; then
  shift
  exec "$@"
fi

if [[ $# -eq 0 ]]; then
  echo "usage: scripts/bench-gpu.sh <npm-script> [args]" >&2
  echo "   or: scripts/bench-gpu.sh -- <command> [args]" >&2
  exit 2
fi

cd "${REPO_ROOT}"
exec npm run "$@"
