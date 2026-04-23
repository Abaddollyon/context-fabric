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
# Runtime defaults to `bge-small-en-v1.5` (384-d) via fastembed-js. Override
# with the `CONTEXT_FABRIC_EMBED_MODEL` env var (see the Env vars table below
# for valid names). The `model` key here is legacy/ignored pending full
# multi-model routing through the config file.
embedding:
  model: "Xenova/all-MiniLM-L6-v2"   # legacy/ignored — use CONTEXT_FABRIC_EMBED_MODEL instead
  dimension: 384                       # matches bge-small-en / bge-small-en-v1.5
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
| `CONTEXT_FABRIC_EMBED_MODEL` | `BGESmallENV15` | Embedding model. Accepts any case-insensitive key from fastembed's `EmbeddingModel` enum (`BGESmallEN`, `BGESmallENV15`, `BGEBaseEN`, `BGEBaseENV15`, `MLE5Large`, `AllMiniLML6V2`, `BGESmallZH`). Query/passage instruction prefixes are applied automatically per model family. Changing this changes the embedding dimension — always use a fresh L3 DB when switching models |
| `CONTEXT_FABRIC_EMBED_EP` | `cpu` | ONNX Runtime execution providers. Comma-separated, case-insensitive. Accepts `cpu`, `cuda`, or fallback chains like `cuda,cpu`. CUDA requires CUDA 12 runtime libraries on `LD_LIBRARY_PATH` — see [GPU inference](#gpu-inference-optional) |
| `FASTEMBED_CACHE_PATH` | *(auto)* | ONNX model cache directory. Auto-set inside the Docker image so the model is baked in |
| `CF_DISABLE_SQLITE_VEC` | *(unset)* | Set to `1` to force the FTS5 prefilter even when `sqlite-vec` is loaded. See [sqlite-vec](#sqlite-vec-bundled-ann-acceleration) |

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
| `model` | string | `Xenova/all-MiniLM-L6-v2` | **Legacy / not wired to the runtime.** To change the embedder use the `CONTEXT_FABRIC_EMBED_MODEL` environment variable (see above). Reserved for future multi-model support via the yaml file |
| `dimension` | number | `384` | Embedding vector dimensions (matches `bge-small-en` / `bge-small-en-v1.5`). For `bge-base-en-v1.5` this is 768 |
| `batchSize` | number | `32` | Batch size for embedding generation |
| `timeoutMs` | number | `30000` | Max milliseconds for a single `embed()` call. Prevents ONNX from hanging the MCP process |

> [!IMPORTANT]
> The runtime defaults to **`bge-small-en-v1.5`** (384 dimensions, ONNX via `fastembed-js`, in-process). Swap it via `CONTEXT_FABRIC_EMBED_MODEL=BGEBaseENV15` (etc.) — query/passage instruction prefixes are applied automatically per model family, no config changes required. The `embedding.model` yaml key is preserved for backwards compatibility but is currently ignored.

### `context`

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `maxWorkingMemories` | number | `10` | Max L1 memories in context window |
| `maxRelevantMemories` | number | `10` | Max L2/L3 memories in context window |
| `maxPatterns` | number | `5` | Max code patterns in context window |
| `maxSuggestions` | number | `5` | Max suggestions in context window |
| `maxGhostMessages` | number | `5` | Max ghost messages in context window |

## sqlite-vec (bundled ANN acceleration)

Since v0.13, [`sqlite-vec`](https://github.com/asg017/sqlite-vec) ships as a regular dependency. The package provides prebuilt loadable extensions for `linux-{x64,arm64}`, `darwin`, and `win32`, so every `npm install` / `docker build` produces an engine that uses ANN-accelerated vector search by default. If the extension fails to attach on your platform (sandboxed environments, hardened SQLite builds), Context Fabric logs a one-line warning and falls back to the FTS5-prefiltered cosine path with no behavioural changes.

### What you get

| L3 row count | Default path (FTS5 prefilter) | With `sqlite-vec` (default) |
|--------------|:-----------------------------:|:---------------------------:|
| up to ~10K | ~8 ms p50 | sub-millisecond |
| 10K–50K | ~8–30 ms p50 | sub-millisecond |
| 50K+ | degrades linearly | sub-millisecond |

On the BEIR FiQA benchmark (57,638 docs) enabling `sqlite-vec` cut query p50 from **2,895 ms to 91 ms** — a 32× speedup without any quality regression.

### Force the FTS5 fallback

If you want to benchmark the pure-JS path or `sqlite-vec` misbehaves on your platform:

```bash
CF_DISABLE_SQLITE_VEC=1 node dist/server.js
```

## GPU inference (optional)

Context Fabric embeds with ONNX Runtime via `fastembed-js`. By default that uses the CPU execution provider. On NVIDIA hardware with CUDA 12 runtime libraries available, setting `CONTEXT_FABRIC_EMBED_EP=cuda` switches to the CUDA execution provider and delivers **~30× the ingest throughput** (measured: 5.9 docs/s CPU → 170+ docs/s on an RTX 3060 12 GB).

The CUDA EP library is already shipped inside `node_modules/onnxruntime-node/bin/napi-v3/linux/x64/libonnxruntime_providers_cuda.so`; only the CUDA 12 runtime stack needs to be visible to `ld.so`. Use the bundled helper to drop the minimal set into a project-local directory (~1 GB, does not touch system CUDA):

```bash
scripts/setup-gpu.sh           # pip-install CUDA 12 wheels into .cuda-libs/
scripts/setup-gpu.sh --check   # verify
```

Then any command can be run GPU-accelerated via `scripts/bench-gpu.sh`:

```bash
scripts/bench-gpu.sh bench:beir:scifact
scripts/bench-gpu.sh bench:longmemeval:s
scripts/bench-gpu.sh -- node dist/server.js       # arbitrary command after `--`
```

`bench-gpu.sh` sets `LD_LIBRARY_PATH`, `CONTEXT_FABRIC_EMBED_EP=cuda`, and bumps `BENCH_INGEST_BATCH` to 128 (the 3060's attention ceiling).

**Fallback behaviour.** Setting `CONTEXT_FABRIC_EMBED_EP=cuda,cpu` tells ONNX to prefer CUDA but gracefully fall back to CPU if CUDA can't initialise (missing libs, no GPU). This is the recommended setting for portable deployments where the same image might run on heterogeneous hardware.

---

[← Getting Started](getting-started.md) | [Agent Integration →](agent-integration.md) | [Back to README](../README.md)
