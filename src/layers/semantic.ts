// L3: Semantic Memory
// - SQLite for self-contained vector storage (no external server)
// - Cross-project (global)
// - Semantic similarity search via cosine similarity
// - Decay-based soft deletion
// - Embeddings via fastembed-js
//
// Uses node:sqlite (built-in since Node.js 22.5 — zero native dependencies)

import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { Memory, MemoryType, MemoryMetadata, RelationshipEdge } from '../types.js';
import { EmbeddingService } from '../embedding.js';
import { sanitizeFTS5Query } from '../fts5.js';
import { warnIfCorrupted } from '../db-integrity.js';
import { tryLoadSqliteVec, type SqliteVecStatus } from '../sqlite-vec.js';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';

export interface ScoredMemory extends Memory {
  similarity: number;
}

interface SemanticMemoryOptions {
  baseDir?: string;
  decayDays?: number;
  decayThreshold?: number; // relevance score below which a memory is deleted (default: 0.2)
  embeddingTimeoutMs?: number; // max ms for a single embed call (default: 30000)
  collectionName?: string; // kept for API compat, unused
  isEphemeral?: boolean;   // if true, use in-memory SQLite
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * L3 Semantic Memory — cross-project vector store backed by SQLite.
 * Stores embeddings alongside memories and performs cosine-similarity
 * recall at query time. Includes a time-based decay mechanism that
 * gradually removes stale, unaccessed memories.
 */
export class SemanticMemoryLayer {
  private db: DatabaseSync;
  private embedder: EmbeddingService;
  private decayDays: number;
  private decayThreshold: number;
  /** v0.8: sqlite-vec handle — loaded iff the optional extension is present. */
  private vec: SqliteVecStatus;
  /**
   * Embedding dimension, taken from the active embedder at construction time.
   * Default bge-small-en = 384, bge-base-en-v1.5 = 768, etc.
   * Baked into the sqlite-vec virtual table — switching models requires a
   * fresh L3 DB.
   */
  private readonly embeddingDim: number;

  // Prepared statements
  private stmtInsert!: StatementSync;
  private stmtGetById!: StatementSync;
  private stmtGetAll!: StatementSync;
  private stmtGetAllExcept!: StatementSync;
  private stmtUpdateAccess!: StatementSync;
  private stmtUpdateScore!: StatementSync;
  private stmtDelete!: StatementSync;
  private stmtCount!: StatementSync;
  private stmtGetEmbedding!: StatementSync;
  private stmtGetAllPaginated!: StatementSync;
  private stmtUpdateFull!: StatementSync;
  private stmtFindByType!: StatementSync;
  private stmtCountByType!: StatementSync;
  private stmtSetPinned!: StatementSync;
  private stmtCountPinned!: StatementSync;
  private stmtSearchBM25!: StatementSync;
  /** Cached prepared statements for tag queries, keyed by tag arity. */
  private stmtFindByTagsCache = new Map<number, StatementSync>();
  private stmtCountByTagsCache = new Map<number, StatementSync>();

  constructor(options: SemanticMemoryOptions = {}) {
    this.decayDays = options.decayDays ?? 14;
    this.decayThreshold = options.decayThreshold ?? 0.2;

    if (options.isEphemeral) {
      this.db = new DatabaseSync(':memory:', { allowExtension: true });
    } else {
      const baseDir = options.baseDir ?? path.join(process.cwd(), '.semantic-memory');
      fs.mkdirSync(baseDir, { recursive: true });
      const dbPath = path.join(baseDir, 'semantic.db');
      this.db = new DatabaseSync(dbPath, { allowExtension: true });
      // v0.8: startup integrity check — warn (don't fail) on corruption.
      warnIfCorrupted(this.db, 'L3:semantic');
    }

    this.initSchema();
    this.prepareStatements();
    // Instantiate the embedder first so we can honor its dimension when
    // creating the optional sqlite-vec virtual table. getDimension() is
    // synchronous and does not require model init.
    this.embedder = new EmbeddingService(undefined, options.embeddingTimeoutMs ?? 30_000);
    this.embeddingDim = this.embedder.getDimension();
    // v0.8: attempt optional sqlite-vec acceleration. Non-fatal on any failure.
    this.vec = tryLoadSqliteVec(this.db, this.embeddingDim);
    if (this.vec.loaded) {
      this.backfillVecIndex();
    }
  }

  /** v0.8: whether sqlite-vec was successfully loaded on this instance. */
  get vecEnabled(): boolean {
    return this.vec.loaded;
  }

  /**
   * v0.8: one-time backfill of the vec0 table from semantic_memories on
   * startup. Cheap when already populated — we short-circuit when vec_items
   * count matches the semantic_memories count so existing DBs don't pay
   * the read+parse cost on every constructor call.
   */
  private backfillVecIndex(): void {
    if (!this.vec.loaded) return;

    // Skip if vec_items is already in sync with semantic_memories.
    try {
      const semCount = (this.db.prepare('SELECT COUNT(*) as c FROM semantic_memories').get() as { c: number }).c;
      const vecCount = (this.db.prepare('SELECT COUNT(*) as c FROM vec_items').get() as { c: number }).c;
      if (semCount === vecCount) return;
    } catch {
      /* counts query failed — fall through to full backfill */
    }

    const rows = this.db.prepare('SELECT rowid, embedding FROM semantic_memories').all() as Array<{
      rowid: number;
      embedding: string;
    }>;
    for (const row of rows) {
      try {
        const embedding = JSON.parse(row.embedding) as number[];
        if (Array.isArray(embedding) && embedding.length === this.embeddingDim) {
          this.vec.upsert(row.rowid, embedding);
        }
      } catch {
        /* skip malformed rows */
      }
    }
  }

  private initSchema(): void {
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS semantic_memories (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata TEXT NOT NULL,
        tags TEXT NOT NULL,
        embedding TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        accessed_at INTEGER NOT NULL,
        access_count INTEGER NOT NULL DEFAULT 0,
        relevance_score REAL NOT NULL DEFAULT 1.0
      )
    `);
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_sem_type ON semantic_memories(type)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_sem_relevance ON semantic_memories(relevance_score)');

    // Migration: add pinned column if not present (v0.5.5)
    const cols = (this.db.prepare('PRAGMA table_info(semantic_memories)').all() as Array<{ name: string }>)
      .map(r => r.name);
    if (!cols.includes('pinned')) {
      this.db.exec('ALTER TABLE semantic_memories ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0');
    }
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_sem_pinned ON semantic_memories(pinned)');

    // v0.11: bi-temporal columns. Nullable-by-default so existing rows
    // stay valid (valid_from = NULL is treated as "from createdAt").
    if (!cols.includes('valid_from')) {
      this.db.exec('ALTER TABLE semantic_memories ADD COLUMN valid_from INTEGER');
    }
    if (!cols.includes('valid_until')) {
      this.db.exec('ALTER TABLE semantic_memories ADD COLUMN valid_until INTEGER');
    }
    if (!cols.includes('supersedes_id')) {
      this.db.exec('ALTER TABLE semantic_memories ADD COLUMN supersedes_id TEXT');
    }
    if (!cols.includes('superseded_by_id')) {
      this.db.exec('ALTER TABLE semantic_memories ADD COLUMN superseded_by_id TEXT');
    }
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_sem_valid_until ON semantic_memories(valid_until)');

    // Migration: FTS5 virtual table for full-text search (v0.7)
    this.initFTS5();
  }

  /**
   * Initialize FTS5 virtual table for full-text search on semantic_memories.
   * Uses external content mode (no data duplication).
   * Idempotent: safe to call on existing databases.
   */
  private initFTS5(): void {
    const ftsExists = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='semantic_fts'"
    ).get();

    if (!ftsExists) {
      this.db.exec(`
        CREATE VIRTUAL TABLE semantic_fts USING fts5(
          content, type,
          content='semantic_memories', content_rowid='rowid',
          tokenize='porter unicode61'
        )
      `);

      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS semantic_fts_insert AFTER INSERT ON semantic_memories BEGIN
          INSERT INTO semantic_fts(rowid, content, type) VALUES (NEW.rowid, NEW.content, NEW.type);
        END
      `);
      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS semantic_fts_delete AFTER DELETE ON semantic_memories BEGIN
          INSERT INTO semantic_fts(semantic_fts, rowid, content, type) VALUES('delete', OLD.rowid, OLD.content, OLD.type);
        END
      `);
      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS semantic_fts_update AFTER UPDATE ON semantic_memories BEGIN
          INSERT INTO semantic_fts(semantic_fts, rowid, content, type) VALUES('delete', OLD.rowid, OLD.content, OLD.type);
          INSERT INTO semantic_fts(rowid, content, type) VALUES (NEW.rowid, NEW.content, NEW.type);
        END
      `);

      // Backfill existing data
      this.db.exec(`
        INSERT INTO semantic_fts(rowid, content, type)
        SELECT rowid, content, type FROM semantic_memories
      `);
    }
  }

  private prepareStatements(): void {
    this.stmtInsert = this.db.prepare(`
      INSERT INTO semantic_memories
        (id, type, content, metadata, tags, embedding, created_at, updated_at, accessed_at, access_count, relevance_score, pinned, valid_from)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1.0, ?, ?)
    `);

    this.stmtGetById = this.db.prepare('SELECT * FROM semantic_memories WHERE id = ?');
    this.stmtGetAll = this.db.prepare('SELECT * FROM semantic_memories ORDER BY relevance_score DESC');
    this.stmtGetAllExcept = this.db.prepare('SELECT * FROM semantic_memories WHERE id != ?');

    this.stmtUpdateAccess = this.db.prepare(
      'UPDATE semantic_memories SET access_count = ?, accessed_at = ?, relevance_score = ?, updated_at = ? WHERE id = ?'
    );

    this.stmtUpdateScore = this.db.prepare(
      'UPDATE semantic_memories SET relevance_score = ?, updated_at = ? WHERE id = ?'
    );

    this.stmtDelete = this.db.prepare('DELETE FROM semantic_memories WHERE id = ?');
    this.stmtCount = this.db.prepare('SELECT COUNT(*) as count FROM semantic_memories');
    this.stmtGetEmbedding = this.db.prepare('SELECT embedding FROM semantic_memories WHERE id = ?');

    this.stmtGetAllPaginated = this.db.prepare(
      'SELECT * FROM semantic_memories ORDER BY relevance_score DESC LIMIT ? OFFSET ?'
    );

    this.stmtUpdateFull = this.db.prepare(`
      UPDATE semantic_memories
      SET content = ?, metadata = ?, tags = ?, embedding = ?, updated_at = ?
      WHERE id = ?
    `);

    this.stmtFindByType = this.db.prepare(
      'SELECT * FROM semantic_memories WHERE type = ? ORDER BY relevance_score DESC LIMIT ? OFFSET ?'
    );

    this.stmtCountByType = this.db.prepare(
      'SELECT COUNT(*) as count FROM semantic_memories WHERE type = ?'
    );

    this.stmtSetPinned = this.db.prepare('UPDATE semantic_memories SET pinned = ? WHERE id = ?');
    this.stmtCountPinned = this.db.prepare('SELECT COUNT(*) as count FROM semantic_memories WHERE pinned = 1');

    this.stmtSearchBM25 = this.db.prepare(`
      SELECT sm.*, bm25(semantic_fts) as bm25_score
      FROM semantic_fts fts
      JOIN semantic_memories sm ON sm.rowid = fts.rowid
      WHERE semantic_fts MATCH ?
      ORDER BY bm25(semantic_fts)
      LIMIT ?
    `);
  }

  /** Store a memory along with its computed embedding vector. */
  async store(
    content: string,
    type: MemoryType,
    metadata: Record<string, unknown> = {},
    pinned = false
  ): Promise<Memory> {
    const now = Date.now();
    const id = uuidv4();

    const memory: Memory = {
      id,
      type,
      content,
      metadata: {
        tags: (metadata.tags as string[]) || [],
        relationships: (metadata.relationships as RelationshipEdge[]) || [],
        confidence: (metadata.confidence as number) ?? 0.8,
        source: (metadata.source as 'user_explicit' | 'ai_inferred' | 'system_auto') ?? 'ai_inferred',
        cliType: (metadata.cliType as string) ?? 'generic',
        ...metadata,
      } as MemoryMetadata,
      tags: (metadata.tags as string[]) || [],
      createdAt: now,
      updatedAt: now,
      accessCount: 0,
      lastAccessedAt: now,
      pinned,
    };

    const embedding = await this.embedder.embedPassage(content);

    const result = this.stmtInsert.run(
      id,
      type,
      content,
      JSON.stringify(metadata),
      JSON.stringify(memory.tags),
      JSON.stringify(embedding),
      now,
      now,
      now,
      pinned ? 1 : 0,
      now, // v0.11: valid_from defaults to created_at
    );

    // v0.8: mirror into vec0 when sqlite-vec is available. Rowid comes from
    // the just-inserted row; lastInsertRowid is a bigint on node:sqlite.
    if (this.vec.loaded) {
      const rowid = typeof result.lastInsertRowid === 'bigint'
        ? Number(result.lastInsertRowid)
        : result.lastInsertRowid;
      try { this.vec.upsert(rowid, embedding); } catch { /* non-fatal */ }
    }

    return memory;
  }

  /** Retrieve the top-N most semantically similar memories for a query string. */
  async recall(query: string, limit = 10): Promise<ScoredMemory[]> {
    const queryEmbedding = await this.embedder.embedQuery(query);
    const rows = this.stmtGetAll.all() as unknown as DbRow[];

    const scored = rows.map((row) => {
      const embedding: number[] = JSON.parse(row.embedding);
      return { row, similarity: cosineSimilarity(queryEmbedding, embedding) };
    });

    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, limit).map(({ row, similarity }) => this.rowToScoredMemory(row, similarity));
  }

  /**
   * v0.8 scalable recall: pre-filter candidates using FTS5 BM25 before
   * running vector cosine only on the pool. Trades a small recall hit
   * (memories with zero token overlap are missed) for O(poolSize) work
   * instead of O(N) over the full L3 table.
   *
   * Falls back to full-scan recall() when:
   *   - the FTS5 sanitizer strips the query to empty (no tokens)
   *   - FTS5 returns zero candidates (no keyword overlap anywhere)
   *
   * Used by the hybrid recall path in engine.ts. Pure semantic mode still
   * goes through recall() to preserve its "cosine over everything" contract.
   */
  async recallPrefiltered(query: string, limit = 10, poolSize = 200): Promise<ScoredMemory[]> {
    if (!query.trim()) return [];

    const sanitized = SemanticMemoryLayer.sanitizeFTS5Query(query);
    if (!sanitized) return this.recall(query, limit);

    let rows: DbRow[];
    try {
      rows = this.stmtSearchBM25.all(sanitized, poolSize) as unknown as DbRow[];
    } catch {
      return this.recall(query, limit);
    }

    if (rows.length === 0) return this.recall(query, limit);

    const queryEmbedding = await this.embedder.embedQuery(query);
    const scored = rows.map((row) => {
      const embedding: number[] = JSON.parse(row.embedding);
      return { row, similarity: cosineSimilarity(queryEmbedding, embedding) };
    });

    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, limit).map(({ row, similarity }) => this.rowToScoredMemory(row, similarity));
  }

  /**
   * v0.8: ANN recall powered by sqlite-vec. Only usable when the optional
   * extension was loaded at construction time — callers should check
   * `vecEnabled` first, or use the auto-dispatching recallAccelerated().
   *
   * Internally uses a vec0 `embedding MATCH ?` KNN query against the
   * mirrored `vec_items` table and then hydrates full rows by rowid.
   * Distance from sqlite-vec is cosine distance in [0, 2]; we return
   * similarity = 1 - (distance / 2) mapped back into [0, 1] to match the
   * shape of the cosine-based paths.
   */
  async recallVec(query: string, limit = 10): Promise<ScoredMemory[]> {
    if (!this.vec.loaded) {
      throw new Error('recallVec called but sqlite-vec is not loaded');
    }
    if (!query.trim()) return [];

    const queryEmbedding = await this.embedder.embedQuery(query);
    const hits = this.vec.knn(queryEmbedding, limit);
    if (hits.length === 0) return [];

    // Hydrate rows by rowid in a single IN (...) query, preserving rank order.
    const placeholders = hits.map(() => '?').join(',');
    const stmt = this.db.prepare(
      `SELECT rowid, * FROM semantic_memories WHERE rowid IN (${placeholders})`,
    );
    const rows = stmt.all(...hits.map(h => h.rowid)) as unknown as Array<DbRow & { rowid: number }>;
    const byRowid = new Map(rows.map(r => [r.rowid, r]));

    return hits
      .map(({ rowid, distance }) => {
        const row = byRowid.get(rowid);
        if (!row) return null;
        // sqlite-vec cosine distance is in [0, 2]; convert back to [0, 1].
        const similarity = Math.max(0, 1 - distance / 2);
        return this.rowToScoredMemory(row, similarity);
      })
      .filter((m): m is ScoredMemory => m !== null);
  }

  /**
   * v0.8: single entry point for accelerated recall. Dispatches to
   * recallVec() when sqlite-vec is loaded, else recallPrefiltered().
   */
  async recallAccelerated(query: string, limit = 10, poolSize = 200): Promise<ScoredMemory[]> {
    if (this.vec.loaded) {
      try {
        return await this.recallVec(query, limit);
      } catch {
        // Fall through to the cosine path on any vec runtime error.
      }
    }
    return this.recallPrefiltered(query, limit, poolSize);
  }

  async get(id: string): Promise<Memory | undefined> {
    const row = this.stmtGetById.get(id) as DbRow | undefined;
    return row ? this.rowToMemory(row) : undefined;
  }

  /** Bump the access count and recalculate relevance score for a memory. */
  async touch(id: string): Promise<void> {
    const row = this.stmtGetById.get(id) as DbRow | undefined;
    if (!row) return;

    const now = Date.now();
    const newCount = row.access_count + 1;
    const newScore = this.calculateRelevanceScore(row.relevance_score, newCount, now, row.created_at);

    this.stmtUpdateAccess.run(newCount, now, newScore, now, id);
  }

  /** Find memories similar to an existing memory by its ID. */
  async findSimilar(memoryId: string, limit = 5): Promise<ScoredMemory[]> {
    const source = this.stmtGetEmbedding.get(memoryId) as { embedding: string } | undefined;
    if (!source) return [];

    const sourceEmbedding: number[] = JSON.parse(source.embedding);
    const rows = this.stmtGetAllExcept.all(memoryId) as unknown as DbRow[];

    const scored = rows.map((row) => {
      const embedding: number[] = JSON.parse(row.embedding);
      return { row, similarity: cosineSimilarity(sourceEmbedding, embedding) };
    });

    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, limit).map(({ row, similarity }) => this.rowToScoredMemory(row, similarity));
  }

  async getByProject(projectPath: string): Promise<Memory[]> {
    const rows = this.stmtGetAll.all() as unknown as DbRow[];
    return rows
      .filter((row) => {
        try {
          const meta = JSON.parse(row.metadata);
          return meta.projectPath === projectPath || meta.project === projectPath;
        } catch {
          return false;
        }
      })
      .map((row) => this.rowToMemory(row));
  }

  /**
   * Apply time-based decay to all memories. Memories whose relevance score
   * drops below decayThreshold (default 0.2) are permanently deleted.
   * Returns the number of memories evaluated.
   *
   * Perf: score computation still happens in JS (stays faithful to the
   * existing curve), but we fetch only the columns we need and wrap
   * all writes in a single transaction so N rows cost one WAL fsync
   * instead of N.
   */
  async applyDecay(): Promise<number> {
    const rows = this.db.prepare(
      'SELECT id, created_at, accessed_at, access_count, relevance_score, pinned FROM semantic_memories'
    ).all() as Array<{
      id: string;
      created_at: number;
      accessed_at: number;
      access_count: number;
      relevance_score: number;
      pinned: number;
    }>;
    if (rows.length === 0) return 0;

    const now = Date.now();
    const decayMs = this.decayDays * 24 * 60 * 60 * 1000;
    let affectedCount = 0;

    this.db.exec('BEGIN');
    try {
      for (const row of rows) {
        if (row.pinned === 1) continue; // pinned memories are exempt from decay

        const age = now - row.created_at;
        const timeSinceAccess = now - row.accessed_at;

        const ageDecay = Math.exp(-age / (decayMs * 2));
        const accessBoost = Math.min(row.access_count / 10, 0.5);
        const inactivityPenalty = Math.exp(-timeSinceAccess / decayMs);
        const newScore = Math.max(0, (ageDecay * 0.3 + inactivityPenalty * 0.7) + accessBoost);

        if (newScore < this.decayThreshold) {
          this.stmtDelete.run(row.id);
        } else if (Math.abs(newScore - row.relevance_score) > 0.01) {
          this.stmtUpdateScore.run(newScore, now, row.id);
        }

        affectedCount++;
      }
      this.db.exec('COMMIT');
    } catch (err) {
      try { this.db.exec('ROLLBACK'); } catch { /* ignore */ }
      throw err;
    }

    return affectedCount;
  }

  async delete(id: string): Promise<boolean> {
    // Single SELECT for both existence and rowid (vec0 cleanup).
    // Previously this ran two overlapping SELECTs, the second of which
    // always succeeded by the time the first had.
    const row = this.db.prepare('SELECT rowid FROM semantic_memories WHERE id = ?').get(id) as
      | { rowid: number }
      | undefined;
    if (!row) return false;
    this.stmtDelete.run(id);
    if (this.vec.loaded) {
      try { this.vec.remove(row.rowid); } catch { /* non-fatal */ }
    }
    return true;
  }

  /** Update a memory. Re-embeds only if content changed. */
  async update(id: string, updates: { content?: string; metadata?: Record<string, unknown>; tags?: string[]; pinned?: boolean }): Promise<Memory> {
    const row = this.stmtGetById.get(id) as DbRow | undefined;
    if (!row) throw new Error(`Memory not found: ${id}`);

    const now = Date.now();
    const newContent = updates.content ?? row.content;
    const contentChanged = updates.content !== undefined && updates.content !== row.content;

    let existingMeta: Record<string, unknown> = {};
    try { existingMeta = JSON.parse(row.metadata); } catch (err) {
      console.error('[ContextFabric] Corrupted metadata in memory', id, err);
    }
    const newMetadata = updates.metadata !== undefined
      ? { ...existingMeta, ...updates.metadata }
      : existingMeta;

    let existingTags: string[] = [];
    try { existingTags = JSON.parse(row.tags); } catch (err) {
      console.error('[ContextFabric] Corrupted tags in memory', id, err);
    }
    const newTags = updates.tags ?? existingTags;

    // Re-embed only if content changed
    let embeddingJson = row.embedding;
    if (contentChanged) {
      const embedding = await this.embedder.embedPassage(newContent);
      embeddingJson = JSON.stringify(embedding);
    }

    this.stmtUpdateFull.run(
      newContent,
      JSON.stringify(newMetadata),
      JSON.stringify(newTags),
      embeddingJson,
      now,
      id,
    );

    // Update pin status if provided
    if (updates.pinned !== undefined) {
      this.stmtSetPinned.run(updates.pinned ? 1 : 0, id);
    }

    const newPinned = updates.pinned !== undefined ? updates.pinned : row.pinned === 1;

    return {
      id: row.id,
      type: row.type as MemoryType,
      content: newContent,
      metadata: newMetadata as MemoryMetadata,
      tags: newTags,
      createdAt: row.created_at,
      updatedAt: now,
      accessCount: row.access_count,
      lastAccessedAt: row.accessed_at,
      pinned: newPinned,
    };
  }

  /** Paginated list of all memories, ordered by relevance_score DESC. */
  async getAll(limit = 100, offset = 0): Promise<Memory[]> {
    const rows = this.stmtGetAllPaginated.all(limit, offset) as unknown as DbRow[];
    return rows.map((row) => this.rowToMemory(row));
  }

  async count(): Promise<number> {
    const row = this.stmtCount.get() as { count: number } | undefined;
    return row?.count ?? 0;
  }

  async countPinned(): Promise<number> {
    const row = this.stmtCountPinned.get() as { count: number } | undefined;
    return row?.count ?? 0;
  }

  /** Find memories by type with pagination. */
  findByType(type: string, limit: number, offset: number): Memory[] {
    const rows = this.stmtFindByType.all(type, limit, offset) as unknown as DbRow[];
    return rows.map(row => this.rowToMemory(row));
  }

  /** Find memories that have ANY of the given tags (OR logic) with pagination. */
  findByTags(tags: string[], limit: number, offset: number): Memory[] {
    if (tags.length === 0) return [];

    let stmt = this.stmtFindByTagsCache.get(tags.length);
    if (!stmt) {
      const conditions = tags.map(() => `EXISTS (SELECT 1 FROM json_each(sm.tags) WHERE json_each.value = ?)`).join(' OR ');
      stmt = this.db.prepare(`
        SELECT sm.* FROM semantic_memories sm
        WHERE ${conditions}
        ORDER BY sm.relevance_score DESC
        LIMIT ? OFFSET ?
      `);
      this.stmtFindByTagsCache.set(tags.length, stmt);
    }

    const rows = stmt.all(...tags, limit, offset) as unknown as DbRow[];
    return rows.map(row => this.rowToMemory(row));
  }

  /** Count memories by type. */
  countByType(type: string): number {
    const row = this.stmtCountByType.get(type) as { count: number } | undefined;
    return row?.count ?? 0;
  }

  /** Count memories that have ANY of the given tags (OR logic). */
  countByTags(tags: string[]): number {
    if (tags.length === 0) return 0;

    let stmt = this.stmtCountByTagsCache.get(tags.length);
    if (!stmt) {
      const conditions = tags.map(() => `EXISTS (SELECT 1 FROM json_each(sm.tags) WHERE json_each.value = ?)`).join(' OR ');
      stmt = this.db.prepare(`
        SELECT COUNT(*) as count FROM semantic_memories sm
        WHERE ${conditions}
      `);
      this.stmtCountByTagsCache.set(tags.length, stmt);
    }

    const row = stmt.get(...tags) as { count: number } | undefined;
    return row?.count ?? 0;
  }

  /**
   * Full-text search using FTS5 BM25 ranking.
   * Returns memories sorted by BM25 relevance.
   */
  searchBM25(query: string, limit = 10): Array<{ memory: Memory; bm25Score: number }> {
    if (!query.trim()) return [];

    const sanitized = SemanticMemoryLayer.sanitizeFTS5Query(query);
    if (!sanitized) return [];

    try {
      const rows = this.stmtSearchBM25.all(sanitized, limit) as unknown as Array<DbRow & { bm25_score: number }>;
      return rows.map(row => ({
        memory: this.rowToMemory(row),
        bm25Score: row.bm25_score as number,
      }));
    } catch {
      return [];
    }
  }

  static sanitizeFTS5Query(query: string): string {
    return sanitizeFTS5Query(query);
  }

  /**
   * v0.11: bi-temporal supersession. Links `oldId` ← `newId` in both
   * directions and stamps `valid_until = now` on the predecessor. No-op
   * when oldId does not exist (returns false so callers can decide
   * whether to surface that).
   */
  async supersede(oldId: string, newId: string): Promise<boolean> {
    const oldRow = this.stmtGetById.get(oldId) as DbRow | undefined;
    const newRow = this.stmtGetById.get(newId) as DbRow | undefined;
    if (!oldRow || !newRow) return false;

    const now = Date.now();
    this.db.exec('BEGIN');
    try {
      this.db.prepare(
        'UPDATE semantic_memories SET valid_until = ?, superseded_by_id = ?, updated_at = ? WHERE id = ?',
      ).run(now, newId, now, oldId);
      this.db.prepare(
        'UPDATE semantic_memories SET supersedes_id = ?, updated_at = ? WHERE id = ?',
      ).run(oldId, now, newId);
      this.db.exec('COMMIT');
      return true;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  /** Expose the shared EmbeddingService so the code index can reuse it. */
  getEmbeddingService(): EmbeddingService {
    return this.embedder;
  }

  /**
   * v0.11: find the nearest existing memory to `content` by cosine. Returns
   * the match only if similarity >= threshold, else null. Uses the FTS5
   * prefilter path for scalability — the near-dup pool is drawn from the
   * top-poolSize BM25 candidates, falling back to full scan only when
   * FTS5 produces nothing (i.e. brand-new vocabulary).
   *
   * Dedup is per-layer-instance; callers decide whether to apply it.
   */
  async findNearDuplicate(
    content: string,
    threshold = 0.95,
    poolSize = 50,
  ): Promise<ScoredMemory | null> {
    if (!content.trim()) return null;

    // Dedup compares a new-incoming passage against stored passages, so we
    // encode it with the passage prefix (no-op for BGE, `"passage: "` for E5).
    const queryEmbedding = await this.embedder.embedPassage(content);

    // First try the BM25-prefiltered pool — cheap and matches recall semantics.
    let rows: DbRow[] = [];
    const sanitized = SemanticMemoryLayer.sanitizeFTS5Query(content);
    if (sanitized) {
      try {
        rows = this.stmtSearchBM25.all(sanitized, poolSize) as unknown as DbRow[];
      } catch { /* fall through */ }
    }

    // Fall back to full scan when FTS5 returns nothing. This handles the
    // empty-pool case for very short or all-stopword content.
    if (rows.length === 0) {
      rows = this.stmtGetAll.all() as unknown as DbRow[];
    }

    let best: { row: DbRow; sim: number } | null = null;
    for (const row of rows) {
      try {
        const embedding: number[] = JSON.parse(row.embedding);
        const sim = cosineSimilarity(queryEmbedding, embedding);
        if (sim >= threshold && (!best || sim > best.sim)) {
          best = { row, sim };
        }
      } catch {
        /* skip malformed */
      }
    }

    return best ? this.rowToScoredMemory(best.row, best.sim) : null;
  }

  /**
   * v0.11 merge-on-dedup helper. Unions `addTags` with the existing row's
   * tags, shallow-merges `addProvenance` onto metadata.provenance (new
   * values overwrite), and touches the access counter. Returns the updated
   * memory. Does not re-embed (content is unchanged by definition).
   */
  async mergeInto(
    existingId: string,
    addTags: string[] = [],
    addProvenance?: Record<string, unknown>,
  ): Promise<Memory> {
    const row = this.stmtGetById.get(existingId) as DbRow | undefined;
    if (!row) throw new Error(`Memory not found: ${existingId}`);

    let existingTags: string[] = [];
    try { existingTags = JSON.parse(row.tags); } catch { /* ignore */ }
    const mergedTags = Array.from(new Set([...existingTags, ...addTags]));

    let existingMeta: Record<string, unknown> = {};
    try { existingMeta = JSON.parse(row.metadata); } catch { /* ignore */ }
    if (addProvenance) {
      const existingProv = (existingMeta.provenance as Record<string, unknown> | undefined) ?? {};
      existingMeta = {
        ...existingMeta,
        provenance: { ...existingProv, ...addProvenance },
      };
    }

    const now = Date.now();
    this.stmtUpdateFull.run(
      row.content,
      JSON.stringify(existingMeta),
      JSON.stringify(mergedTags),
      row.embedding,
      now,
      existingId,
    );
    await this.touch(existingId);

    return {
      id: row.id,
      type: row.type as MemoryType,
      content: row.content,
      metadata: existingMeta as MemoryMetadata,
      tags: mergedTags,
      createdAt: row.created_at,
      updatedAt: now,
      accessCount: row.access_count + 1,
      lastAccessedAt: now,
      pinned: row.pinned === 1,
    };
  }

  close(): void {
    // v0.8: Explicit WAL checkpoint before close so any pending WAL frames
    // are flushed to the main DB file and the WAL is truncated. Guards
    // against data loss on subsequent unclean exits.
    try { this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* ignore */ }
    try { this.db.close(); } catch { /* ignore */ }
  }

  /**
   * v0.8: Create a consistent snapshot of L3 at `destPath` via VACUUM INTO.
   * See ProjectMemoryLayer.backup() for semantics.
   */
  backup(destPath: string): { path: string; size: number } {
    if (fs.existsSync(destPath)) {
      throw new Error(`backup target already exists: ${destPath}`);
    }
    const destDir = path.dirname(destPath);
    fs.mkdirSync(destDir, { recursive: true });

    try { this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* ignore */ }

    const escaped = destPath.replace(/'/g, "''");
    this.db.exec(`VACUUM INTO '${escaped}'`);

    return { path: destPath, size: fs.statSync(destPath).size };
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private calculateRelevanceScore(
    _currentScore: number,
    accessCount: number,
    lastAccessedAt: number,
    createdAt: number
  ): number {
    const now = Date.now();
    const decayMs = this.decayDays * 24 * 60 * 60 * 1000;
    const recencyBoost = Math.exp(-(now - lastAccessedAt) / (decayMs / 2));
    const accessBoost = Math.min(accessCount / 20, 0.3);
    const ageFactor = Math.exp(-(now - createdAt) / (decayMs * 3));
    return Math.min(1.0, Math.max(0, 0.4 * recencyBoost + 0.3 * ageFactor + 0.3 + accessBoost));
  }

  private rowToMemory(row: DbRow): Memory {
    let metadata: Record<string, unknown> = {};
    try { metadata = JSON.parse(row.metadata); } catch (err) {
      console.error('[ContextFabric] Corrupted metadata in memory', row.id, err);
    }

    let tags: string[] = [];
    try { tags = JSON.parse(row.tags); } catch (err) {
      console.error('[ContextFabric] Corrupted tags in memory', row.id, err);
    }

    // v0.11: project bi-temporal columns onto metadata.temporal so
    // callers have a single typed surface. Back-compat: valid_from
    // falls back to created_at for rows written before the migration.
    metadata.temporal = {
      validFrom: row.valid_from ?? row.created_at,
      validUntil: row.valid_until ?? null,
      supersedesId: row.supersedes_id ?? null,
      supersededById: row.superseded_by_id ?? null,
    };

    return {
      id: row.id,
      type: row.type as MemoryType,
      content: row.content,
      metadata: metadata as MemoryMetadata,
      tags,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      accessCount: row.access_count,
      lastAccessedAt: row.accessed_at,
      pinned: row.pinned === 1,
    };
  }

  private rowToScoredMemory(row: DbRow, similarity: number): ScoredMemory {
    return { ...this.rowToMemory(row), similarity };
  }
}

interface DbRow {
  id: string;
  type: string;
  content: string;
  metadata: string;
  tags: string;
  embedding: string;
  created_at: number;
  updated_at: number;
  accessed_at: number;
  access_count: number;
  relevance_score: number;
  pinned: number; // 0 = normal, 1 = pinned (exempt from decay)
  // v0.11 bi-temporal columns
  valid_from: number | null;
  valid_until: number | null;
  supersedes_id: string | null;
  superseded_by_id: string | null;
}

export default SemanticMemoryLayer;
