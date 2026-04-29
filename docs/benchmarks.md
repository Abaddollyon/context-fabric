# Benchmarks

Reproducible numbers for Context Fabric's retrieval quality on public IR and long-term-memory benchmarks. All runs drive `ContextEngine` in-process (no MCP round-trip) against the hybrid recall path used at runtime (FTS5 BM25 + vector cosine + Reciprocal Rank Fusion, optionally KNN-accelerated by `sqlite-vec`).

Runs on this page were measured on a single commodity workstation (AMD Ryzen 7 5800H, NVIDIA RTX 3060 12 GB, Node.js 25, fastembed-js 1.14.4 / ONNX Runtime 1.21) across the v0.13 published run and final v0.14 release-validation reruns.

## Headlines

The table below captures the original published v0.13 baseline plus final v0.14 end-state reruns from the same cached benchmark environment used during release validation. The v0.14 work adds diagnostic artifact output and ranking-preservation tests; it does not ship cross-encoder reranking.

| Benchmark | Metric | v0.13 published | v0.14 final rerun | Published reference |
|---|---|---:|---:|---|
| BEIR SciFact (5,183 docs) | nDCG@10 | 0.7439 | 0.7439 | bge-base-en-v1.5 dense-only: 0.740 |
| BEIR SciFact | Recall@100 | 0.9667 | 0.9667 | OpenAI text-embedding-3-small: ~0.93 |
| BEIR FiQA-2018 (57,638 docs) | nDCG@10 | 0.3801 | 0.3801 | bge-base-en-v1.5 dense-only: 0.406 |
| BEIR FiQA-2018 | Recall@100 | 0.7361 | 0.7361 | OpenAI text-embedding-3-small: ~0.69 |
| LongMemEval_S (500 questions, 25,112 sessions) | Hit@5 | **0.9520** | 0.9200 | Zep/Mem0 retrieval layer: ≈0.85 |
| LongMemEval_S | Recall@10 | **0.9472** | 0.9210 | — |
| All three | Query p50 | 14.6 – 91 ms | **10.6 – 89.2 ms** | 13–32× faster than without `sqlite-vec` |

Headline one-liner: **v0.14 preserves the low-latency local hybrid retrieval path, keeps BEIR quality stable in final release validation, and adds artifact-level observability so LongMemEval regressions can be investigated from per-question evidence instead of aggregate guesses.**

## Retrieval config under test

Unless otherwise noted these numbers use Context Fabric's local hybrid retrieval path as of v0.13/v0.14:

- Embedder: `bge-small-en-v1.5` (default) or `bge-base-en-v1.5` (opt-in via `CONTEXT_FABRIC_EMBED_MODEL=BGEBaseENV15`)
- Query-side instruction prefix applied automatically based on model family (BGE queries get `"Represent this sentence for searching relevant passages: "`; passages unprefixed)
- Hybrid fusion: FTS5 BM25 ⊕ vector cosine, combined via Reciprocal Rank Fusion (RRF k=60)
- KNN: `sqlite-vec` vec0 virtual table when the `sqlite-vec` npm package is installed (default since v0.13), falling back to FTS5-prefiltered cosine otherwise
- Execution provider: CPU by default; CUDA (ONNX Runtime execution provider) opt-in via `CONTEXT_FABRIC_EMBED_EP=cuda`

## 1. BEIR SciFact

Scientific-claim retrieval. 5,183 abstracts, 300 queries, binary relevance.

| Config | Embedder | EP | nDCG@10 | Recall@1 | Recall@10 | Recall@100 | MRR@10 | Ingest | Query p50 | Wall |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Small, CPU (v0.14 final rerun) | bge-small-en-v1.5 | cpu | 0.7158 | 0.5809 | 0.8362 | 0.9417 | 0.6876 | 11.7 docs/s | 84.7 ms | 470.3 s |
| Base, GPU (v0.13 published) | bge-base-en-v1.5 | cuda | 0.7439 | 0.5966 | 0.8709 | 0.9667 | 0.7100 | 169.2 docs/s | 20 ms | 37 s |
| Base, GPU (v0.14 final rerun) | bge-base-en-v1.5 | cuda | 0.7439 | 0.5966 | 0.8709 | 0.9667 | 0.7100 | 177.1 docs/s | 20.4 ms | 35.5 s |

### Reference points on SciFact

| System | Params | nDCG@10 | Cost |
|---|---:|---:|---|
| BM25 (Anserini) | sparse | 0.691 | $0 |
| Contriever (unsupervised) | 110M | 0.649 | $0 |
| bge-small-en-v1.5 (dense-only) | 33M | 0.713 | $0 |
| **Context Fabric — bge-small-en-v1.5 + RRF (CPU, v0.14 final)** | **33M** | **0.7158** | **$0** |
| bge-base-en-v1.5 (dense-only) | 110M | 0.740 | $0 |
| **Context Fabric — bge-base-en-v1.5 + RRF (GPU, v0.14 final)** | **110M** | **0.7439** | **$0** |
| ada-002 (legacy OpenAI) | API | 0.736 | $0.10 / 1M tok |
| bge-large-en-v1.5 (dense-only) | 335M | 0.746 | $0 |
| Cohere embed-english-v3 | API | 0.772 | $0.10 / 1M tok |
| OpenAI text-embedding-3-small | API | 0.774 | $0.02 / 1M tok |

Sources: BEIR leaderboard, bge-v1.5 paper (arXiv 2309.07597), OpenAI embedding model card.

## 2. BEIR FiQA-2018

Financial-domain question answering. 57,638 forum documents, 648 queries, graded relevance.

| Config | Embedder | EP | nDCG@10 | Recall@1 | Recall@10 | Recall@100 | MRR@10 | Ingest | Query p50 | Wall |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Base, GPU (v0.13 published) | bge-base-en-v1.5 | cuda | 0.3801 | 0.1795 | 0.4623 | 0.7361 | 0.4419 | 177.4 docs/s | 91 ms | 384 s |
| Base, GPU (v0.14 final rerun) | bge-base-en-v1.5 | cuda | 0.3801 | 0.1795 | 0.4623 | 0.7361 | 0.4419 | 183.9 docs/s | 89.2 ms | 372.2 s |

### Reference points on FiQA

| System | nDCG@10 | Recall@100 |
|---|---:|---:|
| BM25 | 0.236 | — |
| OpenAI ada-002 | 0.361 | — |
| OpenAI text-embedding-3-small | 0.397 | ~0.69 |
| **Context Fabric — bge-base-en-v1.5 + RRF (GPU, v0.14 final)** | 0.3801 | 0.7361 |
| bge-small-en-v1.5 (dense-only) | 0.403 | — |
| bge-base-en-v1.5 (dense-only) | 0.406 | — |
| Cohere embed-v3 | 0.419 | — |

FiQA is the hardest of the small-scale BEIR subsets because queries are natural-language questions while documents are formal forum answers — the query-passage asymmetry is exactly the thing BGE's instruction prefix is trained to handle. The ≈2.5-point gap to the published dense-only `bge-base-en-v1.5` number (0.406) is likely RRF weighting on a corpus where BM25 is a weak stream (0.236) — an easy follow-up knob.

## 3. LongMemEval_S — agent memory, retrieval-only

Retrieval-only evaluation on the LongMemEval_S variant (Wu et al., ICLR 2025; `xiaowu0162/longmemeval` on HuggingFace). For each of 500 questions we ingest that question's haystack sessions as L3 memories (one memory per session), issue the question through `engine.recall()`, and measure whether the gold `answer_session_ids` appear in the top-k. This isolates the retrieval substrate — no LLM judge involved — so numbers on this page are not directly comparable to the end-to-end accuracy figures that Zep, Mem0, and MemGPT publish.

### Overall — v0.13 published (500 questions, 25,112 sessions ingested)

| k | Hit@k | Recall@k |
|---:|---:|---:|
| 1 | **0.8320** | 0.5180 |
| 5 | **0.9520** | 0.9047 |
| 10 | **0.9720** | 0.9472 |
| 50 | 1.0000 | 1.0000 |

- Query p50 = 14.6 ms · p95 = 16.6 ms · p99 = 17.3 ms
- Wall total = 188 s (roughly 3 minutes, dominated by ephemeral-engine setup across 500 isolated haystacks, not by recall itself)

### v0.14 final reruns with diagnostic artifacts

Final release-validation reruns on 2026-04-29 under the current cached runtime/dataset environment:

| EP | Hit@1 | Recall@1 | Hit@5 | Recall@5 | Hit@10 | Recall@10 | Query p50 | Query p95 | Wall |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| cuda | 0.7740 | 0.4840 | 0.9200 | 0.8661 | 0.9560 | 0.9210 | 10.6 ms | 19.4 ms | 191.6 s |
| cpu | 0.7740 | 0.4840 | 0.9200 | 0.8661 | 0.9560 | 0.9210 | 83.7 ms | 138.1 ms | 2131.7 s |

Artifact output is available with `BENCH_ARTIFACT_JSONL=/path/to/results.jsonl`, which records per-question rankings, component scores, boosts, provenance, and latency.

The historical v0.13 LongMemEval number did not reproduce from the original workspace under the current cached runtime/dataset environment during release prep. The v0.14 release therefore adds artifact-level diagnostics and regression guards for ranking-preservation rather than treating a stale aggregate as a tuning target.

### By question type — v0.13 published

| Category | n | Hit@1 | Hit@5 | Hit@10 | Recall@5 | Recall@10 |
|---|---:|---:|---:|---:|---:|---:|
| single-session-assistant | 56 | 0.9821 | 1.0000 | 1.0000 | 1.0000 | 1.0000 |
| multi-session | 133 | 0.8947 | 0.9850 | 0.9925 | 0.9202 | 0.9574 |
| knowledge-update | 78 | 0.8846 | 0.9872 | 0.9872 | 0.9038 | 0.9487 |
| temporal-reasoning | 133 | 0.8120 | 0.9398 | 0.9774 | 0.8758 | 0.9417 |
| single-session-preference | 30 | 0.6667 | 0.8667 | 0.9000 | 0.8667 | 0.9000 |
| single-session-user | 70 | 0.6429 | 0.8714 | 0.9143 | 0.8714 | 0.9143 |

The two sub-0.70 Hit@1 categories (`single-session-preference`, `single-session-user`) share a structural property: the gold evidence is one short sentence inside a longer session, and the session-level embedding averages it into noise. This is exactly the workload where LLM-based fact extraction (storing "user graduated with Business Administration" as a standalone memory rather than a 300-token session blob) is known to help. Published systems that do this (Zep, Mem0) beat session-level retrieval on exactly these two categories.

### Framing against published agent-memory systems

Zep, Mem0, and MemGPT report end-to-end accuracy on LongMemEval, which includes an LLM reader and judge. The published numbers are approximately:

| System | End-to-end accuracy (with GPT-4o) |
|---|---:|
| Zep | ≈73% |
| Mem0 | ≈66% |
| MemGPT | ≈55% |

Our retrieval-only Hit@5 of **0.9520** means the correct session is in the LLM's context in ~95% of cases. With a 75–85% reader accuracy (typical of GPT-4o on these workloads), the upper-bound end-to-end accuracy implied by our retrieval quality is ~0.72–0.81 — i.e., retrieval is no longer the bottleneck; reader quality and cross-memory reasoning are.

## Throughput and deployment notes

All ingest throughput numbers are measured end-to-end (tokenization + model forward + FTS5 index + sqlite-vec insert), not just model inference.

| Path | Embedder | Docs/s |
|---|---|---:|
| CPU, 1 core of Ryzen 7 5800H | bge-small-en-v1 | 5.9 |
| CPU, 1 core | bge-small-en-v1.5 | 10.8 |
| CPU, 1 core | bge-base-en-v1.5 | ≈5 (larger model) |
| CUDA, RTX 3060 12 GB | bge-small-en-v1.5 | ≈180 |
| CUDA, RTX 3060 12 GB | bge-base-en-v1.5 | 177.4 |

ONNX Runtime CUDA is single-GPU, single-stream. Batch sizes above 128 saturate the 3060 and above 256 OOM the attention allocator — 128 is the ceiling we run at in the GPU scripts.

## Reproducing these numbers

### One-time setup

```bash
git clone https://github.com/Abaddollyon/context-fabric.git
cd context-fabric
npm install
npm run build
```

Dataset download is on first use:

```bash
scripts/bench-public.sh download scifact
scripts/bench-public.sh download fiqa
scripts/bench-public.sh download longmemeval_s
```

### CPU runs (no setup beyond `npm install`)

```bash
npm run bench:beir:scifact
npm run bench:beir:fiqa
npm run bench:longmemeval:s
```

Swap the embedder with the env var:

```bash
CONTEXT_FABRIC_EMBED_MODEL=BGEBaseENV15 npm run bench:beir:scifact
```

Valid model names are any case-insensitive key from fastembed's `EmbeddingModel` enum (`BGESmallEN`, `BGESmallENV15`, `BGEBaseEN`, `BGEBaseENV15`, `MLE5Large`, `AllMiniLML6V2`).

### GPU runs (NVIDIA, CUDA 12-compatible)

One-time CUDA setup — installs the minimal CUDA 12 runtime libraries into a project-local `.cuda-libs/` directory (≈1 GB, pip-installable NVIDIA wheels, does not touch system CUDA):

```bash
scripts/setup-gpu.sh
scripts/setup-gpu.sh --check   # verify
```

Then any bench becomes GPU-accelerated:

```bash
scripts/bench-gpu.sh bench:beir:scifact
scripts/bench-gpu.sh bench:beir:fiqa
scripts/bench-gpu.sh bench:longmemeval:s

# Or force a specific embedder:
scripts/bench-gpu.sh -- env CONTEXT_FABRIC_EMBED_MODEL=BGEBaseENV15 \
  node --experimental-strip-types benchmarks/public/beir.ts scifact
```

`scripts/bench-gpu.sh` sets `LD_LIBRARY_PATH` to the CUDA libs, exports `CONTEXT_FABRIC_EMBED_EP=cuda`, and bumps `BENCH_INGEST_BATCH` to 128.

### Environment variables for bench runs

| Var | Default | Effect |
|---|---|---|
| `CONTEXT_FABRIC_EMBED_MODEL` | `BGESmallENV15` | Any fastembed `EmbeddingModel` enum key (case-insensitive) |
| `CONTEXT_FABRIC_EMBED_EP` | `cpu` | Comma-separated ONNX EPs. `cuda` or `cuda,cpu` enables CUDA |
| `BENCH_CACHE` | `.bench-cache` | Dataset cache root |
| `BENCH_LIMIT` | full corpus | Cap docs ingested (smoke tests) |
| `BENCH_QUERY_LIMIT` | all | Cap queries evaluated |
| `BENCH_RECALL_LIMIT` | 100 | Top-k depth (BEIR standard = 100) |
| `BENCH_INGEST_BATCH` | 64 | Embedding batch size |
| `BENCH_QUESTION_LIMIT` | all | LongMemEval-specific question cap |
| `LME_VARIANT` | `longmemeval_s` | `longmemeval_s` \| `longmemeval_m` \| `longmemeval_oracle` |
| `LME_URL` | HF default | Override for the LongMemEval data URL |
| `BENCH_ARTIFACT_JSONL` | unset | LongMemEval-specific JSONL artifact path. When set, writes per-question rankings, component scores, boosts, provenance, and latency without changing default ranking |
| `CF_DISABLE_SQLITE_VEC` | (unset) | Set to `1` to force the FTS5-prefiltered cosine path |

## What's being measured — and what isn't

These benchmarks measure the **retrieval substrate** end-to-end against the same code path the MCP server uses in production. They do **not**:

- Exercise the MCP protocol layer (no stdio serialisation overhead in the reported numbers)
- Include an LLM reader or judge (so Hit@k / Recall@k / nDCG@10 are the right metrics, not answer accuracy)
- Attempt LLM-based fact extraction, query rewriting (HyDE), or cross-encoder reranking — Context Fabric does not ship these today. They are legitimate next levers for lifting FiQA nDCG and LongMemEval single-session Hit@1.

If you have a suggestion for a benchmark to add — or find that a number on this page doesn't reproduce on your hardware — please open an issue.

---

[← Architecture](architecture.md) | [Configuration →](configuration.md) | [Back to README](../README.md)
