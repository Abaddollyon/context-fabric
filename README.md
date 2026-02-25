# Context Fabric

> MCP server for agentic CLI memory — semantic context management and time-aware orientation across sessions

[![Version](https://img.shields.io/badge/version-0.4.0-blue)](https://github.com/Abaddollyon/context-fabric)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Docker](https://img.shields.io/badge/docker-ready-blue)](Dockerfile)

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage with CLI Tools](#usage-with-cli-tools)
- [MCP Tools Reference](#mcp-tools-reference)
- [Memory Types](#memory-types)
- [Layer Behavior](#layer-behavior)
- [Development](#development)
- [License](#license)

## Overview

Context Fabric solves a critical problem for AI-powered CLI tools: **context loss between sessions**. When you work with Kimi, Claude Code, OpenCode, or similar tools, valuable context—decisions made, patterns discovered, bugs fixed—is lost when the session ends.

### The Problem

1. **Session Amnesia**: Each CLI session starts fresh, losing previous context
2. **Pattern Rediscovery**: You repeatedly explain the same code patterns
3. **Decision Drift**: Previous architectural decisions are forgotten
4. **No Temporal Awareness**: The AI doesn't know what time it is, or what changed while you were gone

### The Solution

Context Fabric provides a **three-layer memory architecture** plus **time-aware orientation** that intelligently routes, stores, and retrieves memories based on their importance and relevance:

- **L1 - Working Memory**: Ephemeral session context (recent files, scratchpad)
- **L2 - Project Memory**: Persistent project knowledge (decisions, bug fixes, sessions)
- **L3 - Semantic Memory**: Long-term patterns with vector search (reusable code, conventions)
- **Time Engine**: IANA-timezone-aware clock, natural language date resolution, offline-gap detection

### Key Features

- **Semantic Search**: Recall memories by meaning, not just keywords
- **Ghost Messages**: Silent context injection into CLI conversations
- **Pattern Detection**: Auto-capture and suggest code patterns
- **Event-Driven**: React to file opens, commands, errors, decisions
- **Multi-CLI**: Works with Kimi, Claude Code, OpenCode, Codex, Gemini CLI, Cursor, and more
- **Self-Installing**: AI can configure itself via `context.setup` when you ask
- **Docker transport**: Cross-platform `docker run --rm -i` transport — no Node.js install required on the host
- **Smart Routing**: Auto-determines which layer to store memories
- **Time & Orientation**: World clock, natural-language date anchors, "what happened while I was offline" loop

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            CLI Tools Layer                                   │
│   (Kimi / Claude Code / OpenCode / Codex / Gemini CLI / Cursor / ...)       │
└─────────────────────────────────────┬───────────────────────────────────────┘
                                      │ MCP Protocol (stdio)
                                      │ — or via Docker: docker run --rm -i —
┌─────────────────────────────────────▼───────────────────────────────────────┐
│                        Context Fabric MCP Server                             │
│                                                                              │
│  ┌──────────────────────┐  ┌──────────────────────┐                         │
│  │     Smart Router     │  │     Time Service     │                         │
│  │  (content → layer)   │  │  (IANA tz, anchors,  │                         │
│  └──────────┬───────────┘  │  offline-gap detect) │                         │
│             │              └──────────────────────┘                         │
│      ┌──────┼──────┐                                                         │
│      ▼      ▼      ▼                                                         │
│  ┌───────┐ ┌───────────────┐ ┌────────────────────┐                         │
│  │  L1   │ │      L2       │ │        L3          │                         │
│  │Working│ │Project Memory │ │  Semantic Memory   │                         │
│  │(RAM)  │ │(SQLite/proj.) │ │ (SQLite + cosine)  │                         │
│  │       │ │               │ │                    │                         │
│  │ • TTL │ │ • Decisions   │ │ • Embeddings       │                         │
│  │ • LRU │ │ • Bug fixes   │ │ • Decay algorithm  │                         │
│  │       │ │ • Sessions    │ │ • Cross-project    │                         │
│  └───────┘ └───────────────┘ └────────────────────┘                         │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **Storage**: CLI reports event → Smart Router analyzes → Store in appropriate layer
2. **Retrieval**: CLI requests context → Query all layers → Rank by relevance → Inject into prompt
3. **Orientation**: `context.orient` → check last-seen timestamp → summarize offline gap + recent memories
4. **Decay**: Background process reduces relevance of unused L3 memories over time
5. **Summarization**: Old L2 memories are condensed to save tokens

## Installation

### Prerequisites

- **Node.js 22.5+** (required — uses the built-in `node:sqlite` module)
- **OR Docker** (cross-platform, no Node.js install required on the host)

### Option 1: From Source (Local)

```bash
git clone https://github.com/Abaddollyon/context-fabric.git
cd context-fabric
npm install
npm run build
```

The server is now at `dist/server.js`. Use `node dist/server.js` as the MCP command.

### Option 2: Docker (Cross-Platform)

Docker is the recommended approach for Linux, macOS, and Windows — no runtime dependencies on the host.

```bash
git clone https://github.com/Abaddollyon/context-fabric.git
cd context-fabric

# Build the image (bakes in the ONNX embedding model — takes ~2 min first time)
docker build -t context-fabric .
```

The server runs as `docker run --rm -i -v context-fabric-data:/data/.context-fabric context-fabric`.

CLI tools configure this automatically via `context.setup` with `useDocker: true` (see below).

### Option 3: Auto-Setup via the AI

If Context Fabric is already running in one CLI, ask it to configure another:

> "Install and configure Context Fabric for OpenCode using Docker"

The AI calls `context.setup({ cli: "opencode", useDocker: true })` and writes the config automatically.

## Configuration

### Config File

```
~/.context-fabric/config.yaml
```

### Default Configuration

```yaml
storage:
  l2Path: ~/.context-fabric/l2-project.db
  l3Path: ~/.context-fabric/l3-semantic
  backupIntervalHours: 24

ttl:
  l1Default: 3600       # seconds (1 hour)
  l3DecayDays: 30
  l3AccessThreshold: 3

embedding:
  model: "Xenova/all-MiniLM-L6-v2"
  dimension: 384
  batchSize: 32

context:
  maxWorkingMemories: 10
  maxRelevantMemories: 10
  maxPatterns: 5
  maxSuggestions: 5
  maxGhostMessages: 5
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CONTEXT_FABRIC_DIR` | `~/.context-fabric` | Storage directory |
| `FASTEMBED_CACHE_PATH` | *(auto)* | ONNX model cache directory (set by Docker image) |
| `LOG_LEVEL` | `info` | Log level: debug, info, warn, error |
| `L1_DEFAULT_TTL` | `3600` | L1 TTL in seconds |
| `L3_DECAY_DAYS` | `30` | L3 decay period in days |

## Usage with CLI Tools

### Auto-Setup (Any Supported CLI)

The easiest approach — ask an AI that already has Context Fabric running:

> "Install and configure Context Fabric for Kimi using Docker"
> "Install and configure Context Fabric for Claude Code"

The AI calls `context.setup` and writes the config file. Add `preview: true` to see what would be written without applying it.

---

### CLI Config Files

All configs can be written by `context.setup` or manually:

#### OpenCode (`~/.config/opencode/opencode.json`)

```json
{
  "mcp": {
    "context-fabric": {
      "type": "local",
      "command": ["node", "/path/to/dist/server.js"],
      "enabled": true
    }
  }
}
```

Docker variant: replace `["node", "..."]` with `["docker", "run", "--rm", "-i", "-v", "context-fabric-data:/data/.context-fabric", "context-fabric"]`.

#### Kimi (`~/.kimi/mcp.json`)

```json
{
  "mcpServers": {
    "context-fabric": {
      "command": "node",
      "args": ["/path/to/dist/server.js"]
    }
  }
}
```

#### Claude Code (`~/.claude.json`)

```json
{
  "mcpServers": {
    "context-fabric": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/dist/server.js"],
      "env": {}
    }
  }
}
```

#### Claude Desktop

```json
// macOS: ~/Library/Application Support/Claude/claude_desktop_config.json
// Linux: ~/.config/Claude/claude_desktop_config.json
{
  "mcpServers": {
    "context-fabric": {
      "command": "node",
      "args": ["/path/to/dist/server.js"]
    }
  }
}
```

#### OpenAI Codex CLI (`~/.codex/config.toml`)

```toml
[mcp_servers.context-fabric]
command = "node"
args = ["/path/to/dist/server.js"]
enabled = true
```

#### Google Gemini CLI (`~/.gemini/settings.json`)

```json
{
  "mcpServers": {
    "context-fabric": {
      "command": "node",
      "args": ["/path/to/dist/server.js"]
    }
  }
}
```

Then run `/mcp enable context-fabric` inside a Gemini session.

#### Cursor (`~/.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "context-fabric": {
      "command": "node",
      "args": ["/path/to/dist/server.js"]
    }
  }
}
```

Cursor reloads MCP tools automatically on file save.

## MCP Tools Reference

### `context.getCurrent`

Get the current context window for a session (working memories, relevant memories, patterns, suggestions, ghost messages).

```json
{
  "sessionId": "unique-session-id",
  "currentFile": "src/main.ts",
  "currentCommand": "optional",
  "projectPath": "/path/to/project"
}
```

---

### `context.store`

Store a new memory. SmartRouter auto-selects the layer if not specified.

```json
{
  "type": "code_pattern|bug_fix|decision|convention|scratchpad|relationship",
  "content": "Memory content",
  "layer": 2,
  "metadata": {
    "tags": ["typescript", "auth"],
    "confidence": 0.9,
    "source": "user_explicit",
    "projectPath": "/path/to/project"
  },
  "ttl": 3600
}
```

---

### `context.recall`

Semantic search across all layers.

```json
{
  "query": "authentication error handling",
  "limit": 10,
  "threshold": 0.7,
  "filter": {
    "types": ["bug_fix", "code_pattern"],
    "layers": [2, 3],
    "tags": ["auth"]
  },
  "sessionId": "session-123"
}
```

---

### `context.time`

Get the current time as a rich snapshot, resolve natural-language date expressions, or show the same moment in multiple timezones.

```json
{
  "timezone": "America/New_York",
  "expression": "next Monday",
  "also": ["Europe/London", "Asia/Tokyo"]
}
```

**Supported expressions:** `now`, `today`, `yesterday`, `tomorrow`, `start of day`, `end of day`, `start of week`, `end of week`, `start of next week`, `start of last week`, `next Monday` … `next Sunday`, `last Monday` … `last Sunday`, any ISO date string, epoch-ms string.

**Returns:**
```json
{
  "anchor": {
    "epochMs": 1771891200000,
    "iso": "2026-02-25T00:00:00.000-05:00",
    "timezone": "America/New_York",
    "utcOffset": "-05:00",
    "timeOfDay": "12:00 AM",
    "date": "Wednesday, February 25, 2026",
    "dateShort": "Feb 25",
    "dayOfWeek": "Wednesday",
    "isWeekend": false,
    "weekNumber": 9,
    "startOfDay": 1771891200000,
    "endOfDay": 1771977599999,
    "startOfNextDay": 1771977600000,
    "startOfYesterday": 1771804800000,
    "startOfWeek": 1771804800000,
    "endOfWeek": 1772409599999,
    "startOfNextWeek": 1772409600000
  },
  "conversions": [
    { "timezone": "Europe/London", "timeOfDay": "5:00 AM", "utcOffset": "+00:00", ... },
    { "timezone": "Asia/Tokyo",    "timeOfDay": "2:00 PM", "utcOffset": "+09:00", ... }
  ]
}
```

---

### `context.orient`

The orientation loop: *"Where am I in time? What happened while I was offline? What project am I in?"*

Call this at the start of each session to ground yourself.

```json
{
  "timezone": "Europe/London",
  "projectPath": "/path/to/project"
}
```

**Returns:**
```json
{
  "summary": "It is 9:15 AM on Wednesday, February 25, 2026 (Europe/London, UTC+00:00). Project: /home/user/myapp. Last session: 14 hours 23 minutes ago (since 6:52 PM yesterday). 3 new memories were added while offline.",
  "time": { ... },
  "offlineGap": {
    "durationMs": 51780000,
    "durationHuman": "14 hours 23 minutes",
    "from": "2026-02-24T18:52:00.000+00:00",
    "to": "2026-02-25T09:15:00.000+00:00",
    "memoriesAdded": 3
  },
  "recentMemories": [ ... ]
}
```

The first time `context.orient` is called for a project, `offlineGap` is `null` and the summary says "First session in this project." Each call records the session timestamp so the gap is accurate next time.

---

### `context.summarize`

Condense old memories into a summary entry.

```json
{
  "sessionId": "session-123",
  "layer": 2,
  "olderThanDays": 30,
  "options": { "targetTokens": 2000, "includePatterns": true }
}
```

---

### `context.getPatterns`

Get relevant code patterns, optionally filtered by language or file.

```json
{
  "language": "typescript",
  "filePath": "src/main.ts",
  "limit": 5,
  "projectPath": "/path/to/project"
}
```

---

### `context.reportEvent`

Report CLI events for automatic memory capture.

**Event types:** `file_opened`, `command_executed`, `error_occurred`, `decision_made`, `session_start`, `session_end`, `pattern_detected`, `user_feedback`

```json
{
  "event": {
    "type": "error_occurred",
    "payload": { "error": "TypeError: Cannot read...", "file": "src/user.ts" },
    "timestamp": "2026-02-25T09:00:00.000Z",
    "sessionId": "session-123",
    "cliType": "claude-code",
    "projectPath": "/path/to/project"
  }
}
```

---

### `context.ghost`

Get ghost messages — silent context injections that provide background without cluttering the conversation.

```json
{
  "sessionId": "session-123",
  "trigger": "file_opened",
  "currentContext": "Working on authentication service",
  "projectPath": "/path/to/project"
}
```

---

### `context.promote`

Promote a memory to a higher layer (L1→L2, L2→L3).

```json
{
  "memoryId": "uuid-of-memory",
  "fromLayer": 1
}
```

---

### `context.setup`

Install and configure Context Fabric into a CLI tool's MCP config. The AI calls this automatically.

```json
{
  "cli": "opencode|claude|claude-code|kimi|codex|gemini|cursor|docker|generic",
  "serverPath": "/optional/override/path/to/server.js",
  "useDocker": false,
  "preview": false
}
```

| `cli` | Config File | Format |
|-------|-------------|--------|
| `opencode` | `~/.config/opencode/opencode.json` | JSON (`mcp` key) |
| `claude` | `claude_desktop_config.json` | JSON (`mcpServers` key) |
| `claude-code` | `~/.claude.json` | JSON (`mcpServers` key, `type: stdio`) |
| `kimi` | `~/.kimi/mcp.json` | JSON (`mcpServers` key) |
| `codex` | `~/.codex/config.toml` | TOML (`[mcp_servers.x]`) |
| `gemini` | `~/.gemini/settings.json` | JSON (`mcpServers` key) |
| `cursor` | `~/.cursor/mcp.json` | JSON (`mcpServers` key) |
| `docker` | — | Returns Docker snippets for all CLIs (no write) |
| `generic` | — | Returns local snippet (no write) |

Set `useDocker: true` to write a `docker run --rm -i` entry instead of a local `node` entry. The Docker image must be built first.

## Memory Types

| Type | Default Layer | Use For |
|------|---------------|---------|
| `code_pattern` | L3 | Reusable snippets, patterns, best practices |
| `bug_fix` | L2 | Resolved bugs and solutions |
| `decision` | L2 | Architectural decisions and rationale |
| `convention` | L3 | Code style, naming, folder structure |
| `scratchpad` | L1 | Temporary notes, TODOs, session reminders |
| `relationship` | L3 | Domain relationships, user preferences |

## Layer Behavior

### L1: Working Memory

| Property | Value |
|----------|-------|
| Storage | In-memory |
| Scope | Single session |
| TTL | Configurable (default: 1 hour) |
| Eviction | LRU when max size reached |
| Persistence | No |

### L2: Project Memory

| Property | Value |
|----------|-------|
| Storage | SQLite (`node:sqlite`, zero native deps) |
| Scope | Per-project |
| TTL | None (permanent until deleted or summarized) |
| Tables | `memories`, `memory_tags`, `project_meta` |
| Persistence | Yes, file-based |

`project_meta` stores per-project metadata including last-seen timestamps used by `context.orient`.

**Summarization:** Old memories (>N days) can be condensed into an archive entry to keep the database lean.

### L3: Semantic Memory

| Property | Value |
|----------|-------|
| Storage | SQLite (`node:sqlite`) + in-process cosine similarity |
| Scope | Cross-project (global) |
| Search | fastembed-js embeddings (ONNX, `all-MiniLM-L6-v2`) |
| Persistence | Yes, file-based |

**Decay algorithm:**
```
score = age_decay × 0.3 + inactivity_penalty × 0.7 + access_boost

age_decay          = exp(-age / (decayDays × 2))
inactivity_penalty = exp(-timeSinceAccess / decayDays)
access_boost       = min(accessCount / 10, 0.5)

If score < 0.1: memory is deleted
```

### Smart Router Decision Matrix

| Content Type | Tags | TTL | → Layer |
|--------------|------|-----|---------|
| `scratchpad` | any | any | L1 |
| `code_pattern` | — | — | L3 |
| `bug_fix` | — | — | L2 |
| `decision` | — | — | L2 |
| `convention` | — | — | L3 |
| `relationship` | — | — | L3 |
| any | `temp` | — | L1 |
| any | `global` | — | L3 |
| any | `project` | — | L2 |
| any | — | set | L1 |

## Development

### Prerequisites

- Node.js 22.5+ (uses built-in `node:sqlite`)
- npm

No external services required — all storage is SQLite, all vector search is in-process.

### Setup

```bash
git clone https://github.com/Abaddollyon/context-fabric.git
cd context-fabric
npm install
npm run build
npm test
```

### Docker Development

```bash
# Build the image (bakes the ONNX model into the image)
docker build -t context-fabric .

# Test the server manually
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  | docker run --rm -i context-fabric

# Use a named volume for persistent data
docker run --rm -i -v context-fabric-data:/data/.context-fabric context-fabric
```

### Project Structure

```
context-fabric/
├── src/
│   ├── server.ts          # MCP server (11 tools)
│   ├── engine.ts          # ContextEngine orchestrator (store, recall, orient, ...)
│   ├── time.ts            # TimeService (IANA tz, anchors, expression resolver)
│   ├── router.ts          # SmartRouter for layer selection
│   ├── setup.ts           # Auto-setup for all supported CLIs (local + Docker)
│   ├── config.ts          # Configuration management
│   ├── types.ts           # TypeScript types (Memory, OrientationContext, ...)
│   ├── embedding.ts       # Embedding service (fastembed-js / ONNX)
│   ├── patterns.ts        # Pattern extraction
│   ├── events.ts          # Event handling
│   └── layers/
│       ├── working.ts     # L1: Working Memory (in-memory, TTL/LRU)
│       ├── project.ts     # L2: Project Memory (node:sqlite)
│       └── semantic.ts    # L3: Semantic Memory (node:sqlite + cosine similarity)
├── tests/
│   ├── unit/              # Unit tests
│   ├── integration/       # Integration tests
│   └── e2e/               # End-to-end tests
├── docs/                  # CLI-specific setup guides
├── dist/                  # Compiled JavaScript
├── Dockerfile             # Multi-stage build (bakes ONNX model in)
├── .dockerignore
├── CHANGELOG.md
├── tsconfig.json
└── package.json
```

## License

MIT License — see [LICENSE](LICENSE) for details.

---

<p align="center">
  Built for the agentic CLI community
</p>
