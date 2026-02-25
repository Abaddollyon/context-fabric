# 🧠 Context Fabric

**Persistent memory for AI coding agents.**

Context Fabric is an [MCP server](https://modelcontextprotocol.io/) that gives your AI agent memory across sessions, projects, and tools. No more re-explaining your codebase every time you start a new session.

> [!NOTE]
> **Beta Software.** Context Fabric is actively used and works well, but APIs and storage formats may change. Pin your version and check the [CHANGELOG](https://github.com/Abaddollyon/context-fabric/blob/main/CHANGELOG.md) before upgrading.

---

## 📚 Wiki Navigation

| Section | Description |
|---------|-------------|
| [Getting Started](Getting-Started) | Installation, first run, Docker and local setup |
| [CLI Setup](CLI-Setup) | Configuration for all 7 supported CLIs (Claude Code, Kimi, Cursor, etc.) |
| [Tools Reference](Tools-Reference) | All 16 MCP tools with full parameter documentation |
| [Memory Types](Memory-Types) | Three-layer memory system, smart routing, and decay |
| [Configuration](Configuration) | Storage paths, TTL, embedding options, environment variables |
| [Agent Integration](Agent-Integration) | System prompt instructions for automatic tool usage |
| [Architecture](Architecture) | System internals, data flow, embedding strategy |

---

## ✨ Key Features

### 🏗️ Three-Layer Memory System
Memories auto-route to the right layer based on content and scope:

| Layer | Name | Scope | Use Case |
|-------|------|-------|----------|
| **L1** | Working Memory | Session | Scratchpad notes, temporary context |
| **L2** | Project Memory | Project | Decisions, bug fixes, project-specific knowledge |
| **L3** | Semantic Memory | Global | Code patterns, conventions, reusable knowledge |

### 🔍 Semantic Search
Search by meaning using in-process vector embeddings. No API keys needed.

```json
// Store a decision
{ "type": "decision", "content": "Use Zod for all API validation" }

// Recall with natural language
{ "query": "how do we validate inputs?" }
// => Finds the decision even with different wording
```

### 🕐 Time-Aware Orientation
Your AI knows what happened while you were away:

```
It is 9:15 AM on Wednesday, Feb 25 (America/New_York).
Project: /home/user/myapp.
Last session: 14 hours ago. 3 new memories added while you were offline.
```

### 💻 Local Code Indexing
Scans source files, extracts symbols (functions/classes/types), and stays up-to-date via file watching. Search by text, symbol name, or semantic similarity.

### 👻 Ghost Messages
Relevant memories surface silently without cluttering the conversation. Important context appears when you need it.

**Here's how Ghost Messages work in practice:**

Imagine you stored this decision last week:
```
"Use bcrypt with cost factor 12 for password hashing.
Do NOT use MD5 or SHA1 — they're too fast for passwords."
```

Today, you ask your AI:
> "Add password hashing to the user registration endpoint"

Before your AI responds, Context Fabric silently injects the bcrypt decision as a Ghost Message. Your AI sees it in the system context and knows exactly what to do — no need for you to remember or repeat yourself.

The Ghost Message appears in the AI's context but not in your chat history. It's like having a teammate who whispers helpful reminders at just the right moment.

### 🔮 Pattern Detection
Auto-captures and reuses code patterns across projects. Build up a library of solutions that follow you everywhere.

---

## 🚀 Quick Start

Get running in 3 steps:

### 1. Clone and Build

```bash
git clone https://github.com/Abaddollyon/context-fabric.git
cd context-fabric
docker build -t context-fabric .
```

### 2. Test It Works

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  | docker run --rm -i context-fabric
```

### 3. Add to Your CLI

Use this Docker transport in your MCP config:

```bash
docker run --rm -i -v context-fabric-data:/data/.context-fabric context-fabric
```

See [CLI Setup](CLI-Setup) for copy-paste configs for all supported CLIs.

> 💡 **Tip:** Once Context Fabric is running in one CLI, you can ask your AI to install it into others automatically. Just say:
> 
> "Install and configure Context Fabric for Cursor using Docker"

---

## 🌍 Real World Example

Let's see Context Fabric in action with a typical development day.

### Morning: Starting a New Feature

**You:** "Let's add OAuth with Google to the auth module"

**Context Fabric steps in:**
```
👻 Ghost Message: "We use Passport.js for authentication, 
   configured in /src/auth/passport.ts. Google OAuth credentials 
   are in .env.local (not committed)."
```

Your AI immediately knows the existing auth pattern and where things live. No need to dig through files.

### Midday: Hitting a Snag

**You:** "The OAuth callback is failing with 'redirect_uri_mismatch'"

After 20 minutes of debugging, you discover the issue: the Google Cloud Console has a trailing slash in the callback URL, but your code doesn't.

**You:** "Remember: Google OAuth callback URLs must match exactly, 
including trailing slashes. The console has the slash, so our code needs it too."

Context Fabric stores this as an L2 (Project) memory.

### Next Week: Different Project, Same Problem

**You:** "Setting up OAuth for the admin dashboard"

**Context Fabric:**
```
👻 Ghost Message (L3 - Pattern): "OAuth callback URLs must match 
   provider settings exactly, including trailing slashes."
```

Your AI knows this pattern from the previous project and gets it right the first time.

### A Month Later: Returning to the First Project

**You:** (opens terminal)

**Your AI automatically calls `context.orient`:**
```
It is 9:30 AM on Monday, March 30, 2026 (America/New_York).
Project: /home/user/myapp.
Last session: 3 weeks 2 days ago (since March 6).
4 new memories were added while you were offline.

👻 Ghost Message: "OAuth is implemented but refresh tokens are 
   not being stored. See TODO in /src/auth/oauth.ts line 42."
```

You immediately know where you left off. That TODO you wrote weeks ago? Context Fabric remembered, even though you forgot.

---

## 🔗 Quick Links

- [📦 Main Repository](https://github.com/Abaddollyon/context-fabric)
- [📝 CHANGELOG](https://github.com/Abaddollyon/context-fabric/blob/main/CHANGELOG.md)
- [🐛 Report Issues](https://github.com/Abaddollyon/context-fabric/issues)
- [🤝 Contributing](https://github.com/Abaddollyon/context-fabric/blob/main/CONTRIBUTING.md)

---

<div align="center">

**Stop re-explaining your codebase every session.**

[Get Started →](Getting-Started)

</div>
