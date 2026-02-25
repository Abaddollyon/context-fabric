<div align="center">

# Context Fabric

**Persistent memory for AI coding agents.** Your agent remembers everything -- across sessions, projects, and tools.

[![Version](https://img.shields.io/badge/version-0.4.5--beta-blue?style=flat-square)](https://github.com/Abaddollyon/context-fabric)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/node-22.5%2B-brightgreen?style=flat-square)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/docker-ready-2496ED?style=flat-square&logo=docker&logoColor=white)](Dockerfile)
[![CI](https://img.shields.io/github/actions/workflow/status/Abaddollyon/context-fabric/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/Abaddollyon/context-fabric/actions)

</div>

> [!NOTE]
> **Beta Software.** Context Fabric works and is actively used, but APIs and storage formats may change between versions. Pin your version and check the [CHANGELOG](CHANGELOG.md) before upgrading.

---

## The Problem

Every time an AI CLI session ends, its context vanishes. Decisions, patterns, bug fixes -- gone. Next session, you start from scratch.

## The Solution

Context Fabric is an [MCP](https://modelcontextprotocol.io/) server that gives your AI agent a **three-layer memory system** and **time-aware orientation**. It remembers what happened, what changed while you were away, and what matters right now. No external APIs. No cloud. Everything runs locally.

## Features

- **Three-layer memory** -- Working (L1), Project (L2), Semantic (L3). Memories auto-route to the right layer.
- **Local code indexing** -- Scans source files, extracts symbols (functions/classes/types), and stays up-to-date via file watching. Search by text, symbol name, or semantic similarity.
- **Semantic recall** -- Search by meaning using in-process vector embeddings. No API keys needed.
- **Time-aware orientation** -- "What happened while I was away?" Offline gap detection, timezone support, session continuity.
- **Ghost messages** -- Relevant memories surface silently without cluttering the conversation.
- **Pattern detection** -- Auto-captures and reuses code patterns across projects.
- **Self-installing** -- Ask your AI to run `context.setup` and it configures itself into any supported CLI.
- **Docker-first** -- Cross-platform `docker run --rm -i`. No Node.js required on the host.
- **12 MCP tools** -- Store, recall, orient, time, summarize, promote, ghost, patterns, events, searchCode, setup.
- **Zero external dependencies** -- All storage is SQLite. All search is local. Nothing leaves your machine.

## Supported CLIs

| CLI | Setup | Docs |
|-----|-------|------|
| **Claude Code** | `context.setup({ cli: "claude-code" })` | [Guide](docs/cli-setup.md#claude-code) |
| **Kimi** | `context.setup({ cli: "kimi" })` | [Guide](docs/cli-setup.md#kimi) |
| **OpenCode** | `context.setup({ cli: "opencode" })` | [Guide](docs/cli-setup.md#opencode) |
| **Codex CLI** | `context.setup({ cli: "codex" })` | [Guide](docs/cli-setup.md#codex-cli) |
| **Gemini CLI** | `context.setup({ cli: "gemini" })` | [Guide](docs/cli-setup.md#gemini-cli) |
| **Cursor** | `context.setup({ cli: "cursor" })` | [Guide](docs/cli-setup.md#cursor) |
| **Claude Desktop** | `context.setup({ cli: "claude" })` | [Guide](docs/cli-setup.md#claude-desktop) |

> [!TIP]
> Skip manual config entirely. Once Context Fabric is running in **any** CLI, the AI can install itself into all the others -- see [Quick Start](#quick-start) step 3.

## Quick Start

Get running in 3 steps:

```bash
# 1. Clone and build the Docker image (~2 min)
git clone https://github.com/Abaddollyon/context-fabric.git
cd context-fabric
docker build -t context-fabric .

# 2. Test that it works
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  | docker run --rm -i context-fabric
```

**3. Add to your CLI.** Point your MCP config at the Docker transport:

```bash
docker run --rm -i -v context-fabric-data:/data/.context-fabric context-fabric
```

See [CLI Setup](docs/cli-setup.md) for copy-paste configs for all 7 CLIs, or let the AI do it -- once Context Fabric is running in one CLI, tell it:

> *"Install and configure Context Fabric for Cursor using Docker"*

It writes the config automatically. No manual editing needed.

<details>
<summary><strong>Local install (without Docker)</strong></summary>

Requires Node.js 22.5+:

```bash
git clone https://github.com/Abaddollyon/context-fabric.git
cd context-fabric
npm install && npm run build
```

The server is at `dist/server.js`. Point your CLI's MCP config at `node dist/server.js`.

</details>

## What It Looks Like

Start a session. The AI calls `context.orient` and instantly knows where it is:

```
It is 9:15 AM on Wednesday, Feb 25 (America/New_York).
Project: /home/user/myapp.
Last session: 14 hours ago. 3 new memories added while you were away.
```

Store a decision. The AI remembers it next session, next week, across tools:

```jsonc
// Store
{ "type": "decision", "content": "Use Zod for all API validation. Schemas in src/schemas/." }

// Recall (semantic search -- doesn't need exact words)
{ "query": "how do we validate inputs?" }
// => "Use Zod for all API validation. Schemas in src/schemas/." (similarity: 0.91)
```

No configuration. No prompting. Memories route to the right layer automatically.

## How It Works

```
CLI (Claude Code, Cursor, etc.)
  |
  | MCP protocol (stdio / Docker)
  v
Context Fabric Server
  |-- Smart Router -----> L1: Working Memory  (in-memory, session-scoped)
  |-- Time Service        L2: Project Memory  (SQLite, per-project)
  |                       L3: Semantic Memory  (SQLite + vector search, cross-project)
```

Memories auto-route to the right layer. Scratchpad notes go to L1 (ephemeral). Decisions and bug fixes go to L2 (persistent). Code patterns and conventions go to L3 (searchable by meaning). See [Architecture](docs/architecture.md) for the full deep dive.

## Documentation

| Resource | Description |
|----------|-------------|
| [Getting Started](docs/getting-started.md) | Installation, first run, Docker and local setup |
| [CLI Setup](docs/cli-setup.md) | Per-CLI configuration (all 7 supported CLIs) |
| [Tools Reference](docs/tools-reference.md) | All 12 MCP tools with full parameter docs |
| [Memory Types](docs/memory-types.md) | Type system, three layers, [smart routing](docs/memory-types.md#smart-router), [decay](docs/memory-types.md#decay-algorithm) |
| [Configuration](docs/configuration.md) | Storage paths, TTL, embedding, environment variables |
| [Agent Integration](docs/agent-integration.md) | System prompt instructions for automatic tool usage |
| [Architecture](docs/architecture.md) | System internals, data flow, embedding strategy |
| [Changelog](CHANGELOG.md) | Version history and migration notes |

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for how to get started.

## License

[MIT](LICENSE)

---

<div align="center">

**Stop re-explaining your codebase every session.**

[Get Started](docs/getting-started.md) | [View All Tools](docs/tools-reference.md) | [Report a Bug](https://github.com/Abaddollyon/context-fabric/issues)

</div>
