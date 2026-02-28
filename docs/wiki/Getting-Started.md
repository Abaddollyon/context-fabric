# Getting Started

Get Context Fabric running in under 2 minutes. This guide covers installation, first run, and verification.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Docker Installation (Recommended)](#docker-installation-recommended)
- [Local Installation from Source](#local-installation-from-source)
- [Auto-Setup via AI](#auto-setup-via-ai)
- [First Run](#first-run)
- [Verification](#verification)
- [You Did It](#you-did-it)
- [Next Steps](#next-steps)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

You need **one** of the following:

| Option | Requirement | Notes |
|--------|-------------|-------|
| **Docker** (recommended) | Docker Engine 20.10+ | Cross-platform, no Node.js required on the host |
| **Local** | Node.js **22.5+** | Uses the built-in `node:sqlite` module — no native dependencies |

> **Note:** Node.js 22.5 is required specifically for the built-in `node:sqlite` module. Earlier versions will not work.

### Check Your Environment

```bash
# Check Docker
docker --version

# Check Node.js (if not using Docker)
node --version  # Should be 22.5.0 or higher
```

---

## Docker Installation (Recommended)

Docker is the recommended installation method. It provides:
- Zero runtime dependencies on the host
- Cross-platform compatibility (Linux, macOS, Windows)
- Fast cold starts (ONNX embedding model baked into the image)
- Persistent storage via named volumes

### Step 1: Clone the Repository

```bash
git clone https://github.com/Abaddollyon/context-fabric.git
cd context-fabric
```

### Step 2: Build the Docker Image

```bash
docker build -t context-fabric .
```

Build time is approximately 2 minutes. The image includes:
- The Context Fabric MCP server
- Pre-baked ONNX embedding model (no download at runtime)
- Production-ready Node.js 22 slim base

### Step 3: Verify the Build

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  | docker run --rm -i context-fabric
```

You should see a JSON response listing all 12 MCP tools.

### Step 4: Configure with Persistent Storage

For persistent storage (so memories survive container restarts), use the `context-fabric-data` named volume:

```bash
docker run --rm -i \
  -v context-fabric-data:/data/.context-fabric \
  context-fabric
```

**Data locations:**
- **Docker volume:** `context-fabric-data` (mounted at `/data/.context-fabric`)
- **Config file:** `~/.context-fabric/config.yaml` (inside the volume)
- **SQLite databases:** Stored in the volume for L2 (project) and L3 (semantic) memory

---

## Local Installation from Source

If you prefer to run without Docker, install from source using Node.js 22.5+.

### Step 1: Clone the Repository

```bash
git clone https://github.com/Abaddollyon/context-fabric.git
cd context-fabric
```

### Step 2: Install Dependencies

```bash
npm install
```

### Step 3: Build the Project

```bash
npm run build
```

The server binary is now at `dist/server.js`.

### Step 4: Verify the Build

```bash
# Test the server starts (press Ctrl+C to stop)
node dist/server.js
```

### Step 5: Test with tools/list

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  | node dist/server.js
```

**Data locations (local install):**
- **Config:** `~/.context-fabric/config.yaml`
- **L2 Project DB:** `~/.context-fabric/l2-project.db`
- **L3 Semantic:** `~/.context-fabric/l3-semantic/`

---

## Auto-Setup via AI

Once Context Fabric is running in any CLI, it can configure itself into every other supported CLI automatically.

### How It Works

The `context.setup` tool reads your CLI's existing config, merges in the Context Fabric MCP entry, and writes it back. It's safe to call multiple times (idempotent).

### Supported CLIs

| CLI | Auto-Setup Command |
|-----|-------------------|
| OpenCode | `context.setup({ cli: "opencode", useDocker: true })` |
| Claude Code | `context.setup({ cli: "claude-code", useDocker: true })` |
| Kimi | `context.setup({ cli: "kimi", useDocker: true })` |
| Codex CLI | `context.setup({ cli: "codex", useDocker: true })` |
| Gemini CLI | `context.setup({ cli: "gemini", useDocker: true })` |
| Cursor | `context.setup({ cli: "cursor", useDocker: true })` |
| Claude Desktop | `context.setup({ cli: "claude", useDocker: true })` |

### Example Usage

Simply tell your AI:

> *"Install and configure Context Fabric for Kimi using Docker"*

The AI will:
1. Call `context.setup({ cli: "kimi", useDocker: true })`
2. Write the config to `~/.kimi/mcp.json`
3. Report success

### Preview Mode

To see what would be written without applying changes:

```bash
context.setup({ cli: "cursor", useDocker: true, preview: true })
```

### Transport Modes

- **`useDocker: true`** (recommended) — Writes a `docker run --rm -i` entry. Cross-platform, requires the image to be built first.
- **`useDocker: false`** — Writes a `node dist/server.js` entry. Requires Node.js 22.5+ on the host.

---

## First Run

Once Context Fabric is configured in your CLI, start a new session and tell your AI to orient itself.

### What Happens on First Run

The AI calls `context.orient` and receives:

```
It is 9:15 AM on Wednesday, February 25, 2026 (America/New_York, UTC-05:00).
Project: /home/user/myapp.
First session in this project.
```

### What Happens on Subsequent Sessions

Context Fabric detects how long you've been away:

```
It is 9:15 AM on Wednesday, February 25, 2026 (America/New_York, UTC-05:00).
Project: /home/user/myapp.
Last session: 14 hours 23 minutes ago (since 6:52 PM yesterday).
3 new memories were added while you were offline.
```

### What Are Ghost Messages?

Ghost Messages are a powerful Context Fabric feature that silently injects relevant context into your session *without* cluttering the conversation. Think of them as background whispers that help your AI assistant stay informed.

**Here's a concrete example:**

Let's say you previously stored this decision in your project memory:
```
"Use Zod for all API validation instead of Joi. 
Decision made on 2026-02-20 to keep validation consistent."
```

A week later, you start a new session and ask:
> *"Add validation to the new user endpoint"*

Before responding, Context Fabric silently surfaces the Zod decision as a Ghost Message. Your AI sees:

```
Ghost Message (relevant context):
> "Use Zod for all API validation instead of Joi..."
```

Your AI immediately knows to use Zod — no need for you to remember or restate it. The Ghost Message appears in the system context but doesn't appear as part of your chat history. It's like having a knowledgeable teammate who quietly reminds you of important decisions exactly when you need them.

### The Orientation Loop

The `context.orient` tool answers three questions:
1. **Where am I in time?** — Current time, timezone, day boundaries
2. **What happened while I was offline?** — Gap detection, new memories
3. **What project am I in?** — Project path, session continuity

> **Tip:** Call `context.orient` at the start of every session. Many CLI system prompts can be configured to call it automatically.

---

## Verification

Test that Context Fabric is working correctly with the `tools/list` method.

### Docker Verification

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  | docker run --rm -i \
  -v context-fabric-data:/data/.context-fabric \
  context-fabric
```

### Local Verification

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  | node dist/server.js
```

### Expected Output

You should see a JSON response with all 12 MCP tools:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "tools": [
      { "name": "context.getCurrent", ... },
      { "name": "context.store", ... },
      { "name": "context.recall", ... },
      { "name": "context.orient", ... },
      { "name": "context.summarize", ... },
      { "name": "context.reportEvent", ... },
      { "name": "context.searchCode", ... },
      { "name": "context.get", ... },
      { "name": "context.update", ... },
      { "name": "context.delete", ... },
      { "name": "context.list", ... },
      { "name": "context.setup", ... }
    ]
  }
}
```

---

## You Did It

Context Fabric is now running and ready to give your AI assistant a memory. Here's what you've accomplished:

- **Built the Docker image** (or installed from source)
- **Verified the server is responding** with all 12 tools
- **Configured persistent storage** so memories survive restarts
- **Connected to your CLI** so your AI can access the tools  

### What's Next?

Your AI assistant now has access to a three-layer memory system. Try these natural language commands in your next session:

| Try saying... | What happens |
|---------------|--------------|
| *"Orient me to this project"* | Gets time, project context, and what's new |
| *"Remember that we use Zod for validation"* | Stores a decision in project memory (L2) |
| *"What did we decide about authentication?"* | Recalls relevant decisions via semantic search |
| *"Summarize recent memories"* | Compacts older memories to stay within context limits |

### You Should Know

- **Memories are private** — Everything stays local on your machine
- **Memories are shared** — Use any supported CLI, your memories follow you
- **Memories are smart** — Ghost Messages surface context when you need it, without clutter

No more starting from zero every session. Your AI remembers.

---

## Next Steps

- **[CLI Setup](https://github.com/Abaddollyon/context-fabric/wiki/CLI-Setup)** — Configure Context Fabric for your specific CLI tool (copy-paste configs for all 7 supported CLIs)
- **[Tools Reference](https://github.com/Abaddollyon/context-fabric/wiki/Tools-Reference)** — All 12 MCP tools with full parameter documentation
- **[Memory Types](https://github.com/Abaddollyon/context-fabric/wiki/Memory-Types)** — Understand the type system and three-layer architecture (L1, L2, L3)
- **[Configuration](https://github.com/Abaddollyon/context-fabric/wiki/Configuration)** — Customize storage paths, TTL, embedding, and more
- **[Architecture](https://github.com/Abaddollyon/context-fabric/wiki/Architecture)** — Deep dive into system internals and data flow

---

## Troubleshooting

Having trouble? Don't worry — we've got you covered. Here are common first-run issues and how to fix them.

### "It didn't work" — First Things to Check

We know that feeling when something *should* work but doesn't. Let's run through some quick checks:

#### 1. Verify Docker is Running

```bash
docker version
```

If you see "Cannot connect to the Docker daemon", start Docker Desktop or run:
```bash
sudo systemctl start docker  # Linux
```

#### 2. Check the Image Built Successfully

```bash
docker images | grep context-fabric
```

You should see `context-fabric` listed. If not, rebuild:
```bash
docker build -t context-fabric .
```

#### 3. Test the Server Directly

This bypasses any CLI config issues:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  | docker run --rm -i context-fabric
```

**Expected:** JSON output with 12 tools.
**If empty/no output:** The server failed to start. Check Docker logs.

### Common First-Run Issues

#### Issue: "MCP server not appearing in my CLI"

**Most likely causes:**

| Symptom | Quick Fix |
|---------|-----------|
| Config file has syntax errors | Validate JSON at [jsonlint.com](https://jsonlint.com) |
| Used a relative path | Change to **absolute path** (e.g., `/home/username/...` not `~/...` or `./...`) |
| Forgot to restart CLI | Most CLIs need a full restart after config changes |
| Wrong config location | Double-check the path for your CLI (see [CLI Setup](CLI-Setup)) |

**Quick diagnostic:**
```bash
# Test if the server works (proves it's a CLI config issue)
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  | docker run --rm -i context-fabric
```

If this works but your CLI doesn't see the tools, the issue is in your CLI config file.

#### Issue: "Cannot find module 'node:sqlite'"

You're using Node.js < 22.5. Context Fabric requires Node.js 22.5+ for the built-in SQLite module.

```bash
# Check version
node --version

# Upgrade (if using nvm)
nvm install 22
nvm use 22
```

**Easy fix:** Use Docker instead — no Node.js version management needed.

#### Issue: "Memories not persisting after restart"

For Docker, you must use the named volume:

```bash
# ❌ Without volume — memories lost when container exits
docker run --rm -i context-fabric

# ✅ With volume — memories persist
docker run --rm -i -v context-fabric-data:/data/.context-fabric context-fabric
```

Also verify you're storing to L2 or L3 (L1 is session-only and disappears when the server restarts).

#### Issue: "Embedding is very slow"

The first embedding after startup is slow (10-30 seconds) while the model loads into memory. This is normal.

- **Subsequent embeddings:** Much faster (~50ms)
- **Docker users:** Model is pre-baked in the image for faster cold starts
- **Local installs:** Model downloads on first use and caches to `~/.cache/fastembed/`

### Quick Diagnostic Commands

Run these to quickly identify where the problem is:

```bash
# 1. Test basic server functionality
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  | docker run --rm -i context-fabric

# 2. Check Docker image exists
docker images context-fabric

# 3. Verify storage is accessible (Docker)
docker run --rm -v context-fabric-data:/data alpine ls -la /data/.context-fabric/

# 4. Test with explicit debug logging
LOG_LEVEL=debug docker run --rm -i -v context-fabric-data:/data/.context-fabric context-fabric 2>&1 | head -50
```

### Still Stuck?

We're here to help! Before reaching out, gather this info:

1. Output of the diagnostic commands above
2. Your CLI and version (e.g., `kimi --version`)
3. Whether you're using Docker or local Node.js

Then:
- Check the [full Troubleshooting guide](Troubleshooting) for advanced issues
- [File an issue](https://github.com/Abaddollyon/context-fabric/issues) with the diagnostic output
- [Start a discussion](https://github.com/Abaddollyon/context-fabric/discussions) for setup questions

---

## Quick Reference

### Key Paths

| Path | Description |
|------|-------------|
| `~/.context-fabric/config.yaml` | Configuration file |
| `context-fabric-data` | Docker volume for persistent storage |
| `/data/.context-fabric` | Data path inside Docker container |

### Common Commands

```bash
# Build Docker image
docker build -t context-fabric .

# Run with persistent storage
docker run --rm -i -v context-fabric-data:/data/.context-fabric context-fabric

# Local build
npm install && npm run build

# Test with tools/list (Docker)
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | docker run --rm -i context-fabric

# Test with tools/list (Local)
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node dist/server.js
```

---

[Tools Reference →](https://github.com/Abaddollyon/context-fabric/wiki/Tools-Reference) | [CLI Setup →](https://github.com/Abaddollyon/context-fabric/wiki/CLI-Setup) | [Back to README](https://github.com/Abaddollyon/context-fabric)
