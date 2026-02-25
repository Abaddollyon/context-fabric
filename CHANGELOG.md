# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned
- Cross-project memory linking
- Team/collaborative memory sharing
- Memory compression for old entries
- Web UI for memory management
- Metrics and analytics dashboard

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

[Unreleased]: https://github.com/Abaddollyon/context-fabric/compare/v0.4.5...HEAD
[0.4.5]: https://github.com/Abaddollyon/context-fabric/compare/v0.4.0...v0.4.5
[0.4.0]: https://github.com/Abaddollyon/context-fabric/compare/v0.2.0...v0.4.0
[0.2.0]: https://github.com/Abaddollyon/context-fabric/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Abaddollyon/context-fabric/compare/v0.0.1...v0.1.0
[0.0.1]: https://github.com/Abaddollyon/context-fabric/releases/tag/v0.0.1
