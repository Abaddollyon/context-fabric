/**
 * ContextEngine - The orchestrator
 * Manages all 3 layers, routes memories, builds context windows
 */

import {
  Memory,
  MemoryType,
  MemoryLayer,
  MemoryMetadata,
  CLICapability,
  CLIEvent,
  ContextWindow,
  GhostMessage,
  CodePattern,
  Suggestion,
  FabricConfig,
} from './types.js';
import { WorkingMemoryLayer } from './layers/working.js';
import { ProjectMemoryLayer } from './layers/project.js';
import { SemanticMemoryLayer, ScoredMemory } from './layers/semantic.js';
import { SmartRouter, RoutingDecision } from './router.js';
import { PatternExtractor, Violation } from './patterns.js';
import { EventHandler, EventResult } from './events.js';
import { getConfig, initialize, getStoragePaths } from './config.js';
import { TimeService } from './time.js';
import type { OrientationContext, OfflineGap } from './types.js';

// ============================================================================
// Type Definitions
// ============================================================================

export interface StoreOptions {
  layer?: MemoryLayer;
  metadata?: Record<string, unknown>;
  tags?: string[];
  ttl?: number;
}

export interface RecallOptions {
  limit?: number;
  layers?: MemoryLayer[];
  filter?: {
    types?: MemoryType[];
    tags?: string[];
    projectPath?: string;
  };
}

export interface RankedMemory extends ScoredMemory {
  layer: MemoryLayer;
}

export interface GhostResult {
  messages: GhostMessage[];
  relevantMemories: Memory[];
  suggestedActions: SuggestedAction[];
}

export interface SuggestedAction {
  id: string;
  type: 'pattern' | 'memory' | 'relationship' | 'action';
  content: string;
  confidence: number;
  sourceMemoryIds: string[];
}

export interface SummaryResult {
  summaryId: string;
  summarizedCount: number;
  summaryContent: string;
  layer: MemoryLayer;
}

export interface EngineOptions {
  projectPath: string;
  config?: FabricConfig;
  autoCleanup?: boolean;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  isEphemeral?: boolean; // use in-memory SQLite for L3 (useful for testing)
}

// ============================================================================
// ContextEngine Class
// ============================================================================

export class ContextEngine {
  l1: WorkingMemoryLayer;
  l2: ProjectMemoryLayer;
  l3: SemanticMemoryLayer;
  config: FabricConfig;
  projectPath: string;
  patternExtractor: PatternExtractor;
  eventHandler: EventHandler;
  private logLevel: 'debug' | 'info' | 'warn' | 'error';
  private cleanupIntervalId: ReturnType<typeof setInterval> | null = null;

  constructor(options: EngineOptions) {
    this.projectPath = options.projectPath;
    this.logLevel = options.logLevel || 'info';

    // Initialize config
    initialize();
    this.config = options.config || getConfig();

    // Initialize L1: Working Memory (in-memory, ephemeral)
    this.l1 = new WorkingMemoryLayer({
      maxSize: this.config.context.maxWorkingMemories * 2,
      defaultTTL: this.config.ttl.l1Default,
    });

    // Initialize L2: Project Memory (SQLite, persistent)
    const storagePaths = getStoragePaths();
    // In ephemeral mode use the per-project path so parallel tests don't share a db file
    this.l2 = new ProjectMemoryLayer(
      this.projectPath,
      options.isEphemeral ? undefined : storagePaths.l2Path
    );

    // Initialize L3: Semantic Memory (vector search)
    this.l3 = new SemanticMemoryLayer({
      baseDir: storagePaths.l3Path,
      decayDays: this.config.ttl.l3DecayDays,
      collectionName: 'semantic_memories',
      isEphemeral: options.isEphemeral,
    });

    // Initialize helpers
    this.patternExtractor = new PatternExtractor(this.l2, this.l3);
    this.eventHandler = new EventHandler(this);

    // Start auto-cleanup if enabled
    if (options.autoCleanup !== false) {
      this.l1.startCleanupInterval(60000); // Every minute
      this.startDecayInterval();
    }

    this.log('info', `ContextEngine initialized for ${this.projectPath}`);
  }

  // ============================================================================
  // Core Operations
  // ============================================================================

  /**
   * Auto-route storage based on content type and metadata
   */
  async store(content: string, type: MemoryType, options: StoreOptions = {}): Promise<Memory> {
    // Use SmartRouter to determine layer if not specified
    let targetLayer = options.layer;
    let routingReason = 'Layer explicitly specified';

    if (targetLayer === undefined) {
      const decision = SmartRouter.route(
        content,
        type,
        options.metadata,
        options.tags,
        options.ttl
      );
      targetLayer = decision.layer;
      routingReason = SmartRouter.explainRouting(decision);
      this.log('debug', `Routing decision: ${routingReason}`);
    }

    // Prepare metadata
    const metadata: MemoryMetadata = {
      tags: options.tags || [],
      relationships: [],
      confidence: (options.metadata?.confidence as number) ?? 0.8,
      source: (options.metadata?.source as 'user_explicit' | 'ai_inferred' | 'system_auto') ?? 'ai_inferred',
      cliType: (options.metadata?.cliType as string) ?? 'generic',
      projectPath: this.projectPath,
      ...options.metadata,
    };

    // Store in appropriate layer
    let memory: Memory;

    switch (targetLayer) {
      case MemoryLayer.L1_WORKING:
        memory = this.l1.store(content, type, metadata, options.ttl);
        break;

      case MemoryLayer.L2_PROJECT:
        memory = await this.l2.store(content, type, metadata, options.tags);
        break;

      case MemoryLayer.L3_SEMANTIC:
        memory = await this.l3.store(content, type, metadata);
        break;

      default:
        throw new Error(`Invalid memory layer: ${targetLayer}`);
    }

    memory.layer = targetLayer;
    this.log('debug', `Stored ${type} in L${targetLayer}: ${memory.id}`);

    return memory;
  }

  /**
   * Build context window for CLI injection
   * Returns: L1 all + top 5 relevant from L2 + top 5 from L3
   */
  async getContextWindow(cliCapabilities?: CLICapability): Promise<ContextWindow> {
    const maxWorking = cliCapabilities?.preferences?.maxContextMemories
      ?? this.config.context.maxWorkingMemories;
    const maxRelevant = this.config.context.maxRelevantMemories;
    const maxPatterns = this.config.context.maxPatterns;
    const maxSuggestions = this.config.context.maxSuggestions;

    // L1: Get all working memories (session context)
    const working = this.l1.getAll().slice(0, maxWorking);

    // L2: Get recent project memories
    const recentL2 = await this.l2.getRecent(5);

    // L3: Get relevant semantic memories based on working context
    const l3Relevant: ScoredMemory[] = [];
    if (working.length > 0) {
      // Use recent working memories as query context
      const query = working
        .slice(0, 3)
        .map((m) => m.content)
        .join(' ');

      const semanticResults = await this.l3.recall(query, 5);
      l3Relevant.push(...semanticResults);
    }

    // Combine L2 and L3 for relevant memories
    const relevant: Memory[] = [
      ...recentL2.map((m) => ({ ...m, relevanceScore: 0.8 })),
      ...l3Relevant.map((m) => ({ ...m, relevanceScore: m.similarity })),
    ]
      .sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0))
      .slice(0, maxRelevant);

    // Get patterns
    const patterns = await this.patternExtractor.extractPatterns(this.projectPath);
    const rankedPatterns = this.patternExtractor.rankPatterns(patterns, {
      language: working.find((m) => m.metadata?.fileContext?.language)?.metadata?.fileContext
        ?.language,
    });

    // Generate suggestions based on context
    const suggestions = await this.generateSuggestions(working, relevant, rankedPatterns);

    // Get ghost messages
    const ghostMessages = await this.generateGhostMessages(working, relevant);

    return {
      working,
      relevant,
      patterns: rankedPatterns.slice(0, maxPatterns),
      suggestions: suggestions.slice(0, maxSuggestions),
      ghostMessages,
    };
  }

  /**
   * Semantic recall across all layers
   */
  async recall(query: string, options: RecallOptions = {}): Promise<RankedMemory[]> {
    const limit = options.limit ?? 10;
    const layers = options.layers ?? [MemoryLayer.L1_WORKING, MemoryLayer.L2_PROJECT, MemoryLayer.L3_SEMANTIC];
    const results: RankedMemory[] = [];

    // Search L3 (semantic) if included
    if (layers.includes(MemoryLayer.L3_SEMANTIC)) {
      const l3Results = await this.l3.recall(query, limit);
      for (const r of l3Results) {
        if (this.matchesFilter(r, options.filter)) {
          results.push({ ...r, layer: MemoryLayer.L3_SEMANTIC });
        }
      }
    }

    // Search L2 (project) if included
    if (layers.includes(MemoryLayer.L2_PROJECT)) {
      const l2Results = await this.l2.search(query);
      for (const r of l2Results) {
        if (this.matchesFilter(r, options.filter)) {
          results.push({ ...r, layer: MemoryLayer.L2_PROJECT, similarity: 0.7 });
        }
      }
    }

    // Search L1 (working) if included
    if (layers.includes(MemoryLayer.L1_WORKING)) {
      const l1Results = this.l1.getAll();
      for (const r of l1Results) {
        if (r.content.toLowerCase().includes(query.toLowerCase()) && this.matchesFilter(r, options.filter)) {
          results.push({ ...r, layer: MemoryLayer.L1_WORKING, similarity: 0.5 });
        }
      }
    }

    // Sort by relevance and limit
    return results
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  /**
   * Promote memory up layers (L1→L2, L2→L3)
   */
  async promote(memoryId: string, fromLayer: MemoryLayer): Promise<Memory> {
    let memory: Memory | undefined;

    // Get from source layer
    switch (fromLayer) {
      case MemoryLayer.L1_WORKING:
        memory = this.l1.get(memoryId);
        break;
      case MemoryLayer.L2_PROJECT:
        memory = await this.l2.get(memoryId);
        break;
      case MemoryLayer.L3_SEMANTIC:
        memory = await this.l3.get(memoryId);
        break;
    }

    if (!memory) {
      throw new Error(`Memory ${memoryId} not found in L${fromLayer}`);
    }

    // Store in target layer
    const targetLayer = fromLayer + 1;
    if (targetLayer > MemoryLayer.L3_SEMANTIC) {
      throw new Error('Cannot promote beyond L3');
    }

    const newMemory = await this.store(memory.content, memory.type, {
      layer: targetLayer,
      metadata: memory.metadata,
      tags: memory.tags,
    });

    // Delete from source layer
    if (fromLayer === MemoryLayer.L1_WORKING) {
      this.l1.delete(memoryId);
    } else {
      await this.demote(memoryId, fromLayer);
    }

    this.log('info', `Promoted memory ${memoryId} from L${fromLayer} to L${targetLayer}`);

    return newMemory;
  }

  /**
   * Demote memory down layers (for archiving)
   */
  async demote(memoryId: string, fromLayer: MemoryLayer): Promise<void> {
    switch (fromLayer) {
      case MemoryLayer.L1_WORKING:
        this.l1.touch(memoryId); // L1 demote = touch only, not delete
        break;
      case MemoryLayer.L2_PROJECT:
        await this.l2.delete(memoryId);
        break;
      case MemoryLayer.L3_SEMANTIC:
        await this.l3.delete(memoryId);
        break;
    }

    this.log('debug', `Demoted/deleted memory ${memoryId} from L${fromLayer}`);
  }

  /**
   * Handle CLI events
   */
  async handleEvent(event: CLIEvent): Promise<EventResult> {
    this.log('debug', `Handling event: ${event.type}`);
    return this.eventHandler.handleEvent(event);
  }

  /**
   * Get ghost suggestions
   */
  async ghost(): Promise<GhostResult> {
    // Get recent L2 memories
    const recentL2 = await this.l2.getRecent(5);

    // Get patterns
    const patterns = await this.patternExtractor.extractPatterns(this.projectPath);

    // Get working memories for context
    const working = this.l1.getAll();

    // Generate ghost messages
    const messages = await this.generateGhostMessages(working, recentL2);

    // Generate suggested actions
    const suggestedActions = await this.generateSuggestions(working, recentL2, patterns);

    return {
      messages,
      relevantMemories: recentL2,
      suggestedActions,
    };
  }

  /**
   * Summarize old memories in a layer
   */
  async summarize(layer: MemoryLayer, olderThanDays: number): Promise<SummaryResult> {
    if (layer === MemoryLayer.L1_WORKING) {
      throw new Error('Cannot summarize L1 - memories are ephemeral');
    }

    if (layer === MemoryLayer.L2_PROJECT) {
      const result = await this.l2.summarize(olderThanDays);
      return {
        ...result,
        layer: MemoryLayer.L2_PROJECT,
      };
    }

    if (layer === MemoryLayer.L3_SEMANTIC) {
      // L3 uses decay instead of explicit summarization
      const affectedCount = await this.l3.applyDecay();
      return {
        summaryId: `decay_${Date.now()}`,
        summarizedCount: affectedCount,
        summaryContent: `Applied decay to ${affectedCount} memories in L3`,
        layer: MemoryLayer.L3_SEMANTIC,
      };
    }

    throw new Error(`Invalid layer: ${layer}`);
  }

  /**
   * Orientation loop — "Where am I in time? What happened while I was offline?
   * What project am I in? What matters next?"
   */
  async orient(timezone?: string): Promise<OrientationContext> {
    const ts = new TimeService();
    const anchor = ts.now(timezone);

    const lastSeenMs = this.l2.getLastSeen();

    let offlineGap: OfflineGap | null = null;
    let recentMemories = [] as import('./types.js').Memory[];

    if (lastSeenMs !== null) {
      const durationMs = anchor.epochMs - lastSeenMs;
      const fromAnchor = ts.convert(lastSeenMs, anchor.timezone);
      offlineGap = {
        durationMs,
        durationHuman: ts.formatDuration(durationMs),
        from: fromAnchor.iso,
        to: anchor.iso,
        memoriesAdded: 0,
      };
      recentMemories = this.l2.getMemoriesSince(lastSeenMs);
      offlineGap.memoriesAdded = recentMemories.length;
    }

    // Record this session start
    this.l2.updateLastSeen(anchor.epochMs);

    // Build human-readable summary
    const lines: string[] = [];
    lines.push(`It is ${anchor.timeOfDay} on ${anchor.date} (${anchor.timezone}, UTC${anchor.utcOffset}).`);
    lines.push(`Project: ${this.projectPath}`);
    if (offlineGap) {
      if (offlineGap.durationMs < 30000) {
        lines.push('You were just here moments ago.');
      } else {
        lines.push(`Last session: ${offlineGap.durationHuman} ago (since ${ts.convert(lastSeenMs!, anchor.timezone).timeOfDay}).`);
      }
      if (offlineGap.memoriesAdded > 0) {
        lines.push(`${offlineGap.memoriesAdded} new ${offlineGap.memoriesAdded === 1 ? 'memory was' : 'memories were'} added while offline.`);
      } else {
        lines.push('No new memories were added while offline.');
      }
    } else {
      lines.push('First session in this project.');
    }

    return {
      time: anchor,
      projectPath: this.projectPath,
      offlineGap,
      recentMemories,
      summary: lines.join(' '),
    };
  }

  /**
   * Close all layers and cleanup
   */
  close(): void {
    this.log('info', 'Closing ContextEngine...');

    // Stop intervals
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
    }
    this.l1.stopCleanupInterval();

    // Close layers
    this.l1.clear();
    this.l2.close();
    this.l3.close();

    this.log('info', 'ContextEngine closed');
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  /**
   * Generate suggestions based on current context
   */
  private async generateSuggestions(
    working: Memory[],
    relevant: Memory[],
    patterns: CodePattern[]
  ): Promise<SuggestedAction[]> {
    const suggestions: SuggestedAction[] = [];

    // Suggest recent decisions
    const decisions = relevant.filter((m) => m.type === 'decision').slice(0, 2);
    for (const decision of decisions) {
      suggestions.push({
        id: `suggest_decision_${decision.id}`,
        type: 'memory',
        content: `Previous decision: ${decision.content.substring(0, 100)}...`,
        confidence: 0.8,
        sourceMemoryIds: [decision.id],
      });
    }

    // Suggest patterns
    for (const pattern of patterns.slice(0, 2)) {
      suggestions.push({
        id: `suggest_pattern_${pattern.id}`,
        type: 'pattern',
        content: `Pattern: ${pattern.name} - ${pattern.description.substring(0, 80)}`,
        confidence: pattern.usageCount > 5 ? 0.9 : 0.7,
        sourceMemoryIds: [pattern.id],
      });
    }

    // Suggest bug fixes if errors in working or relevant memory
    const errors = [...working, ...relevant].filter((m) => m.type === 'error' || m.type === 'bug_fix');
    if (errors.length > 0) {
      suggestions.push({
        id: 'suggest_fix_recent',
        type: 'action',
        content: `Recent errors detected. Check for similar issues.`,
        confidence: 0.75,
        sourceMemoryIds: errors.map((e) => e.id),
      });
    }

    // Suggest exploration of related memories
    if (relevant.length > 0) {
      suggestions.push({
        id: 'suggest_explore',
        type: 'action',
        content: `Explore ${relevant.length} related memories from this project`,
        confidence: 0.6,
        sourceMemoryIds: relevant.slice(0, 3).map((m) => m.id),
      });
    }

    return suggestions;
  }

  /**
   * Generate ghost messages (invisible context injections)
   */
  private async generateGhostMessages(
    working: Memory[],
    relevant: Memory[]
  ): Promise<GhostMessage[]> {
    const messages: GhostMessage[] = [];

    // Session context ghost
    if (working.length > 0) {
      const recentFiles = working
        .filter((m) => m.metadata?.fileContext?.path)
        .map((m) => m.metadata?.fileContext?.path as string)
        .slice(0, 3);

      if (recentFiles.length > 0) {
        messages.push({
          id: `ghost_files_${Date.now()}`,
          role: 'system',
          content: `Recently opened files: ${recentFiles.join(', ')}`,
          timestamp: new Date(),
          isVisible: false,
          trigger: 'session_context',
        });
      }
    }

    // Recent decisions ghost
    const recentDecisions = relevant.filter((m) => m.type === 'decision').slice(0, 2);
    for (const decision of recentDecisions) {
      messages.push({
        id: `ghost_decision_${decision.id}`,
        role: 'system',
        content: `Previous decision: ${decision.content.substring(0, 200)}`,
        timestamp: new Date(decision.updatedAt),
        isVisible: false,
        trigger: 'relevant_decision',
      });
    }

    // Bug fix reminder ghost
    const recentFixes = relevant.filter((m) => m.type === 'bug_fix').slice(0, 1);
    for (const fix of recentFixes) {
      messages.push({
        id: `ghost_fix_${fix.id}`,
        role: 'system',
        content: `Previous bug fix: ${fix.content.substring(0, 200)}`,
        timestamp: new Date(fix.updatedAt),
        isVisible: false,
        trigger: 'bug_fix_context',
      });
    }

    return messages.slice(0, this.config.context.maxGhostMessages);
  }

  /**
   * Check if memory matches filter criteria
   */
  private matchesFilter(
    memory: Memory,
    filter?: RecallOptions['filter']
  ): boolean {
    if (!filter) return true;

    if (filter.types && !filter.types.includes(memory.type)) {
      return false;
    }

    if (filter.tags) {
      const memoryTags = memory.tags || memory.metadata?.tags || [];
      if (!filter.tags.some((t) => memoryTags.includes(t))) {
        return false;
      }
    }

    if (filter.projectPath && memory.metadata?.projectPath !== filter.projectPath) {
      return false;
    }

    return true;
  }

  /**
   * Start L3 decay interval
   */
  private startDecayInterval(): void {
    // Apply decay every hour
    this.cleanupIntervalId = setInterval(async () => {
      try {
        const affected = await this.l3.applyDecay();
        if (affected > 0) {
          this.log('debug', `Applied decay to ${affected} L3 memories`);
        }
      } catch (error) {
        this.log('error', 'Decay application failed:', error);
      }
    }, 3600000);
  }

  /**
   * Logging helper
   */
  private log(level: 'debug' | 'info' | 'warn' | 'error', ...args: unknown[]): void {
    const levels = ['debug', 'info', 'warn', 'error'];
    if (levels.indexOf(level) >= levels.indexOf(this.logLevel)) {
      console.error(`[ContextEngine:${level.toUpperCase()}]`, ...args);
    }
  }
}

export default ContextEngine;
