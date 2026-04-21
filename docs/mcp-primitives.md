# MCP Primitives: Resources and Prompts

The [Model Context Protocol](https://modelcontextprotocol.io/) defines three primitives that a server can expose to a client:

| Primitive | Who initiates | Typical use |
|-----------|---------------|-------------|
| **Tools** | The LLM | Actions with side effects or computed data (`context.store`, `context.recall`, …) |
| **Resources** | The client or user | Browseable read-only URIs (reference material, previews) |
| **Prompts** | The user | Templated slash-commands the user inserts into the conversation |

Context Fabric exposes **all three**. This page covers Resources and Prompts. For Tools, see [Tools Reference](tools-reference.md).

## Table of Contents

- [Resources](#resources)
  - [`memory://skills`](#memoryskills)
  - [`memory://skill/{slug}`](#memoryskillslug)
  - [`memory://memory/{id}`](#memorymemoryid)
  - [`memory://recent`](#memoryrecent)
  - [`memory://conventions`](#memoryconventions)
  - [`memory://decisions`](#memorydecisions)
  - [Resource dispatch table](#resource-dispatch-table)
- [Prompts](#prompts)
  - [`cf-orient`](#cf-orient)
  - [`cf-capture-decision`](#cf-capture-decision)
  - [`cf-review-session`](#cf-review-session)
  - [`cf-search-code`](#cf-search-code)
  - [`cf-invoke-skill`](#cf-invoke-skill)
- [Client compatibility matrix (April 2026)](#client-compatibility-matrix-april-2026)
- [When to use what](#when-to-use-what)

---

## Resources

Resources live under the `memory://` scheme. Context Fabric registers both **concrete resources** (fixed URIs like `memory://recent`) and **templates** (URI patterns like `memory://skill/{slug}`). Clients that support Resource discovery see the full list via `resources/list`; templates are returned via `resources/templates/list`.

All JSON responses are pretty-printed with 2-space indent. All Markdown responses use `text/markdown` as the MIME type.

### `memory://skills`

All skills registered on the current project.

**MIME type:** `application/json`

**Response shape:**

```json
{
  "skills": [
    {
      "id": "<uuid>",
      "slug": "review-pr",
      "name": "Review a pull request",
      "description": "Standard PR review checklist.",
      "version": 1,
      "invocationCount": 12,
      "lastInvokedAt": 1745200000000,
      "triggers": ["pr", "review"]
    }
  ],
  "count": 1
}
```

Sorted most-recently-invoked first, then alphabetically by slug.

### `memory://skill/{slug}`

A single skill rendered as Markdown. Reading this URI **does not** bump `invocationCount` — use the `context.skill.invoke` tool for that.

**MIME type:** `text/markdown`

**Response template:**

```markdown
# <skill name>

_<description>_

**Triggers:** `<trigger1>`, `<trigger2>`

**Parameters:**
- `<paramName>` *(required)* — <description>

## Instructions

<full instructions body>
```

Returns `UNKNOWN_RESOURCE` if the slug doesn't exist or doesn't match the slug regex.

### `memory://memory/{id}`

Read any memory by its UUID across L1/L2/L3. The `{id}` must match a 36-char UUID.

**MIME type:** `application/json`

**Response shape:**

```json
{
  "memory": { "id": "...", "type": "decision", "content": "...", "metadata": {...}, "tags": [...], "createdAt": 1745000000000, "updatedAt": 1745000000000 },
  "layer": 2
}
```

### `memory://recent`

The 20 most recently updated L2 memories. Useful for agent session-start orientation without calling `context.list`.

**MIME type:** `application/json`

**Response shape:** same as `context.list` output — `{ memories, total, limit, offset, layer }`.

### `memory://conventions`

Up to 100 L2 memories of `type='convention'`. This is where `CLAUDE.md` / `AGENTS.md` content lands after `context.importDocs`, and where manually-stored house rules live.

**MIME type:** `application/json`

### `memory://decisions`

Up to 100 L2 memories of `type='decision'`. Architectural and product choices with rationale.

**MIME type:** `application/json`

### Resource dispatch table

| URI pattern | Handler | Source (server.ts) |
|-------------|---------|--------------------|
| `memory://skills` | `engine.skills.list()` | `ReadResourceRequestSchema` handler, `memory://skills` branch |
| `memory://skill/{slug}` | `engine.skills.getBySlug(slug)`, rendered as Markdown | `skillMatch` regex branch |
| `memory://memory/{id}` | `engine.getMemory(id)` | `memMatch` regex branch |
| `memory://recent` | `engine.listMemories({ layer: 2, limit: 20 })` | `memory://recent` branch |
| `memory://conventions` | `engine.listMemories({ layer: 2, type: 'convention', limit: 100 })` | `memory://conventions` branch |
| `memory://decisions` | `engine.listMemories({ layer: 2, type: 'decision', limit: 100 })` | `memory://decisions` branch |

### Example client snippet

Pseudocode mirroring `@modelcontextprotocol/sdk/client`:

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

const client = new Client({ name: "my-agent", version: "1.0" }, { capabilities: {} });
await client.connect(transport);

// Discover resources.
const { resources } = await client.listResources();
console.log(resources.map(r => r.uri));
// → ["memory://skills", "memory://recent", "memory://conventions", "memory://decisions", "memory://skill/review-pr", ...]

// Read one.
const conventions = await client.readResource({ uri: "memory://conventions" });
const json = JSON.parse(conventions.contents[0].text);
```

> [!TIP]
> Project `CONTEXT_FABRIC_DEFAULT_PROJECT` so Resource reads (which take no `projectPath` argument) use the correct engine. Without it, the server falls back to the process `cwd`.

---

## Prompts

Prompts are user-initiated templates. Clients that support the Prompts primitive show them in a palette (often as `/<name>` slash-commands). When the user picks one, the server returns a set of `messages` that the client injects into the conversation.

Each prompt below shows its **expanded template text** exactly as returned from `src/server.ts`'s `GetPromptRequestSchema` handler.

### `cf-orient`

**Description:** Get oriented for a new session: summarize what happened since last time, surface open threads and recent decisions.

**Arguments:** none

**Expanded template (single user message):**

```text
Call the `context.orient` tool now. Then:
1. Summarize the gap since last session (hours/days, what changed).
2. List the top 3 open threads or TODOs surfaced.
3. List the most recent architectural decisions.
Finish with: "Ready. What are we doing today?"
```

Invocation: `/cf-orient`

### `cf-capture-decision`

**Description:** Walk the agent through capturing an architectural/product decision with rationale and alternatives into L2.

**Arguments:**

| Name | Required | Description |
|------|:--------:|-------------|
| `topic` | yes | Short label for the decision, e.g. `"auth backend"` |

**Expanded template:**

```text
Capture a decision about: **{topic}**.

Walk me through:
1. What are we deciding?
2. What options did we consider?
3. Which option did we pick and why?
4. What are the trade-offs / what are we giving up?
5. Are there reversibility / migration concerns?

When I confirm, call `context.store` with type="decision", a clear title, and store it in L2 with tags including "decision" and "{topic-slugified}".
```

`{topic-slugified}` is the lowercased topic with whitespace replaced by hyphens.

Invocation: `/cf-capture-decision topic="auth backend"`

### `cf-review-session`

**Description:** Review the current session: list what was attempted, what succeeded, and propose memories to store.

**Arguments:** none

**Expanded template:**

```text
Review the work we did in this session.
1. What did we attempt?
2. What actually succeeded (tests passing, code shipped, decisions made)?
3. What is still open / blocked?
Then propose up to 5 memories to persist via `context.store` or `context.storeBatch`. Ask me to confirm before writing.
```

Invocation: `/cf-review-session`

### `cf-search-code`

**Description:** Hybrid code search prompt — chooses the right mode (text / symbol / semantic) for the query.

**Arguments:**

| Name | Required | Description |
|------|:--------:|-------------|
| `query` | yes | What to search for |

**Expanded template:**

```text
Search the code index for: **{query}**.

Pick the best `context.searchCode` mode:
- `symbol` if the query looks like an identifier or `Class.method`.
- `text` if the query contains quotes or obvious literal tokens.
- `semantic` for anything conceptual.

Return: top 5 hits with file:line and a one-line summary of each. If the index is stale, say so.
```

Invocation: `/cf-search-code query="cosine similarity"`

### `cf-invoke-skill`

**Description:** Invoke a named skill by slug, listing any required parameters.

**Arguments:**

| Name | Required | Description |
|------|:--------:|-------------|
| `slug` | yes | Skill slug (see `context.skill.list`) |

**Expanded template:**

```text
Call `context.skill.invoke` with slug="{slug}".
Read the returned instructions carefully, list any required parameters, and ask me to provide them before proceeding.
```

Invocation: `/cf-invoke-skill slug="run-migration"`

---

## Client compatibility matrix (April 2026)

Reality is messier than the MCP spec. As of April 2026, client support for the three primitives varies:

| Client | Tools | Resources | Prompts | Notes |
|--------|:-----:|:---------:|:-------:|-------|
| **Claude Desktop** | Full | Full | Full | Reference client. Prompts surface as `/<name>`. Resources in the paperclip menu |
| **Claude Code** | Full | Full | Full | Prompts usable from the slash-menu |
| **Continue** | Full | Full | Full | All three primitives implemented |
| **Cursor** | Full | Partial | None | Tools work; Resources list but are not browseable in UI; no Prompts UI yet |
| **Codex CLI** | Full | None | None | Tools-only |
| **OpenCode** | Full | None | None | Tools-only |
| **Kimi** | Full | None | None | Tools-only |
| **Gemini CLI** | Full | None | None | Tools-only |

When a client doesn't implement Prompts or Resources, the equivalent Tools still work — a `cf-orient` prompt is just a wrapper around `context.orient`, and `memory://conventions` is a wrapper around `context.list({ layer: 2, type: 'convention' })`. You lose the UX but not the capability.

> [!NOTE]
> This matrix reflects April 2026 shipping behavior. Support for Resources and Prompts is being added incrementally across clients — check the client's release notes for the most current story.

---

## When to use what

Rough decision guide for picking the right primitive when you're designing a workflow:

| You want to... | Use... | Why |
|----------------|--------|-----|
| Let the LLM fetch or compute something mid-turn | **Tool** | LLM-initiated, can have side effects |
| Give the LLM browseable, stable, read-only reference data | **Resource** | Zero round-trip from the LLM's POV — the client can prefetch and inject |
| Offer the *user* a one-click canonical workflow | **Prompt** | User-initiated; guarantees consistent agent behavior |
| Package a deterministic procedure the LLM can invoke by name | **Tool + Skill** | `context.skill.invoke` is a Tool; skills are data |
| Expose something to MCP clients without UI support | **Tool** | Every client implements Tools |

### Worked example

You want the agent to follow a release checklist.

- ❌ **Make it a Prompt.** Prompts are user-initiated one-shots, not reusable agent procedures. Hard to version.
- ❌ **Make it a recall-able memory (`type='convention'`).** The agent would have to search for it; no guarantee it finds the right one.
- ✅ **Make it a Skill.** Slug-addressed, versioned, deterministic, invocation-counted. Agent calls `context.skill.invoke` with `slug="release-checklist"` and follows the returned instructions.
- ✅ *Also* **wrap it in the `cf-invoke-skill` prompt** if you want the user to be able to kick it off with `/cf-invoke-skill slug=release-checklist`.

---

[← Skills](skills.md) | [Tools Reference →](tools-reference.md) | [Back to README](../README.md)
