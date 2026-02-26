# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned

## [0.6.0] - 2026-02-25

### Added
- **Embedding timeout** — `EmbeddingService` now accepts a `timeoutMs` option (default 30 s) and races all ONNX calls against a rejection timer, preventing the MCP process from hanging indefinitely on a stalled model load or embed call
- **`npm run dev`** — new `"dev": "tsc --watch"` script for continuous compilation during development

### Changed
- **Silent catch blocks now warn** — errors that were previously swallowed with empty catch bodies now emit `console.warn` with a descriptive message and the original error:
  - `events.ts`: code-index reindex failure during `file_opened` event
  - `code-index.ts`: file watcher reindex, stmtDeleteFile, corrupted chunk embedding, unreadable file during reindex, embedding batch failure
  - `scanner.ts`: `git ls-files` failure before readdir fallback
  - `patterns.ts`: `memoryToPattern` conversion failure
  - `setup.ts`: JSON parse failure when reading a CLI config file
- **CI expanded** — `.github/workflows/ci.yml` now runs `tsc --noEmit` (type check), `npm audit --audit-level=moderate` (security), and a separate `docker-build` job in addition to the existing build + test steps

### Technical
- `FabricConfig.embedding.timeoutMs` field added to both the type definition and default config (30 000 ms)
- `SemanticMemoryOptions.embeddingTimeoutMs` threads the timeout from engine config through to `EmbeddingService`
- `EmbeddingService.withTimeout<T>()` private helper wraps any promise in `Promise.race` against a labeled rejection
- Timeout covers both `FlagEmbedding.init()` (model load) and `embed()` / `embedBatch()` (inference)

## [0.5.5] - 2026-02-25

### Added
- **Pinned memories** — new `pinned` boolean field (default `false`) on L2 and L3 memories:
  - `context.store` — accepts top-level `pinned: true` to pin at creation time
  - `context.update` — accepts top-level `pinned` param to pin or unpin an existing memory
  - `context.get` / `context.list` — return `pinned` field in all results
- **Decay exemption** — `applyDecay()` skips rows with `pinned = 1`; pinned L3 memories are never automatically deleted
- **Summarize exemption** — L2 `summarize()` skips pinned memories; they are never archived into summary entries

### Technical
- `pinned INTEGER NOT NULL DEFAULT 0` SQL column added to both `memories` (L2) and `semantic_memories` (L3) tables
- Online migration: column added via `PRAGMA table_info` + `ALTER TABLE ADD COLUMN` — existing databases upgrade transparently on first connection
- `pinned` is a first-class SQL column (not stored in the metadata JSON blob) — enables efficient WHERE filtering without JSON parsing
- `Memory` interface gains top-level `pinned?: boolean` field

### Design Decisions
- `pinned` is top-level on `Memory` (not in `metadata`) because it's a storage-layer concern, not user metadata
- Migration is applied unconditionally at startup (idempotent index creation with `IF NOT EXISTS`), so cold-restart upgrades work without manual intervention
- `weight: 5` remains the soft alternative to pinning; `pinned: true` is the hard guarantee

## [0.5.4] - 2026-02-25

### Changed
- **Aggressive L3 decay** — default `l3DecayDays` reduced from 30 → **14 days**; unaccessed L3 memories age out roughly twice as fast
- **Configurable decay threshold** — deletion threshold raised from hardcoded `0.1` → configurable `l3DecayThreshold` (default **0.2**); memories need a higher relevance score to survive, keeping the store leaner
- **Decay on session start** — `context.orient` now fires `l3.applyDecay()` in the background on every call, ensuring pruning happens at session start even after a cold restart (previously only the hourly background timer triggered decay)

### Design Decisions
- Decay threshold is now a first-class config field (`ttl.l3DecayThreshold`) — override in `~/.context-fabric/config.yaml` to tune aggressiveness
- `orient()` decay is fire-and-forget — never blocks the context window response
- Pinned memories (0.5.5) will be exempt from decay; for now, `weight: 5` slows decay naturally via the access-boost mechanism

## [0.5.3] - 2026-02-25

### Added
- **Memory weighting** — new `weight` field (1–5, default 3) on memory metadata:
  - `weight: 4–5` surfaces memories above unweighted ones in recall results and context window
  - `weight: 1–2` deprioritises low-priority scratchpad notes
  - `context.store` — accepts `metadata.weight` (validated integer 1–5, defaults to 3)
  - `context.update` — accepts top-level `weight` param for convenient discoverability
  - `context.recall` — applies `similarity × (weight / 3)` before ranking (weight 5 = 1.67×, weight 1 = 0.33×)
  - `context.getCurrent` — applies the same factor to `relevanceScore` in the context window assembly

### Design Decisions
- Weight lives in the existing metadata JSON blob — no database schema change needed
- Weight multiplier (not a hard filter) — weight-5 memories reliably outrank unweighted ones without guaranteeing inclusion regardless of similarity (pinned memories with a SQL-filterable column deferred to 0.5.5)
- Scale: weight/3 keeps weight-3 (default) as a 1.0× neutral multiplier
- Cross-project memory linking
- Team/collaborative memory sharing
- Memory compression for old entries
- Web UI for memory management
- Metrics and analytics dashboard

## [0.5.2] - 2026-02-25

### Added
- **Full CRUD MCP tools** — 4 new tools for complete memory management (12→16 tools):
  - `context.get` — Retrieve a specific memory by ID, searching across all layers (L1→L2→L3)
  - `context.update` — Update a memory's content, metadata, or tags. L3 re-embeds only on content change
  - `context.delete` — Delete a memory by ID from whichever layer it lives in
  - `context.list` — Browse memories with pagination, layer/type/tag filters. Defaults to L2
- **`SemanticMemoryLayer.update()`** — Update L3 memories with selective re-embedding (skips 50ms model invocation when only metadata/tags change)
- **`SemanticMemoryLayer.getAll(limit, offset)`** — Paginated listing of L3 memories ordered by relevance score
- **`ProjectMemoryLayer.count()`** — Total memory count for accurate pagination totals
- **`ContextEngine` CRUD methods** — `getMemory()`, `updateMemory()`, `deleteMemory()`, `listMemories()` with cross-layer orchestration

### Fixed
- **E2E test memory leak** — E2E suite now uses `isEphemeral: true` so test memories are stored in the temp project directory and cleaned up with it, instead of leaking into the global L2 database on every test run
- **Embedding circuit breaker** — if model init fails, subsequent calls throw immediately instead of retrying on every request
- **Embedding LRU cache** — evict oldest entry when cache exceeds 10K entries, preventing unbounded memory growth
- **`listMemories` SQL filtering** — add `findByTypePaginated`, `findByTagsPaginated`, `countByType`, `countByTags` to L2 and L3 layers; engine no longer loads all rows into RAM for filtered queries
- **Version mismatches** — smithery.yaml and server.ts were pinned to old versions
- **docker-compose.yml** — remove dead ChromaDB service and invalid bun healthcheck
- **.env.example** — remove stale ChromaDB/EMBEDDING_MODEL/L3_STORAGE_PATH references

### Changed
- **Missing tools in smithery.yaml** — added searchCode, get, update, delete, list (were absent)

### Design Decisions
- L1 (working) memories cannot be updated — they are ephemeral; store a new one instead
- `deleteMemory()` throws on not-found — caller error, surface it
- `listMemories()` defaults to L2 — the primary persistent store
- `getMemory()` bumps L2 access count — consistent with existing `l2.get()` behaviour

### Technical
- All 517 tests pass (39 new + 478 existing) across unit, integration, and E2E suites
- New CRUD tests in `engine.test.ts` (20 tests), `server.test.ts` (15 tests), `full-flow.test.ts` (4 tests)
- Updated all docs to reflect 16 MCP tools (was 12)

## [0.4.5] - 2026-02-25

### Added
- **Local code indexing** — new per-project code index that scans source files, extracts symbols, and stays up-to-date via file watching
  - `src/indexer/code-index.ts` — Main `CodeIndex` class with SQLite schema, three search modes (text, symbol, semantic), smart chunking at symbol boundaries
  - `src/indexer/scanner.ts` — File discovery via `git ls-files` with recursive readdir fallback, incremental mtime/hash diffing, binary detection
  - `src/indexer/symbols.ts` — Regex-based symbol extraction for 8 languages (TS/JS, Python, Rust, Go, Java, C#, Ruby, C/C++)
  - `src/indexer/watcher.ts` — `fs.watch({ recursive: true })` wrapper with per-file 500ms debouncing
- **`context.searchCode` MCP tool** (tool #12) — search project source code by text, symbol name, or semantic similarity
  - Supports filtering by language, file pattern, and symbol kind
  - Returns file path, language, symbol metadata, chunk content, and similarity scores
  - Index is built automatically on first use and refreshed on `context.orient` and `file_opened` events
- **Shared `detectLanguage` utility** — extracted from `events.ts` into `scanner.ts` for reuse across indexer and event handler
- **`getEmbeddingService()` getter** on `SemanticMemoryLayer` — shares the ONNX model instance between L3 and code index
- **`codeIndex` config block** in `FabricConfig` — configurable `maxFileSizeBytes`, `maxFiles`, `chunkLines`, `chunkOverlap`, `debounceMs`, `watchEnabled`, `excludePatterns`
- **Engine integration** — lazy `getCodeIndex()`, fire-and-forget `incrementalUpdate()` on `orient()`, `reindexFile()` on `file_opened` events, `close()` cleanup

### Technical
- All 478 tests pass (78 new + 400 existing) across unit, integration, and E2E suites
- New test files: `symbols.test.ts` (19), `scanner.test.ts` (17), `code-index.test.ts` (unit: 19, integration: 5)
- Added code index coverage to `engine.test.ts` (5 tests), `server.test.ts` (6 tests), `full-flow.test.ts` (5 tests)
- Updated all docs to reflect 12 MCP tools (was 11)

## [0.4.0] - 2026-02-25

### Changed
- **Upgraded Vitest 1.6.1 → 4.0.18** with `@vitest/coverage-v8` 4.0.18
- **Coverage exclusions** for MCP-layer files (`server.ts`, `setup.ts`, `config.ts`) that require a live MCP transport

### Fixed
- `context.summarize` query used wrong column name (`query` → `content`) for memory text search
- Test API mismatch: `store()` tests updated to match actual engine signature
- `context.promote` multi-engine flow: L2→L3 promotion now correctly passes content through embedding pipeline
- `context.reportEvent` payload field: tests aligned with schema (`error` field in payload)
- `context.recall` project-aware routing: semantic results now respect `projectPath` filter
- `context.summarize` project-aware routing: summarization now scoped to the correct project
- `context.orient` returns proper `OfflineGap` structure on first call (was returning malformed object)

### Technical
- All 253 tests pass (unit, integration, E2E)
- Coverage above all configured thresholds

## [0.2.0] - 2026-02-25

### Added
- **Time integration** — new `src/time.ts` with `TimeService` class:
  - `now(tz?)` — full `TimeAnchor` (time, date, UTC offset, day/week boundaries, ISO week number)
  - `atTime(epochMs, tz?)` — `TimeAnchor` for any arbitrary moment
  - `convert(epochMs, tz)` — `TimeConversion` for world-clock display
  - `resolve(expression, tz?)` — natural-language date resolver: `"now"`, `"today"`, `"yesterday"`, `"tomorrow"`, `"start/end of day"`, `"start/end of week"`, `"next/last Monday"` … `"next/last Sunday"`, ISO strings, epoch-ms strings
  - `formatDuration(ms)` — human-readable duration (`"3 hours 42 minutes"`)
  - `formatRelative(epochMs)` — relative time (`"2 hours ago"`, `"in 3 days"`)
  - `commonZones()` — curated list of 40 IANA timezone names
  - Uses only Node.js built-in `Intl` API — zero external dependencies
  - DST-safe `startOfDay` via noon-UTC algorithm

- **`context.time` MCP tool** — world clock, expression resolver, multi-timezone display:
  - Optional `timezone` (IANA name, defaults to system timezone)
  - Optional `expression` — resolves natural-language date anchors to `TimeAnchor`
  - Optional `also` array — show same moment in multiple timezones

- **`context.orient` MCP tool** — session orientation loop:
  - Returns `TimeAnchor`, project path, offline gap since last session, recent memories added while offline
  - Human-readable `summary` field ("It is 9:15 AM … Last session: 14 hours ago … 3 new memories added while offline.")
  - First session returns `offlineGap: null` with "First session in this project."
  - Automatically records last-seen timestamp on each call

- **`project_meta` table in L2** (`src/layers/project.ts`):
  - Stores per-project key/value metadata (e.g. `last_seen` epoch ms)
  - `getLastSeen()`, `updateLastSeen()`, `getMemoriesSince(epochMs)` methods

- **`OrientationContext` and `OfflineGap` types** in `src/types.ts`

- **Docker transport support**:
  - Rewrote `Dockerfile` — `node:22-slim`, multi-stage build, bakes ONNX model into image via `COPY local_cache /app/models` + `ENV FASTEMBED_CACHE_PATH=/app/models`
  - `ENV HOME=/data` — makes `os.homedir()` return `/data` inside the container
  - `VOLUME ["/data/.context-fabric"]` — named-volume persistence
  - Non-root user (`cf:cf`)
  - `docker run --rm -i -v context-fabric-data:/data/.context-fabric context-fabric` is a drop-in MCP stdio transport

- **`useDocker` parameter for `context.setup`**:
  - `context.setup({ cli: "...", useDocker: true })` writes a `docker run --rm -i` entry instead of a local `node` entry
  - Works for all supported CLIs (OpenCode, Claude, Claude Code, Kimi, Codex, Gemini, Cursor)

- **`docker` CLI type for `context.setup`**:
  - `context.setup({ cli: "docker" })` returns Docker config snippets for all supported CLIs without writing any files

- **`claude-code` added to `SupportedCLI` and config** in `setup.ts` (was missing before)

### Changed
- **Migrated from `sqlite3` / `better-sqlite3` to `node:sqlite`** (built-in since Node.js 22.5):
  - `src/layers/project.ts` — rewritten from callback-based `sqlite3` to synchronous `DatabaseSync`
  - `src/layers/semantic.ts` — rewritten from callback-based `sqlite3` to synchronous `DatabaseSync`
  - Zero native compilation, no prebuilt binary downloads, works on any Node.js 22.5+ install

- **Removed `sqlite3`, `better-sqlite3`, `@rollup/rollup-linux-x64-gnu`, `bun-types`** from `package.json`

- **Updated `@types/node` to `^22.0.0`** to get `node:sqlite` type definitions

- **`smithery.yaml`** updated: runtime changed from `bun` to `node 22+`, all 11 tools listed, features updated

- **`README.md`** fully rewritten: Docker setup, new tools, updated project structure, npm-based dev workflow

### Technical
- Node.js 22.5+ required (for `node:sqlite` built-in)
- All storage is now zero-dependency: `node:sqlite` for both L2 and L3
- L3 vector search: in-process cosine similarity over `node:sqlite` rows
- TypeScript strict mode, clean compile with `tsc`

## [0.1.0] - 2026-02-24

### Added
- Initial release of Context Fabric
- Three-layer memory architecture:
  - L1: Working Memory (in-memory, TTL-based, LRU eviction)
  - L2: Project Memory (SQLite, project-scoped)
  - L3: Semantic Memory (SQLite, vector search via cosine similarity)
- SmartRouter for automatic layer selection
- MCP server with 9 tools:
  - `context.getCurrent` — Get context window
  - `context.store` — Store memories
  - `context.recall` — Semantic search
  - `context.summarize` — Condense old memories
  - `context.getPatterns` — Get code patterns
  - `context.reportEvent` — Report CLI events
  - `context.ghost` — Get ghost messages
  - `context.promote` — Promote memories between layers
  - `context.setup` — Auto-configure any supported CLI
- Embedding service using fastembed-js (ONNX, all-MiniLM-L6-v2)
- Pattern detection and extraction
- Event-driven memory capture
- Ghost message system for silent context injection
- Decay algorithm for L3 semantic memory
- Configuration management with YAML
- Docker support
- Multi-CLI support: OpenCode, Claude Desktop, Claude Code, Kimi, Codex, Gemini, Cursor
- TypeScript support with full type definitions
- Test suite with vitest

## [0.0.1] - 2026-02-01

### Added
- Project scaffolding
- Initial architecture design
- Basic type definitions
- Development environment setup

[Unreleased]: https://github.com/Abaddollyon/context-fabric/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/Abaddollyon/context-fabric/compare/v0.5.5...v0.6.0
[0.5.5]: https://github.com/Abaddollyon/context-fabric/compare/v0.5.4...v0.5.5
[0.5.4]: https://github.com/Abaddollyon/context-fabric/compare/v0.5.3...v0.5.4
[0.5.3]: https://github.com/Abaddollyon/context-fabric/compare/v0.5.2...v0.5.3
[0.5.2]: https://github.com/Abaddollyon/context-fabric/compare/v0.4.5...v0.5.2
[0.4.5]: https://github.com/Abaddollyon/context-fabric/compare/v0.4.0...v0.4.5
[0.4.0]: https://github.com/Abaddollyon/context-fabric/compare/v0.2.0...v0.4.0
[0.2.0]: https://github.com/Abaddollyon/context-fabric/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Abaddollyon/context-fabric/compare/v0.0.1...v0.1.0
[0.0.1]: https://github.com/Abaddollyon/context-fabric/releases/tag/v0.0.1
