# Agent Integration

Context Fabric tools appear in your AI's tool list via MCP, but agents need explicit instructions to use them effectively. This guide provides copy-paste ready system prompt configurations for automatic tool usage.

> [!NOTE]
> Context Fabric tools appear automatically via MCP. The agent _can_ call them at any time. The instructions below ensure it _does_ call them at the right moments.

---

## How It Works

When Context Fabric is connected, your AI sees 16 MCP tools in its available tool list. Each tool has a description, but AI agents work best with explicit guidance in their system prompt or project-level config.

### Integration Model

```
┌─────────────────────────────────────────────────────────────────┐
│  AI Agent (Claude Code, Cursor, Kimi, etc.)                     │
│  └─ System Prompt / Project Config                              │
│     └─ "Call context.orient at session start"                   │
│         │                                                       │
│         ▼                                                       │
│  ┌─────────────────┐    MCP Protocol    ┌──────────────────┐   │
│  │ Context Fabric  │ ◄─────────────────►│  MCP Server      │   │
│  │    Server       │    (stdio/Docker)  │                  │   │
│  └────────┬────────┘                    └──────────────────┘   │
│           │                                                     │
│           ▼                                                     │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Three-Layer Memory System                              │   │
│  │  ├─ L1: Working Memory (session-scoped, ephemeral)      │   │
│  │  ├─ L2: Project Memory (SQLite, persistent)             │   │
│  │  └─ L3: Semantic Memory (vector search, cross-project)  │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

**Without instructions**, the agent has tools but won't proactively use them.  
**With instructions**, the agent calls `context.orient` first thing and uses memory throughout the session.

---

## Quick Setup

Add instructions to your project-level config file. The exact file depends on your CLI:

| CLI | Config File Location | Notes |
|-----|---------------------|-------|
| **Claude Code** | `CLAUDE.md` in project root | Read automatically on project open |
| **Cursor** | `.cursorrules` in project root | Read automatically on project open |
| **Kimi** | `AGENTS.md` in project root | Or system prompt integration |
| **OpenCode** | Project `AGENTS.md` or system prompt | |
| **Codex CLI** | `AGENTS.md` or system prompt | |
| **Gemini CLI** | `AGENTS.md` or system prompt | |
| **Claude Desktop** | `CLAUDE.md` in project root | Per-project instructions |

> [!TIP]
> Project-level configs travel with your code. Put them in the repo so all team members get the same instructions.

---

## Recommended Instructions

### Minimal Version (Orientation + Store + Recall)

Use this if you want to start simple. Covers the 80% use case.

```markdown
## Context Fabric

You have access to Context Fabric for persistent memory. Use it as follows:

### Session Start
Call `context.orient` to see:
- Current time and timezone
- What project you're in
- What happened since the last session
- Memories added while you were away

### Store Memories
- **Decisions**: Store architectural/design decisions with `context.store` (type: `decision`)
- **Bug fixes**: Store root cause + fix with `context.store` (type: `bug_fix`)
- **Conventions**: Store project patterns with `context.store` (type: `convention`)

### Recall Memories
Before making changes, call `context.recall` to check if similar problems were solved before.
```

### Full Version (All Features)

Use this for comprehensive memory management.

```markdown
## Context Fabric

You have access to Context Fabric for persistent memory and code search.

### Session Lifecycle
- **Session start**: Call `context.orient` to ground yourself in time, project context, and offline changes
- **Session end**: Optionally store a summary of accomplishments as type `scratchpad`

### Memory Management
Store these memory types when discovered:

| Type | When to Store | Example |
|------|--------------|---------|
| `decision` | Architectural/design decisions | "Use Zod for API validation" |
| `bug_fix` | Bugs and their fixes | "Null pointer when email is undefined" |
| `convention` | Project patterns/rules | "Always use try/catch in async handlers" |
| `code_pattern` | Reusable code snippets | "JWT validation pattern" |
| `relationship` | Component relationships | "AuthService depends on UserStore" |
| `scratchpad` | Temporary notes | "Currently refactoring auth module" |

### Search and Recall
- **Before changes**: Call `context.recall` to find relevant prior decisions, patterns, or bug fixes
- **Code exploration**: Use `context.searchCode` to find symbols by name (mode: `symbol`) or meaning (mode: `semantic`)
- **Pattern lookup**: Call `context.getPatterns` to see reusable patterns for the current language/file

### Memory Maintenance
- Use `context.list` to browse memories with filters
- Use `context.update` to correct or expand stored memories
- Use `context.delete` to remove outdated memories
- Use `context.promote` to move a memory to a higher layer (L1→L2, L2→L3)

### Weight System (v0.5.3+)
Memories accept `metadata.weight` (1-5, default 3):
- `weight: 5` → 1.67× boost for critical decisions and non-obvious gotchas
- `weight: 4` → 1.33× boost for important patterns
- `weight: 1-2` → Reduced priority for scratchpad notes

### Events (Optional)
- Report `file_opened` events to keep the code index fresh
- Report `error_occurred` events to capture bug context
- Report `decision_made` events for automatic memory capture
```

---

## Per-Tool Guidance

Reference table for when to call each of the 16 tools:

| Tool | When to Call | Frequency | Key Parameters |
|------|-------------|-----------|----------------|
| `context.orient` | Session start — ground yourself in time and context | Once per session | `timezone`, `projectPath` |
| `context.store` | After making decisions, fixing bugs, discovering patterns | As needed | `type`, `content`, `metadata.tags` |
| `context.recall` | Before starting a task — check for relevant prior context | As needed | `query`, `threshold`, `filter` |
| `context.searchCode` | When exploring codebase — find symbols or understand structure | As needed | `query`, `mode` (symbol/text/semantic) |
| `context.getPatterns` | When writing new code that might follow existing patterns | Occasionally | `language`, `filePath` |
| `context.reportEvent` | On file opens, errors, commands, decisions | As events occur | `event.type`, `event.payload` |
| `context.ghost` | To get silent background context for current situation | Occasionally | `trigger`, `currentContext` |
| `context.time` | When reasoning about time, deadlines, or timezones | Rarely | `timezone`, `expression` |
| `context.getCurrent` | To get full context window (working + relevant + patterns) | Rarely | `sessionId` |
| `context.get` | To retrieve a specific memory by ID | As needed | `memoryId` |
| `context.update` | To correct or expand a stored memory | As needed | `memoryId`, `content`, `metadata` |
| `context.delete` | To remove outdated or incorrect memories | As needed | `memoryId` |
| `context.list` | To browse and audit the memory store | Occasionally | `layer`, `type`, `tags` |
| `context.promote` | To move a working memory to permanent storage (L1→L2→L3) | Occasionally | `memoryId`, `fromLayer` |
| `context.summarize` | To compress old memories and keep the database lean | Weekly/monthly | `layer`, `olderThanDays` |
| `context.setup` | To install Context Fabric in another CLI tool | Once | `cli`, `useDocker` |

---

## Example: Claude Code

Create `CLAUDE.md` in your project root:

```markdown
# Context Fabric — Claude Code Integration

## Session Start

At the start of every session, call `context.orient` to ground yourself in time, project context, and what changed since the last session. Do this before anything else.

## Memory — What to Store

- **Decisions**: architectural and design decisions → `context.store` (type: `decision`). Always include the rationale.
- **Bug fixes**: root cause + fix → `context.store` (type: `bug_fix`). Include what triggered the bug.
- **Conventions**: project patterns, style rules, preferences → `context.store` (type: `convention`).
- **Code patterns**: reusable snippets → `context.store` (type: `code_pattern`). Target `layer: 3` for semantic searchability.

### Weight System

Memories accept `metadata.weight` (1–5, default 3):
- `weight: 5` → 1.67× boost for critical architectural decisions
- `weight: 4` → 1.33× for important patterns
- `weight: 1–2` → Reduced priority for scratchpad notes

## Before Making Changes

Call `context.recall` with a natural-language description. It searches semantically — you don't need exact words. Check results before proceeding.

## Code Exploration

Use `context.searchCode` instead of grep for symbol lookups:
- `mode: "symbol"` — find functions, classes, interfaces by name
- `mode: "text"` — full-text search
- `mode: "semantic"` — natural-language similarity

The index builds lazily on first call and stays up-to-date automatically.

## Managing Memories

- `context.list` — browse memories with filters
- `context.get` — retrieve a specific memory by ID
- `context.update` — correct or expand a memory; update `weight` here
- `context.delete` — remove outdated memories

## Ghost Context

`context.getCurrent` returns `ghostMessages` — relevant context from past sessions. Read these at session start for background the user hasn't mentioned.
```

Place this at `/home/user/project/CLAUDE.md`. Claude Code reads it automatically when opening the project.

---

## Example: Cursor

Create `.cursorrules` in your project root:

```markdown
# Context Fabric Integration

You have access to Context Fabric MCP tools for persistent memory across sessions.

## At Session Start

Call `context.orient` to see:
- Current time and timezone
- Project path and context
- What happened since last session
- Memories added while offline

## During Development

### Store Important Context
- After making decisions: `context.store` (type: `decision`)
- After fixing bugs: `context.store` (type: `bug_fix`)
- When discovering patterns: `context.store` (type: `code_pattern`)

Always include rationale and relevant tags in metadata.

### Search Code
- Use `context.searchCode` with `mode: "symbol"` to find functions/classes by name
- Use `context.searchCode` with `mode: "semantic"` to find code by meaning
- Prefer this over file search for understanding structure

### Recall Prior Context
Before implementing features or fixes, call `context.recall` to check for:
- Similar bug fixes
- Related architectural decisions
- Relevant code patterns

## Memory Maintenance

- Use `context.list` to browse stored memories
- Use `context.update` to correct or improve memories
- Use `context.delete` to remove outdated entries

## Weight Priority (v0.5.3+)

When storing critical decisions, set `metadata.weight: 5` to ensure they surface first in recall.
```

Place this at `/home/user/project/.cursorrules`. Cursor reads it automatically.

> [!NOTE]
> Cursor only exposes MCP tools in **agent mode**. Ensure you're using an agent-capable model.

---

## Example: Kimi

Kimi supports both project-level `AGENTS.md` and system prompt integration.

### Option 1: Project-Level AGENTS.md

Create `AGENTS.md` in your project root:

```markdown
## Context Fabric

You have access to Context Fabric for persistent memory.

### Session Start
Call `context.orient` to ground yourself in time and project context.

### Memory Guidelines
- Store decisions with `context.store` (type: `decision`)
- Store bug fixes with `context.store` (type: `bug_fix`)
- Use `context.recall` before making changes
- Use `context.searchCode` for code exploration (modes: symbol, text, semantic)

### Weight System
Set `metadata.weight: 5` for critical architectural decisions that must not be forgotten.
```

### Option 2: System Prompt Snippet

Add to your Kimi system prompt:

```markdown
You have Context Fabric MCP tools available:

START OF SESSION: Call context.orient()
- Gets current time, project context, offline gap, recent memories

STORING MEMORY: Call context.store()
- type: "decision" for architectural choices
- type: "bug_fix" for bugs and fixes
- type: "convention" for project rules
- type: "code_pattern" for reusable snippets

SEARCHING: Call context.searchCode()
- mode: "symbol" for finding functions/classes by name
- mode: "semantic" for finding by meaning
- mode: "text" for full-text search

RECALLING: Call context.recall()
- Semantic search across all stored memories
- Use before implementing features or fixes
```

Kimi's `mcp.json` config goes at `~/.kimi/mcp.json`. See [CLI Setup](https://github.com/Abaddollyon/context-fabric/blob/main/docs/cli-setup.md) for the full configuration.

---

## Tips

### Start Small
The minimal instructions (orient + store decisions + recall) provide 80% of the value. Add more as needed.

### Be Specific
"Store decisions with `context.store`" is better than "use Context Fabric". Concrete instructions work better.

### Don't Over-Prompt
The agent will call `context.recall` on its own if it knows the tool exists. You don't need to tell it to recall before every single action.

### Code Index Builds Lazily
The first `context.searchCode` call triggers a full project scan. After that, it stays updated via file watching.

### Memories Persist Across CLIs
A decision stored in Claude Code is recalled in Cursor, Kimi, or any other connected CLI. They're all reading from the same L2/L3 storage.

### Use Weight for Priority
Set `weight: 5` on anything you'd be annoyed to re-discover from scratch. Update weights with `context.update` as priorities change.

### Ghost Messages
In custom agent loops, `ghostMessages` from `context.getCurrent` would be silently prepended to the system prompt. In most CLIs, they appear as tool output — still useful, just not truly invisible.

### Cleanup Strategy
If the store accumulates noise:
1. Use `context.list` with filters to find outdated memories
2. Use `context.delete` to remove them individually, or
3. Use `context.summarize` to compress old memories into summaries

### Project Scoping
L2 memories are automatically scoped to the project path. You don't need to manually namespace — Context Fabric handles it.

---

## See Also

- [Tools Reference](https://github.com/Abaddollyon/context-fabric/blob/main/docs/tools-reference.md) — All 16 tools with full parameter docs
- [CLI Setup](https://github.com/Abaddollyon/context-fabric/blob/main/docs/cli-setup.md) — Per-CLI configuration
- [Memory Types](https://github.com/Abaddollyon/context-fabric/blob/main/docs/memory-types.md) — Smart routing, decay, and layer system
