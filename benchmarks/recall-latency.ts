/**
 * v0.8 recall-latency microbenchmark.
 *
 * Compares pure-semantic recall() (full-scan) against recallPrefiltered()
 * (FTS5 candidate pool → cosine) across a synthetic L3 at different sizes.
 *
 * To avoid the cost of running the real embedder on every seed row, this
 * bench injects synthetic 384-dim unit vectors directly via the internal
 * SQLite handle. FTS5 content is real tokens so the BM25 prefilter path is
 * exercised identically to production. Queries use a real embedding.
 *
 * Usage:
 *   npm run build
 *   node --experimental-sqlite dist/../benchmarks/recall-latency.js
 *   # or: npm run bench
 *
 * Output: markdown table printed to stdout.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { SemanticMemoryLayer } from '../dist/layers/semantic.js';

const HAS_MODEL = existsSync(resolve('local_cache', 'fast-bge-small-en-v1.5', 'tokenizer.json'));
if (!HAS_MODEL) {
  console.error('Embedding model cache not found — skipping bench.');
  process.exit(0);
}

const DIM = 384; // bge-small-en
const SIZES = [1_000, 10_000];
const ITERATIONS = 20;
const LIMIT = 10;

// Deterministic pseudo-random so runs are comparable.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomUnit(rand: () => number): Float32Array {
  const v = new Float32Array(DIM);
  let n = 0;
  for (let i = 0; i < DIM; i++) { v[i] = rand() * 2 - 1; n += v[i] * v[i]; }
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < DIM; i++) v[i] /= n;
  return v;
}

const VOCAB = [
  'authentication', 'validation', 'migration', 'schema', 'query', 'pipeline',
  'config', 'retry', 'cache', 'index', 'embedding', 'vector', 'cosine',
  'project', 'memory', 'session', 'layer', 'server', 'client', 'request',
  'response', 'timeout', 'error', 'handler', 'route', 'token', 'document',
  'similarity', 'ranker', 'fusion', 'keyword', 'semantic', 'hybrid',
];

function randomContent(rand: () => number): string {
  const words: string[] = [];
  const n = 6 + Math.floor(rand() * 14);
  for (let i = 0; i < n; i++) words.push(VOCAB[Math.floor(rand() * VOCAB.length)]);
  return words.join(' ');
}

async function seed(layer: SemanticMemoryLayer, n: number): Promise<void> {
  const rand = mulberry32(42);
  const db: any = (layer as any).db;
  const stmt = db.prepare(`
    INSERT INTO semantic_memories
      (id, type, content, metadata, tags, embedding, created_at, updated_at, accessed_at, access_count, relevance_score, pinned)
    VALUES (?, 'observation', ?, '{}', '[]', ?, ?, ?, ?, 0, 1.0, 0)
  `);
  const now = Date.now();
  db.exec('BEGIN');
  for (let i = 0; i < n; i++) {
    const id = `bench-${i}`;
    const content = randomContent(rand);
    const vec = randomUnit(rand);
    const embedding = JSON.stringify(Array.from(vec));
    stmt.run(id, content, embedding, now, now, now);
  }
  db.exec('COMMIT');
}

function summarize(samples: number[]): { p50: number; p95: number; mean: number } {
  const sorted = [...samples].sort((a, b) => a - b);
  const p = (q: number) => sorted[Math.max(0, Math.floor(sorted.length * q) - 1)] ?? 0;
  const mean = samples.reduce((s, v) => s + v, 0) / samples.length;
  return { p50: p(0.5), p95: p(0.95), mean };
}

async function benchOne(size: number): Promise<{ size: number; fullMs: ReturnType<typeof summarize>; preMs: ReturnType<typeof summarize> }> {
  const layer = new SemanticMemoryLayer({ isEphemeral: true });
  await seed(layer, size);

  // One real embed to warm up the model.
  await layer.recall('pipeline config retry', 1);

  const fullSamples: number[] = [];
  const preSamples: number[] = [];
  const queries = ['authentication token', 'embedding cosine similarity', 'migration schema error', 'session handler timeout'];

  for (let i = 0; i < ITERATIONS; i++) {
    const q = queries[i % queries.length];

    const t1 = performance.now();
    await layer.recall(q, LIMIT);
    fullSamples.push(performance.now() - t1);

    const t2 = performance.now();
    await layer.recallPrefiltered(q, LIMIT);
    preSamples.push(performance.now() - t2);
  }

  layer.close();
  return { size, fullMs: summarize(fullSamples), preMs: summarize(preSamples) };
}

async function main() {
  console.log('# L3 recall latency — v0.8');
  console.log('');
  console.log(`Iterations: ${ITERATIONS}, Limit: ${LIMIT}, Dim: ${DIM}`);
  console.log('');
  console.log('| Size | recall() p50 (ms) | recall() p95 (ms) | recallPrefiltered() p50 (ms) | recallPrefiltered() p95 (ms) | speedup (p50) |');
  console.log('|------|-------------------|-------------------|------------------------------|------------------------------|---------------|');
  for (const size of SIZES) {
    const r = await benchOne(size);
    const speedup = (r.fullMs.p50 / Math.max(r.preMs.p50, 0.0001)).toFixed(1);
    console.log(
      `| ${r.size.toLocaleString()} | ${r.fullMs.p50.toFixed(1)} | ${r.fullMs.p95.toFixed(1)} | ${r.preMs.p50.toFixed(1)} | ${r.preMs.p95.toFixed(1)} | ${speedup}x |`,
    );
  }
  console.log('');
  console.log('Roadmap target: recall < 100ms at 10K. Measured on the machine running this bench.');
}

main().catch((err) => { console.error(err); process.exit(1); });
