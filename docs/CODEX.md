# Context Fabric — Codex CLI Setup Guide

Context Fabric gives OpenAI Codex CLI persistent memory across sessions: decisions, code patterns, bug fixes, and conventions are automatically captured and recalled.

---

## Quick Setup (Recommended)

The easiest way is to ask Codex to set itself up once context-fabric is running:

**Option A — Let the AI do it:**
> "Install and configure the Context Fabric MCP server for Codex"

Codex will call `context.setup` and write the config automatically.

**Option B — Manual:**

### 1. Build context-fabric

```bash
git clone https://github.com/Abaddollyon/context-fabric.git
cd context-fabric
npm install && npm run build
```

### 2. Add to `~/.codex/config.toml`

Codex uses TOML config. Add this block:

```toml
[mcp_servers.context-fabric]
command = "node"
args = ["/absolute/path/to/context-fabric/dist/server.js"]
enabled = true
```

### 3. Restart Codex CLI

MCP servers are loaded at startup. A full restart is required after config changes.

---

## Auto-Setup via context.setup

If you already have context-fabric running in another CLI (e.g. Claude Code), you can configure it for Codex too:

```
context.setup({ cli: "codex" })
```

Or preview what would be written first:

```
context.setup({ cli: "codex", preview: true })
```

The preview returns the TOML block to add to `~/.codex/config.toml`.

---

## Project-Level Config

Codex also supports per-project config. Add the same TOML block to `.codex/config.toml` in your project root (only works if the project is trusted by Codex):

```toml
[mcp_servers.context-fabric]
command = "node"
args = ["/absolute/path/to/context-fabric/dist/server.js"]
enabled = true
```

---

## Usage in Codex

Once configured, Context Fabric tools are available automatically. The AI will use them when relevant, or you can ask explicitly:

**Store something:**
> "Remember that we always validate API inputs with Zod in this project"

**Recall something:**
> "What patterns have we established for error handling?"

---

## Troubleshooting

**MCP server not appearing:**
- Check `~/.codex/config.toml` has valid TOML syntax
- Verify the `args` path is absolute and `dist/server.js` exists
- Ensure `enabled = true` is set

**Memories not persisting:**
- Data is stored in `~/.context-fabric/` — check it exists and is writable
- L2 project memories are stored per-project in SQLite
- L3 semantic memories are stored globally in `~/.context-fabric/l3-semantic/`

**Server path:**
- After `npm run build`, the server is at `context-fabric/dist/server.js`
- Use the absolute path in the config
