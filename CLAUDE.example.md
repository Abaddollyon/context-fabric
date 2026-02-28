# Context Fabric — Claude Code Integration

Copy this file to `CLAUDE.md` in your project root to wire Context Fabric into Claude Code.
(Claude Code loads `CLAUDE.md` automatically at session start.)

## Session start

At the start of every session, call `context.orient` to ground yourself in time, project context, and what changed since the last session. Do this before anything else.

## Memory — what to store

- **Decisions**: architectural and design decisions → `context.store` (type: `decision`). Always include the rationale, not just the conclusion.
- **Bug fixes**: root cause + fix → `context.store` (type: `bug_fix`). Include what triggered the bug, not just the solution.
- **Conventions**: project patterns, style rules, preferences → `context.store` (type: `convention`).
- **Code patterns**: reusable snippets → `context.store` (type: `code_pattern`). Target `layer: 3` so they're semantically searchable.

### Weight — priority signal

All memories accept `metadata.weight` (integer 1–5, default 3). This multiplies similarity scores in `context.recall` and `context.getCurrent`:

- `weight: 5` → 1.67× boost — use for critical architectural decisions, non-obvious gotchas
- `weight: 4` → 1.33× — important but not critical
- `weight: 3` → 1.0× neutral (default, omit unless explicitly setting)
- `weight: 2` → 0.67× — low priority, likely to age out
- `weight: 1` → 0.33× — near-throwaway scratchpad notes

**Tip**: set `weight: 5` on anything you'd be annoyed to re-discover from scratch.
To update weight later: `context.update({ memoryId: "...", weight: 4 })`.

## Before making changes

Call `context.recall` with a natural-language description of what you're about to do. It searches semantically — you don't need to know the exact words used when a memory was stored. Check the results before proceeding.

## Code exploration

Use `context.searchCode` instead of grep/glob for symbol lookups. Three modes:
- `mode: "symbol"` — find functions, classes, interfaces, types by name
- `mode: "text"` — full-text search across file contents
- `mode: "semantic"` — natural-language similarity (e.g. "how does caching work in this project")

The index is built lazily on first call and stays up-to-date automatically.

## Managing memories

Use the CRUD tools to inspect and maintain the memory store:
- `context.list` — browse memories with layer/type/tag filters; use `stats: true` for a count summary
- `context.get` — retrieve a specific memory by ID
- `context.update` — correct or expand a stored memory; also use for updating `weight` or promoting via `targetLayer`
- `context.delete` — remove outdated or incorrect memories

If the store accumulates noise (e.g. from test runs), use `context.list` to filter by tag then delete in bulk via a Node script rather than individual MCP calls.

## Ghost context

`context.getCurrent` returns a `ghostMessages` array — relevant context surfaced from past sessions. Read these at session start for background context the user hasn't explicitly mentioned. In Claude Code these arrive as tool output rather than silent system injections, but they're equally useful.
