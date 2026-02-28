# Tools Reference

All 12 MCP tools with full parameter docs and example payloads. Your AI calls these automatically -- you rarely need to invoke them by hand.

## Table of Contents

- [Core Tools](#core-tools)
  - [context.getCurrent](#contextgetcurrent)
  - [context.store](#contextstore)
  - [context.recall](#contextrecall)
- [Orientation & Time](#orientation--time)
  - [context.orient](#contextorient)
- [Code Tools](#code-tools)
  - [context.searchCode](#contextsearchcode)
- [CRUD Tools](#crud-tools)
  - [context.get](#contextget)
  - [context.update](#contextupdate)
  - [context.delete](#contextdelete)
  - [context.list](#contextlist)
- [Management Tools](#management-tools)
  - [context.summarize](#contextsummarize)
  - [context.reportEvent](#contextreportevent)
- [Setup Tools](#setup-tools)
  - [context.setup](#contextsetup)

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

Search the project's source code index. Supports three modes: full-text search, symbol search (functions/classes/types by name), and semantic search (natural-language similarity using embeddings). The index is built automatically on first use and stays up-to-date via file watching.

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

## Migration from v0.6 → v0.7.1

Five tools were consolidated into existing tools:

| Old Tool | Use Instead | Notes |
|----------|------------|-------|
| `context.ghost` | `context.getCurrent` | Ghost messages are in the `ghostMessages` field |
| `context.time` | `context.orient` | Use `expression` and `also` params for date resolution and world clock |
| `context.getPatterns` | `context.getCurrent` | Use `language` and `filePath` params to filter patterns |
| `context.promote` | `context.update` | Use `targetLayer` param to promote to a higher layer |
| `context.stats` | `context.list` | Use `stats: true` to get memory store counts |

---

[← CLI Setup](cli-setup.md) | [Memory Types →](memory-types.md) | [Back to README](../README.md)
