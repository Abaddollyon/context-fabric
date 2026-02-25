# Context Fabric — OpenCode Setup Guide

Context Fabric gives OpenCode persistent memory across sessions: decisions, code patterns, bug fixes, and conventions are automatically captured and recalled.

---

## Quick Setup (Recommended)

The easiest way is to ask OpenCode to set itself up once context-fabric is running:

**Option A — Let the AI do it:**
> "Install and configure the Context Fabric MCP server for OpenCode"

OpenCode will call `context.setup` and write the config automatically.

**Option B — Manual:**

### 1. Build context-fabric

```bash
git clone https://github.com/Abaddollyon/context-fabric.git
cd context-fabric
npm install && npm run build
```

### 2. Add to `~/.config/opencode/opencode.json`

Merge this into the `"mcp"` block:

```json
{
  "mcp": {
    "context-fabric": {
      "type": "local",
      "command": ["node", "/absolute/path/to/context-fabric/dist/server.js"],
      "enabled": true
    }
  }
}
```

### 3. Restart OpenCode

The new MCP server will appear in OpenCode's tool list.

---

## Auto-Setup via context.setup

If you already have context-fabric running in another CLI (e.g. Claude Code), you can configure it for OpenCode too:

```
context.setup({ cli: "opencode" })
```

Or preview what would be written first:

```
context.setup({ cli: "opencode", preview: true })
```

---

## Usage in OpenCode

Once configured, Context Fabric tools are available automatically. The AI will use them when relevant, or you can ask explicitly:

**Store something:**
> "Remember that we always validate API inputs with Zod in this project"

**Recall something:**
> "What patterns have we established for error handling?"

**Report context events** (OpenCode does this automatically for supported events):
```
context.reportEvent({
  event: {
    type: "file_opened",
    payload: { path: "/src/api/users.ts" },
    timestamp: "...",
    sessionId: "...",
    cliType: "opencode",
    projectPath: "/my/project"
  }
})
```

---

## OpenCode-Specific Config

Optionally create `~/.context-fabric/opencode-config.yaml`:

```yaml
cli:
  cliType: opencode

autoCapture:
  onFileOpen: true
  onError: true
  onDecision: true

context:
  maxWorkingMemories: 15
  maxRelevantMemories: 12

suggestions:
  enabled: true
  maxSuggestions: 5
```

---

## Troubleshooting

**MCP server not appearing in OpenCode:**
- Check `opencode mcp list` to see configured servers
- Verify the `command` path is absolute and `dist/server.js` exists
- Run `opencode mcp debug` for connection diagnostics

**Memories not persisting:**
- Data is stored in `~/.context-fabric/` — check it exists and is writable
- L2 project memories are stored per-project in SQLite
- L3 semantic memories are stored globally in `~/.context-fabric/l3-semantic/`

**Server path:**
- After `npm run build`, the server is at `context-fabric/dist/server.js`
- Use the absolute path in the config
