# Tools Reference

Context Fabric exposes **25 MCP tools** across memory, search, setup, observability, import/export, and procedural-skill workflows.

For the full parameter-level reference, use the canonical repo doc:
- [docs/tools-reference.md](https://github.com/Abaddollyon/context-fabric/blob/main/docs/tools-reference.md)

---

## The tools most users feel first

| Tool | Why it matters |
|------|----------------|
| `context.orient` | tells the agent where it is in time and project history |
| `context.store` | saves decisions, bug fixes, conventions, and patterns |
| `context.recall` | retrieves relevant memories by meaning and text |
| `context.searchCode` | searches indexed code by text, symbol, or semantic meaning |
| `context.getCurrent` | assembles a richer context window including ghost messages |
| `context.setup` | installs Context Fabric into supported CLIs |

---

## Tool categories

### Core memory tools
- `context.getCurrent`
- `context.store`
- `context.recall`
- `context.storeBatch`

### Orientation and code tools
- `context.orient`
- `context.searchCode`

### CRUD tools
- `context.get`
- `context.update`
- `context.delete`
- `context.list`

### Management and import/export
- `context.summarize`
- `context.reportEvent`
- `context.importDocs`
- `context.backup`
- `context.export`
- `context.import`

### Observability and setup
- `context.metrics`
- `context.health`
- `context.setup`

### Skill tools
- `context.skill.create`
- `context.skill.list`
- `context.skill.get`
- `context.skill.invoke`
- `context.skill.update`
- `context.skill.delete`

---

## Related MCP primitives

Context Fabric also exposes:

- **5 MCP Prompts** such as `cf-orient` and `cf-search-code`
- **6 resource views/templates** under `memory://...`

Those are documented here:
- [docs/mcp-primitives.md](https://github.com/Abaddollyon/context-fabric/blob/main/docs/mcp-primitives.md)

---

## Recommended learning order

1. Learn `context.orient`
2. Learn `context.store` and `context.recall`
3. Learn `context.searchCode`
4. Learn `context.getCurrent`
5. Use the skill and docs-import tools once the basics are working

---

## Canonical deep docs

- [Full tools reference](https://github.com/Abaddollyon/context-fabric/blob/main/docs/tools-reference.md)
- [Memory types and routing](https://github.com/Abaddollyon/context-fabric/blob/main/docs/memory-types.md)
- [MCP primitives](https://github.com/Abaddollyon/context-fabric/blob/main/docs/mcp-primitives.md)
