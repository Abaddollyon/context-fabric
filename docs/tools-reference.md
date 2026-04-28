# Tools Reference

All 29 MCP tools with full parameter docs and example payloads. Your AI calls these automatically -- you rarely need to invoke them by hand.

## Table of Contents

- [Core Tools](#core-tools)
  - [context.getCurrent](#contextgetcurrent)
  - [context.store](#contextstore)
  - [context.recall](#contextrecall)
- [Batch Tools](#batch-tools)
  - [context.storeBatch](#contextstorebatch)
- [Orientation & Time](#orientation--time)
  - [context.orient](#contextorient)
- [Code Tools](#code-tools)
  - [context.searchCode](#contextsearchcode)
  - [context.codeIndexRepair](#contextcodeindexrepair)
- [CRUD Tools](#crud-tools)
  - [context.get](#contextget)
  - [context.update](#contextupdate)
  - [context.delete](#contextdelete)
  - [context.list](#contextlist)
- [Management Tools](#management-tools)
  - [context.summarize](#contextsummarize)
  - [context.reportEvent](#contextreportevent)
- [Skill Tools](#skill-tools)
  - [context.skill.create](#contextskillcreate)
  - [context.skill.list](#contextskilllist)
  - [context.skill.get](#contextskillget)
  - [context.skill.invoke](#contextskillinvoke)
  - [context.skill.update](#contextskillupdate)
  - [context.skill.delete](#contextskilldelete)
- [Docs Tools](#docs-tools)
  - [context.importDocs](#contextimportdocs)
- [Backup & Migration](#backup--migration)
  - [context.backup](#contextbackup)
  - [context.export](#contextexport)
  - [context.import](#contextimport)
- [Observability](#observability)
  - [context.metrics](#contextmetrics)
  - [context.health](#contexthealth)
- [Graph Tools](#graph-tools)
  - [context.graph.query](#contextgraphquery)
  - [context.graph.export](#contextgraphexport)
  - [context.graph.import](#contextgraphimport)
- [Setup Tools](#setup-tools)
  - [context.setup](#contextsetup)
- [Changes since v0.7.1](#changes-since-v071)

---

## Core Tools

### context.getCurrent

Get the current context window for a session, including working memories, relevant memories, patterns, suggestions, and ghost messages. Optionally filter patterns by language or file path.

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sessionId` | string | Yes | Unique session identifier |
| `currentFile` | string | No | Currently open file path |
| `currentCommand` | string | No | Current command being executed |
| `projectPath` | string | No | Project path for context |
| `language` | string | No | Filter patterns by language (e.g. `typescript`, `python`) |
| `filePath` | string | No | Filter patterns by file path |

#### Example Request

```json
{
  "sessionId": "session-abc-123",
  "currentFile": "src/main.ts",
  "currentCommand": "npm test",
  "projectPath": "/home/user/myapp",
  "language": "typescript"
}
```

#### Example Response

```json
{
  "context": {
    "working": [
      {
        "id": "mem-001",
        "type": "scratchpad",
        "content": "Currently refactoring the auth module",
        "createdAt": "2026-02-25T09:00:00.000Z"
      }
    ],
    "relevant": [
      {
        "id": "mem-042",
        "type": "decision",
        "content": "Use JWT with 15-minute expiry for API tokens",
        "metadata": { "tags": ["auth", "jwt"] },
        "createdAt": "2026-02-20T14:30:00.000Z"
      }
    ],
    "patterns": [
      {
        "id": "pat-001",
        "name": "Zod input validation",
        "description": "Validate all API inputs with Zod schemas",
        "code": "const schema = z.object({ ... })",
        "language": "typescript",
        "usageCount": 12
      }
    ],
    "suggestions": [],
    "ghostMessages": []
  }
}
```

> [!NOTE]
> Pattern filtering (via `language`/`filePath`) replaces the old `context.getPatterns` tool. Ghost messages (via the `ghostMessages` field) replace the old `context.ghost` tool.

---

### context.store

Store a new memory in the fabric. If `layer` is not specified, the Smart Router auto-selects based on content type, tags, and TTL.

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `type` | string | Yes | One of: `code_pattern`, `bug_fix`, `decision`, `convention`, `scratchpad`, `relationship` |
| `content` | string | Yes | Memory content (min 1 character) |
| `metadata` | object | Yes | See metadata fields below |
| `layer` | number | No | Force layer: `1` (working), `2` (project), `3` (semantic). Auto-detected if omitted |
| `ttl` | number | No | Time-to-live in seconds (for L1 memories) |
| `pinned` | boolean | No | Pin this memory to protect it from decay and summarization |

**Metadata fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `tags` | string[] | No | Tags for categorization and routing (default: `[]`) |
| `title` | string | No | Human-readable title |
| `confidence` | number | No | AI-assigned confidence score, 0-1 (default: `0.8`) |
| `source` | string | No | One of: `user_explicit`, `ai_inferred`, `system_auto` (default: `ai_inferred`) |
| `projectPath` | string | No | Project path to scope memory to |
| `cliType` | string | No | CLI type identifier (default: `generic`) |
| `fileContext` | object | No | `{ path, lineStart?, lineEnd?, language? }` |
| `codeBlock` | object | No | `{ code, language, filePath? }` |
| `weight` | number | No | Priority 1–5 (default 3). Higher weight surfaces memories above unweighted ones in recall and context window |
| `provenance` | object | No | v0.11 citation block. Strict schema: `{ sessionId?, eventId?, toolCallId?, filePath?, lineStart?, lineEnd?, commitSha?, sourceUrl?, capturedAt? }`. `capturedAt` is auto-stamped when omitted. See [Memory Types > Provenance](memory-types.md#provenance-v011) |
| `supersedes` | string (UUID) | No | v0.11 bi-temporal. ID of an L3 memory this one replaces. The predecessor's `valid_until` and the new row's `supersedes_id` are stamped atomically. L3 only |
| `dedupe` | object | No | v0.11 dedup-on-store config (L3 only). `{ strategy?: 'skip' \| 'merge' \| 'allow', threshold?: number }`. Default strategy `skip`, threshold `0.95`. See [Memory Types > Dedup](memory-types.md#dedup-on-store-v011) |

#### Example Request

```json
{
  "type": "decision",
  "content": "Use Zod for all API input validation. Schemas live in src/schemas/ alongside the route handlers.",
  "metadata": {
    "tags": ["validation", "api", "zod"],
    "confidence": 0.95,
    "source": "user_explicit",
    "projectPath": "/home/user/myapp",
    "weight": 5
  }
}
```

#### Example Response

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "success": true,
  "layer": 2
}
```

#### Example Request (with provenance + dedupe)

```json
{
  "type": "code_pattern",
  "layer": 3,
  "content": "Use Promise.allSettled for batch HTTP calls that may fail independently.",
  "metadata": {
    "tags": ["patterns", "http"],
    "provenance": {
      "sessionId": "sess-2026-04-21",
      "filePath": "src/http/batch.ts",
      "lineStart": 18,
      "lineEnd": 34,
      "commitSha": "abc1234"
    },
    "dedupe": { "strategy": "merge", "threshold": 0.92 }
  }
}
```

#### Example Response (dedup merge hit)

```json
{
  "id": "existing-memory-uuid",
  "success": true,
  "layer": 3,
  "_dedupe": {
    "strategy": "merge",
    "similarity": 0.97,
    "existingId": "existing-memory-uuid"
  }
}
```

#### Example Request (supersede an older decision)

```json
{
  "type": "decision",
  "layer": 3,
  "content": "Switch primary store from DynamoDB to Postgres (Oct 2026).",
  "metadata": {
    "tags": ["db", "architecture"],
    "supersedes": "e3f1a2d4-0000-4000-8000-000000000001"
  }
}
```

---

### context.recall

Hybrid search across all memory layers. Supports three modes: `hybrid` (default, FTS5 BM25 + vector cosine fused with Reciprocal Rank Fusion), `semantic` (vector-only), and `keyword` (FTS5 BM25-only). Returns ranked results with similarity scores.

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Search query (min 1 character) |
| `sessionId` | string | Yes | Session identifier |
| `limit` | number | No | Max results to return (default: `10`) |
| `threshold` | number | No | Minimum similarity score, 0-1 (default: `0.7`) |
| `mode` | string | No | Search mode: `hybrid`, `semantic`, or `keyword` (default: `hybrid`) |
| `offset` | number | No | Skip the first N results. Combine with `limit` for pagination (default: `0`) |
| `includeSuperseded` | boolean | No | v0.11 bi-temporal. Include L3 memories that have been superseded (default: `false`) |
| `asOf` | number | No | v0.11 bi-temporal. Epoch ms. Query the state of memory as it existed at this point in time. Overrides the default "hide superseded" behavior with a full bi-temporal window |
| `filter` | object | No | See filter fields below |

**Filter fields:**

| Field | Type | Description |
|-------|------|-------------|
| `types` | string[] | Filter by memory type(s) |
| `layers` | number[] | Filter by layer(s): `[1]`, `[2]`, `[3]`, or combinations |
| `tags` | string[] | Filter by tag(s) |
| `projectPath` | string | Filter by project path |

#### Example Request

```json
{
  "query": "authentication error handling",
  "sessionId": "session-abc-123",
  "limit": 5,
  "threshold": 0.7,
  "mode": "hybrid",
  "filter": {
    "types": ["bug_fix", "code_pattern"],
    "layers": [2, 3],
    "tags": ["auth"]
  }
}
```

#### Example Response

```json
{
  "results": [
    {
      "memory": {
        "id": "mem-042",
        "type": "bug_fix",
        "content": "Fixed auth token refresh race condition by adding a mutex lock around the refresh call",
        "metadata": { "tags": ["auth", "race-condition"] },
        "createdAt": "2026-02-20T14:30:00.000Z",
        "updatedAt": "2026-02-20T14:30:00.000Z"
      },
      "similarity": 0.89,
      "layer": 2
    }
  ],
  "total": 1
}
```

#### Example Request (bi-temporal: state-of-knowledge on 2025-09-01)

```json
{
  "query": "primary database choice",
  "asOf": 1756684800000,
  "limit": 5
}
```

Returns the decision(s) that were currently-valid on 2025-09-01, even if they have since been superseded. See [Memory Types > Bi-temporal](memory-types.md#bi-temporal-reasoning-v011).

---

## Orientation & Time

### context.orient

The orientation loop: "Where am I in time? What happened while I was offline? What project am I in?" Call this at the start of every session to ground the AI. Also resolves natural-language date expressions and provides world-clock conversions.

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `timezone` | string | No | IANA timezone name. Defaults to system timezone |
| `projectPath` | string | No | Project path. Defaults to current working directory |
| `expression` | string | No | Date expression to resolve (see supported expressions below) |
| `also` | string[] | No | Additional IANA timezone names for world-clock conversion |

**Supported expressions:**

| Expression | Result |
|------------|--------|
| `now` | Current moment |
| `today` | Start of today |
| `yesterday` | Start of yesterday |
| `tomorrow` | Start of tomorrow |
| `start of day` | Start of today (same as `today`) |
| `end of day` | End of today (23:59:59.999) |
| `start of week` | Start of Monday this week |
| `end of week` | End of Sunday this week |
| `start of next week` | Start of next Monday |
| `start of last week` | Start of last Monday |
| `next Monday` ... `next Sunday` | Start of next occurrence of that weekday |
| `last Monday` ... `last Sunday` | Start of last occurrence of that weekday |
| ISO date string | Parsed as-is |
| Epoch milliseconds | Parsed as-is (10+ digits) |

#### Example Request (Basic Orientation)

```json
{
  "timezone": "Europe/London",
  "projectPath": "/home/user/myapp"
}
```

#### Example Response (First Session)

```json
{
  "summary": "It is 9:15 AM on Wednesday, February 25, 2026 (Europe/London, UTC+00:00). Project: /home/user/myapp. First session in this project.",
  "time": {
    "epochMs": 1740474900000,
    "iso": "2026-02-25T09:15:00.000+00:00",
    "timezone": "Europe/London",
    "utcOffset": "+00:00",
    "timeOfDay": "9:15 AM",
    "date": "Wednesday, February 25, 2026",
    "dayOfWeek": "Wednesday",
    "isWeekend": false,
    "weekNumber": 9
  },
  "projectPath": "/home/user/myapp",
  "offlineGap": null,
  "recentMemories": []
}
```

#### Example Request (Date Resolution + World Clock)

```json
{
  "timezone": "America/New_York",
  "expression": "next Monday",
  "also": ["Europe/London", "Asia/Tokyo"]
}
```

#### Example Response (Date Resolution)

```json
{
  "summary": "...",
  "time": { "..." : "..." },
  "resolved": 1772265600000,
  "conversions": [
    {
      "epochMs": 1772265600000,
      "timezone": "Europe/London",
      "iso": "2026-03-02T05:00:00.000+00:00",
      "timeOfDay": "5:00 AM",
      "date": "Monday, March 2, 2026",
      "utcOffset": "+00:00"
    },
    {
      "epochMs": 1772265600000,
      "timezone": "Asia/Tokyo",
      "iso": "2026-03-02T14:00:00.000+09:00",
      "timeOfDay": "2:00 PM",
      "date": "Monday, March 2, 2026",
      "utcOffset": "+09:00"
    }
  ]
}
```

> [!NOTE]
> Date resolution and world-clock conversion replace the old `context.time` tool. Orient now handles both session orientation and time queries.

---

## Code Tools

### context.searchCode

Search the project's source code index. Supports three modes: full-text search, symbol search (functions/classes/types by name), and semantic search (natural-language similarity using embeddings). The index is built automatically on first use and stays up-to-date via file watching. TypeScript/JavaScript indexing recognizes imports, exports, functions, classes, methods, interfaces, type aliases, enums, constants, and test declarations, while definition results rank above import/export references.

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Search query (min 1 character) |
| `mode` | string | No | Search mode: `text`, `symbol`, or `semantic` (default: `semantic`) |
| `language` | string | No | Filter results to a specific language (e.g. `typescript`, `python`) |
| `filePattern` | string | No | Glob pattern to filter files (e.g. `src/**/*.ts`) |
| `symbolKind` | string | No | Filter symbols by kind: `function`, `class`, `interface`, `type`, `enum`, `const`, `export`, `method` |
| `limit` | number | No | Maximum results to return (default: `10`) |
| `threshold` | number | No | Minimum similarity score for semantic search, 0-1 (default: `0.5`) |
| `includeContent` | boolean | No | Include source content in results (default: `true`) |
| `projectPath` | string | No | Project path. Defaults to current working directory |

#### Example Request (Symbol Search)

```json
{
  "query": "AuthService",
  "mode": "symbol",
  "symbolKind": "class",
  "limit": 5
}
```

#### Example Response

```json
{
  "results": [
    {
      "filePath": "src/services/auth.ts",
      "language": "typescript",
      "symbol": {
        "name": "AuthService",
        "kind": "class",
        "signature": "export class AuthService {",
        "lineStart": 5,
        "lineEnd": 25,
        "docComment": "Handles authentication and token management."
      }
    }
  ],
  "indexStatus": {
    "totalFiles": 42,
    "totalSymbols": 187,
    "lastIndexed": "2026-02-25T09:15:00.000Z",
    "isStale": false
  },
  "total": 1
}
```

#### Example Request (Text Search)

```json
{
  "query": "verifyToken",
  "mode": "text",
  "filePattern": "src/**/*.ts"
}
```

#### Supported Languages

**Tier 1** (full extraction: functions, classes, interfaces, types, enums, constants, methods, doc comments):
- TypeScript / JavaScript
- Python
- Rust
- Go

**Tier 2** (functions and classes):
- Java, C#, Ruby, C/C++

---

### context.codeIndexRepair

Inspect and optionally repair the project code index. Detects stale indexes, deleted files, and missing or corrupted chunk embeddings. With `dryRun: true`, the tool reports issues without mutating the index.

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `projectPath` | string | No | Project path. Defaults to current working directory |
| `dryRun` | boolean | No | If true, report issues without repairing (default: `false`) |

#### Example Request

```json
{
  "projectPath": "/home/user/myapp",
  "dryRun": true
}
```

#### Example Response

```json
{
  "dryRun": true,
  "health": {
    "status": "ok",
    "totalFiles": 42,
    "totalSymbols": 187,
    "staleFiles": [],
    "deletedFiles": [],
    "missingEmbeddings": 0,
    "corruptedChunks": []
  },
  "repair": {
    "scanned": 42,
    "removedFiles": 0,
    "reindexedFiles": 0,
    "reembeddedChunks": 0,
    "issues": []
  }
}
```

---

## CRUD Tools

### context.get

Get a specific memory by its ID. Searches across all layers (L1, L2, L3) and returns the memory along with which layer it was found in.

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `memoryId` | string | Yes | ID of the memory to retrieve |
| `projectPath` | string | No | Project path. Defaults to current working directory |

#### Example Request

```json
{
  "memoryId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}
```

#### Example Response

```json
{
  "memory": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "type": "decision",
    "content": "Use Zod for all API input validation.",
    "metadata": { "tags": ["validation", "zod"], "confidence": 0.95 },
    "tags": ["validation", "zod"],
    "pinned": false,
    "createdAt": 1740474900000,
    "updatedAt": 1740474900000,
    "accessCount": 3
  },
  "layer": 2
}
```

---

### context.update

Update an existing memory's content, metadata, or tags. L1 (working) memories cannot be updated — they are ephemeral; store a new one instead. L3 memories are re-embedded only if content changes (metadata/tag-only updates skip the ~50ms embedding step). Use `targetLayer` to promote a memory to a higher layer.

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `memoryId` | string | Yes | ID of the memory to update |
| `content` | string | No | New content (replaces existing) |
| `metadata` | object | No | Metadata fields to merge into existing metadata |
| `tags` | string[] | No | New tags array (replaces existing tags) |
| `weight` | number | No | Update the memory weight (1–5) |
| `pinned` | boolean | No | Pin (true) or unpin (false) this memory |
| `targetLayer` | number | No | Promote memory to this layer (2=project, 3=semantic). Triggers promote logic: copies to new layer and deletes from old |
| `projectPath` | string | No | Project path. Defaults to current working directory |

#### Example Request (Update Content)

```json
{
  "memoryId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "content": "Use Zod for all API validation. Schemas live in src/schemas/.",
  "tags": ["validation", "zod", "api"]
}
```

#### Example Response (Update)

```json
{
  "memory": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "type": "decision",
    "content": "Use Zod for all API validation. Schemas live in src/schemas/.",
    "tags": ["validation", "zod", "api"],
    "createdAt": 1740474900000,
    "updatedAt": 1740478500000
  },
  "layer": 2,
  "success": true
}
```

#### Example Request (Promote L1 → L2)

```json
{
  "memoryId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "targetLayer": 2
}
```

#### Example Response (Promote)

```json
{
  "success": true,
  "memoryId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "newLayer": 2
}
```

> [!NOTE]
> Promotion via `targetLayer` replaces the old `context.promote` tool. The memory's current layer is auto-detected — you only need to specify the destination. Promoting from L2 to L3 generates an embedding vector (~50ms).

---

### context.delete

Delete a memory by its ID. Searches across all layers and deletes from whichever layer it lives in. Throws an error if the memory is not found.

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `memoryId` | string | Yes | ID of the memory to delete |
| `projectPath` | string | No | Project path. Defaults to current working directory |

#### Example Request

```json
{
  "memoryId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}
```

#### Example Response

```json
{
  "success": true,
  "deletedFrom": 2
}
```

---

### context.list

List and browse memories with optional filters. Supports pagination. Defaults to L2 (project) memories. Use `stats: true` to get a summary of the memory store instead of listing memories.

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `layer` | number | No | Memory layer: `1` (working), `2` (project), `3` (semantic). Default: `2` |
| `type` | string | No | Filter by memory type |
| `tags` | string[] | No | Filter by tags (OR logic — matches if any tag is present) |
| `limit` | number | No | Maximum results to return (default: `20`) |
| `offset` | number | No | Offset for pagination (default: `0`) |
| `stats` | boolean | No | If true, return counts per layer instead of memory list |
| `projectPath` | string | No | Project path. Defaults to current working directory |

#### Example Request (List)

```json
{
  "layer": 2,
  "type": "decision",
  "limit": 10,
  "offset": 0
}
```

#### Example Response (List)

```json
{
  "memories": [
    {
      "id": "mem-042",
      "type": "decision",
      "content": "Use Zod for all API validation.",
      "metadata": { "tags": ["validation"] },
      "tags": ["validation"],
      "pinned": false,
      "createdAt": 1740474900000,
      "updatedAt": 1740474900000
    }
  ],
  "total": 47,
  "limit": 10,
  "offset": 0,
  "layer": 2
}
```

#### Example Request (Stats)

```json
{
  "stats": true
}
```

#### Example Response (Stats)

```json
{
  "l1": 3,
  "l2": 47,
  "l3": 12,
  "total": 62,
  "pinned": { "l2": 2, "l3": 1 }
}
```

> [!NOTE]
> The stats mode replaces the old `context.stats` tool.

---

## Management Tools

### context.summarize

Condense old memories in a layer (L2 or L3) into a summary entry. Useful for keeping databases lean over time.

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sessionId` | string | Yes | Session identifier |
| `options` | object | Yes | See options fields below |
| `layer` | number | No | Layer to summarize: `2` or `3` (default: `2`) |
| `olderThanDays` | number | No | Summarize memories older than this many days (default: `30`) |
| `projectPath` | string | No | Project path. Defaults to current working directory |

**Options fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `targetTokens` | number | Yes | Target token count for the summary |
| `focusTypes` | string[] | No | Memory types to focus on |
| `includePatterns` | boolean | No | Include code patterns in summary (default: `true`) |
| `includeDecisions` | boolean | No | Include decisions in summary (default: `true`) |

#### Example Request

```json
{
  "sessionId": "session-abc-123",
  "layer": 2,
  "olderThanDays": 30,
  "options": {
    "targetTokens": 2000,
    "includePatterns": true,
    "includeDecisions": true
  }
}
```

#### Example Response

```json
{
  "summaryId": "summary-2026-02-25",
  "summarizedCount": 47,
  "summary": "Over the past 30 days, 47 memories were archived. Key decisions: ...",
  "layer": 2
}
```

---

### context.reportEvent

Report a CLI event for automatic memory capture. Events are processed by the event handler which may create memories, detect patterns, or trigger other actions.

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `event` | object | Yes | See event fields below |

**Event fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Event type (see table below) |
| `payload` | object | Yes | Event-specific data |
| `timestamp` | string | Yes | ISO 8601 timestamp |
| `sessionId` | string | Yes | Session identifier |
| `cliType` | string | Yes | One of: `kimi`, `claude`, `claude-code`, `opencode`, `codex`, `gemini`, `cursor`, `generic` |
| `projectPath` | string | No | Project path |

**Event types:**

| Type | Description |
|------|-------------|
| `file_opened` | User opened a file |
| `command_executed` | A command was executed |
| `error_occurred` | An error was encountered |
| `decision_made` | An architectural or design decision was made |
| `session_start` | A new session started |
| `session_end` | A session ended |
| `pattern_detected` | A code pattern was detected |
| `user_feedback` | User provided explicit feedback |

#### Example Request

```json
{
  "event": {
    "type": "error_occurred",
    "payload": {
      "error": "TypeError: Cannot read properties of undefined (reading 'email')",
      "file": "src/api/users.ts",
      "line": 42
    },
    "timestamp": "2026-02-25T09:00:00.000Z",
    "sessionId": "session-abc-123",
    "cliType": "claude-code",
    "projectPath": "/home/user/myapp"
  }
}
```

#### Example Response

```json
{
  "processed": true,
  "memoryId": "mem-100",
  "triggeredActions": ["stored_error_memory", "searched_similar_errors"],
  "message": "Error recorded. Found 1 similar error from last week."
}
```

---

## Setup Tools

### context.setup

Install and configure Context Fabric into a CLI tool's MCP config. The AI calls this automatically when asked to set up Context Fabric.

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `cli` | string | Yes | Target CLI (see table below) |
| `serverPath` | string | No | Absolute path to `dist/server.js`. Auto-detected if omitted |
| `useDocker` | boolean | No | Write Docker config instead of local Node.js (default: `false`) |
| `preview` | boolean | No | Return config snippet without writing (default: `false`) |

**Supported CLIs:**

| Value | Config File | Format |
|-------|-------------|--------|
| `opencode` | `~/.config/opencode/opencode.json` | JSON (`mcp` key) |
| `claude` | `claude_desktop_config.json` | JSON (`mcpServers` key) |
| `claude-code` | `~/.claude.json` | JSON (`mcpServers` key, `type: stdio`) |
| `kimi` | `~/.kimi/mcp.json` | JSON (`mcpServers` key) |
| `codex` | `~/.codex/config.toml` | TOML (`[mcp_servers.x]`) |
| `gemini` | `~/.gemini/settings.json` | JSON (`mcpServers` key) |
| `cursor` | `~/.cursor/mcp.json` | JSON (`mcpServers` key) |
| `docker` | -- | Returns Docker snippets for all CLIs (no write) |
| `generic` | -- | Returns local snippet (no write) |

#### Example Request

```json
{
  "cli": "opencode",
  "useDocker": true,
  "preview": false
}
```

#### Example Response

```json
{
  "success": true,
  "cli": "opencode",
  "configFile": "~/.config/opencode/opencode.json",
  "message": "Context Fabric configured for OpenCode (Docker mode). Restart OpenCode to activate."
}
```

#### Preview Mode

```json
{
  "cli": "gemini",
  "preview": true
}
```

```json
{
  "preview": true,
  "cli": "gemini",
  "useDocker": false,
  "snippet": "{ \"mcpServers\": { \"context-fabric\": { \"command\": \"node\", \"args\": [\"/path/to/dist/server.js\"] } } }",
  "message": "This is what would be added to your gemini MCP config. Call context.setup without preview:true to write it."
}
```

---

## Batch Tools

### context.storeBatch

Store up to 500 memories in a single call. Functionally equivalent to calling `context.store` N times but avoids MCP round-trip overhead. Useful for bulk imports, session dumps, and `context.import` transformations. Each item follows the same shape as `context.store` but the top-level envelope is:

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `items` | array | Yes | Array of memory items, max 500. Each item has `{ type, content, metadata, layer?, ttl?, pinned? }` — same as `context.store` |
| `projectPath` | string | No | Default `projectPath` for items that omit `metadata.projectPath` |

#### Example Request

```json
{
  "items": [
    {
      "type": "convention",
      "content": "Always log errors with the `errorId` field.",
      "metadata": { "tags": ["logging"] }
    },
    {
      "type": "decision",
      "content": "Use Postgres for primary store.",
      "metadata": { "tags": ["db"], "weight": 5 }
    }
  ],
  "projectPath": "/home/user/myapp"
}
```

#### Example Response

```json
{
  "stored": 2,
  "failed": 0,
  "results": [
    { "id": "<uuid1>", "layer": 2, "pinned": false },
    { "id": "<uuid2>", "layer": 2, "pinned": false }
  ]
}
```

If any items fail validation or storage, they are reported under an `errors` array with `{ index, error }` entries. The batch is not transactional — successful items are kept even if later items fail.

---

## Skill Tools

Skills are **procedural memory** — reusable instruction blocks agents invoke by slug. See [Skills](skills.md) for the full guide.

### context.skill.create

Register a new skill. Throws if the slug already exists.

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `slug` | string | Yes | Unique kebab-case identifier. Must match `^[a-z0-9][a-z0-9-]*$`, 1–64 chars |
| `name` | string | Yes | Human-readable title, 1–120 chars |
| `description` | string | Yes | One-line purpose for listings, 1–500 chars |
| `instructions` | string | Yes | The skill body — what the agent should do when invoked |
| `triggers` | string[] | No | Natural-language phrases that hint when to reach for this skill |
| `parameters` | object[] | No | Declared inputs: `[{ name, description?, required? }]` |
| `tags` | string[] | No | Additional tags to attach |
| `projectPath` | string | No | Project to store the skill in |

#### Example Request

```json
{
  "slug": "review-pr",
  "name": "Review a pull request",
  "description": "Standard PR review checklist.",
  "triggers": ["pr", "review"],
  "parameters": [{ "name": "prUrl", "required": true }],
  "instructions": "1. Fetch the PR...\n2. Run tests...\n3. ..."
}
```

#### Example Response

```json
{
  "id": "<uuid>",
  "slug": "review-pr",
  "name": "Review a pull request",
  "description": "Standard PR review checklist.",
  "version": 1
}
```

---

### context.skill.list

List every skill, sorted most-recently-invoked first, then alphabetically by slug.

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `projectPath` | string | No | Project to list from |

#### Example Response

```json
{
  "skills": [
    {
      "id": "<uuid>",
      "slug": "review-pr",
      "name": "Review a pull request",
      "description": "Standard PR review checklist.",
      "version": 1,
      "invocationCount": 12,
      "lastInvokedAt": 1745200000000,
      "triggers": ["pr", "review"]
    }
  ],
  "count": 1
}
```

---

### context.skill.get

Read a skill (including full `instructions`) **without** bumping `invocationCount`.

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `slug` | string | Yes | Skill slug |
| `projectPath` | string | No | |

#### Example Response

```json
{
  "id": "<uuid>",
  "slug": "review-pr",
  "name": "Review a pull request",
  "description": "Standard PR review checklist.",
  "instructions": "1. Fetch the PR...\n2. ...",
  "triggers": ["pr", "review"],
  "parameters": [{ "name": "prUrl", "required": true }],
  "version": 1,
  "invocationCount": 12,
  "lastInvokedAt": 1745200000000
}
```

---

### context.skill.invoke

Fetch a skill's instructions and **atomically bump `invocationCount` and `lastInvokedAt`**. This is what the agent should call when it's about to follow the skill.

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `slug` | string | Yes | Skill slug |
| `projectPath` | string | No | |

#### Example Response

```json
{
  "slug": "review-pr",
  "name": "Review a pull request",
  "description": "Standard PR review checklist.",
  "instructions": "1. Fetch the PR...\n2. ...",
  "parameters": [{ "name": "prUrl", "required": true }],
  "version": 1,
  "invocationCount": 13,
  "lastInvokedAt": 1745200123456
}
```

---

### context.skill.update

Partial update. At least one of `name`, `description`, `instructions`, `triggers`, `parameters` must be provided. If `name`, `description`, or `instructions` changes, `version` bumps.

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `slug` | string | Yes | Skill slug |
| `name` | string | No | New name |
| `description` | string | No | New description |
| `instructions` | string | No | New instructions body |
| `triggers` | string[] | No | Replace triggers |
| `parameters` | object[] | No | Replace parameters |
| `projectPath` | string | No | |

#### Example Response

```json
{
  "id": "<uuid>",
  "slug": "review-pr",
  "name": "Review a pull request",
  "description": "Standard PR review checklist.",
  "version": 2
}
```

---

### context.skill.delete

Delete a skill by slug.

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `slug` | string | Yes | Skill slug |
| `projectPath` | string | No | |

#### Example Response

```json
{ "deleted": true, "slug": "review-pr" }
```

Returns `{ deleted: false }` if no skill with that slug existed.

---

## Docs Tools

### context.importDocs

Seed L2 memory from known onboarding docs. Scans the project for `CLAUDE.md`, `AGENTS.md`, `README.md`, `CHANGELOG.md`, `ROADMAP.md`, `CONTRIBUTING.md` (or an explicit `files` list), stores each as a pinned L2 memory with `provenance.filePath` set, and fingerprints the content via a `doc-import:<sha>` tag so re-running is idempotent.

Type routing:
- `CLAUDE.md`, `AGENTS.md`, `README.md`, `CONTRIBUTING.md` → `convention`
- `CHANGELOG.md`, `ROADMAP.md` → `scratchpad`

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `projectPath` | string | No | Project root. Defaults to current engine's project |
| `files` | string[] | No | Explicit files (absolute or relative to `projectPath`). Defaults to auto-discovery |
| `maxChars` | number | No | Per-file character cap. Longer files are truncated with an explicit marker (default `50000`) |
| `dryRun` | boolean | No | If `true`, return what would be imported without storing (default `false`) |

#### Example Request

```json
{ "projectPath": "/home/user/myapp" }
```

#### Example Response

```json
{
  "projectPath": "/home/user/myapp",
  "imported": [
    { "file": "CLAUDE.md", "id": "<uuid>", "bytes": 1840, "truncated": false, "status": "stored" },
    { "file": "README.md", "id": "<uuid>", "bytes": 12030, "truncated": false, "status": "stored" },
    { "file": "CHANGELOG.md", "bytes": 0, "truncated": false, "status": "skipped-missing" },
    { "file": "AGENTS.md", "id": "<existing-id>", "bytes": 920, "truncated": false, "status": "skipped-duplicate" }
  ],
  "summary": { "total": 4, "stored": 2, "skipped": 2, "truncated": 0 },
  "dryRun": false
}
```

---

## Backup & Migration

### context.backup

Create a consistent timestamped snapshot of L2 and L3 databases using SQLite `VACUUM INTO`. Safe to run while the server is in use. Two files are written to `destDir`: `l2-memory-<ts>.db` and `l3-semantic-<ts>.db`.

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `destDir` | string | Yes | Absolute directory path. Created if missing |
| `projectPath` | string | No | Project whose L2 is backed up |

#### Example Response

```json
{
  "destDir": "/home/user/backups/2026-04-21",
  "files": [
    { "path": "/home/user/backups/2026-04-21/l2-memory-1745235200000.db", "size": 2097152, "layer": 2 },
    { "path": "/home/user/backups/2026-04-21/l3-semantic-1745235200000.db", "size": 4194304, "layer": 3 }
  ],
  "totalBytes": 6291456
}
```

---

### context.export

Export L2 and L3 memories to a JSON Lines file. Embeddings are omitted; the importer will recompute them. One JSON object per line.

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `destPath` | string | Yes | Absolute path to the `.jsonl` file. Parent dirs are created |
| `layers` | number[] | No | Layers to export. Default `[2, 3]`. Pass `[1,2,3]` to include ephemeral L1 |
| `projectPath` | string | No | |

#### Example Response

```json
{
  "destPath": "/home/user/exports/fabric-2026-04-21.jsonl",
  "counts": { "l1": 0, "l2": 47, "l3": 62 },
  "total": 109
}
```

---

### context.import

Import memories from a JSON Lines file produced by `context.export`. Each valid line is re-stored via the normal store path (L3 entries are re-embedded).

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `srcPath` | string | Yes | Absolute path to a `.jsonl` file |
| `projectPath` | string | No | |

#### Example Response

```json
{
  "srcPath": "/home/user/exports/fabric-2026-04-21.jsonl",
  "imported": 107,
  "skipped": 2,
  "errors": []
}
```

---

## Observability

### context.metrics

Return in-process observability metrics: counters, latency histograms (p50/p95/p99) for recall calls by mode, memory counts per layer, and pinned counts.

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `projectPath` | string | No | |
| `reset` | boolean | No | If `true`, reset histograms/counters after snapshot (default `false`) |

#### Example Response

```json
{
  "stats": { "l1": 3, "l2": 47, "l3": 62, "total": 112, "pinned": { "l2": 2, "l3": 1 } },
  "counters": { "recall.hybrid": 142, "recall.semantic": 18, "store.l3": 33 },
  "histograms": {
    "recall.hybrid.ms": { "count": 142, "p50": 8, "p95": 24, "p99": 61 },
    "recall.semantic.ms": { "count": 18, "p50": 6, "p95": 12, "p99": 12 }
  },
  "reset": false
}
```

---

### context.health

Health check. Validates L2 and L3 SQLite connectivity, embedding model presence, and optional sqlite-vec extension. Returns `status: 'ok' | 'degraded'` and per-check detail.

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `projectPath` | string | No | |

#### Example Response

```json
{
  "status": "ok",
  "version": "0.14.0",
  "checks": [
    { "name": "l2", "status": "ok" },
    { "name": "l3", "status": "ok" },
    { "name": "embedding", "status": "ok", "detail": "bge-small-en (384)" },
    { "name": "sqlite-vec", "status": "ok", "detail": "loaded" }
  ]
}
```

When a check fails, `status` becomes `degraded` and the failing check carries an error detail.

---

## Graph Tools

The scoped fabric graph models projects, sessions, files, symbols, memories, decisions, errors, and skills as temporal entities connected by typed relationships. Graph tools are useful for lineage, neighborhood, timeline, and migration workflows.

### context.graph.query

Query the scoped fabric temporal graph for neighbors, timelines, decision lineage, current/as-of decisions, or short paths.

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `op` | string | Yes | One of `neighbors`, `lineage`, `decisions`, `timeline`, `path` |
| `entityId` | string | No | Entity id for `neighbors`, `lineage`, or `timeline` |
| `fromEntityId` | string | No | Path source entity id |
| `toEntityId` | string | No | Path target entity id |
| `direction` | string | No | `out`, `in`, or `both` (default: `both`) |
| `type` | string | No | Optional relationship type filter |
| `asOf` | number | No | Epoch milliseconds for temporal as-of queries |
| `currentOnly` | boolean | No | For `decisions`, return only currently-effective decisions |
| `maxDepth` | number | No | Maximum path traversal depth (default: `4`) |
| `projectPath` | string | No | Project path |

#### Example Request

```json
{
  "op": "decisions",
  "currentOnly": true,
  "projectPath": "/home/user/myapp"
}
```

#### Example Response

```json
{
  "decisions": [
    {
      "id": "memory:decision-123",
      "kind": "decision",
      "label": "Use Postgres for durable event storage",
      "validFrom": 1777392000000
    }
  ]
}
```

### context.graph.export

Export graph entities and relationships to deterministic JSON for backup, migration, or rebuild validation.

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `destPath` | string | Yes | Absolute JSON path to write |
| `projectPath` | string | No | Project path |

#### Example Request

```json
{
  "destPath": "/home/user/backups/context-graph.json",
  "projectPath": "/home/user/myapp"
}
```

### context.graph.import

Import scoped fabric graph JSON previously produced by `context.graph.export`.

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `srcPath` | string | Yes | Absolute JSON path to read |
| `projectPath` | string | No | Project path |

#### Example Request

```json
{
  "srcPath": "/home/user/backups/context-graph.json",
  "projectPath": "/home/user/myapp"
}
```

---

## Changes since v0.7.1

This document reflects v0.14.0. For the full per-version changelog, see [CHANGELOG.md](../CHANGELOG.md). At a glance:

- **v0.8 – v0.10**: `context.storeBatch`, `context.backup`, `context.export`/`context.import`, `context.metrics`, `context.health`. Pagination on `context.recall` and `context.list`. Weight multiplier on memories. Hybrid search.
- **v0.11**: Provenance, dedup-on-store, bi-temporal (`asOf` / `includeSuperseded` on recall; `supersedes` on store). See [Memory Types](memory-types.md#provenance-v011).
- **v0.12**: Skills (six `context.skill.*` tools), `context.importDocs`, MCP Resources (`memory://...`), MCP Prompts (`cf-*` slash-commands). See [Skills](skills.md) and [MCP Primitives](mcp-primitives.md).
- **v0.13**: Bundled `sqlite-vec` ANN acceleration, public benchmark harnesses, and GPU setup helpers.
- **v0.14**: Explainable retrieval scoring/artifacts, diagnostic ranking-preservation fixes, scoped fabric graph tools, code-index repair, and code-aware current-context improvements.

### Tools consolidated before v0.8

| Old Tool | Use Instead | Notes |
|----------|------------|-------|
| `context.ghost` | `context.getCurrent` | Ghost messages are in the `ghostMessages` field |
| `context.time` | `context.orient` | Use `expression` and `also` params for date resolution and world clock |
| `context.getPatterns` | `context.getCurrent` | Use `language` and `filePath` params to filter patterns |
| `context.promote` | `context.update` | Use `targetLayer` param to promote to a higher layer |
| `context.stats` | `context.list` | Use `stats: true` to get memory store counts |

---

[← CLI Setup](cli-setup.md) | [Memory Types →](memory-types.md) | [Skills →](skills.md) | [MCP Primitives →](mcp-primitives.md) | [Back to README](../README.md)
