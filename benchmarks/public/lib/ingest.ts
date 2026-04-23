/**
 * Fast bulk ingestion into L3 for benchmarks.
 *
 * Follows the same pattern as `benchmarks/recall-latency.ts:71-89`: go through
 * the public embedder (real vectors, production code path), then bulk-insert
 * directly into `semantic_memories` inside a single transaction. FTS5 triggers
 * (`semantic_fts_insert` in `src/layers/semantic.ts:213-216`) keep the BM25
 * index in sync automatically, so the hybrid recall path is fully exercised.
 *
 * This path:
 *   - Uses `embedder.embedPassageBatch()` so passage-prefix-aware encoders
 *     (E5 family) get the correct prefix on ingest. BGE's passage prefix
 *     is empty, so this is a no-op for BGESmallEN / BGESmallENV15 /
 *     BGEBaseENV15 and behaves identically to the previous `embedBatch()`.
 *   - Skips dedup — benchmarks must ingest every doc verbatim.
 *   - Skips SmartRouter — every doc goes to L3.
 *   - Mirrors embeddings into `sqlite-vec`'s `vec_items` when the extension
 *     is loaded. Without this mirror, the in-process recall path would fall
 *     back to BM25-prefiltered cosine (O(200) JSON.parse per query) and
 *     never exercise the vec0 KNN fast path. We detect availability via the
 *     public `vecEnabled` getter on the L3 layer.
 */

import { randomUUID } from 'node:crypto';
import type { ContextEngine } from '../../../dist/engine.js';

export interface Doc {
  /** Benchmark-native document id (e.g. BEIR corpus `_id`). Stashed in
   * `metadata.bench_doc_id` so we can reverse-map after recall. */
  id: string;
  /** Full text to index (typically `title + '\n\n' + body`). */
  content: string;
  /** Optional tags — useful for per-question isolation in LongMemEval. */
  tags?: string[];
  /** Optional extra metadata (merged on top of the bench_doc_id stamp). */
  metadata?: Record<string, unknown>;
}

export interface IngestOptions {
  batchSize?: number;
  onProgress?: (done: number, total: number) => void;
  memoryType?: string;
}

export interface IngestResult {
  docs: number;
  wallMs: number;
  docsPerSec: number;
}

export async function bulkIngestL3(
  engine: ContextEngine,
  docs: Doc[],
  opts: IngestOptions = {},
): Promise<IngestResult> {
  const batchSize = opts.batchSize ?? 64;
  const memoryType = opts.memoryType ?? 'documentation';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const l3: any = engine.l3;
  const embedder = l3.getEmbeddingService();
  const db = l3.db;
  const vecEnabled: boolean = Boolean(l3.vecEnabled);
  // Direct access to the vec handle for mirroring — `vec` is typed as
  // `SqliteVecStatus` on the layer. We cast to avoid leaking the discriminant.
  const vec: { upsert?: (rowid: number, embedding: number[]) => void } =
    vecEnabled ? l3.vec : {};

  const stmt = db.prepare(`
    INSERT INTO semantic_memories
      (id, type, content, metadata, tags, embedding, created_at, updated_at, accessed_at, access_count, relevance_score, pinned)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1.0, 0)
  `);

  const start = Date.now();
  for (let i = 0; i < docs.length; i += batchSize) {
    const batch = docs.slice(i, i + batchSize);
    const texts = batch.map((d) => d.content);
    const embeddings: number[][] = await embedder.embedPassageBatch(texts);

    db.exec('BEGIN');
    try {
      for (let j = 0; j < batch.length; j++) {
        const d = batch[j];
        const now = Date.now();
        const tags = d.tags ?? [];
        const meta = {
          bench_doc_id: d.id,
          tags,
          source: 'system_auto' as const,
          ...(d.metadata ?? {}),
        };
        const result = stmt.run(
          randomUUID(),
          memoryType,
          d.content,
          JSON.stringify(meta),
          JSON.stringify(tags),
          JSON.stringify(embeddings[j]),
          now,
          now,
          now,
        );
        // Mirror into sqlite-vec when available so the recall() path hits
        // the vec0 KNN fast lane instead of the O(N) JSON.parse fallback.
        if (vecEnabled && vec.upsert) {
          const rowid = typeof result.lastInsertRowid === 'bigint'
            ? Number(result.lastInsertRowid)
            : result.lastInsertRowid;
          try { vec.upsert(rowid, embeddings[j]); } catch { /* non-fatal */ }
        }
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    opts.onProgress?.(Math.min(i + batchSize, docs.length), docs.length);
  }

  const wallMs = Date.now() - start;
  return {
    docs: docs.length,
    wallMs,
    docsPerSec: wallMs === 0 ? 0 : docs.length / (wallMs / 1000),
  };
}

/**
 * Extract the benchmark-native doc id from a ranked recall result.
 * Returns null if the memory wasn't ingested via `bulkIngestL3`.
 */
export function benchDocId(memory: { metadata?: Record<string, unknown> }): string | null {
  const id = memory?.metadata?.bench_doc_id;
  return typeof id === 'string' ? id : null;
}
