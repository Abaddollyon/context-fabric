# CLI Setup

Context Fabric supports 7 CLI clients out of the box and can often install itself through `context.setup` once it is reachable from one tool.

For full copy-paste configurations, use the canonical repo doc:
- [docs/cli-setup.md](https://github.com/Abaddollyon/context-fabric/blob/main/docs/cli-setup.md)

---

## Auto-setup

If Context Fabric is already available in any MCP-capable client, you can usually ask the agent to install it into another one:

> "Install and configure Context Fabric for Cursor using Docker"

The underlying tool is `context.setup`.

---

## Supported clients

| CLI | Typical config path | Auto-setup key |
|-----|---------------------|----------------|
| Claude Code | `~/.claude.json` | `claude-code` |
| Kimi | `~/.kimi/mcp.json` | `kimi` |
| OpenCode | `~/.config/opencode/opencode.json` | `opencode` |
| Codex CLI | `~/.codex/config.toml` | `codex` |
| Gemini CLI | `~/.gemini/settings.json` | `gemini` |
| Cursor | `~/.cursor/mcp.json` | `cursor` |
| Claude Desktop | platform-dependent | `claude` |

---

## Recommended transport

For most users, the Docker transport is the cleanest option:

```bash
docker run --rm -i -v context-fabric-data:/data/.context-fabric context-fabric
```

Local Node.js transport is also supported via:

```bash
node /absolute/path/to/context-fabric/dist/server.js
```

---

## What to check after configuration

- The client was fully restarted after config changes
- The command path is valid
- Docker image exists if using Docker
- The config file is valid JSON or TOML
- `tools/list` works when run directly against the server

---

## Canonical deep docs

- [Full CLI setup matrix](https://github.com/Abaddollyon/context-fabric/blob/main/docs/cli-setup.md)
- [Agent integration guidance](https://github.com/Abaddollyon/context-fabric/blob/main/docs/agent-integration.md)
- [Troubleshooting](Troubleshooting.md)
