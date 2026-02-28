# Context Fabric Architecture

Technical deep-dive into Context Fabric's system design, data flows, and implementation details. For contributors and advanced users who want to understand how it works under the hood.

---

## 1. System Overview

Context Fabric is an MCP (Model Context Protocol) server that provides persistent, multi-layered memory for AI coding agents. It runs locally with zero external dependencies, using Node.js 22.5+ built-in capabilities.

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           AI CLI (Kimi, Claude Code, etc.)                   │
│                    ┌─────────────────────────────────────┐                  │
│                    │   MCP Client (stdio / Docker)       │                  │
│                    └──────────────┬──────────────────────┘                  │
└───────────────────────────────────┼─────────────────────────────────────────┘
                                    │ JSON-RPC 2.0 over stdio
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Context Fabric MCP Server                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │   Server    │  │    Time     │  │   Smart     │  │   Pattern Extractor │ │
│  │   (MCP)     │──│   Service   │  │   Router    │  │                     │ │
│  └──────┬──────┘  └─────────────┘  └──────┬──────┘  └─────────────────────┘ │
│         │                                  │                                  │
│         └──────────────────────────────────┼──────────────────┐              │
│                                            ▼                  ▼              │
│                           ┌──────────────────────────────────────┐          │
│                           │         ContextEngine                 │          │
│                           │  (orchestrates all 3 memory layers)   │          │
│                           └──────────────────────────────────────┘          │
│                                            │                                 │
│           ┌────────────────────────────────┼────────────────────────────────┐│
│           ▼                                ▼                                ▼│
│  ┌─────────────────┐          ┌─────────────────┐          ┌───────────────┐│
│  │  L1: Working    │          │  L2: Project    │          │  L3: Semantic ││
│  │    Memory       │          │    Memory       │          │    Memory     ││
│  ├─────────────────┤          ├─────────────────┤          ├───────────────┤│
│  │ • In-memory Map │          │ • node:sqlite   │          │ • node:sqlite ││
│  │ • TTL-based     │          │ • Per-project   │          │ • Cross-proj  ││
│  │ • Session scope │          │ • Full-text     │          │ • Vector sim  ││
│  │ • LRU eviction  │          │ • Persistent    │          │ • Decay algo  ││
│  └─────────────────┘          └─────────────────┘          └───────────────┘│
│          ▲                            ▲                             ▲        │
│          └────────────────────────────┴─────────────────────────────┘        │
│                                    │                                         │
│                           ┌────────┴────────┐                                │
│                           │  Code Indexer   │                                │
│                           │  (optional)     │                                │
│                           └─────────────────┘                                │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Core Components

| Component | Purpose | Technology |
|-----------|---------|------------|
| **MCP Server** | JSON-RPC endpoint for CLI tools | `@modelcontextprotocol/sdk` |
| **ContextEngine** | Central orchestrator | TypeScript class |
| **Smart Router** | Auto-routes memories to layers | Rule-based classifier |
| **Time Service** | Timezone-aware timestamps | Native `Intl` API |
| **L1 Working** | Session-scratchpad storage | Native `Map` |
| **L2 Project** | Persistent project memory | `node:sqlite` |
| **L3 Semantic** | Cross-project vector search | `node:sqlite` + embeddings |
| **Code Index** | Source code indexing | File watcher + embeddings |

---

## 2. The Three Layers

Context Fabric uses a hierarchical memory architecture inspired by human memory systems:

### Layer Comparison

| Aspect | L1 Working | L2 Project | L3 Semantic |
|--------|-----------|------------|-------------|
| **Scope** | Single session | Per-project | Cross-project |
| **Storage** | In-memory Map | SQLite file | SQLite file |
| **Lifetime** | TTL-based (default 1h) | Permanent | Decay-based (14 days) |
| **Search** | Substring match | FTS5 BM25 + LIKE | FTS5 BM25 + Vector cosine |
| **Capacity** | 1000 entries (configurable) | Unlimited | Unlimited |
| **Eviction** | LRU + TTL | None (explicit delete) | Decay algorithm |

### 2.1 L1: Working Memory

Ephemeral session-scoped storage for transient context.

#### TypeScript Interface

```typescript
// src/layers/working.ts
interface WorkingMemoryEntry {
  memory: Memory;
  expiresAt: Date;
}

class WorkingMemoryLayer {
  private memories: Map<string, WorkingMemoryEntry>;
  private maxSize: number;        // default: 1000
  private defaultTTL: number;     // seconds, default: 3600 (1 hour)
}
```

#### Storage Strategy

```typescript
// TTL calculation
const effectiveTTL = ttl ?? this.defaultTTL;
const expiresAt = new Date(now.getTime() + effectiveTTL * 1000);

// LRU eviction when at capacity
private evictLRU(): void {
  let oldestId: string | null = null;
  let oldestTime = Infinity;

  for (const [id, entry] of this.memories) {
    const accessTime = entry.memory.lastAccessedAt 
      ? new Date(entry.memory.lastAccessedAt).getTime() 
      : 0;
    if (accessTime < oldestTime) {
      oldestTime = accessTime;
      oldestId = id;
    }
  }

  if (oldestId) {
    this.memories.delete(oldestId);
  }
}
```

#### Auto-Cleanup

```typescript
// Cleanup runs every 60 seconds
startCleanupInterval(intervalMs: number = 60000): void {
  this.cleanupIntervalId = setInterval(() => {
    this.cleanup();  // Deletes expired entries
  }, intervalMs);
}
```

### 2.2 L2: Project Memory

Persistent SQLite storage for project-specific context.

#### SQL Schema

```sql
-- Main memories table
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata TEXT,           -- JSON blob
  tags TEXT,               -- JSON array
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  access_count INTEGER DEFAULT 0,
  last_accessed_at INTEGER,
  pinned INTEGER NOT NULL DEFAULT 0  -- v0.5.5: exempt from summarization
);

-- Indexes for performance
CREATE INDEX idx_type ON memories(type);
CREATE INDEX idx_created ON memories(created_at);
CREATE INDEX idx_pinned ON memories(pinned);

-- FTS5 full-text search (v0.7, external content mode — no data duplication)
CREATE VIRTUAL TABLE memories_fts USING fts5(
  content, type,
  content='memories', content_rowid='rowid',
  tokenize='porter unicode61'
);

-- Triggers keep FTS in sync with the content table
CREATE TRIGGER memories_fts_insert AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, content, type) VALUES (NEW.rowid, NEW.content, NEW.type);
END;
CREATE TRIGGER memories_fts_delete AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content, type) VALUES('delete', OLD.rowid, OLD.content, OLD.type);
END;
CREATE TRIGGER memories_fts_update AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content, type) VALUES('delete', OLD.rowid, OLD.content, OLD.type);
  INSERT INTO memories_fts(rowid, content, type) VALUES (NEW.rowid, NEW.content, NEW.type);
END;

-- Tag relationships (many-to-many)
CREATE TABLE IF NOT EXISTS memory_tags (
  memory_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  PRIMARY KEY (memory_id, tag),
  FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
);
CREATE INDEX idx_tag ON memory_tags(tag);

-- Project metadata for time tracking
CREATE TABLE IF NOT EXISTS project_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
```

#### Prepared Statements

All SQL operations use prepared statements for performance:

```typescript
private prepareStatements(): void {
  this.stmtInsert = this.db.prepare(`
    INSERT INTO memories (id, type, content, metadata, tags, 
                         created_at, updated_at, access_count, pinned)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  this.stmtGetById = this.db.prepare('SELECT * FROM memories WHERE id = ?');
  
  this.stmtUpdateAccess = this.db.prepare(
    'UPDATE memories SET access_count = access_count + 1, 
                         last_accessed_at = ? WHERE id = ?'
  );
  
  this.stmtSearch = this.db.prepare(
    'SELECT * FROM memories WHERE content LIKE ? ORDER BY created_at DESC'
  );

  // FTS5 BM25-ranked keyword search (v0.7)
  this.stmtSearchBM25 = this.db.prepare(`
    SELECT m.*, fts.rank AS bm25_score
    FROM memories_fts AS fts
    JOIN memories AS m ON m.rowid = fts.rowid
    WHERE memories_fts MATCH ?
    ORDER BY fts.rank
    LIMIT ?
  `);
}
```

#### Access Tracking

Every read increments access count (for future ranking):

```typescript
async get(id: string): Promise<Memory | undefined> {
  this.stmtUpdateAccess.run(Date.now(), id);  // Auto-bump access
  const row = this.stmtGetById.get(id) as DatabaseRow | undefined;
  return row ? this.rowToMemory(row) : undefined;
}
```

### 2.3 L3: Semantic Memory

Cross-project vector storage with semantic similarity search.

#### SQL Schema

```sql
CREATE TABLE IF NOT EXISTS semantic_memories (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata TEXT NOT NULL,      -- JSON blob
  tags TEXT NOT NULL,          -- JSON array
  embedding TEXT NOT NULL,     -- JSON array of floats (384-dim)
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  accessed_at INTEGER NOT NULL,
  access_count INTEGER NOT NULL DEFAULT 0,
  relevance_score REAL NOT NULL DEFAULT 1.0,
  pinned INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_sem_type ON semantic_memories(type);
CREATE INDEX idx_sem_relevance ON semantic_memories(relevance_score);
CREATE INDEX idx_sem_pinned ON semantic_memories(pinned);

-- FTS5 full-text search (v0.7, external content mode)
CREATE VIRTUAL TABLE semantic_fts USING fts5(
  content, type,
  content='semantic_memories', content_rowid='rowid',
  tokenize='porter unicode61'
);

-- Same trigger pattern as L2 for insert/delete/update sync
```

#### Vector Search Flow

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Query Text     │────▶│  EmbeddingService │────▶│  Query Vector   │
│  "validation"   │     │  (fastembed-js)   │     │  [384 floats]   │
└─────────────────┘     └──────────────────┘     └────────┬────────┘
                                                          │
                                                          ▼
┌────────────────────────────────────────────────────────────────────┐
│                      L3 Semantic Layer                              │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  1. Fetch ALL memories (SELECT * FROM semantic_memories)    │  │
│  │  2. Parse JSON embedding for each                           │  │
│  │  3. Compute cosine similarity with query vector             │  │
│  │  4. Sort by similarity (DESC)                               │  │
│  │  5. Return top N results                                    │  │
│  └─────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘
```

#### Embedding Storage

Embeddings are stored as JSON arrays in SQLite:

```typescript
// Storage
const embedding = await this.embedder.embed(content);
this.stmtInsert.run(
  id, type, content,
  JSON.stringify(metadata),
  JSON.stringify(tags),
  JSON.stringify(embedding),  // [0.023, -0.156, ... 384 dims]
  now, now, now, pinned ? 1 : 0
);

// Retrieval
const embedding: number[] = JSON.parse(row.embedding);
```

---

## 3. Time Service

Comprehensive timezone handling using only Node.js built-in `Intl` API—no external timezone libraries.

### TimeAnchor Structure

```typescript
// src/time.ts
export interface TimeAnchor {
  // Core timestamps
  epochMs: number;              // 1740493800000
  iso: string;                  // "2026-02-25T14:30:00.000-05:00"
  timezone: string;             // "America/New_York"
  utcOffset: string;            // "-05:00"
  
  // Human-readable
  timeOfDay: string;            // "2:30 PM"
  date: string;                 // "Wednesday, February 25, 2026"
  dateShort: string;            // "Feb 25"
  dayOfWeek: string;            // "Wednesday"
  isWeekend: boolean;           // false
  weekNumber: number;           // 9 (ISO week)
  
  // Boundaries (epoch ms)
  startOfDay: number;
  endOfDay: number;
  startOfNextDay: number;
  startOfYesterday: number;
  startOfWeek: number;          // Monday
  endOfWeek: number;            // Sunday
  startOfNextWeek: number;
}
```

### Timezone Handling

The TimeService uses the `Intl.DateTimeFormat` API to handle timezones:

```typescript
function decomposeDateInTZ(epochMs: number, tz: string): DateParts {
  const fmtFull = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
    weekday: "long",
  });

  const parts = Object.fromEntries(
    fmtFull.formatToParts(new Date(epochMs)).map((p) => [p.type, p.value])
  );

  return {
    year: parseInt(parts.year, 10),
    month: parseInt(parts.month, 10),
    day: parseInt(parts.day, 10),
    hour: parseInt(parts.hour, 10),
    minute: parseInt(parts.minute, 10),
    second: parseInt(parts.second, 10),
    weekday: parts.weekday,
    weekdayShort: shortParts.weekday,
  };
}
```

### Natural Language Resolution

```typescript
resolve(expression: string, timezone?: string): number {
  const expr = expression.trim().toLowerCase();

  switch (expr) {
    case "now":       return nowMs;
    case "today":     return startOfDayMs(nowMs, tz);
    case "yesterday": return startOfDayMs(nowMs - 86400000, tz);
    case "tomorrow":  return startOfDayMs(nowMs + 86400000, tz);
  }

  // "next Monday" / "last Friday"
  const relMatch = expr.match(/^(next|last)\s+(monday|tuesday|...)$/);
  if (relMatch) {
    // Calculate day offset based on current weekday
  }

  // ISO date parsing fallback
  const parsed = Date.parse(expression);
  if (!isNaN(parsed)) return parsed;
}
```

---

## 4. Routing Logic

The SmartRouter automatically determines which memory layer to use based on content analysis.

### Priority Order

```
Priority 1: Explicit forceLayer parameter
     │
     ▼
Priority 2: Tag-based hints (temp, global, project)
     │
     ▼
Priority 3: TTL specified → L1
     │
     ▼
Priority 4: Content type-based routing
```

### Routing Rules

```typescript
// src/router.ts
static route(content, type, metadata, tags, ttl, forceLayer): RoutingDecision {
  // Priority 1: Forced layer
  if (forceLayer !== undefined) {
    return { layer: forceLayer, reason: 'Layer explicitly specified', confidence: 1.0 };
  }

  // Priority 2: Tag hints
  if (tags.includes('temp')) return { layer: L1, reason: "Tagged as 'temp'", confidence: 0.95 };
  if (tags.includes('global')) return { layer: L3, reason: "Tagged as 'global'", confidence: 0.95 };
  if (tags.includes('project')) return { layer: L2, reason: "Tagged as 'project'", confidence: 0.95 };

  // Priority 3: TTL implies temporary
  if (ttl !== undefined && ttl > 0) {
    return { layer: L1, reason: 'TTL specified', confidence: 0.9 };
  }

  // Priority 4: Content type routing
  switch (type) {
    case 'scratchpad':           → L1 (temporary notes)
    case 'code_pattern':         → L3 (reusable patterns)
    case 'convention':           → L3 (global conventions)
    case 'decision':             → L2 (project-specific)
    case 'bug_fix':              → L2 (project-specific)
    case 'relationship':         → L3 (user preferences)
    case 'message'|'thought':    → L1 (transient)
    case 'documentation':        → L2 (project docs)
    case 'error':                → L2 (project errors)
    default:                     → L2 (safe default)
  }
}
```

### Code Pattern Detection

For `code` type memories, the router analyzes content:

```typescript
private static routeCodeContent(content, metadata): RoutingDecision {
  const isPattern = looksLikePattern(content);   // Has functions/classes/etc
  const isGeneric = looksGeneric(content);       // Not business-specific

  if (isPattern && isGeneric) {
    return { layer: L3, reason: 'Reusable pattern', confidence: 0.85 };
  }

  if (metadata?.sessionContext) {
    return { layer: L1, reason: 'Session-specific', confidence: 0.75 };
  }

  return { layer: L2, reason: 'Project-specific code', confidence: 0.7 };
}

private static looksLikePattern(content): boolean {
  const indicators = [
    /function\s+\w+\s*\([^)]*\)\s*\{/,  // Function declaration
    /class\s+\w+/,                       // Class declaration
    /interface\s+\w+/,                   // Interface
    /export\s+(const|let|function)/,     // Export statement
    /@\w+\s*\(/,                         // Decorator
    /\/\*\*[\s\S]*?\*\//,                // JSDoc comment
  ];
  return indicators.some(p => p.test(content));
}
```

---

## 5. Embedding Strategy

### Model Selection

Context Fabric uses **fastembed-js** with the **BGESmallEN** model by default:

| Property | Value |
|----------|-------|
| **Model** | `Xenova/all-MiniLM-L6-v2` (via fastembed) |
| **Dimensions** | 384 |
| **Format** | ONNX Runtime |
| **Model Size** | ~80 MB |
| **Language** | English-optimized |
| **Cache** | LRU (10,000 entries) |

### EmbeddingService Implementation

```typescript
// src/embedding.ts
export class EmbeddingService {
  private model: FlagEmbedding | null = null;
  private cache: Map<string, number[]> = new Map();
  private modelName: EmbeddingModel = EmbeddingModel.BGESmallEN;
  private MAX_CACHE_SIZE = 10_000;

  async embed(text: string): Promise<number[]> {
    await this.init();
    
    // Check cache
    const cached = this.cache.get(text);
    if (cached) return cached;

    // Generate embedding
    const embedding = await this.model.embed([text]);
    const result = this.normalizeEmbedding(embedding);

    // Cache with LRU eviction
    this.evictIfNeeded();
    this.cache.set(text, result);
    
    return result;
  }

  getDimension(): number {
    return 384;  // BGESmallEN
  }
}
```

### Similarity Calculation

Cosine similarity computed in pure JavaScript:

```typescript
// src/layers/semantic.ts
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;  // Range: [-1, 1]
}
```

### Performance Characteristics

| Metric | Value |
|--------|-------|
| Embedding generation | ~50-100ms per text |
| Cache hit | <1ms |
| Similarity computation | ~1ms per 1000 memories |
| Memory per embedding | 384 × 8 bytes = ~3 KB |

---

## 6. Hybrid Search

Added in v0.7.0. `context.recall` supports three search modes, with hybrid as the default. This combines FTS5 keyword search with vector cosine similarity using Reciprocal Rank Fusion.

### Three Recall Modes

| Mode | L1 | L2 | L3 | Default |
|------|:--:|:--:|:--:|:-------:|
| **semantic** | Substring | `LIKE '%query%'` | Vector cosine | |
| **keyword** | Substring | FTS5 BM25 | FTS5 BM25 | |
| **hybrid** | Substring | FTS5 BM25 via RRF | FTS5 BM25 + Vector cosine via RRF | Yes |

L1 always uses substring matching — it's in-memory with no FTS or embeddings.

### FTS5 Implementation

Both L2 and L3 have FTS5 virtual tables using the `porter unicode61` tokenizer (stemming + Unicode normalization). They use external content mode — the virtual table stores no data, reading from the main table via rowid. Triggers keep the FTS index in sync on every INSERT, DELETE, and UPDATE.

The `searchBM25()` method on both layers runs a JOIN between the FTS table and the content table, ordering by BM25 rank:

```sql
SELECT m.*, fts.rank AS bm25_score
FROM memories_fts AS fts
JOIN memories AS m ON m.rowid = fts.rowid
WHERE memories_fts MATCH ?
ORDER BY fts.rank  -- lower = more relevant in SQLite's BM25 convention
LIMIT ?
```

BM25 scores in SQLite are negative (lower = more relevant). The engine normalizes them to [0, 1] using:

```typescript
static normalizeBM25(score: number): number {
  return 1 / (1 + Math.abs(score));
}
```

### Reciprocal Rank Fusion (RRF)

In hybrid mode, two independent rankers produce candidate lists:

1. **Keyword ranker**: FTS5 BM25 on L2 + L3
2. **Semantic ranker**: Vector cosine similarity on L3

The lists are fused using RRF (Cormack et al.):

```
RRF_score(d) = sum( 1 / (k + rank_i(d)) )   where k=60, rank is 1-based
```

Implementation details:
- Over-fetches `limit * 2` from each ranker for better fusion quality
- Deduplicates by memory ID, keeping the version with higher original similarity
- Normalizes final scores to [0, 1] (top result = 1.0, rest proportional)
- Applies weight multiplier after fusion: `score * (weight / 3)`

```typescript
static fuseRRF(
  listA: RankedMemory[],   // keyword results
  listB: RankedMemory[],   // semantic results
  limit: number,
  k = 60,
): RankedMemory[] {
  const scoreMap = new Map<string, { score: number; memory: RankedMemory }>();

  for (let i = 0; i < listA.length; i++) {
    const rrfScore = 1 / (k + i + 1);
    // accumulate + deduplicate by ID
  }
  for (let i = 0; i < listB.length; i++) {
    const rrfScore = 1 / (k + i + 1);
    // accumulate + deduplicate by ID
  }

  // Sort by RRF score, take top limit
  // Normalize to [0, 1]: score / maxScore
  return sorted.map(({ score, memory }) => ({
    ...memory,
    similarity: score / maxScore,
  }));
}
```

The normalization ensures threshold filtering (default 0.7 in `context.recall`) remains meaningful regardless of mode.

### Data Flow (Hybrid Mode)

```
context.recall("auth middleware", mode="hybrid")
     │
     ├──▶ Keyword Ranker
     │      ├── L2: searchBM25("auth middleware") → BM25 results
     │      └── L3: searchBM25("auth middleware") → BM25 results
     │
     ├──▶ Semantic Ranker
     │      └── L3: recall("auth middleware") → cosine results
     │
     └──▶ RRF Fusion
            ├── Score each doc: sum(1/(60 + rank))
            ├── Deduplicate by memory ID
            ├── Normalize to [0, 1]
            ├── Apply weight multiplier
            └── Return top N results
```

---

## 7. Decay Algorithm

L3 memories use a time-based decay mechanism to gradually remove stale, unaccessed entries.

### Formula Recap

```
relevance_score = max(0, (ageDecay × 0.3 + inactivityPenalty × 0.7) + accessBoost)

Where:
  ageDecay = exp(-age / (decayDays × 2 × msPerDay))
  inactivityPenalty = exp(-timeSinceAccess / (decayDays × msPerDay))
  accessBoost = min(accessCount / 10, 0.5)
  
Deletion threshold: relevance_score < 0.2 (default)
```

### Implementation

```typescript
// src/layers/semantic.ts
async applyDecay(): Promise<number> {
  const rows = this.stmtGetAll.all() as DbRow[];
  const now = Date.now();
  const decayMs = this.decayDays * 24 * 60 * 60 * 1000;

  for (const row of rows) {
    if (row.pinned === 1) continue;  // Pinned = exempt

    const age = now - row.created_at;
    const timeSinceAccess = now - row.accessed_at;

    const ageDecay = Math.exp(-age / (decayMs * 2));
    const accessBoost = Math.min(row.access_count / 10, 0.5);
    const inactivityPenalty = Math.exp(-timeSinceAccess / decayMs);
    
    const newScore = Math.max(0, 
      (ageDecay * 0.3 + inactivityPenalty * 0.7) + accessBoost
    );

    if (newScore < this.decayThreshold) {
      this.stmtDelete.run(row.id);        // Hard delete
    } else if (Math.abs(newScore - row.relevance_score) > 0.01) {
      this.stmtUpdateScore.run(newScore, now, row.id);  // Update score
    }
  }
}
```

### Decay Schedule

Decay runs on two triggers:

1. **`context.orient` call** — fire-and-forget at session start. Non-blocking (uses `.then()` so the orient response returns immediately).
2. **Hourly interval** — `setInterval` while the engine is active.

```typescript
// Trigger 1: Fire-and-forget on orient()
this.l3.applyDecay().then((pruned) => {
  if (pruned > 0) this.log('debug', `orient: pruned ${pruned} stale L3 memories`);
}).catch((err) => {
  this.log('warn', 'orient: L3 decay failed:', err);
});

// Trigger 2: Hourly interval
private startDecayInterval(): void {
  this.cleanupIntervalId = setInterval(async () => {
    const affected = await this.l3.applyDecay();
    if (affected > 0) {
      this.log('debug', `Applied decay to ${affected} L3 memories`);
    }
  }, 3600000);  // Every hour
}
```

### Visual Decay Curve

```
Relevance Score
    1.0 ┤███████
        │      ╲
    0.8 ┤       ╲  access
        │        ╲████
    0.6 ┤             ╲
        │              ╲
    0.4 ┤               ╲
        │                ╲
    0.2 ┤─────────────────╲────── threshold
        │                  ╲█████
    0.0 ┼────┬────┬────┬────┬────┬────▶ Time
        Day1 Day3 Day7 Day10 Day14 Day20
        
        (14-day decay period, default configuration)
```

---

## 8. Context Window Construction

The `getContextWindow()` method assembles relevant context for CLI injection.

### Assembly Process

```typescript
// src/engine.ts
async getContextWindow(cliCapabilities?: CLICapability): Promise<ContextWindow> {
  const maxWorking = this.config.context.maxWorkingMemories;    // 10
  const maxRelevant = this.config.context.maxRelevantMemories;  // 10
  const maxPatterns = this.config.context.maxPatterns;          // 5

  // Step 1: L1 - Get all working memories
  const working = this.l1.getAll().slice(0, maxWorking);

  // Step 2: L2 - Get recent project memories
  const recentL2 = await this.l2.getRecent(5);

  // Step 3: L3 - Semantic search using working context as query
  const l3Relevant: ScoredMemory[] = [];
  if (working.length > 0) {
    const query = working.slice(0, 3).map(m => m.content).join(' ');
    const semanticResults = await this.l3.recall(query, 5);
    l3Relevant.push(...semanticResults);
  }

  // Step 4: Combine and weight
  const relevant: Memory[] = [
    ...recentL2.map(m => ({ 
      ...m, 
      relevanceScore: 0.8 * ((m.metadata?.weight ?? 3) / 3) 
    })),
    ...l3Relevant.map(m => ({ 
      ...m, 
      relevanceScore: m.similarity * ((m.metadata?.weight ?? 3) / 3) 
    })),
  ]
  .sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0))
  .slice(0, maxRelevant);

  // Step 5: Extract patterns
  const patterns = await this.patternExtractor.extractPatterns(this.projectPath);
  const rankedPatterns = this.patternExtractor.rankPatterns(patterns, { 
    language: working.find(m => m.metadata?.fileContext?.language)?.metadata?.fileContext?.language 
  });

  // Step 6: Generate ghost messages and suggestions
  const ghostMessages = await this.generateGhostMessages(working, relevant);
  const suggestions = await this.generateSuggestions(working, relevant, rankedPatterns);

  return {
    working,
    relevant,
    patterns: rankedPatterns.slice(0, maxPatterns),
    suggestions: suggestions.slice(0, maxSuggestions),
    ghostMessages,
  };
}
```

**Weight multiplier**: The `metadata.weight` field (integer 1-5, default 3) scales relevance scores during ranking. L2 memories start with a base score of `0.8`, L3 memories use their cosine similarity. Both are multiplied by `weight / 3`:

| Weight | Multiplier | Effect |
|:------:|:----------:|:-------|
| 5 | 1.67x | Critical — surfaces above everything |
| 4 | 1.33x | Important |
| 3 | 1.0x | Neutral (default) |
| 2 | 0.67x | Low priority |
| 1 | 0.33x | Near-throwaway |

### Context Window Structure

```typescript
interface ContextWindow {
  working: Memory[];           // L1: Current session context
  relevant: Memory[];          // L2+L3: Project-relevant memories
  patterns: CodePattern[];     // Detected code patterns
  suggestions: Suggestion[];   // AI-generated action suggestions
  ghostMessages: GhostMessage[];  // Silent context injections
}

interface GhostMessage {
  id: string;
  role: "system" | "user" | "assistant";
  content: string;
  timestamp: Date;
  isVisible: false;  // Always false for ghost messages
  trigger: string;   // What triggered this message
}
```

---

## 9. Event Handling

CLI events trigger automatic memory capture.

### Supported Events

| Event | Layer | Auto-Action |
|-------|-------|-------------|
| `file_opened` | L1 | Store scratchpad entry |
| `command_executed` | L1 | Store command + output |
| `error_occurred` | L2 | Store bug fix memory |
| `decision_made` | L2 | Store architectural decision |
| `session_start` | L1 | Initialize session marker |
| `session_end` | L1 | Store session end marker |
| `pattern_detected` | L3 | Store reusable pattern |
| `user_feedback` | L3 | Store preference |

### Event Handler Flow

```
┌─────────────────┐
│   CLI Event     │
│  (file opened,  │
│   error, etc.)  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  EventHandler   │
│  .handleEvent() │
└────────┬────────┘
         │
    ┌────┴────┬────────┬────────┬────────┐
    ▼         ▼        ▼        ▼        ▼
┌───────┐ ┌───────┐ ┌─────┐ ┌─────┐ ┌────────┐
│ File  │ │ Cmd   │ │ Err │ │ Pat │ │ Decis  │
│ Opened│ │ Exec  │ │ Occ │ │ Det │ │ Made   │
└───┬───┘ └───┬───┘ └──┬──┘ └──┬──┘ └───┬────┘
    │         │        │       │        │
    ▼         ▼        ▼       ▼        ▼
┌─────────────────────────────────────────────┐
│           ContextEngine.store()              │
│    (routes to appropriate layer)             │
└─────────────────────────────────────────────┘
```

### Auto-Capture Example

```typescript
// src/events.ts
async handleErrorOccurred(error: string, context?: string): Promise<EventResult> {
  const content = context
    ? `Error: ${error}\nContext: ${context}`
    : `Error: ${error}`;

  const memory = await this.engine.store(content, 'bug_fix', {
    layer: 2,  // L2 - project-specific
    metadata: {
      error,
      context,
      source: 'system_auto',
      cliType: event?.cliType || 'generic',
    },
    tags: ['error', 'bug_fix', 'auto_capture'],
  });

  return {
    processed: true,
    memoryId: memory.id,
    triggeredActions: ['stored_bug_fix'],
  };
}
```

---

## 10. Code Indexer

The Code Indexer (`src/indexer/code-index.ts`) provides source code search via `context.searchCode`. It is lazily initialized on first use and shares the L3 embedding service to avoid loading the ONNX model twice.

### Search Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| **text** | Full-text search across file contents | Find specific strings or patterns |
| **symbol** | Find functions, classes, interfaces, types by name | Navigate to definitions |
| **semantic** | Natural-language embedding similarity | "how does memory get promoted" |

### How It Works

1. **Indexing**: On first `searchCode` call (or `context.orient`), the indexer scans the project directory
2. **Chunking**: Files are split into chunks (default 150 lines, 10-line overlap) for granular results
3. **Symbol extraction**: Parses source files to extract function, class, interface, type, enum, const, and export declarations
4. **Embedding**: For semantic mode, chunks are embedded using the same ONNX model as L3
5. **File watching**: Optional file watcher re-indexes changed files automatically

### Configuration

```yaml
codeIndex:
  enabled: true
  maxFileSizeBytes: 1048576  # 1MB
  maxFiles: 10000
  chunkLines: 150
  chunkOverlap: 10
  debounceMs: 500
  watchEnabled: true
  excludePatterns: []
```

### Initialization

The code index is created lazily and updated incrementally on each `context.orient` call:

```typescript
// Lazy initialization (engine.ts)
getCodeIndex(): CodeIndex {
  if (!this.codeIndex) {
    this.codeIndex = new CodeIndex({
      projectPath: this.projectPath,
      embeddingService: this.l3.getEmbeddingService(),  // shared model
      config: this.config.codeIndex,
    });
  }
  return this.codeIndex;
}

// Fire-and-forget update on orient()
if (this.config.codeIndex.enabled) {
  const idx = this.getCodeIndex();
  idx.ensureReady().then(() => idx.incrementalUpdate());
}
```

---

## 11. Data Flow

### Storage Flow

```
User/AI ──store()──▶ ContextEngine
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
    SmartRouter    L1 Working       L2/L3 Prep
          │         Memory             │
          │           │                ▼
          │           │          ┌──────────┐
          │           │          │ SQLite   │
          │           │          │ Insert   │
          │           │          └────┬─────┘
          │           │               │
          ▼           ▼               ▼
    ┌─────────────────────────────────────────┐
    │         Routing Decision               │
    │  L1: Map.set(id, {memory, expiresAt})  │
    │  L2: stmtInsert.run(...)               │
    │  L3: embed() → stmtInsert.run(...)     │
    └─────────────────────────────────────────┘
```

### Retrieval Flow (Hybrid Mode — Default)

```
User/AI ──recall(query, mode="hybrid")──▶ ContextEngine
                                              │
                    ┌─────────────────────────┼─────────────────────────┐
                    ▼                         ▼                         ▼
             L1 Substring              Keyword Ranker             Semantic Ranker
             (fallback)                    │                           │
                    │              ┌───────┴───────┐                  │
                    │              ▼               ▼                  ▼
                    │        L2 FTS5 BM25    L3 FTS5 BM25       L3 Vector
                    │        (memories_fts)  (semantic_fts)      (cosine sim)
                    │              │               │                  │
                    │              └───────┬───────┘                  │
                    │                      ▼                          ▼
                    │              ┌─────────────────────────────────────┐
                    │              │     Reciprocal Rank Fusion (RRF)    │
                    │              │  score(d) = sum(1/(60 + rank_i(d))) │
                    │              │  Deduplicate → Normalize to [0,1]  │
                    │              └─────────────────┬───────────────────┘
                    │                                │
                    ▼                                ▼
              ┌──────────────────────────────────────────────┐
              │           Merge & Weight-Adjust              │
              │  score * (metadata.weight / 3)               │
              │  Sort DESC → Limit to requested count        │
              └──────────────────────────────────────────────┘
```

---

## 12. Performance

### Memory Usage

| Component | Base | Per Entry | Notes |
|-----------|------|-----------|-------|
| **L1 Working** | ~50 KB | ~2 KB | Includes metadata objects |
| **L2 Project** | ~100 KB | ~1 KB | SQLite overhead amortized |
| **L3 Semantic** | ~200 KB | ~4 KB | Includes embedding (3 KB) |
| **Embedding Model** | ~80 MB | - | Loaded once, shared |
| **Embedding Cache** | - | ~3 KB | LRU (max 10,000) |

### Query Performance

| Operation | Typical | Worst Case | Notes |
|-----------|---------|------------|-------|
| L1 get by ID | <0.1ms | <0.1ms | Map lookup O(1) |
| L1 get all | <1ms | <5ms | 1000 entries max |
| L2 get by ID | <1ms | <5ms | Indexed lookup |
| L2 LIKE search | <10ms | <100ms | Full table scan |
| L2 FTS5 BM25 | <5ms | <20ms | Inverted index O(log N) |
| L3 get by ID | <1ms | <5ms | Indexed lookup |
| L3 FTS5 BM25 | <5ms | <20ms | Inverted index O(log N) |
| L3 semantic search | <100ms | <500ms | O(N) cosine similarity |
| Hybrid recall (RRF) | <120ms | <600ms | Both rankers + fusion |
| Embedding generation | 50-100ms | 200ms | Cold vs cached |
| Context window build | <200ms | <500ms | All layers + ranking |

### Scaling Characteristics

```
L1 Working Memory:
  Max entries: 1,000 (configurable)
  Performance: Constant O(1) for all ops
  Bottleneck: Memory capacity

L2 Project Memory:
  Expected: 1,000 - 10,000 memories
  Performance: O(log N) indexed lookups
  Bottleneck: SQLite file I/O

L3 Semantic Memory:
  Expected: 100 - 5,000 memories
  Performance: O(N) for similarity (brute force)
  Bottleneck: Embedding comparison loop
```

### Bottlenecks & Mitigations

| Bottleneck | Impact | Mitigation |
|------------|--------|------------|
| **L3 brute-force search** | O(N) scan all memories | Acceptable for <5K memories. FTS5 keyword mode avoids this entirely. |
| **Hybrid mode overhead** | Runs both rankers | ~10-20ms over pure semantic. Over-fetch (`limit*2`) improves fusion quality. |
| **Embedding cold start** | ~80MB model load | Pre-warm in Docker; shared instance |
| **SQLite concurrency** | Write locking | WAL mode enabled; mostly read-heavy |
| **Memory growth (L1)** | Unbounded growth | LRU eviction at 1000 entries |
| **Decay overhead** | Hourly full table scan | Pinned filter; async fire-and-forget |

### Optimization Strategies

```typescript
// 1. Prepared statements (all layers)
this.stmtGetById = this.db.prepare('SELECT * FROM memories WHERE id = ?');
// Reuse for all lookups - avoids SQL parse overhead

// 2. Embedding cache (L3)
private cache: Map<string, number[]>;
// Eliminates redundant embedding generation

// 3. Lazy loading (Code Index)
getCodeIndex(): CodeIndex {
  if (!this.codeIndex) {
    this.codeIndex = new CodeIndex({...});  // Create on first use
  }
  return this.codeIndex;
}

// 4. Async decay (non-blocking)
this.l3.applyDecay().then(pruned => {...});  // Fire-and-forget

// 5. WAL mode (SQLite)
this.db.exec('PRAGMA journal_mode = WAL');  // Better concurrency
```

---

## Appendix: Type Definitions

### Core Types (src/types.ts)

```typescript
type MemoryType = 
  | "code_pattern" | "bug_fix" | "decision" 
  | "convention" | "scratchpad" | "relationship"
  | "code" | "message" | "thought" | "observation" 
  | "documentation" | "error" | "summary";

enum MemoryLayer {
  L1_WORKING = 1,
  L2_PROJECT = 2,
  L3_SEMANTIC = 3,
}

interface Memory {
  id: string;
  type: MemoryType;
  layer?: MemoryLayer;
  content: string;
  metadata?: MemoryMetadata;
  tags?: string[];
  embedding?: number[];
  createdAt: Date | number;
  updatedAt: Date | number;
  accessCount?: number;
  lastAccessedAt?: Date | number;
  ttl?: number;
  pinned?: boolean;
}

interface MemoryMetadata {
  title?: string;
  tags: string[];
  fileContext?: FileContext;
  codeBlock?: CodeBlock;
  sessionContext?: SessionContext;
  relationships: RelationshipEdge[];
  confidence: number;
  expirationDate?: Date;
  source: "user_explicit" | "ai_inferred" | "system_auto";
  projectPath?: string;
  cliType: string;
  weight?: number;  // 1-5 priority
}
```

---

*This architecture documentation covers Context Fabric through v0.7.1. For the latest updates, see the [CHANGELOG](../CHANGELOG.md).*
