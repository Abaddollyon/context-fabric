# Benchmarks

Reproducible retrieval-quality numbers on public IR and long-term-memory benchmarks. All runs drive `ContextEngine` in-process against the same hybrid recall path used at runtime (FTS5 BM25 + vector cosine + Reciprocal Rank Fusion, optionally KNN-accelerated by `sqlite-vec`).

> Canonical version with full methodology: [`docs/benchmarks.md`](https://github.com/Abaddollyon/context-fabric/blob/main/docs/benchmarks.md)

Numbers on this page were measured on a single commodity workstation (AMD Ryzen 7 5800H, NVIDIA RTX 3060 12 GB, Node.js 25, fastembed-js 1.14.4 / ONNX Runtime 1.21) on 2026-04-23.

---

## Headlines

| Benchmark | Metric | Context Fabric (v0.13, GPU) | Published reference |
|---|---|---:|---|
| BEIR SciFact (5,183 docs) | nDCG@10 | **0.7439** | bge-base-en-v1.5 dense-only: 0.740 |
| BEIR SciFact | Recall@100 | **0.9667** | OpenAI text-embedding-3-small: ~0.93 |
| BEIR FiQA-2018 (57,638 docs) | nDCG@10 | **0.3801** | bge-base-en-v1.5 dense-only: 0.406 |
| BEIR FiQA-2018 | Recall@100 | **0.7361** | OpenAI text-embedding-3-small: ~0.69 |
| LongMemEval_S (500 questions) | Hit@5 | **0.9520** | Zep/Mem0 retrieval layer: ≈0.85 |
| LongMemEval_S | Recall@10 | **0.9472** | — |
| All three | Query p50 | **14.6 – 91 ms** | 13–32× faster than without `sqlite-vec` |

**On Recall@100 — the metric that matters for agent memory when an LLM reranks the recalled set — we match or beat OpenAI's `text-embedding-3-small` on both BEIR subsets, and our LongMemEval retrieval layer clears the published "good retrieval" threshold by ≈10 points.**

---

## Retrieval config under test

Defaults as of v0.13.0:

- Embedder: `bge-small-en-v1.5` (default) or `bge-base-en-v1.5` (opt-in via `CONTEXT_FABRIC_EMBED_MODEL=BGEBaseENV15`)
- Query-side instruction prefix applied automatically (BGE queries get `"Represent this sentence for searching relevant passages: "`; passages unprefixed)
- Hybrid fusion: FTS5 BM25 ⊕ vector cosine, combined via Reciprocal Rank Fusion (RRF k=60)
- KNN: `sqlite-vec` vec0 virtual table (default since v0.13), with FTS5-prefiltered cosine fallback
- Execution provider: CPU by default; CUDA opt-in via `CONTEXT_FABRIC_EMBED_EP=cuda`

See [Configuration](Configuration.md) for the environment variables.

---

## 1. BEIR SciFact

Scientific-claim retrieval. 5,183 abstracts, 300 queries.

| Config | Embedder | EP | nDCG@10 | Recall@10 | Recall@100 | Ingest | Query p50 |
|---|---|---|---:|---:|---:|---:|---:|
| Small, CPU | bge-small-en-v1.5 | cpu | 0.7158 | 0.8362 | 0.9417 | 10.8 docs/s | 99 ms |
| Base, GPU | bge-base-en-v1.5 | cuda | **0.7439** | **0.8709** | **0.9667** | **169.2 docs/s** | **20 ms** |

Reference points (nDCG@10): BM25 0.691, bge-small-en-v1.5 dense-only 0.713, bge-base-en-v1.5 dense-only 0.740, ada-002 0.736, Cohere embed-v3 0.772, OpenAI text-embedding-3-small 0.774.

---

## 2. BEIR FiQA-2018

Financial-domain question answering. 57,638 forum documents, 648 queries.

| Config | Embedder | EP | nDCG@10 | Recall@10 | Recall@100 | Ingest | Query p50 |
|---|---|---|---:|---:|---:|---:|---:|
| Base, GPU | bge-base-en-v1.5 | cuda | **0.3801** | **0.4623** | **0.7361** | **177.4 docs/s** | **91 ms** |

Reference points (nDCG@10): BM25 0.236, OpenAI ada-002 0.361, OpenAI text-embedding-3-small 0.397, bge-small-en-v1.5 dense-only 0.403, bge-base-en-v1.5 dense-only 0.406, Cohere embed-v3 0.419.

FiQA is the hardest small-scale BEIR subset — queries are natural-language questions, documents are formal forum answers. The ≈2.5-point gap to `bge-base-en-v1.5` dense-only is likely RRF weighting on a corpus where BM25 is a weak stream (0.236).

---

## 3. LongMemEval_S — agent memory, retrieval-only

Retrieval-only evaluation on LongMemEval_S (Wu et al., ICLR 2025). For each of 500 questions we ingest that question's haystack sessions as L3 memories, issue the question through `engine.recall()`, and measure whether the gold `answer_session_ids` appear in top-k.

### Overall (500 questions, 25,112 sessions)

| k | Hit@k | Recall@k |
|---:|---:|---:|
| 1 | **0.8320** | 0.5180 |
| 5 | **0.9520** | 0.9047 |
| 10 | **0.9720** | 0.9472 |
| 50 | 1.0000 | 1.0000 |

Query p50 = 14.6 ms · p95 = 16.6 ms · p99 = 17.3 ms · wall = 188 s.

### By question type

| Category | n | Hit@1 | Hit@5 | Hit@10 |
|---|---:|---:|---:|---:|
| single-session-assistant | 56 | 0.9821 | 1.0000 | 1.0000 |
| multi-session | 133 | 0.8947 | 0.9850 | 0.9925 |
| knowledge-update | 78 | 0.8846 | 0.9872 | 0.9872 |
| temporal-reasoning | 133 | 0.8120 | 0.9398 | 0.9774 |
| single-session-preference | 30 | 0.6667 | 0.8667 | 0.9000 |
| single-session-user | 70 | 0.6429 | 0.8714 | 0.9143 |

The two sub-0.70 Hit@1 categories share a structural property: the gold evidence is one short sentence inside a longer session, and session-level embedding averages it into noise. This is exactly the workload where LLM-based fact extraction (storing atomic facts rather than session blobs) is known to help — what Zep and Mem0 do.

### Framing against published agent-memory systems

Zep, Mem0, and MemGPT report **end-to-end accuracy** (retrieval + LLM reader + judge). Published numbers: Zep ≈73%, Mem0 ≈66%, MemGPT ≈55%.

Our retrieval-only Hit@5 of **0.9520** means the correct session is in the LLM's context ~95% of the time. With a 75–85% reader on GPT-4o-class models, the upper-bound end-to-end accuracy implied by our retrieval quality is ~0.72–0.81 — i.e., **retrieval is no longer the bottleneck; reader quality and cross-memory reasoning are.**

---

## Throughput

All ingest numbers are end-to-end (tokenization + model forward + FTS5 index + sqlite-vec insert), not just inference:

| Path | Embedder | Docs/s |
|---|---|---:|
| CPU, 1 core | bge-small-en-v1 (legacy) | 5.9 |
| CPU, 1 core | bge-small-en-v1.5 | 10.8 |
| CUDA, RTX 3060 12 GB | bge-small-en-v1.5 | ≈180 |
| CUDA, RTX 3060 12 GB | bge-base-en-v1.5 | 177.4 |

ONNX Runtime CUDA is single-GPU, single-stream. Batch sizes above 128 saturate the 3060; 128 is the ceiling we run at.

---

## Reproducing these numbers

### One-time setup

```bash
git clone https://github.com/Abaddollyon/context-fabric.git
cd context-fabric
npm install
npm run build
```

Dataset download (first use):

```bash
scripts/bench-public.sh download scifact
scripts/bench-public.sh download fiqa
scripts/bench-public.sh download longmemeval_s
```

### CPU runs

```bash
npm run bench:beir:scifact
npm run bench:beir:fiqa
npm run bench:longmemeval:s
```

Swap the embedder with the env var:

```bash
CONTEXT_FABRIC_EMBED_MODEL=BGEBaseENV15 npm run bench:beir:scifact
```

### GPU runs (NVIDIA, CUDA 12)

One-time CUDA setup — installs CUDA 12 runtime libs into a project-local `.cuda-libs/` via pip wheels (≈1 GB, does not touch system CUDA):

```bash
scripts/setup-gpu.sh
scripts/setup-gpu.sh --check
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

---

## What's measured — and what isn't

These benchmarks exercise the **retrieval substrate** end-to-end, against the same code path the MCP server uses in production. They do **not**:

- Exercise the MCP protocol layer (no stdio serialisation in reported numbers)
- Include an LLM reader or judge (Hit@k / Recall@k / nDCG@10 are the right metrics here, not answer accuracy)
- Attempt LLM-based fact extraction, query rewriting (HyDE), or cross-encoder reranking — not shipped today; legitimate next levers for lifting FiQA nDCG and LongMemEval single-session Hit@1.

Found a number that doesn't reproduce on your hardware, or have a benchmark to suggest? Open an issue.
