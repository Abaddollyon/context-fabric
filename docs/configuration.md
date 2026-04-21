# Configuration

Context Fabric works out of the box with sensible defaults. Most users never need to touch the config -- but everything is customizable when you do.

## Table of Contents

- [Config File Location](#config-file-location)
- [Default Configuration](#default-configuration)
- [Environment Variables](#environment-variables)
- [Storage Paths](#storage-paths)
- [Configuration Reference](#configuration-reference)

## Config File Location

```text
~/.context-fabric/config.yaml
```

This file is created automatically on first run with default values. Edit it to override any setting.

> [!NOTE]
> When running via Docker, the config file lives inside the Docker volume. Mount it at `/data/.context-fabric/config.yaml` to customize.

## Default Configuration

```yaml
# ~/.context-fabric/config.yaml

# ── Storage ──────────────────────────────────────────────────────────────────
storage:
  # SQLite database for L2 project memory (one per project)
  l2Path: ~/.context-fabric/l2-project.db

  # Directory for L3 semantic memory (SQLite + embeddings, global)
  l3Path: ~/.context-fabric/l3-semantic

  # How often to back up databases (hours)
  backupIntervalHours: 24

# ── TTL & Decay ──────────────────────────────────────────────────────────────
ttl:
  # Default time-to-live for L1 working memory (seconds)
  # Memories expire after this duration unless accessed
  l1Default: 3600          # 1 hour

  # L3 decay period — memories unused for this long start losing relevance
  l3DecayDays: 14

  # Minimum access count for L3 memories to resist decay
  l3AccessThreshold: 3

  # Relevance score below which an L3 memory is deleted (pinned:true exempts)
  l3DecayThreshold: 0.2

# ── Embedding ────────────────────────────────────────────────────────────────
# ── Embedding ─────────────────────────────────────────────────────────────────────────
# Note: these keys are reserved for future multi-model support. The current
# runtime always loads `bge-small-en` (384-d) via fastembed-js regardless of
# what you put here. See the Embedding section below.
embedding:
  model: "Xenova/all-MiniLM-L6-v2"   # legacy/ignored — see note above
  dimension: 384                       # matches bge-small-en
  batchSize: 32
  timeoutMs: 30000                     # max ms per embed() call, prevents ONNX hangs
# ── Context Window ───────────────────────────────────────────────────────────
context:
  # Max L1 working memories included in context.getCurrent
  maxWorkingMemories: 10

  # Max L2/L3 memories included in context.getCurrent
  maxRelevantMemories: 10

  # Max code patterns included
  maxPatterns: 5

  # Max suggestions included
  maxSuggestions: 5

  # Max ghost messages included
  maxGhostMessages: 5
```

## Environment Variables

Environment variables override a subset of runtime behavior. Useful for Docker deployments, CI, and test isolation.

| Variable | Default | Description |
|----------|---------|-------------|
| `CONTEXT_FABRIC_HOME` | `~/.context-fabric` | Root storage directory for config, L2, and L3 databases |
| `CONTEXT_FABRIC_LOG_LEVEL` | `info` | Log verbosity: `debug`, `info`, `warn`, `error` |
| `CONTEXT_FABRIC_DEFAULT_PROJECT` | *(cwd)* | Fallback `projectPath` for primitives that don't take one (MCP Resources, Prompts) and for tool calls that omit `projectPath` |
| `FASTEMBED_CACHE_PATH` | *(auto)* | ONNX model cache directory. Auto-set inside the Docker image so the model is baked in |
| `CF_DISABLE_SQLITE_VEC` | *(unset)* | Set to `1` to force the FTS5 prefilter even when the optional `sqlite-vec` extension is installed. See [sqlite-vec](#sqlite-vec-optional-ann-acceleration) |

> [!TIP]
> Set `CONTEXT_FABRIC_LOG_LEVEL=debug` to see detailed routing decisions, embedding operations, and layer queries. Useful for troubleshooting.

> [!NOTE]
> TTL and decay settings (`l1Default`, `l3DecayDays`, `l3AccessThreshold`, `l3DecayThreshold`) are controlled via `config.yaml` only — there are no environment-variable shortcuts for them.

## Storage Paths

Context Fabric stores all data under `~/.context-fabric/` (or `$CONTEXT_FABRIC_HOME`).

```text
~/.context-fabric/
├── config.yaml           # Configuration file
├── l2-project.db         # L2 project memory (SQLite)
├── l3-semantic/          # L3 semantic memory directory
│   └── memories.db       # L3 embeddings + metadata (SQLite)
└── backups/              # Automatic database backups
```

**L2 (Project Memory)** uses `node:sqlite` (built-in, zero native dependencies). One database is shared across projects, with project-scoped queries.

**L3 (Semantic Memory)** uses `node:sqlite` with embedding vectors stored as JSON arrays. Cosine similarity is computed in-process — no external vector database required.

> [!WARNING]
> Do not move or rename storage files while the server is running. Stop the server first, move the files, update `config.yaml`, then restart.

### Docker Storage

When using Docker, persistent data lives in a named volume:

```bash
docker run --rm -i \
  -v context-fabric-data:/data/.context-fabric \
  context-fabric
```

The volume `context-fabric-data` persists between container restarts. To inspect or back up the data:

```bash
# Copy data out of the volume
docker run --rm -v context-fabric-data:/data alpine tar czf - /data \
  > context-fabric-backup.tar.gz
```

## Configuration Reference

### `storage`

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `l2Path` | string | `~/.context-fabric/l2-project.db` | SQLite database path for L2 project memory |
| `l3Path` | string | `~/.context-fabric/l3-semantic` | Directory for L3 semantic memory storage |
| `backupIntervalHours` | number | `24` | Automatic backup interval in hours |

### `ttl`

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `l1Default` | number | `3600` | Default TTL for L1 memories (seconds) |
| `l3DecayDays` | number | `14` | Days before L3 memories start decaying |
| `l3AccessThreshold` | number | `3` | Minimum access count to resist L3 decay |
| `l3DecayThreshold` | number | `0.2` | Relevance score below which L3 memories are deleted. `pinned:true` exempts a memory |

### `embedding`

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `model` | string | `Xenova/all-MiniLM-L6-v2` | **Legacy / not wired to the runtime.** The current engine always uses `bge-small-en` regardless of this value. Reserved for future multi-model support |
| `dimension` | number | `384` | Embedding vector dimensions (matches `bge-small-en`) |
| `batchSize` | number | `32` | Batch size for embedding generation |
| `timeoutMs` | number | `30000` | Max milliseconds for a single `embed()` call. Prevents ONNX from hanging the MCP process |

> [!IMPORTANT]
> The runtime ships with **`bge-small-en`** (384 dimensions, ONNX via `fastembed-js`, in-process). The `embedding.model` key is preserved in `config.yaml` for backwards compatibility but is currently ignored. When multi-model support lands it will respect this value.

### `context`

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `maxWorkingMemories` | number | `10` | Max L1 memories in context window |
| `maxRelevantMemories` | number | `10` | Max L2/L3 memories in context window |
| `maxPatterns` | number | `5` | Max code patterns in context window |
| `maxSuggestions` | number | `5` | Max suggestions in context window |
| `maxGhostMessages` | number | `5` | Max ghost messages in context window |

## sqlite-vec (optional ANN acceleration)

For L3 memory stores under ~50K rows, Context Fabric's default FTS5 prefilter + in-process cosine scan is already sub-10ms at p50 and requires zero native dependencies. For larger stores, you can opt into [`sqlite-vec`](https://github.com/asg017/sqlite-vec) — a loadable SQLite extension that provides ANN-accelerated vector search.

### When it matters

| L3 row count | Default path (FTS5 prefilter) | With `sqlite-vec` |
|--------------|:-----------------------------:|:-----------------:|
| up to ~10K | ~8ms p50 | sub-millisecond |
| 10K–50K | ~8–30ms p50 | sub-millisecond |
| 50K+ | degrades linearly | sub-millisecond |

Most users never need to install it. Reach for it only if `context.metrics` shows consistently slow L3 recall.

### Install

```bash
npm i sqlite-vec
```

That's it. On next startup the engine detects the module, loads the extension into both SQLite handles, and opts into the vec-backed recall path. No config changes required.

### Disable or force fallback

If you have `sqlite-vec` installed but want to benchmark the pure-JS path, or if extension loading fails on your platform:

```bash
CF_DISABLE_SQLITE_VEC=1 node dist/server.js
```

The engine falls back cleanly to the FTS5 prefilter regardless — if `sqlite-vec` can't be loaded (Windows without proper build tools, sandboxed environments), you get a one-line warning and the default code path.

---

[← Getting Started](getting-started.md) | [Agent Integration →](agent-integration.md) | [Back to README](../README.md)
