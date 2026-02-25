# Context Fabric — Cursor Setup Guide

Context Fabric gives Cursor persistent memory across sessions: decisions, code patterns, bug fixes, and conventions are automatically captured and recalled.

---

## Quick Setup (Recommended)

The easiest way is to ask Cursor's AI to set itself up once context-fabric is running:

**Option A — Let the AI do it:**
> "Install and configure the Context Fabric MCP server for Cursor"

Cursor will call `context.setup` and write the config automatically.

**Option B — Manual:**

### 1. Build context-fabric

```bash
git clone https://github.com/Abaddollyon/context-fabric.git
cd context-fabric
npm install && npm run build
```

### 2. Add to `~/.cursor/mcp.json`

Merge this into the `"mcpServers"` block:

```json
{
  "mcpServers": {
    "context-fabric": {
      "command": "node",
      "args": ["/absolute/path/to/context-fabric/dist/server.js"]
    }
  }
}
```

### 3. Reload Cursor

Cursor automatically reloads MCP tools when `mcp.json` is saved. You can confirm the server is active via **File → Preferences → Cursor Settings → Tools & Integrations → MCP Tools**.

---

## Auto-Setup via context.setup

If you already have context-fabric running in another CLI (e.g. Claude Code), you can configure it for Cursor too:

```
context.setup({ cli: "cursor" })
```

Or preview what would be written first:

```
context.setup({ cli: "cursor", preview: true })
```

---

## Project-Level Config

Cursor also supports per-project MCP servers. Add `.cursor/mcp.json` to your project root:

```json
{
  "mcpServers": {
    "context-fabric": {
      "command": "node",
      "args": ["/absolute/path/to/context-fabric/dist/server.js"]
    }
  }
}
```

Project-level config takes precedence over the global `~/.cursor/mcp.json`.

---

## Usage in Cursor

Context Fabric tools are available in Cursor's **agent mode**. The AI will use them automatically when relevant, or you can ask explicitly:

**Store something:**
> "Remember that we always validate API inputs with Zod in this project"

**Recall something:**
> "What patterns have we established for error handling?"

**Report context events** (Cursor does this automatically for supported events):
```
context.reportEvent({
  event: {
    type: "file_opened",
    payload: { path: "/src/api/users.ts" },
    timestamp: "...",
    sessionId: "...",
    cliType: "cursor",
    projectPath: "/my/project"
  }
})
```

---

## Troubleshooting

**MCP server not appearing in Cursor:**
- Open **Cursor Settings → Tools & Integrations → MCP Tools** to verify the server is listed
- Verify `~/.cursor/mcp.json` is valid JSON
- Verify the `args` path is absolute and `dist/server.js` exists
- Try saving `mcp.json` again to trigger a reload

**Tools not available:**
- MCP tools in Cursor are only available in **agent mode** (not regular chat)
- Ensure you are using Cursor with an agent-capable model

**Memories not persisting:**
- Data is stored in `~/.context-fabric/` — check it exists and is writable
- L2 project memories are stored per-project in SQLite
- L3 semantic memories are stored globally in `~/.context-fabric/l3-semantic/`

**Server path:**
- After `npm run build`, the server is at `context-fabric/dist/server.js`
- Use the absolute path in the config
