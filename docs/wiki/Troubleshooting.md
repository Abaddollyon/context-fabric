# Troubleshooting Context Fabric

Having trouble? Don't worry — we'll get you back on track. This guide covers common issues, diagnostic commands, and solutions for first-time setup and beyond.

---

## 🚑 "It Didn't Work" — Let's Figure It Out

We know that sinking feeling when something *should* work but doesn't. Take a breath — most issues have simple fixes, and we're here to help you through them.

If you're stuck right now, start with these quick checks:

```bash
# Test basic server functionality
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  | docker run --rm -i context-fabric

# Test with local Node.js
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  | node dist/server.js

# Check Docker image exists
docker images context-fabric

# Check storage directory
ls -la ~/.context-fabric/

# Check storage directory (Docker volume)
docker run --rm -v context-fabric-data:/data alpine ls -la /data/.context-fabric/
```

---

## 1. Common First-Run Issues

### Docker Build Fails

**Symptom:**
```
ERROR: failed to solve: executor failed running [/bin/sh -c npm install]
```
or
```
ERROR: Docker daemon is not running
```

**Don't panic!** Build failures are usually environment-related, not code-related.

**Common Causes & Solutions:**

| Cause | Solution |
|-------|----------|
| Docker daemon not running | Start Docker Desktop or `sudo systemctl start docker` |
| Network issues during build | Check internet connection, retry: `docker build -t context-fabric . --no-cache` |
| Insufficient disk space | Free up space: `docker system prune -a` |
| Permission denied (Linux) | Add user to docker group: `sudo usermod -aG docker $USER` then relogin |
| Build context too large | Ensure you're in the context-fabric directory, not a parent with many files |

**Diagnose:**
```bash
# Check Docker is running
docker version

# Check available disk space
docker system df

# Verbose build to see where it fails
docker build -t context-fabric . --progress=plain 2>&1
```

---

### Node.js Version Errors

**Symptom:**
```
Error: Cannot find module 'node:sqlite'
```
or
```
SyntaxError: Unexpected token 'with'
```

**Cause:** Node.js version is below 22.5.0

**Solution:**
```bash
# Check current version
node --version  # Must be >= 22.5.0

# If using nvm
nvm install 22
nvm use 22

# If using fnm
fnm install 22
fnm use 22

# Verify
node --version  # Should show v22.5.0 or higher
```

> **Note:** Context Fabric uses `node:sqlite` which was added in Node.js 22.5.0. Earlier versions will not work.

**Easier alternative:** Use Docker instead — no Node.js version management needed!

---

### npm install Fails

**Symptom:**
```
npm ERR! code E404
npm ERR! 404 Not Found - GET https://registry.npmjs.org/...
```
or
```
npm ERR! code ENOENT
npm ERR! syscall open
```

**Common Causes & Solutions:**

| Cause | Solution |
|-------|----------|
| Corrupted node_modules | Delete and reinstall: `rm -rf node_modules package-lock.json && npm install` |
| npm registry issues | Use alternative registry: `npm install --registry https://registry.npmmirror.com` |
| Permission issues | Don't use sudo with npm. Fix permissions: `sudo chown -R $(whoami) ~/.npm` |
| Network/proxy issues | Configure proxy: `npm config set proxy http://proxy.company.com:8080` |

**Diagnose:**
```bash
# Clear npm cache
npm cache clean --force

# Check npm version
npm --version

# Try with verbose logging
npm install --verbose 2>&1 | head -100
```

---

## 2. Configuration Issues

### MCP Server Not Appearing in CLI

**Symptom:** AI doesn't see Context Fabric tools; no `context.*` commands available.

**We feel your pain** — you've done the setup, but the tools just aren't there. Let's diagnose:

**Diagnostic Checklist:**

```bash
# 1. Verify the server starts correctly
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  | docker run --rm -i context-fabric

# Should output JSON with 12 tools. If not, check server logs.

# 2. Check CLI config file exists and is valid JSON
cat ~/.kimi/mcp.json        # Kimi
cat ~/.claude.json          # Claude Code
cat ~/.cursor/mcp.json      # Cursor
cat ~/.gemini/settings.json # Gemini

# 3. Validate JSON syntax
node -e "JSON.parse(require('fs').readFileSync(process.argv[1]))" ~/.kimi/mcp.json
```

**Common Causes & Solutions:**

| Cause | Solution |
|-------|----------|
| Config file has syntax errors | Validate JSON/TOML. Look for trailing commas in JSON |
| Path to server is relative | Use **absolute** paths: `/home/user/context-fabric/dist/server.js` |
| Server file doesn't exist | Run `npm run build` to create `dist/server.js` |
| CLI not restarted | Most CLIs need restart after config changes |
| Wrong config file location | Double-check path for your CLI (see [CLI Setup](../docs/cli-setup.md)) |

**For Docker:**
```bash
# Ensure image is built
docker images | grep context-fabric

# If missing, build it
docker build -t context-fabric .

# Test Docker command directly
docker run --rm -i -v context-fabric-data:/data/.context-fabric context-fabric
```

---

### Config File Syntax Errors

**Symptom:**
```
Unexpected token } in JSON at position 123
```
or (Codex)
```
TOML parse error: invalid table header
```

**The dreaded trailing comma!** It gets everyone at some point.

**Common JSON Mistakes:**

```json
// ❌ Trailing comma (invalid)
{
  "mcpServers": {
    "context-fabric": {
      "command": "docker",
      "args": ["run", "--rm", "-i", "context-fabric"],
    }
  }
}

// ✅ Valid
{
  "mcpServers": {
    "context-fabric": {
      "command": "docker",
      "args": ["run", "--rm", "-i", "context-fabric"]
    }
  }
}
```

**Validate Your Config:**
```bash
# JSON validation
node -e "JSON.parse(require('fs').readFileSync(process.argv[1]))" ~/.kimi/mcp.json && echo "Valid JSON"

# TOML validation (Codex)
npx @iarna/toml-parse ~/.codex/config.toml && echo "Valid TOML"

# Or use jq
jq '.' ~/.kimi/mcp.json > /dev/null && echo "Valid JSON"
```

---

### Path Issues (Relative vs Absolute)

**Symptom:** Server appears to start but tools don't work; "file not found" errors.

**The Rule:** Always use **absolute paths** in MCP configs.

```bash
# Get absolute path
pwd                          # Current directory
realpath dist/server.js      # Absolute path to file
readlink -f dist/server.js   # Linux: absolute path
```

**Example Fix:**

```json
// ❌ Relative path (will fail)
{
  "mcpServers": {
    "context-fabric": {
      "command": "node",
      "args": ["dist/server.js"]
    }
  }
}

// ✅ Absolute path (correct)
{
  "mcpServers": {
    "context-fabric": {
      "command": "node",
      "args": ["/home/username/projects/context-fabric/dist/server.js"]
    }
  }
}
```

**For Windows:**
```json
{
  "mcpServers": {
    "context-fabric": {
      "command": "node",
      "args": ["C:\\Users\\Username\\context-fabric\\dist\\server.js"]
    }
  }
}
```

---

## 3. Runtime Issues

### Memories Not Persisting

**Symptom:** Memories work during session but disappear after restart.

**This is frustrating** — you stored something important, and now it's gone. Let's get it fixed:

**Diagnose:**
```bash
# Check if storage directory exists and is writable
ls -la ~/.context-fabric/

# Check database files exist
ls -la ~/.context-fabric/*.db
ls -la ~/.context-fabric/l3-semantic/

# For Docker: check volume
docker volume ls | grep context-fabric
docker run --rm -v context-fabric-data:/data alpine ls -la /data/.context-fabric/

# Check memory count via direct query
sqlite3 ~/.context-fabric/l2-project.db "SELECT COUNT(*) FROM memories;"
```

**Common Causes & Solutions:**

| Cause | Solution |
|-------|----------|
| Docker volume not mounted | Add `-v context-fabric-data:/data/.context-fabric` to docker args |
| Volume accidentally removed | Data lost; use host bind mount for backup: `-v ~/cf-data:/data/.context-fabric` |
| Permission denied | Check ownership: `sudo chown -R $USER ~/.context-fabric` |
| Disk full | Check space: `df -h` and clean up |
| Running in ephemeral mode | Don't use `:memory:` for production |
| Stored to L1 instead of L2/L3 | L1 memories are session-only; use `layer: 2` for persistence |

**Verify Storage Location:**
```bash
# With LOG_LEVEL=debug, look for:
# "[ContextFabric] Storage path: /home/user/.context-fabric"

# Or check the actual path used
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"context.orient","arguments":{}}}' \
  | docker run --rm -i -e LOG_LEVEL=debug -v context-fabric-data:/data/.context-fabric context-fabric 2>&1 \
  | grep -i "storage\|path\|error"
```

---

### Embedding Generation Slow/Failing

**Symptom:** `context.recall` or `context.searchCode` times out; first semantic search is very slow.

**Cause:** First embedding model load takes 10-30 seconds.

**Don't worry — this is normal!** The embedding model is loading into memory. Subsequent searches will be much faster.

**Solutions:**

1. **Use Docker (recommended)** - Model is baked into image, no download needed
2. **Pre-warm the cache** - Run one recall during setup
3. **Check model cache location:**

```bash
# Check fastembed cache
ls -la ~/.cache/fastembed/

# For Docker, ensure FASTEMBED_CACHE_PATH is set
# (Set automatically in the Docker image)
```

**Timeout Workarounds:**

```json
// For Gemini CLI - increase timeout
{
  "mcpServers": {
    "context-fabric": {
      "command": "docker",
      "args": ["run", "--rm", "-i", "-v", "context-fabric-data:/data/.context-fabric", "context-fabric"],
      "timeout": 60000
    }
  }
}
```

**Disable semantic search if needed:**
```javascript
// Use text mode instead of semantic
context.searchCode({ query: "auth", mode: "text" })
```

---

### SQLite Errors

**Symptom:**
```
SqliteError: database is locked
```
or
```
SqliteError: unable to open database file
```
or
```
Error: Corrupted database
```

**Database errors look scary, but they're usually fixable.** Here's what to do:

**Solutions:**

| Error | Cause | Solution |
|-------|-------|----------|
| `database is locked` | Multiple processes accessing | Only run one instance; restart your CLI |
| `unable to open database file` | Directory doesn't exist | `mkdir -p ~/.context-fabric/l3-semantic` |
| `corrupted database` | Crash during write | Restore from backup or delete and recreate |
| `disk I/O error` | Disk full or permissions | Check `df -h` and permissions |

**Fix Corrupted Database:**
```bash
# Backup first
cp ~/.context-fabric/l2-project.db ~/.context-fabric/l2-project.db.bak

# Try to recover
sqlite3 ~/.context-fabric/l2-project.db ".recover" > recovered.sql
rm ~/.context-fabric/l2-project.db
sqlite3 ~/.context-fabric/l2-project.db < recovered.sql

# Or delete and start fresh (data loss!)
rm ~/.context-fabric/*.db
rm -rf ~/.context-fabric/l3-semantic/
```

**Clear WAL files if needed:**
```bash
# SQLite WAL files can accumulate
ls ~/.context-fabric/*.db-*

# These are normal, but if huge:
sqlite3 ~/.context-fabric/l2-project.db "PRAGMA wal_checkpoint(TRUNCATE);"
```

---

## 4. CLI-Specific Issues

### Claude Code Not Loading Tools

**Symptom:** `claude` command doesn't show Context Fabric tools.

**Checklist:**
1. Config file at correct location:
   ```bash
   cat ~/.claude.json
   ```

2. Valid JSON (no trailing commas)

3. Restart Claude Code completely (not just the session)

4. Check for global vs project config conflicts:
   ```bash
   # Check both locations
   cat ~/.claude.json
   cat .claude.json  # in project root
   ```

**Debug:**
```bash
# Run Claude Code with verbose logging
claude --verbose

# Check MCP server status
claude mcp status
```

---

### Cursor Agent Mode Issues

**Symptom:** Tools don't appear or aren't used in Cursor.

**Important:** Cursor only supports MCP tools in **Agent Mode**, not regular chat.

**Checklist:**
1. Switch to Agent Mode (dropdown in chat input)
2. Use an agent-capable model (Claude 3.5 Sonnet, GPT-4, etc.)
3. Verify config at `~/.cursor/mcp.json`
4. Cursor auto-reloads on save - no restart needed

**Verify in Cursor:**
```
File > Preferences > Cursor Settings > Tools & Integrations > MCP Tools
```

Should show `context-fabric` with 12 tools.

---

### Kimi MCP Config Issues

**Symptom:** Kimi doesn't load Context Fabric.

**Checklist:**
1. Config at `~/.kimi/mcp.json`:
   ```bash
   cat ~/.kimi/mcp.json
   ```

2. Restart Kimi after config changes

3. Check Kimi version supports MCP:
   ```bash
   kimi --version
   ```

**Manual Test:**
```bash
# Test server directly
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  | docker run --rm -i context-fabric
```

If this works, the issue is Kimi config. If not, the issue is the server.

---

### Codex CLI (TOML) Issues

**Symptom:** Codex doesn't recognize the MCP server.

**Common TOML Issues:**

```toml
# ❌ Wrong: Using = instead of []
[mcp_servers.context-fabric]
  command = "docker"

# ✅ Correct
[mcp_servers.context-fabric]
command = "docker"
args = ["run", "--rm", "-i", "-v", "context-fabric-data:/data/.context-fabric", "context-fabric"]
enabled = true
```

**Validate TOML:**
```bash
# Install taplo for validation
cargo install taplo-cli

# Validate
taplo lint ~/.codex/config.toml
```

---

### OpenCode Issues

**Symptom:** OpenCode doesn't show Context Fabric in tool list.

**Checklist:**
1. Config location: `~/.config/opencode/opencode.json`
2. Must have `"enabled": true`
3. Restart OpenCode

```json
{
  "mcp": {
    "context-fabric": {
      "type": "local",
      "command": ["docker", "run", "--rm", "-i", "-v", "context-fabric-data:/data/.context-fabric", "context-fabric"],
      "enabled": true
    }
  }
}
```

---

### Gemini CLI Issues

**Symptom:** Gemini doesn't load or enable Context Fabric.

**Checklist:**
1. Config at `~/.gemini/settings.json`
2. Enable after config change:
   ```
   /mcp enable context-fabric
   ```
3. Or restart Gemini

**Trust Issues:**
```json
{
  "mcpServers": {
    "context-fabric": {
      "command": "docker",
      "args": ["run", "--rm", "-i", "-v", "context-fabric-data:/data/.context-fabric", "context-fabric"],
      "trust": true
    }
  }
}
```

---

## 5. Performance Issues

### Slow L3 Recall

**Symptom:** `context.recall` takes several seconds.

**Causes & Solutions:**

| Cause | Solution |
|-------|----------|
| Large memory database | Reduce L3 memories: `context.summarize({ layer: 3 })` |
| First embedding load | Use Docker (pre-baked model) or pre-warm |
| Too many pinned memories | Review pinned memories, unpin old ones |
| Hardware limitations | Increase batch size in config, or use faster hardware |

**Optimize Config:**
```yaml
# ~/.context-fabric/config.yaml
embedding:
  batchSize: 64  # Increase for better throughput

context:
  maxRelevantMemories: 5  # Reduce if not needed
```

**Monitor Performance:**
```bash
# With debug logging
LOG_LEVEL=debug docker run --rm -i -v context-fabric-data:/data/.context-fabric context-fabric
```

---

### High Memory Usage

**Symptom:** Context Fabric uses too much RAM.

**Causes & Solutions:**

| Cause | Solution |
|-------|----------|
| Embedding cache too large | Restart server to clear cache |
| Large L3 database | Run summarization to archive old memories |
| Code index on large project | Adjust `maxFiles` and `maxFileSizeBytes` |
| Memory leak | Restart the server/CLI |

**Limit Resources:**
```yaml
# ~/.context-fabric/config.yaml
codeIndex:
  maxFiles: 1000        # Reduce from 10000
  maxFileSizeBytes: 512000  # Reduce from 1MB
  chunkLines: 100       # Smaller chunks

context:
  maxWorkingMemories: 5
  maxRelevantMemories: 5
```

---

## 6. Debug Tips

### Enable Debug Logging

Set `LOG_LEVEL=debug` to see detailed operations:

```bash
# Docker
LOG_LEVEL=debug docker run --rm -i -v context-fabric-data:/data/.context-fabric context-fabric

# Or in CLI config
{
  "mcpServers": {
    "context-fabric": {
      "command": "docker",
      "args": ["run", "--rm", "-i", "-e", "LOG_LEVEL=debug", "-v", "context-fabric-data:/data/.context-fabric", "context-fabric"]
    }
  }
}
```

**What to look for:**
- `[ContextFabric] Storage path:` - Verify correct data directory
- `[ContextFabric] Embedding cache size:` - Check cache growth
- `[ContextFabric] Router decision:` - See why memories go to specific layers
- Error stack traces

---

### Testing with Echo Commands

Test the server directly without a CLI:

```bash
# List all tools
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  | docker run --rm -i context-fabric | jq

# Store a memory
echo '{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "context.store",
    "arguments": {
      "type": "decision",
      "content": "Test memory",
      "metadata": { "title": "Test", "tags": ["test"] }
    }
  }
}' | docker run --rm -i -v context-fabric-data:/data/.context-fabric context-fabric | jq

# Orient (check time and offline gap)
echo '{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "context.orient",
    "arguments": {}
  }
}' | docker run --rm -i -v context-fabric-data:/data/.context-fabric context-fabric | jq

# Recall memories
echo '{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "tools/call",
  "params": {
    "name": "context.recall",
    "arguments": {
      "query": "test",
      "sessionId": "test-session"
    }
  }
}' | docker run --rm -i -v context-fabric-data:/data/.context-fabric context-fabric | jq
```

---

### Checking Storage Files

**L2 Project Memory:**
```bash
# Location
ls -la ~/.context-fabric/l2-project.db

# Check size
ls -lh ~/.context-fabric/l2-project.db

# Query directly
sqlite3 ~/.context-fabric/l2-project.db "SELECT COUNT(*) FROM memories;"
sqlite3 ~/.context-fabric/l2-project.db "SELECT type, COUNT(*) FROM memories GROUP BY type;"
sqlite3 ~/.context-fabric/l2-project.db "SELECT id, type, substr(content, 1, 50) FROM memories ORDER BY created_at DESC LIMIT 10;"
```

**L3 Semantic Memory:**
```bash
# Location
ls -la ~/.context-fabric/l3-semantic/memories.db

# Count memories
sqlite3 ~/.context-fabric/l3-semantic/memories.db "SELECT COUNT(*) FROM semantic_memories;"

# Check pinned status
sqlite3 ~/.context-fabric/l3-semantic/memories.db "SELECT pinned, COUNT(*) FROM semantic_memories GROUP BY pinned;"

# View recent memories
sqlite3 ~/.context-fabric/l3-semantic/memories.db \
  "SELECT id, type, substr(content, 1, 50), relevance_score FROM semantic_memories ORDER BY created_at DESC LIMIT 5;"
```

**Config File:**
```bash
# View current config
cat ~/.context-fabric/config.yaml

# Validate YAML
node -e "require('js-yaml').load(require('fs').readFileSync(process.argv[1]))" ~/.context-fabric/config.yaml && echo "Valid YAML"
```

---

### Backup and Restore

**Backup:**
```bash
# Backup all data
tar czf context-fabric-backup-$(date +%Y%m%d).tar.gz ~/.context-fabric/

# Or backup Docker volume
docker run --rm -v context-fabric-data:/data alpine tar czf - /data > context-fabric-docker-backup.tar.gz
```

**Restore:**
```bash
# Restore from backup
tar xzf context-fabric-backup-20240115.tar.gz -C ~/

# Or restore Docker volume
docker run --rm -v context-fabric-data:/data -i alpine tar xzf - < context-fabric-docker-backup.tar.gz
```

---

### Complete Reset

**Warning: This deletes all memories!**

```bash
# Stop all Context Fabric instances first

# Delete local data
rm -rf ~/.context-fabric/

# Delete Docker volume
docker volume rm context-fabric-data

# Rebuild Docker image
docker build -t context-fabric .

# First run will recreate default config
```

---

## Still Having Issues?

We're genuinely sorry you're having trouble. Let's get this sorted:

1. **Check the logs** with `LOG_LEVEL=debug`
2. **Test with echo commands** to isolate CLI vs server issues
3. **Try Docker** if local Node.js is problematic (or vice versa)
4. **Check [GitHub Issues](https://github.com/Abaddollyon/context-fabric/issues)** for known problems
5. **File a new issue** with:
   - Context Fabric version (`cat package.json | grep version`)
   - Node.js version (`node --version`)
   - CLI and version
   - Debug logs (with `LOG_LEVEL=debug`)
   - Steps to reproduce

Every issue you report helps make Context Fabric better for everyone. Don't hesitate to reach out.

---

[← Back to Documentation](../README.md#documentation)
