# Configuration

Context Fabric uses a YAML configuration file with sensible defaults. You only need to customize it if you want to change default behaviors.

---

## Config File Location

```
~/.context-fabric/config.yaml
```

The configuration directory and file are created automatically on first run if they don't exist.

---

## Default Configuration

Copy-paste ready YAML with all defaults and helpful comments:

```yaml
# Context Fabric Configuration
# ============================
# This file is located at ~/.context-fabric/config.yaml
# Changes take effect on the next Context Fabric restart.

# -----------------------------------------------------------------------------
# Storage Configuration
# -----------------------------------------------------------------------------
# Paths for the L2 (project) and L3 (semantic) memory stores.
# These can be absolute paths or relative to ~/.context-fabric/
storage:
  # L2: SQLite database for project-scoped memories
  l2Path: ~/.context-fabric/l2-project.db
  
  # L3: Directory for semantic memory SQLite + embeddings
  l3Path: ~/.context-fabric/l3-semantic
  
  # Automatic backup interval for L2 database (in hours)
  backupIntervalHours: 24

# -----------------------------------------------------------------------------
# TTL (Time To Live) Configuration
# -----------------------------------------------------------------------------
# Controls memory expiration and decay behavior.
ttl:
  # L1 default TTL in seconds (1 hour = 3600)
  # L1 memories are ephemeral and auto-expire after this duration.
  l1Default: 3600
  
  # L3 decay period in days (aggressive — memories fade over time)
  # Use `context.update pinned:true` to exempt important memories from decay.
  l3DecayDays: 14
  
  # Minimum access count for L3 memories to persist past decay
  l3AccessThreshold: 3
  
  # Relevance score threshold below which L3 memories are deleted (0.0 - 1.0)
  l3DecayThreshold: 0.2

# -----------------------------------------------------------------------------
# Embedding Configuration
# -----------------------------------------------------------------------------
# Settings for the embedding model used in L3 semantic search.
embedding:
  # Model identifier (HuggingFace format)
  # Default: Xenova/all-MiniLM-L6-v2 (384 dimensions, fast, high quality)
  model: "Xenova/all-MiniLM-L6-v2"
  
  # Embedding dimension (must match the model)
  dimension: 384
  
  # Batch size for embedding generation
  batchSize: 32

# -----------------------------------------------------------------------------
# Context Window Configuration
# -----------------------------------------------------------------------------
# Limits for what gets injected into the CLI context window.
context:
  # Maximum working (L1) memories to include
  maxWorkingMemories: 10
  
  # Maximum relevant memories (from L2/L3) to include
  maxRelevantMemories: 10
  
  # Maximum code patterns to suggest
  maxPatterns: 5
  
  # Maximum contextual suggestions
  maxSuggestions: 5
  
  # Maximum ghost messages (invisible context injections)
  maxGhostMessages: 5

# -----------------------------------------------------------------------------
# CLI Defaults
# -----------------------------------------------------------------------------
# Default user preferences applied when new CLI connections are established.
cli:
  defaultCapabilities:
    # Auto-extract code patterns from conversations
    autoCapturePatterns: true
    
    # Auto-capture architectural decisions
    autoCaptureDecisions: true
    
    # How long to keep scratchpad entries (in hours)
    scratchpadRetentionHours: 24
    
    # Maximum memories to return in context queries
    maxContextMemories: 20
    
    # Preferred embedding model backend
    preferredEmbeddingModel: "fastembed-js"

# -----------------------------------------------------------------------------
# Code Index Configuration
# -----------------------------------------------------------------------------
# Settings for the automatic code indexing feature.
codeIndex:
  # Enable automatic code indexing
  enabled: true
  
  # Maximum file size to index (in bytes)
  maxFileSizeBytes: 1048576  # 1MB
  
  # Maximum number of files to index per project
  maxFiles: 10000
  
  # Number of lines per code chunk
  chunkLines: 150
  
  # Line overlap between chunks
  chunkOverlap: 10
  
  # Debounce time for file change events (in milliseconds)
  debounceMs: 500
  
  # Enable file watching for automatic re-indexing
  watchEnabled: true
  
  # Glob patterns to exclude from indexing
  excludePatterns: []
  # Example:
  # excludePatterns:
  #   - "**/node_modules/**"
  #   - "**/.git/**"
  #   - "**/dist/**"
```

---

## Environment Variables

These environment variables override config file settings:

| Variable | Description | Default |
|----------|-------------|---------|
| `CONTEXT_FABRIC_DIR` | Base directory for all Context Fabric data | `~/.context-fabric` |
| `FASTEMBED_CACHE_PATH` | Path to cached embedding models | Auto-detected |
| `LOG_LEVEL` | Logging verbosity: `debug`, `info`, `warn`, `error` | `info` |
| `L1_DEFAULT_TTL` | Override L1 default TTL (seconds) | `3600` |
| `L3_DECAY_DAYS` | Override L3 decay period (days) | `14` |

### Example Usage

```bash
# Run with custom data directory
CONTEXT_FABRIC_DIR=/mnt/fastssd/context-fabric node server.js

# Use pre-downloaded embedding models (Docker setup)
FASTEMBED_CACHE_PATH=/app/models node server.js

# Debug logging
LOG_LEVEL=debug node server.js
```

---

## Storage Paths Structure

```
~/.context-fabric/                    # Base directory (CONTEXT_FABRIC_DIR)
├── config.yaml                       # Configuration file
├── l2-project.db                     # L2: Project memory (SQLite)
├── l2-project.db-wal                 # SQLite WAL file
├── l3-semantic/                      # L3: Semantic memory storage
│   ├── semantic.db                   # L3 database (SQLite)
│   └── semantic.db-wal               # SQLite WAL file
├── code-index.db                     # Code index database
└── backups/                          # Automatic backups
    └── l2-project.db.2025-01-15.bak  # Timestamped backups
```

### Layer Storage Details

| Layer | Storage | Scope | Persistence |
|-------|---------|-------|-------------|
| **L1 Working** | In-memory | Session | Ephemeral (TTL-based) |
| **L2 Project** | SQLite (`l2-project.db`) | Project | Persistent |
| **L3 Semantic** | SQLite (`semantic.db`) | Cross-project | Persistent with decay |
| **Code Index** | SQLite (`code-index.db`) | Project | Persistent |

---

## Docker Storage Setup

When running via Docker, data is persisted using a named volume:

```yaml
# docker-compose.yml
services:
  context-fabric:
    build: .
    container_name: context-fabric
    volumes:
      - context-fabric-data:/data/.context-fabric
    environment:
      - CONTEXT_FABRIC_DIR=/data/.context-fabric
      - FASTEMBED_CACHE_PATH=/app/models
```

### Inside the Container

```
/data/.context-fabric/    # Data volume (persisted)
├── config.yaml
├── l2-project.db
├── l3-semantic/
└── code-index.db

/app/models/              # Embedded ONNX models (baked into image)
└── fastembed/
    └── xenova-all-minilm-l6-v2/
```

### Volume Management

```bash
# Build the Docker image
docker build -t context-fabric .

# Run with persistent volume
docker run --rm -i \
  -v context-fabric-data:/data/.context-fabric \
  context-fabric

# Inspect the volume
docker volume inspect context-fabric-data

# Backup data from volume
docker run --rm \
  -v context-fabric-data:/data \
  -v $(pwd)/backup:/backup \
  alpine tar czf /backup/context-fabric-backup.tar.gz -C /data .
```

---

## Configuration Reference

### Storage Section

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `storage.l2Path` | string | `~/.context-fabric/l2-project.db` | Path to L2 SQLite database |
| `storage.l3Path` | string | `~/.context-fabric/l3-semantic` | Directory for L3 storage |
| `storage.backupIntervalHours` | number | `24` | Auto-backup interval in hours |

### TTL Section

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `ttl.l1Default` | number | `3600` | L1 memory TTL in seconds (1 hour) |
| `ttl.l3DecayDays` | number | `14` | Days before L3 memories decay |
| `ttl.l3AccessThreshold` | number | `3` | Min accesses to persist past decay |
| `ttl.l3DecayThreshold` | number | `0.2` | Relevance score threshold for deletion |

### Embedding Section

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `embedding.model` | string | `Xenova/all-MiniLM-L6-v2` | HuggingFace model identifier |
| `embedding.dimension` | number | `384` | Embedding vector dimension |
| `embedding.batchSize` | number | `32` | Batch size for embedding generation |

**Available Models:**

| Model | Dimension | Speed | Quality |
|-------|-----------|-------|---------|
| `Xenova/all-MiniLM-L6-v2` | 384 | ⭐⭐⭐ Fast | ⭐⭐⭐ Good |
| `Xenova/all-MiniLM-L12-v2` | 384 | ⭐⭐ Medium | ⭐⭐⭐⭐ Better |

### Context Section

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `context.maxWorkingMemories` | number | `10` | Max L1 memories in context window |
| `context.maxRelevantMemories` | number | `10` | Max L2/L3 memories in context window |
| `context.maxPatterns` | number | `5` | Max code patterns to suggest |
| `context.maxSuggestions` | number | `5` | Max contextual suggestions |
| `context.maxGhostMessages` | number | `5` | Max invisible context injections |

---

## Tips

1. **Pin Important Memories**: Use `context.update pinned:true` to exempt critical L3 memories from decay.

2. **Adjust Decay for Your Workflow**: If 14 days feels too aggressive, increase `l3DecayDays` to 30 or 60.

3. **Custom Storage Location**: Set `CONTEXT_FABRIC_DIR` to use a fast SSD or network storage.

4. **Embedding Model Cache**: Pre-download models to `FASTEMBED_CACHE_PATH` for offline/air-gapped usage.

5. **Backup Before Changes**: The L2 database is auto-backed up, but manually back up before major config changes.
