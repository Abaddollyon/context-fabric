# Frequently Asked Questions

Got questions? We've got answers. If you don't find what you're looking for, [open a discussion](https://github.com/Abaddollyon/context-fabric/discussions) or [file an issue](https://github.com/Abaddollyon/context-fabric/issues).

---

## General Questions

### What is Context Fabric?

Context Fabric is a persistent memory system for AI coding agents. It's an [MCP](https://modelcontextprotocol.io/) (Model Context Protocol) server that gives your AI assistant a three-layer memory architecture:

- **Working Memory (L1)** – Session-scratchpad notes and temporary thoughts
- **Project Memory (L2)** – Decisions, bug fixes, and project history  
- **Semantic Memory (L3)** – Cross-project patterns searchable by meaning

Instead of starting every session with zero context, your AI remembers what you decided last week, what bugs you've fixed, and how you like your code structured.

### How is it different from other memory systems?

| Feature | Context Fabric | Other Systems |
|---------|---------------|---------------|
| **Architecture** | Three layers with auto-routing | Usually single-layer |
| **Search** | Semantic (meaning-based) + text + symbol | Often keyword-only |
| **Code indexing** | Built-in, auto-updating | Rarely included |
| **Offline** | 100% local, no cloud | Often requires APIs |
| **Time awareness** | "What happened while I was away?" | No temporal context |
| **Ghost messages** | Silent context injection | Not available |
| **CLI support** | 7 CLIs out of the box | Often 1-2 CLIs |

Unlike cloud-based memory services, Context Fabric never sends your code or memories to external APIs. Everything runs locally on your machine.

### Is it free?

**Yes.** Context Fabric is [MIT licensed](../LICENSE). You can use it for personal projects, commercial work, or even fork and modify it. No usage limits, no API keys, no hidden costs.

### Does it work offline?

**Yes, completely.** Context Fabric is designed to work 100% offline:

- All storage is local SQLite databases
- Embeddings run in-process (ONNX runtime)
- No cloud dependencies or API calls
- Works on airplanes, in bunkers, behind air-gapped networks

The only time you need internet is to clone the repository and build the Docker image.

---

## Setup Questions

### Docker vs Local – which should I choose?

**Docker (recommended for most users):**
-Zero Node.js setup on your host
-Cross-platform consistency
-Easy to upgrade (just rebuild the image)
-ONNX model baked in at build time (fast cold starts)
- ❌ Requires Docker installed

**Local Node.js:**
-No Docker dependency
-Direct file system access
-Easier for development/contributing
- ❌ Requires Node.js 22.5+ (specifically for `node:sqlite`)
- ❌ Managing the ONNX model cache manually

**Our recommendation:** Use Docker unless you're actively developing Context Fabric itself.

### Can I use it with multiple CLIs?

**Absolutely.** Context Fabric works with 7 different CLIs:

| CLI | Config Location |
|-----|-----------------|
| Claude Code | `~/.claude.json` |
| Kimi | `~/.kimi/mcp.json` |
| OpenCode | `~/.config/opencode/opencode.json` |
| Codex CLI | `~/.codex/config.toml` |
| Gemini CLI | `~/.gemini/settings.json` |
| Cursor | `~/.cursor/mcp.json` |
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` |

Your memories are **shared across all CLIs**. Store a decision in Claude Code, recall it in Kimi. The data lives in `~/.context-fabric/`, not in any specific CLI's storage.

### How do I migrate from one CLI to another?

No migration needed! Just configure Context Fabric in the new CLI. All your memories are already there because they're stored in a shared location (`~/.context-fabric/`).

To set up a new CLI, either:

1. **Auto-setup** (easiest) – Ask your current AI to do it:
   ```
   "Install and configure Context Fabric for Cursor using Docker"
   ```

2. **Manual** – Copy the config from [CLI Setup](../docs/cli-setup.md) into the appropriate file for your new CLI.

Your project memories (L2) and semantic memories (L3) will be immediately available. Working memories (L1) are session-specific and don't persist anyway.

---

## Memory Questions

### How long do memories last?

It depends on the layer:

| Layer | Persistence | Lifespan |
|-------|-------------|----------|
| **L1: Working** | Session only | 1 hour TTL by default, or until server restart |
| **L2: Project** | Permanent | Forever, unless deleted or summarized |
| **L3: Semantic** | Decay-based | Indefinite with use; 14+ days of inactivity causes decay |

**L3 Decay explained:** Unused L3 memories slowly lose relevance. A memory with 10+ accesses is highly resistant to decay. A memory unused for 14+ days may be deleted. Pin important memories (`pinned: true`) or access them periodically to keep them alive.

You can tune these values in `~/.context-fabric/config.yaml`:

```yaml
ttl:
  l1Default: 3600      # L1 TTL in seconds (1 hour)
  l3DecayDays: 14      # L3 decay period in days
  l3AccessThreshold: 3 # Accesses needed to resist decay
```

### Can I export/import memories?

**Yes.** Since all data is in SQLite, you can backup/restore easily:

```bash
# Export (backup)
cp -r ~/.context-fabric ~/context-fabric-backup-$(date +%Y%m%d)

# Import (restore)
cp -r ~/context-fabric-backup-20260225 ~/.context-fabric
```

For Docker users, backup the named volume:

```bash
# Export
docker run --rm -v context-fabric-data:/data alpine tar czf - /data \
  > context-fabric-backup.tar.gz

# Import
docker run --rm -v context-fabric-data:/data -i alpine tar xzf - \
  < context-fabric-backup.tar.gz
```

### How do I delete old memories?

Use the `context.delete` tool:

```json
{
  "memoryId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}
```

Or bulk delete by listing first. Ask your AI:

```
"List all L2 memories tagged 'temp' and delete them"
```

For large cleanups, you might want to summarize instead of delete:

```json
{
  "sessionId": "my-session",
  "layer": 2,
  "olderThanDays": 90,
  "options": {
    "targetTokens": 2000,
    "includeDecisions": true
  }
}
```

### What's the difference between the layers?

Think of it like human memory:

| Layer | Analogy | What goes there | How it's retrieved |
|-------|---------|-----------------|-------------------|
| **L1** | Short-term memory | TODOs, scratchpad notes, "currently working on" | Linear scan of recent items |
| **L2** | Long-term facts | Decisions, bug fixes, project history | Text search (LIKE queries) |
| **L3** | Deep knowledge | Code patterns, conventions, best practices | Semantic search (meaning-based) |

**L1 (Working):** 
- Stored in RAM
- Session-scoped
- "Refactoring the auth module"
- "Remember to update tests"

**L2 (Project):**
- Stored in SQLite
- Project-scoped
- "Use Zod for API validation"
- "Fixed race condition in token refresh"

**L3 (Semantic):**
- Stored in SQLite with embeddings
- Cross-project (global)
- "React component pattern: container/presenter"
- "Error handling convention: early returns"

The **Smart Router** automatically picks the right layer based on content type. You usually don't need to specify.

### When to Use Each Layer — Real Scenarios

Not sure which layer to use? Here are real-world scenarios to guide you:

#### Use L1 (Working Memory) When...

You're in the middle of something and need to jot down temporary thoughts.

| Scenario | Example |
|----------|---------|
| **Current task tracking** | *"Currently refactoring the auth middleware — need to update 3 more files"* |
| **Session TODOs** | *"Remember to run tests before committing"* |
| **Temporary context** | *"User wants dark mode, but we're holding off until the design system update"* |
| **Scratchpad notes** | *"Idea: use Redis for rate limiting instead of in-memory"* |

**Think of L1 as your sticky notes.** They're great for right now, but you don't need them tomorrow.

#### Use L2 (Project Memory) When...

You've made a decision or fixed something that matters for the project's future.

| Scenario | Example |
|----------|---------|
| **Architecture decisions** | *"Use Zod for validation, not Joi — decided Feb 2026"* |
| **Bug fixes with context** | *"Fixed race condition in token refresh by adding mutex — see commit abc123"* |
| **Environment quirks** | *"Database URL must use postgres:// not postgresql:// on this VPS"* |
| **Third-party limitations** | *"Stripe webhook doesn't fire in test mode for invoice.payment_succeeded"* |
| **Team conventions** | *"We prefix feature branches with `feat/`, hotfixes with `hotfix/`"* |

**Think of L2 as your project diary.** Write down what you'd want to remember when you return to this project in 3 months.

#### Use L3 (Semantic Memory) When...

You've discovered a pattern that applies beyond this single project.

| Scenario | Example |
|----------|---------|
| **Reusable code patterns** | *"React pattern: useReducer + context for complex form state"* |
| **Language idioms** | *"Rust pattern: implement Default trait for structs with many optional fields"* |
| **Error handling approaches** | *"TypeScript: use `Result<T, E>` pattern for explicit error handling"* |
| **Testing strategies** | *"Mock external APIs at the HTTP layer, not the function layer"* |
| **Performance insights** | *"Avoid N+1 queries by using `select_related` in Django ORM"* |

**Think of L3 as your personal Stack Overflow.** Knowledge that follows you to every new project.

#### Quick Decision Flowchart

```
Is this relevant beyond this project?
├── Yes → L3 (Semantic)
└── No → Is this a decision/fix worth remembering?
    ├── Yes → L2 (Project)
    └── No → L1 (Working)
```

**Pro tip:** Don't overthink it. The Smart Router often makes the right choice automatically. But when in doubt, use L2 — it's the most versatile layer.

---

## Privacy & Security

### Is my code sent to external APIs?

**No.** Context Fabric never sends your code to any external service:

- Code indexing happens locally
- Embeddings run in-process (ONNX runtime)
- Semantic search uses local vector comparison
- No telemetry or analytics
- No cloud dependencies

The only network activity is if you use Docker to pull the base Node.js image during the initial build.

### Where is data stored?

All data lives in `~/.context-fabric/` (or `$CONTEXT_FABRIC_DIR` if set):

```
~/.context-fabric/
├── config.yaml           # Your configuration
├── l2-project.db         # L2 project memories (SQLite)
├── l3-semantic/          # L3 semantic memories
│   └── memories.db       # Embeddings + metadata
└── backups/              # Automatic backups
```

In Docker, this maps to a named volume:

```bash
-v context-fabric-data:/data/.context-fabric
```

### Can I encrypt the database?

SQLite databases are not encrypted by default. For encryption:

1. **Full-disk encryption** (recommended) – If your system disk is encrypted (BitLocker, FileVault, LUKS), your data is protected.

2. **Database-level encryption** – You can use SQLCipher with SQLite. This requires building a custom Docker image with SQLCipher support.

3. **Volume encryption** – For Docker, encrypt the volume at the host level.

Context Fabric doesn't include built-in encryption yet. If this is important to you, [open an issue](https://github.com/Abaddollyon/context-fabric/issues) to discuss implementation.

---

## Advanced

### How do I tune the decay algorithm?

The L3 decay algorithm helps keep your semantic memory fresh by gradually fading out old, unused memories. Think of it like cleaning out your closet — items you haven't worn in a while get donated to make space for new ones.

**In plain English:** The algorithm looks at two things:
1. **How long since you last accessed this memory?** (inactivity penalty)
2. **How many times have you accessed it overall?** (access boost)

A memory you've accessed 10+ times becomes "sticky" and resists decay. A memory you haven't touched in 30+ days starts to fade away.

**The math (if you're curious):**

```
score = (age_decay * 0.3 + inactivity_penalty * 0.7) + access_boost
```

But you don't need to remember this formula. Just tune it in `~/.context-fabric/config.yaml`:

```yaml
ttl:
  l3DecayDays: 14           # How many days before decay starts (default)
  l3AccessThreshold: 3      # Minimum accesses to resist decay
  l3DecayThreshold: 0.2     # Score below which memories are deleted
```

**Making memories last longer:**
- Increase `l3DecayDays` to 30 or 60 (more time before decay kicks in)
- Lower `l3AccessThreshold` to 1 or 2 (easier to become "sticky")
- Pin important memories: `context.update({ memoryId: "...", pinned: true })`

**Making memories expire faster:**
- Decrease `l3DecayDays` to 7 (aggressive cleanup)
- Increase `l3AccessThreshold` to 5 (harder to become "sticky")

To "save" an important memory from decay, pin it (`pinned: true`) or access it periodically.

### Can I use a different embedding model?

**Yes**, but it requires rebuilding the Docker image (or recompiling for local installs).

Edit `~/.context-fabric/config.yaml`:

```yaml
embedding:
  model: "Xenova/all-MiniLM-L6-v2"  # Change this
  dimension: 384                       # Must match the model!
  batchSize: 32
```

Compatible models must:
- Be ONNX format (via [fastembed](https://github.com/ankane/fastembed))
- Have consistent dimensions
- Be available on HuggingFace

**Popular alternatives:**
- `Xenova/all-MiniLM-L6-v2` (default, 384d) – Fast, good quality
- `Xenova/all-MiniLM-L12-v2` (384d) – Slightly better quality, slower
- `Xenova/all-distilroberta-v1` (768d) – Higher quality, larger

**Warning:** Changing models after you have L3 memories will require regenerating all embeddings. Back up first!

### How do I contribute?

We'd love your help! Here's how to get started:

```bash
# 1. Fork and clone
git clone https://github.com/YOUR_USERNAME/context-fabric.git
cd context-fabric

# 2. Install dependencies (Node.js 22.5+ required)
npm install
npm run build

# 3. Run tests
npm test
```

**Areas we need help with:**
- Bug fixes and performance improvements
- New CLI integrations
- Documentation improvements
- Additional language support for code indexing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for detailed guidelines.

**Before submitting a PR:**
- All 253+ tests should pass
- Follow the existing TypeScript strict mode style
- Keep dependencies minimal (every new dep needs justification)
- Add tests for new functionality

---

## Troubleshooting

We know errors can be frustrating — especially when you're excited to try something new! Here are common issues and how to resolve them.

### "MCP server not appearing"

Don't worry, this is usually a quick fix! Let's check a few things:

1. **Verify the path** to `dist/server.js` is **absolute** (not relative). Your CLI needs the full path to find the server.
2. **Check the config file is valid JSON** (or TOML for Codex). A missing comma or trailing comma can break everything.
3. **Restart your CLI** – most require a restart after config changes.
4. **Test manually** to see if the server works:
   ```bash
   echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
     | docker run --rm -i context-fabric
   ```

If the manual test works but your CLI still doesn't see the tools, it's a config file issue. Double-check the file location for your specific CLI.

### "Memories not persisting"

That's annoying — you stored something important and now it's gone. Let's fix that:

1. **Check `~/.context-fabric/` exists and is writable.** If not, create it:
   ```bash
   mkdir -p ~/.context-fabric
   ```

2. **For Docker, ensure you're using the named volume:**
   ```bash
   -v context-fabric-data:/data/.context-fabric
   ```
   Without this flag, memories live only as long as the container does.

3. **Verify you're storing to L2 or L3** (not L1). L1 memories are ephemeral and disappear when the server restarts. If you want persistence, make sure you're storing to layer 2 or 3.

### "Embedding is slow"

We hear you — waiting is no fun! Here's what's happening:

- **First embedding after startup is slow** (10-30 seconds) while the model loads into RAM. This is normal and happens once per session.
- **Subsequent embeddings are much faster** (~50ms each) because the model stays cached.

**To speed things up:**
- Use Docker — the ONNX model is baked into the image for faster cold starts
- If running locally, the model will cache to `~/.cache/fastembed/` after first use

### "I keep getting SQLite errors"

Database errors can look scary, but they're usually permission or path issues:

```
SqliteError: unable to open database file
```

**This typically means:**
- The `~/.context-fabric/` directory doesn't exist (create it with `mkdir -p`)
- Context Fabric doesn't have write permissions (check with `ls -la ~/`)
- You're out of disk space (check with `df -h`)

**For "database is locked" errors:**
- Only one Context Fabric instance can access the database at a time
- Make sure you don't have multiple CLI windows running it simultaneously
- Restart your CLI to release any stuck locks

---

## Quick Reference

| Task | Tool/Command |
|------|--------------|
| Store a decision | `context.store({ type: "decision", content: "...", metadata: { tags: ["api"] } })` |
| Search memories | `context.recall({ query: "how do we handle auth?" })` |
| Start of session | `context.orient({ projectPath: "/path/to/project" })` |
| List all decisions | `context.list({ type: "decision", layer: 2 })` |
| Promote to L3 | `context.update({ memoryId: "...", targetLayer: 3 })` |
| Auto-setup CLI | `context.setup({ cli: "cursor", useDocker: true })` |

---

*Last updated: February 2026*

For more details, see the [full documentation](../docs/) or [open an issue](https://github.com/Abaddollyon/context-fabric/issues).
