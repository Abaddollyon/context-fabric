// L2: Project Memory
// - SQLite persistence via node:sqlite (built-in since Node.js 22.5, zero deps)
// - Project-scoped (separate DB per project)
// - Full CRUD, tag-based organization, no TTL

import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { v4 as uuidv4 } from 'uuid';
import { MemoryLayer, type Memory, type MemoryType, type MemoryMetadata, type SummaryResult } from '../types.js';
import * as fs from 'fs';
import * as path from 'path';

/**
 * L2 Project Memory — persistent, project-scoped storage backed by SQLite.
 * Uses node:sqlite (built-in since Node.js 22.5) for zero native dependencies.
 * Supports full CRUD, tag-based filtering, text search, and summarization.
 */
export class ProjectMemoryLayer {
  private db: DatabaseSync;
  private projectPath: string;
  private dbPath: string;

  // Prepared statements (created once, reused for performance)
  private stmtInsert!: StatementSync;
  private stmtInsertTag!: StatementSync;
  private stmtGetById!: StatementSync;
  private stmtUpdateAccess!: StatementSync;
  private stmtFindByType!: StatementSync;
  private stmtSearch!: StatementSync;
  private stmtUpdate!: StatementSync;
  private stmtDeleteTags!: StatementSync;
  private stmtDelete!: StatementSync;
  private stmtGetAll!: StatementSync;
  private stmtGetOld!: StatementSync;
  private stmtDeleteById!: StatementSync;
  private stmtGetSince!: StatementSync;
  private stmtGetMeta!: StatementSync;
  private stmtUpsertMeta!: StatementSync;
  private stmtCount!: StatementSync;
  private stmtFindByTypePaginated!: StatementSync;
  private stmtCountByType!: StatementSync;
  private stmtSetPinned!: StatementSync;
  private stmtCountPinned!: StatementSync;
  private stmtSearchBM25!: StatementSync;

  constructor(projectPath: string, baseDir?: string) {
    this.projectPath = path.resolve(projectPath);

    const contextFabricDir = baseDir || path.join(this.projectPath, '.context-fabric');
    if (!fs.existsSync(contextFabricDir)) {
      fs.mkdirSync(contextFabricDir, { recursive: true });
    }

    this.dbPath = path.join(contextFabricDir, 'memory.db');
    this.db = new DatabaseSync(this.dbPath);

    this.initSchema();
    this.prepareStatements();
  }

  private initSchema(): void {
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec('PRAGMA journal_mode = WAL');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata TEXT,
        tags TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        access_count INTEGER DEFAULT 0,
        last_accessed_at INTEGER
      )
    `);

    this.db.exec('CREATE INDEX IF NOT EXISTS idx_type ON memories(type)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_created ON memories(created_at)');

    // Migration: add pinned column if not present (v0.5.5)
    const cols = (this.db.prepare('PRAGMA table_info(memories)').all() as Array<{ name: string }>)
      .map(r => r.name);
    if (!cols.includes('pinned')) {
      this.db.exec('ALTER TABLE memories ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0');
    }
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_pinned ON memories(pinned)');

    // Migration: FTS5 virtual table for full-text search (v0.7)
    this.initFTS5();

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_tags (
        memory_id TEXT NOT NULL,
        tag TEXT NOT NULL,
        PRIMARY KEY (memory_id, tag),
        FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
      )
    `);

    this.db.exec('CREATE INDEX IF NOT EXISTS idx_tag ON memory_tags(tag)');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS project_meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
  }

  /**
   * Initialize FTS5 virtual table for full-text search.
   * Uses external content mode (no data duplication — reads from memories table via rowid).
   * Idempotent: safe to call on existing databases.
   */
  private initFTS5(): void {
    // Check if FTS table already exists
    const ftsExists = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='memories_fts'"
    ).get();

    if (!ftsExists) {
      this.db.exec(`
        CREATE VIRTUAL TABLE memories_fts USING fts5(
          content, type,
          content='memories', content_rowid='rowid',
          tokenize='porter unicode61'
        )
      `);

      // Triggers to keep FTS in sync with the content table
      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS memories_fts_insert AFTER INSERT ON memories BEGIN
          INSERT INTO memories_fts(rowid, content, type) VALUES (NEW.rowid, NEW.content, NEW.type);
        END
      `);
      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS memories_fts_delete AFTER DELETE ON memories BEGIN
          INSERT INTO memories_fts(memories_fts, rowid, content, type) VALUES('delete', OLD.rowid, OLD.content, OLD.type);
        END
      `);
      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS memories_fts_update AFTER UPDATE ON memories BEGIN
          INSERT INTO memories_fts(memories_fts, rowid, content, type) VALUES('delete', OLD.rowid, OLD.content, OLD.type);
          INSERT INTO memories_fts(rowid, content, type) VALUES (NEW.rowid, NEW.content, NEW.type);
        END
      `);

      // Backfill existing data
      this.db.exec(`
        INSERT INTO memories_fts(rowid, content, type)
        SELECT rowid, content, type FROM memories
      `);
    }
  }

  private prepareStatements(): void {
    this.stmtInsert = this.db.prepare(`
      INSERT INTO memories (id, type, content, metadata, tags, created_at, updated_at, access_count, pinned)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.stmtInsertTag = this.db.prepare(
      'INSERT OR IGNORE INTO memory_tags (memory_id, tag) VALUES (?, ?)'
    );

    this.stmtGetById = this.db.prepare('SELECT * FROM memories WHERE id = ?');

    this.stmtUpdateAccess = this.db.prepare(
      'UPDATE memories SET access_count = access_count + 1, last_accessed_at = ? WHERE id = ?'
    );

    this.stmtFindByType = this.db.prepare(
      'SELECT * FROM memories WHERE type = ? ORDER BY created_at DESC'
    );

    this.stmtSearch = this.db.prepare(
      'SELECT * FROM memories WHERE content LIKE ? ORDER BY created_at DESC'
    );

    this.stmtUpdate = this.db.prepare(`
      UPDATE memories
      SET type = ?, content = ?, metadata = ?, tags = ?, updated_at = ?
      WHERE id = ?
    `);

    this.stmtDeleteTags = this.db.prepare('DELETE FROM memory_tags WHERE memory_id = ?');

    this.stmtDelete = this.db.prepare('DELETE FROM memories WHERE id = ?');

    this.stmtGetAll = this.db.prepare(
      'SELECT * FROM memories ORDER BY created_at DESC LIMIT ? OFFSET ?'
    );

    this.stmtGetOld = this.db.prepare(
      `SELECT * FROM memories WHERE created_at <= ? AND type != 'summary' AND pinned = 0 ORDER BY created_at ASC`
    );

    this.stmtDeleteById = this.db.prepare('DELETE FROM memories WHERE id = ?');

    this.stmtGetSince = this.db.prepare(
      'SELECT * FROM memories WHERE created_at > ? ORDER BY created_at ASC'
    );

    this.stmtGetMeta = this.db.prepare(
      'SELECT value FROM project_meta WHERE key = ?'
    );

    this.stmtUpsertMeta = this.db.prepare(`
      INSERT INTO project_meta (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `);

    this.stmtCount = this.db.prepare('SELECT COUNT(*) as count FROM memories');

    this.stmtFindByTypePaginated = this.db.prepare(
      'SELECT * FROM memories WHERE type = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
    );

    this.stmtCountByType = this.db.prepare(
      'SELECT COUNT(*) as count FROM memories WHERE type = ?'
    );

    this.stmtSetPinned = this.db.prepare('UPDATE memories SET pinned = ? WHERE id = ?');
    this.stmtCountPinned = this.db.prepare('SELECT COUNT(*) as count FROM memories WHERE pinned = 1');

    this.stmtSearchBM25 = this.db.prepare(`
      SELECT m.*, bm25(memories_fts) as bm25_score
      FROM memories_fts fts
      JOIN memories m ON m.rowid = fts.rowid
      WHERE memories_fts MATCH ?
      ORDER BY bm25(memories_fts)
      LIMIT ?
    `);
  }

  /** No-op — node:sqlite is synchronous, so the layer is always ready. */
  async ready(): Promise<void> {
    // node:sqlite is synchronous — always ready
  }

  /** Persist a new memory and its tags into SQLite. */
  async store(content: string, type: MemoryType, metadata?: object, tags?: string[], pinned = false): Promise<Memory> {
    const id = uuidv4();
    const now = Date.now();

    const memoryMetadata: MemoryMetadata = {
      tags: tags || [],
      relationships: [],
      confidence: 0.8,
      source: 'ai_inferred',
      cliType: 'generic',
      ...(metadata || {}),
    } as MemoryMetadata;

    const memory: Memory = {
      id,
      type,
      layer: MemoryLayer.L2_PROJECT,
      content,
      metadata: memoryMetadata,
      tags: tags || [],
      createdAt: now,
      updatedAt: now,
      accessCount: 0,
      pinned,
    };

    this.stmtInsert.run(
      memory.id,
      memory.type,
      memory.content,
      JSON.stringify(memory.metadata || {}),
      JSON.stringify(tags || []),
      memory.createdAt as number,
      memory.updatedAt as number,
      memory.accessCount ?? 0,
      pinned ? 1 : 0,
    );

    if (tags && tags.length > 0) {
      for (const tag of tags) {
        this.stmtInsertTag.run(memory.id, tag);
      }
    }

    return memory;
  }

  async get(id: string): Promise<Memory | undefined> {
    this.stmtUpdateAccess.run(Date.now(), id);
    const row = this.stmtGetById.get(id) as DatabaseRow | undefined;
    return row ? this.rowToMemory(row) : undefined;
  }

  /** Find memories that have ALL the given tags (AND logic). */
  async findByTags(tags: string[]): Promise<Memory[]> {
    if (tags.length === 0) return [];

    const placeholders = tags.map(() => '?').join(',');
    const stmt = this.db.prepare(`
      SELECT m.* FROM memories m
      INNER JOIN memory_tags mt ON m.id = mt.memory_id
      WHERE mt.tag IN (${placeholders})
      GROUP BY m.id
      HAVING COUNT(DISTINCT mt.tag) = ?
      ORDER BY m.created_at DESC
    `);

    const rows = stmt.all(...(tags as string[]), tags.length) as DatabaseRow[];
    return rows.map(r => this.rowToMemory(r));
  }

  async findByType(type: MemoryType): Promise<Memory[]> {
    const rows = this.stmtFindByType.all(type) as DatabaseRow[];
    return rows.map(r => this.rowToMemory(r));
  }

  /** Substring search across memory content (case-insensitive via LIKE). */
  async search(query: string): Promise<Memory[]> {
    if (!query.trim()) return [];
    const rows = this.stmtSearch.all(`%${query}%`) as DatabaseRow[];
    return rows.map(r => this.rowToMemory(r));
  }

  async update(id: string, updates: Partial<Memory>): Promise<Memory> {
    const existing = await this.get(id);
    if (!existing) throw new Error(`Memory not found: ${id}`);

    const now = Date.now();
    const updatedTags = updates.tags ?? updates.metadata?.tags;

    const updated: Memory = {
      ...existing,
      ...updates,
      id,
      updatedAt: now,
    };

    this.stmtUpdate.run(
      updated.type,
      updated.content,
      JSON.stringify(updated.metadata || {}),
      JSON.stringify(updatedTags || []),
      updated.updatedAt as number,
      id,
    );

    if (updatedTags !== undefined) {
      this.stmtDeleteTags.run(id);
      for (const tag of updatedTags) {
        this.stmtInsertTag.run(id, tag);
      }
    }

    if (updates.pinned !== undefined) {
      this.stmtSetPinned.run(updates.pinned ? 1 : 0, id);
      updated.pinned = updates.pinned;
    }

    return updated;
  }

  async delete(id: string): Promise<boolean> {
    const existing = await this.get(id);
    if (!existing) return false;
    const result = this.stmtDelete.run(id) as { changes: number };
    return result.changes > 0;
  }

  async getAll(limit = 100, offset = 0): Promise<Memory[]> {
    const rows = this.stmtGetAll.all(limit, offset) as DatabaseRow[];
    return rows.map(r => this.rowToMemory(r));
  }

  async getRecent(limit = 10): Promise<Memory[]> {
    return this.getAll(limit, 0);
  }

  /** Find memories by type with pagination. */
  findByTypePaginated(type: MemoryType, limit: number, offset: number): Memory[] {
    const rows = this.stmtFindByTypePaginated.all(type, limit, offset) as DatabaseRow[];
    return rows.map(r => this.rowToMemory(r));
  }

  /** Find memories that have ANY of the given tags (OR logic) with pagination. */
  findByTagsPaginated(tags: string[], limit: number, offset: number): Memory[] {
    if (tags.length === 0) return [];

    const placeholders = tags.map(() => '?').join(',');
    const stmt = this.db.prepare(`
      SELECT DISTINCT m.* FROM memories m
      INNER JOIN memory_tags mt ON m.id = mt.memory_id
      WHERE mt.tag IN (${placeholders})
      ORDER BY m.created_at DESC
      LIMIT ? OFFSET ?
    `);

    const rows = stmt.all(...tags, limit, offset) as DatabaseRow[];
    return rows.map(r => this.rowToMemory(r));
  }

  /** Count memories by type. */
  countByType(type: MemoryType): number {
    const row = this.stmtCountByType.get(type) as { count: number } | undefined;
    return row?.count ?? 0;
  }

  /** Count memories that have ANY of the given tags (OR logic). */
  countByTags(tags: string[]): number {
    if (tags.length === 0) return 0;

    const placeholders = tags.map(() => '?').join(',');
    const stmt = this.db.prepare(`
      SELECT COUNT(DISTINCT m.id) as count FROM memories m
      INNER JOIN memory_tags mt ON m.id = mt.memory_id
      WHERE mt.tag IN (${placeholders})
    `);

    const row = stmt.get(...tags) as { count: number } | undefined;
    return row?.count ?? 0;
  }

  /** Return the total number of memories in this project. */
  count(): number {
    const row = this.stmtCount.get() as { count: number } | undefined;
    return row?.count ?? 0;
  }

  /** Return the number of pinned memories. */
  countPinned(): number {
    const row = this.stmtCountPinned.get() as { count: number } | undefined;
    return row?.count ?? 0;
  }

  /**
   * Archive old memories into a single summary entry.
   * Deletes the originals after creating the summary.
   */
  async summarize(olderThanDays: number): Promise<SummaryResult> {
    const cutoffTime = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
    const oldMemories = this.stmtGetOld.all(cutoffTime) as DatabaseRow[];

    if (oldMemories.length === 0) {
      return { summaryId: '', summarizedCount: 0, summaryContent: 'No memories to summarize.' };
    }

    const summaryContent = this.generateSummary(oldMemories);

    const summary = await this.store(
      summaryContent,
      'summary',
      {
        summarizedCount: oldMemories.length,
        dateRange: {
          from: oldMemories[0]['created_at'],
          to: oldMemories[oldMemories.length - 1]['created_at'],
        },
        originalIds: oldMemories.map(m => m['id']),
      },
      ['summary', 'archived']
    );

    for (const memory of oldMemories) {
      this.stmtDeleteById.run(memory['id'] as string);
    }

    return { summaryId: summary.id, summarizedCount: oldMemories.length, summaryContent };
  }

  private generateSummary(memories: DatabaseRow[]): string {
    const byType = new Map<string, number>();
    for (const m of memories) {
      const t = m['type'] as string;
      byType.set(t, (byType.get(t) || 0) + 1);
    }

    const typeBreakdown = Array.from(byType.entries()).map(([t, c]) => `${t}: ${c}`).join(', ');
    const snippets = memories
      .slice(0, 5)
      .map(m => {
        const t = m['type'] as string;
        const c = m['content'] as string;
        return `- [${t}] ${c.substring(0, 100)}${c.length > 100 ? '...' : ''}`;
      })
      .join('\n');

    return `Summary of ${memories.length} archived memories\n\nType breakdown: ${typeBreakdown}\n\nKey entries:\n${snippets}${memories.length > 5 ? `\n... and ${memories.length - 5} more` : ''}`;
  }

  /** Returns the epoch ms of the last updateLastSeen() call, or null on first session. */
  getLastSeen(): number | null {
    const row = this.stmtGetMeta.get('last_seen') as { value: string } | undefined;
    return row ? parseInt(row.value, 10) : null;
  }

  /** Record the current time as last-seen for this project. */
  updateLastSeen(now: number = Date.now()): void {
    this.stmtUpsertMeta.run('last_seen', String(now), now);
  }

  /** Return all memories created strictly after the given epoch ms. */
  getMemoriesSince(epochMs: number): Memory[] {
    const rows = this.stmtGetSince.all(epochMs) as DatabaseRow[];
    return rows.map(r => this.rowToMemory(r));
  }

  /**
   * Full-text search using FTS5 BM25 ranking.
   * Returns memories sorted by BM25 relevance (lower = more relevant in SQLite's convention).
   */
  searchBM25(query: string, limit = 10): Array<{ memory: Memory; bm25Score: number }> {
    if (!query.trim()) return [];

    const sanitized = ProjectMemoryLayer.sanitizeFTS5Query(query);
    if (!sanitized) return [];

    try {
      const rows = this.stmtSearchBM25.all(sanitized, limit) as Array<DatabaseRow & { bm25_score: number }>;
      return rows.map(row => ({
        memory: this.rowToMemory(row),
        bm25Score: row.bm25_score as number,
      }));
    } catch {
      // FTS5 query syntax error — fall back to empty results
      return [];
    }
  }

  /**
   * Sanitize a query string for FTS5 MATCH syntax.
   * Strips FTS5 operators and wraps each token in double quotes to force literal matching.
   */
  static sanitizeFTS5Query(query: string): string {
    // Remove FTS5 special operators and punctuation that could cause parse errors
    const cleaned = query
      .replace(/[*"():^{}~<>]/g, ' ')  // strip FTS5 operators
      .replace(/\b(AND|OR|NOT|NEAR)\b/gi, '')  // strip boolean keywords
      .trim();
    if (!cleaned) return '';

    // Split into tokens and wrap each in quotes to force literal matching
    const tokens = cleaned.split(/\s+/).filter(t => t.length > 0);
    if (tokens.length === 0) return '';

    return tokens.map(t => `"${t}"`).join(' ');
  }

  close(): void {
    try { this.db.close(); } catch { /* ignore */ }
  }

  getDbPath(): string {
    return this.dbPath;
  }

  private rowToMemory(row: DatabaseRow): Memory {
    const metadata = row.metadata ? JSON.parse(row.metadata as string) : {};
    return {
      id: row.id as string,
      type: row.type as MemoryType,
      layer: MemoryLayer.L2_PROJECT,
      content: row.content as string,
      metadata: {
        tags: row.tags ? JSON.parse(row.tags as string) : [],
        relationships: metadata.relationships || [],
        confidence: metadata.confidence ?? 0.8,
        source: metadata.source ?? 'ai_inferred',
        cliType: metadata.cliType ?? 'generic',
        ...metadata,
      },
      tags: row.tags ? JSON.parse(row.tags as string) : [],
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
      accessCount: (row.access_count as number) || 0,
      lastAccessedAt: (row.last_accessed_at as number | null) || undefined,
      pinned: (row.pinned as number) === 1,
    };
  }
}

// node:sqlite returns rows as Record<string, unknown>
type DatabaseRow = Record<string, unknown>;

export default ProjectMemoryLayer;
