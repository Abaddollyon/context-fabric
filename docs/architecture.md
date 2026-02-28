# Architecture

How Context Fabric works under the hood. Read this if you want to contribute, extend the system, or understand the design trade-offs.

## Table of Contents

- [System Overview](#system-overview)
- [The Three Layers](#the-three-layers)
  - [L1: Working Memory](#l1-working-memory)
  - [L2: Project Memory](#l2-project-memory)
  - [L3: Semantic Memory](#l3-semantic-memory)
- [Hybrid Search](#hybrid-search)
  - [Three Recall Modes](#three-recall-modes)
  - [FTS5 Full-Text Search](#fts5-full-text-search)
  - [Reciprocal Rank Fusion (RRF)](#reciprocal-rank-fusion-rrf)
- [Time Service](#time-service)
- [Routing Logic](#routing-logic)
- [Embedding Strategy](#embedding-strategy)
- [Decay Algorithm](#decay-algorithm)
- [Context Window Construction](#context-window-construction)
- [Code Indexer](#code-indexer)
- [Event Handling](#event-handling)
- [Data Flow](#data-flow)
- [Performance](#performance)

## System Overview

Context Fabric is an MCP server that communicates with CLI tools over stdio using the JSON-RPC protocol. The server can run locally via Node.js or inside a Docker container.

```mermaid
graph TB
    subgraph Clients["CLI Tools"]
        K["Kimi"]
        CC["Claude Code"]
        OC["OpenCode"]
        CX["Codex CLI"]
        GC["Gemini CLI"]
        CR["Cursor"]
    end

    subgraph Server["Context Fabric MCP Server"]
        TH["Tool Handlers\n12 MCP tools"]
        CE["Context Engine\nOrchestrator"]
        SR["Smart Router\ncontent → layer"]
        TS["Time Service\nIANA tz, anchors, gaps"]

        subgraph Layers["Memory Layers"]
            L1["L1: Working Memory\nIn-memory, TTL, LRU"]
            L2["L2: Project Memory\nSQLite, per-project"]
            L3["L3: Semantic Memory\nSQLite + embeddings"]
        end

        subgraph Services["Supporting Services"]
            ES["Embedding Service\nfastembed-js / ONNX"]
            PE["Pattern Extractor"]
            EH["Event Handler"]
        end

        TH --> CE
        CE --> SR
        CE --> TS
        CE --> L1
        CE --> L2
        CE --> L3
        CE --> ES
        CE --> PE
        CE --> EH
    end

    Clients -->|"MCP Protocol\n(JSON-RPC over stdio)"| TH

    style L1 fill:#fef3c7,stroke:#f59e0b
    style L2 fill:#dbeafe,stroke:#3b82f6
    style L3 fill:#ede9fe,stroke:#8b5cf6
```

### Key Design Decisions

- **Zero external services**: All storage is SQLite (`node:sqlite` built-in), all vector search is in-process. No external databases, no API keys.
- **Node.js 22.5+**: Required for the built-in `node:sqlite` module, which provides synchronous SQLite access with zero native dependencies.
- **Stdio transport**: MCP tools communicate over stdin/stdout using JSON-RPC. This works identically whether the server runs as a local process or inside Docker.
- **Per-project engines**: Each unique `projectPath` gets its own `ContextEngine` instance with isolated L2 state. L3 is shared globally.

## The Three Layers

### L1: Working Memory

Ephemeral session-scoped context stored in an in-memory `Map`.

```typescript
class WorkingMemoryLayer {
  private memories: Map<string, WorkingMemoryEntry>;
  private maxSize: number = 1000;
  private defaultTTL: number = 3600; // 1 hour

  store(content, type, metadata, ttl?): Memory
  get(id): Memory | undefined
  getAll(): Memory[]
  cleanup(): number // removes expired entries
}
```

- **TTL-based**: Each entry has an expiration timestamp. Expired entries are cleaned up periodically.
- **LRU eviction**: When `maxSize` is reached, the least-recently-used entry is evicted.
- **No persistence**: All data is lost on server restart. This is by design — L1 is for scratch data.

### L2: Project Memory

Persistent project-specific knowledge stored in SQLite.

```typescript
class ProjectMemoryLayer {
  private db: DatabaseSync;       // from node:sqlite
  private projectPath: string;

  store(content, type, metadata, tags?): Memory
  get(id): Memory | undefined
  search(query): Memory[]
  summarize(olderThanDays): SummaryResult
  getLastSeen(): number | null
  updateLastSeen(): void
  getMemoriesSince(epochMs): Memory[]
}
```

**Schema:**

```sql
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata TEXT,                    -- JSON blob
  tags TEXT,                        -- JSON array
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  access_count INTEGER DEFAULT 0,
  last_accessed_at INTEGER,
  pinned INTEGER NOT NULL DEFAULT 0 -- v0.5.5: exempt from summarization
);

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
CREATE TRIGGER memories_fts_insert AFTER INSERT ON memories BEGIN ... END;
CREATE TRIGGER memories_fts_delete AFTER DELETE ON memories BEGIN ... END;
CREATE TRIGGER memories_fts_update AFTER UPDATE ON memories BEGIN ... END;

CREATE TABLE project_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
```

The `project_meta` table stores per-project metadata. The `last_seen` key is used by `context.orient` to detect offline gaps between sessions. The FTS5 virtual table enables BM25-ranked keyword search via `searchBM25()`.

### L3: Semantic Memory

Long-term cross-project knowledge with vector search.

```typescript
class SemanticMemoryLayer {
  private db: DatabaseSync;       // from node:sqlite
  private embedder: EmbeddingService;
  private decayDays: number = 14;
  private decayThreshold: number = 0.2;

  store(content, type, metadata): Memory
  recall(query, limit): ScoredMemory[]       // vector cosine similarity
  searchBM25(query, limit): BM25Result[]     // FTS5 keyword search
  applyDecay(): number                       // returns count of deleted memories
}
```

**Vector search flow:**

```mermaid
sequenceDiagram
    participant Client
    participant L3 as L3: Semantic Memory
    participant Embed as Embedding Service
    participant DB as SQLite

    Client->>L3: recall("auth error handling", limit=5)
    L3->>Embed: embed("auth error handling")
    Embed-->>L3: queryVector [0.12, -0.34, ...]
    L3->>DB: SELECT * FROM memories
    DB-->>L3: All rows with embedding vectors
    L3->>L3: Compute cosine similarity for each row
    L3->>L3: Sort by similarity, take top 5
    L3-->>Client: ScoredMemory[] (with similarity scores)
```

Embedding vectors are stored as JSON arrays in a `TEXT` column. Cosine similarity is computed in-process — a full linear scan over all rows. This is fast for typical memory counts (under 10K entries).

**L3 schema:**

```sql
CREATE TABLE semantic_memories (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata TEXT NOT NULL,          -- JSON blob
  tags TEXT NOT NULL,              -- JSON array
  embedding TEXT NOT NULL,         -- JSON array of 384 floats
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  accessed_at INTEGER NOT NULL,
  access_count INTEGER NOT NULL DEFAULT 0,
  relevance_score REAL NOT NULL DEFAULT 1.0,
  pinned INTEGER NOT NULL DEFAULT 0
);

-- FTS5 full-text search (v0.7, external content mode)
CREATE VIRTUAL TABLE semantic_fts USING fts5(
  content, type,
  content='semantic_memories', content_rowid='rowid',
  tokenize='porter unicode61'
);
```

Both L2 and L3 use FTS5 external content mode, which avoids duplicating data. Triggers on INSERT/DELETE/UPDATE keep the FTS index in sync automatically.

## Hybrid Search

Added in v0.7.0. `context.recall` supports three search modes, with hybrid as the default.

### Three Recall Modes

| Mode | L1 | L2 | L3 | Default |
|------|:--:|:--:|:--:|:-------:|
| **semantic** | Substring match | `LIKE '%query%'` | Vector cosine similarity | |
| **keyword** | Substring match | FTS5 BM25 | FTS5 BM25 | |
| **hybrid** | Substring match | FTS5 BM25 + vector cosine (RRF) | FTS5 BM25 + vector cosine (RRF) | Yes |

L1 always uses substring matching since it is in-memory with no FTS or embeddings.

### FTS5 Full-Text Search

Both L2 and L3 have FTS5 virtual tables using the `porter unicode61` tokenizer (stemming + Unicode normalization). FTS5 uses external content mode — the virtual table stores no data, reading from the main table via rowid. Triggers keep it in sync.

The `searchBM25()` method on both layers runs:

```sql
SELECT m.*, fts.rank AS bm25_score
FROM memories_fts AS fts
JOIN memories AS m ON m.rowid = fts.rowid
WHERE memories_fts MATCH ?
ORDER BY fts.rank  -- lower = more relevant in SQLite's BM25 convention
LIMIT ?
```

BM25 scores in SQLite are negative (lower = more relevant). The engine normalizes them to [0, 1] using `1 / (1 + |score|)` before ranking.

### Reciprocal Rank Fusion (RRF)

In hybrid mode, two rankers run independently:

1. **Keyword ranker**: FTS5 BM25 on L2 + L3 (via `searchBM25()`)
2. **Semantic ranker**: Vector cosine similarity on L3 (via `recall()`)

Their results are fused using RRF:

```
RRF_score(d) = sum( 1 / (k + rank_i(d)) )   where k=60, rank is 1-based
```

The algorithm:
1. Fetch `limit * 2` candidates from each ranker (over-fetch for better fusion)
2. Score each document by summing `1 / (k + rank)` across both lists
3. Deduplicate by memory ID, keeping the version with higher original similarity
4. Normalize final scores to [0, 1] so threshold filtering (default 0.7) remains meaningful
5. Apply weight multiplier: `score * (weight / 3)` where weight defaults to 3

```mermaid
sequenceDiagram
    participant CLI
    participant Engine as Context Engine
    participant L2FTS as L2: FTS5
    participant L3FTS as L3: FTS5
    participant L3Vec as L3: Vector

    CLI->>Engine: recall("auth middleware", mode="hybrid")
    Engine->>L2FTS: searchBM25("auth middleware")
    Engine->>L3FTS: searchBM25("auth middleware")
    Engine->>L3Vec: recall("auth middleware")
    L2FTS-->>Engine: BM25 results
    L3FTS-->>Engine: BM25 results
    L3Vec-->>Engine: cosine results
    Engine->>Engine: Fuse keyword + semantic via RRF
    Engine->>Engine: Normalize to [0,1], apply weight multiplier
    Engine-->>CLI: RankedMemory[] (hybrid scores)
```

## Time Service

The `TimeService` (`src/time.ts`) provides timezone-aware time utilities using only the built-in `Intl` API. No external date libraries.

### Capabilities

| Method | Description |
|--------|-------------|
| `now(tz?)` | Full `TimeAnchor` with UTC offset, day/week boundaries, ISO week number |
| `atTime(epochMs, tz?)` | Build a `TimeAnchor` for an arbitrary moment |
| `resolve(expression, tz?)` | Natural-language date resolver |
| `convert(epochMs, tz)` | World-clock conversion to any IANA timezone |
| `formatDuration(ms)` | Human-readable duration (`"3 hours 42 minutes"`) |
| `formatRelative(epochMs)` | Relative time (`"5 minutes ago"`, `"in 2 hours"`) |

### TimeAnchor Structure

A `TimeAnchor` is a rich time snapshot containing everything an AI needs to reason about time:

```typescript
interface TimeAnchor {
  epochMs: number;          // Unix timestamp
  iso: string;              // "2026-02-25T14:30:00.000-05:00"
  timezone: string;         // "America/New_York"
  utcOffset: string;        // "-05:00"
  timeOfDay: string;        // "2:30 PM"
  date: string;             // "Wednesday, February 25, 2026"
  dateShort: string;        // "Feb 25"
  dayOfWeek: string;        // "Wednesday"
  isWeekend: boolean;
  weekNumber: number;       // ISO week number
  // Day and week boundaries (epoch ms)
  startOfDay: number;
  endOfDay: number;
  startOfNextDay: number;
  startOfYesterday: number;
  startOfWeek: number;      // Monday
  endOfWeek: number;        // End of Sunday
  startOfNextWeek: number;
}
```

### Orientation Flow

The `context.orient` tool combines the Time Service with L2's `project_meta` table to detect offline gaps:

```mermaid
sequenceDiagram
    participant CLI
    participant Orient as context.orient
    participant TS as TimeService
    participant L2 as L2 Project Memory

    CLI->>Orient: orient(timezone?, projectPath?)
    Orient->>TS: now(timezone)
    TS-->>Orient: TimeAnchor
    Orient->>L2: getLastSeen()
    L2-->>Orient: lastSeenEpochMs | null

    alt First session
        Orient-->>CLI: summary: "First session in this project"
    else Returning session
        Orient->>L2: getMemoriesSince(lastSeenEpochMs)
        L2-->>Orient: recentMemories[]
        Orient->>TS: formatDuration(now - lastSeen)
        TS-->>Orient: "14 hours 23 minutes"
        Orient-->>CLI: summary + offlineGap + recentMemories
    end

    Orient->>L2: updateLastSeen(now)
```

## Routing Logic

The Smart Router analyzes content type, tags, and TTL to determine the optimal storage layer. See [Memory Types > Smart Router](memory-types.md#smart-router) for the full decision matrix and flowchart.

### Decision Priority

1. **Explicit layer**: If `layer` is specified, use it directly
2. **Tag-based routing**: `temp` → L1, `global` → L3, `project` → L2
3. **TTL-based routing**: If TTL is set, route to L1
4. **Content type routing**: Each type has a default layer mapping
5. **Default fallback**: Route to L2

## Embedding Strategy

Context Fabric uses fastembed-js for generating embeddings. All vector operations run in-process.

### Model

| Property | Value |
|----------|-------|
| **Model** | `Xenova/all-MiniLM-L6-v2` |
| **Dimensions** | 384 |
| **Size** | ~80MB (ONNX) |
| **Speed** | ~1000 docs/sec on CPU |
| **Runtime** | ONNX — works on any platform |

**Why this model?**
1. Small enough for local execution
2. Good performance on code snippets
3. No API key required
4. Fast embedding generation
5. ONNX runtime runs on any platform

### Embedding Process

```mermaid
graph LR
    A["Raw Text"] --> B["Normalize"]
    B --> C["fastembed-js\nONNX Runtime"]
    C --> D["384-dim Vector"]
    D --> E["Store in SQLite\nas JSON array"]

    style C fill:#dbeafe,stroke:#3b82f6
```

```typescript
class EmbeddingService {
  private model: FlagEmbedding;

  async embed(text: string): Promise<number[]> {
    const normalized = this.normalize(text);
    const embedding = await this.model.embed(normalized);
    return Array.from(embedding);
  }
}
```

### Similarity Calculation

Cosine similarity is computed in-process:

```typescript
function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
// Typical threshold: 0.7
```

## Decay Algorithm

L3 memories use decay instead of TTL. See [Memory Types > Decay Algorithm](memory-types.md#decay-algorithm) for the full formula and lifecycle diagram.

### Summary

```text
score = (age_decay * 0.3 + inactivity_penalty * 0.7) + access_boost
```

- `age_decay = exp(-age / (decayDays * 2))` — older memories fade
- `inactivity_penalty = exp(-timeSinceAccess / decayDays)` — unused memories fade faster
- `access_boost = min(accessCount / 10, 0.5)` — frequent access resists decay
- Default `decayDays = 14`, `decayThreshold = 0.2`
- If `score < 0.2`: memory is **deleted**
- Pinned memories (`pinned = 1`) are exempt from decay
- Decay runs on two triggers:
  - **Every `context.orient` call** (fire-and-forget, non-blocking)
  - **Hourly interval** while the engine is active

## Context Window Construction

The Context Engine builds a context window by combining memories from all three layers. This is what `context.getCurrent` returns.

```mermaid
sequenceDiagram
    participant CLI
    participant CE as Context Engine
    participant L1 as L1: Working
    participant L2 as L2: Project
    participant L3 as L3: Semantic
    participant PE as Pattern Extractor

    CLI->>CE: getCurrent(sessionId, currentFile)
    CE->>L1: getAll()
    L1-->>CE: workingMemories (max 10)

    CE->>L2: getRecent(5)
    L2-->>CE: recentL2[]

    Note over CE: Build query from top 3 working memories
    CE->>L3: recall(query, limit=5)
    L3-->>CE: l3Results[] with similarity scores

    CE->>CE: Combine & rank by relevance
    CE->>PE: extractPatterns(projectPath)
    PE-->>CE: patterns[]

    CE-->>CLI: ContextWindow { working, relevant, patterns, suggestions, ghostMessages }
```

The construction algorithm:

1. **L1**: Get all working memories (capped at `maxWorkingMemories`)
2. **L2**: Get the 5 most recent project memories, score each at `0.8 * (weight / 3)`
3. **L3**: Use the top 3 working memory contents as a semantic search query, retrieve top 5 results, score each at `cosine_similarity * (weight / 3)`
4. **Combine**: Merge L2 and L3 results, sort by weighted relevance, cap at `maxRelevantMemories`
5. **Patterns**: Extract code patterns for the current project
6. **Ghost messages**: Generate invisible context injections from recent decisions and bug fixes
7. **Package**: Return the complete `ContextWindow`

The weight multiplier (`metadata.weight`, integer 1-5, default 3) scales relevance scores. A weight of 5 gives a 1.67x boost; a weight of 1 gives 0.33x. This allows critical memories to surface above others regardless of recency or similarity.

## Code Indexer

The Code Indexer (`src/indexer/code-index.ts`) provides source code search via `context.searchCode`. It is lazily initialized on first use and shares the L3 embedding service to avoid loading the ONNX model twice.

### Features

- **Three search modes**: `text` (full-text), `symbol` (functions/classes/types by name), `semantic` (natural-language embedding similarity)
- **Automatic indexing**: Files are indexed on first `searchCode` call. File watching re-indexes on changes.
- **Chunking**: Files are split into chunks (default 150 lines, 10-line overlap) for granular search results
- **Symbol extraction**: Parses source files to extract function, class, interface, type, enum, const, and export declarations

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

The code index is updated incrementally on each `context.orient` call (fire-and-forget).

## Event Handling

The Event Handler processes CLI events and automatically captures memories.

### Supported Event Types

| Event Type | Description | Auto-Captured As |
|------------|-------------|-----------------|
| `file_opened` | User opened a file | L1 scratchpad |
| `command_executed` | A command was executed | L1 scratchpad |
| `error_occurred` | An error was encountered | L2 bug_fix (if novel) |
| `decision_made` | An architectural decision | L2 decision |
| `session_start` | New session began | Internal tracking |
| `session_end` | Session ended | Internal tracking |
| `pattern_detected` | Code pattern found | L3 code_pattern |
| `user_feedback` | User gave explicit feedback | Varies by content |

```mermaid
flowchart LR
    E["CLI Event"] --> EH["Event Handler"]
    EH -->|"error_occurred"| Check{"Similar\nerror\nexists?"}
    Check -->|Yes| Suggest["Suggest fix\nfrom memory"]
    Check -->|No| Store["Store new\nerror memory"]
    EH -->|"decision_made"| D["Store as\nL2 decision"]
    EH -->|"pattern_detected"| P["Store as\nL3 pattern"]
    EH -->|"file_opened"| F["Update L1\nworking context"]
```

## Data Flow

### Storage Flow

```mermaid
flowchart TD
    A["CLI reports event\nor stores memory"] --> B["Smart Router\nanalyzes content"]
    B --> C{"Route to\nwhich layer?"}
    C -->|"L1"| D["Store in\nin-memory Map"]
    C -->|"L2"| E["Store in\nSQLite"]
    C -->|"L3"| F["Generate\nembedding"]
    F --> G["Store in SQLite\nwith vector"]

    style D fill:#fef3c7,stroke:#f59e0b
    style E fill:#dbeafe,stroke:#3b82f6
    style G fill:#ede9fe,stroke:#8b5cf6
```

### Retrieval Flow

```mermaid
flowchart TD
    A["Context Request"] --> B["Get L1\nworking memories"]
    A --> C["Get L2\nrecent memories"]
    A --> D["Search L3\nusing L1 as query"]
    B --> E["Combine &\nrank by relevance"]
    C --> E
    D --> E
    E --> F["Return\nContextWindow"]
```

## Performance

### Memory Usage

| Layer | Per Memory | Max Size |
|-------|-----------|----------|
| L1 | ~1 KB | 1000 entries (~1 MB) |
| L2 | ~2 KB | Unlimited (disk) |
| L3 | ~5 KB (with embedding) | Unlimited (disk) |

### Query Performance

| Operation | L1 | L2 | L3 |
|-----------|:--:|:--:|:--:|
| Store | O(1) | O(1) | O(1)* |
| Get by ID | O(1) | O(1) | O(1) |
| LIKE search | O(n) | O(n) | - |
| FTS5 BM25 | - | O(log n) | O(log n) |
| Vector search | - | - | O(n)** |
| Hybrid (RRF) | - | O(log n) + O(n) | O(log n) + O(n)** |

\* L3 store requires embedding generation (~50ms per memory)

\*\* In-process cosine similarity scan; fast for typical memory counts (<10K)

### Bottlenecks

- **Embedding generation**: ~50ms per text on CPU. Batched embedding (`batchSize: 32`) helps for bulk operations.
- **L3 recall (semantic)**: Linear scan over all L3 memories. At 10K memories with 384-dim vectors, this takes <100ms.
- **FTS5 search**: Logarithmic — the FTS5 inverted index makes keyword search fast regardless of table size.
- **Hybrid mode overhead**: Runs both keyword and semantic rankers, then fuses with RRF. Adds ~10-20ms over pure semantic mode.
- **Cold start**: First embedding requires loading the ONNX model (~2 seconds). Docker pre-bakes the model to avoid download time.

---

[← Agent Integration](agent-integration.md) | [Configuration](configuration.md) | [Back to README](../README.md)
