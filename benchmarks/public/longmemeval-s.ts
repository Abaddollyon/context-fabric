/**
 * LongMemEval retrieval-only benchmark (variant: `longmemeval_s`).
 *
 * Paper: "LongMemEval: Benchmarking Chat Assistants on Long-Term Interactive
 *         Memory" — Wu et al., ICLR 2025 (arXiv 2410.10813)
 * Data:  https://huggingface.co/datasets/xiaowu0162/longmemeval
 *
 * What we measure
 * ---------------
 * For each question, ingest its haystack sessions as L3 memories (one memory
 * per session, turns concatenated), then recall with the question text and
 * check whether the `answer_session_ids` (gold evidence) appear in the top-k.
 * This isolates the *retrieval substrate* — no LLM judge needed.
 *
 * Metrics reported, overall and broken down by `question_type`:
 *   - Hit@k   (fraction of questions whose top-k contains at least one gold session)
 *   - Recall@k (fraction of gold sessions retrieved in top-k)
 *
 * The published systems (Zep, Mem0, MemGPT, LangMem) all report answer
 * accuracy on LongMemEval — which is end-to-end (requires an LLM) and
 * therefore not apples-to-apples with these retrieval numbers. The retrieval
 * stage is nevertheless the component they primarily compete on under the
 * hood, so strong retrieval here is a necessary condition for end-to-end
 * competitiveness.
 *
 * Usage:
 *   ./scripts/bench-public.sh download longmemeval_s
 *   npm run bench:longmemeval:s
 *
 * Tunables via env:
 *   BENCH_CACHE=<dir>          # dataset cache root (default .bench-cache)
 *   LME_VARIANT=<name>         # longmemeval_s (default), longmemeval_m, longmemeval_oracle
 *   BENCH_QUESTION_LIMIT=<n>   # limit questions (default all)
 *   BENCH_INGEST_BATCH=<n>     # embed batch size (default 64)
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { performance } from 'node:perf_hooks';

import { ContextEngine } from '../../dist/engine.js';
import { MemoryLayer } from '../../dist/types.js';
import type { ScoringProfileName } from '../../src/retrieval-quality.js';

import {
  loadLongMemEval,
  renderSession,
  groupByType,
  type LmeQuestion,
} from './lib/longmemeval.ts';
import { bulkIngestL3, benchDocId, type Doc } from './lib/ingest.ts';
import { hitAtK, recallAtK, percentile } from './lib/metrics.ts';
import { writePerQuestionArtifact, type PerQuestionArtifactCandidate } from './lib/artifacts.ts';

const VARIANT = process.env.LME_VARIANT ?? 'longmemeval_s';
const CACHE_ROOT = process.env.BENCH_CACHE ?? path.resolve('.bench-cache');
const DATA_FILE = path.join(CACHE_ROOT, 'longmemeval', `${VARIANT}.json`);
const INGEST_BATCH = intEnv('BENCH_INGEST_BATCH', 64);
const QUESTION_LIMIT = intEnv('BENCH_QUESTION_LIMIT', 0) || Infinity;
const ARTIFACT_JSONL = process.env.BENCH_ARTIFACT_JSONL;
const SCORING_PROFILE = resolveLongMemEvalScoringProfile({
  artifactJsonl: ARTIFACT_JSONL,
  scoringProfile: process.env.BENCH_SCORING_PROFILE,
});

const KS = [1, 5, 10, 50];

function intEnv(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function resolveLongMemEvalScoringProfile(input: {
  artifactJsonl?: string;
  scoringProfile?: string;
}): ScoringProfileName | undefined {
  switch (input.scoringProfile) {
    case undefined:
    case '':
      return undefined;
    case 'default':
    case 'benchmark':
    case 'code':
    case 'temporal':
    case 'preference':
      return input.scoringProfile;
    default:
      throw new Error(`Unsupported BENCH_SCORING_PROFILE: ${input.scoringProfile}`);
  }
}

interface PerQuestionMetric {
  question_type: string;
  hits: Record<number, number>;
  recalls: Record<number, number>;
  latencyMs: number;
  sessions: number;
  question_id: string;
  question: string;
  answer_session_ids: string[];
  ranking: string[];
  topCandidates: PerQuestionArtifactCandidate[];
}

async function runOne(q: LmeQuestion, tmpRoot: string): Promise<PerQuestionMetric> {
  // Fresh ephemeral engine per question → honest haystack isolation.
  const projectPath = fs.mkdtempSync(path.join(tmpRoot, 'q-'));
  process.env.CONTEXT_FABRIC_HOME = path.join(projectPath, '.cf');
  fs.mkdirSync(process.env.CONTEXT_FABRIC_HOME, { recursive: true });

  const engine = new ContextEngine({
    projectPath,
    autoCleanup: false,
    logLevel: 'error',
    isEphemeral: true,
  });

  try {
    // One Doc per haystack session. bench_doc_id = session_id so we can
    // recover the rank of the gold sessions after recall().
    const docs: Doc[] = q.haystack_sessions.map((turns, i) => ({
      id: q.haystack_session_ids[i],
      content: renderSession(turns, q.haystack_dates?.[i]),
    }));

    await bulkIngestL3(engine, docs, { batchSize: INGEST_BATCH });

    const t0 = performance.now();
    const hits = await engine.recall(q.question, {
      limit: Math.max(...KS),
      mode: 'hybrid',
      layers: [MemoryLayer.L3_SEMANTIC],
      explain: Boolean(ARTIFACT_JSONL),
      scoringProfile: SCORING_PROFILE,
    });
    const latencyMs = performance.now() - t0;

    const ranking: string[] = [];
    const topCandidates: PerQuestionArtifactCandidate[] = [];
    for (const h of hits) {
      const id = benchDocId(h);
      if (id) ranking.push(id);
      topCandidates.push({
        memoryId: h.id,
        benchDocId: id,
        similarity: h.similarity,
        componentScores: h.explanation?.componentScores as Record<string, unknown> | undefined,
        representationKind: h.explanation?.representationKind ?? (h.metadata?.representation as { kind?: string } | undefined)?.kind,
        sourceSpan: h.explanation?.provenance?.sourceSpan,
        provenance: h.explanation?.provenance as Record<string, unknown> | undefined,
        boosts: h.explanation?.boosts,
      });
    }

    // Build a rel map where each gold session has relevance 1.
    const rels = new Map<string, number>();
    for (const sid of q.answer_session_ids) rels.set(sid, 1);

    const hitsMap: Record<number, number> = {};
    const recallMap: Record<number, number> = {};
    for (const k of KS) {
      hitsMap[k] = hitAtK(ranking, rels, k);
      recallMap[k] = recallAtK(ranking, rels, k);
    }

    const metric = {
      question_type: q.question_type,
      hits: hitsMap,
      recalls: recallMap,
      latencyMs,
      sessions: docs.length,
      question_id: q.question_id,
      question: q.question,
      answer_session_ids: q.answer_session_ids,
      ranking,
      topCandidates,
    };

    if (ARTIFACT_JSONL) {
      writePerQuestionArtifact(ARTIFACT_JSONL, metric);
    }

    return metric;
  } finally {
    engine.close();
    fs.rmSync(projectPath, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const tStart = performance.now();

  const all = loadLongMemEval(DATA_FILE);
  const questions = all
    .filter((q) => q.answer_session_ids && q.answer_session_ids.length > 0)
    .slice(0, Number.isFinite(QUESTION_LIMIT) ? QUESTION_LIMIT : undefined);

  console.log(`# LongMemEval — ${VARIANT} (retrieval-only)`);
  console.log('');
  console.log(`- Questions evaluated: ${questions.length.toLocaleString()}`);
  console.log(`- (Excluded: abstention questions with no gold sessions)`);
  console.log(
    `- Types: ${[...groupByType(questions).keys()].join(', ')}`,
  );
  console.log('');

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), `cf-lme-${VARIANT}-`));

  const perType = new Map<string, PerQuestionMetric[]>();
  const latencies: number[] = [];
  let totalSessions = 0;

  try {
    let i = 0;
    for (const q of questions) {
      const m = await runOne(q, tmpRoot);
      const arr = perType.get(m.question_type) ?? [];
      arr.push(m);
      perType.set(m.question_type, arr);
      latencies.push(m.latencyMs);
      totalSessions += m.sessions;
      i++;
      if (i % 10 === 0 || i === questions.length) {
        process.stdout.write(
          `  ${i}/${questions.length}  sessions so far: ${totalSessions}\r`,
        );
      }
    }
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  console.log('');
  console.log('');

  // Aggregate overall
  const overall = aggregate([...perType.values()].flat());
  const sortedLat = [...latencies].sort((a, b) => a - b);

  console.log(`## Overall — ${overall.n} questions`);
  console.log('');
  console.log('| k   | Hit@k  | Recall@k |');
  console.log('|-----|--------|----------|');
  for (const k of KS) {
    console.log(
      `| ${String(k).padEnd(3)} | ${overall.hits[k].toFixed(4)} | ${overall.recalls[k].toFixed(4)}   |`,
    );
  }
  console.log('');
  console.log(`Query p50: ${percentile(sortedLat, 0.5).toFixed(1)} ms`);
  console.log(`Query p95: ${percentile(sortedLat, 0.95).toFixed(1)} ms`);
  console.log(`Query p99: ${percentile(sortedLat, 0.99).toFixed(1)} ms`);
  console.log(`Total sessions ingested: ${totalSessions.toLocaleString()}`);
  console.log(`Wall total: ${((performance.now() - tStart) / 1000).toFixed(1)} s`);
  console.log('');

  console.log('## By question type');
  console.log('');
  console.log(
    '| Question type            |   n | Hit@1  | Hit@5  | Hit@10 | Recall@5 | Recall@10 |',
  );
  console.log(
    '|--------------------------|-----|--------|--------|--------|----------|-----------|',
  );
  for (const [qtype, arr] of [...perType.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const agg = aggregate(arr);
    console.log(
      `| ${qtype.padEnd(24)} | ${String(agg.n).padStart(3)} | ${agg.hits[1].toFixed(4)} | ${agg.hits[5].toFixed(4)} | ${agg.hits[10].toFixed(4)} | ${agg.recalls[5].toFixed(4)}   | ${agg.recalls[10].toFixed(4)}    |`,
    );
  }
  console.log('');
  console.log(
    'Reference: Zep (paper, 2024) reports end-to-end accuracy ≈73% on LongMemEval with GPT-4o;',
  );
  console.log(
    '           Mem0 ≈66%; MemGPT ≈55%. Those numbers include an LLM reader —',
  );
  console.log(
    '           this bench isolates retrieval, so numbers should not be compared directly.',
  );
}

function aggregate(samples: PerQuestionMetric[]): {
  n: number;
  hits: Record<number, number>;
  recalls: Record<number, number>;
} {
  const hits: Record<number, number> = {};
  const recalls: Record<number, number> = {};
  for (const k of KS) {
    hits[k] = 0;
    recalls[k] = 0;
  }
  for (const s of samples) {
    for (const k of KS) {
      hits[k] += s.hits[k];
      recalls[k] += s.recalls[k];
    }
  }
  const n = samples.length || 1;
  for (const k of KS) {
    hits[k] /= n;
    recalls[k] /= n;
  }
  return { n: samples.length, hits, recalls };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
