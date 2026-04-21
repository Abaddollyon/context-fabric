# Skills

Skills are **procedural memory** — reusable instruction blocks that agents *invoke* rather than *recall*. Added in v0.12, they are the Context Fabric equivalent of Anthropic's Skills / `SKILL.md` pattern: a named, slug-addressed recipe the agent can pull up on demand.

## Table of Contents

- [Recall vs Invoke](#recall-vs-invoke)
- [Skill Shape](#skill-shape)
- [When to use a skill](#when-to-use-a-skill)
- [Slug rules](#slug-rules)
- [The six skill tools](#the-six-skill-tools)
- [End-to-end examples](#end-to-end-examples)
- [Integration: Resources and Prompts](#integration-resources-and-prompts)
- [Best practices](#best-practices)

---

## Recall vs Invoke

Context Fabric already has two ways to reach prior knowledge:

| Mechanism | Trigger | What you get back |
|-----------|---------|-------------------|
| `context.recall` | Free-text query | Ranked list of matching memories (hybrid search) |
| `context.get` | Memory ID | A single memory |
| **`context.skill.invoke`** | Slug | A deterministic instruction block, always the same for a given slug |

Skills are for the cases where you want **exact, deterministic, reusable procedure**. Not "what did we decide about auth?" but "run our PR review checklist." Not "search memory for migration notes" but "execute the run-migration skill with `db=users`."

> [!TIP]
> If an agent would benefit from following the *same* written instructions every time, make it a skill. If the agent needs to surface the *most relevant* of many similar past notes, use `context.recall`.

---

## Skill Shape

Every skill is stored at L2 with `MemoryType='skill'` and a structured `metadata.skill` block:

| Field | Type | Description |
|-------|------|-------------|
| `slug` | string | Unique kebab-case identifier (primary key) |
| `name` | string | Human-readable title, 1–120 chars |
| `description` | string | One-line purpose shown in listings, 1–500 chars |
| `triggers` | string[] | Optional natural-language phrases that should prompt the agent to reach for this skill |
| `parameters` | `{ name, description?, required? }[]` | Declared inputs the skill expects on invoke |
| `instructions` | string | The body — what the agent should do when invoked. Lives in `Memory.content` |
| `version` | number | Bumps when `name`, `description`, or `instructions` change |
| `invocationCount` | number | Atomically bumped by `context.skill.invoke` |
| `lastInvokedAt` | number \| null | Epoch ms of the last invoke call |

Skills are always **pinned** — they are exempt from decay and summarization. They live for as long as you keep them.

---

## When to use a skill

Skills are not a replacement for the other memory types. Use them alongside, not instead of:

| You want to capture... | Use type... | Why |
|------------------------|-------------|-----|
| A one-time bug fix and its root cause | `bug_fix` | It's a fact about history, not a procedure. Best retrieved via `context.recall` when a similar error recurs |
| An architectural decision and its rationale | `decision` | Same reason: historical fact, surfaced by relevance |
| A reusable code pattern | `code_pattern` | Retrieved when the agent is solving a similar problem, not when it's following a checklist |
| A house-rule or style convention | `convention` | Loaded en masse via `memory://conventions` at session start |
| **"Write a commit message following our format"** | **`skill`** | Exact, repeatable procedure — always executed the same way |
| **"Run the release checklist"** | **`skill`** | Multi-step workflow with precise order and expected inputs |
| **"Review a PR"** | **`skill`** | Consistent review criteria, not best-match retrieval |

---

## Slug rules

Slugs are the primary key for skills. They must be:

- **kebab-case**: lowercase letters, digits, and hyphens only
- **1–64 characters**
- **start with `[a-z0-9]`** (no leading hyphen)
- **unique per project** (two skills can't share a slug within the same L2 store)

Regex: `/^[a-z0-9][a-z0-9-]*$/`

Good: `commit-message`, `review-pr`, `run-migration`, `release-checklist`, `publish-v2`
Bad: `-commit`, `Commit_Message`, `UPPERCASE`, `has spaces`, `over-64-chars-so-long-it-loops-around-...`

Violations throw `Invalid skill slug "<slug>". Must be lowercase kebab-case, 1–64 chars, start with [a-z0-9], only contain [a-z0-9-].` at create time.

---

## The six skill tools

### `context.skill.create`

Register a new skill. Throws if a skill with the same slug already exists.

```json
{
  "slug": "review-pr",
  "name": "Review a pull request",
  "description": "Walk through our standard PR review checklist.",
  "triggers": ["pr", "review", "review pr", "code review"],
  "parameters": [
    { "name": "prUrl", "description": "GitHub PR URL", "required": true }
  ],
  "instructions": "1. Read the PR description and linked issue.\n2. Check out the branch locally.\n3. Run `npm test` and `npm run lint`.\n4. Review changed files for: test coverage, naming, error handling, comments.\n5. Leave a review with Approve / Request Changes / Comment.",
  "tags": ["dev", "workflow"]
}
```

Response:

```json
{
  "id": "<uuid>",
  "slug": "review-pr",
  "name": "Review a pull request",
  "description": "Walk through our standard PR review checklist.",
  "version": 1
}
```

### `context.skill.list`

List every skill with display and operational fields. Sorted most-recently-invoked first, then alphabetically.

```json
{}
```

Response:

```json
{
  "skills": [
    {
      "id": "<uuid>",
      "slug": "review-pr",
      "name": "Review a pull request",
      "description": "Walk through our standard PR review checklist.",
      "version": 1,
      "invocationCount": 12,
      "lastInvokedAt": 1745200000000,
      "triggers": ["pr", "review"]
    }
  ],
  "count": 1
}
```

### `context.skill.get`

Read a skill (including full instructions) **without** bumping the invocation counter. Use this to inspect or preview.

```json
{ "slug": "review-pr" }
```

Response: the full skill including `instructions`, `parameters`, `triggers`, and `version`.

### `context.skill.invoke`

Fetch a skill's instructions and **atomically bump `invocationCount` and `lastInvokedAt`**. This is how the agent signals "I am about to follow this skill" — it's what makes `list()` surface frequently-used skills first.

```json
{ "slug": "review-pr" }
```

Response:

```json
{
  "slug": "review-pr",
  "name": "Review a pull request",
  "description": "Walk through our standard PR review checklist.",
  "instructions": "1. Read the PR description ...",
  "parameters": [
    { "name": "prUrl", "required": true, "description": "GitHub PR URL" }
  ],
  "version": 1,
  "invocationCount": 13,
  "lastInvokedAt": 1745200123456
}
```

> [!NOTE]
> `invoke` is the *only* tool that mutates `invocationCount` / `lastInvokedAt`. Reading via `get`, `list`, or the `memory://skill/{slug}` resource is cost-free.

### `context.skill.update`

Partial update. At least one of `name`, `description`, `instructions`, `triggers`, `parameters` must be provided. If `name`, `description`, or `instructions` changes, `version` bumps.

```json
{
  "slug": "review-pr",
  "instructions": "1. Read the PR description and linked issue.\n2. Check out the branch locally and run `npm ci`.\n3. Run `npm test`, `npm run lint`, and `npm run typecheck`.\n4. ..."
}
```

### `context.skill.delete`

```json
{ "slug": "review-pr" }
```

Response:

```json
{ "deleted": true, "slug": "review-pr" }
```

Returns `{ deleted: false }` if no skill with that slug existed.

---

## End-to-end examples

### Example 1: `review-pr` — triggered by `"pr"` or `"review"`

Create it:

```json
{
  "slug": "review-pr",
  "name": "Review a pull request",
  "description": "Standard PR review checklist for this project.",
  "triggers": ["pr", "review", "review pr"],
  "parameters": [
    { "name": "prUrl", "description": "GitHub PR URL", "required": true }
  ],
  "instructions": "Given {prUrl}:\n\n1. Fetch the PR body + diff.\n2. Run `npm test` locally on the branch.\n3. Look for: missing tests, unclear names, unhandled errors, dead code.\n4. Post a review: Approve if all green and scope is tight; Request Changes otherwise.\n5. If approved, squash-merge and tag the author in Slack."
}
```

Agent invocation (when the user says "review this PR https://github.com/org/repo/pull/42"):

```json
{ "slug": "review-pr" }
```

The agent reads the returned `instructions`, sees `prUrl` is a required parameter, substitutes the URL, and executes.

### Example 2: `run-migration` — parameterized

```json
{
  "slug": "run-migration",
  "name": "Run a database migration",
  "description": "Apply a pending migration file to the target database.",
  "triggers": ["migration", "migrate", "run migration"],
  "parameters": [
    { "name": "db", "description": "Which database: users, billing, analytics", "required": true },
    { "name": "direction", "description": "up (default) or down" }
  ],
  "instructions": "1. Take a snapshot of {db} (VACUUM INTO a dated file).\n2. Run `npx knex migrate:latest --env {db}` for direction=up, or `--rollback` for down.\n3. Verify with a smoke-test query: `SELECT COUNT(*) FROM schema_migrations`.\n4. On failure, restore from the snapshot and open an incident note via `context.store` with type=\"bug_fix\"."
}
```

Invocation:

```json
{ "slug": "run-migration" }
```

The agent reads the returned `instructions` plus the `parameters` declaration, asks the user for `db` (required) and `direction` (optional), then executes.

---

## Integration: Resources and Prompts

Skills are first-class across all three MCP primitives — see [MCP Primitives](mcp-primitives.md) for the full catalog.

### Resources

| URI | Content |
|-----|---------|
| `memory://skills` | JSON: every skill with slug, name, description, triggers, `invocationCount`, `lastInvokedAt` |
| `memory://skill/{slug}` | Markdown: a single skill rendered as name + description + triggers + parameters + instructions body |

The per-skill resource is handy in MCP-aware clients (Claude Desktop, Claude Code) — the user can browse skills from the resource panel and drop them into context by name.

### Prompts

The `cf-invoke-skill` prompt wraps `context.skill.invoke` as a user-facing slash-command:

```
/cf-invoke-skill slug=run-migration
```

Expands to a user message that instructs the agent to call `context.skill.invoke` with the given slug, then ask the user for any required parameters before proceeding. Use this when you want the user (not the agent) to initiate skill execution.

---

## Best practices

- **Keep instructions short (<2 KB).** Skills are inlined into the model's context every time they're invoked. A 10-page procedure belongs in a doc that the skill *references*, not in the skill body itself.
- **Be precise with triggers.** Triggers aren't used for automatic invocation in the current runtime — they're hints for the agent and for future trigger-matching. But choose phrases that actually disambiguate (`["pr"]` is too broad; `["review pr", "code review"]` is better).
- **Use `parameters` over string templating.** Declaring `parameters` lets the agent and `cf-invoke-skill` prompt request them cleanly. Hard-coding a `{db}` placeholder in `instructions` without a matching `parameters` entry makes the agent guess.
- **Version intentionally.** If you change wording but mean the same thing, keep it. If you change *behavior*, the auto-bumped `version` is visible in `list()` — useful when reviewing what changed.
- **Delete stale skills.** Unlike other memory types, skills don't decay. An outdated skill will keep getting invoked. `context.skill.delete` is cheap.
- **Start with three.** Most projects converge on a small stable set (orient, review-pr, ship-a-release). Resist the urge to turn every recurring prompt into a skill before you've invoked it at least twice manually.

---

[← Tools Reference](tools-reference.md) | [MCP Primitives →](mcp-primitives.md) | [Back to README](../README.md)
