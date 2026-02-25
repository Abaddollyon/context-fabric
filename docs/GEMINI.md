# Context Fabric — Gemini CLI Setup Guide

Context Fabric gives Google Gemini CLI persistent memory across sessions: decisions, code patterns, bug fixes, and conventions are automatically captured and recalled.

---

## Quick Setup (Recommended)

The easiest way is to ask Gemini to set itself up once context-fabric is running:

**Option A — Let the AI do it:**
> "Install and configure the Context Fabric MCP server for Gemini"

Gemini will call `context.setup` and write the config automatically.

**Option B — Manual:**

### 1. Build context-fabric

```bash
git clone https://github.com/Abaddollyon/context-fabric.git
cd context-fabric
npm install && npm run build
```

### 2. Add to `~/.gemini/settings.json`

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

### 3. Enable the server

Inside an active Gemini CLI session, run:

```
/mcp enable context-fabric
```

Or restart Gemini CLI — servers listed in `settings.json` are loaded at startup.

---

## Auto-Setup via context.setup

If you already have context-fabric running in another CLI (e.g. Claude Code), you can configure it for Gemini too:

```
context.setup({ cli: "gemini" })
```

Or preview what would be written first:

```
context.setup({ cli: "gemini", preview: true })
```

---

## Project-Level Config

Gemini also supports per-project settings. Add the same block to `.gemini/settings.json` in your project root:

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

---

## Usage in Gemini CLI

Once configured, Context Fabric tools are available automatically. The AI will use them when relevant, or you can ask explicitly:

**Store something:**
> "Remember that we always validate API inputs with Zod in this project"

**Recall something:**
> "What patterns have we established for error handling?"

**Check server status:**
```
/mcp status
```

---

## Gemini-Specific Config

Gemini supports additional MCP server options in `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "context-fabric": {
      "command": "node",
      "args": ["/absolute/path/to/context-fabric/dist/server.js"],
      "timeout": 30000,
      "trust": true
    }
  }
}
```

- `timeout`: Request timeout in milliseconds (default: 30000)
- `trust`: Allow the server to use tools without per-call confirmation
- `includeTools`: Allowlist of specific tools to expose
- `excludeTools`: Blocklist of tools to hide

---

## Troubleshooting

**MCP server not appearing:**
- Check `/mcp status` inside Gemini CLI
- Verify `~/.gemini/settings.json` is valid JSON
- Verify the `args` path is absolute and `dist/server.js` exists

**Server disabled:**
- Check `~/.gemini/mcp-server-enablement.json` — Gemini stores enabled/disabled state separately
- Run `/mcp enable context-fabric` inside a Gemini session

**Memories not persisting:**
- Data is stored in `~/.context-fabric/` — check it exists and is writable
- L2 project memories are stored per-project in SQLite
- L3 semantic memories are stored globally in `~/.context-fabric/l3-semantic/`

**Server path:**
- After `npm run build`, the server is at `context-fabric/dist/server.js`
- Use the absolute path in the config
