# Tools Reference

All 11 MCP tools with full parameter docs and example payloads. Your AI calls these automatically -- you rarely need to invoke them by hand.

## Table of Contents

- [Core Tools](#core-tools)
  - [context.getCurrent](#contextgetcurrent)
  - [context.store](#contextstore)
  - [context.recall](#contextrecall)
- [Time Tools](#time-tools)
  - [context.time](#contexttime)
  - [context.orient](#contextorient)
- [Management Tools](#management-tools)
  - [context.summarize](#contextsummarize)
  - [context.promote](#contextpromote)
  - [context.ghost](#contextghost)
  - [context.getPatterns](#contextgetpatterns)
  - [context.reportEvent](#contextreportevent)
- [Setup Tools](#setup-tools)
  - [context.setup](#contextsetup)

---

## Core Tools

### context.getCurrent

Get the current context window for a session, including working memories, relevant memories, patterns, and suggestions.

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sessionId` | string | Yes | Unique session identifier |
| `currentFile` | string | No | Currently open file path |
| `currentCommand` | string | No | Current command being executed |
| `projectPath` | string | No | Project path for context |

#### Example Request

```json
{
  "sessionId": "session-abc-123",
  "currentFile": "src/main.ts",
  "currentCommand": "npm test",
  "projectPath": "/home/user/myapp"
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

#### Example Request

```json
{
  "type": "decision",
  "content": "Use Zod for all API input validation. Schemas live in src/schemas/ alongside the route handlers.",
  "metadata": {
    "tags": ["validation", "api", "zod"],
    "confidence": 0.95,
    "source": "user_explicit",
    "projectPath": "/home/user/myapp"
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

Semantic search across all memory layers. Returns ranked results with similarity scores.

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Search query (min 1 character) |
| `sessionId` | string | Yes | Session identifier |
| `limit` | number | No | Max results to return (default: `10`) |
| `threshold` | number | No | Minimum similarity score, 0-1 (default: `0.7`) |
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

## Time Tools

### context.time

Get the current time as a rich TimeAnchor. Optionally resolve natural-language date expressions or show the same moment in multiple timezones (world clock).

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `timezone` | string | No | IANA timezone name (e.g. `America/New_York`). Defaults to system timezone |
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

#### Example Request

```json
{
  "timezone": "America/New_York",
  "expression": "next Monday",
  "also": ["Europe/London", "Asia/Tokyo"]
}
```

#### Example Response

```json
{
  "resolved": 1772265600000,
  "anchor": {
    "epochMs": 1772265600000,
    "iso": "2026-03-02T00:00:00.000-05:00",
    "timezone": "America/New_York",
    "utcOffset": "-05:00",
    "timeOfDay": "12:00 AM",
    "date": "Monday, March 2, 2026",
    "dateShort": "Mar 2",
    "dayOfWeek": "Monday",
    "isWeekend": false,
    "weekNumber": 10,
    "startOfDay": 1772265600000,
    "endOfDay": 1772351999999,
    "startOfNextDay": 1772352000000,
    "startOfYesterday": 1772179200000,
    "startOfWeek": 1772265600000,
    "endOfWeek": 1772870399999,
    "startOfNextWeek": 1772870400000
  },
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

---

### context.orient

The orientation loop: "Where am I in time? What happened while I was offline? What project am I in?" Call this at the start of every session to ground the AI.

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `timezone` | string | No | IANA timezone name. Defaults to system timezone |
| `projectPath` | string | No | Project path. Defaults to current working directory |

#### Example Request

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

#### Example Response (Returning Session)

```json
{
  "summary": "It is 9:15 AM on Wednesday, February 25, 2026 (Europe/London, UTC+00:00). Project: /home/user/myapp. Last session: 14 hours 23 minutes ago (since 6:52 PM yesterday). 3 new memories were added while offline.",
  "time": { "..." : "..." },
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
      "content": "Fixed null pointer in user service when email is...",
      "createdAt": "2026-02-24T22:00:00.000Z",
      "tags": ["bugfix", "user-service"]
    }
  ]
}
```

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

### context.promote

Promote a memory to a higher layer (L1 to L2, or L2 to L3). This upgrades its persistence and scope.

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `memoryId` | string | Yes | ID of the memory to promote |
| `fromLayer` | number | Yes | Current layer of the memory: `1` or `2` |

#### Example Request

```json
{
  "memoryId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "fromLayer": 1
}
```

#### Example Response

```json
{
  "success": true,
  "memoryId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "newLayer": 2
}
```

> [!NOTE]
> Promoting from L2 to L3 generates an embedding vector for semantic search. This adds ~50ms per memory.

---

### context.ghost

Get ghost messages — silent context injections that provide relevant background without cluttering the conversation. These are invisible to the user but inform the AI.

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sessionId` | string | Yes | Session identifier |
| `trigger` | string | Yes | What triggered the ghost request (e.g. `file_opened`, `error_occurred`) |
| `currentContext` | string | Yes | Description of the current context |
| `projectPath` | string | No | Project path |

#### Example Request

```json
{
  "sessionId": "session-abc-123",
  "trigger": "file_opened",
  "currentContext": "Working on authentication service",
  "projectPath": "/home/user/myapp"
}
```

#### Example Response

```json
{
  "messages": [
    {
      "id": "ghost-001",
      "role": "system",
      "content": "This project uses JWT tokens with 15-minute expiry. The auth module was refactored last week to add refresh token rotation.",
      "timestamp": "2026-02-25T09:15:00.000Z",
      "trigger": "file_opened"
    }
  ],
  "relevantMemories": [
    {
      "id": "mem-042",
      "type": "decision",
      "content": "Use JWT with 15-minute expiry for API tokens..."
    }
  ],
  "suggestedActions": []
}
```

---

### context.getPatterns

Get relevant code patterns for the current context, optionally filtered by language or file.

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `language` | string | No | Filter by programming language |
| `filePath` | string | No | Filter by file path |
| `limit` | number | No | Max patterns to return (default: `5`) |
| `projectPath` | string | No | Project path |

#### Example Request

```json
{
  "language": "typescript",
  "filePath": "src/api/users.ts",
  "limit": 3,
  "projectPath": "/home/user/myapp"
}
```

#### Example Response

```json
{
  "patterns": [
    {
      "id": "pat-001",
      "name": "Zod input validation",
      "description": "Validate all API inputs with Zod schemas before processing",
      "code": "const schema = z.object({ email: z.string().email(), name: z.string().min(1) });\nconst validated = schema.parse(req.body);",
      "language": "typescript",
      "usageCount": 12,
      "lastUsedAt": "2026-02-24T16:00:00.000Z"
    }
  ]
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

[← CLI Setup](cli-setup.md) | [Memory Types →](memory-types.md) | [Back to README](../README.md)
