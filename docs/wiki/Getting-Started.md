# Getting Started

This page is the fastest path from clone to a working Context Fabric server.

For the full canonical setup guide, see:
- [docs/getting-started.md](https://github.com/Abaddollyon/context-fabric/blob/main/docs/getting-started.md)
- [docs/cli-setup.md](https://github.com/Abaddollyon/context-fabric/blob/main/docs/cli-setup.md)

---

## Prerequisites

Use either:

| Option | Requirement | Notes |
|------|-------------|-------|
| **Docker** | Docker Engine | recommended for most users |
| **Local** | Node.js 22.5+ | required for `node:sqlite` |

---

## Recommended install: Docker

```bash
git clone https://github.com/Abaddollyon/context-fabric.git
cd context-fabric
docker build -t context-fabric .
```

Verify the server responds:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  | docker run --rm -i context-fabric
```

You should get a JSON response listing **25 MCP tools**.

Run it with persistent storage:

```bash
docker run --rm -i \
  -v context-fabric-data:/data/.context-fabric \
  context-fabric
```

---

## Local install

```bash
git clone https://github.com/Abaddollyon/context-fabric.git
cd context-fabric
npm install
npm run build
```

Verify locally:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  | node dist/server.js
```

---

## First thing to do after install

Once Context Fabric is connected to a CLI, ask the agent to orient itself. A typical response includes:

```text
It is 9:15 AM on Wednesday, Feb 25 (America/New_York).
Project: /home/user/myapp.
Last session: 14 hours ago. 3 new memories were added while you were away.
```

That is the baseline value proposition: the agent starts with context instead of amnesia.

---

## Next steps

1. Configure a client in [CLI Setup](CLI-Setup.md)
2. Learn the main workflows in [Tools Reference](Tools-Reference.md)
3. Understand storage and routing in [Memory Types](Memory-Types.md)
4. Use [Troubleshooting](Troubleshooting.md) if the server does not appear in your client

---

## Canonical deep docs

- [Full Getting Started guide](https://github.com/Abaddollyon/context-fabric/blob/main/docs/getting-started.md)
- [Full CLI setup guide](https://github.com/Abaddollyon/context-fabric/blob/main/docs/cli-setup.md)
