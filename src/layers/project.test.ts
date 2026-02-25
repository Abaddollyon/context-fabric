import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ProjectMemoryLayer } from './project.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Helper to create a temporary directory for tests
function createTempDir(): string {
  const tempDir = path.join(__dirname, '..', '..', 'test-temp', `test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

// Helper to clean up a directory
function cleanupDir(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('ProjectMemoryLayer', () => {
  let tempDir: string;
  let layer: ProjectMemoryLayer;

  beforeEach(() => {
    tempDir = createTempDir();
    layer = new ProjectMemoryLayer(tempDir);
  });

  afterEach(async () => {
    await layer.ready().catch(() => {});
    layer.close();
    cleanupDir(tempDir);
  });

  describe('Basic CRUD Operations', () => {
    it('should store a memory and return it', async () => {
      const memory = await layer.store('Test content', 'code', { file: 'test.ts' }, ['test']);

      expect(memory).toBeDefined();
      expect(memory.id).toBeDefined();
      expect(memory.content).toBe('Test content');
      expect(memory.type).toBe('code');
      expect(memory.tags).toEqual(['test']);
      expect(memory.createdAt).toBeGreaterThan(0);
      expect(memory.updatedAt).toBeGreaterThan(0);
    });

    it('should store a memory without optional fields', async () => {
      const memory = await layer.store('Simple content', 'documentation');

      expect(memory.content).toBe('Simple content');
      expect(memory.type).toBe('documentation');
      expect(memory.tags).toEqual([]);
    });

    it('should retrieve a stored memory by ID', async () => {
      const stored = await layer.store('Retrievable content', 'decision', { importance: 'high' });
      const retrieved = await layer.get(stored.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(stored.id);
      expect(retrieved?.content).toBe('Retrievable content');
      expect(retrieved?.type).toBe('decision');
    });

    it('should return undefined for non-existent ID', async () => {
      const result = await layer.get('non-existent-id-12345');
      expect(result).toBeUndefined();
    });

    it('should update access count and lastAccessedAt when getting a memory', async () => {
      const stored = await layer.store('Access tracking test', 'code');
      
      // First retrieval
      await layer.get(stored.id);
      const retrieved = await layer.get(stored.id);

      expect(retrieved?.accessCount).toBe(2);
      expect(retrieved?.lastAccessedAt).toBeDefined();
      expect(retrieved?.lastAccessedAt).toBeGreaterThan(0);
    });

    it('should update a memory', async () => {
      const stored = await layer.store('Original content', 'code', { version: 1 }, ['old']);
      
      const updated = await layer.update(stored.id, {
        content: 'Updated content',
        tags: ['new'],
      });

      expect(updated.content).toBe('Updated content');
      expect(updated.tags).toEqual(['new']);
      expect(updated.id).toBe(stored.id);
      expect(updated.updatedAt).toBeGreaterThan(stored.updatedAt);
    });

    it('should throw when updating non-existent memory', async () => {
      await expect(async () => {
        await layer.update('non-existent-id', { content: 'new' });
      }).rejects.toThrow('Memory not found');
    });

    it('should delete a memory', async () => {
      const stored = await layer.store('To be deleted', 'code');
      
      const deleted = await layer.delete(stored.id);
      expect(deleted).toBe(true);

      const retrieved = await layer.get(stored.id);
      expect(retrieved).toBeUndefined();
    });

    it('should return false when deleting non-existent memory', async () => {
      const result = await layer.delete('non-existent-id');
      expect(result).toBe(false);
    });
  });

  describe('Search Functionality', () => {
    beforeEach(async () => {
      // Seed with test data
      await layer.store('Implement authentication with JWT tokens', 'code', {}, ['auth', 'jwt', 'backend']);
      await layer.store('API documentation for user endpoints', 'documentation', {}, ['api', 'docs']);
      await layer.store('Error handling in authentication flow', 'error', {}, ['auth', 'error', 'backend']);
      await layer.store('Frontend authentication component', 'code', {}, ['auth', 'frontend', 'react']);
      await layer.store('Database schema for users', 'code', {}, ['database', 'schema', 'backend']);
    });

    it('should search by full-text content', async () => {
      const results = await layer.search('authentication');
      
      expect(results.length).toBeGreaterThanOrEqual(3);
      const contents = results.map(r => r.content);
      expect(contents.some(c => c.includes('Implement authentication'))).toBe(true);
      expect(contents.some(c => c.includes('Error handling in authentication'))).toBe(true);
      expect(contents.some(c => c.includes('Frontend authentication'))).toBe(true);
    });

    it('should search by partial word', async () => {
      const results = await layer.search('auth');
      
      expect(results.length).toBeGreaterThanOrEqual(3);
    });

    it('should return empty array for non-matching search', async () => {
      const results = await layer.search('xyznonexistent123');
      expect(results).toEqual([]);
    });

    it('should return empty array for empty search query', async () => {
      const results = await layer.search('');
      expect(results).toEqual([]);
    });
  });

  describe('Tag Filtering', () => {
    beforeEach(async () => {
      await layer.store('Auth backend code', 'code', {}, ['auth', 'backend']);
      await layer.store('Auth frontend code', 'code', {}, ['auth', 'frontend']);
      await layer.store('Database schema', 'code', {}, ['database', 'backend']);
      await layer.store('API docs', 'documentation', {}, ['api', 'docs']);
    });

    it('should find memories by single tag', async () => {
      const results = await layer.findByTags(['auth']);
      
      expect(results.length).toBe(2);
      expect(results.every(r => r.tags.includes('auth'))).toBe(true);
    });

    it('should find memories by multiple tags (AND logic)', async () => {
      const results = await layer.findByTags(['auth', 'backend']);
      
      expect(results.length).toBe(1);
      expect(results[0].content).toBe('Auth backend code');
      expect(results[0].tags).toContain('auth');
      expect(results[0].tags).toContain('backend');
    });

    it('should return empty array for non-matching tags', async () => {
      const results = await layer.findByTags(['nonexistent']);
      expect(results).toEqual([]);
    });

    it('should return empty array for empty tags array', async () => {
      const results = await layer.findByTags([]);
      expect(results).toEqual([]);
    });

    it('should find memories by type', async () => {
      const codeResults = await layer.findByType('code');
      const docResults = await layer.findByType('documentation');
      
      expect(codeResults.length).toBe(3);
      expect(docResults.length).toBe(1);
      expect(docResults[0].content).toBe('API docs');
    });

    it('should return empty array for type with no memories', async () => {
      const results = await layer.findByType('summary');
      expect(results).toEqual([]);
    });
  });

  describe('Pagination and Listing', () => {
    beforeEach(async () => {
      // Create 10 memories with distinct content
      for (let i = 1; i <= 10; i++) {
        await layer.store(`Memory ${i}`, 'code', {}, [`tag${i}`]);
      }
    });

    it('should get all memories with default limit', async () => {
      const results = await layer.getAll();
      
      expect(results.length).toBe(10);
    });

    it('should respect limit parameter', async () => {
      const results = await layer.getAll(5);
      
      expect(results.length).toBe(5);
    });

    it('should respect offset parameter', async () => {
      const results = await layer.getAll(5, 5);
      
      expect(results.length).toBe(5);
    });

    it('should return results in descending created order', async () => {
      const results = await layer.getAll(3);
      
      expect(results[0].createdAt).toBeGreaterThanOrEqual(results[1].createdAt);
      expect(results[1].createdAt).toBeGreaterThanOrEqual(results[2].createdAt);
    });

    it('should get recent memories', async () => {
      const results = await layer.getRecent(3);
      
      expect(results.length).toBe(3);
      // Most recent
      expect(results[0].content).toBe('Memory 10');
    });
  });

  describe('Persistence', () => {
    it('should persist data across close and reopen', async () => {
      const stored = await layer.store('Persistent memory', 'documentation', { key: 'value' }, ['persistent']);
      const dbPath = layer.getDbPath();
      layer.close();

      // Reopen with same path
      const newLayer = new ProjectMemoryLayer(tempDir);
      await newLayer.ready();
      
      const retrieved = await newLayer.get(stored.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.content).toBe('Persistent memory');
      expect(retrieved?.type).toBe('documentation');
      expect(retrieved?.tags).toEqual(['persistent']);

      newLayer.close();
    });

    it('should maintain tags across close and reopen', async () => {
      await layer.store('Tagged memory 1', 'code', {}, ['tag1', 'tag2']);
      await layer.store('Tagged memory 2', 'code', {}, ['tag2', 'tag3']);
      layer.close();

      const newLayer = new ProjectMemoryLayer(tempDir);
      await newLayer.ready();
      
      const tag2Results = await newLayer.findByTags(['tag2']);
      expect(tag2Results.length).toBe(2);

      const tag13Results = await newLayer.findByTags(['tag1', 'tag3']);
      expect(tag13Results.length).toBe(0);

      newLayer.close();
    });

    it('should create database in correct location', async () => {
      await layer.ready(); // ensure schema init is complete before checking file
      const dbPath = layer.getDbPath();

      expect(dbPath).toContain('.context-fabric');
      expect(dbPath).toContain('memory.db');
      expect(fs.existsSync(dbPath)).toBe(true);
    });

    it('should use custom base directory when provided', async () => {
      const customBaseDir = path.join(tempDir, 'custom-storage');
      const customLayer = new ProjectMemoryLayer(tempDir, customBaseDir);
      await customLayer.ready();
      
      const dbPath = customLayer.getDbPath();
      expect(dbPath).toContain('custom-storage');
      expect(fs.existsSync(dbPath)).toBe(true);
      
      customLayer.close();
    });
  });

  describe('Summarize Feature', () => {
    beforeEach(async () => {
      // Ensure schema is initialized before raw inserts
      await layer.ready();
    });
    it('should return empty result when no old memories exist', async () => {
      // Create a very recent memory
      await layer.store('Recent memory', 'code');
      
      const result = await layer.summarize(1); // Summarize memories older than 1 day
      
      expect(result.summarizedCount).toBe(0);
      expect(result.summaryId).toBe('');
      expect(result.summaryContent).toBe('No memories to summarize.');
    });

    it('should summarize old memories and create a summary entry', async () => {
      // Insert old memories with raw SQL
      const oldTime = Date.now() - (10 * 24 * 60 * 60 * 1000); // 10 days ago
      
      const insertOldMemory = (content: string, type: string) => {
        const id = `old-${Math.random().toString(36).slice(2)}`;
        const db = (layer as unknown as { db: { prepare: (sql: string) => { run: (...params: unknown[]) => void } } }).db;
        db.prepare(
          'INSERT INTO memories (id, type, content, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(id, type, content, '[]', oldTime, oldTime);
        return id;
      };

      insertOldMemory('Old code 1', 'code');
      insertOldMemory('Old code 2', 'code');
      insertOldMemory('Old documentation', 'documentation');
      insertOldMemory('Old error', 'error');

      const result = await layer.summarize(5); // Summarize memories older than 5 days
      
      expect(result.summarizedCount).toBe(4);
      expect(result.summaryId).toBeDefined();
      expect(result.summaryId.length).toBeGreaterThan(0);
      expect(result.summaryContent).toContain('Summary of 4');
      expect(result.summaryContent).toContain('code: 2');
      expect(result.summaryContent).toContain('documentation: 1');
      expect(result.summaryContent).toContain('error: 1');

      // Verify old memories are deleted
      const allMemories = await layer.getAll(100);
      expect(allMemories.length).toBe(1); // Only the summary should remain
      expect(allMemories[0].type).toBe('summary');
    });

    it('should not summarize summary memories', async () => {
      // Create a summary memory manually (older than cutoff)
      const oldTime = Date.now() - (10 * 24 * 60 * 60 * 1000);
      const id = `summary-${Math.random().toString(36).slice(2)}`;
      
      const db = (layer as unknown as { db: { prepare: (sql: string) => { run: (...params: unknown[]) => void } } }).db;
      db.prepare(
        'INSERT INTO memories (id, type, content, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(id, 'summary', 'Previous summary', '["summary"]', oldTime, oldTime);

      const result = await layer.summarize(5);
      
      // Should not include the existing summary in the new summary
      expect(result.summarizedCount).toBe(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle special characters in content', async () => {
      const specialContent = 'Special chars: "quotes" \'apostrophes\' <html> & ampersands 🎉 emoji';
      const memory = await layer.store(specialContent, 'code');
      
      const retrieved = await layer.get(memory.id);
      expect(retrieved?.content).toBe(specialContent);
    });

    it('should handle large content', async () => {
      const largeContent = 'x'.repeat(10000);
      const memory = await layer.store(largeContent, 'documentation');
      
      const retrieved = await layer.get(memory.id);
      expect(retrieved?.content.length).toBe(10000);
    });

    it('should handle empty strings', async () => {
      const memory = await layer.store('', 'code');
      
      const retrieved = await layer.get(memory.id);
      expect(retrieved?.content).toBe('');
    });

    it('should update tags correctly when some are removed', async () => {
      const stored = await layer.store('Test', 'code', {}, ['a', 'b', 'c', 'd']);
      
      await layer.update(stored.id, { tags: ['a', 'c'] });
      
      // Check via tag search
      const aResults = await layer.findByTags(['a']);
      const bResults = await layer.findByTags(['b']);
      const cResults = await layer.findByTags(['c']);
      const dResults = await layer.findByTags(['d']);
      
      expect(aResults.length).toBe(1);
      expect(bResults.length).toBe(0);
      expect(cResults.length).toBe(1);
      expect(dResults.length).toBe(0);
    });

    it('should handle metadata with nested objects', async () => {
      const metadata = {
        nested: {
          deeply: {
            value: 'test',
            array: [1, 2, 3],
          },
        },
        array: ['a', 'b'],
      };
      
      const memory = await layer.store('Nested test', 'code', metadata);
      const retrieved = await layer.get(memory.id);
      
      expect(retrieved?.metadata).toMatchObject(metadata);
    });

    it('should handle concurrent operations', { timeout: 30000 }, async () => {
      // Store multiple memories concurrently
      const promises: Promise<ReturnType<ProjectMemoryLayer['store']>>[] = [];
      for (let i = 0; i < 100; i++) {
        promises.push(layer.store(`Memory ${i}`, 'code', {}, [`tag${i % 10}`]));
      }
      
      await Promise.all(promises);
      
      // Verify all were stored
      const allMemories = await layer.getAll(1000);
      expect(allMemories.length).toBe(100);
      
      // Verify tag distribution
      for (let i = 0; i < 10; i++) {
        const tagResults = await layer.findByTags([`tag${i}`]);
        expect(tagResults.length).toBe(10);
      }
    });
  });
});
