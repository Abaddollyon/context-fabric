# Context Fabric Architecture

This document provides a deep dive into the architecture of Context Fabric.

## Table of Contents

- [System Overview](#system-overview)
- [The Three Layers](#the-three-layers)
  - [L1: Working Memory](#l1-working-memory)
  - [L2: Project Memory](#l2-project-memory)
  - [L3: Semantic Memory](#l3-semantic-memory)
- [Time Service](#time-service)
- [Routing Logic](#routing-logic)
- [Embedding Strategy](#embedding-strategy)
- [Decay Algorithm](#decay-algorithm)
- [Context Window Construction](#context-window-construction)
- [Event Handling](#event-handling)
- [Data Flow](#data-flow)

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Client (CLI Tool)                               │
│         Kimi / Claude Code / OpenCode / Codex / Gemini CLI / Cursor         │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │
                                  │ MCP Protocol (JSON-RPC over stdio)
                                  │ — or via Docker: docker run --rm -i —
                                  │
┌─────────────────────────────────▼───────────────────────────────────────────┐
│                        Context Fabric MCP Server                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                         Tool Handlers                                │    │
│  │  • context.getCurrent  • context.store     • context.recall         │    │
│  │  • context.summarize   • context.getPatterns • context.reportEvent  │    │
│  │  • context.ghost       • context.promote   • context.setup          │    │
│  │  • context.time        • context.orient                             │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                      │                                       │
│  ┌───────────────────────────────────▼──────────────────────────────────┐    │
│  │                         Context Engine                                │    │
│  │   (Orchestrates layers, manages context windows, handles events)      │    │
│  └───────────────────────────────────┬──────────────────────────────────┘    │
│                                      │                                       │
│         ┌────────────────────────────┼────────────────────────────┐          │
│         │                            │                            │          │
│         ▼                            ▼                            ▼          │
│  ┌─────────────┐            ┌─────────────┐            ┌─────────────────┐  │
│  │  L1 Working │            │  L2 Project │            │   L3 Semantic   │  │
│  │  Memory     │            │  Memory     │            │   Memory        │  │
│  │             │            │             │            │                 │  │
│  │  In-memory  │            │  node:sqlite│            │  node:sqlite    │  │
│  │  TTL-based  │            │  DatabaseSync            │  + cosine sim.  │  │
│  │  LRU evict  │            │  Project-scoped         │  Decay-based    │  │
│  └─────────────┘            └─────────────┘            └─────────────────┘  │
│                                                                              │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────────┐   │
│  │   Smart Router   │  │  Time Service    │  │   Supporting Services    │   │
│  │  (content→layer) │  │  (IANA tz,       │  │  • EmbeddingService      │   │
│  │                  │  │   anchors, gaps) │  │  • PatternExtractor      │   │
│  │                  │  │                  │  │  • EventHandler          │   │
│  └──────────────────┘  └──────────────────┘  └──────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## The Three Layers

### L1: Working Memory

**Purpose**: Ephemeral session-scoped context

```typescript
class WorkingMemoryLayer {
  private memories: Map<string, WorkingMemoryEntry>;
  private maxSize: number = 1000;
  private defaultTTL: number = 3600; // 1 hour

  store(content, type, metadata, ttl?): Memory
  get(id): Memory | undefined
  getAll(): Memory[]
  cleanup(): number // removes expired
}
```

**Characteristics**:
- Storage: In-memory Map
- Scope: Single session
- Expiration: TTL-based (default 1 hour)
- Eviction: LRU when max size reached
- Persistence: None

**Use Cases**:
- Scratchpad notes
- Temporary thoughts
- Session-specific context
- Working file list

### L2: Project Memory

**Purpose**: Persistent project-specific knowledge

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

**Characteristics**:
- Storage: `DatabaseSync` from `node:sqlite` (built-in, zero native deps)
- Scope: Project-specific (one DB per project)
- Expiration: None (permanent until deleted)
- Search: Full-text via LIKE queries
- Persistence: File-based

**Schema**:
```sql
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata TEXT,
  tags TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  access_count INTEGER DEFAULT 0,
  last_accessed_at INTEGER
);

CREATE TABLE project_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX idx_type ON memories(type);
CREATE INDEX idx_created ON memories(created_at);
```

The `project_meta` table stores per-project metadata such as `last_seen` timestamps used by `context.orient`.

**Use Cases**:
- Architectural decisions
- Bug fixes with solutions
- Project-specific documentation
- Code review feedback

### L3: Semantic Memory

**Purpose**: Long-term, cross-project knowledge with semantic search

```typescript
class SemanticMemoryLayer {
  private db: DatabaseSync;       // from node:sqlite
  private embedder: EmbeddingService;
  private decayDays: number = 30;

  store(content, type, metadata): Memory
  recall(query, limit): ScoredMemory[]
  applyDecay(): number
}
```

**Characteristics**:
- Storage: `DatabaseSync` from `node:sqlite` with embedding vectors stored as JSON arrays
- Scope: Cross-project (global)
- Expiration: Decay-based (not TTL)
- Search: In-process cosine similarity over stored embedding vectors
- Persistence: File-based

**Use Cases**:
- Reusable code patterns
- Language/framework conventions
- Design patterns
- Best practices

**Vector Search**:
```typescript
recall(query: string, limit: number): ScoredMemory[] {
  // 1. Generate query embedding via fastembed-js
  const queryEmbedding = this.embedder.embed(query);

  // 2. Load all embeddings from SQLite
  const rows = this.db.prepare('SELECT * FROM memories').all();

  // 3. Compute cosine similarity in-process
  const scored = rows.map(row => ({
    memory: deserialize(row),
    similarity: cosineSimilarity(queryEmbedding, JSON.parse(row.embedding)),
  }));

  // 4. Sort by similarity, return top N
  return scored.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
}
```

## Time Service

The `TimeService` (`src/time.ts`) provides time-aware capabilities using only the built-in `Intl` API:

- **`now(tz?)`** — full `TimeAnchor` with UTC offset, day/week boundaries, ISO week number
- **`resolve(expression, tz?)`** — natural-language date resolver (`"tomorrow"`, `"next Monday"`, `"end of week"`, etc.)
- **`convert(epochMs, tz)`** — world-clock conversion to any IANA timezone
- **`formatDuration(ms)`** — human-readable duration (`"3 hours 42 minutes"`)

The `context.orient` tool uses the Time Service combined with L2's `project_meta` table to detect offline gaps:

```
context.orient() →
  1. Get current TimeAnchor
  2. Read last_seen from project_meta
  3. Calculate offline gap duration
  4. Count memories added during the gap
  5. Return summary + TimeAnchor + OfflineGap
  6. Update last_seen to now
```

## Routing Logic

The SmartRouter analyzes content and metadata to determine the optimal storage layer.

### Decision Flow

```
┌─────────────────┐
│  Input Content  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     Yes     ┌─────────────────┐
│ Forced layer?   │────────────▶│ Use forced layer│
│ (layer param)   │             └─────────────────┘
└────────┬────────┘
         │ No
         ▼
┌─────────────────┐     Yes     ┌─────────────────┐
│ Tags include    │────────────▶│ Route to L1     │
│ 'temp'?         │             └─────────────────┘
└────────┬────────┘
         │ No
         ▼
┌─────────────────┐     Yes     ┌─────────────────┐
│ Tags include    │────────────▶│ Route to L3     │
│ 'global'?       │             └─────────────────┘
└────────┬────────┘
         │ No
         ▼
┌─────────────────┐     Yes     ┌─────────────────┐
│ Tags include    │────────────▶│ Route to L2     │
│ 'project'?      │             └─────────────────┘
└────────┬────────┘
         │ No
         ▼
┌─────────────────┐     Yes     ┌─────────────────┐
│ TTL specified?  │────────────▶│ Route to L1     │
└────────┬────────┘             └─────────────────┘
         │ No
         ▼
┌─────────────────┐
│ Content Type    │
│ Analysis        │
└────────┬────────┘
         │
    ┌────┴────┬─────────────┬──────────────┐
    ▼         ▼             ▼              ▼
┌───────┐ ┌────────┐  ┌──────────┐  ┌───────────┐
│scratch│ │decision│  │ pattern  │  │ default   │
│  pad  │ │bug_fix │  │convention│  │   L2      │
└───┬───┘ └───┬────┘  └────┬─────┘  └─────┬─────┘
    │         │            │              │
    ▼         ▼            ▼              ▼
┌───────┐ ┌────────┐  ┌──────────┐  ┌───────────┐
│  L1   │ │   L2   │  │    L3    │  │    L2     │
└───────┘ └────────┘  └──────────┘  └───────────┘
```

### Routing Rules

| Priority | Condition | Layer | Confidence |
|----------|-----------|-------|------------|
| 1 | `forceLayer` specified | As specified | 1.0 |
| 2 | Tags include `temp` | L1 | 0.95 |
| 2 | Tags include `global` | L3 | 0.95 |
| 2 | Tags include `project` | L2 | 0.95 |
| 3 | TTL specified | L1 | 0.90 |
| 4 | Type = `scratchpad` | L1 | 0.95 |
| 4 | Type = `code_pattern` | L3 | 0.90 |
| 4 | Type = `convention` | L3 | 0.90 |
| 4 | Type = `decision` | L2 | 0.85 |
| 4 | Type = `bug_fix` | L2 | 0.85 |
| 4 | Type = `relationship` | L3 | 0.85 |
| 5 | Default | L2 | 0.60 |

## Embedding Strategy

Context Fabric uses fastembed-js for generating embeddings for L3 semantic search. All vector operations run in-process — no external vector database required.

### Model Selection

**Default Model**: `Xenova/all-MiniLM-L6-v2`
- Dimensions: 384
- Size: ~80MB (ONNX)
- Speed: ~1000 docs/sec on CPU
- Quality: Good balance for code/text

**Why This Model?**
1. Small enough for local execution
2. Good performance on code snippets
3. No API key required
4. Fast embedding generation
5. ONNX runtime — works on any platform

### Embedding Process

```typescript
class EmbeddingService {
  private model: FlagEmbedding;

  async embed(text: string): Promise<number[]> {
    // 1. Normalize text
    const normalized = this.normalize(text);

    // 2. Generate embedding via fastembed-js ONNX runtime
    const embedding = await this.model.embed(normalized);

    // 3. Return as array
    return Array.from(embedding);
  }
}
```

### Similarity Calculation

Cosine similarity is computed in-process over SQLite rows:

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

L3 memories use decay instead of TTL. Unused memories gradually lose relevance.

### Decay Formula

```typescript
function calculateRelevanceScore(
  accessCount: number,
  lastAccessedAt: number,
  createdAt: number
): number {
  const now = Date.now();
  const age = now - createdAt;
  const timeSinceAccess = now - lastAccessedAt;
  const decayMs = decayDays * 24 * 60 * 60 * 1000;

  // Age decay: older items slowly fade
  const ageDecay = Math.exp(-age / (decayMs * 2));

  // Inactivity penalty: unused items fade faster
  const inactivityPenalty = Math.exp(-timeSinceAccess / decayMs);

  // Access boost: frequently used items resist decay
  const accessBoost = Math.min(accessCount / 10, 0.5);

  // Combine factors
  const score = (ageDecay * 0.3 + inactivityPenalty * 0.7) + accessBoost;

  return Math.max(0, Math.min(1, score));
}
```

If `score < 0.1`, the memory is deleted. Decay runs automatically every hour via `setInterval`.

## Context Window Construction

The Context Engine builds a context window by combining memories from all layers.

```typescript
async getContextWindow(): Promise<ContextWindow> {
  // 1. Get all L1 working memories (limited by maxWorkingMemories)
  const working = this.l1.getAll().slice(0, maxWorking);

  // 2. Get recent L2 memories
  const recentL2 = this.l2.getRecent(5);

  // 3. Search L3 using working context as query
  const query = working.slice(0, 3).map(m => m.content).join(' ');
  const l3Results = await this.l3.recall(query, 5);

  // 4. Combine and rank
  const relevant = [...recentL2, ...l3Results]
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, maxRelevant);

  // 5. Extract patterns
  const patterns = await this.patternExtractor.extractPatterns(projectPath);

  // 6. Generate suggestions and ghost messages
  return { working, relevant, patterns, suggestions, ghostMessages };
}
```

## Event Handling

The EventHandler processes CLI events and automatically captures memories.

### Event Types

```typescript
type CLIEventType =
  | 'file_opened'
  | 'command_executed'
  | 'error_occurred'
  | 'decision_made'
  | 'session_start'
  | 'session_end'
  | 'pattern_detected'
  | 'user_feedback';
```

### Event Processing

```typescript
class EventHandler {
  async handleEvent(event: CLIEvent): Promise<EventResult> {
    switch (event.type) {
      case 'error_occurred':
        // Check for similar errors, suggest fix or store new error
        return this.handleError(event);
      case 'decision_made':
        return this.handleDecision(event);
      case 'pattern_detected':
        return this.handlePattern(event);
      // ... etc
    }
  }
}
```

## Data Flow

### Storage Flow

```
CLI Event
    │
    ▼
┌─────────────────┐
│  Report Event   │
│  (Optional)     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  SmartRouter    │
│  Analyze Content│
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Route to Layer │
│  (L1/L2/L3)     │
└────────┬────────┘
         │
    ┌────┴────┬────────────┐
    ▼         ▼            ▼
┌───────┐ ┌───────┐  ┌──────────┐
│ L1    │ │ L2    │  │ L3       │
│ Store │ │ Store │  │ Embed &  │
│ in Map│ │ in    │  │ Store in │
│       │ │SQLite │  │ SQLite   │
└───────┘ └───────┘  └──────────┘
```

### Retrieval Flow

```
Context Request
       │
       ▼
┌─────────────────┐
│ Get L1 Working  │────────────┐
│ Memories        │            │
└─────────────────┘            │
                               ▼
┌─────────────────┐     ┌──────────────┐
│ Get L2 Recent   │────▶│  Combine &   │
│ Memories        │     │  Rank by     │
└─────────────────┘     │  Relevance   │
                        │              │
┌─────────────────┐     │ ┌──────────┐ │
│ Search L3 using │────▶│ │ Cosine   │ │
│ L1 as query     │     │ │ Sim.     │ │
└─────────────────┘     │ └──────────┘ │
                        └──────┬───────┘
                               ▼
                        ┌──────────────┐
                        │ Return       │
                        │ ContextWindow│
                        └──────────────┘
```

### Orientation Flow

```
context.orient(timezone?, projectPath?)
       │
       ▼
┌─────────────────┐     ┌──────────────────────┐
│ TimeService.now │────▶│ Current TimeAnchor   │
└─────────────────┘     └──────────┬───────────┘
                                   │
┌─────────────────┐                ▼
│ L2.getLastSeen  │────▶ Calculate offline gap
└─────────────────┘     duration + memories added
                                   │
                                   ▼
                        ┌──────────────────────┐
                        │ Return summary,      │
                        │ TimeAnchor,          │
                        │ OfflineGap,          │
                        │ recentMemories       │
                        └──────────┬───────────┘
                                   │
┌─────────────────┐                ▼
│L2.updateLastSeen│◀──── Record session timestamp
└─────────────────┘
```

## Performance Considerations

### Memory Usage

| Layer | Per-Memory | Max Size |
|-------|-----------|----------|
| L1 | ~1KB | 1000 entries (~1MB) |
| L2 | ~2KB | Unlimited (disk) |
| L3 | ~5KB (with embedding) | Unlimited (disk) |

### Query Performance

| Operation | L1 | L2 | L3 |
|-----------|-----|-----|-----|
| Store | O(1) | O(1) | O(1)* |
| Get by ID | O(1) | O(1) | O(1) |
| Search | O(n) | O(n) | O(n)** |
| Recall | O(n) | O(n) | O(n)** |

*L3 store requires embedding generation (~50ms)
**In-process cosine similarity scan; fast for typical memory counts (<10K)
