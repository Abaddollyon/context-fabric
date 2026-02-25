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
  l3DecayDays: 30

  # Minimum access count for L3 memories to resist decay
  l3AccessThreshold: 3

# ── Embedding ────────────────────────────────────────────────────────────────
embedding:
  # ONNX model for generating embeddings (used by L3 semantic search)
  model: "Xenova/all-MiniLM-L6-v2"

  # Embedding vector dimensions (must match the model)
  dimension: 384

  # Number of texts to embed per batch
  batchSize: 32

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

Environment variables override config file values. Useful for Docker deployments and CI.

| Variable | Default | Description |
|----------|---------|-------------|
| `CONTEXT_FABRIC_DIR` | `~/.context-fabric` | Root storage directory for all data |
| `FASTEMBED_CACHE_PATH` | *(auto)* | ONNX model cache directory (set automatically by Docker image) |
| `LOG_LEVEL` | `info` | Log verbosity: `debug`, `info`, `warn`, `error` |
| `L1_DEFAULT_TTL` | `3600` | L1 working memory TTL in seconds |
| `L3_DECAY_DAYS` | `30` | L3 decay period in days |

> [!TIP]
> Set `LOG_LEVEL=debug` to see detailed routing decisions, embedding operations, and layer queries. Useful for troubleshooting.

## Storage Paths

Context Fabric stores all data under `~/.context-fabric/` (or `$CONTEXT_FABRIC_DIR`).

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
| `l3DecayDays` | number | `30` | Days before L3 memories start decaying |
| `l3AccessThreshold` | number | `3` | Minimum access count to resist L3 decay |

### `embedding`

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `model` | string | `Xenova/all-MiniLM-L6-v2` | ONNX embedding model identifier |
| `dimension` | number | `384` | Embedding vector dimensions |
| `batchSize` | number | `32` | Batch size for embedding generation |

### `context`

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `maxWorkingMemories` | number | `10` | Max L1 memories in context window |
| `maxRelevantMemories` | number | `10` | Max L2/L3 memories in context window |
| `maxPatterns` | number | `5` | Max code patterns in context window |
| `maxSuggestions` | number | `5` | Max suggestions in context window |
| `maxGhostMessages` | number | `5` | Max ghost messages in context window |

---

[← Getting Started](getting-started.md) | [Agent Integration →](agent-integration.md) | [Back to README](../README.md)
