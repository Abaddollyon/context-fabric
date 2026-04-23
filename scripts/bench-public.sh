#!/usr/bin/env bash
# Download + dispatch wrapper for the public-benchmark suite.
#
# Usage:
#   scripts/bench-public.sh download <dataset>
#     where <dataset> is one of:
#       scifact           (BEIR)
#       fiqa              (BEIR)
#       nfcorpus          (BEIR)
#       longmemeval_s     (LongMemEval, small variant)
#
#   scripts/bench-public.sh run <dataset>
#     wires up the right `npm run bench:*` for you after download.
#
#   scripts/bench-public.sh all
#     downloads scifact + fiqa + longmemeval_s, then runs all three.
#
# Env:
#   BENCH_CACHE=<dir>  root cache directory (default: $(pwd)/.bench-cache)
#   LME_URL=<url>      override for the LongMemEval data file if the default
#                      HuggingFace resolve URL stops working.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CACHE_ROOT="${BENCH_CACHE:-${REPO_ROOT}/.bench-cache}"
BEIR_ROOT="${CACHE_ROOT}/beir"
LME_ROOT="${CACHE_ROOT}/longmemeval"

mkdir -p "${BEIR_ROOT}" "${LME_ROOT}"

BEIR_BASE="https://public.ukp.informatik.tu-darmstadt.de/thakur/BEIR/datasets"

download_beir() {
  local name="$1"
  local target="${BEIR_ROOT}/${name}"
  if [[ -f "${target}/corpus.jsonl" && -f "${target}/queries.jsonl" && -f "${target}/qrels/test.tsv" ]]; then
    echo "[beir/${name}] already extracted at ${target}"
    return 0
  fi
  local zip_path="${BEIR_ROOT}/${name}.zip"
  if [[ ! -f "${zip_path}" ]]; then
    echo "[beir/${name}] downloading from ${BEIR_BASE}/${name}.zip"
    curl -fL --progress-bar -o "${zip_path}" "${BEIR_BASE}/${name}.zip"
  fi
  echo "[beir/${name}] extracting -> ${target}"
  unzip -q -o "${zip_path}" -d "${BEIR_ROOT}"
  # Some archives extract to <name>/, others to <name>-test/. Normalise.
  if [[ ! -d "${target}" ]]; then
    local alt
    alt="$(find "${BEIR_ROOT}" -maxdepth 1 -type d -iname "${name}*" ! -path "${BEIR_ROOT}" | head -n 1)"
    if [[ -n "${alt}" && "${alt}" != "${target}" ]]; then
      mv "${alt}" "${target}"
    fi
  fi
  rm -f "${zip_path}"
  echo "[beir/${name}] ready at ${target}"
}

download_longmemeval() {
  local variant="${1:-longmemeval_s}"
  local target="${LME_ROOT}/${variant}.json"
  if [[ -f "${target}" ]]; then
    echo "[longmemeval/${variant}] already present at ${target}"
    return 0
  fi
  # The dataset was renamed upstream from `<variant>.json` to `<variant>` (no
  # extension), so try the extensionless URL first and fall back to the
  # legacy `.json` path for older commits.
  local base="https://huggingface.co/datasets/xiaowu0162/longmemeval/resolve/main"
  local default_url="${base}/${variant}"
  local legacy_url="${base}/${variant}.json"
  local url="${LME_URL:-${default_url}}"
  echo "[longmemeval/${variant}] downloading from ${url}"
  if ! curl -fL --progress-bar -o "${target}.tmp" "${url}"; then
    rm -f "${target}.tmp"
    if [[ -z "${LME_URL:-}" ]]; then
      echo "[longmemeval/${variant}] primary URL failed, retrying legacy ${legacy_url}"
      if curl -fL --progress-bar -o "${target}.tmp" "${legacy_url}"; then
        mv "${target}.tmp" "${target}"
        echo "[longmemeval/${variant}] ready at ${target}"
        return 0
      fi
      rm -f "${target}.tmp"
    fi
    cat >&2 <<EOF

ERROR: direct download failed. LongMemEval uses HuggingFace + git-lfs which
occasionally requires auth or a different path. Try one of:

  1. git-lfs clone (requires git-lfs):
       cd "${LME_ROOT}" && \\
         git lfs clone https://huggingface.co/datasets/xiaowu0162/longmemeval .

  2. Manually download the file from
       https://huggingface.co/datasets/xiaowu0162/longmemeval
     and place it at:
       ${target}

  3. Override the URL:
       LME_URL=<direct-url> scripts/bench-public.sh download ${variant}

EOF
    return 1
  fi
  mv "${target}.tmp" "${target}"
  echo "[longmemeval/${variant}] ready at ${target}"
}

cmd_download() {
  local name="$1"
  case "${name}" in
    scifact|fiqa|nfcorpus|trec-covid|hotpotqa) download_beir "${name}" ;;
    longmemeval_s|longmemeval_m|longmemeval_oracle) download_longmemeval "${name}" ;;
    *)
      echo "unknown dataset: ${name}" >&2
      exit 2
      ;;
  esac
}

cmd_run() {
  local name="$1"
  cmd_download "${name}"
  cd "${REPO_ROOT}"
  case "${name}" in
    scifact)        exec npm run -s bench:beir:scifact ;;
    fiqa)           exec npm run -s bench:beir:fiqa ;;
    nfcorpus)       exec npm run -s bench:beir -- nfcorpus ;;
    longmemeval_s)  exec npm run -s bench:longmemeval:s ;;
    *)
      echo "no bench runner wired for ${name}" >&2
      exit 2
      ;;
  esac
}

cmd_all() {
  cmd_download scifact
  cmd_download fiqa
  cmd_download longmemeval_s
  cd "${REPO_ROOT}"
  npm run -s bench:beir:scifact
  npm run -s bench:beir:fiqa
  npm run -s bench:longmemeval:s
}

cmd="${1:-}"
case "${cmd}" in
  download) shift; cmd_download "$@" ;;
  run)      shift; cmd_run "$@" ;;
  all)      shift; cmd_all "$@" ;;
  *)
    sed -n '1,/^$/p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
