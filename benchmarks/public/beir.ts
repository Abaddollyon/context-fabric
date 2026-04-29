/**
 * BEIR retrieval benchmark (parameterized: `scifact`, `fiqa`, `nfcorpus`, ...).
 *
 * Runs Context Fabric's L3 hybrid recall against a BEIR dataset and reports
 * nDCG@10, Recall@{1,10,100}, MRR@10 + per-query latency. Numbers are directly
 * comparable to the BEIR leaderboard (https://github.com/beir-cellar/beir).
 *
 * This bench DOES NOT use the MCP server — it drives `ContextEngine` in-process
 * so we can isolate the retrieval stack from MCP transport overhead.
 *
 * Usage:
 *   # 1. Download the dataset (once)
 *   ./scripts/bench-public.sh download scifact
 *
 *   # 2. Run the bench
 *   npm run bench:beir:scifact           # → benchmarks/public/beir.ts scifact
 *   npm run bench:beir:fiqa              # → benchmarks/public/beir.ts fiqa
 *
 * Tunables via env:
 *   BENCH_CACHE=<dir>          # root for extracted datasets (default .bench-cache)
 *   BENCH_INGEST_BATCH=<n>     # embed batch size (default 64)
 *   BENCH_LIMIT=<n>            # max docs to ingest (default: full corpus)
 *   BENCH_RECALL_LIMIT=<n>     # recall top-k depth (default 100)
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { performance } from 'node:perf_hooks';

import { ContextEngine } from '../../dist/engine.js';
import { MemoryLayer } from '../../dist/types.js';

import { loadBeir } from './lib/beir.ts';
import { bulkIngestL3, benchDocId, type Doc } from './lib/ingest.ts';
import { ndcgAtK, recallAtK, mrrAtK, percentile } from './lib/metrics.ts';

const DATASET = (process.argv[2] ?? process.env.BEIR_DATASET ?? 'scifact').toLowerCase();
const CACHE_ROOT = process.env.BENCH_CACHE ?? path.resolve('.bench-cache');
const DATASET_DIR = path.join(CACHE_ROOT, 'beir', DATASET);
const INGEST_BATCH = intEnv('BENCH_INGEST_BATCH', 64);
const INGEST_LIMIT = intEnv('BENCH_LIMIT', 0) || Infinity;
const QUERY_LIMIT = intEnv('BENCH_QUERY_LIMIT', 0) || Infinity;
const RECALL_LIMIT = intEnv('BENCH_RECALL_LIMIT', 100);

function intEnv(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

async function main(): Promise<void> {
  const t0 = performance.now();
  const ds = loadBeir(DATASET_DIR, DATASET);

  console.log(`# BEIR ${DATASET}`);
  console.log('');
  console.log(`- Corpus:  ${ds.corpus.size.toLocaleString()} docs`);
  console.log(`- Queries: ${ds.queries.size.toLocaleString()} (with qrels)`);
  console.log(`- Recall depth: ${RECALL_LIMIT}`);
  console.log(`- Embed batch: ${INGEST_BATCH}`);
  console.log('');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `cf-beir-${DATASET}-`));
  process.env.CONTEXT_FABRIC_HOME = path.join(tmpDir, '.cf');
  fs.mkdirSync(process.env.CONTEXT_FABRIC_HOME, { recursive: true });

  const engine = new ContextEngine({
    projectPath: tmpDir,
    autoCleanup: false,
    logLevel: 'error',
    isEphemeral: true,
  });

  try {
    const docs: Doc[] = [];
    let i = 0;
    for (const [id, { title, text }] of ds.corpus) {
      if (i++ >= INGEST_LIMIT) break;
      const content = title ? `${title}\n\n${text}` : text;
      if (!content.trim()) continue;
      docs.push({ id, content });
    }

    console.log(`Ingesting ${docs.length.toLocaleString()} docs…`);
    const result = await bulkIngestL3(engine, docs, {
      batchSize: INGEST_BATCH,
      onProgress: (done, total) => {
        if (done % 1024 === 0 || done === total) {
          process.stdout.write(`  ${done.toLocaleString()}/${total.toLocaleString()} (${(
            (done / total) * 100
          ).toFixed(1)}%)\r`);
        }
      },
    });
    console.log('');
    console.log(
      `Ingest: ${(result.wallMs / 1000).toFixed(1)}s  (${result.docsPerSec.toFixed(1)} docs/s)`,
    );
    console.log('');

    // Warm up: first recall() pays the model-init tax for query embeddings.
    const firstQuery = [...ds.queries.values()][0] ?? 'warmup';
    await engine.recall(firstQuery, { limit: 1, mode: 'hybrid', layers: [MemoryLayer.L3_SEMANTIC] });

    console.log(`Evaluating ${Math.min(ds.queries.size, QUERY_LIMIT).toLocaleString()} queries…`);

    let n = 0;
    let ndcg10 = 0;
    let mrr10 = 0;
    const recallSums: Record<number, number> = { 1: 0, 10: 0, 100: 0 };
    const latencies: number[] = [];
    const missingBenchId: string[] = [];

    for (const [qid, q] of ds.queries) {
      if (n >= QUERY_LIMIT) break;
      const rels = ds.qrels.get(qid);
      if (!rels || rels.size === 0) continue;

      const t1 = performance.now();
      const hits = await engine.recall(q, {
        limit: RECALL_LIMIT,
        mode: 'hybrid',
        layers: [MemoryLayer.L3_SEMANTIC],
      });
      latencies.push(performance.now() - t1);

      const ranking: string[] = [];
      for (const h of hits) {
        const id = benchDocId(h);
        if (id) ranking.push(id);
        else missingBenchId.push(h.id);
      }

      ndcg10 += ndcgAtK(ranking, rels, 10);
      mrr10 += mrrAtK(ranking, rels, 10);
      for (const k of Object.keys(recallSums).map(Number)) {
        recallSums[k] += recallAtK(ranking, rels, k);
      }
      n++;
    }

    const sortedLat = [...latencies].sort((a, b) => a - b);

    console.log('');
    console.log(`## Results — BEIR ${DATASET} (n=${n})`);
    console.log('');
    console.log('| Metric            | Score          |');
    console.log('|-------------------|----------------|');
    console.log(`| nDCG@10           | ${(ndcg10 / n).toFixed(4)} |`);
    console.log(`| Recall@1          | ${(recallSums[1] / n).toFixed(4)} |`);
    console.log(`| Recall@10         | ${(recallSums[10] / n).toFixed(4)} |`);
    console.log(`| Recall@100        | ${(recallSums[100] / n).toFixed(4)} |`);
    console.log(`| MRR@10            | ${(mrr10 / n).toFixed(4)} |`);
    console.log(`| Query p50 (ms)    | ${percentile(sortedLat, 0.5).toFixed(1)} |`);
    console.log(`| Query p95 (ms)    | ${percentile(sortedLat, 0.95).toFixed(1)} |`);
    console.log(`| Query p99 (ms)    | ${percentile(sortedLat, 0.99).toFixed(1)} |`);
    console.log(`| Ingest docs/s     | ${result.docsPerSec.toFixed(1)} |`);
    console.log(`| Wall total (s)    | ${((performance.now() - t0) / 1000).toFixed(1)} |`);
    console.log('');

    if (missingBenchId.length > 0) {
      console.log(
        `Note: ${missingBenchId.length} recall hits had no bench_doc_id — ` +
        'indicates leakage from a prior run or test data in the engine.',
      );
    }

    console.log('## Reference baselines on BEIR');
    console.log('');
    console.log('| System                              | nDCG@10 (SciFact) | nDCG@10 (FiQA) |');
    console.log('|-------------------------------------|-------------------|----------------|');
    console.log('| BM25 (Anserini)                     | 0.691             | 0.236          |');
    console.log('| Contriever (unsup)                  | 0.649             | 0.245          |');
    console.log('| bge-small-en-v1.5 (dense only)      | 0.713             | 0.403          |');
    console.log('| bge-base-en-v1.5 (dense only)       | 0.740             | 0.406          |');
    console.log('| text-embedding-3-small (OpenAI)     | 0.774             | 0.397          |');
    console.log('| Cohere embed-v3                     | 0.772             | 0.419          |');
    console.log('');
    console.log('Sources: BEIR leaderboard (https://github.com/beir-cellar/beir)');
    console.log('        + bge-v1.5 paper (https://arxiv.org/abs/2309.07597)');
  } finally {
    engine.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
