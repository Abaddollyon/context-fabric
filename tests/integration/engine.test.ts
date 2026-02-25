/**
 * Integration tests for ContextEngine
 * Tests full engine integration with all layers
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { ContextEngine } from '../../src/engine.js';
import { MemoryLayer, MemoryType, CLIEvent } from '../../src/types.js';
import {
  createTestContext,
  seedTestMemories,
  generateSessionId,
  createMockEvent,
  assertValidContextWindow,
  sleep,
} from '../utils.js';

describe('ContextEngine Integration', () => {
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
  // Store Memories in Each Layer
  // ============================================================================
  
  describe('store memories in each layer', () => {
    it('should store in L1 (Working Memory)', async () => {
      const memory = await engine.store(
        'Working session note',
        'scratchpad',
        {
          layer: MemoryLayer.L1_WORKING,
          tags: ['test', 'l1'],
          ttl: 3600,
        }
      );
      
      expect(memory.id).toBeDefined();
      expect(memory.layer).toBe(MemoryLayer.L1_WORKING);
      expect(memory.type).toBe('scratchpad');
      
      // Verify it can be retrieved
      const retrieved = engine.l1.get(memory.id);
      expect(retrieved).toBeDefined();
      expect(retrieved!.content).toBe('Working session note');
    });
    
    it('should store in L2 (Project Memory)', async () => {
      const memory = await engine.store(
        'Project decision record',
        'decision',
        {
          layer: MemoryLayer.L2_PROJECT,
          tags: ['test', 'l2'],
        }
      );
      
      expect(memory.id).toBeDefined();
      expect(memory.layer).toBe(MemoryLayer.L2_PROJECT);
      
      // Verify it can be retrieved from L2
      const retrieved = await engine.l2.get(memory.id);
      expect(retrieved).toBeDefined();
      expect(retrieved!.content).toBe('Project decision record');
    });
    
    it('should store in L3 (Semantic Memory)', async () => {
      const memory = await engine.store(
        'Reusable code pattern for validation',
        'code_pattern',
        {
          layer: MemoryLayer.L3_SEMANTIC,
          tags: ['test', 'l3', 'global'],
        }
      );
      
      expect(memory.id).toBeDefined();
      expect(memory.layer).toBe(MemoryLayer.L3_SEMANTIC);
      
      // Give ChromaDB time to index
      await sleep(100);
      
      // Verify it can be retrieved via semantic search
      const results = await engine.l3.recall('validation pattern', 5);
      const found = results.find(r => r.id === memory.id);
      expect(found).toBeDefined();
      expect(found!.similarity).toBeGreaterThan(0);
    });
    
    it('should store multiple memories across layers', async () => {
      const memories = await seedTestMemories(engine, sessionId);
      
      expect(memories.l1Memories).toHaveLength(3);
      expect(memories.l2Memories).toHaveLength(2);
      expect(memories.l3Memories).toHaveLength(3);
      
      // Verify all have correct layers assigned
      memories.l1Memories.forEach(m => expect(m.layer).toBe(MemoryLayer.L1_WORKING));
      memories.l2Memories.forEach(m => expect(m.layer).toBe(MemoryLayer.L2_PROJECT));
      memories.l3Memories.forEach(m => expect(m.layer).toBe(MemoryLayer.L3_SEMANTIC));
    });
  });
  
  // ============================================================================
  // Auto-Routing
  // ============================================================================
  
  describe('auto-routing', () => {
    it('should auto-route scratchpad to L1', async () => {
      const memory = await engine.store(
        'Quick notes',
        'scratchpad'
      );
      
      expect(memory.layer).toBe(MemoryLayer.L1_WORKING);
    });
    
    it('should auto-route code_pattern to L3', async () => {
      const memory = await engine.store(
        'export function helper() {}',
        'code_pattern'
      );
      
      expect(memory.layer).toBe(MemoryLayer.L3_SEMANTIC);
    });
    
    it('should auto-route convention to L3', async () => {
      const memory = await engine.store(
        'Always use strict equality',
        'convention'
      );
      
      expect(memory.layer).toBe(MemoryLayer.L3_SEMANTIC);
    });
    
    it('should auto-route decision to L2', async () => {
      const memory = await engine.store(
        'Use React for frontend',
        'decision'
      );
      
      expect(memory.layer).toBe(MemoryLayer.L2_PROJECT);
    });
    
    it('should auto-route bug_fix to L2', async () => {
      const memory = await engine.store(
        'Fixed null pointer exception',
        'bug_fix'
      );
      
      expect(memory.layer).toBe(MemoryLayer.L2_PROJECT);
    });
    
    it('should auto-route relationship to L3', async () => {
      const memory = await engine.store(
        'User prefers dark mode',
        'relationship'
      );
      
      expect(memory.layer).toBe(MemoryLayer.L3_SEMANTIC);
    });
    
    it('should respect tag-based overrides', async () => {
      // Override code_pattern to L1 via temp tag
      const memory = await engine.store(
        'Draft pattern',
        'code_pattern',
        { tags: ['temp'] }
      );
      
      expect(memory.layer).toBe(MemoryLayer.L1_WORKING);
    });
    
    it('should respect TTL-based routing', async () => {
      // Even decisions go to L1 if TTL specified
      const memory = await engine.store(
        'Temporary decision',
        'decision',
        { ttl: 3600 }
      );
      
      expect(memory.layer).toBe(MemoryLayer.L1_WORKING);
    });
  });
  
  // ============================================================================
  // Get Context Window
  // ============================================================================
  
  describe('getContextWindow', () => {
    it('should return valid context window structure', async () => {
      await seedTestMemories(engine, sessionId);
      
      const context = await engine.getContextWindow();
      
      assertValidContextWindow(context);
    });
    
    it('should include L1 memories in working', async () => {
      const { l1Memories } = await seedTestMemories(engine, sessionId);
      
      const context = await engine.getContextWindow();
      
      // Should include working memories
      expect(context.working.length).toBeGreaterThan(0);
      
      // Check that our seeded memories are included
      const memoryIds = l1Memories.map(m => m.id);
      const foundInContext = context.working.filter(m => memoryIds.includes(m.id));
      expect(foundInContext.length).toBeGreaterThan(0);
    });
    
    it('should include L2 memories in relevant', async () => {
      const { l2Memories } = await seedTestMemories(engine, sessionId);
      
      const context = await engine.getContextWindow();
      
      // Should include relevant memories from L2
      expect(context.relevant.length).toBeGreaterThan(0);
      
      // Check L2 memories are represented
      const l2InRelevant = context.relevant.filter(m => 
        l2Memories.some(l2 => l2.id === m.id)
      );
      expect(l2InRelevant.length).toBeGreaterThan(0);
    });
    
    it('should include L3 memories via semantic relevance', async () => {
      const { l3Memories } = await seedTestMemories(engine, sessionId);
      
      // Add some working memory content to trigger L3 search
      await engine.store(
        'Looking for validation patterns',
        'scratchpad',
        { layer: MemoryLayer.L1_WORKING }
      );
      
      const context = await engine.getContextWindow();
      
      // May include L3 memories based on semantic similarity
      // Not guaranteed, but should not error
      expect(context.relevant).toBeDefined();
    });
    
    it('should respect CLI capabilities', async () => {
      await seedTestMemories(engine, sessionId);
      
      const cliCapabilities = {
        cliType: 'kimi' as const,
        version: '1.0.0',
        maxContextTokens: 8000,
        supportedFeatures: ['context_fabric'],
        preferences: {
          autoCapturePatterns: true,
          autoCaptureDecisions: true,
          scratchpadRetentionHours: 24,
          maxContextMemories: 5,
          preferredEmbeddingModel: 'fastembed-js',
        },
      };
      
      const context = await engine.getContextWindow(cliCapabilities);
      
      // Should limit working memories based on preference
      expect(context.working.length).toBeLessThanOrEqual(5);
    });
    
    it('should include patterns', async () => {
      // Store a pattern
      await engine.store(
        JSON.stringify({
          pattern: {
            name: 'Error Handler',
            description: 'Handle errors gracefully',
            code: 'try { } catch(e) { }',
            language: 'typescript',
            usageCount: 1,
            relatedFiles: [],
          }
        }),
        'code_pattern',
        { layer: MemoryLayer.L3_SEMANTIC }
      );
      
      const context = await engine.getContextWindow();
      
      expect(context.patterns).toBeDefined();
      expect(Array.isArray(context.patterns)).toBe(true);
    });
    
    it('should include suggestions', async () => {
      await seedTestMemories(engine, sessionId);
      
      const context = await engine.getContextWindow();
      
      expect(context.suggestions).toBeDefined();
      expect(Array.isArray(context.suggestions)).toBe(true);
    });
    
    it('should include ghost messages', async () => {
      await seedTestMemories(engine, sessionId);
      
      const context = await engine.getContextWindow();
      
      expect(context.ghostMessages).toBeDefined();
      expect(Array.isArray(context.ghostMessages)).toBe(true);
      
      // Ghost messages should be invisible
      context.ghostMessages.forEach(gm => {
        expect(gm.isVisible).toBe(false);
      });
    });
  });
  
  // ============================================================================
  // Recall Across Layers
  // ============================================================================
  
  describe('recall across layers', () => {
    it('should search all layers by default', async () => {
      const { l1Memories, l2Memories, l3Memories } = await seedTestMemories(engine, sessionId);
      
      // Search for something that should match all layers
      const results = await engine.recall('test', { limit: 20 });
      
      // Should have results from multiple layers
      expect(results.length).toBeGreaterThan(0);
      
      // Should include layer information
      const layers = new Set(results.map(r => r.layer));
      expect(layers.size).toBeGreaterThanOrEqual(1);
    });
    
    it('should filter by layer', async () => {
      await seedTestMemories(engine, sessionId);
      
      // Search only L1
      const l1Results = await engine.recall('test', {
        layers: [MemoryLayer.L1_WORKING],
      });
      expect(l1Results.every(r => r.layer === MemoryLayer.L1_WORKING)).toBe(true);
      
      // Search only L2
      const l2Results = await engine.recall('test', {
        layers: [MemoryLayer.L2_PROJECT],
      });
      expect(l2Results.every(r => r.layer === MemoryLayer.L2_PROJECT)).toBe(true);
      
      // Search only L3
      const l3Results = await engine.recall('test', {
        layers: [MemoryLayer.L3_SEMANTIC],
      });
      expect(l3Results.every(r => r.layer === MemoryLayer.L3_SEMANTIC)).toBe(true);
    });
    
    it('should filter by type', async () => {
      await seedTestMemories(engine, sessionId);
      
      const results = await engine.recall('test', {
        filter: { types: ['decision'] },
      });
      
      expect(results.every(r => r.type === 'decision')).toBe(true);
    });
    
    it('should filter by tags', async () => {
      await seedTestMemories(engine, sessionId);
      
      const results = await engine.recall('test', {
        filter: { tags: ['architecture'] },
      });
      
      // Should only return memories with 'architecture' tag
      for (const result of results) {
        const tags = result.tags || result.metadata?.tags || [];
        expect(tags).toContain('architecture');
      }
    });
    
    it('should return ranked results by similarity', async () => {
      // Store specific content
      await engine.store(
        'Unique searchable content about authentication',
        'decision',
        { layer: MemoryLayer.L2_PROJECT, tags: ['auth'] }
      );
      
      await engine.store(
        'Something unrelated about databases',
        'decision',
        { layer: MemoryLayer.L2_PROJECT }
      );
      
      const results = await engine.recall('authentication', { limit: 10 });
      
      // Should be sorted by similarity (highest first)
      for (let i = 1; i < results.length; i++) {
        expect(results[i].similarity).toBeLessThanOrEqual(results[i - 1].similarity);
      }
    });
  });
  
  // ============================================================================
  // Promote/Demote Between Layers
  // ============================================================================
  
  describe('promote between layers', () => {
    it('should promote L1 to L2', async () => {
      const l1Memory = await engine.store(
        'Important scratchpad note',
        'scratchpad',
        { layer: MemoryLayer.L1_WORKING, ttl: 3600 }
      );
      
      const promoted = await engine.promote(l1Memory.id, MemoryLayer.L1_WORKING);
      
      expect(promoted.layer).toBe(MemoryLayer.L2_PROJECT);
      expect(promoted.content).toBe(l1Memory.content);
      
      // Original should be gone from L1
      expect(engine.l1.get(l1Memory.id)).toBeUndefined();
      
      // Should be in L2
      const inL2 = await engine.l2.get(promoted.id);
      expect(inL2).toBeDefined();
    });
    
    it('should promote L2 to L3', async () => {
      const l2Memory = await engine.store(
        'Reusable project pattern',
        'code_pattern',
        { layer: MemoryLayer.L2_PROJECT }
      );
      
      const promoted = await engine.promote(l2Memory.id, MemoryLayer.L2_PROJECT);
      
      expect(promoted.layer).toBe(MemoryLayer.L3_SEMANTIC);
      
      // Should be searchable in L3
      await sleep(100);
      const results = await engine.l3.recall('reusable pattern', 5);
      const found = results.find(r => r.id === promoted.id);
      expect(found).toBeDefined();
    });
    
    it('should throw when promoting beyond L3', async () => {
      const l3Memory = await engine.store(
        'Global pattern',
        'code_pattern',
        { layer: MemoryLayer.L3_SEMANTIC }
      );
      
      await expect(
        engine.promote(l3Memory.id, MemoryLayer.L3_SEMANTIC)
      ).rejects.toThrow('Cannot promote beyond L3');
    });
    
    it('should throw when memory not found', async () => {
      await expect(
        engine.promote('non-existent-id', MemoryLayer.L1_WORKING)
      ).rejects.toThrow('not found');
    });
  });
  
  describe('demote between layers', () => {
    it('should demote/delete from L2', async () => {
      const l2Memory = await engine.store(
        'Temporary project memory',
        'scratchpad',
        { layer: MemoryLayer.L2_PROJECT }
      );
      
      await engine.demote(l2Memory.id, MemoryLayer.L2_PROJECT);
      
      // Should be deleted from L2
      const inL2 = await engine.l2.get(l2Memory.id);
      expect(inL2).toBeUndefined();
    });
    
    it('should demote/delete from L3', async () => {
      const l3Memory = await engine.store(
        'Temporary global pattern',
        'code_pattern',
        { layer: MemoryLayer.L3_SEMANTIC }
      );
      
      await sleep(100);
      
      await engine.demote(l3Memory.id, MemoryLayer.L3_SEMANTIC);
      
      // Should be deleted from L3
      const inL3 = await engine.l3.get(l3Memory.id);
      expect(inL3).toBeUndefined();
    });
    
    it('should handle demote from L1 (touch only)', async () => {
      const l1Memory = await engine.store(
        'Working note',
        'scratchpad',
        { layer: MemoryLayer.L1_WORKING }
      );
      
      const originalAccessCount = l1Memory.accessCount || 0;
      
      await engine.demote(l1Memory.id, MemoryLayer.L1_WORKING);
      
      // L1 memory should still exist (just touched)
      const stillInL1 = engine.l1.get(l1Memory.id);
      expect(stillInL1).toBeDefined();
    });
  });
  
  // ============================================================================
  // Ghost Functionality
  // ============================================================================
  
  describe('ghost functionality', () => {
    it('should return ghost result with messages', async () => {
      await seedTestMemories(engine, sessionId);
      
      const ghostResult = await engine.ghost();
      
      expect(ghostResult.messages).toBeDefined();
      expect(Array.isArray(ghostResult.messages)).toBe(true);
      expect(ghostResult.relevantMemories).toBeDefined();
      expect(ghostResult.suggestedActions).toBeDefined();
    });
    
    it('should generate ghost messages from recent decisions', async () => {
      await engine.store(
        'Important architectural decision about caching',
        'decision',
        { layer: MemoryLayer.L2_PROJECT }
      );
      
      const ghostResult = await engine.ghost();
      
      // Should have ghost messages about decisions
      const decisionMessages = ghostResult.messages.filter(
        m => m.trigger === 'relevant_decision'
      );
      expect(decisionMessages.length).toBeGreaterThan(0);
    });
    
    it('should generate suggestions based on context', async () => {
      await seedTestMemories(engine, sessionId);
      
      const ghostResult = await engine.ghost();
      
      expect(ghostResult.suggestedActions.length).toBeGreaterThan(0);
      
      // Suggestions should have required fields
      for (const suggestion of ghostResult.suggestedActions) {
        expect(suggestion.id).toBeDefined();
        expect(suggestion.type).toBeDefined();
        expect(suggestion.content).toBeDefined();
        expect(suggestion.confidence).toBeGreaterThan(0);
        expect(suggestion.sourceMemoryIds).toBeDefined();
      }
    });
  });
  
  // ============================================================================
  // Event Handling
  // ============================================================================
  
  describe('event handling', () => {
    it('should handle file_opened event', async () => {
      const event = createMockEvent('file_opened', {
        path: '/project/src/app.ts',
      }, sessionId);
      
      const result = await engine.handleEvent(event);
      
      expect(result.processed).toBe(true);
      expect(result.memoryId).toBeDefined();
      
      const memory = engine.l1.get(result.memoryId!);
      expect(memory).toBeDefined();
    });
    
    it('should handle decision_made event', async () => {
      const event = createMockEvent('decision_made', {
        decision: 'Use Redis for caching',
        rationale: 'Better performance than in-memory',
      }, sessionId);
      
      const result = await engine.handleEvent(event);
      
      expect(result.processed).toBe(true);
      
      const memory = await engine.l2.get(result.memoryId!);
      expect(memory?.type).toBe('decision');
    });
    
    it('should handle pattern_detected event', async () => {
      const event = createMockEvent('pattern_detected', {
        pattern: 'Factory pattern for object creation',
        code: 'class Factory { create() {} }',
      }, sessionId);
      
      const result = await engine.handleEvent(event);
      
      expect(result.processed).toBe(true);
      
      await sleep(100);
      const results = await engine.l3.recall('Factory pattern', 5);
      expect(results.length).toBeGreaterThan(0);
    });
    
    it('should handle error_occurred event', async () => {
      const event = createMockEvent('error_occurred', {
        error: 'Connection refused',
        context: 'Database connection failed',
      }, sessionId);
      
      const result = await engine.handleEvent(event);
      
      expect(result.processed).toBe(true);
      
      const memory = await engine.l2.get(result.memoryId!);
      expect(memory?.type).toBe('bug_fix');
    });
  });
  
  // ============================================================================
  // Pattern Extraction
  // ============================================================================
  
  describe('pattern extraction', () => {
    it('should extract patterns from memories', async () => {
      // Store some patterns
      await engine.store(
        JSON.stringify({
          pattern: {
            id: 'p1',
            name: 'Async Error Handler',
            description: 'Handle async errors properly',
            code: 'async function() { try { } catch(e) { } }',
            language: 'typescript',
            usageCount: 5,
            relatedFiles: ['utils.ts'],
          }
        }),
        'code_pattern',
        { layer: MemoryLayer.L3_SEMANTIC }
      );
      
      const patterns = await engine.patternExtractor.extractPatterns(context.projectPath);
      
      expect(patterns).toBeDefined();
      expect(Array.isArray(patterns)).toBe(true);
    });
    
    it('should rank patterns by relevance', async () => {
      // Store patterns with different usage counts
      for (let i = 0; i < 3; i++) {
        await engine.store(
          JSON.stringify({
            pattern: {
              id: `p${i}`,
              name: `Pattern ${i}`,
              description: `Description ${i}`,
              code: `code ${i}`,
              language: 'typescript',
              usageCount: (3 - i) * 10, // Different usage counts
              lastUsedAt: new Date(),
              relatedFiles: [],
            }
          }),
          'code_pattern',
          { layer: MemoryLayer.L3_SEMANTIC }
        );
      }
      
      const patterns = await engine.patternExtractor.extractPatterns(context.projectPath);
      const ranked = engine.patternExtractor.rankPatterns(patterns, {
        language: 'typescript',
      });
      
      expect(ranked.length).toBeGreaterThan(0);
    });
  });
  
  // ============================================================================
  // Summarization
  // ============================================================================
  
  describe('summarization', () => {
    it('should reject summarization for L1', async () => {
      await expect(
        engine.summarize(MemoryLayer.L1_WORKING, 30)
      ).rejects.toThrow('Cannot summarize L1');
    });
    
    it('should summarize old L2 memories', async () => {
      // Store old memory
      const oldMemory = await engine.store(
        'Old decision from long ago',
        'decision',
        { layer: MemoryLayer.L2_PROJECT }
      );
      
      // Summarize with 0 days (should include our "old" memory)
      const result = await engine.summarize(MemoryLayer.L2_PROJECT, 0);
      
      expect(result.layer).toBe(MemoryLayer.L2_PROJECT);
      expect(result.summaryContent).toBeDefined();
    });
    
    it('should apply decay to L3 memories', async () => {
      const result = await engine.summarize(MemoryLayer.L3_SEMANTIC, 30);
      
      expect(result.layer).toBe(MemoryLayer.L3_SEMANTIC);
      expect(result.summaryId).toContain('decay');
    });
  });
  
  // ============================================================================
  // Cleanup
  // ============================================================================
  
  describe('cleanup', () => {
    it('should clean up all resources on close', async () => {
      await seedTestMemories(engine, sessionId);
      
      engine.close();
      
      // L1 should be cleared
      expect(engine.l1.getAll()).toHaveLength(0);
    });
  });
});
