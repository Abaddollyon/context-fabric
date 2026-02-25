# Getting Started

Get Context Fabric running in under 2 minutes. Clone, build, done.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Install via Docker (Recommended)](#install-via-docker-recommended)
- [Install from Source](#install-from-source)
- [Auto-Setup via AI](#auto-setup-via-ai)
- [First Run](#first-run)
- [Verify Installation](#verify-installation)
- [Next Steps](#next-steps)

## Prerequisites

You need **one** of the following:

| Option | Requirement | Notes |
|--------|-------------|-------|
| **Docker** (recommended) | Docker Engine | Cross-platform, no Node.js required on the host |
| **Local** | Node.js **22.5+** | Uses the built-in `node:sqlite` module — no native dependencies |

> [!NOTE]
> Node.js 22.5 is required specifically for the built-in `node:sqlite` module. Earlier versions will not work.

## Install via Docker (Recommended)

Zero runtime dependencies on the host. Fast cold starts. This is the path most people should take.

```bash
git clone https://github.com/Abaddollyon/context-fabric.git
cd context-fabric
docker build -t context-fabric .
```

Verify it works:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  | docker run --rm -i context-fabric
```

You should see a JSON response listing all 12 MCP tools. For persistent storage (so memories survive container restarts), use a named volume:

```bash
docker run --rm -i \
  -v context-fabric-data:/data/.context-fabric \
  context-fabric
```

> [!TIP]
> The Docker image bakes the ONNX embedding model into the image at build time. Cold starts are fast -- no model download on first run.

## Install from Source

<details>
<summary>Local install with Node.js 22.5+</summary>

```bash
# Clone the repository
git clone https://github.com/Abaddollyon/context-fabric.git
cd context-fabric

# Install dependencies and build
npm install
npm run build
```

The server binary is now at `dist/server.js`. You will reference this path when configuring your CLI tool.

```bash
# Verify the build
node dist/server.js
# The server starts listening on stdio — press Ctrl+C to stop
```

</details>

## Auto-Setup via AI

Once Context Fabric is running in any CLI, it can configure itself into every other CLI. Just ask:

> "Install and configure Context Fabric for Claude Code using Docker"

The AI writes the config file automatically. Works for all 7 supported CLIs.

To preview without applying:

> "Show me the Context Fabric config for Gemini CLI (preview only)"

See [CLI Setup](cli-setup.md) for manual configuration of each CLI tool.

## First Run

Once configured, start a new session and tell your AI to orient itself. It calls `context.orient` and gets:

```text
It is 9:15 AM on Wednesday, February 25, 2026 (America/New_York, UTC-05:00).
Project: /home/user/myapp. First session in this project.
```

On subsequent sessions, it detects how long you've been away:

```text
Last session: 14 hours 23 minutes ago (since 6:52 PM yesterday).
3 new memories were added while offline.
```

> [!TIP]
> Call `context.orient` at the start of every session. Many CLI system prompts can be configured to call it automatically.

## Verify Installation

Send a `tools/list` request to confirm all 12 MCP tools are available:

```bash
# Docker
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  | docker run --rm -i context-fabric

# Local
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  | node dist/server.js
```

## Next Steps

- **[CLI Setup](cli-setup.md)** — Configure Context Fabric for your specific CLI tool
- **[Tools Reference](tools-reference.md)** — All 12 MCP tools with full parameter docs
- **[Memory Types](memory-types.md)** — Understand the type system and three-layer architecture
- **[Configuration](configuration.md)** — Customize storage paths, TTL, embedding, and more
- **[Architecture](architecture.md)** — Deep dive into system internals

---

[Tools Reference →](tools-reference.md) | [CLI Setup](cli-setup.md) | [Back to README](../README.md)
