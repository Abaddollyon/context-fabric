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
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';

export interface ScoredMemory extends Memory {
  similarity: number;
}

interface SemanticMemoryOptions {
  baseDir?: string;
  decayDays?: number;
  collectionName?: string; // kept for API compat, unused
  chromaUrl?: string;      // kept for API compat, unused
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

export class SemanticMemoryLayer {
  private db: DatabaseSync;
  private embedder: EmbeddingService;
  private decayDays: number;

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

  constructor(options: SemanticMemoryOptions = {}) {
    this.decayDays = options.decayDays ?? 30;

    if (options.isEphemeral) {
      this.db = new DatabaseSync(':memory:');
    } else {
      const baseDir = options.baseDir ?? path.join(process.cwd(), '.semantic-memory');
      fs.mkdirSync(baseDir, { recursive: true });
      const dbPath = path.join(baseDir, 'semantic.db');
      this.db = new DatabaseSync(dbPath);
    }

    this.initSchema();
    this.prepareStatements();
    this.embedder = new EmbeddingService();
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
  }

  private prepareStatements(): void {
    this.stmtInsert = this.db.prepare(`
      INSERT INTO semantic_memories
        (id, type, content, metadata, tags, embedding, created_at, updated_at, accessed_at, access_count, relevance_score)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1.0)
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
  }

  async store(
    content: string,
    type: MemoryType,
    metadata: Record<string, unknown> = {}
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
    };

    const embedding = await this.embedder.embed(content);

    this.stmtInsert.run(
      id,
      type,
      content,
      JSON.stringify(metadata),
      JSON.stringify(memory.tags),
      JSON.stringify(embedding),
      now,
      now,
      now,
    );

    return memory;
  }

  async recall(query: string, limit = 10): Promise<ScoredMemory[]> {
    const queryEmbedding = await this.embedder.embed(query);
    const rows = this.stmtGetAll.all() as unknown as DbRow[];

    const scored = rows.map((row) => {
      const embedding: number[] = JSON.parse(row.embedding);
      return { row, similarity: cosineSimilarity(queryEmbedding, embedding) };
    });

    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, limit).map(({ row, similarity }) => this.rowToScoredMemory(row, similarity));
  }

  async get(id: string): Promise<Memory | undefined> {
    const row = this.stmtGetById.get(id) as DbRow | undefined;
    return row ? this.rowToMemory(row) : undefined;
  }

  async touch(id: string): Promise<void> {
    const row = this.stmtGetById.get(id) as DbRow | undefined;
    if (!row) return;

    const now = Date.now();
    const newCount = row.access_count + 1;
    const newScore = this.calculateRelevanceScore(row.relevance_score, newCount, now, row.created_at);

    this.stmtUpdateAccess.run(newCount, now, newScore, now, id);
  }

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

  async applyDecay(): Promise<number> {
    const rows = this.stmtGetAll.all() as unknown as DbRow[];
    if (rows.length === 0) return 0;

    const now = Date.now();
    const decayMs = this.decayDays * 24 * 60 * 60 * 1000;
    let affectedCount = 0;

    for (const row of rows) {
      const age = now - row.created_at;
      const timeSinceAccess = now - row.accessed_at;

      const ageDecay = Math.exp(-age / (decayMs * 2));
      const accessBoost = Math.min(row.access_count / 10, 0.5);
      const inactivityPenalty = Math.exp(-timeSinceAccess / decayMs);
      const newScore = Math.max(0, (ageDecay * 0.3 + inactivityPenalty * 0.7) + accessBoost);

      if (newScore < 0.1) {
        this.stmtDelete.run(row.id);
      } else if (Math.abs(newScore - row.relevance_score) > 0.01) {
        this.stmtUpdateScore.run(newScore, now, row.id);
      }

      affectedCount++;
    }

    return affectedCount;
  }

  async delete(id: string): Promise<boolean> {
    const existing = this.stmtGetById.get(id);
    if (!existing) return false;
    this.stmtDelete.run(id);
    return true;
  }

  async count(): Promise<number> {
    const row = this.stmtCount.get() as { count: number } | undefined;
    return row?.count ?? 0;
  }

  close(): void {
    try { this.db.close(); } catch { /* ignore */ }
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
    try { metadata = JSON.parse(row.metadata); } catch { /* empty */ }

    let tags: string[] = [];
    try { tags = JSON.parse(row.tags); } catch { /* empty */ }

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
}

export default SemanticMemoryLayer;
