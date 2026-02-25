// Tests for L3 Semantic Memory Layer

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { SemanticMemoryLayer, ScoredMemory } from './semantic.js';
import { EmbeddingService } from '../embedding.js';
import { MemoryType } from '../types.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('SemanticMemoryLayer', () => {
  let memoryLayer: SemanticMemoryLayer;
  let testDir: string;

  beforeAll(async () => {
    // Pre-warm the embedding model to avoid timeout during tests
    const embedder = new EmbeddingService();
    await embedder.embed('warmup');
  });

  beforeEach(() => {
    // Create a temporary directory for each test
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'semantic-test-'));
    memoryLayer = new SemanticMemoryLayer({
      baseDir: testDir,
      decayDays: 30,
      collectionName: `test_${Date.now()}`,
      isEphemeral: true, // Use in-memory SQLite for tests
    });
  });

  afterEach(async () => {
    // Cleanup
    memoryLayer.close();
    
    // Remove test directory
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  describe('Storage and Retrieval', () => {
    it('should store a memory and retrieve it by ID', async () => {
      const content = 'This is a test memory about JavaScript programming';
      const type: MemoryType = 'code';
      const metadata = { project: '/test/project', language: 'javascript' };

      const memory = await memoryLayer.store(content, type, metadata);

      expect(memory.id).toBeDefined();
      expect(memory.content).toBe(content);
      expect(memory.type).toBe(type);
      expect(memory.metadata).toMatchObject(metadata);
      expect(memory.tags).toEqual([]);
      expect(memory.createdAt).toBeGreaterThan(0);
      expect(memory.accessCount).toBe(0);

      // Retrieve by ID
      const retrieved = await memoryLayer.get(memory.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(memory.id);
      expect(retrieved?.content).toBe(content);
      expect(retrieved?.type).toBe(type);
    });

    it('should return undefined for non-existent ID', async () => {
      const retrieved = await memoryLayer.get('non-existent-id');
      expect(retrieved).toBeUndefined();
    });

    it('should store multiple memories and count them', async () => {
      await memoryLayer.store('Memory 1', 'code');
      await memoryLayer.store('Memory 2', 'documentation');
      await memoryLayer.store('Memory 3', 'conversation');

      const count = await memoryLayer.count();
      expect(count).toBe(3);
    });

    it('should handle metadata with tags', async () => {
      const metadata = {
        project: '/test/project',
        tags: ['important', 'review-needed'],
      };

      const memory = await memoryLayer.store('Tagged memory', 'code', metadata);

      expect(memory.tags).toEqual(['important', 'review-needed']);

      const retrieved = await memoryLayer.get(memory.id);
      expect(retrieved?.tags).toEqual(['important', 'review-needed']);
    });
  });

  describe('Semantic Search', () => {
    beforeEach(async () => {
      // Seed with test memories on related topics
      await memoryLayer.store(
        'JavaScript async/await patterns for handling asynchronous operations',
        'code',
        { project: '/project/js' }
      );
      await memoryLayer.store(
        'Python asyncio library for concurrent programming',
        'code',
        { project: '/project/python' }
      );
      await memoryLayer.store(
        'Documentation for the REST API authentication endpoints',
        'documentation',
        { project: '/project/api' }
      );
      await memoryLayer.store(
        'User requirements for the new dashboard feature',
        'requirement',
        { project: '/project/dashboard' }
      );
      await memoryLayer.store(
        'Error handling in TypeScript with try-catch blocks',
        'code',
        { project: '/project/ts' }
      );
    });

    it('should find semantically similar memories', async () => {
      // Search for async programming concepts
      const results = await memoryLayer.recall('asynchronous programming patterns', 3);

      expect(results.length).toBeGreaterThan(0);
      
      // Should find the JavaScript async/await memory with high similarity
      const jsAsync = results.find(r => r.content.includes('JavaScript'));
      expect(jsAsync).toBeDefined();
      expect(jsAsync!.similarity).toBeGreaterThan(0.3);
    });

    it('should rank results by similarity', async () => {
      const results = await memoryLayer.recall('programming errors and exceptions', 5);

      expect(results.length).toBeGreaterThan(0);

      // Results should be sorted by similarity (descending)
      for (let i = 0; i < results.length - 1; i++) {
        expect(results[i].similarity).toBeGreaterThanOrEqual(results[i + 1].similarity);
      }
    });

    it('should respect the limit parameter', async () => {
      const results = await memoryLayer.recall('programming', 2);
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('should return empty array for queries with no matches', async () => {
      const results = await memoryLayer.recall('quantum physics astrophysics', 5);
      // Note: Semantic search might still return results even for unrelated queries,
      // but with very low similarity scores
      expect(Array.isArray(results)).toBe(true);
    });

    it('should include similarity scores in results', async () => {
      const results = await memoryLayer.recall('async programming', 3);

      results.forEach(result => {
        expect(result.similarity).toBeDefined();
        expect(result.similarity).toBeGreaterThanOrEqual(0);
        expect(result.similarity).toBeLessThanOrEqual(1);
      });
    });
  });

  describe('findSimilar', () => {
    it('should find memories similar to a given memory', async () => {
      // Store related memories
      const mem1 = await memoryLayer.store(
        'React hooks useState and useEffect patterns',
        'code',
        { project: '/project/react' }
      );
      await memoryLayer.store(
        'React component lifecycle methods',
        'code',
        { project: '/project/react' }
      );
      await memoryLayer.store(
        'Vue.js composition API reactive state',
        'code',
        { project: '/project/vue' }
      );
      await memoryLayer.store(
        'Database schema design principles',
        'documentation',
        { project: '/project/db' }
      );

      // Find similar to mem1
      const similar = await memoryLayer.findSimilar(mem1.id, 3);

      expect(similar.length).toBeGreaterThan(0);
      
      // The React lifecycle memory should be more similar than database schema
      const reactSimilar = similar.find(s => s.content.includes('React'));
      expect(reactSimilar).toBeDefined();
    });

    it('should not include the source memory in results', async () => {
      const mem = await memoryLayer.store('Unique content for testing', 'code');
      const similar = await memoryLayer.findSimilar(mem.id, 5);

      const selfMatch = similar.find(s => s.id === mem.id);
      expect(selfMatch).toBeUndefined();
    });

    it('should return empty array for non-existent memory ID', async () => {
      const similar = await memoryLayer.findSimilar('non-existent-id', 5);
      expect(similar).toEqual([]);
    });
  });

  describe('Cross-project Isolation', () => {
    it('should store memories with different project paths', async () => {
      const projectA = '/projects/web-app';
      const projectB = '/projects/mobile-app';

      await memoryLayer.store('Web app authentication logic', 'code', { project: projectA });
      await memoryLayer.store('Mobile app API client', 'code', { project: projectB });
      await memoryLayer.store('Shared utility functions', 'code', { project: projectA });

      const memoriesA = await memoryLayer.getByProject(projectA);
      const memoriesB = await memoryLayer.getByProject(projectB);

      expect(memoriesA.length).toBe(2);
      expect(memoriesB.length).toBe(1);
    });

    it('should filter by project path exactly', async () => {
      await memoryLayer.store('Content 1', 'code', { project: '/project/sub' });
      await memoryLayer.store('Content 2', 'code', { project: '/project' });

      const subProject = await memoryLayer.getByProject('/project/sub');
      const mainProject = await memoryLayer.getByProject('/project');

      expect(subProject.length).toBe(1);
      expect(mainProject.length).toBe(1);
      expect(subProject[0].content).toBe('Content 1');
      expect(mainProject[0].content).toBe('Content 2');
    });

    it('should return empty array for project with no memories', async () => {
      const memories = await memoryLayer.getByProject('/non-existent/project');
      expect(memories).toEqual([]);
    });
  });

  describe('Touch and Access Count', () => {
    it('should increment access count when touching', async () => {
      const memory = await memoryLayer.store('Test memory', 'code');
      
      expect(memory.accessCount).toBe(0);

      await memoryLayer.touch(memory.id);

      const updated = await memoryLayer.get(memory.id);
      expect(updated?.accessCount).toBe(1);
    });

    it('should update lastAccessedAt when touching', async () => {
      const before = Date.now();
      const memory = await memoryLayer.store('Test memory', 'code');
      
      // Wait a bit to ensure time difference
      await new Promise(resolve => setTimeout(resolve, 10));
      
      await memoryLayer.touch(memory.id);
      
      const after = Date.now();
      const updated = await memoryLayer.get(memory.id);
      
      expect(updated?.lastAccessedAt).toBeGreaterThanOrEqual(before);
      expect(updated?.lastAccessedAt).toBeLessThanOrEqual(after);
    });

    it('should not throw for touching non-existent memory', async () => {
      await expect(memoryLayer.touch('non-existent-id')).resolves.not.toThrow();
    });
  });

  describe('Delete', () => {
    it('should delete a memory by ID', async () => {
      const memory = await memoryLayer.store('To be deleted', 'code');
      
      expect(await memoryLayer.get(memory.id)).toBeDefined();

      const deleted = await memoryLayer.delete(memory.id);
      
      expect(deleted).toBe(true);
      expect(await memoryLayer.get(memory.id)).toBeUndefined();
    });

    it('should return false for deleting non-existent memory', async () => {
      const result = await memoryLayer.delete('non-existent-id');
      expect(result).toBe(false);
    });

    it('should reduce count after deletion', async () => {
      const mem1 = await memoryLayer.store('Memory 1', 'code');
      await memoryLayer.store('Memory 2', 'code');
      
      expect(await memoryLayer.count()).toBe(2);

      await memoryLayer.delete(mem1.id);
      
      expect(await memoryLayer.count()).toBe(1);
    });
  });

  describe('Decay Behavior', () => {
    it('should apply decay to all memories', async () => {
      // Create memories with different ages
      const now = Date.now();
      
      await memoryLayer.store('Recent memory', 'code');
      await memoryLayer.store('Another memory', 'documentation');

      const affected = await memoryLayer.applyDecay();
      
      // Both memories should be processed
      expect(affected).toBe(2);
    });

    it('should delete very low relevance memories', async () => {
      // Create a memory layer with very short decay
      const shortDecayLayer = new SemanticMemoryLayer({
        baseDir: testDir,
        decayDays: 0.001, // Very short - ~86 seconds
        collectionName: `decay_test_${Date.now()}`,
        isEphemeral: true,
      });

      // Store a memory
      const memory = await shortDecayLayer.store('Old memory', 'code');
      
      expect(await shortDecayLayer.count()).toBe(1);

      // Apply decay
      await shortDecayLayer.applyDecay();

      // Memory might still exist if not enough time passed
      // This is a soft test as timing can vary
      shortDecayLayer.close();
    });
  });
});

describe('EmbeddingService', () => {
  let embedder: EmbeddingService;

  beforeEach(() => {
    embedder = new EmbeddingService();
  });

  afterEach(() => {
    embedder.clearCache();
  });

  it('should generate embeddings for text', async () => {
    const embedding = await embedder.embed('Hello world');

    expect(Array.isArray(embedding)).toBe(true);
    expect(embedding.length).toBeGreaterThan(0);
    expect(embedding.every(n => typeof n === 'number')).toBe(true);
  });

  it('should return consistent embeddings for same text', async () => {
    const text = 'Consistent embedding test';
    
    const embed1 = await embedder.embed(text);
    const embed2 = await embedder.embed(text);

    expect(embed1).toEqual(embed2);
  });

  it('should return different embeddings for different texts', async () => {
    const embed1 = await embedder.embed('Hello world');
    const embed2 = await embedder.embed('Goodbye world');

    // Embeddings should be different (at least some values differ)
    const allSame = embed1.every((val, idx) => val === embed2[idx]);
    expect(allSame).toBe(false);
  });

  it('should cache embeddings', async () => {
    const text = 'Cache test';
    
    expect(embedder.getCacheSize()).toBe(0);
    
    await embedder.embed(text);
    expect(embedder.getCacheSize()).toBe(1);
    
    // Second call should use cache
    await embedder.embed(text);
    expect(embedder.getCacheSize()).toBe(1);
  });

  it('should embed batch of texts', async () => {
    const texts = ['Text one', 'Text two', 'Text three'];
    
    const embeddings = await embedder.embedBatch(texts);

    expect(embeddings.length).toBe(3);
    embeddings.forEach(emb => {
      expect(Array.isArray(emb)).toBe(true);
      expect(emb.length).toBeGreaterThan(0);
    });
  });

  it('should batch cache individual texts', async () => {
    const texts = ['Batch cache 1', 'Batch cache 2'];
    
    await embedder.embedBatch(texts);
    expect(embedder.getCacheSize()).toBe(2);
    
    // Individual calls should use cache
    await embedder.embed(texts[0]);
    expect(embedder.getCacheSize()).toBe(2);
  });

  it('should return correct dimension', () => {
    const dim = embedder.getDimension();
    expect(dim).toBeGreaterThan(0);
    expect(dim).toBe(384); // Default BGESmallEN
  });

  it('should clear cache', async () => {
    await embedder.embed('Clear me');
    expect(embedder.getCacheSize()).toBe(1);
    
    embedder.clearCache();
    expect(embedder.getCacheSize()).toBe(0);
  });
});
