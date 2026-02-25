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
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { initialize, getConfig } from "./config.js";
import { ContextEngine } from "./engine.js";
import { setupForCLI, previewConfig, type SupportedCLI } from "./setup.js";
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

const StoreMemorySchema = z.object({
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
  }),
  ttl: z.number().int().positive().optional(),
});

const RecallSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().positive().default(10),
  threshold: z.number().min(0).max(1).default(0.7),
  filter: z.object({
    types: z.array(z.enum(["code_pattern", "bug_fix", "decision", "convention", "scratchpad", "relationship"])).optional(),
    layers: z.array(z.number().int().min(1).max(3)).optional(),
    tags: z.array(z.string()).optional(),
    projectPath: z.string().optional(),
  }).optional(),
  sessionId: z.string(),
});

const GetCurrentContextSchema = z.object({
  sessionId: z.string(),
  currentFile: z.string().optional(),
  currentCommand: z.string().optional(),
  projectPath: z.string().optional(),
});

const SummarizeSchema = z.object({
  sessionId: z.string(),
  layer: z.number().int().min(2).max(3).default(2),
  olderThanDays: z.number().int().positive().default(30),
  options: z.object({
    targetTokens: z.number().int().positive(),
    focusTypes: z.array(z.enum(["code_pattern", "bug_fix", "decision", "convention", "scratchpad", "relationship"])).optional(),
    includePatterns: z.boolean().default(true),
    includeDecisions: z.boolean().default(true),
  }),
  projectPath: z.string().optional(),
});

const GetPatternsSchema = z.object({
  language: z.string().optional(),
  filePath: z.string().optional(),
  limit: z.number().int().positive().default(5),
  projectPath: z.string().optional(),
});

const ReportEventSchema = z.object({
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
});

const GhostSchema = z.object({
  sessionId: z.string(),
  trigger: z.string(),
  currentContext: z.string(),
  projectPath: z.string().optional(),
});

const PromoteMemorySchema = z.object({
  memoryId: z.string(),
  fromLayer: z.number().int().min(1).max(2),
});

const TimeSchema = z.object({
  timezone: z.string().optional(),
  expression: z.string().optional(),
  also: z.array(z.string()).optional(),
});

const OrientSchema = z.object({
  timezone: z.string().optional(),
  projectPath: z.string().optional(),
});

const SetupSchema = z.object({
  cli: z.enum(["opencode", "claude", "claude-code", "kimi", "codex", "gemini", "cursor", "docker", "generic"]),
  serverPath: z.string().optional(),
  useDocker: z.boolean().default(false),
  preview: z.boolean().default(false),
});

const SearchCodeSchema = z.object({
  query: z.string().min(1),
  mode: z.enum(["text", "symbol", "semantic"]).default("semantic"),
  language: z.string().optional(),
  filePattern: z.string().optional(),
  symbolKind: z.enum(["function", "class", "interface", "type", "enum", "const", "export", "method"]).optional(),
  limit: z.number().int().positive().default(10),
  threshold: z.number().min(0).max(1).default(0.5),
  includeContent: z.boolean().default(true),
  projectPath: z.string().optional(),
});

const GetMemorySchema = z.object({
  memoryId: z.string().min(1),
  projectPath: z.string().optional(),
});

const UpdateMemorySchema = z.object({
  memoryId: z.string().min(1),
  content: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  tags: z.array(z.string()).optional(),
  weight: z.number().int().min(1).max(5).optional()
    .describe('Update the memory weight (1–5)'),
  projectPath: z.string().optional(),
});

const DeleteMemorySchema = z.object({
  memoryId: z.string().min(1),
  projectPath: z.string().optional(),
});

const ListMemoriesSchema = z.object({
  layer: z.number().int().min(1).max(3).optional(),
  type: z.enum(["code_pattern", "bug_fix", "decision", "convention", "scratchpad", "relationship"]).optional(),
  tags: z.array(z.string()).optional(),
  limit: z.number().int().positive().default(20),
  offset: z.number().int().min(0).default(0),
  projectPath: z.string().optional(),
});

// ============================================================================
// Tool Definitions
// ============================================================================

const TOOLS: Tool[] = [
  {
    name: "context.getCurrent",
    description: "Get the current context window for a session, including working memories, relevant memories, patterns, and suggestions.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Unique session identifier" },
        currentFile: { type: "string", description: "Currently open file path" },
        currentCommand: { type: "string", description: "Current command being executed" },
        projectPath: { type: "string", description: "Project path for context" },
      },
      required: ["sessionId"],
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
        ttl: { type: "number", description: "Time-to-live in seconds (for L1 memories)" },
      },
      required: ["type", "content", "metadata"],
    },
  },
  {
    name: "context.recall",
    description: "Recall memories semantically similar to the query. Returns ranked results with similarity scores. Searches across all layers by default.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        limit: { type: "number", default: 10 },
        threshold: { type: "number", default: 0.7, description: "Minimum similarity score (0-1)" },
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
      required: ["query", "sessionId"],
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
          properties: {
            targetTokens: { type: "number" },
            focusTypes: { type: "array", items: { type: "string" } },
            includePatterns: { type: "boolean" },
            includeDecisions: { type: "boolean" },
          },
          required: ["targetTokens"],
        },
        projectPath: { type: "string", description: "Project path. Defaults to the current working directory." },
      },
      required: ["sessionId", "options"],
    },
  },
  {
    name: "context.getPatterns",
    description: "Get relevant code patterns for the current context, optionally filtered by language or file.",
    inputSchema: {
      type: "object",
      properties: {
        language: { type: "string" },
        filePath: { type: "string" },
        limit: { type: "number", default: 5 },
        projectPath: { type: "string" },
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
    name: "context.ghost",
    description: "Get ghost messages (hidden context) for the current situation. These are invisible context injections that provide relevant background.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        trigger: { type: "string", description: "What triggered the ghost request" },
        currentContext: { type: "string", description: "Current context description" },
        projectPath: { type: "string" },
      },
      required: ["sessionId", "trigger", "currentContext"],
    },
  },
  {
    name: "context.promote",
    description: "Promote a memory to a higher layer (L1→L2, L2→L3). This upgrades its persistence and scope.",
    inputSchema: {
      type: "object",
      properties: {
        memoryId: { type: "string", description: "ID of the memory to promote" },
        fromLayer: { type: "number", description: "Current layer of the memory (1 or 2)" },
      },
      required: ["memoryId", "fromLayer"],
    },
  },
  {
    name: "context.time",
    description: "Get the current time as a rich TimeAnchor (local time, UTC offset, day boundaries, week number). Optionally resolve a natural-language date expression ('tomorrow', 'next Monday', 'end of day', etc.) or show the same moment in multiple timezones.",
    inputSchema: {
      type: "object",
      properties: {
        timezone: {
          type: "string",
          description: "IANA timezone name (e.g. 'America/New_York'). Defaults to the system timezone.",
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
    name: "context.orient",
    description: "Orientation loop: 'Where am I in time? What happened while I was offline? What project am I in?' Returns a TimeAnchor, the gap since the last session, and memories added while offline.",
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
    description: "Update an existing memory's content, metadata, or tags. L1 memories cannot be updated (they are ephemeral). L3 memories are re-embedded only if content changes.",
    inputSchema: {
      type: "object",
      properties: {
        memoryId: { type: "string", description: "ID of the memory to update" },
        content: { type: "string", description: "New content (optional)" },
        metadata: { type: "object", description: "Metadata fields to merge (optional)" },
        tags: { type: "array", items: { type: "string" }, description: "New tags array (replaces existing tags)" },
        weight: { type: "number", description: "Update the memory weight (1–5)" },
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
    description: "List and browse memories with optional filters. Supports pagination. Defaults to L2 (project) memories.",
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
];

// ============================================================================
// Engine Management
// ============================================================================

// Map of projectPath -> ContextEngine instances
const engines = new Map<string, ContextEngine>();
let defaultEngine: ContextEngine | null = null;

/**
 * Get or create a ContextEngine for a project
 */
function getEngine(projectPath?: string): ContextEngine {
  const path = projectPath || process.cwd();
  
  if (!engines.has(path)) {
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
  }
  
  return engines.get(path)!;
}

/**
 * Get default engine
 */
function getDefaultEngine(): ContextEngine {
  if (!defaultEngine) {
    return getEngine();
  }
  return defaultEngine;
}

// ============================================================================
// Tool Handlers
// ============================================================================

async function handleGetCurrent(args: unknown): Promise<unknown> {
  const params = GetCurrentContextSchema.parse(args);
  const engine = getEngine(params.projectPath);
  
  const contextWindow = await engine.getContextWindow();
  
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
  });
  
  return { 
    id: memory.id, 
    success: true,
    layer: memory.layer,
  };
}

async function handleRecall(args: unknown): Promise<unknown> {
  const params = RecallSchema.parse(args);
  const engine = getEngine(params.filter?.projectPath);
  
  const layers = params.filter?.layers?.map((l: number) => l as MemoryLayer);
  
  const results = await engine.recall(params.query, {
    limit: params.limit,
    layers,
    filter: {
      types: params.filter?.types,
      tags: params.filter?.tags,
      projectPath: params.filter?.projectPath,
    },
  });
  
  // Filter by threshold
  const filtered = results.filter(r => r.similarity >= params.threshold);
  
  return {
    results: filtered.map(r => ({
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

async function handleGetPatterns(args: unknown): Promise<unknown> {
  const params = GetPatternsSchema.parse(args);
  const engine = getEngine(params.projectPath);
  
  const patterns = await engine.patternExtractor.extractPatterns(params.projectPath);
  const ranked = engine.patternExtractor.rankPatterns(patterns, {
    language: params.language,
    filePath: params.filePath,
  });
  
  return {
    patterns: ranked.slice(0, params.limit).map(p => ({
      id: p.id,
      name: p.name,
      description: p.description,
      code: p.code,
      language: p.language,
      usageCount: p.usageCount,
      lastUsedAt: p.lastUsedAt,
    })),
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

async function handleGhost(args: unknown): Promise<unknown> {
  const params = GhostSchema.parse(args);
  const engine = getEngine(params.projectPath);
  
  const result = await engine.ghost();
  
  return {
    messages: result.messages.map(m => ({
      id: m.id,
      role: m.role,
      content: m.content,
      timestamp: m.timestamp,
      trigger: m.trigger,
    })),
    relevantMemories: result.relevantMemories.map(m => ({
      id: m.id,
      type: m.type,
      content: m.content.substring(0, 200),
    })),
    suggestedActions: result.suggestedActions,
  };
}

async function handleTime(args: unknown): Promise<unknown> {
  const params = TimeSchema.parse(args);
  const ts = new TimeService();

  // Validate timezone if provided
  if (params.timezone && !TimeService.isValidTimezone(params.timezone)) {
    throw new Error(`Unknown timezone: "${params.timezone}". Use an IANA name like 'America/New_York'.`);
  }

  if (params.expression) {
    // Resolve a date expression to an epoch ms, then build anchor
    const epochMs = ts.resolve(params.expression, params.timezone);
    const anchor = ts.atTime(epochMs, params.timezone);
    const result: Record<string, unknown> = { resolved: epochMs, anchor };
    if (params.also?.length) {
      result.conversions = params.also.map(tz => ts.convert(epochMs, tz));
    }
    return result;
  }

  const anchor = ts.now(params.timezone);
  const result: Record<string, unknown> = { anchor };
  if (params.also?.length) {
    result.conversions = params.also.map(tz => ts.convert(anchor.epochMs, tz));
  }
  return result;
}

async function handleOrient(args: unknown): Promise<unknown> {
  const params = OrientSchema.parse(args);

  if (params.timezone && !TimeService.isValidTimezone(params.timezone)) {
    throw new Error(`Unknown timezone: "${params.timezone}". Use an IANA name like 'Europe/London'.`);
  }

  const engine = getEngine(params.projectPath);
  const orientation = await engine.orient(params.timezone);

  return {
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
    },
    layer: result.layer,
  };
}

async function handleUpdateMemory(args: unknown): Promise<unknown> {
  const params = UpdateMemorySchema.parse(args);
  const engine = getEngine(params.projectPath);

  const updates: { content?: string; metadata?: Record<string, unknown>; tags?: string[] } = {};
  if (params.content !== undefined) updates.content = params.content;
  if (params.metadata !== undefined) updates.metadata = params.metadata;
  if (params.tags !== undefined) updates.tags = params.tags;
  if (params.weight !== undefined) {
    updates.metadata = { ...updates.metadata, weight: params.weight };
  }

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

async function handlePromote(args: unknown): Promise<unknown> {
  const params = PromoteMemorySchema.parse(args);

  // Try each engine — the memory may live in any project-scoped engine
  for (const engine of engines.values()) {
    try {
      const memory = await engine.promote(params.memoryId, params.fromLayer as MemoryLayer);
      return {
        success: true,
        memoryId: memory.id,
        newLayer: memory.layer,
      };
    } catch (err) {
      console.error('[ContextFabric] Promote failed for engine:', err);
    }
  }

  // Fallback: default engine (creates one if none exist yet)
  const engine = getDefaultEngine();
  const memory = await engine.promote(params.memoryId, params.fromLayer as MemoryLayer);
  return {
    success: true,
    memoryId: memory.id,
    newLayer: memory.layer,
  };
}

// ============================================================================
// Server Setup
// ============================================================================

async function createServer(): Promise<Server> {
  const server = new Server(
    {
      name: "context-fabric",
      version: "0.5.2",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params as { name: string; arguments?: unknown };

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
        case "context.getPatterns":
          result = await handleGetPatterns(args);
          break;
        case "context.reportEvent":
          result = await handleReportEvent(args);
          break;
        case "context.ghost":
          result = await handleGhost(args);
          break;
        case "context.promote":
          result = await handlePromote(args);
          break;
        case "context.time":
          result = await handleTime(args);
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
        default:
          throw new Error(`Unknown tool: ${name}`);
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
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[ContextFabric] Error handling ${name}:`, message);
      
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: message }),
          },
        ],
        isError: true,
      };
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
  
  // Cleanup on exit
  process.on('SIGINT', () => {
    console.error("\nShutting down Context Fabric...");
    for (const [path, engine] of engines) {
      console.error(`Closing engine for ${path}...`);
      engine.close();
    }
    process.exit(0);
  });
  
  process.on('SIGTERM', () => {
    console.error("\nShutting down Context Fabric...");
    for (const [path, engine] of engines) {
      console.error(`Closing engine for ${path}...`);
      engine.close();
    }
    process.exit(0);
  });
}

// Run the server
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
