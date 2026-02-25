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

## Auto-Setup (Recommended)

The easiest way to configure any CLI is to ask an AI that already has Context Fabric running:

> *"Install and configure Context Fabric for OpenCode using Docker"*

> *"Install and configure Context Fabric for Gemini CLI"*

The AI calls `context.setup` and writes the config file automatically. Add `preview: true` to see what would be written without applying it.

| CLI | Auto-Setup Command |
|-----|-------------------|
| OpenCode | `context.setup({ cli: "opencode", useDocker: true })` |
| Claude Code | `context.setup({ cli: "claude-code", useDocker: true })` |
| Kimi | `context.setup({ cli: "kimi", useDocker: true })` |
| Codex CLI | `context.setup({ cli: "codex", useDocker: true })` |
| Gemini CLI | `context.setup({ cli: "gemini", useDocker: true })` |
| Cursor | `context.setup({ cli: "cursor", useDocker: true })` |
| Claude Desktop | `context.setup({ cli: "claude", useDocker: true })` |

> [!TIP]
> Docker is the recommended transport. Omit `useDocker: true` for local Node.js configs. Add `preview: true` to preview without writing.

---

## OpenCode

<details>
<summary><strong>OpenCode</strong> &mdash; <code>~/.config/opencode/opencode.json</code></summary>

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

```bash
context.setup({ cli: "opencode", useDocker: true })
context.setup({ cli: "opencode" })  # local Node.js
```

Restart OpenCode after saving the config. The MCP server will appear in OpenCode's tool list.

</details>

---

## Claude Code

<details>
<summary><strong>Claude Code</strong> &mdash; <code>~/.claude.json</code></summary>

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

```bash
context.setup({ cli: "claude-code", useDocker: true })
context.setup({ cli: "claude-code" })  # local Node.js
```

Restart Claude Code after saving. The MCP tools will be available immediately.

</details>

---

## Kimi

<details>
<summary><strong>Kimi</strong> &mdash; <code>~/.kimi/mcp.json</code></summary>

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

```bash
context.setup({ cli: "kimi", useDocker: true })
context.setup({ cli: "kimi" })  # local Node.js
```

Restart Kimi after saving the config.

</details>

---

## Codex CLI

<details>
<summary><strong>Codex CLI</strong> &mdash; <code>~/.codex/config.toml</code></summary>

> [!NOTE]
> Codex CLI uses TOML configuration, unlike the other CLIs which use JSON.

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

```bash
context.setup({ cli: "codex", useDocker: true })
context.setup({ cli: "codex" })  # local Node.js
```

A full restart of Codex CLI is required after config changes — MCP servers are loaded at startup.

Codex also supports per-project config at `.codex/config.toml` in your project root (the project must be trusted by Codex).

</details>

---

## Gemini CLI

<details>
<summary><strong>Gemini CLI</strong> &mdash; <code>~/.gemini/settings.json</code></summary>

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

```bash
context.setup({ cli: "gemini", useDocker: true })
context.setup({ cli: "gemini" })  # local Node.js
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

</details>

---

## Cursor

<details>
<summary><strong>Cursor</strong> &mdash; <code>~/.cursor/mcp.json</code></summary>

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

```bash
context.setup({ cli: "cursor", useDocker: true })
context.setup({ cli: "cursor" })  # local Node.js
```

Cursor automatically reloads MCP tools when `mcp.json` is saved — no restart needed. Verify via **File > Preferences > Cursor Settings > Tools & Integrations > MCP Tools**.

> [!NOTE]
> MCP tools in Cursor are only available in **agent mode** (not regular chat). Ensure you are using an agent-capable model.

Cursor also supports per-project config at `.cursor/mcp.json` in your project root. Project-level config takes precedence over the global config.

</details>

---

## Claude Desktop

<details>
<summary><strong>Claude Desktop</strong> &mdash; platform-dependent path</summary>

Config file location:

| Platform | Path |
|----------|------|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` |

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

```bash
context.setup({ cli: "claude", useDocker: true })
context.setup({ cli: "claude" })  # local Node.js
```

Restart Claude Desktop after saving the config.

</details>

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

---

[← Getting Started](getting-started.md) | [Tools Reference →](tools-reference.md) | [Back to README](../README.md)
