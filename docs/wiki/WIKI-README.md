# Context Fabric Wiki

This is the GitHub wiki for [Context Fabric](https://github.com/Abaddollyon/context-fabric) — persistent memory for AI coding agents.

## Pages Overview

| Page | Purpose | Lines |
|------|---------|-------|
| [Home](Home) | Landing page with features, quick start, real-world examples | 193 |
| [Getting-Started](Getting-Started) | Installation (Docker & local), first run, verification | 507 |
| [CLI-Setup](CLI-Setup) | Configuration for all 7 supported CLI tools | 436 |
| [Tools-Reference](Tools-Reference) | All 16 MCP tools with parameters and examples | 588 |
| [Memory-Types](Memory-Types) | Three-layer architecture with Mermaid diagrams | 457 |
| [Configuration](Configuration) | Config file reference, env vars, storage paths | 317 |
| [Architecture](Architecture) | System internals, data flow, performance | 994 |
| [Agent-Integration](Agent-Integration) | System prompt instructions for CLIs | 367 |
| [FAQ](FAQ) | Frequently asked questions with real scenarios | 492 |
| [Troubleshooting](Troubleshooting) | Common issues with empathy and solutions | 853 |
| [_Sidebar](_Sidebar) | Wiki navigation | 26 |
| [_Footer](_Footer) | Consistent footer with branding | 16 |

**Total: 5,246 lines of documentation**

## Design Features

- **Mermaid diagrams** for architecture and flowcharts
- **GitHub alert syntax** (`[!NOTE]`, `[!TIP]`, `[!WARNING]`)
- **Collapsible sections** for detailed content
- **Consistent emoji usage** throughout
- **Warm, conversational tone** (senior engineer voice)
- **Real-world examples** and user scenarios
- **Celebration moments** for successful setup

## Publishing

To publish this wiki to GitHub:

1. Enable Wiki in repository settings:
   - Go to https://github.com/Abaddollyon/context-fabric/settings
   - Check "Wikis" under Features

2. Push the wiki:
   ```bash
   cd /home/arro/coding/kimi/context-fabric/wiki
   git push -u origin main
   ```

3. Access at: https://github.com/Abaddollyon/context-fabric/wiki

## Local Preview

To preview the wiki locally:

```bash
# Using grip (GitHub markdown preview)
grip Home.md 0.0.0.0:6419

# Or using a simple HTTP server
python3 -m http.server 8000
```

## Updating the Wiki

After making changes:

```bash
cd /home/arro/coding/kimi/context-fabric/wiki
git add -A
git commit -m "Update wiki: description of changes"
git push
```
