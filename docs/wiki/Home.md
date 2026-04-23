# Context Fabric

**Local-first MCP memory for AI coding agents.**

Context Fabric gives MCP-compatible coding tools persistent memory across sessions, projects, and CLIs. It is built for coding workflows: decisions, bug fixes, conventions, reusable patterns, code search, and the question every returning agent needs answered quickly: **what changed while I was away?**

> [!NOTE]
> **Pre-1.0, but built for daily use.** Context Fabric is actively used, tested, and released regularly. APIs and storage formats may still evolve before 1.0, so pin versions and review the [CHANGELOG](https://github.com/Abaddollyon/context-fabric/blob/main/CHANGELOG.md) before upgrading.

---

## Start Here

- **New to the project?** Read [Getting Started](Getting-Started.md)
- **Need to wire it into a CLI?** Go to [CLI Setup](CLI-Setup.md)
- **Want the feature surface quickly?** See [Tools Reference](Tools-Reference.md)
- **Want the numbers?** Open [Benchmarks](Benchmarks.md)
- **Want the internals?** Open [Architecture](Architecture.md)
- **Need the full canonical docs?** Use the repo docs linked throughout this wiki

---

## Why people use Context Fabric

- **Local-first** — SQLite storage, local embeddings, Docker or local deployment, no hosted service required.
- **Benchmarked against the frontier** — on BEIR SciFact and LongMemEval_S, retrieval is within a few points of OpenAI's paid embedding API and above it on deep recall (see [Benchmarks](Benchmarks.md)).
- **Built for coding agents** — remembers architecture decisions, debugging discoveries, house rules, and code patterns.
- **MCP-native** — real MCP server with Tools, Resources, and Prompts.
- **Code-aware** — code indexing, symbol extraction, and semantic code search.
- **Time-aware** — orientation around session gaps and recent changes.

---

## Core capabilities

### Three-layer memory

| Layer | Purpose | Scope |
|------|---------|-------|
| **L1: Working** | temporary notes and scratchpad context | session |
| **L2: Project** | decisions, bug fixes, project-specific memory | per project |
| **L3: Semantic** | reusable patterns, conventions, cross-project knowledge | global |

### Retrieval and reasoning
- Hybrid recall via **FTS5 BM25 + vector similarity + Reciprocal Rank Fusion**
- Time-aware orientation and offline-gap detection
- Provenance, dedup-on-store, and bi-temporal memory support
- Ghost-message style context surfacing through `context.getCurrent`

### Agent ergonomics
- **25 MCP tools**
- **5 MCP Prompts** (`cf-*` workflows)
- **6 resource views/templates** under `memory://...`
- **Skills** as invokable procedural memory
- `context.setup` for supported CLIs

---

## Quick start

```bash
git clone https://github.com/Abaddollyon/context-fabric.git
cd context-fabric
docker build -t context-fabric .

echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  | docker run --rm -i context-fabric
```

For persistent storage when running via Docker:

```bash
docker run --rm -i -v context-fabric-data:/data/.context-fabric context-fabric
```

Full setup guide: [Getting Started](Getting-Started.md)

---

## Supported CLIs

- Claude Code
- Kimi
- OpenCode
- Codex CLI
- Gemini CLI
- Cursor
- Claude Desktop

Manual and auto-setup details: [CLI Setup](CLI-Setup.md)

---

## Suggested reading path

### If you want to try it fast
1. [Getting Started](Getting-Started.md)
2. [CLI Setup](CLI-Setup.md)
3. [Troubleshooting](Troubleshooting.md)

### If you want to understand the product
1. [Tools Reference](Tools-Reference.md)
2. [Memory Types](Memory-Types.md)
3. [Benchmarks](Benchmarks.md)
4. [FAQ](FAQ.md)

### If you want to understand the internals
1. [Architecture](Architecture.md)
2. [Configuration](Configuration.md)
3. [Agent Integration](Agent-Integration.md)

---

## Canonical repo docs

The GitHub Wiki is the launch-friendly overview layer. The canonical deep technical docs live in the repository:

- [README](https://github.com/Abaddollyon/context-fabric/blob/main/README.md)
- [Getting Started](https://github.com/Abaddollyon/context-fabric/blob/main/docs/getting-started.md)
- [CLI Setup](https://github.com/Abaddollyon/context-fabric/blob/main/docs/cli-setup.md)
- [Tools Reference](https://github.com/Abaddollyon/context-fabric/blob/main/docs/tools-reference.md)
- [Memory Types](https://github.com/Abaddollyon/context-fabric/blob/main/docs/memory-types.md)
- [Configuration](https://github.com/Abaddollyon/context-fabric/blob/main/docs/configuration.md)
- [Agent Integration](https://github.com/Abaddollyon/context-fabric/blob/main/docs/agent-integration.md)
- [Architecture](https://github.com/Abaddollyon/context-fabric/blob/main/docs/architecture.md)

---

**Stop re-explaining your codebase every session.**
