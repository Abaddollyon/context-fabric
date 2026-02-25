# Tools Reference

Context Fabric exposes **16 MCP tools** organized into six categories. Your AI calls these automatically — you rarely need to invoke them by hand.

> [!TIP]
> Tools marked with ⭐ are the most commonly used. Your AI should call `context.orient` at session start and `context.store` whenever you make decisions or fix bugs.

---

## Table of Contents

- [Quick Overview](#quick-overview)
- [Core Tools](#core-tools)
  - [context.orient](#contextorient-)
  - [context.store](#contextstore-)
  - [context.recall](#contextrecall-)
  - [context.getCurrent](#contextgetcurrent)
- [Time Tools](#time-tools)
  - [context.time](#contexttime)
- [Code Tools](#code-tools)
  - [context.searchCode](#contextsearchcode-)
- [CRUD Tools](#crud-tools)
  - [context.get](#contextget)
  - [context.update](#contextupdate)
  - [context.delete](#contextdelete)
  - [context.list](#contextlist)
- [Management Tools](#management-tools)
  - [context.summarize](#contextsummarize)
  - [context.promote](#contextpromote)
  - [context.ghost](#contextghost)
  - [context.getPatterns](#contextgetpatterns)
  - [context.reportEvent](#contextreportevent)
- [Setup Tools](#setup-tools)
  - [context.setup](#contextsetup)
- [Memory Layers](#memory-layers)
- [See Also](#see-also)

---

## Quick Overview

| Category | Tools | Purpose |
|:---------|:------|:--------|
| **Core** | `getCurrent`, `store`, `recall` | Store and retrieve memories |
| **Time** | `time`, `orient` | Time awareness and session orientation |
| **Code** | `searchCode` | Search indexed source code |
| **CRUD** | `get`, `update`, `delete`, `list` | Memory lifecycle management |
| **Management** | `summarize`, `promote`, `ghost`, `getPatterns`, `reportEvent` | Advanced memory operations |
| **Setup** | `setup` | CLI configuration |

---

## Core Tools

### `context.orient` ⭐

The orientation loop. Call this at the start of every session to ground the AI in time, project, and recent changes.

**Returns:**
- Current time with timezone context
- Time since last session (offline gap)
- Memories added while you were away
- Human-readable summary

**Parameters**

| Parameter | Type | Required | Description |
|:----------|:-----|:---------|:------------|
| `timezone` | string | No | IANA timezone (e.g., `America/New_York`). Defaults to system timezone |
| `projectPath` | string | No | Project path. Defaults to current working directory |

**Example Request**

```json
{
  "timezone": "Europe/London",
  "projectPath": "/home/user/myapp"
}
```

**Example Response (Returning Session)**

```json
{
  "summary": "It is 9:15 AM on Wednesday, February 25, 2026 (Europe/London, UTC+00:00). Project: /home/user/myapp. Last session: 14 hours 23 minutes ago. 3 new memories were added while offline.",
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
  "offlineGap": {
    "durationMs": 51780000,
    "durationHuman": "14 hours 23 minutes",
    "from": "2026-02-24T18:52:00.000+00:00",
    "to": "2026-02-25T09:15:00.000+00:00",
    "memoriesAdded": 3
  },
  "recentMemories": [
    {
      "id": "mem-099",
      "type": "bug_fix",
      "content": "Fixed null pointer in user service when email is null",
      "createdAt": "2026-02-24T22:00:00.000Z",
      "tags": ["bugfix", "user-service"]
    }
  ]
}
```

---

### `context.store` ⭐

Store a memory in the fabric. The Smart Router auto-selects the optimal layer (L1/L2/L3) based on content type if you don't specify one.

**Memory Types**

| Type | Typical Layer | Use For |
|:-----|:-------------:|:--------|
| `decision` | L2 | Architectural choices, tech stack decisions |
| `bug_fix` | L2 | Resolved issues and their solutions |
| `code_pattern` | L3 | Reusable code patterns across projects |
| `convention` | L3 | Coding standards, naming conventions |
| `scratchpad` | L1 | Temporary notes, session-scratch |
| `relationship` | L3 | User preferences, working relationships |

**Parameters**

| Parameter | Type | Required | Description |
|:----------|:-----|:---------|:------------|
| `type` | string | Yes | Memory type (see table above) |
| `content` | string | Yes | Memory content (min 1 character) |
| `metadata` | object | Yes | See metadata fields below |
| `layer` | number | No | Force layer: `1`, `2`, or `3`. Auto-detected if omitted |
| `ttl` | number | No | Time-to-live in seconds (for L1 only) |
| `pinned` | boolean | No | Protect from decay/summarization |

**Metadata Fields**

| Field | Type | Description |
|:------|:-----|:------------|
| `tags` | string[] | Categorization tags |
| `title` | string | Human-readable title |
| `confidence` | number | AI confidence 0-1 (default: 0.8) |
| `weight` | number | Priority 1-5, default 3. Higher = more important |
| `source` | string | `user_explicit`, `ai_inferred`, `system_auto` |
| `projectPath` | string | Project scope |
| `fileContext` | object | `{ path, lineStart?, lineEnd?, language? }` |
| `codeBlock` | object | `{ code, language, filePath? }` |

**Example Request**

```json
{
  "type": "decision",
  "content": "Use Zod for all API input validation. Schemas live in src/schemas/ alongside route handlers.",
  "metadata": {
    "tags": ["validation", "api", "zod"],
    "confidence": 0.95,
    "source": "user_explicit",
    "projectPath": "/home/user/myapp",
    "weight": 4
  }
}
```

**Example Response**

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "success": true,
  "layer": 2,
  "pinned": false
}
```

---

### `context.recall` ⭐

Semantic search across all memory layers. Finds memories by meaning — no need for exact keyword matches.

**Parameters**

| Parameter | Type | Required | Description |
|:----------|:-----|:---------|:------------|
| `query` | string | Yes | Natural language search query |
| `sessionId` | string | Yes | Session identifier |
| `limit` | number | No | Max results (default: 10) |
| `threshold` | number | No | Min similarity 0-1 (default: 0.7) |
| `filter` | object | No | See filter options below |

**Filter Options**

| Field | Type | Description |
|:------|:-----|:------------|
| `types` | string[] | Filter by memory types |
| `layers` | number[] | Filter by layers: `[1]`, `[2]`, `[3]`, or mixed |
| `tags` | string[] | Filter by tags |
| `projectPath` | string | Filter to specific project |

**Example Request**

```json
{
  "query": "how do we handle authentication errors?",
  "sessionId": "session-abc-123",
  "limit": 5,
  "threshold": 0.7,
  "filter": {
    "types": ["bug_fix", "decision"],
    "layers": [2, 3],
    "tags": ["auth"]
  }
}
```

**Example Response**

```json
{
  "results": [
    {
      "memory": {
        "id": "mem-042",
        "type": "bug_fix",
        "content": "Fixed auth token refresh race condition by adding a mutex lock around the refresh call",
        "metadata": { "tags": ["auth", "race-condition"], "weight": 4 },
        "createdAt": "2026-02-20T14:30:00.000Z"
      },
      "similarity": 0.89,
      "layer": 2
    },
    {
      "memory": {
        "id": "mem-067",
        "type": "decision",
        "content": "Use JWT with 15-minute expiry for API tokens. Implement refresh token rotation.",
        "metadata": { "tags": ["auth", "jwt"] },
        "createdAt": "2026-02-18T10:00:00.000Z"
      },
      "similarity": 0.82,
      "layer": 2
    }
  ],
  "total": 2
}
```

---

### `context.getCurrent`

Get the current context window for a session — working memories, relevant memories, patterns, and suggestions.

**Parameters**

| Parameter | Type | Required | Description |
|:----------|:-----|:---------|:------------|
| `sessionId` | string | Yes | Unique session identifier |
| `currentFile` | string | No | Currently open file path |
| `currentCommand` | string | No | Current command being executed |
| `projectPath` | string | No | Project path for context |

---

## Time Tools

### `context.time`

Get rich time information with timezone support. Optionally resolve natural language expressions or show world clock conversions.

**Supported Expressions**

| Expression | Result |
|:-----------|:-------|
| `now`, `today`, `yesterday`, `tomorrow` | Self-explanatory |
| `start of day`, `end of day` | Day boundaries |
| `start of week`, `end of week` | Week boundaries (Mon-Sun) |
| `next Monday` … `next Sunday` | Upcoming weekday |
| `last Monday` … `last Sunday` | Previous weekday |
| ISO date string | Parsed as-is |

**Parameters**

| Parameter | Type | Required | Description |
|:----------|:-----|:---------|:------------|
| `timezone` | string | No | IANA timezone name |
| `expression` | string | No | Natural language expression to resolve |
| `also` | string[] | No | Additional timezones for world clock |

---

## Code Tools

### `context.searchCode` ⭐

Search the project's source code index. Three modes:
- `text` — Full-text search across file contents
- `symbol` — Find functions/classes/types by name
- `semantic` — Natural language similarity (default)

The index is built automatically on first use and stays up-to-date via file watching.

**Parameters**

| Parameter | Type | Required | Description |
|:----------|:-----|:---------|:------------|
| `query` | string | Yes | Search query |
| `mode` | string | No | `text`, `symbol`, or `semantic` (default: `semantic`) |
| `language` | string | No | Filter by language (e.g., `typescript`, `python`) |
| `filePattern` | string | No | Glob pattern (e.g., `src/**/*.ts`) |
| `symbolKind` | string | No | Filter symbols: `function`, `class`, `interface`, `type`, `enum`, `const`, `export`, `method` |
| `limit` | number | No | Max results (default: 10) |
| `threshold` | number | No | Min similarity for semantic search (default: 0.5) |
| `includeContent` | boolean | No | Include source content (default: true) |

**Example Request (Semantic)**

```json
{
  "query": "function that validates user input",
  "mode": "semantic",
  "language": "typescript",
  "limit": 5
}
```

**Example Response**

```json
{
  "results": [
    {
      "filePath": "src/validation/user.ts",
      "language": "typescript",
      "symbol": {
        "name": "validateUserInput",
        "kind": "function",
        "signature": "export function validateUserInput(data: unknown): ValidationResult",
        "lineStart": 15,
        "lineEnd": 42,
        "docComment": "Validates user input against the UserSchema"
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

**Supported Languages**

| Tier | Languages | Extraction |
|:-----|:----------|:-----------|
| Tier 1 | TypeScript, JavaScript, Python, Rust, Go | Full: functions, classes, interfaces, types, enums, doc comments |
| Tier 2 | Java, C#, Ruby, C/C++ | Functions and classes |

---

## CRUD Tools

### `context.get`

Get a specific memory by ID. Searches across all layers.

**Parameters**

| Parameter | Type | Required | Description |
|:----------|:-----|:---------|:------------|
| `memoryId` | string | Yes | Memory ID |
| `projectPath` | string | No | Project path |

---

### `context.update`

Update a memory's content, metadata, or tags. L1 memories cannot be updated (they're ephemeral). L3 memories are re-embedded only if content changes.

**Parameters**

| Parameter | Type | Required | Description |
|:----------|:-----|:---------|:------------|
| `memoryId` | string | Yes | Memory ID |
| `content` | string | No | New content |
| `metadata` | object | No | Metadata to merge |
| `tags` | string[] | No | New tags (replaces existing) |
| `weight` | number | No | Update weight (1-5) |
| `pinned` | boolean | No | Pin/unpin memory |

---

### `context.delete`

Delete a memory by ID. Searches across all layers.

**Parameters**

| Parameter | Type | Required | Description |
|:----------|:-----|:---------|:------------|
| `memoryId` | string | Yes | Memory ID |
| `projectPath` | string | No | Project path |

**Response**

```json
{
  "success": true,
  "deletedFrom": 2
}
```

---

### `context.list`

Browse memories with filters and pagination. Defaults to L2 (project) memories.

**Parameters**

| Parameter | Type | Required | Description |
|:----------|:-----|:---------|:------------|
| `layer` | number | No | Layer: 1, 2, or 3 (default: 2) |
| `type` | string | No | Filter by memory type |
| `tags` | string[] | No | Filter by tags (OR logic) |
| `limit` | number | No | Max results (default: 20) |
| `offset` | number | No | Pagination offset (default: 0) |

---

## Management Tools

### `context.summarize`

Condense old memories into a summary entry. Keeps databases lean over time.

**Parameters**

| Parameter | Type | Required | Description |
|:----------|:-----|:---------|:------------|
| `sessionId` | string | Yes | Session identifier |
| `layer` | number | No | Layer to summarize: 2 or 3 (default: 2) |
| `olderThanDays` | number | No | Summarize memories older than N days (default: 30) |
| `options` | object | Yes | `{ targetTokens, focusTypes?, includePatterns?, includeDecisions? }` |

---

### `context.promote`

Promote a memory to a higher layer (L1→L2 or L2→L3). Upgrades persistence and scope.

> [!NOTE]
> Promoting to L3 generates an embedding vector (~50ms).

**Parameters**

| Parameter | Type | Required | Description |
|:----------|:-----|:---------|:------------|
| `memoryId` | string | Yes | Memory ID |
| `fromLayer` | number | Yes | Current layer (1 or 2) |

---

### `context.ghost`

Get ghost messages — silent context injections invisible to the user but informing the AI.

**Parameters**

| Parameter | Type | Required | Description |
|:----------|:-----|:---------|:------------|
| `sessionId` | string | Yes | Session identifier |
| `trigger` | string | Yes | What triggered the request (e.g., `file_opened`) |
| `currentContext` | string | Yes | Description of current context |

---

### `context.getPatterns`

Get relevant code patterns for the current context.

**Parameters**

| Parameter | Type | Required | Description |
|:----------|:-----|:---------|:------------|
| `language` | string | No | Filter by language |
| `filePath` | string | No | Filter by file |
| `limit` | number | No | Max patterns (default: 5) |

---

### `context.reportEvent`

Report a CLI event for automatic memory capture.

**Event Types**

| Type | Description |
|:-----|:------------|
| `file_opened` | User opened a file |
| `command_executed` | Command was run |
| `error_occurred` | Error encountered |
| `decision_made` | Design decision made |
| `session_start` / `session_end` | Session boundaries |
| `pattern_detected` | Code pattern identified |
| `user_feedback` | Explicit user feedback |

**Parameters**

| Parameter | Type | Required | Description |
|:----------|:-----|:---------|:------------|
| `event` | object | Yes | `{ type, payload, timestamp, sessionId, cliType, projectPath? }` |

---

## Setup Tools

### `context.setup`

Install Context Fabric into a CLI's MCP config automatically.

**Supported CLIs**

| CLI | Config File |
|:----|:------------|
| `kimi` | `~/.kimi/mcp.json` |
| `claude-code` | `~/.claude.json` |
| `claude` | `claude_desktop_config.json` |
| `opencode` | `~/.config/opencode/opencode.json` |
| `codex` | `~/.codex/config.toml` |
| `gemini` | `~/.gemini/settings.json` |
| `cursor` | `~/.cursor/mcp.json` |
| `docker` | Returns Docker snippets (no write) |

**Parameters**

| Parameter | Type | Required | Description |
|:----------|:-----|:---------|:------------|
| `cli` | string | Yes | Target CLI (see table) |
| `serverPath` | string | No | Path to `dist/server.js` (auto-detected) |
| `useDocker` | boolean | No | Use Docker transport (default: false) |
| `preview` | boolean | No | Return config without writing (default: false) |

**Example**

```json
// Preview mode
{
  "cli": "kimi",
  "useDocker": true,
  "preview": true
}
```

---

## Memory Layers

Context Fabric uses three memory layers:

| Layer | Name | Scope | Persistence | Best For |
|:------|:-----|:------|:------------|:---------|
| L1 | Working | Session | Minutes-hours | Scratchpad, transient thoughts |
| L2 | Project | Project | Months | Decisions, bug fixes, project docs |
| L3 | Semantic | Cross-project | Permanent (decay) | Patterns, conventions, reusable knowledge |

The **Smart Router** automatically assigns memories to the optimal layer based on content type, tags, and TTL.

---

## See Also

- [Home](Home) — Overview and quick start
- [Architecture](../docs/architecture.md) — System internals
- [Memory Types](../docs/memory-types.md) — Detailed type system
