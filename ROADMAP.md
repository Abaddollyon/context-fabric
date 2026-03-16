# Context Fabric — Roadmap to 1.0

> Current version: **0.7.3** | Target: **1.0.0**

## Philosophy

1.0 means "production-ready for daily use by any agentic CLI." That requires:
- **Reliability** — no silent data loss, graceful degradation, clean shutdown
- **Scalability** — works at 50K+ memories without degradation
- **API stability** — no breaking changes to the 12 MCP tools post-1.0
- **Observability** — operators can diagnose issues without reading source code
- **Documentation** — complete API reference, migration guide, architecture docs

---

## v0.8.0 — Scalable Recall & Robustness

**Theme: Make the storage layers production-grade.**

### L3 Vector Search Scalability (Critical)
The current `recall()` loads **all rows** from SQLite and computes cosine similarity in O(N). This breaks around 10K memories (15MB in-memory, plus JSON.parse overhead per embedding).

- [ ] **Pre-filter with FTS5** — use keyword search to narrow candidates before vector comparison (hybrid pre-filter, not post-fusion)
- [ ] **Chunked loading** — load embeddings in batches of 1K instead of all-at-once
- [ ] **Optional sqlite-vss / sqlite-vec** — detect if the native vector extension is available and use it for ANN search; fall back to brute-force if not
- [ ] **Benchmark suite** — automated performance tests at 1K, 10K, 50K, 100K memories with latency assertions

### Data Integrity
- [ ] **WAL checkpoint on shutdown** — call `PRAGMA wal_checkpoint(TRUNCATE)` in `close()` to flush pending WAL frames, preventing data loss on unclean exit
- [ ] **Backup tool** — `context.backup` MCP tool that creates a timestamped SQLite `.backup()` copy (or `VACUUM INTO` for a consistent snapshot)
- [ ] **Corruption detection** — run `PRAGMA integrity_check` on startup (first 100 pages) and warn if issues found
- [ ] **Transaction wrapping** — wrap multi-statement operations (promote, summarize) in explicit transactions for atomicity

### Shutdown Safety
- [ ] **Graceful shutdown** — SIGTERM/SIGINT handlers wait up to 5s for in-flight MCP tool calls to finish before closing engines
- [ ] **In-flight decay guard** — already added (`closed` flag); extend to all async engine methods

---

## v0.9.0 — API Stability & Schema Hardening

**Theme: Lock down the MCP tool interface for 1.0 stability guarantees.**

### Schema Validation
- [ ] **Strict enum validation** — ensure all tool schemas reject unknown fields (`.strict()` on Zod objects) to catch LLM hallucinated parameters early
- [ ] **Error response schema** — define a consistent error response shape: `{ error: string, code: string, details?: unknown }` so clients can programmatically handle errors
- [ ] **Version negotiation** — return server version in tool list metadata so clients can detect compatibility

### API Polish
- [ ] **`context.recall` pagination** — add `offset` parameter for browsing large result sets
- [ ] **`context.list` cursor pagination** — replace offset-based with cursor-based for stable pagination under concurrent writes
- [ ] **`context.store` deduplication** — detect near-duplicate content before storing (cosine similarity > 0.95 against recent memories) and return the existing ID instead
- [ ] **`context.store` batch** — accept an array of memories in a single call (reduces MCP round-trips for bulk operations like session import)
- [ ] **`context.export` / `context.import`** — JSON Lines format for backup, migration, and sharing between projects

### Code Quality
- [ ] **Extract `sanitizeFTS5Query` to shared utility** — already done in this branch (src/fts5.ts); merge to master
- [ ] **Single version source of truth** — read version from package.json at runtime (`createRequire` or import assertion) instead of hardcoding in 3 places
- [ ] **Remove legacy type aliases** — `MemoryType` still carries 7 legacy values (`code`, `message`, `thought`, `observation`, `documentation`, `error`, `summary`); deprecate with console warnings, remove in 1.0

### Test Coverage Gaps (identified in review)
- [ ] **`EmbeddingService` has zero test coverage** — circuit breaker, LRU cache eviction, timeout logic, batch embedding, Float32Array normalization are all untested. This is the most critical untested module.
- [ ] **`server.ts` not tested via actual MCP transport** — integration tests reimplement handlers locally, so the real Zod validation, routing, error formatting, and JSON serialization paths are untested. Wire up `InMemoryTransport` for true server tests.
- [ ] **`FileWatcher` untested** — debounce, onChanged, onDeleted callbacks have no tests
- [ ] **Schema coercion tests** — v0.7.2 added `z.preprocess` for string-typed booleans/objects but no tests verify these coercion paths
- [ ] **Replace `sleep()` with `waitFor()`** — multiple tests use blind `sleep(100-200)` instead of the existing `waitFor()` utility, causing CI flakiness risk
- [ ] **Raise coverage thresholds** — currently 60% lines/50% branches; target 75%+ for a data persistence layer

---

## v0.10.0 — Observability & Developer Experience

**Theme: Make Context Fabric debuggable and pleasant to operate.**

### Observability
- [ ] **Structured logging** — replace `console.error`/`console.warn` with a structured logger (JSON lines to stderr) with configurable level
- [ ] **Metrics endpoint** — expose key metrics via a `context.metrics` tool or resource:
  - Memory counts by layer/type
  - Recall latency (p50, p95, p99)
  - Embedding cache hit rate
  - FTS5 query count
  - Decay deletions per cycle
- [ ] **Health check** — `context.health` tool that validates DB connectivity, embedding model availability, and disk space

### Developer Experience
- [ ] **`npx context-fabric init`** — CLI wizard that auto-detects installed AI CLIs and configures them all in one step
- [ ] **`npx context-fabric doctor`** — diagnostic command that checks Node.js version, fastembed model cache, SQLite WAL health, config validity
- [ ] **`npx context-fabric migrate`** — explicit migration runner for major version upgrades (instead of implicit on-startup migration)
- [ ] **Shell completion** — bash/zsh/fish completions for the CLI

### Documentation
- [ ] **API Reference** — auto-generated from Zod schemas and tool descriptions
- [ ] **Architecture guide** — diagrams for the three-layer model, data flow, and search pipeline
- [ ] **Integration guide** — step-by-step for each supported CLI with screenshots
- [ ] **Troubleshooting guide** — common issues (model download failures, WAL lock, permission errors)

---

## v1.0.0 — Production Release

**Theme: Stability guarantee and semantic versioning commitment.**

### Release Criteria
- [ ] All items from v0.8–v0.10 complete
- [ ] **588+ tests passing** with no skips (embedding model required in CI)
- [ ] **Performance benchmarks** — recall < 100ms at 10K memories, < 500ms at 50K
- [ ] **No known data-loss scenarios** — verified via chaos testing (kill -9 during write, disk full, corrupted WAL)
- [ ] **Semver commitment** — no breaking changes to the 12 MCP tool schemas after 1.0 (new tools are additive)
- [ ] **Published to npm** — `npm install -g context-fabric`
- [ ] **Docker Hub image** — `docker pull contextfabric/context-fabric:1.0`
- [ ] **CI/CD** — automated release pipeline (test → build → publish npm + Docker on tag)

### Post-1.0 Features (Backlog)
These are tracked but explicitly **not** in the 1.0 scope:

| Feature | Description | Priority |
|---------|-------------|----------|
| Cross-project memory linking | Link memories between projects via relationship edges | High |
| Team/collaborative sharing | Shared L3 layer across team members (requires auth) | High |
| Web UI | Browser-based memory explorer and manager | Medium |
| Memory compression | LLM-powered summarization of old L2/L3 clusters | Medium |
| Analytics dashboard | Usage patterns, recall quality, memory lifecycle | Medium |
| Plugin system | Third-party extensions for custom memory types/search | Low |
| Multi-model embeddings | Support OpenAI, Cohere, or custom embedding providers | Low |
| Graph relationships | First-class knowledge graph between memories | Low |

---

## Version Summary

| Version | Theme | Key Deliverables |
|---------|-------|-----------------|
| **0.8.0** | Scalable Recall & Robustness | Vector search pre-filter, backup, graceful shutdown, WAL safety |
| **0.9.0** | API Stability & Schema Hardening | Strict validation, pagination, dedup, export/import, single version source |
| **0.10.0** | Observability & DX | Structured logging, metrics, health check, CLI wizard, docs |
| **1.0.0** | Production Release | Performance benchmarks, chaos testing, npm publish, Docker Hub, semver commitment |

---

## Bugs Fixed in This Review (pre-0.8)

These fixes are on the current branch and should be merged before starting 0.8 work:

1. **Version mismatch** — `src/index.ts` exported `VERSION = '0.4.0'`, `src/server.ts` had `version: "0.7.1"` while package.json is `0.7.3`. Both corrected.
2. **Failing unit tests** — 3 tests in `tests/unit/events.test.ts` failed when the fastembed model wasn't cached locally. Added `hasEmbeddingModel` skip guard (matches existing pattern in e2e tests).
3. **Duplicate `sanitizeFTS5Query`** — identical 15-line function copy-pasted in `project.ts`, `semantic.ts`, and `code-index.ts`. Extracted to `src/fts5.ts`, static methods delegate.
4. **Engine map unbounded growth** — `server.ts` `engines` Map grew without limit. Added LRU eviction at 32 engines with proper `close()` on eviction.
5. **Decay interval race condition** — background `applyDecay()` could access a closed database. Added `closed` flag guard in the interval callback.
6. **UpdateMemory schema** — `targetLayer` (promote) and update fields could be combined, causing silent field drops. Added Zod `.refine()` validation to reject the invalid combination.
7. **FTS5 cascade desync** — `code-index.ts` relied on `ON DELETE CASCADE` from `indexed_files` to `chunks`, but CASCADE deletes bypass SQLite triggers, leaving stale entries in `chunks_fts`. Fixed by explicitly deleting chunks before the parent row via `deleteFileFromIndex()` helper.
8. **Dynamic imports in `reindexFile`** — `code-index.ts` used `await import('fs')` and `await import('crypto')` on every call despite both modules being available as static imports. Replaced with static imports.
9. **Interval `unref()`** — Working memory cleanup and L3 decay intervals were not `unref()`-ed, preventing clean process exit if `stopCleanupInterval()` wasn't called. Both now call `.unref()`.
10. **`SummarizeSchema` required dead fields** — `options.targetTokens` was required by both the Zod schema and JSON Schema, but the handler never passed `options` to the engine. Made `options` and all its fields optional since the engine doesn't support them yet (reserved for future use).
