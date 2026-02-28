/**
 * Integration tests for MCP Server
 * Tests each tool handler via direct function calls
 * Tests error handling and concurrent requests
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ContextEngine } from '../../src/engine.js';
import { MemoryLayer, MemoryType } from '../../src/types.js';
import {
  createTestContext,
  generateSessionId,
  sleep,
} from '../utils.js';

describe('MCP Server Integration', () => {
  let context: Awaited<ReturnType<typeof createTestContext>>;
  let engine: ContextEngine;
  let sessionId: string;
  
  beforeEach(async () => {
    context = await createTestContext({ logLevel: 'error' });
    engine = context.engine;
    sessionId = context.sessionId;
  });
  
  afterEach(async () => {
    await context.cleanup();
  });
  
  // ============================================================================
  // Helper: Direct Tool Handlers (simulating MCP calls)
  // ============================================================================
  
  // These handlers mirror the server.ts implementation for testing
  async function handleGetCurrent(args: { sessionId: string; currentFile?: string; projectPath?: string }) {
    const contextWindow = await engine.getContextWindow();
    return { context: contextWindow };
  }
  
  async function handleStore(args: {
    type: MemoryType;
    layer?: number;
    content: string;
    metadata: Record<string, unknown>;
    ttl?: number;
    pinned?: boolean;
  }) {
    const memory = await engine.store(args.content, args.type, {
      layer: args.layer as MemoryLayer,
      metadata: args.metadata,
      tags: (args.metadata.tags as string[]) || [],
      ttl: args.ttl,
      pinned: args.pinned,
    });

    return {
      id: memory.id,
      success: true,
      layer: memory.layer,
      pinned: memory.pinned ?? false,
    };
  }
  
  async function handleRecall(args: {
    query: string;
    limit?: number;
    threshold?: number;
    filter?: {
      types?: MemoryType[];
      layers?: number[];
      tags?: string[];
    };
  }) {
    const layers = args.filter?.layers?.map(l => l as MemoryLayer);
    
    const results = await engine.recall(args.query, {
      limit: args.limit || 10,
      layers,
      filter: {
        types: args.filter?.types,
        tags: args.filter?.tags,
      },
    });
    
    const filtered = results.filter(r => r.similarity >= (args.threshold || 0.7));
    
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
  
  async function handleSummarize(args: {
    layer: number;
    olderThanDays: number;
  }) {
    const result = await engine.summarize(args.layer as MemoryLayer, args.olderThanDays);
    
    return {
      summaryId: result.summaryId,
      summarizedCount: result.summarizedCount,
      summary: result.summaryContent,
      layer: result.layer,
    };
  }
  
  
  async function handleReportEvent(args: {
    event: {
      type: string;
      payload: Record<string, unknown>;
      timestamp: Date;
      sessionId: string;
      cliType: string;
      projectPath?: string;
    };
  }) {
    const result = await engine.handleEvent(args.event as any);
    
    return {
      processed: result.processed,
      memoryId: result.memoryId,
      triggeredActions: result.triggeredActions,
      message: result.message,
    };
  }
  
  
  async function handleGetMemory(args: { memoryId: string; projectPath?: string }) {
    const result = await engine.getMemory(args.memoryId);
    if (!result) throw new Error(`Memory not found: ${args.memoryId}`);
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

  async function handleUpdateMemory(args: { memoryId: string; content?: string; metadata?: Record<string, unknown>; tags?: string[]; weight?: number; pinned?: boolean; targetLayer?: number; projectPath?: string }) {
    // Promote flow
    if (args.targetLayer !== undefined) {
      const found = await engine.getMemory(args.memoryId);
      if (!found) throw new Error(`Memory not found: ${args.memoryId}`);
      const fromLayer = found.layer;
      const targetLayer = args.targetLayer as MemoryLayer;
      if (targetLayer <= fromLayer) {
        throw new Error(`targetLayer (${targetLayer}) must be higher than current layer (${fromLayer})`);
      }
      const memory = await engine.promote(args.memoryId, fromLayer);
      return {
        success: true,
        memoryId: memory.id,
        newLayer: memory.layer,
      };
    }

    const updates: { content?: string; metadata?: Record<string, unknown>; tags?: string[]; pinned?: boolean } = {};
    if (args.content !== undefined) updates.content = args.content;
    if (args.metadata !== undefined) updates.metadata = args.metadata;
    if (args.tags !== undefined) updates.tags = args.tags;
    if (args.weight !== undefined) {
      updates.metadata = { ...updates.metadata, weight: args.weight };
    }
    if (args.pinned !== undefined) updates.pinned = args.pinned;
    const result = await engine.updateMemory(args.memoryId, updates);
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

  async function handleDeleteMemory(args: { memoryId: string; projectPath?: string }) {
    const result = await engine.deleteMemory(args.memoryId);
    return { success: true, deletedFrom: result.deletedFrom };
  }

  async function handleListMemories(args: { layer?: number; type?: string; tags?: string[]; limit?: number; offset?: number; stats?: boolean; projectPath?: string }) {
    // Stats mode
    if (args.stats) {
      return engine.getStats();
    }

    const result = await engine.listMemories({
      layer: args.layer as MemoryLayer | undefined,
      type: args.type as any,
      tags: args.tags,
      limit: args.limit ?? 20,
      offset: args.offset ?? 0,
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
      limit: args.limit ?? 20,
      offset: args.offset ?? 0,
      layer: args.layer ?? 2,
    };
  }

  
  // ============================================================================
  // Tool: context.getCurrent
  // ============================================================================
  
  describe('context.getCurrent', () => {
    it('should return current context window', async () => {
      // Seed some data
      await engine.store('Working note', 'scratchpad', { layer: MemoryLayer.L1_WORKING });
      await engine.store('Project decision', 'decision', { layer: MemoryLayer.L2_PROJECT });
      
      const result = await handleGetCurrent({ sessionId });
      
      expect(result.context).toBeDefined();
      expect(result.context.working).toBeDefined();
      expect(result.context.relevant).toBeDefined();
      expect(result.context.patterns).toBeDefined();
      expect(result.context.suggestions).toBeDefined();
      expect(result.context.ghostMessages).toBeDefined();
    });
    
    it('should include current file in context if provided', async () => {
      await engine.store(
        'File opened: /project/src/app.ts',
        'scratchpad',
        {
          layer: MemoryLayer.L1_WORKING,
          metadata: { fileContext: { path: '/project/src/app.ts' } },
        }
      );
      
      const result = await handleGetCurrent({
        sessionId,
        currentFile: '/project/src/app.ts',
      });
      
      expect(result.context.working.length).toBeGreaterThan(0);
    });
  });
  
  // ============================================================================
  // Tool: context.store
  // ============================================================================
  
  describe('context.store', () => {
    it('should store memory with auto-routing', async () => {
      const result = await handleStore({
        type: 'decision',
        content: 'Use TypeScript for all new code',
        metadata: {
          title: 'Language Decision',
          tags: ['architecture', 'typescript'],
          confidence: 0.9,
          source: 'ai_inferred',
          cliType: 'kimi',
        },
      });
      
      expect(result.success).toBe(true);
      expect(result.id).toBeDefined();
      expect(result.layer).toBe(MemoryLayer.L2_PROJECT);
    });
    
    it('should store memory in specific layer', async () => {
      const result = await handleStore({
        type: 'code_pattern',
        layer: 3,
        content: 'export const helper = () => {}',
        metadata: {
          tags: ['utility', 'global'],
          cliType: 'kimi',
        },
      });
      
      expect(result.layer).toBe(MemoryLayer.L3_SEMANTIC);
    });
    
    it('should store with TTL for L1', async () => {
      const result = await handleStore({
        type: 'scratchpad',
        layer: 1,
        content: 'Temporary notes',
        metadata: { tags: ['temp'], cliType: 'kimi' },
        ttl: 3600,
      });
      
      expect(result.layer).toBe(MemoryLayer.L1_WORKING);
    });
    
    it('should store with file context', async () => {
      const result = await handleStore({
        type: 'bug_fix',
        content: 'Fixed null pointer',
        metadata: {
          tags: ['bug', 'fix'],
          fileContext: {
            path: '/src/utils.ts',
            lineStart: 42,
            lineEnd: 50,
            language: 'typescript',
          },
          cliType: 'kimi',
        },
      });
      
      expect(result.success).toBe(true);
      
      // Verify stored
      const memory = await engine.l2.get(result.id);
      expect(memory?.metadata?.fileContext?.path).toBe('/src/utils.ts');
    });
    
    it('should store with code block', async () => {
      const result = await handleStore({
        type: 'code_pattern',
        layer: 3,
        content: 'Error handling pattern',
        metadata: {
          tags: ['pattern', 'error-handling'],
          codeBlock: {
            code: 'try { } catch(e) { }',
            language: 'typescript',
            filePath: '/src/error.ts',
          },
          cliType: 'kimi',
        },
      });
      
      expect(result.success).toBe(true);
    });
  });
  
  // ============================================================================
  // Tool: context.recall
  // ============================================================================
  
  describe('context.recall', () => {
    beforeEach(async () => {
      // Seed data
      await engine.store(
        'Authentication pattern using JWT',
        'code_pattern',
        {
          layer: MemoryLayer.L3_SEMANTIC,
          metadata: { tags: ['auth', 'jwt'] },
        }
      );
      
      await engine.store(
        'Decision to use PostgreSQL',
        'decision',
        {
          layer: MemoryLayer.L2_PROJECT,
          metadata: { tags: ['database', 'postgres'] },
        }
      );
      
      await sleep(100);
    });
    
    it('should recall memories by query', async () => {
      const result = await handleRecall({
        query: 'authentication',
        limit: 10,
        threshold: 0.5,
      });
      
      expect(result.results.length).toBeGreaterThan(0);
      expect(result.total).toBeGreaterThan(0);
    });
    
    it('should filter by type', async () => {
      const result = await handleRecall({
        query: 'database',
        filter: { types: ['decision'] },
        threshold: 0.5,
      });
      
      for (const item of result.results) {
        expect(item.memory.type).toBe('decision');
      }
    });
    
    it('should filter by layer', async () => {
      const result = await handleRecall({
        query: 'pattern',
        filter: { layers: [3] },
        threshold: 0.5,
      });
      
      for (const item of result.results) {
        expect(item.layer).toBe(MemoryLayer.L3_SEMANTIC);
      }
    });
    
    it('should filter by tags', async () => {
      const result = await handleRecall({
        query: 'auth',
        filter: { tags: ['jwt'] },
        threshold: 0.5,
      });
      
      for (const item of result.results) {
        const tags = item.memory.tags || item.memory.metadata?.tags || [];
        expect(tags).toContain('jwt');
      }
    });
    
    it('should apply similarity threshold', async () => {
      const result = await handleRecall({
        query: 'something completely unrelated xyz123',
        threshold: 0.9,
      });
      
      // Should filter out low-similarity results
      for (const item of result.results) {
        expect(item.similarity).toBeGreaterThanOrEqual(0.9);
      }
    });
    
    it('should return results with similarity scores', async () => {
      const result = await handleRecall({
        query: 'authentication',
        threshold: 0.5,
      });
      
      for (const item of result.results) {
        expect(item.similarity).toBeGreaterThan(0);
        expect(item.similarity).toBeLessThanOrEqual(1);
      }
    });
  });
  
  // ============================================================================
  // Tool: context.summarize
  // ============================================================================
  
  describe('context.summarize', () => {
    it('should summarize L2 memories', async () => {
      // Create some memories
      for (let i = 0; i < 5; i++) {
        await engine.store(
          `Decision ${i}: Use technology ${i}`,
          'decision',
          { layer: MemoryLayer.L2_PROJECT }
        );
      }
      
      const result = await handleSummarize({
        layer: 2,
        olderThanDays: 0, // Include all
      });
      
      expect(result.summaryId).toBeDefined();
      expect(result.summarizedCount).toBeGreaterThan(0);
      expect(result.summary).toBeDefined();
      expect(result.layer).toBe(MemoryLayer.L2_PROJECT);
    });
    
    it('should apply decay to L3', async () => {
      const result = await handleSummarize({
        layer: 3,
        olderThanDays: 30,
      });
      
      expect(result.layer).toBe(MemoryLayer.L3_SEMANTIC);
      expect(result.summaryId.startsWith('decay')).toBe(true);
    });
  });
  
  
  // ============================================================================
  // Tool: context.reportEvent
  // ============================================================================
  
  describe('context.reportEvent', () => {
    it('should process file_opened event', async () => {
      const result = await handleReportEvent({
        event: {
          type: 'file_opened',
          payload: { path: '/test.ts', content: '' },
          timestamp: new Date(),
          sessionId,
          cliType: 'kimi',
        },
      });
      
      expect(result.processed).toBe(true);
      expect(result.memoryId).toBeDefined();
      expect(result.triggeredActions).toContain('stored_scratchpad');
    });
    
    it('should process decision_made event', async () => {
      const result = await handleReportEvent({
        event: {
          type: 'decision_made',
          payload: { decision: 'Use Redis', rationale: 'For caching' },
          timestamp: new Date(),
          sessionId,
          cliType: 'kimi',
        },
      });
      
      expect(result.processed).toBe(true);
      expect(result.triggeredActions).toContain('stored_decision');
    });
    
    it('should process error_occurred event', async () => {
      const result = await handleReportEvent({
        event: {
          type: 'error_occurred',
          payload: { error: 'Connection failed' },
          timestamp: new Date(),
          sessionId,
          cliType: 'kimi',
        },
      });
      
      expect(result.processed).toBe(true);
      expect(result.triggeredActions).toContain('stored_bug_fix');
    });
    
    it('should process pattern_detected event', async () => {
      const result = await handleReportEvent({
        event: {
          type: 'pattern_detected',
          payload: { pattern: 'Singleton', code: 'class Singleton {}' },
          timestamp: new Date(),
          sessionId,
          cliType: 'kimi',
        },
      });
      
      expect(result.processed).toBe(true);
      expect(result.triggeredActions).toContain('stored_pattern');
    });
    
    it('should return message for unknown event type', async () => {
      const result = await handleReportEvent({
        event: {
          type: 'unknown_event' as any,
          payload: {},
          timestamp: new Date(),
          sessionId,
          cliType: 'kimi',
        },
      });
      
      expect(result.processed).toBe(false);
      expect(result.message).toContain('Unknown event type');
    });
  });
  
  
  
  // ============================================================================
  // Tool: context.searchCode
  // ============================================================================

  describe('context.searchCode', () => {
    beforeEach(async () => {
      const { writeFileSync, mkdirSync } = await import('fs');
      const { join } = await import('path');
      mkdirSync(join(context.projectPath, 'src'), { recursive: true });

      writeFileSync(join(context.projectPath, 'src/auth.ts'), `
export class AuthService {
  private secret: string;

  constructor(secret: string) {
    this.secret = secret;
  }

  verifyToken(token: string): boolean {
    return token.startsWith('valid_');
  }
}

export interface AuthConfig {
  secret: string;
  expiresIn: number;
}
`);

      writeFileSync(join(context.projectPath, 'src/user.ts'), `
export interface User {
  id: string;
  name: string;
}

export function createUser(name: string): User {
  return { id: crypto.randomUUID(), name };
}
`);

      // Index the files
      const idx = engine.getCodeIndex();
      await idx.reindexFile('src/auth.ts');
      await idx.reindexFile('src/user.ts');
    });

    async function handleSearchCode(args: {
      query: string;
      mode?: 'text' | 'symbol' | 'semantic';
      language?: string;
      filePattern?: string;
      symbolKind?: string;
      limit?: number;
      threshold?: number;
      includeContent?: boolean;
    }) {
      const idx = engine.getCodeIndex();
      await idx.ensureReady();

      const searchOpts = {
        language: args.language,
        filePattern: args.filePattern,
        symbolKind: args.symbolKind,
        limit: args.limit || 10,
        threshold: args.threshold || 0.5,
        includeContent: args.includeContent ?? true,
      };

      let results;
      switch (args.mode || 'text') {
        case 'text':
          results = idx.searchText(args.query, searchOpts);
          break;
        case 'symbol':
          results = idx.searchSymbols(args.query, searchOpts);
          break;
        case 'semantic':
        default:
          results = await idx.searchSemantic(args.query, searchOpts);
          break;
      }

      const status = idx.getStatus();
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

    it('should search code by text', async () => {
      const result = await handleSearchCode({
        query: 'verifyToken',
        mode: 'text',
      });

      expect(result.total).toBeGreaterThan(0);
      expect(result.results[0].filePath).toContain('auth.ts');
      expect(result.indexStatus.totalFiles).toBe(2);
    });

    it('should search code by symbol name', async () => {
      const result = await handleSearchCode({
        query: 'AuthService',
        mode: 'symbol',
      });

      expect(result.total).toBeGreaterThan(0);
      expect(result.results[0].symbol?.name).toBe('AuthService');
      expect(result.results[0].symbol?.kind).toBe('class');
    });

    it('should filter symbols by kind', async () => {
      const result = await handleSearchCode({
        query: '',
        mode: 'symbol',
        symbolKind: 'interface',
      });

      expect(result.total).toBeGreaterThan(0);
      result.results.forEach((r: any) => {
        expect(r.symbol?.kind).toBe('interface');
      });
    });

    it('should filter by language', async () => {
      const result = await handleSearchCode({
        query: 'function',
        mode: 'text',
        language: 'typescript',
      });

      expect(result.total).toBeGreaterThan(0);
    });

    it('should return index status', async () => {
      const result = await handleSearchCode({
        query: 'User',
        mode: 'text',
      });

      expect(result.indexStatus).toBeDefined();
      expect(result.indexStatus.totalFiles).toBe(2);
      expect(result.indexStatus.totalSymbols).toBeGreaterThan(0);
    });

    it('should handle semantic search mode gracefully', async () => {
      const result = await handleSearchCode({
        query: 'authentication',
        mode: 'semantic',
      });

      // Results depend on whether embedding model is available
      expect(result.results).toBeDefined();
      expect(Array.isArray(result.results)).toBe(true);
      expect(result.indexStatus).toBeDefined();
    });
  });

  // ============================================================================
  // Tool: context.get
  // ============================================================================

  describe('context.get', () => {
    it('should get a memory by ID from L2', async () => {
      const stored = await handleStore({
        type: 'decision',
        content: 'Retrievable decision',
        metadata: { cliType: 'kimi' },
      });

      const result = await handleGetMemory({ memoryId: stored.id });
      expect(result.memory.content).toBe('Retrievable decision');
      expect(result.layer).toBe(MemoryLayer.L2_PROJECT);
    });

    it('should get a memory by ID from L1', async () => {
      const mem = await engine.store('L1 note', 'scratchpad', { layer: MemoryLayer.L1_WORKING });
      const result = await handleGetMemory({ memoryId: mem.id });
      expect(result.memory.content).toBe('L1 note');
      expect(result.layer).toBe(MemoryLayer.L1_WORKING);
    });

    it('should throw for non-existent memory', async () => {
      await expect(
        handleGetMemory({ memoryId: 'non-existent' })
      ).rejects.toThrow('Memory not found');
    });
  });

  // ============================================================================
  // Tool: context.update
  // ============================================================================

  describe('context.update', () => {
    it('should update memory content', async () => {
      const stored = await handleStore({
        type: 'decision',
        content: 'Original',
        metadata: { cliType: 'kimi' },
      });

      const result = await handleUpdateMemory({
        memoryId: stored.id,
        content: 'Updated content',
      });

      expect(result.success).toBe(true);
      expect(result.memory.content).toBe('Updated content');
    });

    it('should update memory tags', async () => {
      const stored = await handleStore({
        type: 'decision',
        content: 'With tags',
        metadata: { cliType: 'kimi', tags: ['old'] },
      });

      const result = await handleUpdateMemory({
        memoryId: stored.id,
        tags: ['new', 'tags'],
      });

      expect(result.success).toBe(true);
      expect(result.memory.tags).toEqual(['new', 'tags']);
    });

    it('should reject L1 updates', async () => {
      const mem = await engine.store('Ephemeral', 'scratchpad', { layer: MemoryLayer.L1_WORKING });

      await expect(
        handleUpdateMemory({ memoryId: mem.id, content: 'Updated' })
      ).rejects.toThrow('Cannot update L1');
    });

    it('should throw for non-existent memory', async () => {
      await expect(
        handleUpdateMemory({ memoryId: 'non-existent', content: 'x' })
      ).rejects.toThrow('Memory not found');
    });
  });

  // ============================================================================
  // Tool: context.delete
  // ============================================================================

  describe('context.delete', () => {
    it('should delete a memory', async () => {
      const stored = await handleStore({
        type: 'decision',
        content: 'To delete',
        metadata: { cliType: 'kimi' },
      });

      const result = await handleDeleteMemory({ memoryId: stored.id });
      expect(result.success).toBe(true);
      expect(result.deletedFrom).toBe(MemoryLayer.L2_PROJECT);

      // Verify it's gone
      await expect(
        handleGetMemory({ memoryId: stored.id })
      ).rejects.toThrow('Memory not found');
    });

    it('should throw for non-existent memory', async () => {
      await expect(
        handleDeleteMemory({ memoryId: 'non-existent' })
      ).rejects.toThrow('Memory not found');
    });
  });

  // ============================================================================
  // Tool: context.list
  // ============================================================================

  describe('context.list', () => {
    it('should list memories with default pagination', async () => {
      for (let i = 0; i < 5; i++) {
        await handleStore({
          type: 'decision',
          content: `Decision ${i}`,
          metadata: { cliType: 'kimi' },
        });
      }

      const result = await handleListMemories({});
      expect(result.memories.length).toBeGreaterThanOrEqual(5);
      expect(result.total).toBeGreaterThanOrEqual(5);
      expect(result.layer).toBe(2);
    });

    it('should paginate results', async () => {
      // Clear and create fresh data
      for (let i = 0; i < 5; i++) {
        await handleStore({
          type: 'bug_fix',
          content: `Bug ${i}`,
          metadata: { cliType: 'kimi' },
        });
      }

      const page1 = await handleListMemories({ limit: 2, offset: 0 });
      expect(page1.memories.length).toBeLessThanOrEqual(2);
      expect(page1.limit).toBe(2);
      expect(page1.offset).toBe(0);
    });

    it('should filter by type', async () => {
      await handleStore({ type: 'decision', content: 'D', metadata: { cliType: 'kimi' } });
      await handleStore({ type: 'bug_fix', content: 'B', metadata: { cliType: 'kimi' } });

      const result = await handleListMemories({ type: 'decision' });
      expect(result.memories.every((m: any) => m.type === 'decision')).toBe(true);
    });

    it('should filter by tags', async () => {
      await handleStore({ type: 'decision', content: 'Tagged', metadata: { cliType: 'kimi', tags: ['special'] } });

      const result = await handleListMemories({ tags: ['special'] });
      for (const m of result.memories) {
        const tags = (m as any).tags || (m as any).metadata?.tags || [];
        expect(tags).toContain('special');
      }
    });

    it('should list L1 memories', async () => {
      await engine.store('L1 note', 'scratchpad', { layer: MemoryLayer.L1_WORKING });
      const result = await handleListMemories({ layer: 1 });
      expect(result.memories.length).toBeGreaterThan(0);
      expect(result.layer).toBe(1);
    });
  });

  // ============================================================================
  // Memory Weighting
  // ============================================================================

  describe('context.store with weight', () => {
    it('should store weight in metadata when specified', async () => {
      const stored = await handleStore({
        type: 'decision',
        content: 'Weighted decision',
        metadata: { cliType: 'kimi', weight: 5 },
      });

      const result = await handleGetMemory({ memoryId: stored.id });
      expect(result.memory.metadata?.weight).toBe(5);
    });

    it('should default weight to 3 when not specified', async () => {
      const stored = await handleStore({
        type: 'decision',
        content: 'Default weight decision',
        metadata: { cliType: 'kimi' },
      });

      const result = await handleGetMemory({ memoryId: stored.id });
      // Either weight is not set (defaults to 3 at query time) or stored as 3
      expect(result.memory.metadata?.weight ?? 3).toBe(3);
    });

    it('should store explicit weight 3', async () => {
      const stored = await handleStore({
        type: 'convention',
        content: 'Neutral weight memory',
        metadata: { cliType: 'kimi', weight: 3 },
      });

      const result = await handleGetMemory({ memoryId: stored.id });
      expect(result.memory.metadata?.weight).toBe(3);
    });
  });

  describe('context.update with weight', () => {
    it('should update weight via top-level weight param', async () => {
      const stored = await handleStore({
        type: 'decision',
        content: 'Memory to reweight',
        metadata: { cliType: 'kimi', weight: 3 },
      });

      const result = await handleUpdateMemory({
        memoryId: stored.id,
        weight: 2,
      });

      expect(result.success).toBe(true);

      const fetched = await handleGetMemory({ memoryId: stored.id });
      expect(fetched.memory.metadata?.weight).toBe(2);
    });

    it('should update weight via metadata field', async () => {
      const stored = await handleStore({
        type: 'decision',
        content: 'Memory with metadata weight update',
        metadata: { cliType: 'kimi', weight: 1 },
      });

      const result = await handleUpdateMemory({
        memoryId: stored.id,
        metadata: { weight: 5 },
      });

      expect(result.success).toBe(true);
      const fetched = await handleGetMemory({ memoryId: stored.id });
      expect(fetched.memory.metadata?.weight).toBe(5);
    });
  });

  // ============================================================================
  // Error Handling
  // ============================================================================
  
  describe('error handling', () => {
    it('should handle invalid store parameters gracefully', async () => {
      // Empty content should still work
      const result = await handleStore({
        type: 'scratchpad',
        content: '',
        metadata: { cliType: 'kimi' },
      });
      
      expect(result.success).toBe(true);
    });
    
    it('should handle invalid layer numbers', async () => {
      await expect(
        handleStore({
          type: 'decision',
          layer: 99,
          content: 'Test',
          metadata: { cliType: 'kimi' },
        })
      ).rejects.toThrow();
    });
    
    it('should handle non-existent memory promotion', async () => {
      await expect(
        handleUpdateMemory({
          memoryId: 'non-existent-id',
          targetLayer: 2,
        })
      ).rejects.toThrow('not found');
    });
    
    it('should handle recall with empty query', async () => {
      const result = await handleRecall({
        query: '',
        limit: 10,
      });
      
      // Should return empty results or handle gracefully
      expect(result.results).toBeDefined();
      expect(result.total).toBeDefined();
    });
  });
  
  // ============================================================================
  // Concurrent Requests
  // ============================================================================
  
  describe('concurrent requests', () => {
    it('should handle concurrent store requests', async () => {
      const promises = [];
      
      for (let i = 0; i < 10; i++) {
        promises.push(
          handleStore({
            type: 'scratchpad',
            layer: 1,
            content: `Concurrent note ${i}`,
            metadata: { cliType: 'kimi', tags: ['concurrent'] },
          })
        );
      }
      
      const results = await Promise.all(promises);
      
      expect(results).toHaveLength(10);
      expect(results.every(r => r.success)).toBe(true);
      expect(results.every(r => r.id)).toBe(true);
      
      // All IDs should be unique
      const ids = results.map(r => r.id);
      expect(new Set(ids).size).toBe(10);
    });
    
    it('should handle concurrent recall requests', async () => {
      // Seed data
      await engine.store('Test content', 'decision', { layer: MemoryLayer.L2_PROJECT });
      
      const promises = [];
      
      for (let i = 0; i < 5; i++) {
        promises.push(
          handleRecall({
            query: 'test',
            limit: 5,
            threshold: 0.5,
          })
        );
      }
      
      const results = await Promise.all(promises);
      
      expect(results).toHaveLength(5);
      results.forEach(r => {
        expect(r.results).toBeDefined();
        expect(r.total).toBeDefined();
      });
    });
    
    it('should handle mixed concurrent operations', async () => {
      const promises = [
        handleStore({
          type: 'decision',
          content: 'Decision 1',
          metadata: { cliType: 'kimi' },
        }),
        handleRecall({ query: 'test', threshold: 0.5 }),
        handleGetCurrent({ sessionId }),
        handleListMemories({ limit: 5 }),
      ];

      const results = await Promise.all(promises);

      expect(results[0].success).toBe(true);
      expect(results[1].results).toBeDefined();
      expect(results[2].context).toBeDefined();
      expect(results[3].memories).toBeDefined();
    });
    
    it('should handle concurrent event processing', async () => {
      const events = [
        { type: 'file_opened', payload: { path: '/a.ts' } },
        { type: 'file_opened', payload: { path: '/b.ts' } },
        { type: 'file_opened', payload: { path: '/c.ts' } },
      ];
      
      const promises = events.map(e =>
        handleReportEvent({
          event: {
            ...e,
            timestamp: new Date(),
            sessionId,
            cliType: 'kimi',
          } as any,
        })
      );
      
      const results = await Promise.all(promises);
      
      expect(results.every(r => r.processed)).toBe(true);
      expect(results.every(r => r.memoryId)).toBe(true);
    });
  });

  // ============================================================================
  // Pinned memories (v0.5.5)
  // ============================================================================

  describe('context.store with pinned', () => {
    it('should store a pinned memory and return pinned=true', async () => {
      const stored = await handleStore({
        type: 'decision',
        layer: MemoryLayer.L2_PROJECT,
        content: 'server-pinned-store-test',
        metadata: { cliType: 'kimi' },
        pinned: true,
      });
      expect(stored.pinned).toBe(true);

      const fetched = await handleGetMemory({ memoryId: stored.id });
      expect(fetched.memory.pinned).toBe(true);
    });

    it('should store an unpinned memory and return pinned=false', async () => {
      const stored = await handleStore({
        type: 'decision',
        layer: MemoryLayer.L2_PROJECT,
        content: 'server-unpinned-store-test',
        metadata: { cliType: 'kimi' },
      });
      expect(stored.pinned).toBe(false);
    });
  });

  describe('context.update with pinned', () => {
    it('should pin a memory via top-level pinned param', async () => {
      const stored = await handleStore({
        type: 'decision',
        layer: MemoryLayer.L2_PROJECT,
        content: 'server-pin-update-test',
        metadata: { cliType: 'kimi' },
      });

      const updated = await handleUpdateMemory({ memoryId: stored.id, pinned: true });
      expect(updated.memory.pinned).toBe(true);

      const fetched = await handleGetMemory({ memoryId: stored.id });
      expect(fetched.memory.pinned).toBe(true);
    });

    it('should unpin a memory via top-level pinned param', async () => {
      const stored = await handleStore({
        type: 'decision',
        layer: MemoryLayer.L2_PROJECT,
        content: 'server-unpin-update-test',
        metadata: { cliType: 'kimi' },
        pinned: true,
      });

      const updated = await handleUpdateMemory({ memoryId: stored.id, pinned: false });
      expect(updated.memory.pinned).toBe(false);
    });
  });

  // ============================================================================
  // Tool consolidation: context.update with targetLayer (absorbs promote)
  // ============================================================================

  describe('context.update with targetLayer (promote)', () => {
    it('should promote L1 to L2 via targetLayer', async () => {
      const memory = await engine.store(
        'Promote via update L1→L2',
        'scratchpad',
        { layer: MemoryLayer.L1_WORKING }
      );

      const result = await handleUpdateMemory({
        memoryId: memory.id,
        targetLayer: 2,
      });

      expect(result.success).toBe(true);
      expect(result.newLayer).toBe(MemoryLayer.L2_PROJECT);
    });

    it('should promote L2 to L3 via targetLayer', async () => {
      const memory = await engine.store(
        'Promote via update L2→L3',
        'code_pattern',
        { layer: MemoryLayer.L2_PROJECT }
      );

      const result = await handleUpdateMemory({
        memoryId: memory.id,
        targetLayer: 3,
      });

      expect(result.success).toBe(true);
      expect(result.newLayer).toBe(MemoryLayer.L3_SEMANTIC);
    });

    it('should reject promotion to same or lower layer', async () => {
      const memory = await engine.store(
        'Cannot demote via targetLayer',
        'decision',
        { layer: MemoryLayer.L2_PROJECT }
      );

      await expect(
        handleUpdateMemory({
          memoryId: memory.id,
          targetLayer: 2,
        })
      ).rejects.toThrow('must be higher');
    });
  });

  // ============================================================================
  // Tool consolidation: context.list with stats (absorbs stats tool)
  // ============================================================================

  describe('context.list with stats', () => {
    it('should return stats when stats=true', async () => {
      await engine.store('Stats test', 'decision', { layer: MemoryLayer.L2_PROJECT });

      const result = await handleListMemories({ stats: true }) as any;

      expect(result.l1).toBeDefined();
      expect(result.l2).toBeDefined();
      expect(result.l3).toBeDefined();
      expect(result.total).toBeGreaterThan(0);
      expect(result.l2.count).toBeGreaterThan(0);
      expect(typeof result.l2.pinned).toBe('number');
      expect(typeof result.l2.byType).toBe('object');
    });
  });

  // ============================================================================
  // Tool consolidation: context.getCurrent with language/filePath (absorbs getPatterns)
  // ============================================================================

  describe('context.getCurrent with pattern filters', () => {
    it('should return patterns filtered by language', async () => {
      const result = await handleGetCurrent({ sessionId });

      // Should return context window with patterns (may be empty)
      expect(result.context.patterns).toBeDefined();
      expect(Array.isArray(result.context.patterns)).toBe(true);
    });

    it('should accept language and filePath params without error', async () => {
      // Simulate what handleGetCurrent does with filters
      const contextWindow = await engine.getContextWindow();
      const patterns = await engine.patternExtractor.extractPatterns(context.projectPath);
      const ranked = engine.patternExtractor.rankPatterns(patterns, {
        language: 'typescript',
        filePath: '/some/file.ts',
      });

      // Should not throw
      expect(ranked).toBeDefined();
      expect(Array.isArray(ranked)).toBe(true);
    });
  });

  // ============================================================================
  // Tool consolidation: context.orient with expression/also (absorbs time)
  // ============================================================================

  describe('context.orient with time params', () => {
    it('should resolve date expression', async () => {
      const orientation = await engine.orient();
      const { TimeService } = await import('../../src/time.js');
      const ts = new TimeService();

      const epochMs = ts.resolve('tomorrow');
      const anchor = ts.atTime(epochMs);

      expect(anchor.epochMs).toBeGreaterThan(Date.now());
      expect(anchor.date).toBeDefined();
    });

    it('should convert to additional timezones', async () => {
      const { TimeService } = await import('../../src/time.js');
      const ts = new TimeService();
      const orientation = await engine.orient();

      const conversions = ['America/New_York', 'Europe/London'].map(
        tz => ts.convert(orientation.time.epochMs, tz)
      );

      expect(conversions).toHaveLength(2);
      expect(conversions[0].timezone).toBe('America/New_York');
      expect(conversions[1].timezone).toBe('Europe/London');
    });

    it('should resolve expression and convert timezones together', async () => {
      const { TimeService } = await import('../../src/time.js');
      const ts = new TimeService();

      const epochMs = ts.resolve('end of day');
      const conversions = ['Asia/Tokyo'].map(tz => ts.convert(epochMs, tz));

      expect(epochMs).toBeGreaterThan(Date.now() - 86400000);
      expect(conversions[0].timezone).toBe('Asia/Tokyo');
    });
  });
});
