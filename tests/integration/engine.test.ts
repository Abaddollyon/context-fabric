/**
 * Integration tests for ContextEngine
 * Tests full engine integration with all layers
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
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

/** Skip L3 tests when the ONNX embedding model isn't available (e.g. CI) */
const hasEmbeddingModel = existsSync(
  resolve('local_cache', 'fast-bge-small-en', 'tokenizer.json')
);

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

    it.skipIf(!hasEmbeddingModel)('should store in L3 (Semantic Memory)', async () => {
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

      // Give L3 time to index
      await sleep(100);

      // Verify it can be retrieved via semantic search
      const results = await engine.l3.recall('validation pattern', 5);
      const found = results.find(r => r.id === memory.id);
      expect(found).toBeDefined();
      expect(found!.similarity).toBeGreaterThan(0);
    });

    it.skipIf(!hasEmbeddingModel)('should store multiple memories across layers', async () => {
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

    it.skipIf(!hasEmbeddingModel)('should auto-route code_pattern to L3', async () => {
      const memory = await engine.store(
        'export function helper() {}',
        'code_pattern'
      );

      expect(memory.layer).toBe(MemoryLayer.L3_SEMANTIC);
    });

    it.skipIf(!hasEmbeddingModel)('should auto-route convention to L3', async () => {
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

    it.skipIf(!hasEmbeddingModel)('should auto-route relationship to L3', async () => {
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
  // Get Context Window (requires L3 for seedTestMemories)
  // ============================================================================

  describe.skipIf(!hasEmbeddingModel)('getContextWindow', () => {
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
  // Recall Across Layers (requires L3 for seedTestMemories)
  // ============================================================================

  describe.skipIf(!hasEmbeddingModel)('recall across layers', () => {
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

    it.skipIf(!hasEmbeddingModel)('should promote L2 to L3', async () => {
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

    it.skipIf(!hasEmbeddingModel)('should throw when promoting beyond L3', async () => {
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

    it.skipIf(!hasEmbeddingModel)('should demote/delete from L3', async () => {
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
  // Ghost Functionality (requires L3 for seedTestMemories)
  // ============================================================================

  describe('ghost functionality', () => {
    it.skipIf(!hasEmbeddingModel)('should return ghost result with messages', async () => {
      await seedTestMemories(engine, sessionId);

      const ghostResult = await engine.ghost();

      expect(ghostResult.messages).toBeDefined();
      expect(Array.isArray(ghostResult.messages)).toBe(true);
      expect(ghostResult.relevantMemories).toBeDefined();
      expect(ghostResult.suggestedActions).toBeDefined();
    });

    it.skipIf(!hasEmbeddingModel)('should generate ghost messages from recent decisions', async () => {
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

    it.skipIf(!hasEmbeddingModel)('should generate suggestions based on context', async () => {
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

    it.skipIf(!hasEmbeddingModel)('should handle pattern_detected event', async () => {
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
  // Pattern Extraction (requires L3 for pattern storage)
  // ============================================================================

  describe.skipIf(!hasEmbeddingModel)('pattern extraction', () => {
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

    it.skipIf(!hasEmbeddingModel)('should apply decay to L3 memories', async () => {
      const result = await engine.summarize(MemoryLayer.L3_SEMANTIC, 30);

      expect(result.layer).toBe(MemoryLayer.L3_SEMANTIC);
      expect(result.summaryId).toContain('decay');
    });
  });

  // ============================================================================
  // Orientation
  // ============================================================================

  describe('orient', () => {
    it('should return a valid OrientationContext', async () => {
      const result = await engine.orient('UTC');

      expect(result.time).toBeDefined();
      expect(result.time.timezone).toBe('UTC');
      expect(result.projectPath).toBe(context.projectPath);
      expect(typeof result.summary).toBe('string');
      expect(result.summary.length).toBeGreaterThan(0);
    });

    it('should report first session when no previous sessions', async () => {
      const result = await engine.orient('UTC');

      expect(result.offlineGap).toBeNull();
      expect(result.summary).toContain('First session');
    });

    it('should detect offline gap on second call', async () => {
      // First call records the session
      await engine.orient('UTC');

      // Second call should detect a gap (even if very small)
      const result = await engine.orient('UTC');

      expect(result.offlineGap).not.toBeNull();
      expect(typeof result.offlineGap!.durationMs).toBe('number');
      expect(typeof result.offlineGap!.durationHuman).toBe('string');
      expect(typeof result.offlineGap!.from).toBe('string');
      expect(typeof result.offlineGap!.to).toBe('string');
      expect(typeof result.offlineGap!.memoriesAdded).toBe('number');
    });

    it('should count memories added during offline gap', async () => {
      // First orient to record session
      await engine.orient('UTC');

      // Store a memory (simulates offline work)
      await engine.store('A decision made offline', 'decision', {
        layer: MemoryLayer.L2_PROJECT,
      });

      // Second orient should count 1 memory added
      const result = await engine.orient('UTC');

      expect(result.offlineGap).not.toBeNull();
      expect(result.offlineGap!.memoriesAdded).toBeGreaterThanOrEqual(1);
      expect(result.recentMemories.length).toBeGreaterThanOrEqual(1);
    });

    it('should use system timezone when none provided', async () => {
      const result = await engine.orient();

      expect(result.time.timezone).toBeDefined();
      expect(result.time.timezone.length).toBeGreaterThan(0);
    });

    it('should include project path in summary', async () => {
      const result = await engine.orient('UTC');

      expect(result.summary).toContain('Project:');
    });
  });

  // ============================================================================
  // Code Index
  // ============================================================================

  describe('code index', () => {
    it('should lazily create a CodeIndex via getCodeIndex()', () => {
      const idx = engine.getCodeIndex();
      expect(idx).toBeDefined();
      expect(idx.getStatus().totalFiles).toBe(0);
    });

    it('should reuse the same CodeIndex instance', () => {
      const a = engine.getCodeIndex();
      const b = engine.getCodeIndex();
      expect(a).toBe(b);
    });

    it('should index files and search by text', async () => {
      // Write a source file into the project
      const { writeFileSync } = await import('fs');
      const { join } = await import('path');
      const srcDir = join(context.projectPath, 'src');
      const { mkdirSync } = await import('fs');
      mkdirSync(srcDir, { recursive: true });
      writeFileSync(join(srcDir, 'greeter.ts'), `
export class Greeter {
  greet(name: string): string {
    return \`Hello, \${name}!\`;
  }
}
`);

      const idx = engine.getCodeIndex();
      await idx.reindexFile('src/greeter.ts');

      const results = idx.searchText('Greeter');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].filePath).toBe('src/greeter.ts');
    });

    it('should index files and search by symbol', async () => {
      const { writeFileSync, mkdirSync } = await import('fs');
      const { join } = await import('path');
      mkdirSync(join(context.projectPath, 'lib'), { recursive: true });
      writeFileSync(join(context.projectPath, 'lib/math.ts'), `
export function fibonacci(n: number): number {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

export interface MathResult {
  value: number;
  precision: number;
}
`);

      const idx = engine.getCodeIndex();
      await idx.reindexFile('lib/math.ts');

      const fnResults = idx.searchSymbols('fibonacci');
      expect(fnResults.length).toBeGreaterThan(0);
      expect(fnResults[0].symbol?.kind).toBe('function');

      const ifaceResults = idx.searchSymbols('', { symbolKind: 'interface' });
      expect(ifaceResults.some(r => r.symbol?.name === 'MathResult')).toBe(true);
    });

    it('should return file symbols', async () => {
      const { writeFileSync } = await import('fs');
      const { join } = await import('path');
      writeFileSync(join(context.projectPath, 'api.ts'), `
export const API_VERSION = "1.0";
export function handleRequest(req: Request): Response {
  return new Response("ok");
}
`);

      const idx = engine.getCodeIndex();
      await idx.reindexFile('api.ts');

      const symbols = idx.getFileSymbols('api.ts');
      const names = symbols.map(s => s.name);
      expect(names).toContain('API_VERSION');
      expect(names).toContain('handleRequest');
    });

    it('should be closed when engine is closed', async () => {
      const idx = engine.getCodeIndex();
      expect(idx).toBeDefined();
      // close() is called by afterEach — just verify getCodeIndex works before close
    });
  });

  // ============================================================================
  // Memory CRUD
  // ============================================================================

  describe('getMemory', () => {
    it('should get a memory from L1', async () => {
      const mem = await engine.store('L1 note', 'scratchpad', { layer: MemoryLayer.L1_WORKING });
      const result = await engine.getMemory(mem.id);

      expect(result).not.toBeNull();
      expect(result!.layer).toBe(MemoryLayer.L1_WORKING);
      expect(result!.memory.content).toBe('L1 note');
    });

    it('should get a memory from L2', async () => {
      const mem = await engine.store('L2 decision', 'decision', { layer: MemoryLayer.L2_PROJECT });
      const result = await engine.getMemory(mem.id);

      expect(result).not.toBeNull();
      expect(result!.layer).toBe(MemoryLayer.L2_PROJECT);
      expect(result!.memory.content).toBe('L2 decision');
    });

    it.skipIf(!hasEmbeddingModel)('should get a memory from L3', async () => {
      const mem = await engine.store('L3 pattern', 'code_pattern', { layer: MemoryLayer.L3_SEMANTIC });
      const result = await engine.getMemory(mem.id);

      expect(result).not.toBeNull();
      expect(result!.layer).toBe(MemoryLayer.L3_SEMANTIC);
      expect(result!.memory.content).toBe('L3 pattern');
    });

    it('should return null for non-existent memory', async () => {
      const result = await engine.getMemory('non-existent-id');
      expect(result).toBeNull();
    });
  });

  describe('updateMemory', () => {
    it('should update L2 memory content', async () => {
      const mem = await engine.store('Original content', 'decision', { layer: MemoryLayer.L2_PROJECT });
      const result = await engine.updateMemory(mem.id, { content: 'Updated content' });

      expect(result.memory.content).toBe('Updated content');
      expect(result.layer).toBe(MemoryLayer.L2_PROJECT);
    });

    it('should update L2 memory tags', async () => {
      const mem = await engine.store('Tagged note', 'decision', { layer: MemoryLayer.L2_PROJECT, tags: ['old'] });
      const result = await engine.updateMemory(mem.id, { tags: ['new', 'updated'] });

      expect(result.memory.tags).toEqual(['new', 'updated']);
    });

    it('should update L2 memory metadata', async () => {
      const mem = await engine.store('Meta note', 'decision', { layer: MemoryLayer.L2_PROJECT });
      const result = await engine.updateMemory(mem.id, { metadata: { title: 'New Title' } });

      expect(result.memory.metadata?.title).toBe('New Title');
    });

    it('should reject L1 memory updates', async () => {
      const mem = await engine.store('Ephemeral', 'scratchpad', { layer: MemoryLayer.L1_WORKING });

      await expect(
        engine.updateMemory(mem.id, { content: 'Updated' })
      ).rejects.toThrow('Cannot update L1');
    });

    it.skipIf(!hasEmbeddingModel)('should update L3 memory content', async () => {
      const mem = await engine.store('Original L3', 'code_pattern', { layer: MemoryLayer.L3_SEMANTIC });
      const result = await engine.updateMemory(mem.id, { content: 'Updated L3 content' });

      expect(result.memory.content).toBe('Updated L3 content');
      expect(result.layer).toBe(MemoryLayer.L3_SEMANTIC);
    });

    it.skipIf(!hasEmbeddingModel)('should update L3 tags without re-embedding', async () => {
      const mem = await engine.store('L3 with tags', 'code_pattern', { layer: MemoryLayer.L3_SEMANTIC });
      const result = await engine.updateMemory(mem.id, { tags: ['new-tag'] });

      expect(result.memory.tags).toEqual(['new-tag']);
      expect(result.layer).toBe(MemoryLayer.L3_SEMANTIC);
    });

    it('should throw for non-existent memory', async () => {
      await expect(
        engine.updateMemory('non-existent', { content: 'x' })
      ).rejects.toThrow('Memory not found');
    });
  });

  describe('deleteMemory', () => {
    it('should delete from L1', async () => {
      const mem = await engine.store('Delete me', 'scratchpad', { layer: MemoryLayer.L1_WORKING });
      const result = await engine.deleteMemory(mem.id);

      expect(result.deletedFrom).toBe(MemoryLayer.L1_WORKING);
      expect(engine.l1.get(mem.id)).toBeUndefined();
    });

    it('should delete from L2', async () => {
      const mem = await engine.store('Delete L2', 'decision', { layer: MemoryLayer.L2_PROJECT });
      const result = await engine.deleteMemory(mem.id);

      expect(result.deletedFrom).toBe(MemoryLayer.L2_PROJECT);
      const found = await engine.l2.get(mem.id);
      expect(found).toBeUndefined();
    });

    it.skipIf(!hasEmbeddingModel)('should delete from L3', async () => {
      const mem = await engine.store('Delete L3', 'code_pattern', { layer: MemoryLayer.L3_SEMANTIC });
      const result = await engine.deleteMemory(mem.id);

      expect(result.deletedFrom).toBe(MemoryLayer.L3_SEMANTIC);
      const found = await engine.l3.get(mem.id);
      expect(found).toBeUndefined();
    });

    it('should throw for non-existent memory', async () => {
      await expect(
        engine.deleteMemory('non-existent')
      ).rejects.toThrow('Memory not found');
    });
  });

  describe('listMemories', () => {
    it('should list L2 memories with pagination', async () => {
      for (let i = 0; i < 5; i++) {
        await engine.store(`Decision ${i}`, 'decision', { layer: MemoryLayer.L2_PROJECT });
      }

      const page1 = await engine.listMemories({ limit: 3, offset: 0 });
      expect(page1.memories).toHaveLength(3);
      expect(page1.total).toBe(5);

      const page2 = await engine.listMemories({ limit: 3, offset: 3 });
      expect(page2.memories).toHaveLength(2);
      expect(page2.total).toBe(5);
    });

    it('should default to L2', async () => {
      await engine.store('L2 mem', 'decision', { layer: MemoryLayer.L2_PROJECT });
      const result = await engine.listMemories({});
      expect(result.memories.length).toBeGreaterThan(0);
    });

    it('should filter by type', async () => {
      await engine.store('A decision', 'decision', { layer: MemoryLayer.L2_PROJECT });
      await engine.store('A bug fix', 'bug_fix', { layer: MemoryLayer.L2_PROJECT });

      const result = await engine.listMemories({ type: 'decision' });
      expect(result.memories.every(m => m.type === 'decision')).toBe(true);
    });

    it('should filter by tags', async () => {
      await engine.store('Tagged', 'decision', { layer: MemoryLayer.L2_PROJECT, tags: ['arch'] });
      await engine.store('Untagged', 'decision', { layer: MemoryLayer.L2_PROJECT, tags: ['other'] });

      const result = await engine.listMemories({ tags: ['arch'] });
      for (const m of result.memories) {
        const mTags = m.tags || m.metadata?.tags || [];
        expect(mTags).toContain('arch');
      }
    });

    it('should list L1 memories', async () => {
      await engine.store('L1 scratchpad', 'scratchpad', { layer: MemoryLayer.L1_WORKING });
      const result = await engine.listMemories({ layer: MemoryLayer.L1_WORKING });
      expect(result.memories.length).toBeGreaterThan(0);
    });

    it.skipIf(!hasEmbeddingModel)('should list L3 memories', async () => {
      await engine.store('L3 pattern', 'code_pattern', { layer: MemoryLayer.L3_SEMANTIC });
      const result = await engine.listMemories({ layer: MemoryLayer.L3_SEMANTIC });
      expect(result.memories.length).toBeGreaterThan(0);
      expect(result.total).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // Aggressive Decay (v0.5.4)
  // ============================================================================

  describe('aggressive decay', () => {
    it('should default to l3DecayDays=14 and l3DecayThreshold=0.2', () => {
      expect(engine.config.ttl.l3DecayDays).toBe(14);
      expect(engine.config.ttl.l3DecayThreshold).toBe(0.2);
    });

    it.skipIf(!hasEmbeddingModel)('applyDecay deletes memories below the decay threshold', async () => {
      const mem = await engine.store('decay-threshold-test', 'scratchpad', {
        layer: MemoryLayer.L3_SEMANTIC,
      });

      // Simulate a memory that is 180 days old and unaccessed.
      // applyDecay() recomputes score from timestamps (ignores stored relevance_score),
      // so we must age the timestamps — not just overwrite the score column.
      const veryOldTs = Date.now() - 180 * 24 * 60 * 60 * 1000;
      const l3 = engine.l3 as any;
      l3.db.prepare('UPDATE semantic_memories SET created_at = ?, accessed_at = ? WHERE id = ?')
        .run(veryOldTs, veryOldTs, mem.id);

      const pruned = await engine.l3.applyDecay();
      expect(pruned).toBeGreaterThan(0);

      const found = await engine.l3.get(mem.id);
      expect(found).toBeUndefined();
    });

    it.skipIf(!hasEmbeddingModel)('applyDecay keeps memories above the decay threshold', async () => {
      const mem = await engine.store('decay-survive-test', 'decision', {
        layer: MemoryLayer.L3_SEMANTIC,
      });

      // A freshly created memory has age ≈ 0, so applyDecay() computes score ≈ 1.0 — no manipulation needed.
      await engine.l3.applyDecay();

      const found = await engine.l3.get(mem.id);
      expect(found).toBeDefined();
    });

    it.skipIf(!hasEmbeddingModel)('orient fires decay in the background', async () => {
      const mem = await engine.store('orient-decay-test', 'scratchpad', {
        layer: MemoryLayer.L3_SEMANTIC,
      });

      // Age the memory far into the past so decay will delete it
      const veryOldTs = Date.now() - 180 * 24 * 60 * 60 * 1000;
      const l3 = engine.l3 as any;
      l3.db.prepare('UPDATE semantic_memories SET created_at = ?, accessed_at = ? WHERE id = ?')
        .run(veryOldTs, veryOldTs, mem.id);

      // orient() triggers decay fire-and-forget
      await engine.orient('UTC');

      // Give the async decay a moment to resolve
      await new Promise(r => setTimeout(r, 50));

      const found = await engine.l3.get(mem.id);
      expect(found).toBeUndefined();
    });
  });

  // ============================================================================
  // Memory Weighting
  // ============================================================================

  describe('memory weighting', () => {
    it('should rank weight-5 memory above weight-1 memory in recall', async () => {
      const highWeight = await engine.store(
        'weight-ranking-test-alpha',
        'decision',
        { layer: MemoryLayer.L2_PROJECT, metadata: { weight: 5 } }
      );
      const lowWeight = await engine.store(
        'weight-ranking-test-alpha',
        'decision',
        { layer: MemoryLayer.L2_PROJECT, metadata: { weight: 1 } }
      );

      const results = await engine.recall('weight-ranking-test-alpha', { limit: 10 });

      const highIdx = results.findIndex(r => r.id === highWeight.id);
      const lowIdx = results.findIndex(r => r.id === lowWeight.id);

      expect(highIdx).toBeGreaterThanOrEqual(0);
      expect(lowIdx).toBeGreaterThanOrEqual(0);
      expect(highIdx).toBeLessThan(lowIdx);
    });

    it('should rank weight-5 memory above default-weight memory in recall', async () => {
      const highWeight = await engine.store(
        'weight-ranking-test-beta',
        'convention',
        { layer: MemoryLayer.L2_PROJECT, metadata: { weight: 5 } }
      );
      const defaultWeight = await engine.store(
        'weight-ranking-test-beta',
        'convention',
        { layer: MemoryLayer.L2_PROJECT }
      );

      const results = await engine.recall('weight-ranking-test-beta', { limit: 10 });

      const highIdx = results.findIndex(r => r.id === highWeight.id);
      const defaultIdx = results.findIndex(r => r.id === defaultWeight.id);

      expect(highIdx).toBeGreaterThanOrEqual(0);
      expect(defaultIdx).toBeGreaterThanOrEqual(0);
      expect(highIdx).toBeLessThan(defaultIdx);
    });

    it('should store weight in metadata', async () => {
      const mem = await engine.store(
        'Memory with explicit weight',
        'decision',
        { layer: MemoryLayer.L2_PROJECT, metadata: { weight: 4 } }
      );

      const found = await engine.getMemory(mem.id);
      expect(found).not.toBeNull();
      expect(found!.memory.metadata?.weight).toBe(4);
    });

    it('should default weight to 3 at query time when not set', async () => {
      const noWeightMem = await engine.store(
        'weight-default-gamma',
        'decision',
        { layer: MemoryLayer.L2_PROJECT }
      );
      const withWeight3 = await engine.store(
        'weight-default-gamma',
        'decision',
        { layer: MemoryLayer.L2_PROJECT, metadata: { weight: 3 } }
      );

      const results = await engine.recall('weight-default-gamma', { limit: 10 });
      const idx1 = results.findIndex(r => r.id === noWeightMem.id);
      const idx2 = results.findIndex(r => r.id === withWeight3.id);

      // Both should appear; since weight ?? 3 = 3 for both, same effective similarity
      expect(idx1).toBeGreaterThanOrEqual(0);
      expect(idx2).toBeGreaterThanOrEqual(0);
    });

    it('should update weight via updateMemory', async () => {
      const mem = await engine.store(
        'Memory to reweight',
        'decision',
        { layer: MemoryLayer.L2_PROJECT, metadata: { weight: 3 } }
      );

      const updated = await engine.updateMemory(mem.id, { metadata: { weight: 5 } });
      expect(updated.memory.metadata?.weight).toBe(5);
    });
  });

  // ============================================================================
  // Pinned Memories (v0.5.5)
  // ============================================================================

  describe('pinned memories', () => {
    it('should store a pinned L2 memory and return pinned=true', async () => {
      const mem = await engine.store('pinned-l2-test', 'decision', {
        layer: MemoryLayer.L2_PROJECT,
        pinned: true,
      });
      expect(mem.pinned).toBe(true);

      const found = await engine.getMemory(mem.id);
      expect(found?.memory.pinned).toBe(true);
    });

    it('should store an unpinned L2 memory and return pinned=false', async () => {
      const mem = await engine.store('unpinned-l2-test', 'decision', {
        layer: MemoryLayer.L2_PROJECT,
      });
      expect(mem.pinned).toBe(false);
    });

    it('should pin and unpin an L2 memory via updateMemory', async () => {
      const mem = await engine.store('pin-toggle-l2-test', 'decision', {
        layer: MemoryLayer.L2_PROJECT,
      });
      expect(mem.pinned).toBe(false);

      const pinned = await engine.updateMemory(mem.id, { pinned: true });
      expect(pinned.memory.pinned).toBe(true);

      const unpinned = await engine.updateMemory(mem.id, { pinned: false });
      expect(unpinned.memory.pinned).toBe(false);
    });

    it('should not archive pinned L2 memories during summarize', async () => {
      const pinned = await engine.store('pinned-summarize-safe', 'decision', {
        layer: MemoryLayer.L2_PROJECT,
        pinned: true,
      });

      // Make it appear old so summarize would normally archive it
      const veryOldTs = Date.now() - 365 * 24 * 60 * 60 * 1000;
      (engine.l2 as any).db.prepare('UPDATE memories SET created_at = ? WHERE id = ?')
        .run(veryOldTs, pinned.id);

      await engine.summarize(MemoryLayer.L2_PROJECT, 1);

      const stillExists = await engine.getMemory(pinned.id);
      expect(stillExists).not.toBeNull();
    });

    it.skipIf(!hasEmbeddingModel)('should store a pinned L3 memory and return pinned=true', async () => {
      const mem = await engine.store('pinned-l3-test', 'decision', {
        layer: MemoryLayer.L3_SEMANTIC,
        pinned: true,
      });
      expect(mem.pinned).toBe(true);

      const found = await engine.l3.get(mem.id);
      expect(found?.pinned).toBe(true);
    });

    it.skipIf(!hasEmbeddingModel)('pinned L3 memories survive applyDecay', async () => {
      const mem = await engine.store('pinned-decay-safe', 'decision', {
        layer: MemoryLayer.L3_SEMANTIC,
        pinned: true,
      });

      // Age the memory so it would normally be pruned
      const veryOldTs = Date.now() - 180 * 24 * 60 * 60 * 1000;
      const l3 = engine.l3 as any;
      l3.db.prepare('UPDATE semantic_memories SET created_at = ?, accessed_at = ? WHERE id = ?')
        .run(veryOldTs, veryOldTs, mem.id);

      await engine.l3.applyDecay();

      const found = await engine.l3.get(mem.id);
      expect(found).toBeDefined();
      expect(found?.pinned).toBe(true);
    });

    it.skipIf(!hasEmbeddingModel)('unpinned aged L3 memories are still pruned by applyDecay', async () => {
      const mem = await engine.store('unpinned-decay-pruned', 'scratchpad', {
        layer: MemoryLayer.L3_SEMANTIC,
      });

      const veryOldTs = Date.now() - 180 * 24 * 60 * 60 * 1000;
      const l3 = engine.l3 as any;
      l3.db.prepare('UPDATE semantic_memories SET created_at = ?, accessed_at = ? WHERE id = ?')
        .run(veryOldTs, veryOldTs, mem.id);

      await engine.l3.applyDecay();

      const found = await engine.l3.get(mem.id);
      expect(found).toBeUndefined();
    });

    it.skipIf(!hasEmbeddingModel)('should pin and unpin an L3 memory via updateMemory', async () => {
      const mem = await engine.store('pin-toggle-l3-test', 'decision', {
        layer: MemoryLayer.L3_SEMANTIC,
      });
      expect(mem.pinned).toBe(false);

      const pinned = await engine.updateMemory(mem.id, { pinned: true });
      expect(pinned.memory.pinned).toBe(true);

      const unpinned = await engine.updateMemory(mem.id, { pinned: false });
      expect(unpinned.memory.pinned).toBe(false);
    });
  });

  // ============================================================================
  // ============================================================================
  // Keyword Recall Mode (v0.7)
  // ============================================================================

  describe('keyword recall mode', () => {
    it('should find exact keyword via BM25 in L2', async () => {
      await engine.store('ECONNREFUSED error in auth service at port 5432', 'bug_fix', {
        layer: MemoryLayer.L2_PROJECT,
        tags: ['error'],
      });

      const results = await engine.recall('ECONNREFUSED', { mode: 'keyword', limit: 10 });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].content).toContain('ECONNREFUSED');
      expect(results[0].layer).toBe(MemoryLayer.L2_PROJECT);
    });

    it('should return normalized BM25 scores in [0, 1]', async () => {
      await engine.store('unique-keyword-test-alpha for normalization', 'decision', {
        layer: MemoryLayer.L2_PROJECT,
      });

      const results = await engine.recall('unique-keyword-test-alpha', { mode: 'keyword', limit: 10 });
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(r.similarity).toBeGreaterThanOrEqual(0);
        expect(r.similarity).toBeLessThanOrEqual(1);
      }
    });

    it('should apply weight multiplier in keyword mode', async () => {
      await engine.store('keyword-weight-test low priority', 'decision', {
        layer: MemoryLayer.L2_PROJECT,
        metadata: { weight: 1 },
      });
      await engine.store('keyword-weight-test high priority', 'decision', {
        layer: MemoryLayer.L2_PROJECT,
        metadata: { weight: 5 },
      });

      const results = await engine.recall('keyword-weight-test', { mode: 'keyword', limit: 10 });
      expect(results.length).toBe(2);
      // Weight-5 should rank above weight-1
      expect(results[0].content).toContain('high priority');
    });

    it('should fall back to substring for L1 in keyword mode', async () => {
      await engine.store('keyword-l1-test ephemeral note', 'scratchpad', {
        layer: MemoryLayer.L1_WORKING,
      });

      const results = await engine.recall('keyword-l1-test', { mode: 'keyword', limit: 10 });
      expect(results.some(r => r.layer === MemoryLayer.L1_WORKING)).toBe(true);
    });

    it('should return empty for non-matching keyword query', async () => {
      const results = await engine.recall('zzz-nonexistent-keyword-zzz', { mode: 'keyword', limit: 10 });
      expect(results).toEqual([]);
    });
  });

  // ============================================================================
  // Hybrid Recall Mode (v0.7 — RRF)
  // ============================================================================

  describe('hybrid recall mode', () => {
    it('should find exact keyword via hybrid mode in L2', async () => {
      await engine.store('ECONNREFUSED hybrid-test in payment service', 'bug_fix', {
        layer: MemoryLayer.L2_PROJECT,
        tags: ['error'],
      });

      const results = await engine.recall('ECONNREFUSED', { mode: 'hybrid', limit: 10 });
      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.content.includes('ECONNREFUSED'))).toBe(true);
    });

    it('should return valid similarity scores', async () => {
      await engine.store('hybrid-score-test unique memory content', 'decision', {
        layer: MemoryLayer.L2_PROJECT,
      });

      const results = await engine.recall('hybrid-score-test', { mode: 'hybrid', limit: 10 });
      for (const r of results) {
        expect(r.similarity).toBeGreaterThan(0);
        expect(typeof r.similarity).toBe('number');
      }
    });

    it('should apply weight multiplier in hybrid mode', async () => {
      await engine.store('hybrid-weight-test low', 'decision', {
        layer: MemoryLayer.L2_PROJECT,
        metadata: { weight: 1 },
      });
      await engine.store('hybrid-weight-test high', 'decision', {
        layer: MemoryLayer.L2_PROJECT,
        metadata: { weight: 5 },
      });

      const results = await engine.recall('hybrid-weight-test', { mode: 'hybrid', limit: 10 });
      expect(results.length).toBe(2);
      expect(results[0].content).toContain('high');
    });

    it('should include L1 results in hybrid mode', async () => {
      await engine.store('hybrid-l1-test ephemeral', 'scratchpad', {
        layer: MemoryLayer.L1_WORKING,
      });
      await engine.store('hybrid-l1-test persistent', 'decision', {
        layer: MemoryLayer.L2_PROJECT,
      });

      const results = await engine.recall('hybrid-l1-test', { mode: 'hybrid', limit: 10 });
      const l1 = results.filter(r => r.layer === MemoryLayer.L1_WORKING);
      const l2 = results.filter(r => r.layer === MemoryLayer.L2_PROJECT);
      expect(l1.length).toBeGreaterThan(0);
      expect(l2.length).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // BM25 Normalization (static method)
  // ============================================================================

  describe('normalizeBM25', () => {
    it('should return values in [0, 1]', () => {
      expect(ContextEngine.normalizeBM25(0)).toBe(1);
      expect(ContextEngine.normalizeBM25(-1)).toBeCloseTo(0.5);
      expect(ContextEngine.normalizeBM25(-10)).toBeCloseTo(1 / 11);
      expect(ContextEngine.normalizeBM25(-100)).toBeCloseTo(1 / 101);
    });

    it('should be monotonic (less negative = higher score)', () => {
      const a = ContextEngine.normalizeBM25(-1);
      const b = ContextEngine.normalizeBM25(-5);
      expect(a).toBeGreaterThan(b);
    });
  });

  // ============================================================================
  // Cleanup (requires L3 for seedTestMemories)
  // ============================================================================

  describe.skipIf(!hasEmbeddingModel)('cleanup', () => {
    it('should clean up all resources on close', async () => {
      await seedTestMemories(engine, sessionId);

      engine.close();

      // L1 should be cleared
      expect(engine.l1.getAll()).toHaveLength(0);
    });
  });
});
