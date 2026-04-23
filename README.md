<div align="center">

# Context Fabric

**Local-first MCP memory for AI coding agents.**

Your agent remembers decisions, patterns, project context, and what changed while you were away — across sessions, projects, and tools.

[![Version](https://img.shields.io/badge/version-0.13.0-blue?style=flat-square)](https://github.com/Abaddollyon/context-fabric)
[![Tests](https://img.shields.io/badge/tests-719%20passing-brightgreen?style=flat-square)](tests/)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/node-22.5%2B-brightgreen?style=flat-square)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/docker-ready-2496ED?style=flat-square&logo=docker&logoColor=white)](Dockerfile)
[![CI](https://img.shields.io/github/actions/workflow/status/Abaddollyon/context-fabric/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/Abaddollyon/context-fabric/actions)

</div>

> [!NOTE]
> **Pre-1.0, but built for daily use.** Context Fabric is actively used, tested, and released regularly. APIs and storage formats may still evolve before 1.0, so pin versions and review the [CHANGELOG](CHANGELOG.md) before upgrading.

## Start Here

- **Want to try it fast?** Go to [Quick Start](#quick-start)
- **Need a client config?** Open [CLI Setup](docs/cli-setup.md)
- **Want the full tool surface?** See [Tools Reference](docs/tools-reference.md)
- **Prefer guided docs?** Browse the [Wiki](https://github.com/Abaddollyon/context-fabric/wiki)

## Why it exists

Coding agents are great in-session and forgetful between sessions. Important context disappears when the terminal closes: decisions, debugging discoveries, codebase conventions, partial work, and the answer to "what changed since I was last here?"

Context Fabric gives MCP-compatible coding agents a persistent memory layer that stays local, searchable, and useful.

## Who it's for

- Developers using MCP-capable coding tools like Claude Code, Cursor, Codex CLI, Gemini CLI, OpenCode, or Kimi
- Teams that want persistent agent memory without sending code and context to a hosted memory service
- Builders who want a lightweight local memory substrate instead of wiring up a separate vector database stack

## Why Context Fabric

- **Local-first by design** — SQLite storage, local embeddings, Docker/local deployment, zero cloud dependency.
- **Built for coding agents** — remembers decisions, bug fixes, conventions, code patterns, and current project state.
- **MCP-native** — works as a real MCP server with Tools, Resources, and Prompts.
- **Code-aware and time-aware** — semantic code search, symbol indexing, and orientation around offline gaps.
- **Practical to adopt** — no external vector database, no API key, no hosted control plane required.

## What you get

### Memory & retrieval
- **Three-layer memory** — Working (L1), Project (L2), Semantic (L3). Memories auto-route to the right layer.
- **Hybrid search** — FTS5 BM25 + vector cosine + Reciprocal Rank Fusion. Query-side instruction prefixes applied automatically per embedder family (BGE, E5, MiniLM). Sub-100 ms p50 on 50K+ corpora.
- **Semantic recall** — in-process vector embeddings via ONNX + fastembed (`bge-small-en-v1.5` by default, with one-env-var swap to larger models or GPU). No API keys needed.
- **Bundled ANN** — [sqlite-vec](https://github.com/asg017/sqlite-vec) ships as a regular dependency (since v0.13). KNN over the full corpus, graceful fallback if the loadable extension fails to attach.
- **Optional CUDA inference** — set `CONTEXT_FABRIC_EMBED_EP=cuda` + run `scripts/setup-gpu.sh` for ~30× ingest throughput on NVIDIA hardware.
- **Local code indexing** — scans source files, extracts symbols, and stays fresh via file watching.
- **Time-aware orientation** — "What changed while I was away?" with offline-gap detection and timezone support.
- **Ghost messages** — relevant memories surface via `context.getCurrent` without cluttering the main workflow.
- **Public-benchmark harness** — reproducible BEIR SciFact / FiQA and LongMemEval_S runners in `benchmarks/public/`.

### Memory intelligence
- **Provenance** — structured citation blocks on memories (`sessionId`, `eventId`, `filePath`, `commitSha`, `sourceUrl`, and more).
- **Dedup-on-store** — cosine near-duplicate detection for L3 with `skip`, `merge`, or `allow` strategies.
- **Bi-temporal memory** — `supersedes`, `validFrom`, and `validUntil` support for "what was true at that time?" reasoning.

### Agent ergonomics
- **Skills** — procedural memory with slugged, invokable instruction blocks and usage tracking.
- **MCP Resources** — browseable `memory://skills`, `memory://recent`, `memory://conventions`, `memory://decisions`, and templated resource views.
- **MCP Prompts** — slash-command workflows like `cf-orient`, `cf-capture-decision`, `cf-review-session`, `cf-search-code`, and `cf-invoke-skill`.
- **`context.importDocs`** — one-shot seeding from common onboarding docs like `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, and `AGENTS.md`.
- **Recall-quality harness** — benchmark recall@k and MRR with `npm run bench:quality`.

### Operations & DX
- **25 MCP tools** — memory CRUD, recall/orientation, code search, docs import, backup/export/import, metrics/health, and 6 skill tools.
- **Graceful shutdown** — drains in-flight calls, checkpoints WAL, and closes cleanly.
- **Data integrity** — startup checks, explicit multi-row transactions, and online backups.
- **Observability** — structured logging plus `context.metrics` and `context.health`.
- **Self-setup** — `context.setup` can install Context Fabric into supported CLIs.
- **Docker-first** — easy `docker run --rm -i` transport with persistent named-volume storage.

## Quick Start

Get running in a few minutes:

```bash
# 1. Clone and build the Docker image

git clone https://github.com/Abaddollyon/context-fabric.git
cd context-fabric
docker build -t context-fabric .

# 2. Verify the server responds

echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  | docker run --rm -i context-fabric
```

**3. Add it to your CLI** with the Docker transport:

```bash
docker run --rm -i -v context-fabric-data:/data/.context-fabric context-fabric
```

See [CLI Setup](docs/cli-setup.md) for copy-paste configs for all supported CLIs, or let your AI do it once Context Fabric is reachable:

> *"Install and configure Context Fabric for Cursor using Docker"*

<details>
<summary><strong>Local install (without Docker)</strong></summary>

Requires Node.js 22.5+:

```bash
git clone https://github.com/Abaddollyon/context-fabric.git
cd context-fabric
npm install
npm run build
```

The server is at `dist/server.js`. Point your CLI MCP config at `node dist/server.js`.

</details>

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
> Once Context Fabric is running in one MCP-capable tool, it can usually install itself into the others through `context.setup`.

## What it feels like

Start a session and the agent orients itself:

```text
It is 9:15 AM on Wednesday, Feb 25 (America/New_York).
Project: /home/user/myapp.
Last session: 14 hours ago. 3 new memories were added while you were away.
```

Store a decision once:

```jsonc
{ "type": "decision", "content": "Use Zod for all API validation. Schemas live in src/schemas/." }
```

Recall it naturally later:

```jsonc
{ "query": "how do we validate inputs?" }
// => "Use Zod for all API validation. Schemas live in src/schemas/."
```

No cloud account. No hidden service dependency. No need to re-explain the codebase every session.

## Performance

Numbers on a commodity dev box (Ryzen 7 5800H + RTX 3060 12 GB, warm run, 2026-04-23):

### Retrieval quality — public benchmarks

| Benchmark | Metric | Context Fabric (v0.13, GPU) | OpenAI `text-embedding-3-small` | bge-base-en-v1.5 (dense-only) |
|---|---|---:|---:|---:|
| BEIR SciFact | nDCG@10 | **0.7439** | 0.774 | 0.740 |
| BEIR SciFact | Recall@100 | **0.9667** | ~0.93 | — |
| BEIR FiQA-2018 | nDCG@10 | **0.3801** | 0.397 | 0.406 |
| BEIR FiQA-2018 | Recall@100 | **0.7361** | ~0.69 | — |
| LongMemEval_S (500 q, 25K sessions) | Hit@5 | **0.9520** | — | — |
| LongMemEval_S | Recall@10 | **0.9472** | — | — |

**Reading this:** On Recall@100 — the metric that matters for agent memory where an LLM reranks the recalled set — we match or beat OpenAI's `text-embedding-3-small` on both BEIR subsets, while remaining free, offline, and 100% local. See [docs/benchmarks.md](docs/benchmarks.md) for the full methodology and reproduction commands.

### Latency and throughput

| Workload | Result |
|---|---|
| BEIR SciFact query p50 (bge-base, GPU + sqlite-vec) | **20 ms** |
| BEIR FiQA query p50 (bge-base, GPU + sqlite-vec) | **91 ms** |
| LongMemEval_S query p50 (bge-base, GPU + sqlite-vec) | **14.6 ms** |
| L3 `recall()` @ 10K memories (FTS5 prefilter, CPU) | **~8 ms p50**, <100 ms p99 |
| Ingest throughput (bge-base, RTX 3060 CUDA EP) | **~170 docs/s** (≈32× the CPU single-core baseline) |
| Full test suite (484 unit + src tests) | <20 s wall |
| Incremental `tsc` rebuild | **~0.8 s** |
| Server cold start (with L3 warm) | < 1 s |

Benchmark scripts: [`benchmarks/recall-latency.ts`](benchmarks/recall-latency.ts) (`npm run bench`), [`benchmarks/public/`](benchmarks/public/) (`npm run bench:beir:scifact`, `npm run bench:beir:fiqa`, `npm run bench:longmemeval:s`).

## Architecture at a glance

```text
CLI (Claude Code, Cursor, Codex, etc.)
  |
  | MCP protocol (stdio / Docker)
  v
Context Fabric Server
  |-- Smart Router -----> L1: Working Memory   (in-memory, session-scoped)
  |-- Time Service        L2: Project Memory   (SQLite, per-project)
  |-- Code Index          L3: Semantic Memory  (SQLite + embeddings, cross-project)
```

Memories auto-route to the right layer. Scratchpad notes go to L1. Decisions and bug fixes go to L2. Reusable patterns and conventions go to L3. See [Architecture](docs/architecture.md) for the full deep dive.

## Documentation

| Resource | Description |
|----------|-------------|
| [Getting Started](docs/getting-started.md) | Installation, first run, Docker and local setup |
| [CLI Setup](docs/cli-setup.md) | Per-CLI configuration for all 7 supported CLIs |
| [Tools Reference](docs/tools-reference.md) | Full docs for all 25 MCP tools |
| [Skills](docs/skills.md) | Procedural memory — create, invoke, and compose reusable skills |
| [MCP Primitives](docs/mcp-primitives.md) | Resources (`memory://...`) and Prompts (`cf-*`) |
| [Memory Types](docs/memory-types.md) | Type system, layers, routing, decay, provenance, and dedup |
| [Configuration](docs/configuration.md) | Storage paths, TTL, embedding notes, and environment variables |
| [Agent Integration](docs/agent-integration.md) | System-prompt guidance for automatic tool usage |
| [Architecture](docs/architecture.md) | Retrieval pipeline, internals, and performance design |
| [Benchmarks](docs/benchmarks.md) | Public-benchmark results (BEIR SciFact / FiQA, LongMemEval_S) with reproduction commands |
| [Changelog](CHANGELOG.md) | Version history and upgrade notes |
| [Wiki](https://github.com/Abaddollyon/context-fabric/wiki) | Launch-friendly guides, FAQ, troubleshooting, and setup walkthroughs |

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for how to get started.

## License

[MIT](LICENSE)

---

<div align="center">

**Stop re-explaining your codebase every session.**

[Get Started](docs/getting-started.md) · [Configure a CLI](docs/cli-setup.md) · [Browse the Wiki](https://github.com/Abaddollyon/context-fabric/wiki) · [Report a Bug](https://github.com/Abaddollyon/context-fabric/issues)

</div>
