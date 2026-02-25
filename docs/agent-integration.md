# Agent Integration

Context Fabric exposes its tools via MCP, but your AI agent needs instructions to use them effectively. This page explains how to configure your agent's system prompt so Context Fabric works automatically -- no manual tool calls needed.

> [!NOTE]
> Context Fabric tools appear in the AI's tool list automatically via MCP. The agent _can_ call them at any time. The instructions below ensure it _does_ call them at the right moments.

---

## How It Works

When Context Fabric is connected to a CLI tool, the AI sees 12 MCP tools in its available tool list (e.g. `context.orient`, `context.store`, `context.searchCode`). Each tool has a description that hints at when to use it, but AI agents work best when given explicit guidance in their system prompt or project-level config.

The integration model:

```
System Prompt / CLAUDE.md / Project Config
  └─ Tells the agent: "Call context.orient at session start"
      └─ Agent calls context.orient
          └─ Context Fabric returns time, offline gap, recent memories
              └─ Agent is now grounded in project context
```

Without these instructions, the agent has the tools but won't proactively use them.

---

## Quick Setup

Add the following to your project-level config file. The exact file depends on your CLI:

| CLI | Config File |
|-----|------------|
| **Claude Code** | `CLAUDE.md` in project root |
| **Cursor** | `.cursorrules` in project root |
| **Kimi** | System prompt or project config |
| **Codex** | `AGENTS.md` or system prompt |
| **Others** | System prompt or equivalent project config |

---

## Recommended Instructions

Copy this into your project config. Adjust to taste -- the agent will follow whatever subset you include.

### Minimal (orientation + memory)

```markdown
## Context Fabric

You have access to Context Fabric for persistent memory. Use it as follows:

- **Session start**: Call `context.orient` to see what time it is, what project you're in,
  and what happened since the last session.
- **Important decisions**: Store them with `context.store` (type: "decision") so they persist
  across sessions.
- **Bug fixes**: Store them with `context.store` (type: "bug_fix") so you don't repeat the
  same debugging work.
- **Before making changes**: Call `context.recall` to check if similar problems were solved before.
```

### Full (all features)

```markdown
## Context Fabric

You have access to Context Fabric for persistent memory and code search. Use it as follows:

### Session lifecycle
- **Session start**: Call `context.orient` to ground yourself in time, project context,
  and what changed while offline.
- **Session end**: Store a brief summary of what was accomplished as a "scratchpad" note.

### Memory management
- **Decisions**: Store architectural and design decisions with `context.store`
  (type: "decision"). Include the rationale.
- **Bug fixes**: Store bug fixes with `context.store` (type: "bug_fix"). Include what
  caused it and how it was fixed.
- **Conventions**: Store project conventions with `context.store` (type: "convention").
  Example: "Always use Zod for API validation."
- **Patterns**: Store reusable code patterns with `context.store` (type: "code_pattern").

### Search and recall
- **Before making changes**: Call `context.recall` to check for relevant prior decisions,
  patterns, or bug fixes.
- **Code exploration**: Use `context.searchCode` to find functions, classes, and types
  by name or by meaning. Prefer this over grep for symbol lookups.
- **Pattern lookup**: Call `context.getPatterns` to see reusable patterns for the current
  language or file.

### Events (optional)
- **File opens**: Call `context.reportEvent` with type "file_opened" when opening a file,
  so the code index stays up-to-date.
- **Errors**: Call `context.reportEvent` with type "error_occurred" when encountering errors,
  so they're captured as bug context.
```

---

## Per-Tool Guidance

When should the agent call each tool? Here's the full mapping:

| Tool | When to Call | Frequency |
|------|-------------|-----------|
| `context.orient` | Session start | Once per session |
| `context.store` | After making a decision, fixing a bug, or discovering a pattern | As needed |
| `context.recall` | Before starting a task, to check for relevant prior context | As needed |
| `context.searchCode` | When exploring the codebase, looking up symbols, or understanding structure | As needed |
| `context.getPatterns` | When writing new code that might follow an existing pattern | Occasionally |
| `context.reportEvent` | On file opens, errors, commands, decisions | As events occur |
| `context.ghost` | To get silent background context for the current situation | Occasionally |
| `context.time` | When the agent needs to reason about time, deadlines, or timezones | Rarely |
| `context.summarize` | To compress old memories and keep the database lean | Weekly/monthly |
| `context.promote` | To move a working memory to permanent storage | Occasionally |
| `context.setup` | To install Context Fabric in another CLI tool | Once |
| `context.getCurrent` | To get the full context window (working + relevant + patterns) | Rarely (orient is preferred) |

---

## Example: Claude Code

Add this to your project's `CLAUDE.md`:

```markdown
## Context Fabric

- At session start, call `context.orient` to ground yourself in time and project context.
- Use `context.searchCode` with mode "symbol" to find functions and classes by name.
- Use `context.recall` before making changes to check for relevant prior decisions.
- Store important decisions with `context.store` (type: "decision").
- Store bug fixes with `context.store` (type: "bug_fix") including root cause.
```

After adding this, start a new Claude Code session. The agent will call `context.orient` first thing and use the other tools as the session progresses.

---

## Example: Cursor

Add this to `.cursorrules` in your project root:

```markdown
You have access to Context Fabric MCP tools for persistent memory.

At the start of each conversation, call context.orient to see project context and
recent changes. Use context.searchCode to explore the codebase. Store decisions
and bug fixes with context.store so they persist across sessions.
```

---

## Tips

- **Start small.** The minimal instructions (orient + store decisions) provide most of the value. Add more as needed.
- **Be specific.** "Store decisions" is better than "use Context Fabric." The agent responds better to concrete instructions.
- **Don't over-prompt.** The agent will call `context.recall` on its own if it knows about decisions. You don't need to tell it to recall before every single action.
- **Code index builds lazily.** The first `context.searchCode` call triggers a full project scan. After that, it stays updated via file watching and `orient()` calls.
- **Memories persist across CLIs.** A decision stored in Claude Code is recalled in Cursor, Kimi, or any other connected CLI.

---

[← Configuration](configuration.md) | [Architecture →](architecture.md) | [Back to README](../README.md)
