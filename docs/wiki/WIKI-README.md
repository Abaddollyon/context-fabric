# Context Fabric Wiki

This directory contains the GitHub Wiki source for [Context Fabric](https://github.com/Abaddollyon/context-fabric).

The wiki is intended to be the **launch-friendly overview and onboarding layer**:
- fast orientation
- setup guidance
- FAQ and troubleshooting
- skimmable entry points into the deeper repo docs

The canonical deep technical documentation remains in `docs/` and the main repository `README.md`.

## Recommended page roles

| Page | Role |
|------|------|
| [Home](Home.md) | concise landing page for first impressions |
| [Getting-Started](Getting-Started.md) | fastest path to a working install |
| [CLI-Setup](CLI-Setup.md) | client setup matrix and post-install checks |
| [Tools-Reference](Tools-Reference.md) | high-level feature surface and learning order |
| [Memory-Types](Memory-Types.md) | memory model and routing |
| [Configuration](Configuration.md) | runtime and storage settings |
| [Agent-Integration](Agent-Integration.md) | prompt/system-integration guidance |
| [Architecture](Architecture.md) | internals and retrieval pipeline |
| [FAQ](FAQ.md) | common questions and product framing |
| [Troubleshooting](Troubleshooting.md) | setup recovery and debugging help |

## Publishing checklist

1. Enable Wiki in repository settings
2. Push the actual GitHub wiki repository contents
3. Verify that `Home.md`, `_Sidebar.md`, and key setup pages render correctly
4. Spot-check internal wiki links and repo-doc links after publishing

## Local preview

```bash
# Using grip
grip Home.md 0.0.0.0:6419

# Or a basic file preview server
python3 -m http.server 8000
```

## Maintenance rule

When launch-facing copy changes materially, keep these surfaces aligned:
- `README.md`
- `wiki/`
- `docs/wiki/`
