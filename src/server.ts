/**
 * Context Fabric MCP Server
 * 
 * An MCP server that provides semantic memory and context management
 * for agentic CLI tools like Kimi, Claude Code, and Codex.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { initialize, getConfig } from "./config.js";
import { ContextEngine } from "./engine.js";
import { setupForCLI, previewConfig, type SupportedCLI } from "./setup.js";
import { ShutdownController } from "./shutdown.js";
import { toErrorPayload, ToolError } from "./errors.js";
import { VERSION } from "./version.js";
import {
  MemoryLayer,
  MemoryType,
  type CLIEvent,
  type ContextWindow,
} from "./types.js";
import { TimeService } from "./time.js";

// ============================================================================
// Tool Schemas (Zod)
// ============================================================================

/**
 * v0.11: structured citation block. Strict — unknown keys rejected so
 * LLM hallucinations don't quietly slip through into persisted metadata.
 * `capturedAt` is optional here; the engine stamps it at store-time if omitted.
 */
export const ProvenanceSchema = z.object({
  sessionId: z.string().optional(),
  eventId: z.string().optional(),
  toolCallId: z.string().optional(),
  filePath: z.string().optional(),
  lineStart: z.number().int().min(0).optional(),
  lineEnd: z.number().int().min(0).optional(),
  commitSha: z.string().optional(),
  sourceUrl: z.string().url().optional(),
  capturedAt: z.number().int().positive().optional(),
}).strict();

export const StoreMemorySchema = z.object({
  type: z.enum(["code_pattern", "bug_fix", "decision", "convention", "scratchpad", "relationship"]),
  layer: z.number().int().min(1).max(3).optional(),
  content: z.string().min(1),
  metadata: z.object({
    title: z.string().optional(),
    tags: z.array(z.string()).default([]),
    fileContext: z.object({
      path: z.string(),
      lineStart: z.number().optional(),
      lineEnd: z.number().optional(),
      language: z.string().optional(),
    }).optional(),
    codeBlock: z.object({
      code: z.string(),
      language: z.string(),
      filePath: z.string().optional(),
    }).optional(),
    confidence: z.number().min(0).max(1).default(0.8),
    source: z.enum(["user_explicit", "ai_inferred", "system_auto"]).default("ai_inferred"),
    projectPath: z.string().optional(),
    cliType: z.string().default("generic"),
    weight: z.number().int().min(1).max(5).default(3)
      .describe('Priority 1–5 (default 3). 4–5 surfaces above unweighted memories in recall and context window.'),
    // v0.11: optional provenance block — who/where/when this memory came from.
    provenance: ProvenanceSchema.optional()
      .describe('Citation block tying this memory to its source (session, tool call, file, commit, URL).'),
    // v0.11: bi-temporal supersession — id of the L3 memory this one replaces.
    supersedes: z.string().uuid().optional()
      .describe('ID of an existing L3 memory this one supersedes. The predecessor is marked invalid (valid_until = now) and linked in both directions.'),
  }),
  pinned: z.boolean().optional()
    .describe('Pin this memory to protect it from decay and summarization. Pinned memories are never automatically deleted.'),
  ttl: z.number().int().positive().optional(),
}).strict();

export const RecallSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().positive().default(10),
  offset: z.number().int().min(0).default(0)
    .describe('Skip the first N results. Combine with limit for pagination. Default 0.'),
  threshold: z.number().min(0).max(1).default(0.7),
  mode: z.enum(["semantic", "keyword", "hybrid"]).default("hybrid")
    .describe("Search mode: 'semantic' (vector cosine), 'keyword' (FTS5 BM25), or 'hybrid' (RRF fusion of both). Default: hybrid."),
  filter: z.object({
    types: z.array(z.enum(["code_pattern", "bug_fix", "decision", "convention", "scratchpad", "relationship"])).optional(),
    layers: z.array(z.number().int().min(1).max(3)).optional(),
    tags: z.array(z.string()).optional(),
    projectPath: z.string().optional(),
  }).optional(),
  sessionId: z.string().optional(),
  // v0.11: bi-temporal recall controls.
  includeSuperseded: z.boolean().default(false)
    .describe('Include memories that have been explicitly superseded. Default false (only currently-valid memories are returned).'),
  asOf: z.number().int().positive().optional()
    .describe('Epoch ms. Query the state of memory as it existed at this point in time. Overrides the default "hide superseded" behavior with bi-temporal windowing.'),
}).strict();

export const GetCurrentContextSchema = z.object({
  sessionId: z.string().optional(),
  currentFile: z.string().optional(),
  currentCommand: z.string().optional(),
  projectPath: z.string().optional(),
  language: z.string().optional()
    .describe("Filter patterns by language (e.g. 'typescript', 'python')."),
  filePath: z.string().optional()
    .describe("Filter patterns by file path."),
}).strict();

export const SummarizeSchema = z.object({
  sessionId: z.string().optional(),
  layer: z.number().int().min(2).max(3).default(2),
  olderThanDays: z.number().int().positive().default(30),
  // options is accepted but not yet wired into the engine — reserved for future use
  options: z.object({
    targetTokens: z.number().int().positive().optional(),
    focusTypes: z.array(z.enum(["code_pattern", "bug_fix", "decision", "convention", "scratchpad", "relationship"])).optional(),
    includePatterns: z.boolean().default(true),
    includeDecisions: z.boolean().default(true),
  }).optional(),
  projectPath: z.string().optional(),
}).strict();


export const ReportEventSchema = z.object({
  event: z.object({
    type: z.enum([
      "file_opened",
      "command_executed",
      "error_occurred",
      "decision_made",
      "session_start",
      "session_end",
      "pattern_detected",
      "user_feedback",
    ]),
    payload: z.record(z.unknown()),
    timestamp: z.string().transform((s: string) => new Date(s)),
    sessionId: z.string(),
    cliType: z.enum(["kimi", "claude", "claude-code", "opencode", "codex", "gemini", "cursor", "generic"]),
    projectPath: z.string().optional(),
  }),
}).strict();


export const OrientSchema = z.object({
  timezone: z.string().optional(),
  projectPath: z.string().optional(),
  expression: z.string().optional()
    .describe("Optional date expression to resolve: 'now', 'today', 'yesterday', 'tomorrow', 'start of day', 'end of day', 'start of week', 'end of week', 'start of next week', 'next Monday' … 'next Sunday', 'last Monday' … 'last Sunday', an ISO date string, or an epoch-ms number."),
  also: z.array(z.string()).optional()
    .describe("Additional IANA timezone names to show the same moment in (world clock)."),
}).strict();

export const SetupSchema = z.object({
  cli: z.enum(["opencode", "claude", "claude-code", "kimi", "codex", "gemini", "cursor", "docker", "generic"]),
  serverPath: z.string().optional(),
  useDocker: z.boolean().default(false),
  preview: z.boolean().default(false),
}).strict();

export const SearchCodeSchema = z.object({
  query: z.string().min(1),
  mode: z.enum(["text", "symbol", "semantic"]).default("semantic"),
  language: z.string().optional(),
  filePattern: z.string().optional(),
  symbolKind: z.enum(["function", "class", "interface", "type", "enum", "const", "export", "method"]).optional(),
  limit: z.number().int().positive().default(10),
  threshold: z.number().min(0).max(1).default(0.5),
  includeContent: z.boolean().default(true),
  projectPath: z.string().optional(),
}).strict();

export const GetMemorySchema = z.object({
  memoryId: z.string().min(1),
  projectPath: z.string().optional(),
}).strict();

export const UpdateMemorySchema = z.object({
  memoryId: z.string().min(1),
  content: z.string().optional(),
  metadata: z.preprocess(v => typeof v === 'string' ? JSON.parse(v) : v, z.record(z.unknown()).optional()),
  tags: z.array(z.string()).optional(),
  weight: z.number().int().min(1).max(5).optional()
    .describe('Update the memory weight (1–5)'),
  pinned: z.boolean().optional()
    .describe('Pin (true) or unpin (false) this memory. Pinned memories are exempt from decay and summarization.'),
  targetLayer: z.number().int().min(2).max(3).optional()
    .describe('Promote memory to this layer (2=project, 3=semantic). Triggers promote logic: copies to new layer and deletes from old. Cannot be combined with content/metadata/tags/weight/pinned.'),
  projectPath: z.string().optional(),
}).strict().refine(
  (data) => {
    if (data.targetLayer === undefined) return true;
    return data.content === undefined && data.metadata === undefined
      && data.tags === undefined && data.weight === undefined
      && data.pinned === undefined;
  },
  { message: 'targetLayer (promote) cannot be combined with content/metadata/tags/weight/pinned updates. Use separate calls.' }
);

export const DeleteMemorySchema = z.object({
  memoryId: z.string().min(1),
  projectPath: z.string().optional(),
}).strict();

export const ListMemoriesSchema = z.object({
  layer: z.number().int().min(1).max(3).optional(),
  type: z.enum(["code_pattern", "bug_fix", "decision", "convention", "scratchpad", "relationship"]).optional(),
  tags: z.array(z.string()).optional(),
  limit: z.number().int().positive().default(20),
  offset: z.number().int().min(0).default(0),
  stats: z.preprocess(v => typeof v === 'string' ? v === 'true' : v, z.boolean().optional())
    .describe('If true, return memory store summary (counts per layer, pinned counts, L2 breakdown by type) instead of listing memories.'),
  projectPath: z.string().optional(),
}).strict();

export const BackupSchema = z.object({
  destDir: z.string().min(1).describe('Absolute directory path to write backup files into. Created if missing.'),
  projectPath: z.string().optional(),
}).strict();

// v0.9: batch store — reduces MCP round-trips for bulk imports.
// Each item has the same shape as StoreMemorySchema minus the schema wrapper.
const StoreItemSchema = z.object({
  type: z.enum(["code_pattern", "bug_fix", "decision", "convention", "scratchpad", "relationship"]),
  layer: z.number().int().min(1).max(3).optional(),
  content: z.string().min(1),
  metadata: z.object({
    title: z.string().optional(),
    tags: z.array(z.string()).default([]),
    confidence: z.number().min(0).max(1).default(0.8),
    source: z.enum(["user_explicit", "ai_inferred", "system_auto"]).default("ai_inferred"),
    projectPath: z.string().optional(),
    cliType: z.string().default("generic"),
    weight: z.number().int().min(1).max(5).default(3),
    provenance: ProvenanceSchema.optional(),
  }),
  pinned: z.boolean().optional(),
  ttl: z.number().int().positive().optional(),
});

export const StoreBatchSchema = z.object({
  items: z.array(StoreItemSchema).min(1).max(500)
    .describe('Array of memory items to store in one call. Max 500 per batch.'),
  projectPath: z.string().optional()
    .describe('Default projectPath used for items that omit their own metadata.projectPath.'),
}).strict();

export const ExportSchema = z.object({
  destPath: z.string().min(1)
    .describe('Absolute path to the .jsonl file to write. Parent dirs are created.'),
  layers: z.array(z.number().int().min(1).max(3)).optional()
    .describe('Layers to export. Default: [2, 3]. Pass [1,2,3] to include ephemeral L1.'),
  projectPath: z.string().optional(),
}).strict();

export const ImportSchema = z.object({
  srcPath: z.string().min(1)
    .describe('Absolute path to a .jsonl file produced by context.export.'),
  projectPath: z.string().optional(),
}).strict();

export const MetricsSchema = z.object({
  projectPath: z.string().optional(),
  reset: z.boolean().optional().default(false),
}).strict();

export const HealthSchema = z.object({
  projectPath: z.string().optional(),
}).strict();

// v0.12: Skills (procedural memory) schemas.

const SkillParameterSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  required: z.boolean().optional(),
}).strict();

export const SkillCreateSchema = z.object({
  slug: z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9-]{0,63}$/,
    'Skill slug must be kebab-case, 1–64 chars, start with [a-z0-9].'),
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(500),
  instructions: z.string().min(1),
  triggers: z.array(z.string()).optional(),
  parameters: z.array(SkillParameterSchema).optional(),
  tags: z.array(z.string()).optional(),
  projectPath: z.string().optional(),
}).strict();

export const SkillListSchema = z.object({
  projectPath: z.string().optional(),
}).strict();

export const SkillGetSchema = z.object({
  slug: z.string().min(1),
  projectPath: z.string().optional(),
}).strict();

export const SkillInvokeSchema = z.object({
  slug: z.string().min(1),
  projectPath: z.string().optional(),
}).strict();

export const SkillUpdateSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1).max(120).optional(),
  description: z.string().min(1).max(500).optional(),
  instructions: z.string().min(1).optional(),
  triggers: z.array(z.string()).optional(),
  parameters: z.array(SkillParameterSchema).optional(),
  projectPath: z.string().optional(),
}).strict().refine(
  d => d.name !== undefined || d.description !== undefined
    || d.instructions !== undefined || d.triggers !== undefined
    || d.parameters !== undefined,
  { message: 'At least one of name, description, instructions, triggers, parameters must be provided.' },
);

export const SkillDeleteSchema = z.object({
  slug: z.string().min(1),
  projectPath: z.string().optional(),
}).strict();

// v0.12: Seed-from-docs.
export const ImportDocsSchema = z.object({
  projectPath: z.string().optional(),
  files: z.array(z.string()).optional()
    .describe('Explicit file paths (relative to projectPath) to import. Default: discover CLAUDE.md, AGENTS.md, README.md, CHANGELOG.md, ROADMAP.md at project root.'),
  maxChars: z.number().int().min(100).max(1_000_000).optional().default(50_000)
    .describe('Per-file character cap. Longer files are truncated with an explicit marker.'),
  dryRun: z.boolean().optional().default(false)
    .describe('If true, returns what would be imported without storing.'),
}).strict();


// ============================================================================
// Tool Definitions
// ============================================================================

const TOOLS: Tool[] = [
  {
    name: "context.getCurrent",
    description: "Get the current context window for a session, including working memories, relevant memories, patterns, suggestions, and ghost messages (hidden context injections from past sessions).",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Unique session identifier" },
        currentFile: { type: "string", description: "Currently open file path" },
        currentCommand: { type: "string", description: "Current command being executed" },
        projectPath: { type: "string", description: "Project path for context" },
        language: { type: "string", description: "Filter patterns by language (e.g. 'typescript', 'python')" },
        filePath: { type: "string", description: "Filter patterns by file path" },
      },
      required: [],
    },
  },
  {
    name: "context.store",
    description: "Store a new memory in the fabric. Memories can be code patterns, bug fixes, decisions, conventions, scratchpad notes, or relationships. If layer is not specified, SmartRouter will auto-select based on content type.",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["code_pattern", "bug_fix", "decision", "convention", "scratchpad", "relationship"],
          description: "Type of memory to store",
        },
        layer: {
          type: "number",
          description: "Memory layer: 1 (working), 2 (project), or 3 (semantic). Auto-detected if not specified.",
        },
        content: { type: "string", description: "Memory content" },
        metadata: {
          type: "object",
          properties: {
            title: { type: "string" },
            tags: { type: "array", items: { type: "string" } },
            fileContext: {
              type: "object",
              properties: {
                path: { type: "string" },
                lineStart: { type: "number" },
                lineEnd: { type: "number" },
                language: { type: "string" },
              },
            },
            codeBlock: {
              type: "object",
              properties: {
                code: { type: "string" },
                language: { type: "string" },
                filePath: { type: "string" },
              },
            },
            confidence: { type: "number" },
            source: { type: "string", enum: ["user_explicit", "ai_inferred", "system_auto"] },
            projectPath: { type: "string" },
            cliType: { type: "string" },
            weight: { type: "number", description: "Priority 1–5 (default 3). 4–5 surfaces above unweighted memories in recall and context window." },
          },
        },
        pinned: { type: "boolean", description: "Pin this memory to protect it from decay and summarization." },
        ttl: { type: "number", description: "Time-to-live in seconds (for L1 memories)" },
      },
      required: ["type", "content", "metadata"],
    },
  },
  {
    name: "context.recall",
    description: "Recall memories by hybrid search (FTS5 keyword + vector semantic, fused with Reciprocal Rank Fusion). Supports three modes: 'hybrid' (default, best quality), 'semantic' (vector-only), 'keyword' (FTS5 BM25-only). Searches across all layers.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        limit: { type: "number", default: 10 },
        offset: { type: "number", default: 0, description: "Skip the first N results. Combine with limit for pagination." },
        threshold: { type: "number", default: 0.7, description: "Minimum similarity score (0-1)" },
        mode: {
          type: "string",
          enum: ["semantic", "keyword", "hybrid"],
          default: "hybrid",
          description: "Search mode: 'hybrid' (default, RRF fusion of BM25 + vector), 'semantic' (vector cosine only), or 'keyword' (FTS5 BM25 only).",
        },
        filter: {
          type: "object",
          properties: {
            types: { type: "array", items: { type: "string" } },
            layers: { type: "array", items: { type: "number" } },
            tags: { type: "array", items: { type: "string" } },
            projectPath: { type: "string" },
          },
        },
        sessionId: { type: "string" },
      },
      required: ["query"],
    },
  },
  {
    name: "context.summarize",
    description: "Generate a condensed summary of old memories in a layer (L2 or L3). Archives old memories into a summary entry.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        layer: { type: "number", default: 2, description: "Layer to summarize (2=project, 3=semantic)" },
        olderThanDays: { type: "number", default: 30, description: "Summarize memories older than this many days" },
        options: {
          type: "object",
          description: "Optional summarization hints (reserved for future use).",
          properties: {
            targetTokens: { type: "number" },
            focusTypes: { type: "array", items: { type: "string" } },
            includePatterns: { type: "boolean" },
            includeDecisions: { type: "boolean" },
          },
        },
        projectPath: { type: "string", description: "Project path. Defaults to the current working directory." },
      },
    },
  },
  {
    name: "context.reportEvent",
    description: "Report an event from the CLI (file opened, command executed, error occurred, etc.). Used for automatic memory capture.",
    inputSchema: {
      type: "object",
      properties: {
        event: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["file_opened", "command_executed", "error_occurred", "decision_made", "session_start", "session_end", "pattern_detected", "user_feedback"],
            },
            payload: { type: "object" },
            timestamp: { type: "string" },
            sessionId: { type: "string" },
            cliType: { type: "string", enum: ["kimi", "claude", "claude-code", "opencode", "codex", "gemini", "cursor", "generic"] },
            projectPath: { type: "string" },
          },
          required: ["type", "payload", "timestamp", "sessionId", "cliType"],
        },
      },
      required: ["event"],
    },
  },
  {
    name: "context.orient",
    description: "Orientation loop: 'Where am I in time? What happened while I was offline? What project am I in?' Returns a TimeAnchor, the gap since the last session, and memories added while offline. Can also resolve date expressions and show world clock conversions.",
    inputSchema: {
      type: "object",
      properties: {
        timezone: {
          type: "string",
          description: "IANA timezone name. Defaults to the system timezone.",
        },
        projectPath: {
          type: "string",
          description: "Project path. Defaults to the current working directory.",
        },
        expression: {
          type: "string",
          description: "Optional date expression to resolve: 'now', 'today', 'yesterday', 'tomorrow', 'start of day', 'end of day', 'start of week', 'end of week', 'start of next week', 'next Monday' … 'next Sunday', 'last Monday' … 'last Sunday', an ISO date string, or an epoch-ms number.",
        },
        also: {
          type: "array",
          items: { type: "string" },
          description: "Additional IANA timezone names to show the same moment in (world clock).",
        },
      },
    },
  },
  {
    name: "context.searchCode",
    description: "Search the project's source code index. Supports three modes: 'text' for full-text search across file contents, 'symbol' for finding functions/classes/types by name, and 'semantic' for natural-language similarity search using embeddings. The index is built automatically on first use and stays up-to-date via file watching.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        mode: {
          type: "string",
          enum: ["text", "symbol", "semantic"],
          description: "Search mode: 'text' for full-text, 'symbol' for symbol names, 'semantic' for embedding similarity. Default: semantic",
          default: "semantic",
        },
        language: { type: "string", description: "Filter results to a specific language (e.g. 'typescript', 'python')" },
        filePattern: { type: "string", description: "Glob pattern to filter files (e.g. 'src/**/*.ts')" },
        symbolKind: {
          type: "string",
          enum: ["function", "class", "interface", "type", "enum", "const", "export", "method"],
          description: "Filter symbols by kind (only used with mode='symbol')",
        },
        limit: { type: "number", default: 10, description: "Maximum results to return" },
        threshold: { type: "number", default: 0.5, description: "Minimum similarity score for semantic search (0-1)" },
        includeContent: { type: "boolean", default: true, description: "Include source content in results" },
        projectPath: { type: "string", description: "Project path. Defaults to the current working directory." },
      },
      required: ["query"],
    },
  },
  {
    name: "context.get",
    description: "Get a specific memory by its ID. Searches across all layers (L1→L2→L3). Returns the memory and the layer it was found in.",
    inputSchema: {
      type: "object",
      properties: {
        memoryId: { type: "string", description: "ID of the memory to retrieve" },
        projectPath: { type: "string", description: "Project path. Defaults to the current working directory." },
      },
      required: ["memoryId"],
    },
  },
  {
    name: "context.update",
    description: "Update an existing memory's content, metadata, or tags. L1 memories cannot be updated (they are ephemeral). L3 memories are re-embedded only if content changes. Use targetLayer to promote a memory to a higher layer (L1→L2, L2→L3).",
    inputSchema: {
      type: "object",
      properties: {
        memoryId: { type: "string", description: "ID of the memory to update" },
        content: { type: "string", description: "New content (optional)" },
        metadata: { type: "object", description: "Metadata fields to merge (optional)" },
        tags: { type: "array", items: { type: "string" }, description: "New tags array (replaces existing tags)" },
        weight: { type: "number", description: "Update the memory weight (1–5)" },
        pinned: { type: "boolean", description: "Pin (true) or unpin (false) this memory. Pinned memories are exempt from decay and summarization." },
        targetLayer: { type: "number", description: "Promote memory to this layer (2=project, 3=semantic). Triggers promote logic: copies to new layer and deletes from old." },
        projectPath: { type: "string", description: "Project path. Defaults to the current working directory." },
      },
      required: ["memoryId"],
    },
  },
  {
    name: "context.delete",
    description: "Delete a memory by its ID. Searches across all layers and deletes from whichever layer it lives in.",
    inputSchema: {
      type: "object",
      properties: {
        memoryId: { type: "string", description: "ID of the memory to delete" },
        projectPath: { type: "string", description: "Project path. Defaults to the current working directory." },
      },
      required: ["memoryId"],
    },
  },
  {
    name: "context.list",
    description: "List and browse memories with optional filters. Supports pagination. Defaults to L2 (project) memories. Use stats=true to get a summary of the memory store (counts per layer, pinned counts, L2 breakdown by type) instead of listing memories.",
    inputSchema: {
      type: "object",
      properties: {
        layer: { type: "number", description: "Memory layer: 1 (working), 2 (project), or 3 (semantic). Defaults to 2." },
        type: {
          type: "string",
          enum: ["code_pattern", "bug_fix", "decision", "convention", "scratchpad", "relationship"],
          description: "Filter by memory type",
        },
        tags: { type: "array", items: { type: "string" }, description: "Filter by tags (OR logic)" },
        limit: { type: "number", default: 20, description: "Maximum results to return (default: 20)" },
        offset: { type: "number", default: 0, description: "Offset for pagination (default: 0)" },
        stats: { type: "boolean", description: "If true, return memory store summary (counts per layer, pinned counts, L2 breakdown by type) instead of listing memories." },
        projectPath: { type: "string", description: "Project path. Defaults to the current working directory." },
      },
    },
  },
  {
    name: "context.setup",
    description: "Install and configure Context Fabric into a CLI tool's MCP config. Call this when the user asks to set up, install, or configure Context Fabric. Writes the MCP server entry into the CLI's config file automatically. Use preview=true to show the config without writing it.",
    inputSchema: {
      type: "object",
      properties: {
        cli: {
          type: "string",
          enum: ["opencode", "claude", "claude-code", "kimi", "codex", "gemini", "cursor", "docker", "generic"],
          description: "Which CLI tool to configure. Supported: opencode, claude (Desktop), claude-code (Claude Code CLI), kimi, codex, gemini, cursor, docker (cross-platform Docker snippets for all CLIs), generic. 'docker' and 'generic' return config snippets without writing any file.",
        },
        serverPath: {
          type: "string",
          description: "Absolute path to the context-fabric server binary (dist/server.js). Auto-detected if omitted.",
        },
        useDocker: {
          type: "boolean",
          description: "If true, write a 'docker run --rm -i' entry instead of a local node entry. The Docker image must be built first: docker build -t context-fabric . Default false.",
          default: false,
        },
        preview: {
          type: "boolean",
          description: "If true, return the config snippet without writing the file. Default false.",
          default: false,
        },
      },
      required: ["cli"],
    },
  },
  {
    name: "context.backup",
    description: "Create a consistent timestamped snapshot of L2 (project) and L3 (semantic) SQLite databases using VACUUM INTO. Writes two files (l2-memory-<ts>.db and l3-semantic-<ts>.db) to destDir. Safe to run while the server is in use.",
    inputSchema: {
      type: "object",
      properties: {
        destDir: { type: "string", description: "Absolute directory path to write backup files into. Created if missing." },
        projectPath: { type: "string", description: "Project path whose L2 layer is backed up. Defaults to the current working directory." },
      },
      required: ["destDir"],
    },
  },
  {
    name: "context.storeBatch",
    description: "Store multiple memories in a single call (up to 500). Functionally equivalent to calling context.store N times but avoids MCP round-trip overhead. Use for bulk imports, session dumps, or context.import transformations.",
    inputSchema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          maxItems: 500,
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["code_pattern", "bug_fix", "decision", "convention", "scratchpad", "relationship"] },
              layer: { type: "number", minimum: 1, maximum: 3 },
              content: { type: "string" },
              metadata: { type: "object" },
              pinned: { type: "boolean" },
              ttl: { type: "number" },
            },
            required: ["type", "content", "metadata"],
          },
        },
        projectPath: { type: "string", description: "Default projectPath for items that omit metadata.projectPath." },
      },
      required: ["items"],
    },
  },
  {
    name: "context.export",
    description: "Export L2 (project) and L3 (semantic) memories to a JSON Lines file. Embeddings are omitted; the importer will recompute them. Useful for backup, migration, and cross-project sharing.",
    inputSchema: {
      type: "object",
      properties: {
        destPath: { type: "string", description: "Absolute path to the .jsonl file to write. Parent dirs are created." },
        layers: { type: "array", items: { type: "number", minimum: 1, maximum: 3 }, description: "Layers to export. Default [2, 3]." },
        projectPath: { type: "string" },
      },
      required: ["destPath"],
    },
  },
  {
    name: "context.import",
    description: "Import memories from a JSON Lines file produced by context.export. Each valid line is re-stored via the normal store path (L3 entries are re-embedded).",
    inputSchema: {
      type: "object",
      properties: {
        srcPath: { type: "string", description: "Absolute path to a .jsonl file." },
        projectPath: { type: "string" },
      },
      required: ["srcPath"],
    },
  },
  {
    name: "context.metrics",
    description: "Return in-process observability metrics: counters and latency histograms (p50/p95/p99) for recall calls by mode, plus memory counts per layer.",
    inputSchema: {
      type: "object",
      properties: {
        projectPath: { type: "string" },
        reset: { type: "boolean", description: "If true, reset histograms/counters after snapshot. Default false." },
      },
    },
  },
  {
    name: "context.health",
    description: "Health check: validates L2/L3 SQLite connectivity and embedding model presence. Returns {status: 'ok' | 'degraded', checks: [...]}.",
    inputSchema: {
      type: "object",
      properties: { projectPath: { type: "string" } },
    },
  },
  // v0.12: Skills — procedural memory (reusable instruction blocks invokable by slug).
  {
    name: "context.skill.create",
    description: "Create a new skill (procedural memory). Skills are reusable instruction blocks an agent can invoke by slug. Pinned and exempt from decay.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Unique kebab-case id, e.g. 'commit-message'. 1–64 chars, [a-z0-9-]." },
        name: { type: "string", description: "Human title, e.g. 'Write a commit message'." },
        description: { type: "string", description: "One-line purpose for listings." },
        instructions: { type: "string", description: "The skill's body: instructions the agent should follow when invoked." },
        triggers: { type: "array", items: { type: "string" }, description: "Optional natural-language trigger phrases." },
        parameters: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              description: { type: "string" },
              required: { type: "boolean" },
            },
            required: ["name"],
          },
          description: "Optional declared inputs the skill expects on invoke.",
        },
        tags: { type: "array", items: { type: "string" } },
        projectPath: { type: "string" },
      },
      required: ["slug", "name", "description", "instructions"],
    },
  },
  {
    name: "context.skill.list",
    description: "List all skills with slug, name, description, version, invocation count, and lastInvokedAt. Sorted by most-recently invoked then alphabetical.",
    inputSchema: {
      type: "object",
      properties: { projectPath: { type: "string" } },
    },
  },
  {
    name: "context.skill.get",
    description: "Return a skill by slug including its full instruction body without bumping invocation count. Use context.skill.invoke to actually run a skill.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        projectPath: { type: "string" },
      },
      required: ["slug"],
    },
  },
  {
    name: "context.skill.invoke",
    description: "Retrieve a skill's instructions and declared parameters, bumping invocationCount + lastInvokedAt. Use this when the agent is about to follow the skill, so list() ranks frequently-used skills first.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        projectPath: { type: "string" },
      },
      required: ["slug"],
    },
  },
  {
    name: "context.skill.update",
    description: "Update an existing skill. Version bumps when name, description, or instructions change.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        instructions: { type: "string" },
        triggers: { type: "array", items: { type: "string" } },
        parameters: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              description: { type: "string" },
              required: { type: "boolean" },
            },
            required: ["name"],
          },
        },
        projectPath: { type: "string" },
      },
      required: ["slug"],
    },
  },
  {
    name: "context.skill.delete",
    description: "Delete a skill by slug. Returns { deleted: boolean }.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        projectPath: { type: "string" },
      },
      required: ["slug"],
    },
  },
  // v0.12: Import docs — one-shot seed from CLAUDE.md / AGENTS.md / README.md / CHANGELOG.md / ROADMAP.md.
  {
    name: "context.importDocs",
    description: "Scan the project for known onboarding docs (CLAUDE.md, AGENTS.md, README.md, CHANGELOG.md, ROADMAP.md) and store each as a typed L2 memory with provenance. Idempotent: running twice does not create duplicates (dedup by file path + sha256).",
    inputSchema: {
      type: "object",
      properties: {
        projectPath: { type: "string" },
        files: { type: "array", items: { type: "string" }, description: "Explicit list of files to import (paths relative to projectPath). Defaults to auto-discovery." },
        maxChars: { type: "number", description: "Per-file character cap (default 50,000)." },
        dryRun: { type: "boolean", description: "If true, returns what would be imported without storing." },
      },
    },
  },
];

// ============================================================================
// Engine Management
// ============================================================================

// Map of projectPath -> ContextEngine instances (bounded to prevent memory leaks)
const MAX_ENGINES = 32;
const engines = new Map<string, ContextEngine>();
let defaultEngine: ContextEngine | null = null;

// v0.8: Shutdown coordinator — tracks in-flight tool calls so SIGTERM/SIGINT
// can wait for them to finish before engines are closed. Exported for tests.
export const shutdown = new ShutdownController();

/**
 * v0.12 (test-only): close and clear the process-level engine cache. Allows
 * tests that share a process to keep strict isolation between projectPath
 * fixtures without the noisy "default engine" leak across files.
 */
export function __resetEnginesForTests(): void {
  for (const engine of engines.values()) {
    try { engine.close(); } catch { /* ignore */ }
  }
  engines.clear();
  if (defaultEngine) {
    try { defaultEngine.close(); } catch { /* ignore */ }
    defaultEngine = null;
  }
}

/**
 * Get or create a ContextEngine for a project.
 * Evicts the least-recently-used engine when the cache exceeds MAX_ENGINES.
 */
function getEngine(projectPath?: string): ContextEngine {
  // CONTEXT_FABRIC_DEFAULT_PROJECT lets tests (and callers) pin the default
  // project used by primitives that have no projectPath parameter (Resources,
  // Prompts). Falls back to cwd, which races with chdir under parallel tests.
  const path = projectPath || process.env.CONTEXT_FABRIC_DEFAULT_PROJECT || process.cwd();

  // Move to end on access (LRU ordering — Map preserves insertion order)
  if (engines.has(path)) {
    const engine = engines.get(path)!;
    engines.delete(path);
    engines.set(path, engine);
    return engine;
  }

  // Evict oldest engine if at capacity
  if (engines.size >= MAX_ENGINES) {
    const [oldestPath, oldestEngine] = engines.entries().next().value!;
    oldestEngine.close();
    engines.delete(oldestPath);
    if (defaultEngine === oldestEngine) {
      defaultEngine = null;
    }
  }

  const engine = new ContextEngine({
    projectPath: path,
    autoCleanup: true,
    logLevel: 'info',
  });
  engines.set(path, engine);

  // Set as default if first engine
  if (!defaultEngine) {
    defaultEngine = engine;
  }

  return engine;
}


// ============================================================================
// Tool Handlers
// ============================================================================

async function handleGetCurrent(args: unknown): Promise<unknown> {
  const params = GetCurrentContextSchema.parse(args);
  const engine = getEngine(params.projectPath);

  const contextWindow = await engine.getContextWindow();

  // If language/filePath filter specified, re-rank patterns
  if (params.language || params.filePath) {
    const patterns = await engine.patternExtractor.extractPatterns(params.projectPath);
    const ranked = engine.patternExtractor.rankPatterns(patterns, {
      language: params.language,
      filePath: params.filePath,
    });
    contextWindow.patterns = ranked.slice(0, contextWindow.patterns.length || 5);
  }

  return { context: contextWindow };
}

async function handleStore(args: unknown): Promise<unknown> {
  const params = StoreMemorySchema.parse(args);
  const engine = getEngine(params.metadata.projectPath);
  
  const memory = await engine.store(params.content, params.type, {
    layer: params.layer,
    metadata: params.metadata,
    tags: params.metadata.tags,
    ttl: params.ttl,
    pinned: params.pinned,
  });
  
  return {
    id: memory.id,
    success: true,
    layer: memory.layer,
    pinned: memory.pinned ?? false,
  };
}

async function handleRecall(args: unknown): Promise<unknown> {
  const params = RecallSchema.parse(args);
  const engine = getEngine(params.filter?.projectPath);
  
  const layers = params.filter?.layers?.map((l: number) => l as MemoryLayer);
  
  const results = await engine.recall(params.query, {
    limit: params.limit + params.offset,
    mode: params.mode as import('./types.js').RecallMode,
    layers,
    filter: {
      types: params.filter?.types,
      tags: params.filter?.tags,
      projectPath: params.filter?.projectPath,
    },
    includeSuperseded: params.includeSuperseded,
    asOf: params.asOf,
  });
  
  // Filter by threshold, then apply offset/limit pagination.
  const filtered = results.filter(r => r.similarity >= params.threshold);
  const paged = filtered.slice(params.offset, params.offset + params.limit);
  
  return {
    results: paged.map(r => ({
      memory: {
        id: r.id,
        type: r.type,
        content: r.content,
        metadata: r.metadata,
        tags: r.tags,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      },
      similarity: r.similarity,
      layer: r.layer,
    })),
    total: filtered.length,
    offset: params.offset,
    limit: params.limit,
    hasMore: filtered.length > params.offset + params.limit,
  };
}

async function handleSummarize(args: unknown): Promise<unknown> {
  const params = SummarizeSchema.parse(args);
  const engine = getEngine(params.projectPath);
  
  const result = await engine.summarize(params.layer as MemoryLayer, params.olderThanDays);
  
  return {
    summaryId: result.summaryId,
    summarizedCount: result.summarizedCount,
    summary: result.summaryContent,
    layer: result.layer,
  };
}


async function handleReportEvent(args: unknown): Promise<unknown> {
  const params = ReportEventSchema.parse(args);
  const engine = getEngine(params.event.projectPath);
  
  const event: CLIEvent = {
    type: params.event.type,
    payload: params.event.payload,
    timestamp: params.event.timestamp,
    sessionId: params.event.sessionId,
    cliType: params.event.cliType,
    projectPath: params.event.projectPath,
  };
  
  const result = await engine.handleEvent(event);
  
  return {
    processed: result.processed,
    memoryId: result.memoryId,
    triggeredActions: result.triggeredActions,
    message: result.message,
  };
}



async function handleOrient(args: unknown): Promise<unknown> {
  const params = OrientSchema.parse(args);

  if (params.timezone && !TimeService.isValidTimezone(params.timezone)) {
    throw new Error(`Unknown timezone: "${params.timezone}". Use an IANA name like 'Europe/London'.`);
  }

  const engine = getEngine(params.projectPath);
  const orientation = await engine.orient(params.timezone);

  const result: Record<string, unknown> = {
    summary: orientation.summary,
    time: orientation.time,
    projectPath: orientation.projectPath,
    offlineGap: orientation.offlineGap,
    recentMemories: orientation.recentMemories.map(m => ({
      id: m.id,
      type: m.type,
      content: m.content.substring(0, 200),
      createdAt: m.createdAt,
      tags: m.tags,
    })),
  };

  // Time tool functionality: resolve date expression
  if (params.expression) {
    const ts = new TimeService();
    const epochMs = ts.resolve(params.expression, params.timezone);
    const anchor = ts.atTime(epochMs, params.timezone);
    result.resolved = epochMs;
    result.resolvedAnchor = anchor;
    if (params.also?.length) {
      result.conversions = params.also.map(tz => ts.convert(epochMs, tz));
    }
  } else if (params.also?.length) {
    // World clock without expression — convert current time
    const ts = new TimeService();
    result.conversions = params.also.map(tz => ts.convert(orientation.time.epochMs, tz));
  }

  return result;
}

async function handleSearchCode(args: unknown): Promise<unknown> {
  const params = SearchCodeSchema.parse(args);
  const engine = getEngine(params.projectPath);
  const codeIndex = engine.getCodeIndex();

  // Ensure index is ready
  await codeIndex.ensureReady();

  const searchOpts = {
    language: params.language,
    filePattern: params.filePattern,
    symbolKind: params.symbolKind,
    limit: params.limit,
    threshold: params.threshold,
    includeContent: params.includeContent,
  };

  let results;
  switch (params.mode) {
    case 'text':
      results = codeIndex.searchText(params.query, searchOpts);
      break;
    case 'symbol':
      results = codeIndex.searchSymbols(params.query, searchOpts);
      break;
    case 'semantic':
    default:
      results = await codeIndex.searchSemantic(params.query, searchOpts);
      break;
  }

  const status = codeIndex.getStatus();

  return {
    results,
    indexStatus: {
      totalFiles: status.totalFiles,
      totalSymbols: status.totalSymbols,
      lastIndexed: status.lastIndexedAt,
      isStale: status.isStale,
    },
    total: results.length,
  };
}

async function handleGetMemory(args: unknown): Promise<unknown> {
  const params = GetMemorySchema.parse(args);
  const engine = getEngine(params.projectPath);

  const result = await engine.getMemory(params.memoryId);
  if (!result) {
    throw new Error(`Memory not found: ${params.memoryId}`);
  }

  return {
    memory: {
      id: result.memory.id,
      type: result.memory.type,
      content: result.memory.content,
      metadata: result.memory.metadata,
      tags: result.memory.tags,
      createdAt: result.memory.createdAt,
      updatedAt: result.memory.updatedAt,
      accessCount: result.memory.accessCount,
      pinned: result.memory.pinned ?? false,
    },
    layer: result.layer,
  };
}

async function handleUpdateMemory(args: unknown): Promise<unknown> {
  const params = UpdateMemorySchema.parse(args);
  const engine = getEngine(params.projectPath);

  // Promote flow: if targetLayer is specified, promote instead of update
  if (params.targetLayer !== undefined) {
    // Find the memory to determine its current layer
    const found = await engine.getMemory(params.memoryId);
    if (!found) throw new Error(`Memory not found: ${params.memoryId}`);

    const fromLayer = found.layer;
    const targetLayer = params.targetLayer as MemoryLayer;

    if (targetLayer <= fromLayer) {
      throw new Error(`targetLayer (${targetLayer}) must be higher than current layer (${fromLayer})`);
    }

    const memory = await engine.promote(params.memoryId, fromLayer);
    return {
      success: true,
      memoryId: memory.id,
      newLayer: memory.layer,
    };
  }

  const updates: { content?: string; metadata?: Record<string, unknown>; tags?: string[]; pinned?: boolean } = {};
  if (params.content !== undefined) updates.content = params.content;
  if (params.metadata !== undefined) updates.metadata = params.metadata;
  if (params.tags !== undefined) updates.tags = params.tags;
  if (params.weight !== undefined) {
    updates.metadata = { ...updates.metadata, weight: params.weight };
  }
  if (params.pinned !== undefined) updates.pinned = params.pinned;

  const result = await engine.updateMemory(params.memoryId, updates);

  return {
    memory: {
      id: result.memory.id,
      type: result.memory.type,
      content: result.memory.content,
      metadata: result.memory.metadata,
      tags: result.memory.tags,
      createdAt: result.memory.createdAt,
      updatedAt: result.memory.updatedAt,
      pinned: result.memory.pinned ?? false,
    },
    layer: result.layer,
    success: true,
  };
}

async function handleDeleteMemory(args: unknown): Promise<unknown> {
  const params = DeleteMemorySchema.parse(args);
  const engine = getEngine(params.projectPath);

  const result = await engine.deleteMemory(params.memoryId);

  return {
    success: true,
    deletedFrom: result.deletedFrom,
  };
}

async function handleListMemories(args: unknown): Promise<unknown> {
  const params = ListMemoriesSchema.parse(args);
  const engine = getEngine(params.projectPath);

  // Stats mode: return counts instead of memories
  if (params.stats) {
    return engine.getStats();
  }

  const result = await engine.listMemories({
    layer: params.layer as import('./types.js').MemoryLayer | undefined,
    type: params.type,
    tags: params.tags,
    limit: params.limit,
    offset: params.offset,
  });

  return {
    memories: result.memories.map(m => ({
      id: m.id,
      type: m.type,
      content: m.content,
      metadata: m.metadata,
      tags: m.tags,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
      pinned: m.pinned ?? false,
    })),
    total: result.total,
    limit: params.limit,
    offset: params.offset,
    layer: params.layer ?? 2,
  };
}


async function handleSetup(args: unknown): Promise<unknown> {
  const params = SetupSchema.parse(args);
  const cli = params.cli as SupportedCLI;

  if (params.preview) {
    const snippet = previewConfig(cli, params.serverPath);
    return {
      preview: true,
      cli,
      useDocker: params.useDocker,
      snippet,
      message: `This is what would be added to your ${cli} MCP config. Call context.setup without preview:true to write it.`,
    };
  }

  const result = setupForCLI(cli, params.serverPath, params.useDocker);
  return result;
}

async function handleBackup(args: unknown): Promise<unknown> {
  const params = BackupSchema.parse(args);
  const engine = getEngine(params.projectPath);
  const backups = engine.backup(params.destDir);
  return {
    destDir: params.destDir,
    files: backups,
    totalBytes: backups.reduce((s, b) => s + b.size, 0),
  };
}

async function handleStoreBatch(args: unknown): Promise<unknown> {
  const params = StoreBatchSchema.parse(args);
  const results: Array<{ id: string; layer: MemoryLayer; pinned: boolean }> = [];
  const errors: Array<{ index: number; error: string }> = [];

  for (let i = 0; i < params.items.length; i++) {
    const item = params.items[i]!;
    const projectPath = item.metadata.projectPath ?? params.projectPath;
    const engine = getEngine(projectPath);
    try {
      const memory = await engine.store(item.content, item.type, {
        layer: item.layer,
        metadata: item.metadata,
        tags: item.metadata.tags,
        ttl: item.ttl,
        pinned: item.pinned,
      });
      results.push({
        id: memory.id,
        layer: memory.layer ?? MemoryLayer.L2_PROJECT,
        pinned: memory.pinned ?? false,
      });
    } catch (err) {
      errors.push({ index: i, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return {
    stored: results.length,
    failed: errors.length,
    results,
    ...(errors.length > 0 ? { errors } : {}),
  };
}

async function handleExport(args: unknown): Promise<unknown> {
  const params = ExportSchema.parse(args);
  const engine = getEngine(params.projectPath);
  const layers = params.layers?.map(l => l as MemoryLayer);
  return engine.exportMemories(params.destPath, layers ? { layers } : {});
}

async function handleImport(args: unknown): Promise<unknown> {
  const params = ImportSchema.parse(args);
  const engine = getEngine(params.projectPath);
  return engine.importMemories(params.srcPath);
}

async function handleMetrics(args: unknown): Promise<unknown> {
  const params = MetricsSchema.parse(args);
  const { metrics } = await import('./metrics.js');
  const engine = getEngine(params.projectPath);
  const stats = await engine.getStats();
  const snap = metrics.snapshot();
  if (params.reset) metrics.reset();
  return {
    stats,
    counters: snap.counters,
    histograms: snap.histograms,
    reset: params.reset ?? false,
  };
}

async function handleHealth(args: unknown): Promise<unknown> {
  const params = HealthSchema.parse(args);
  const engine = getEngine(params.projectPath);
  return engine.health();
}

// ============================================================================
// v0.12: Skill handlers
// ============================================================================

async function handleSkillCreate(args: unknown): Promise<unknown> {
  const params = SkillCreateSchema.parse(args);
  const engine = getEngine(params.projectPath);
  const mem = await engine.skills.create({
    slug: params.slug,
    name: params.name,
    description: params.description,
    instructions: params.instructions,
    triggers: params.triggers,
    parameters: params.parameters,
    tags: params.tags,
  });
  return {
    id: mem.id,
    slug: mem.metadata?.skill?.slug,
    name: mem.metadata?.skill?.name,
    description: mem.metadata?.skill?.description,
    version: mem.metadata?.skill?.version,
  };
}

async function handleSkillList(args: unknown): Promise<unknown> {
  const params = SkillListSchema.parse(args);
  const engine = getEngine(params.projectPath);
  const skills = await engine.skills.list();
  return { skills, count: skills.length };
}

async function handleSkillGet(args: unknown): Promise<unknown> {
  const params = SkillGetSchema.parse(args);
  const engine = getEngine(params.projectPath);
  const mem = await engine.skills.getBySlug(params.slug);
  if (!mem) throw new ToolError('NOT_FOUND', `Skill not found: ${params.slug}`);
  const sk = mem.metadata!.skill!;
  return {
    id: mem.id,
    slug: sk.slug,
    name: sk.name,
    description: sk.description,
    instructions: mem.content,
    triggers: sk.triggers ?? [],
    parameters: sk.parameters ?? [],
    version: sk.version ?? 1,
    invocationCount: sk.invocationCount ?? 0,
    lastInvokedAt: sk.lastInvokedAt ?? null,
  };
}

async function handleSkillInvoke(args: unknown): Promise<unknown> {
  const params = SkillInvokeSchema.parse(args);
  const engine = getEngine(params.projectPath);
  return engine.skills.invoke(params.slug);
}

async function handleSkillUpdate(args: unknown): Promise<unknown> {
  const params = SkillUpdateSchema.parse(args);
  const engine = getEngine(params.projectPath);
  const mem = await engine.skills.update(params.slug, {
    name: params.name,
    description: params.description,
    instructions: params.instructions,
    triggers: params.triggers,
    parameters: params.parameters,
  });
  const sk = mem.metadata!.skill!;
  return {
    id: mem.id,
    slug: sk.slug,
    name: sk.name,
    description: sk.description,
    version: sk.version,
  };
}

async function handleSkillDelete(args: unknown): Promise<unknown> {
  const params = SkillDeleteSchema.parse(args);
  const engine = getEngine(params.projectPath);
  const deleted = await engine.skills.deleteBySlug(params.slug);
  return { deleted, slug: params.slug };
}

// ============================================================================
// v0.12: importDocs handler
// ============================================================================

const DEFAULT_DOC_CANDIDATES = [
  'CLAUDE.md',
  'AGENTS.md',
  'README.md',
  'CHANGELOG.md',
  'ROADMAP.md',
  'CONTRIBUTING.md',
];

function docTypeFor(fileName: string): import('./types.js').MemoryType {
  const lower = fileName.toLowerCase();
  if (lower === 'changelog.md' || lower === 'roadmap.md') return 'scratchpad';
  if (lower === 'claude.md' || lower === 'agents.md') return 'convention';
  return 'convention'; // README/CONTRIBUTING → project conventions
}

async function handleImportDocs(args: unknown): Promise<unknown> {
  const params = ImportDocsSchema.parse(args);
  const engine = getEngine(params.projectPath);
  const fs = await import('node:fs');
  const path = await import('node:path');
  const crypto = await import('node:crypto');

  const projectPath = params.projectPath
    ?? engine.projectPath
    ?? process.cwd();

  const candidates = params.files && params.files.length > 0
    ? params.files
    : DEFAULT_DOC_CANDIDATES;

  const imported: Array<{ file: string; id?: string; bytes: number; truncated: boolean; status: 'stored' | 'skipped-duplicate' | 'skipped-missing' | 'would-import' }> = [];

  for (const rel of candidates) {
    const full = path.isAbsolute(rel) ? rel : path.join(projectPath, rel);
    if (!fs.existsSync(full)) {
      imported.push({ file: rel, bytes: 0, truncated: false, status: 'skipped-missing' });
      continue;
    }
    let content = fs.readFileSync(full, 'utf8');
    const origBytes = Buffer.byteLength(content, 'utf8');
    const max = params.maxChars;
    const truncated = content.length > max;
    if (truncated) {
      content = content.slice(0, max) + `\n\n... [truncated at ${max} chars of ${content.length}]`;
    }
    const sha = crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
    const fileName = path.basename(full);

    if (params.dryRun) {
      imported.push({ file: rel, bytes: origBytes, truncated, status: 'would-import' });
      continue;
    }

    // Idempotency: check for an existing memory with the same provenance.filePath + hash.
    // Use list-by-tag on the fingerprint tag we attach below.
    const fingerprint = `doc-import:${sha}`;
    const existing = await engine.listMemories({
      layer: 2 as import('./types.js').MemoryLayer,
      tags: [fingerprint],
      limit: 1,
    });
    if (existing.memories.length > 0) {
      imported.push({ file: rel, id: existing.memories[0].id, bytes: origBytes, truncated, status: 'skipped-duplicate' });
      continue;
    }

    const mem = await engine.store(content, docTypeFor(fileName), {
      layer: 2 as import('./types.js').MemoryLayer,
      tags: ['doc', `doc:${fileName.toLowerCase()}`, fingerprint],
      pinned: true,
      metadata: {
        title: fileName,
        provenance: {
          filePath: rel,
          capturedAt: Date.now(),
        },
        source: 'user_explicit',
      },
    });
    imported.push({ file: rel, id: mem.id, bytes: origBytes, truncated, status: 'stored' });
  }

  return {
    projectPath,
    imported,
    summary: {
      total: imported.length,
      stored: imported.filter(x => x.status === 'stored').length,
      skipped: imported.filter(x => x.status === 'skipped-duplicate' || x.status === 'skipped-missing').length,
      truncated: imported.filter(x => x.truncated).length,
    },
    dryRun: params.dryRun,
  };
}


// ============================================================================
// Server Setup
// ============================================================================

export async function createServer(): Promise<Server> {
  const server = new Server(
    {
      name: "context-fabric",
      version: VERSION,
    },
    {
      capabilities: {
        tools: {},
        resources: { subscribe: false, listChanged: false },
        prompts: { listChanged: false },
      },
    }
  );

  // ==========================================================================
  // v0.12: Resources — expose memories, skills, patterns as browseable URIs.
  // Namespace: memory://
  //   memory://skills                → list all skills
  //   memory://skill/{slug}          → one skill (instructions body)
  //   memory://memory/{id}           → any memory across L1/L2/L3
  //   memory://recent                → 20 most recent L2 memories
  //   memory://conventions           → L2 memories of type='convention'
  //   memory://decisions             → L2 memories of type='decision'
  // ==========================================================================
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const engine = getEngine();
    const resources: Array<{ uri: string; name: string; description?: string; mimeType?: string }> = [
      {
        uri: "memory://skills",
        name: "All skills",
        description: "Procedural memory: every skill registered on this project.",
        mimeType: "application/json",
      },
      {
        uri: "memory://recent",
        name: "Recent memories",
        description: "20 most recently updated L2 memories.",
        mimeType: "application/json",
      },
      {
        uri: "memory://conventions",
        name: "Project conventions",
        description: "L2 memories of type='convention' (house rules, coding style, imported CLAUDE.md/AGENTS.md).",
        mimeType: "application/json",
      },
      {
        uri: "memory://decisions",
        name: "Project decisions",
        description: "L2 memories of type='decision' (architectural/product choices with rationale).",
        mimeType: "application/json",
      },
    ];

    // One resource per skill — lets clients preview them individually.
    try {
      const skills = await engine.skills.list();
      for (const s of skills) {
        resources.push({
          uri: `memory://skill/${s.slug}`,
          name: `Skill: ${s.name}`,
          description: s.description,
          mimeType: "text/markdown",
        });
      }
    } catch {
      // Swallow — if the engine can't be initialized the top-level list still works.
    }

    return { resources };
  });

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
    resourceTemplates: [
      {
        uriTemplate: "memory://skill/{slug}",
        name: "Skill by slug",
        description: "Get a specific skill's instructions (non-invoking read).",
        mimeType: "text/markdown",
      },
      {
        uriTemplate: "memory://memory/{id}",
        name: "Memory by id",
        description: "Read any memory by its UUID across L1/L2/L3.",
        mimeType: "application/json",
      },
    ],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params as { uri: string };
    const engine = getEngine();

    // Match URI patterns. All responses are MCP Resource contents.
    if (uri === "memory://skills") {
      const skills = await engine.skills.list();
      return {
        contents: [{
          uri,
          mimeType: "application/json",
          text: JSON.stringify({ skills, count: skills.length }, null, 2),
        }],
      };
    }

    const skillMatch = uri.match(/^memory:\/\/skill\/([a-z0-9][a-z0-9-]{0,63})$/);
    if (skillMatch) {
      const slug = skillMatch[1];
      const mem = await engine.skills.getBySlug(slug);
      if (!mem) throw new ToolError('NOT_FOUND', `Skill not found: ${slug}`);
      const sk = mem.metadata!.skill!;
      const md = [
        `# ${sk.name}`,
        '',
        `_${sk.description}_`,
        '',
        sk.triggers && sk.triggers.length
          ? `**Triggers:** ${sk.triggers.map(t => `\`${t}\``).join(', ')}\n`
          : '',
        sk.parameters && sk.parameters.length
          ? `**Parameters:**\n${sk.parameters.map(p => `- \`${p.name}\`${p.required ? ' *(required)*' : ''}${p.description ? ' — ' + p.description : ''}`).join('\n')}\n`
          : '',
        '## Instructions',
        '',
        mem.content,
      ].filter(Boolean).join('\n');
      return {
        contents: [{ uri, mimeType: "text/markdown", text: md }],
      };
    }

    const memMatch = uri.match(/^memory:\/\/memory\/([0-9a-fA-F-]{36})$/);
    if (memMatch) {
      const id = memMatch[1];
      const got = await engine.getMemory(id);
      if (!got) throw new ToolError('NOT_FOUND', `Memory not found: ${id}`);
      return {
        contents: [{
          uri,
          mimeType: "application/json",
          text: JSON.stringify(got, null, 2),
        }],
      };
    }

    if (uri === "memory://recent") {
      const res = await engine.listMemories({ layer: 2 as import('./types.js').MemoryLayer, limit: 20 });
      return {
        contents: [{ uri, mimeType: "application/json", text: JSON.stringify(res, null, 2) }],
      };
    }

    if (uri === "memory://conventions") {
      const res = await engine.listMemories({ layer: 2 as import('./types.js').MemoryLayer, type: 'convention', limit: 100 });
      return {
        contents: [{ uri, mimeType: "application/json", text: JSON.stringify(res, null, 2) }],
      };
    }

    if (uri === "memory://decisions") {
      const res = await engine.listMemories({ layer: 2 as import('./types.js').MemoryLayer, type: 'decision', limit: 100 });
      return {
        contents: [{ uri, mimeType: "application/json", text: JSON.stringify(res, null, 2) }],
      };
    }

    throw new ToolError('UNKNOWN_RESOURCE', `Unknown resource uri: ${uri}`);
  });

  // ==========================================================================
  // v0.12: Prompts — slash-command-style workflow templates.
  // ==========================================================================
  const PROMPTS: Array<{ name: string; description: string; arguments?: Array<{ name: string; description?: string; required?: boolean }> }> = [
    {
      name: "cf-orient",
      description: "Get oriented for a new session: summarize what happened since last time, surface open threads and recent decisions.",
      arguments: [],
    },
    {
      name: "cf-capture-decision",
      description: "Walk the agent through capturing an architectural/product decision with rationale and alternatives into L2.",
      arguments: [
        { name: "topic", description: "Short label for the decision, e.g. 'auth backend'.", required: true },
      ],
    },
    {
      name: "cf-review-session",
      description: "Review the current session: list what was attempted, what succeeded, and propose memories to store.",
      arguments: [],
    },
    {
      name: "cf-search-code",
      description: "Hybrid code search prompt — chooses the right mode (text / symbol / semantic) for the query.",
      arguments: [
        { name: "query", description: "What to search for.", required: true },
      ],
    },
    {
      name: "cf-invoke-skill",
      description: "Invoke a named skill by slug, listing any required parameters.",
      arguments: [
        { name: "slug", description: "Skill slug (see context.skill.list).", required: true },
      ],
    },
  ];

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: PROMPTS }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: args } = request.params as { name: string; arguments?: Record<string, string> };
    const a = args ?? {};

    const messages: Array<{ role: 'user' | 'assistant'; content: { type: 'text'; text: string } }> = [];

    switch (name) {
      case "cf-orient":
        messages.push({
          role: 'user',
          content: {
            type: 'text',
            text: [
              'Call the `context.orient` tool now. Then:',
              '1. Summarize the gap since last session (hours/days, what changed).',
              '2. List the top 3 open threads or TODOs surfaced.',
              '3. List the most recent architectural decisions.',
              'Finish with: "Ready. What are we doing today?"',
            ].join('\n'),
          },
        });
        break;
      case "cf-capture-decision": {
        const topic = a.topic ?? '<unspecified>';
        messages.push({
          role: 'user',
          content: {
            type: 'text',
            text: [
              `Capture a decision about: **${topic}**.`,
              '',
              'Walk me through:',
              '1. What are we deciding?',
              '2. What options did we consider?',
              '3. Which option did we pick and why?',
              '4. What are the trade-offs / what are we giving up?',
              '5. Are there reversibility / migration concerns?',
              '',
              `When I confirm, call \`context.store\` with type="decision", a clear title, and store it in L2 with tags including "decision" and "${topic.toLowerCase().replace(/\s+/g, '-')}".`,
            ].join('\n'),
          },
        });
        break;
      }
      case "cf-review-session":
        messages.push({
          role: 'user',
          content: {
            type: 'text',
            text: [
              'Review the work we did in this session.',
              '1. What did we attempt?',
              '2. What actually succeeded (tests passing, code shipped, decisions made)?',
              '3. What is still open / blocked?',
              'Then propose up to 5 memories to persist via `context.store` or `context.storeBatch`. Ask me to confirm before writing.',
            ].join('\n'),
          },
        });
        break;
      case "cf-search-code": {
        const query = a.query ?? '';
        messages.push({
          role: 'user',
          content: {
            type: 'text',
            text: [
              `Search the code index for: **${query}**.`,
              '',
              'Pick the best `context.searchCode` mode:',
              '- `symbol` if the query looks like an identifier or `Class.method`.',
              '- `text` if the query contains quotes or obvious literal tokens.',
              '- `semantic` for anything conceptual.',
              '',
              'Return: top 5 hits with file:line and a one-line summary of each. If the index is stale, say so.',
            ].join('\n'),
          },
        });
        break;
      }
      case "cf-invoke-skill": {
        const slug = a.slug ?? '';
        messages.push({
          role: 'user',
          content: {
            type: 'text',
            text: [
              `Call \`context.skill.invoke\` with slug="${slug}".`,
              'Read the returned instructions carefully, list any required parameters, and ask me to provide them before proceeding.',
            ].join('\n'),
          },
        });
        break;
      }
      default:
        throw new ToolError('UNKNOWN_PROMPT', `Unknown prompt: ${name}`);
    }

    return {
      description: PROMPTS.find(p => p.name === name)?.description,
      messages,
    };
  });

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params as { name: string; arguments?: unknown };

    // v0.8: Reject new calls while shutting down; otherwise bracket the
    // handler with begin/end so drain() knows when we're idle.
    try {
      shutdown.begin();
    } catch (err) {
      const payload = toErrorPayload(
        err instanceof Error ? new ToolError('SHUTTING_DOWN', err.message) : err,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(payload) }],
        isError: true,
      };
    }

    try {
      let result: unknown;

      switch (name) {
        case "context.getCurrent":
          result = await handleGetCurrent(args);
          break;
        case "context.store":
          result = await handleStore(args);
          break;
        case "context.recall":
          result = await handleRecall(args);
          break;
        case "context.summarize":
          result = await handleSummarize(args);
          break;
        case "context.reportEvent":
          result = await handleReportEvent(args);
          break;
        case "context.orient":
          result = await handleOrient(args);
          break;
        case "context.searchCode":
          result = await handleSearchCode(args);
          break;
        case "context.get":
          result = await handleGetMemory(args);
          break;
        case "context.update":
          result = await handleUpdateMemory(args);
          break;
        case "context.delete":
          result = await handleDeleteMemory(args);
          break;
        case "context.list":
          result = await handleListMemories(args);
          break;
        case "context.setup":
          result = await handleSetup(args);
          break;
        case "context.backup":
          result = await handleBackup(args);
          break;
        case "context.storeBatch":
          result = await handleStoreBatch(args);
          break;
        case "context.export":
          result = await handleExport(args);
          break;
        case "context.import":
          result = await handleImport(args);
          break;
        case "context.metrics":
          result = await handleMetrics(args);
          break;
        case "context.health":
          result = await handleHealth(args);
          break;
        case "context.skill.create":
          result = await handleSkillCreate(args);
          break;
        case "context.skill.list":
          result = await handleSkillList(args);
          break;
        case "context.skill.get":
          result = await handleSkillGet(args);
          break;
        case "context.skill.invoke":
          result = await handleSkillInvoke(args);
          break;
        case "context.skill.update":
          result = await handleSkillUpdate(args);
          break;
        case "context.skill.delete":
          result = await handleSkillDelete(args);
          break;
        case "context.importDocs":
          result = await handleImportDocs(args);
          break;
        default:
          throw new ToolError('UNKNOWN_TOOL', `Unknown tool: ${name}`);
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result),
          },
        ],
      };
    } catch (error) {
      const payload = toErrorPayload(error);
      console.error(`[ContextFabric] Error handling ${name}:`, payload.code, payload.error);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(payload),
          },
        ],
        isError: true,
      };
    } finally {
      shutdown.end();
    }
  });

  return server;
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main(): Promise<void> {
  // Initialize configuration
  initialize();
  const config = getConfig();
  
  console.error("Context Fabric MCP Server starting...");
  console.error(`Config loaded: L2=${config.storage.l2Path}, L3=${config.storage.l3Path}`);
  
  const server = await createServer();
  const transport = new StdioServerTransport();
  
  await server.connect(transport);
  
  console.error("Context Fabric MCP Server running on stdio");
  
  // v0.8: Graceful shutdown — wait up to 5s for in-flight tool calls to
  // finish, then close engines cleanly (which also checkpoints WAL).
  const gracefulShutdown = async (signal: string) => {
    console.error(`\n[context-fabric] ${signal} received; draining in-flight calls...`);
    const result = await shutdown.drain(5000);
    if (!result.drained) {
      console.error(`[context-fabric] drain timed out with ${result.remaining} call(s) still running; closing anyway.`);
    } else {
      console.error('[context-fabric] drain complete.');
    }
    for (const [path, engine] of engines) {
      console.error(`[context-fabric] Closing engine for ${path}...`);
      engine.close();
    }
    process.exit(0);
  };

  process.on('SIGINT', () => { void gracefulShutdown('SIGINT'); });
  process.on('SIGTERM', () => { void gracefulShutdown('SIGTERM'); });
}

// Run the server only when invoked as the entry point (not during test imports).
// v0.9: guard with import.meta.url check so schema exports can be imported
// by unit tests without booting the stdio transport.
import { fileURLToPath } from 'node:url';
const isEntryPoint = (() => {
  try {
    return process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
})();

if (isEntryPoint) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
