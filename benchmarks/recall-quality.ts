/**
 * v0.12 Recall quality harness.
 *
 * Seeds a synthetic L3 with N golden facts + M distractor memories, then runs
 * a fixed query set and reports recall@k and MRR. Lets us know whether
 * subsequent retrieval changes (FTS5 tweaks, reranker, MMR) move quality the
 * right way.
 *
 * Run: `npx tsx benchmarks/recall-quality.ts` (or compiled: `node dist/benchmarks/recall-quality.js`).
 */
import { ContextEngine } from '../src/engine.js';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

interface GoldenPair {
  query: string;
  expectedContentContains: string;
}

// 20 hand-picked Q/A pairs covering different memory types. Each answer must
// be uniquely identifiable by a substring so scoring is deterministic.
const GOLDEN: GoldenPair[] = [
  { query: 'what database does the project use', expectedContentContains: 'SQLite is the storage engine' },
  { query: 'which embedding model', expectedContentContains: 'bge-small-en via fastembed' },
  { query: 'how is L3 scoped', expectedContentContains: 'L3 semantic memory is global' },
  { query: 'pattern for handling async errors', expectedContentContains: 'try/catch inside async functions' },
  { query: 'authentication strategy', expectedContentContains: 'JWT with refresh tokens' },
  { query: 'logging library', expectedContentContains: 'structured logger emits JSON' },
  { query: 'how to run tests', expectedContentContains: 'npm test runs vitest' },
  { query: 'file watcher debounce', expectedContentContains: 'file watcher debounce is 500ms' },
  { query: 'max file size for code index', expectedContentContains: 'max file size is 1 MB' },
  { query: 'how is decay computed', expectedContentContains: 'exponential decay over 14 days' },
  { query: 'backup strategy', expectedContentContains: 'VACUUM INTO creates snapshots' },
  { query: 'shutdown sequence', expectedContentContains: 'SIGTERM triggers graceful drain' },
  { query: 'how to pin a memory', expectedContentContains: 'pinned: true exempts from decay' },
  { query: 'recall pagination', expectedContentContains: 'offset and limit on context.recall' },
  { query: 'provenance fields', expectedContentContains: 'sessionId eventId filePath commitSha' },
  { query: 'dedup threshold', expectedContentContains: 'cosine 0.95 default' },
  { query: 'bi-temporal supersession', expectedContentContains: 'valid_until nulls mean current' },
  { query: 'how to invoke a skill', expectedContentContains: 'context.skill.invoke bumps count' },
  { query: 'resource URI pattern for skills', expectedContentContains: 'memory://skill/{slug}' },
  { query: 'import docs default list', expectedContentContains: 'CLAUDE.md AGENTS.md README CHANGELOG' },
];

function makeDistractor(i: number): string {
  const topics = ['auth', 'db', 'ui', 'ci', 'docs', 'perf', 'logging', 'fs', 'net', 'cache'];
  const t = topics[i % topics.length];
  return `Note ${i}: random ${t} observation without any of the golden answers.`;
}

async function seed(engine: ContextEngine, distractors: number): Promise<void> {
  for (const g of GOLDEN) {
    await engine.store(g.expectedContentContains, 'code_pattern', {
      targetLayer: 'L3' as const,
      tags: ['golden'],
    });
  }
  for (let i = 0; i < distractors; i++) {
    await engine.store(makeDistractor(i), 'code_pattern', {
      targetLayer: 'L3' as const,
      tags: ['distractor'],
    });
  }
}

async function score(engine: ContextEngine, k: number): Promise<{ recallAtK: number; mrr: number; misses: string[] }> {
  let hits = 0;
  let reciprocalRankSum = 0;
  const misses: string[] = [];
  for (const g of GOLDEN) {
    const res = await engine.recall(g.query, { limit: k, mode: 'hybrid' });
    let rank = -1;
    for (let i = 0; i < res.length; i++) {
      if (res[i].content.includes(g.expectedContentContains)) {
        rank = i;
        break;
      }
    }
    if (rank >= 0) {
      hits++;
      reciprocalRankSum += 1 / (rank + 1);
    } else {
      misses.push(g.query);
    }
  }
  return {
    recallAtK: hits / GOLDEN.length,
    mrr: reciprocalRankSum / GOLDEN.length,
    misses,
  };
}

async function main(): Promise<void> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-quality-'));
  process.env.CONTEXT_FABRIC_HOME = path.join(tmpDir, '.cf');

  const sizes = [0, 100, 1000];
  const ks = [1, 5, 10];

  // eslint-disable-next-line no-console
  console.log(`# Recall Quality Benchmark\nGolden queries: ${GOLDEN.length}\n`);
  for (const distractors of sizes) {
    const engine = new ContextEngine({
      projectPath: tmpDir,
      autoCleanup: false,
      logLevel: 'error',
    });
    // eslint-disable-next-line no-console
    console.log(`\n## Distractors: ${distractors}`);
    const seedStart = Date.now();
    await seed(engine, distractors);
    // eslint-disable-next-line no-console
    console.log(`seed time: ${((Date.now() - seedStart) / 1000).toFixed(2)}s`);
    for (const k of ks) {
      const { recallAtK, mrr, misses } = await score(engine, k);
      // eslint-disable-next-line no-console
      console.log(`  k=${k}  recall@k=${(recallAtK * 100).toFixed(1)}%  MRR=${mrr.toFixed(3)}  misses=${misses.length}`);
    }
    engine.close();
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });
}

main().catch(err => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
