# CLI Setup

Copy-paste configs for every supported CLI. Each section shows both Docker (recommended) and local Node.js options.

## Table of Contents

- [Auto-Setup (Recommended)](#auto-setup-recommended)
- [OpenCode](#opencode)
- [Claude Code](#claude-code)
- [Kimi](#kimi)
- [Codex CLI](#codex-cli)
- [Gemini CLI](#gemini-cli)
- [Cursor](#cursor)
- [Claude Desktop](#claude-desktop)
- [Troubleshooting](#troubleshooting)

---

## Auto-Setup (Recommended)

The easiest way to configure any CLI is to ask an AI that already has Context Fabric running:

> *"Install and configure Context Fabric for OpenCode using Docker"*

> *"Install and configure Context Fabric for Gemini CLI"*

The AI calls `context.setup` and writes the config file automatically. Add `preview: true` to see what would be written without applying it.

| CLI | Config File | Auto-Setup Command |
|-----|-------------|-------------------|
| **OpenCode** | `~/.config/opencode/opencode.json` | `context.setup({ cli: "opencode", useDocker: true })` |
| **Claude Code** | `~/.claude.json` | `context.setup({ cli: "claude-code", useDocker: true })` |
| **Kimi** | `~/.kimi/mcp.json` | `context.setup({ cli: "kimi", useDocker: true })` |
| **Codex CLI** | `~/.codex/config.toml` | `context.setup({ cli: "codex", useDocker: true })` |
| **Gemini CLI** | `~/.gemini/settings.json` | `context.setup({ cli: "gemini", useDocker: true })` |
| **Cursor** | `~/.cursor/mcp.json` | `context.setup({ cli: "cursor", useDocker: true })` |
| **Claude Desktop** | *platform-dependent* | `context.setup({ cli: "claude", useDocker: true })` |

> **Tip:** Docker is the recommended transport. Omit `useDocker: true` for local Node.js configs. Add `preview: true` to preview without writing.

---

## OpenCode

**Config file:** `~/.config/opencode/opencode.json`

### Docker (Recommended)

```json
{
  "mcp": {
    "context-fabric": {
      "type": "local",
      "command": [
        "docker", "run", "--rm", "-i",
        "-v", "context-fabric-data:/data/.context-fabric",
        "context-fabric"
      ],
      "enabled": true
    }
  }
}
```

### Local (Node.js)

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

### Auto-Setup

```javascript
context.setup({ cli: "opencode", useDocker: true })
context.setup({ cli: "opencode" })  // local Node.js
```

Restart OpenCode after saving the config. The MCP server will appear in OpenCode's tool list.

---

## Claude Code

**Config file:** `~/.claude.json`

### Docker (Recommended)

```json
{
  "mcpServers": {
    "context-fabric": {
      "type": "stdio",
      "command": "docker",
      "args": [
        "run", "--rm", "-i",
        "-v", "context-fabric-data:/data/.context-fabric",
        "context-fabric"
      ],
      "env": {}
    }
  }
}
```

### Local (Node.js)

```json
{
  "mcpServers": {
    "context-fabric": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/context-fabric/dist/server.js"],
      "env": {}
    }
  }
}
```

### Auto-Setup

```javascript
context.setup({ cli: "claude-code", useDocker: true })
context.setup({ cli: "claude-code" })  // local Node.js
```

Restart Claude Code after saving. The MCP tools will be available immediately.

---

## Kimi

**Config file:** `~/.kimi/mcp.json`

### Docker (Recommended)

```json
{
  "mcpServers": {
    "context-fabric": {
      "command": "docker",
      "args": [
        "run", "--rm", "-i",
        "-v", "context-fabric-data:/data/.context-fabric",
        "context-fabric"
      ]
    }
  }
}
```

### Local (Node.js)

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

### Auto-Setup

```javascript
context.setup({ cli: "kimi", useDocker: true })
context.setup({ cli: "kimi" })  // local Node.js
```

Restart Kimi after saving the config.

---

## Codex CLI

**Config file:** `~/.codex/config.toml`

> **Note:** Codex CLI uses TOML configuration, unlike the other CLIs which use JSON.

### Docker (Recommended)

```toml
[mcp_servers.context-fabric]
command = "docker"
args = ["run", "--rm", "-i", "-v", "context-fabric-data:/data/.context-fabric", "context-fabric"]
enabled = true
```

### Local (Node.js)

```toml
[mcp_servers.context-fabric]
command = "node"
args = ["/absolute/path/to/context-fabric/dist/server.js"]
enabled = true
```

### Auto-Setup

```javascript
context.setup({ cli: "codex", useDocker: true })
context.setup({ cli: "codex" })  // local Node.js
```

A full restart of Codex CLI is required after config changes — MCP servers are loaded at startup.

Codex also supports per-project config at `.codex/config.toml` in your project root (the project must be trusted by Codex).

---

## Gemini CLI

**Config file:** `~/.gemini/settings.json`

### Docker (Recommended)

```json
{
  "mcpServers": {
    "context-fabric": {
      "command": "docker",
      "args": [
        "run", "--rm", "-i",
        "-v", "context-fabric-data:/data/.context-fabric",
        "context-fabric"
      ]
    }
  }
}
```

### Local (Node.js)

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

### Auto-Setup

```javascript
context.setup({ cli: "gemini", useDocker: true })
context.setup({ cli: "gemini" })  // local Node.js
```

After saving, enable the server inside an active Gemini session:

```bash
/mcp enable context-fabric
```

Or restart Gemini CLI — servers in `settings.json` are loaded at startup.

### Gemini-Specific Options

Gemini supports additional MCP server options:

```json
{
  "mcpServers": {
    "context-fabric": {
      "command": "docker",
      "args": [
        "run", "--rm", "-i",
        "-v", "context-fabric-data:/data/.context-fabric",
        "context-fabric"
      ],
      "timeout": 30000,
      "trust": true
    }
  }
}
```

| Option | Description |
|--------|-------------|
| `timeout` | Request timeout in milliseconds (default: 30000) |
| `trust` | Allow the server to use tools without per-call confirmation |
| `includeTools` | Allowlist of specific tools to expose |
| `excludeTools` | Blocklist of tools to hide |

Gemini also supports per-project config at `.gemini/settings.json` in your project root.

---

## Cursor

**Config file:** `~/.cursor/mcp.json`

### Docker (Recommended)

```json
{
  "mcpServers": {
    "context-fabric": {
      "command": "docker",
      "args": [
        "run", "--rm", "-i",
        "-v", "context-fabric-data:/data/.context-fabric",
        "context-fabric"
      ]
    }
  }
}
```

### Local (Node.js)

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

### Auto-Setup

```javascript
context.setup({ cli: "cursor", useDocker: true })
context.setup({ cli: "cursor" })  // local Node.js
```

Cursor automatically reloads MCP tools when `mcp.json` is saved — no restart needed. Verify via **File > Preferences > Cursor Settings > Tools & Integrations > MCP Tools**.

> **Note:** MCP tools in Cursor are only available in **agent mode** (not regular chat). Ensure you are using an agent-capable model.

Cursor also supports per-project config at `.cursor/mcp.json` in your project root. Project-level config takes precedence over the global config.

---

## Claude Desktop

Config file location depends on your platform:

| Platform | Path |
|----------|------|
| **macOS** | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| **Linux** | `~/.config/Claude/claude_desktop_config.json` |
| **Windows** | `%APPDATA%/Claude/claude_desktop_config.json` |

### Docker (Recommended)

```json
{
  "mcpServers": {
    "context-fabric": {
      "command": "docker",
      "args": [
        "run", "--rm", "-i",
        "-v", "context-fabric-data:/data/.context-fabric",
        "context-fabric"
      ]
    }
  }
}
```

### Local (Node.js)

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

### Auto-Setup

```javascript
context.setup({ cli: "claude", useDocker: true })
context.setup({ cli: "claude" })  // local Node.js
```

Restart Claude Desktop after saving the config.

---

## Troubleshooting

### MCP server not appearing

- Verify the `command` / `args` path is **absolute** and `dist/server.js` exists
- Check that the config file is valid JSON (or TOML for Codex)
- Restart the CLI tool — most require a restart after config changes

### Memories not persisting

- Data is stored in `~/.context-fabric/` — check it exists and is writable
- L2 project memories are stored per-project in SQLite
- L3 semantic memories are stored globally in `~/.context-fabric/l3-semantic/`

### Docker-specific issues

- Ensure the Docker image is built: `docker build -t context-fabric .`
- Use a named volume for persistence: `-v context-fabric-data:/data/.context-fabric`
- Test manually: `echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | docker run --rm -i context-fabric`

### Server path

After `npm run build`, the server is at `context-fabric/dist/server.js`. Always use the **absolute** path in configs.

### Connection errors

- **"Cannot find module"** — Run `npm install && npm run build` in the context-fabric directory
- **"Permission denied"** — Ensure the config file is readable and the server path is correct
- **"Docker not found"** — Make sure Docker is installed and running

### Getting help

- Check the [main documentation](https://github.com/Abaddollyon/context-fabric/tree/main/docs)
- File an issue on [GitHub](https://github.com/Abaddollyon/context-fabric/issues)
- Review the [Tools Reference](https://github.com/Abaddollyon/context-fabric/blob/main/docs/tools-reference.md) for usage examples
