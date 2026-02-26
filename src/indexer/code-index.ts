/**
 * CodeIndex — per-project code index backed by SQLite.
 *
 * Scans source files, extracts symbols, chunks content for semantic search,
 * and stays up-to-date via fs.watch + incremental mtime diffing.
 */

import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { readFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import type { EmbeddingService } from '../embedding.js';
import type { FabricConfig } from '../types.js';
import { discoverFiles, computeDiff, detectLanguage, isIndexableExtension, type ExistingFileInfo } from './scanner.js';
import { extractSymbols, type ExtractedSymbol } from './symbols.js';
import { FileWatcher } from './watcher.js';

// ============================================================================
// Types
// ============================================================================

export interface CodeIndexOptions {
  projectPath: string;
  embeddingService: EmbeddingService | null;
  config: FabricConfig['codeIndex'];
  isEphemeral?: boolean; // in-memory SQLite for testing
}

export interface SearchResult {
  filePath: string;
  language: string;
  symbol?: {
    name: string;
    kind: string;
    signature: string | null;
    lineStart: number;
    lineEnd: number | null;
    docComment: string | null;
  };
  chunk?: {
    lineStart: number;
    lineEnd: number;
    content?: string;
    similarity?: number;
  };
}

export interface SearchOptions {
  language?: string;
  filePattern?: string;
  symbolKind?: string;
  limit?: number;
  threshold?: number;
  includeContent?: boolean;
}

export interface IndexStatus {
  totalFiles: number;
  totalSymbols: number;
  totalChunks: number;
  lastIndexedAt: number | null;
  isStale: boolean;
}

// ============================================================================
// Cosine similarity (duplicated from semantic.ts to avoid coupling)
// ============================================================================

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

// ============================================================================
// CodeIndex Class
// ============================================================================

export class CodeIndex {
  private db!: DatabaseSync;
  private projectPath: string;
  private embeddingService: EmbeddingService | null;
  private config: FabricConfig['codeIndex'];
  private watcher: FileWatcher | null = null;
  private isReady = false;
  private isUpdating = false;
  private isEphemeral: boolean;

  // Prepared statements (initialized after schema)
  private stmtInsertFile!: StatementSync;
  private stmtDeleteFile!: StatementSync;
  private stmtUpdateMtime!: StatementSync;
  private stmtGetFile!: StatementSync;
  private stmtGetAllFiles!: StatementSync;
  private stmtInsertSymbol!: StatementSync;
  private stmtInsertChunk!: StatementSync;
  private stmtSearchSymbolsByName!: StatementSync;
  private stmtSearchSymbolsByKind!: StatementSync;
  private stmtGetFileSymbols!: StatementSync;
  private stmtCountFiles!: StatementSync;
  private stmtCountSymbols!: StatementSync;
  private stmtCountChunks!: StatementSync;
  private stmtGetMeta!: StatementSync;
  private stmtSetMeta!: StatementSync;
  private stmtGetAllChunks!: StatementSync;

  constructor(opts: CodeIndexOptions) {
    this.projectPath = opts.projectPath;
    this.embeddingService = opts.embeddingService;
    this.config = opts.config;
    this.isEphemeral = opts.isEphemeral ?? false;

    this.initDb();
    this.initSchema();
    this.prepareStatements();
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  /** First call triggers initial scan if needed. */
  async ensureReady(): Promise<void> {
    if (this.isReady) return;
    this.isReady = true;

    // Start watcher if configured
    if (this.config.watchEnabled && !this.isEphemeral) {
      this.watcher = new FileWatcher({
        projectPath: this.projectPath,
        debounceMs: this.config.debounceMs,
        onChanged: (relPath) => {
          if (isIndexableExtension(relPath)) {
            this.reindexFile(relPath).catch((err: unknown) => {
              console.warn('[ContextFabric] reindexFile failed for changed file:', relPath, err);
            });
          }
        },
        onDeleted: (relPath) => {
          try { this.stmtDeleteFile.run(relPath); } catch (err) {
            console.warn('[ContextFabric] stmtDeleteFile failed for deleted file:', relPath, err);
          }
        },
      });
      this.watcher.start();
    }

    // Trigger initial index if empty
    const status = this.getStatus();
    if (status.totalFiles === 0) {
      await this.incrementalUpdate();
    }
  }

  close(): void {
    this.watcher?.stop();
    this.watcher = null;
    try { this.db.close(); } catch {/* ignore */}
  }

  // ============================================================================
  // Search
  // ============================================================================

  /** Full-text search across file content and symbol names. */
  searchText(query: string, opts: SearchOptions = {}): SearchResult[] {
    const limit = opts.limit ?? 10;
    const results: SearchResult[] = [];
    const queryLower = query.toLowerCase();

    // Search through chunks
    const rows = this.stmtGetAllChunks.all() as unknown as ChunkRow[];

    for (const row of rows) {
      if (opts.language && detectLanguage(row.file_path) !== opts.language) continue;
      if (opts.filePattern && !matchGlob(row.file_path, opts.filePattern)) continue;

      if (row.content.toLowerCase().includes(queryLower)) {
        results.push({
          filePath: row.file_path,
          language: detectLanguage(row.file_path),
          chunk: {
            lineStart: row.line_start,
            lineEnd: row.line_end,
            content: opts.includeContent !== false ? row.content : undefined,
          },
        });
        if (results.length >= limit) break;
      }
    }

    return results;
  }

  /** Search for symbols by name or kind. */
  searchSymbols(query: string, opts: SearchOptions = {}): SearchResult[] {
    const limit = opts.limit ?? 10;
    const queryLower = query.toLowerCase();
    const results: SearchResult[] = [];

    let rows: SymbolRow[];

    if (opts.symbolKind) {
      rows = this.stmtSearchSymbolsByKind.all(opts.symbolKind) as unknown as SymbolRow[];
    } else {
      // Get all symbols and filter by name match
      rows = this.stmtSearchSymbolsByName.all(`%${query}%`) as unknown as SymbolRow[];
    }

    for (const row of rows) {
      if (opts.language && detectLanguage(row.file_path) !== opts.language) continue;
      if (opts.filePattern && !matchGlob(row.file_path, opts.filePattern)) continue;

      // If filtering by kind + name, do name filter too
      if (opts.symbolKind && !row.name.toLowerCase().includes(queryLower)) continue;

      results.push({
        filePath: row.file_path,
        language: detectLanguage(row.file_path),
        symbol: {
          name: row.name,
          kind: row.kind,
          signature: row.signature,
          lineStart: row.line_start,
          lineEnd: row.line_end,
          docComment: row.doc_comment,
        },
      });

      if (results.length >= limit) break;
    }

    return results;
  }

  /** Semantic search using embeddings. */
  async searchSemantic(query: string, opts: SearchOptions = {}): Promise<SearchResult[]> {
    if (!this.embeddingService) return [];

    const limit = opts.limit ?? 10;
    const threshold = opts.threshold ?? 0.5;

    const queryEmbedding = await this.embeddingService.embed(query);
    const rows = this.stmtGetAllChunks.all() as unknown as ChunkRow[];
    const scored: Array<{ row: ChunkRow; similarity: number }> = [];

    for (const row of rows) {
      if (opts.language && detectLanguage(row.file_path) !== opts.language) continue;
      if (opts.filePattern && !matchGlob(row.file_path, opts.filePattern)) continue;

      let embedding: number[];
      try {
        embedding = JSON.parse(row.embedding);
      } catch (err) {
        console.warn('[ContextFabric] Corrupted embedding in code index, skipping chunk:', row.file_path, err);
        continue;
      }

      const similarity = cosineSimilarity(queryEmbedding, embedding);
      if (similarity >= threshold) {
        scored.push({ row, similarity });
      }
    }

    scored.sort((a, b) => b.similarity - a.similarity);

    return scored.slice(0, limit).map(({ row, similarity }) => ({
      filePath: row.file_path,
      language: detectLanguage(row.file_path),
      chunk: {
        lineStart: row.line_start,
        lineEnd: row.line_end,
        content: opts.includeContent !== false ? row.content : undefined,
        similarity,
      },
    }));
  }

  // ============================================================================
  // Indexing
  // ============================================================================

  /** Re-index a single file. */
  async reindexFile(relativePath: string): Promise<void> {
    const fullPath = join(this.projectPath, relativePath);

    if (!existsSync(fullPath)) {
      // File deleted
      this.stmtDeleteFile.run(relativePath);
      return;
    }

    let content: string;
    try {
      content = readFileSync(fullPath, 'utf-8');
    } catch (err) {
      console.warn('[ContextFabric] Could not read file for indexing, skipping:', relativePath, err);
      return;
    }

    const language = detectLanguage(relativePath);
    const { statSync } = await import('fs');
    const stat = statSync(fullPath);
    const { createHash } = await import('crypto');
    const hash = createHash('sha256').update(content).digest('hex');

    // Delete existing data for this file (cascades to symbols + chunks)
    this.stmtDeleteFile.run(relativePath);

    // Extract symbols
    const symbols = extractSymbols(content, language);

    // Chunk the file
    const chunks = this.chunkContent(content, relativePath, symbols);

    // Embed chunks if embedding service available
    let embeddings: number[][] = [];
    if (this.embeddingService && chunks.length > 0) {
      try {
        const chunkTexts = chunks.map(c => c.header + c.content);
        embeddings = await this.embeddingService.embedBatch(chunkTexts);
      } catch (err) {
        console.warn('[ContextFabric] Embedding batch failed for', relativePath, '— storing chunks without embeddings:', err);
        embeddings = chunks.map(() => []);
      }
    } else {
      embeddings = chunks.map(() => []);
    }

    // Insert file
    this.stmtInsertFile.run(
      relativePath,
      stat.mtimeMs,
      stat.size,
      language,
      hash,
      Date.now(),
      chunks.length,
    );

    // Insert symbols
    for (const sym of symbols) {
      this.stmtInsertSymbol.run(
        relativePath,
        sym.name,
        sym.kind,
        sym.lineStart,
        sym.lineEnd,
        sym.signature,
        sym.docComment,
      );
    }

    // Insert chunks
    for (let i = 0; i < chunks.length; i++) {
      this.stmtInsertChunk.run(
        relativePath,
        i,
        chunks[i].lineStart,
        chunks[i].lineEnd,
        chunks[i].content,
        JSON.stringify(embeddings[i]),
      );
    }

    // Update last indexed timestamp
    this.stmtSetMeta.run('last_indexed_at', String(Date.now()), Date.now());
  }

  /**
   * Full incremental update. Processes files in batches of 20
   * with event loop yields between batches.
   */
  async incrementalUpdate(): Promise<void> {
    if (this.isUpdating) return;
    this.isUpdating = true;

    try {
      // Discover files
      const discovered = discoverFiles(this.projectPath, this.config.maxFiles);

      // Build existing file info from DB
      const existing = new Map<string, ExistingFileInfo>();
      const fileRows = this.stmtGetAllFiles.all() as unknown as FileRow[];
      for (const row of fileRows) {
        existing.set(row.path, { mtime_ms: row.mtime_ms, hash: row.hash });
      }

      // Compute diff
      const { diffs, deleted } = computeDiff(
        this.projectPath,
        discovered,
        existing,
        this.config.maxFileSizeBytes,
      );

      // Delete removed files
      for (const delPath of deleted) {
        this.stmtDeleteFile.run(delPath);
      }

      // Update touched files (mtime only)
      for (const d of diffs.filter(d => d.action === 'touched')) {
        this.stmtUpdateMtime.run(d.mtimeMs, d.path);
      }

      // Index new + changed files in batches of 20
      const toIndex = diffs.filter(d => d.action === 'new' || d.action === 'changed');
      const batchSize = 20;

      for (let i = 0; i < toIndex.length; i += batchSize) {
        const batch = toIndex.slice(i, i + batchSize);

        for (const d of batch) {
          await this.reindexFile(d.path);
        }

        // Yield the event loop between batches
        if (i + batchSize < toIndex.length) {
          await new Promise<void>(r => setImmediate(r));
        }
      }

      // Update metadata
      this.stmtSetMeta.run('last_indexed_at', String(Date.now()), Date.now());
    } finally {
      this.isUpdating = false;
    }
  }

  // ============================================================================
  // Status
  // ============================================================================

  getStatus(): IndexStatus {
    const fileCount = (this.stmtCountFiles.get() as { count: number } | undefined)?.count ?? 0;
    const symbolCount = (this.stmtCountSymbols.get() as { count: number } | undefined)?.count ?? 0;
    const chunkCount = (this.stmtCountChunks.get() as { count: number } | undefined)?.count ?? 0;
    const metaRow = this.stmtGetMeta.get('last_indexed_at') as { value: string } | undefined;
    const lastIndexedAt = metaRow ? parseInt(metaRow.value, 10) : null;

    // Consider stale if >5 minutes since last index
    const isStale = lastIndexedAt === null || (Date.now() - lastIndexedAt > 5 * 60 * 1000);

    return { totalFiles: fileCount, totalSymbols: symbolCount, totalChunks: chunkCount, lastIndexedAt, isStale };
  }

  getFileSymbols(filePath: string): ExtractedSymbol[] {
    const rows = this.stmtGetFileSymbols.all(filePath) as unknown as SymbolRow[];
    return rows.map(row => ({
      name: row.name,
      kind: row.kind as ExtractedSymbol['kind'],
      lineStart: row.line_start,
      lineEnd: row.line_end,
      signature: row.signature,
      docComment: row.doc_comment,
    }));
  }

  // ============================================================================
  // Private: Database
  // ============================================================================

  private initDb(): void {
    if (this.isEphemeral) {
      this.db = new DatabaseSync(':memory:');
    } else {
      const dbDir = join(this.projectPath, '.context-fabric');
      mkdirSync(dbDir, { recursive: true });
      const dbPath = join(dbDir, 'code-index.db');
      this.db = new DatabaseSync(dbPath);
    }
  }

  private initSchema(): void {
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS indexed_files (
        path        TEXT PRIMARY KEY,
        mtime_ms    INTEGER NOT NULL,
        size_bytes  INTEGER NOT NULL,
        language    TEXT NOT NULL,
        hash        TEXT NOT NULL,
        indexed_at  INTEGER NOT NULL,
        chunk_count INTEGER NOT NULL DEFAULT 0
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS symbols (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path   TEXT NOT NULL REFERENCES indexed_files(path) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        kind        TEXT NOT NULL,
        line_start  INTEGER NOT NULL,
        line_end    INTEGER,
        signature   TEXT,
        doc_comment TEXT
      )
    `);
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_symbols_kind ON symbols(kind)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file_path)');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chunks (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path   TEXT NOT NULL REFERENCES indexed_files(path) ON DELETE CASCADE,
        chunk_idx   INTEGER NOT NULL,
        line_start  INTEGER NOT NULL,
        line_end    INTEGER NOT NULL,
        content     TEXT NOT NULL,
        embedding   TEXT NOT NULL
      )
    `);
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file_path)');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS index_meta (
        key         TEXT PRIMARY KEY,
        value       TEXT NOT NULL,
        updated_at  INTEGER NOT NULL
      )
    `);
  }

  private prepareStatements(): void {
    this.stmtInsertFile = this.db.prepare(
      'INSERT OR REPLACE INTO indexed_files (path, mtime_ms, size_bytes, language, hash, indexed_at, chunk_count) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    this.stmtDeleteFile = this.db.prepare('DELETE FROM indexed_files WHERE path = ?');
    this.stmtUpdateMtime = this.db.prepare('UPDATE indexed_files SET mtime_ms = ? WHERE path = ?');
    this.stmtGetFile = this.db.prepare('SELECT * FROM indexed_files WHERE path = ?');
    this.stmtGetAllFiles = this.db.prepare('SELECT * FROM indexed_files');

    this.stmtInsertSymbol = this.db.prepare(
      'INSERT INTO symbols (file_path, name, kind, line_start, line_end, signature, doc_comment) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    this.stmtInsertChunk = this.db.prepare(
      'INSERT INTO chunks (file_path, chunk_idx, line_start, line_end, content, embedding) VALUES (?, ?, ?, ?, ?, ?)'
    );

    this.stmtSearchSymbolsByName = this.db.prepare(
      'SELECT s.*, f.language FROM symbols s JOIN indexed_files f ON s.file_path = f.path WHERE s.name LIKE ?'
    );
    this.stmtSearchSymbolsByKind = this.db.prepare(
      'SELECT s.*, f.language FROM symbols s JOIN indexed_files f ON s.file_path = f.path WHERE s.kind = ?'
    );
    this.stmtGetFileSymbols = this.db.prepare(
      'SELECT * FROM symbols WHERE file_path = ? ORDER BY line_start'
    );

    this.stmtCountFiles = this.db.prepare('SELECT COUNT(*) as count FROM indexed_files');
    this.stmtCountSymbols = this.db.prepare('SELECT COUNT(*) as count FROM symbols');
    this.stmtCountChunks = this.db.prepare('SELECT COUNT(*) as count FROM chunks');

    this.stmtGetMeta = this.db.prepare('SELECT value FROM index_meta WHERE key = ?');
    this.stmtSetMeta = this.db.prepare(
      'INSERT OR REPLACE INTO index_meta (key, value, updated_at) VALUES (?, ?, ?)'
    );

    this.stmtGetAllChunks = this.db.prepare('SELECT * FROM chunks');
  }

  // ============================================================================
  // Private: Chunking
  // ============================================================================

  private chunkContent(
    content: string,
    filePath: string,
    symbols: ExtractedSymbol[],
  ): Array<{ lineStart: number; lineEnd: number; content: string; header: string }> {
    const lines = content.split('\n');
    if (lines.length === 0) return [];

    const chunkSize = this.config.chunkLines;
    const overlap = this.config.chunkOverlap;
    const maxChunkSize = chunkSize + 50; // Allow some slack

    // Build a set of symbol boundaries for preferred split points
    const symbolStarts = new Set(symbols.map(s => s.lineStart - 1)); // 0-based

    const chunks: Array<{ lineStart: number; lineEnd: number; content: string; header: string }> = [];
    let pos = 0;

    while (pos < lines.length) {
      let end = Math.min(pos + chunkSize, lines.length);

      // Try to split at a symbol boundary if we're within range
      if (end < lines.length) {
        // Look for a symbol boundary near the target end
        let bestSplit = -1;
        for (let probe = end - 20; probe <= Math.min(end + 20, lines.length); probe++) {
          if (probe > pos && symbolStarts.has(probe)) {
            bestSplit = probe;
            break;
          }
        }
        if (bestSplit > 0 && bestSplit <= pos + maxChunkSize) {
          end = bestSplit;
        }
      }

      const chunkLines = lines.slice(pos, end);
      const header = `File: ${filePath} (lines ${pos + 1}-${end})\n`;

      chunks.push({
        lineStart: pos + 1,
        lineEnd: end,
        content: chunkLines.join('\n'),
        header,
      });

      // Advance with overlap
      pos = end - overlap;
      if (pos <= chunks[chunks.length - 1].lineStart - 1) {
        pos = end; // Prevent infinite loop
      }
    }

    return chunks;
  }
}

// ============================================================================
// Internal Row Types
// ============================================================================

interface FileRow {
  path: string;
  mtime_ms: number;
  size_bytes: number;
  language: string;
  hash: string;
  indexed_at: number;
  chunk_count: number;
}

interface SymbolRow {
  id: number;
  file_path: string;
  name: string;
  kind: string;
  line_start: number;
  line_end: number | null;
  signature: string | null;
  doc_comment: string | null;
}

interface ChunkRow {
  id: number;
  file_path: string;
  chunk_idx: number;
  line_start: number;
  line_end: number;
  content: string;
  embedding: string;
}

// ============================================================================
// Helpers
// ============================================================================

/** Simple glob matching: supports * and ** patterns. */
function matchGlob(filePath: string, pattern: string): boolean {
  // Convert glob to regex
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '{{DOUBLESTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/{{DOUBLESTAR}}/g, '.*')
    .replace(/\?/g, '.');

  return new RegExp(`^${regexStr}$`).test(filePath);
}
