/**
 * Core types for Context Fabric - MCP server for agentic CLI memory
 */

// ============================================================================
// Memory Types
// ============================================================================

export type MemoryType =
  | "code_pattern"
  | "bug_fix"
  | "decision"
  | "convention"
  | "scratchpad"
  | "relationship"
  | "code"        // Legacy: code snippet
  | "message"     // Legacy: conversation message
  | "thought"     // Legacy: agent thought
  | "observation" // Legacy: environment observation
  | "documentation" // Legacy: documentation
  | "error"       // Legacy: error record
  | "summary";    // Legacy: generated summary

export enum MemoryLayer {
  L1_WORKING = 1,
  L2_PROJECT = 2,
  L3_SEMANTIC = 3,
}

// ============================================================================
// Metadata Types
// ============================================================================

export interface FileContext {
  path: string;
  lineStart?: number;
  lineEnd?: number;
  language?: string;
}

export interface CodeBlock {
  code: string;
  language: string;
  filePath?: string;
}

export interface SessionContext {
  sessionId: string;
  commandHistory: string[];
  openFiles: string[];
  workingDirectory: string;
}

export interface RelationshipEdge {
  toMemoryId: string;
  relationType: "depends_on" | "replaces" | "relates_to" | "caused_by";
  strength: number; // 0-1
}

export interface MemoryMetadata {
  title?: string;
  tags: string[];
  fileContext?: FileContext;
  codeBlock?: CodeBlock;
  sessionContext?: SessionContext;
  relationships: RelationshipEdge[];
  confidence: number; // 0-1, AI-assigned confidence
  expirationDate?: Date; // For L1 memories
  source: "user_explicit" | "ai_inferred" | "system_auto";
  projectPath?: string;
  cliType: string;
  // 1–5, user-set priority. Default 3. Higher values rank above lower in recall and context window.
  weight?: number;
  // Allow additional legacy fields
  [key: string]: unknown;
}

// ============================================================================
// Core Memory Interface
// ============================================================================

export interface Memory {
  id: string;
  type: MemoryType;
  layer?: MemoryLayer;
  content: string;
  metadata?: MemoryMetadata;
  // Legacy: tags at top level (prefer metadata.tags)
  tags?: string[];
  embedding?: number[];
  createdAt: Date | number;
  updatedAt: Date | number;
  accessCount?: number;
  lastAccessedAt?: Date | number;
  ttl?: number; // seconds, for L1
  // Legacy fields for L2 storage
  relevanceScore?: number;
}

// Legacy MemoryEntry for L1 Working Memory
export interface MemoryEntry {
  memory: Memory;
  expiresAt: Date;
}

// Legacy ScoredMemory for L3 Semantic Memory
export interface ScoredMemory extends Memory {
  similarity: number;
}

// Legacy SummaryResult
export interface SummaryResult {
  summaryId: string;
  summarizedCount: number;
  summaryContent: string;
}

// ============================================================================
// CLI Capability Profile
// ============================================================================

export type CLIType = "kimi" | "claude" | "claude-code" | "opencode" | "codex" | "gemini" | "cursor" | "generic";

export interface UserPreferences {
  autoCapturePatterns: boolean;
  autoCaptureDecisions: boolean;
  scratchpadRetentionHours: number;
  maxContextMemories: number;
  preferredEmbeddingModel?: string;
}

export interface CLICapability {
  cliType: CLIType;
  version: string;
  maxContextTokens: number;
  supportedFeatures: string[];
  preferences: UserPreferences;
}

// ============================================================================
// Context Window (injected into CLI)
// ============================================================================

export interface CodePattern {
  id: string;
  name: string;
  description: string;
  code: string;
  language: string;
  usageCount: number;
  lastUsedAt?: Date;
  relatedFiles: string[];
}

export interface Suggestion {
  id: string;
  type: "pattern" | "memory" | "relationship" | "action";
  content: string;
  confidence: number;
  sourceMemoryIds: string[];
}

export interface GhostMessage {
  id: string;
  role: "system" | "user" | "assistant";
  content: string;
  timestamp: Date;
  isVisible: boolean; // false = ghost message
  trigger: string; // what triggered this ghost message
}

export interface ContextWindow {
  working: Memory[];
  relevant: Memory[];
  patterns: CodePattern[];
  suggestions: Suggestion[];
  ghostMessages: GhostMessage[];
}

// ============================================================================
// Events reported by CLI
// ============================================================================

export type CLIEventType =
  | "file_opened"
  | "command_executed"
  | "error_occurred"
  | "decision_made"
  | "session_start"
  | "session_end"
  | "pattern_detected"
  | "user_feedback";

export interface CLIEvent {
  type: CLIEventType;
  payload: Record<string, unknown>;
  timestamp: Date;
  sessionId: string;
  cliType: CLIType;
  projectPath?: string;
}

// ============================================================================
// Storage Interfaces
// ============================================================================

export interface RecallQuery {
  query: string;
  limit?: number;
  threshold?: number;
  filter?: {
    types?: MemoryType[];
    layers?: MemoryLayer[];
    tags?: string[];
    projectPath?: string;
    createdAfter?: Date;
    createdBefore?: Date;
  };
}

export interface RecallResult {
  memory: Memory;
  similarity: number;
}

export interface SummarizeOptions {
  targetTokens: number;
  focusTypes?: MemoryType[];
  includePatterns?: boolean;
  includeDecisions?: boolean;
}

// ============================================================================
// Tool Request/Response Types
// ============================================================================

export interface GetCurrentContextRequest {
  sessionId: string;
  currentFile?: string;
  currentCommand?: string;
}

export interface StoreMemoryRequest {
  type: MemoryType;
  layer: MemoryLayer;
  content: string;
  metadata: Omit<MemoryMetadata, "relationships"> & { relationships?: RelationshipEdge[] };
  ttl?: number;
}

export interface StoreMemoryResponse {
  id: string;
  success: boolean;
}

export interface RecallRequest extends RecallQuery {
  sessionId: string;
}

export interface RecallResponse {
  results: RecallResult[];
  total: number;
}

export interface SummarizeRequest {
  sessionId: string;
  options: SummarizeOptions;
}

export interface SummarizeResponse {
  summary: string;
  includedMemories: string[]; // memory IDs
  tokenCount: number;
}

export interface GetPatternsRequest {
  language?: string;
  filePath?: string;
  limit?: number;
}

export interface GetPatternsResponse {
  patterns: CodePattern[];
}

export interface ReportEventRequest {
  event: CLIEvent;
}

export interface ReportEventResponse {
  processed: boolean;
  triggeredActions?: string[];
}

export interface GhostRequest {
  sessionId: string;
  trigger: string;
  currentContext: string;
}

export interface GhostResponse {
  messages: GhostMessage[];
}

// ============================================================================
// Orientation Types (time + context awareness)
// ============================================================================

export interface OfflineGap {
  durationMs: number;
  durationHuman: string;   // "3 hours 42 minutes"
  from: string;            // ISO with UTC offset
  to: string;              // ISO with UTC offset
  memoriesAdded: number;
}

export interface OrientationContext {
  time: import('./time.js').TimeAnchor;
  projectPath: string;
  offlineGap: OfflineGap | null;   // null on first-ever session
  recentMemories: Memory[];         // memories created since last seen
  summary: string;                  // human-readable orientation paragraph
}

// ============================================================================
// Configuration Types
// ============================================================================

export interface FabricConfig {
  storage: {
    l2Path: string; // SQLite path
    l3Path: string; // SQLite + embeddings path
    backupIntervalHours: number;
  };
  ttl: {
    l1Default: number; // seconds (default: 1 hour)
    l3DecayDays: number; // days (default: 30 days)
    l3AccessThreshold: number; // min access count to persist
  };
  embedding: {
    model: string;
    dimension: number;
    batchSize: number;
  };
  context: {
    maxWorkingMemories: number;
    maxRelevantMemories: number;
    maxPatterns: number;
    maxSuggestions: number;
    maxGhostMessages: number;
  };
  cli: {
    defaultCapabilities: UserPreferences;
  };
  codeIndex: {
    enabled: boolean;
    maxFileSizeBytes: number;
    maxFiles: number;
    chunkLines: number;
    chunkOverlap: number;
    debounceMs: number;
    watchEnabled: boolean;
    excludePatterns: string[];
  };
}
