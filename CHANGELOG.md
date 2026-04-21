# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.12.0] - 2026-04-21

### Theme: Agent Ergonomics — Skills, Resources, Prompts, ImportDocs, Eval harness

First release that makes Context Fabric speak the full MCP vocabulary (Tools +
Resources + Prompts) and adds procedural memory ("Skills") alongside the
existing semantic/episodic layers. Turns a pure memory store into a full
agent-ergonomics server.

### Added

- **Skills layer (procedural memory).** New `MemoryType = "skill"` backed by
  L2 with structured `metadata.skill` ({ slug, name, description, triggers,
  parameters, version, invocationCount, lastInvokedAt }). `SkillService`
  (`src/skills.ts`) handles create/list/getBySlug/invoke/remove with
  slug-uniqueness enforcement and usage stats. Five new MCP tools:
  `context.skill.create`, `context.skill.list`, `context.skill.get`,
  `context.skill.invoke`, `context.skill.remove`. Skills are pinned by
  default so they're exempt from decay.
- **MCP Resources.** Server now declares the `resources` capability and
  exposes four static URIs plus two templates:
  - `memory://skills` — list of installed skills (JSON)
  - `memory://recent` — last 20 memories across layers (JSON)
  - `memory://conventions` — all memories tagged `convention` (JSON)
  - `memory://decisions` — all memories tagged `decision` (JSON)
  - `memory://skill/{slug}` — one skill as Markdown
  - `memory://memory/{id}` — any memory by UUID as JSON
- **MCP Prompts.** Five slash-commands for agents:
  - `cf-orient` — run context.orient and summarize the return
  - `cf-capture-decision` — ADR-style prompt with kebab-tag suggestion
  - `cf-review-session` — walk the last session's events + memories
  - `cf-search-code` — code search + citation workflow
  - `cf-invoke-skill` — retrieve and apply a named skill
- **`context.importDocs` tool.** One-shot seed from onboarding docs. Auto-
  discovers `CLAUDE.md`, `AGENTS.md`, `README.md`, `CHANGELOG.md`,
  `CONTRIBUTING.md`, `ARCHITECTURE.md` at the project root by default, or
  takes an explicit file list. Supports `dryRun` preview and a `maxChars`
  per-file truncation cap. Idempotent via tag-based dedup.
- **Recall quality benchmark** (`benchmarks/recall-quality.ts`, `npm run
  bench:quality`). 20 golden Q/A pairs, measures recall@k and MRR across
  pool sizes {0, 100, 1000}. Gives us a quality regression signal as we
  evolve retrieval.
- **Tests (unit + integration).**
  - `tests/unit/skills.test.ts` — 8 tests
  - `tests/integration/mcp-resources-prompts.test.ts` — 8 tests (via
    InMemoryTransport + Client → Server round-trip)
  - `tests/integration/import-docs.test.ts` — 6 tests

### Changed

- **`src/config.ts` now honors `CONTEXT_FABRIC_HOME`.** Previously the
  config dir was hard-wired to `~/.context-fabric`, which meant every test
  process shared one real DB file. Now evaluated lazily via helper
  functions, so per-test `process.env.CONTEXT_FABRIC_HOME` + `resetConfigCache()`
  gives full storage isolation. Zero production impact (default
  behaviour unchanged when env is not set).
- **`createServer()` and `__resetEnginesForTests()` exported** from
  `src/server.ts` so integration tests can round-trip MCP without
  spawning stdio.
- **`CONTEXT_FABRIC_DEFAULT_PROJECT` env var.** `getEngine()` falls back
  to this before `cwd()`, giving Resources/Prompts a deterministic
  project binding under test.
- **Tool count: 18 → 24.** Five skill tools + `context.importDocs`.
- **Server capabilities now include `resources` and `prompts`** in the
  `initialize` response.

### Fixed

- Concurrent test files no longer clobber each other's engine state
  (`fileParallelism: false` in `vitest.config.ts`) — a necessary tradeoff
  because several integration suites mutate process-global state
  (env vars, engines Map, config cache). Per-file tests still run
  sequentially by default, so only cross-file parallelism is disabled.
  Net effect: ~56s → ~63s on a 720-test suite.

### Stats

- **719 tests passing** (was 697).
- Five MCP primitives covered: Tools ✓, Resources ✓, Prompts ✓,
  Elicitation (ready), Sampling (ready).

## [0.11.2] - 2026-04-21

### Theme: Performance polish + README refresh

Second pass of the optimization track kicked off in v0.11.1. Cumulative
vs. the pre-optimization baseline (`npm test` wall clock):

  v0.11.0:  97.9s
  v0.11.1:  80.9s  (-17%)
  v0.11.2:  68.0s  (-30% cumulative)

### Changed

- **`src/indexer/code-index.ts` — `searchSemantic` FTS5 prefilter.**
  The code index's semantic search used to load every chunk row and
  cosine the full set — the same O(N) anti-pattern L3 had before v0.8.
  Now uses the BM25 index as a candidate pool (top `max(limit*10, 200)`)
  and cosines only those. Falls back to full scan when the sanitized
  query is empty or FTS5 returns zero hits. Also filters out empty
  embedding arrays (chunks that failed to embed at index time) before
  the sort. Expected 10–30× speedup on projects with 10K+ chunks.
- **`src/indexer/scanner.ts` — `isBinary` probe.** Previously read
  the entire file with `readFileSync` and sampled the first 8KB.
  Now uses `openSync` + `readSync` for a direct 8KB probe. No more
  full-file reads just to check for null bytes.
- **`tests/utils.ts` — tighten `setupTestEnvironment.cleanup()`.**
  Replaced two unconditional `sleep(100)` calls with `setImmediate()`
  ticks. Since the test engines are ephemeral and `engine.close()`
  is synchronous with an in-flight drain, a microtask tick is enough
  to let queued work settle. Saves ~200ms × integration-test count.

### Docs

- **README** refreshed: version badge 0.7.2 → 0.11.2, test-count badge
  added, tool count 12 → 18, expanded feature list into Memory &
  retrieval / Memory intelligence / Operations & DX sections, new
  Performance section with benchmark numbers.

### Notes

- No API changes, no schema changes.
- All 697 pre-existing tests continue to pass unchanged.

## [0.11.1] - 2026-04-21

### Theme: Performance audit (no feature changes)

Systematic function-by-function optimization pass after user-reported
sluggish `npm test` / `npm run build`. No schema migrations, no API
changes, no feature removals — pure hot-path hygiene.

Headline numbers on the 697-test suite, warm run:

| Metric | Before | After | Delta |
|---|---|---|---|
| Wall-clock `npm test` | 97.9s | 80.9s | **-17%** |
| Cumulative test time | 465.9s | 413.1s | **-11%** |
| Vitest import phase | 20.2s | 9.5s | **-53%** |
| Incremental `tsc` | 1.7s | 0.8s | **-55%** |

### Changed

- **`src/embedding.ts` — process-wide ONNX model cache.** The
  `FlagEmbedding.init()` call is the single heaviest cost in the
  server (~300ms). Previously every `SemanticMemoryLayer` instance
  created its own `EmbeddingService`, which loaded the model from
  scratch. Now a module-level `modelCache: Map<string, Promise<FlagEmbedding>>`
  keyed by `${modelName}|${cacheDir}` shares the loaded handle across
  all instances. Per-instance text→vector caches are preserved so
  isolation semantics don't change.
- **`src/embedding.ts` — true LRU on the text cache.** Both `embed()`
  and `embedBatch()` now re-insert cached entries on hit, so repeated
  lookups of hot keys don't let them drift toward eviction.
- **`src/indexer/scanner.ts` — git pre-check.** `discoverFiles()` now
  checks `.git` existence before spawning `git ls-files`. In tmp test
  dirs and non-git projects, this avoids the `child_process.execSync`
  fork + `fatal: not a git repository` stderr noise entirely — the
  readdir fallback runs directly.
- **`src/indexer/code-index.ts` — transactional `reindexFile`.**
  Delete + file row + symbol rows + chunk rows are now wrapped in a
  single `BEGIN/COMMIT`. Previously each insert autocommitted, costing
  one WAL fsync per row (for a 50-symbol file, 50+ fsyncs vs 1).
- **`src/indexer/code-index.ts` — forward precomputed file info.**
  `reindexFile()` accepts an optional `{ hash, mtimeMs, sizeBytes }`
  hint. `incrementalUpdate()` passes the values already computed by
  `computeDiff()`, eliminating a redundant `statSync` and a full-file
  SHA-256 per changed file.
- **`src/layers/semantic.ts` — `backfillVecIndex` short-circuit.**
  When `vec_items.count === semantic_memories.count`, skip the full
  backfill. Existing DBs no longer pay the read + JSON.parse + upsert
  cost on every L3 construction.
- **`src/layers/semantic.ts` — `delete()` one SELECT.** Collapsed
  two overlapping `SELECT rowid` queries into one.
- **`src/layers/semantic.ts` — cached tag statements.** `findByTags`
  and `countByTags` cache their prepared statements by tag arity
  (`Map<number, StatementSync>`) instead of re-preparing the dynamic
  OR-chain on every call.
- **`src/layers/semantic.ts` — transactional `applyDecay`.** Fetches
  only the six columns it needs (not `SELECT *`) and wraps the N
  per-row update/delete statements in a single `BEGIN/COMMIT`, so
  decay over N memories costs one WAL fsync instead of N.
- **`tsconfig.json`** — `incremental: true` + `tsBuildInfoFile`.
- **`vitest.config.ts`** — `singleFork: false`, `isolate: false`.
  Workers reuse their module graph and ONNX model handle across
  files. Per-test tmp dirs + explicit `close()` already provide
  filesystem/DB isolation, so module-level sharing is safe.

### Notes

- No public API changes. No DB schema changes. No tool-schema changes.
- All 697 pre-existing tests continue to pass unchanged.
- Production impact: the ONNX model cache is the dominant win in
  long-running servers too — previously every distinct L3 layer
  instantiated its own model, which only mattered in tests but also
  wasted ~50MB per duplicate instance.

## [0.11.0] - 2026-04-21

### Theme: Memory Intelligence

First steps of the post-1.0 "Memory Intelligence" track. These three
features move Context Fabric from "indexed storage" toward "knowledge
system" — callers now get citation tracking, automatic deduplication,
and explicit temporal reasoning, all while staying fully local with
no LLM dependency.

### Added

- **Provenance (`src/types.ts` Provenance, `ProvenanceSchema` in
  `src/server.ts`)** — optional structured citation block attached to
  every memory. Fields: `sessionId`, `eventId`, `toolCallId`,
  `filePath`, `lineStart`/`lineEnd`, `commitSha`, `sourceUrl`,
  `capturedAt`. `engine.store()` auto-stamps `capturedAt` when
  omitted. `ProvenanceSchema` is `.strict()` — unknown fields rejected
  at the MCP boundary. Zero DB migration: rides through existing JSON
  metadata blob at both L2 and L3.

- **Dedup-on-store at L3** — writing the same fact twice no longer
  creates duplicate rows. Cosine ≥ threshold (default `0.95`) is
  treated as a duplicate; strategies are `skip` (default), `merge`
  (union tags, merge provenance, touch), or `allow` (bypass). The
  near-dup search uses the FTS5 BM25 prefilter pool (matching
  `recallPrefiltered` semantics) so cost stays bounded as L3 grows.
  Control passed via `options.dedupe` (engine API) or
  `options.metadata.dedupe` (LLM-friendly; stripped before persist).
  Returned memory carries an `_dedupe: { action, ofId, similarity }`
  annotation for caller inspection. New helpers:
  `SemanticMemoryLayer.findNearDuplicate()`,
  `SemanticMemoryLayer.mergeInto()`.

- **Bi-temporal memory at L3** — explicit supersession semantics for
  facts that change over time. Idempotent schema migration adds
  `valid_from`, `valid_until`, `supersedes_id`, `superseded_by_id`
  columns plus an index on `valid_until`. `engine.store()` accepts
  `metadata.supersedes` (uuid); on successful L3 insert it calls
  `l3.supersede(oldId, newId)` which stamps `valid_until = now` on
  the predecessor and links both rows in a single transaction.
  `engine.recall()` gains `includeSuperseded` (default `false`,
  hides stale rows) and `asOf` (epoch ms — query state as it existed
  at that point in time; implements classic bi-temporal windowing).
  The filter `ContextEngine.applyBiTemporalFilter()` is a pure static
  helper wrapping all three recall modes; `fetchLimit` is doubled
  during filtered recall so superseded hiding doesn't starve the
  result set. New `TemporalInfo` type projected onto
  `MemoryMetadata.temporal` by `L3.rowToMemory`.

### Changed

- `StoreMemorySchema.metadata.provenance` and
  `StoreMemorySchema.metadata.supersedes` added.
- `RecallSchema.includeSuperseded` and `RecallSchema.asOf` added
  (both optional, backward compatible).
- `engine.store()` now strips `dedupe` and `supersedes` from the
  persisted metadata blob — they're control-plane, not content.

### Tests

- **697 passing** (up from 678), 37 test files. New suites:
  `tests/unit/provenance.test.ts` (6), `tests/unit/dedup.test.ts` (7),
  `tests/unit/bi-temporal.test.ts` (6).

### Migration

- No breaking changes. New columns are nullable; existing rows read
  back as "valid_from = createdAt, validUntil = null".
- New schema/API fields are all optional — callers pre-v0.11 keep
  working unchanged.

## [0.10.1] - 2026-04-21

### Theme: Closing out the v0.8 stretch items

Cleans up the two outstanding boxes from the v0.8 "Scalable Recall &
Robustness" milestone that were deferred in the first pass. No API
surface changes; all work is internal hardening.

### Added
- **Optional sqlite-vec acceleration (`src/sqlite-vec.ts`)** — when the
  `sqlite-vec` npm package is installed (not a dependency — opt-in),
  `SemanticMemoryLayer` now loads it into its `DatabaseSync`, creates a
  mirrored `vec_items` vec0 virtual table, backfills it from
  `semantic_memories` on startup, and routes hybrid-mode L3 recall
  through a native KNN query (`embedding MATCH ?`) instead of the
  FTS5-prefiltered cosine scan. Gracefully falls back to the existing
  path when the package is missing or extension loading fails; can be
  explicitly disabled via `CF_DISABLE_SQLITE_VEC=1`. Exposes a new
  `vecEnabled` getter plus `recallVec()` / `recallAccelerated()`
  methods. Engine hybrid mode auto-dispatches via `recallAccelerated()`.
- **Engine-wide closed-state guard** — the v0.7 `closed` flag only
  protected the background decay interval. All public async
  `ContextEngine` methods (`store`, `recall`, `promote`, `demote`,
  `summarize`, `getMemory`, `updateMemory`, `deleteMemory`,
  `listMemories`) plus `getCodeIndex()` now invoke a shared
  `ensureOpen()` helper that rejects with a clear
  `"ContextEngine is closed; cannot execute <op>"` error after
  `close()` has been called. Prevents use-after-close SQLite crashes
  when in-flight async work races with a shutdown signal.

### Removed
- `ROADMAP.md` — roadmap-to-1.0 is now tracked in the `CHANGELOG.md` entries
  plus git tags. The separate document had drifted from the actual
  completion state and duplicated release-note content.

### Tests
- **678 passing**, 34 files. New suites:
  `tests/unit/sqlite-vec.test.ts` (detection, opt-out, fallback
  behaviour) and `tests/unit/engine-closed-guard.test.ts` (every guarded
  method rejects after close).

## [0.10.0] - 2026-04-21

### Theme: Observability & Developer Experience

Makes the running server inspectable from the outside. Operators can now
answer "is the memory layer healthy?" and "how fast is recall?" without
reading source code.

### Added
- **Structured JSON logger** (`src/logger.ts`) — one JSON object per line
  to stderr, level-filtered via `CONTEXT_FABRIC_LOG_LEVEL` env var.
  Shape: `{ ts, level, module, msg, ...fields }`. Reserved keys cannot
  be shadowed by fields. Defaults to `warn` under `NODE_ENV=test` to
  keep test output clean, `info` otherwise. `createLogger('module')`
  returns a scoped logger with a `.child('sub')` helper.
- **In-process metrics registry** (`src/metrics.ts`) — counters plus
  reservoir-sampled latency histograms (p50/p95/p99/max). `recall()` is
  now instrumented with `recall.calls.{mode}` and
  `recall.latency_ms.{mode}`.
- **`context.metrics` MCP tool** — returns `{ stats, counters,
  histograms, reset }` where stats come from `engine.getStats()` (memory
  counts per layer/type) and counters/histograms come from the registry.
  Optional `reset: true` clears histograms after snapshot for
  interval-style collection.
- **`context.health` MCP tool** — returns
  `{ status: 'ok' | 'degraded', checks: [...] }` validating L2/L3
  SQLite connectivity and embedding model presence. Model absence is a
  `warn` (not `fail`) since the server degrades gracefully without it.
  Tool count: **15 → 17**.

### Deferred
- Structured logger retrofit of all existing `console.*` call sites in
  engine/layers (done as gradual migration, not hard-cut).
- Embedding cache hit-rate, FTS5 query count, decay-deletions-per-cycle
  metrics (require wiring from `EmbeddingService`, `fts5.ts`, and decay
  loop respectively).
- Disk-space check in `context.health`.
- CLI wizard (`npx context-fabric init/doctor/migrate`), shell
  completions, and API reference generation — pushed to the v1.0.0
  release-prep cycle.

## [0.9.0] - 2026-04-21

### Theme: API Stability & Schema Hardening

Locks down the MCP tool interface for 1.0's stability guarantee. Schemas
are strict, errors are structured, and the wire format gains batch store
plus JSONL export/import for backup and migration.

### Added
- **Strict Zod schemas on all 15 MCP tools** — `.strict()` everywhere so
  unknown fields are rejected at the schema boundary instead of silently
  dropped. Catches LLM-hallucinated parameters early. Schemas are now
  exported from `src/server.ts` for external validation / docs.
- **Consistent error response schema** — new `src/errors.ts` with
  `toolError()` / `toolValidationError()` helpers. Every tool failure now
  returns `{ isError: true, structuredContent: { error: { code, message,
  details } } }` with stable codes (`validation_error`, `internal_error`,
  `shutting_down`). Clients can branch on `code` without string parsing.
- **`context.recall` pagination** — new `offset` parameter (int >= 0,
  default 0). Response carries `{ offset, limit, hasMore }` for paged UX.
- **`context.store` batch** — `content` now accepts `string | string[]`.
  Array form stores each item in sequence and returns `{ count, ids[] }`,
  removing per-memory MCP round-trip overhead for bulk import.
- **`context.export` / `context.import`** — JSONL round-trip for L2/L3
  memories. `context.export` writes one memory per line, optionally
  filtered by layer. `context.import` parses, skips malformed lines with
  structured per-line errors, and returns `{ imported, skipped,
  errors[] }`. Enables backup, migration between projects, and shareable
  memory bundles. Tool count: **13 → 15**.
- **Single version source** — new `src/version.ts` reads version from
  `package.json` at runtime, eliminating the three-way drift risk called
  out in the v0.7.3.1 review.

### Fixed
- **Test-side-effect server boot** — `src/server.ts` now gates `main()`
  behind an `import.meta.url` check so test files that import Zod schema
  exports no longer start a live stdio MCP server and pollute test
  output.

### Changed
- Tool count: **13 → 15** (added `context.export`, `context.import`).
- Error payloads are now always structured (no more raw error strings in
  tool responses).

## [0.8.0] - 2026-04-21

### Theme: Scalable Recall & Robustness

This release makes the storage layers production-grade: the critical L3
recall scalability problem is fixed, databases survive unclean exit, and
the server can take online snapshots without stopping.

### Added
- **L3 FTS5 pre-filter (`recallPrefiltered`)** — the critical scalability
  fix. `recall()` previously loaded every semantic row, JSON-parsed every
  embedding, and ran cosine over the full set (O(N), unusable past ~10K
  memories). `recallPrefiltered(query, limit, poolSize=200)` uses the
  existing FTS5 index to fetch just the top-poolSize keyword matches,
  then runs cosine over that pool. Hybrid mode (the default recall path)
  now uses it. Pure `semantic` mode still uses full-scan for exact
  recall. **Benchmark: p50 latency at 10K drops from 281 ms to 8 ms (35×).**
- **`context.backup` MCP tool** — online VACUUM INTO snapshots of L2 and
  L3 to a destination directory. Tool count: **12 → 13**. WAL-checkpointed,
  refuses to clobber existing files, safe to copy offsite.
- **WAL checkpoint on close** — all three SQLite-backed layers
  (`src/layers/project.ts`, `src/layers/semantic.ts`,
  `src/indexer/code-index.ts`) now run `PRAGMA wal_checkpoint(TRUNCATE)`
  before `db.close()`, flushing the WAL and zeroing the sidecar.
- **Startup integrity check** — new `src/db-integrity.ts` runs
  `PRAGMA quick_check` when L2/L3 open a file-backed database and emits a
  labelled `console.warn` on corruption. Non-fatal so the user can still
  export surviving data.
- **Graceful shutdown** — new `src/shutdown.ts` adds a `ShutdownController`
  that brackets every MCP `CallToolRequest` handler. SIGTERM/SIGINT now
  waits up to 5 s for in-flight tool calls to finish before closing
  engines; new tool calls are rejected during drain.
- **Transaction wrapping** — L2 `store()` (memory row + tag rows) and
  `summarize()` (summary row + delete originals) are now wrapped in
  explicit `BEGIN`/`COMMIT`/`ROLLBACK` blocks. Previously each statement
  committed independently, so a mid-operation failure could leave the
  layer in a partial state.
- **Recall benchmark suite** — `benchmarks/recall-latency.ts` seeds 1 K
  and 10 K synthetic memories and measures p50/p95 for `recall()` vs
  `recallPrefiltered()`. Runs via `npm run bench:recall` against `dist/`.
  Skips cleanly when the bge-small-en model is not cached.

### Tests
- **612 passing** (up from 588), 24 test files. New suites:
  `tests/unit/shutdown-safety.test.ts`, `tests/unit/db-integrity.test.ts`,
  `tests/unit/shutdown.test.ts`, `tests/unit/l3-prefilter.test.ts`,
  `tests/unit/backup.test.ts`, `tests/unit/transactions.test.ts`.

### Migration
- No breaking changes. All new MCP tools and APIs are additive.
- The new `context.backup` tool requires clients to be aware of the
  updated tool list (now 13 tools).

## [0.7.3] - 2026-03-07

### Fixed
- **`sessionId` no longer required** on `context.recall`, `context.getCurrent`, and `context.summarize` — the field was required by the schema but never used by the handlers, causing Zod validation errors when callers omitted it. Now optional (still accepted if provided). `context.reportEvent` retains `sessionId` as required since it passes it through to `CLIEvent`.

### Added
- **FTS5 full-text search for code index** — `context.searchCode` text mode now uses an FTS5 virtual table (`chunks_fts`) with BM25 ranking instead of loading all chunks into memory and doing substring matching. Follows the same pattern as L2/L3 memory search (external content mode, porter+unicode61 tokenizer, trigger-synced). The migration is idempotent and auto-backfills existing data on first run.

## [0.7.2] - 2026-03-07

### Fixed
- **Schema coercion for LLM callers** — LLMs occasionally pass boolean and object parameters as strings (e.g. `stats: "true"` instead of `stats: true`, or `metadata: "{...}"` instead of a parsed object). Added `z.preprocess` coercion to `stats` in `ListMemoriesSchema` and `metadata` in `UpdateMemorySchema` so these calls succeed instead of throwing a Zod validation error.

## [0.7.1] - 2026-02-28

### Changed
- **Tool consolidation: 17 → 12 MCP tools** — reduced cognitive load for LLMs by merging 5 redundant tools into existing ones

### Removed
- **`context.ghost`** → absorbed into `context.getCurrent` (already returned `ghostMessages` + `suggestions`)
- **`context.time`** → absorbed into `context.orient` (new `expression` + `also` params for date resolution and world clock)
- **`context.getPatterns`** → absorbed into `context.getCurrent` (new `language` + `filePath` params for pattern filtering)
- **`context.promote`** → absorbed into `context.update` (new `targetLayer` param triggers promote logic)
- **`context.stats`** → absorbed into `context.list` (new `stats: true` flag returns counts instead of memories)

### Added
- **`context.orient`**: `expression` (date resolver) and `also` (world clock) parameters
- **`context.getCurrent`**: `language` and `filePath` parameters for pattern filtering
- **`context.update`**: `targetLayer` parameter for memory promotion (copies to new layer, deletes from old)
- **`context.list`**: `stats` boolean parameter — when true, returns counts per layer, pinned counts, and L2 breakdown by type

### Migration Guide
| Before (v0.7.0) | After (v0.7.1) |
|-----------------|----------------|
| `context.ghost({ sessionId, trigger, currentContext })` | `context.getCurrent({ sessionId })` → read `ghostMessages` + `suggestions` |
| `context.time({ expression: "tomorrow" })` | `context.orient({ expression: "tomorrow" })` |
| `context.time({ also: ["America/New_York"] })` | `context.orient({ also: ["America/New_York"] })` |
| `context.getPatterns({ language: "ts" })` | `context.getCurrent({ sessionId, language: "ts" })` → read `patterns` |
| `context.promote({ memoryId, fromLayer: 2 })` | `context.update({ memoryId, targetLayer: 3 })` |
| `context.stats()` | `context.list({ stats: true })` |

### Design Decisions
| Decision | Rationale |
|----------|-----------|
| Engine methods stay intact | `engine.ghost()`, `engine.promote()`, `engine.getStats()` remain for direct callers — only the MCP tool layer changes |
| `targetLayer` auto-detects `fromLayer` | No need for callers to know the current layer — `context.update` finds it via `getMemory()` |
| `stats` is a flag on `list` | Both return memory metadata; a flag is simpler than a separate tool |

## [0.7.0] - 2026-02-28

### Added
- **Hybrid Search (FTS5 + Vector + RRF)** — the single biggest retrieval quality improvement since launch:
  - **FTS5 virtual tables** on both L2 (`memories_fts`) and L3 (`semantic_fts`) with porter + unicode61 tokenizer, external content mode (no data duplication), and automatic trigger-based sync on insert/update/delete
  - **`searchBM25(query, limit)`** method on both `ProjectMemoryLayer` and `SemanticMemoryLayer` — full-text search with BM25 ranking
  - **`sanitizeFTS5Query()`** — strips FTS5 operators and wraps tokens in quotes for safe literal matching
  - **`RecallMode` type** — `'semantic' | 'keyword' | 'hybrid'`
  - **`mode` parameter on `context.recall`** — choose search strategy per query:
    - `'hybrid'` (new default) — Reciprocal Rank Fusion of BM25 keyword + vector cosine rankers
    - `'semantic'` — pure vector cosine similarity (previous default behavior)
    - `'keyword'` — pure FTS5 BM25 full-text search
  - **Reciprocal Rank Fusion (RRF)** — `fuseRRF()` merges keyword and semantic result lists using standard RRF algorithm (k=60, Cormack et al.), deduplicates by memory ID, and applies weight multipliers
  - **BM25 normalization** — `normalizeBM25(score)` maps SQLite's negative BM25 scores to [0, 1] via `1/(1+|score|)`

### Changed
- **Default recall mode is now `'hybrid'`** — `context.recall` uses RRF fusion by default. Callers can opt into `mode='semantic'` or `mode='keyword'` explicitly
- **`context.recall` tool description** updated to reflect hybrid search capabilities

### Design Decisions
| Decision | Rationale |
|----------|-----------|
| External content FTS5 | No data duplication; FTS reads from content table via implicit rowid |
| Porter + unicode61 tokenizer | Stemming improves recall ("authentication" matches "authenticate"), unicode61 handles non-ASCII |
| BM25 normalization: `1/(1+\|score\|)` | Simple, monotonic, [0,1] range. RRF uses ranks not scores, so exact values matter less |
| RRF k=60 | Standard constant from Cormack et al. Dampens top-rank dominance |
| L1 excluded from RRF | Ephemeral, no FTS/embeddings. Appended with fixed score after fusion |
| Fetch 2x limit for fusion | More candidates improve RRF quality |

### Technical
- FTS5 migration is idempotent — detects via `sqlite_master` lookup, same pattern as pinned column migration
- Existing databases get FTS tables + backfill on first startup after upgrade
- All existing tests continue to pass; new tests: `fts5.test.ts` (22), `rrf.test.ts` (9), keyword mode (7), hybrid mode (4)

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

[Unreleased]: https://github.com/Abaddollyon/context-fabric/compare/v0.7.1...HEAD
[0.7.1]: https://github.com/Abaddollyon/context-fabric/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/Abaddollyon/context-fabric/compare/v0.6.0...v0.7.0
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
