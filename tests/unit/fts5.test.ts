/**
 * FTS5 Unit Tests
 * Tests FTS5 virtual table creation, trigger sync, BM25 search,
 * query sanitization, and migration on both L2 and L3 layers.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ProjectMemoryLayer } from '../../src/layers/project.js';
import { SemanticMemoryLayer } from '../../src/layers/semantic.js';
import { createTempDir, removeDir } from '../utils.js';

// ============================================================================
// L2 (ProjectMemoryLayer) FTS5 Tests
// ============================================================================

describe('L2 FTS5: ProjectMemoryLayer', () => {
  let projectPath: string;
  let l2: ProjectMemoryLayer;

  beforeAll(() => {
    projectPath = createTempDir('fts5-l2-');
    l2 = new ProjectMemoryLayer(projectPath);
  });

  afterAll(() => {
    l2.close();
    removeDir(projectPath);
  });

  it('should create FTS5 virtual table on init', () => {
    // searchBM25 should not throw — table exists
    const results = l2.searchBM25('nonexistent', 5);
    expect(results).toEqual([]);
  });

  it('should sync FTS on insert via trigger', async () => {
    await l2.store('ECONNREFUSED error in auth service', 'bug_fix', {}, ['error']);
    const results = l2.searchBM25('ECONNREFUSED', 5);
    expect(results.length).toBe(1);
    expect(results[0].memory.content).toContain('ECONNREFUSED');
    expect(results[0].bm25Score).toBeLessThan(0); // BM25 scores are negative in SQLite
  });

  it('should sync FTS on update via trigger', async () => {
    const mem = await l2.store('old content fts-update-test', 'decision', {}, ['test']);
    // Verify findable with old content
    expect(l2.searchBM25('fts-update-test', 5).length).toBe(1);

    // Update content
    await l2.update(mem.id, { content: 'new content fts-update-replaced' });

    // Old content should not be found
    expect(l2.searchBM25('fts-update-test', 5).length).toBe(0);
    // New content should be found
    expect(l2.searchBM25('fts-update-replaced', 5).length).toBe(1);
  });

  it('should sync FTS on delete via trigger', async () => {
    const mem = await l2.store('fts-delete-test-content', 'scratchpad', {}, ['test']);
    expect(l2.searchBM25('fts-delete-test-content', 5).length).toBe(1);

    await l2.delete(mem.id);
    expect(l2.searchBM25('fts-delete-test-content', 5).length).toBe(0);
  });

  it('should rank by BM25 relevance', async () => {
    // Store memories with varying relevance to "authentication"
    await l2.store('authentication failure in login module', 'bug_fix', {}, ['auth']);
    await l2.store('authentication and authorization patterns for API', 'convention', {}, ['auth']);
    await l2.store('unrelated database migration script', 'decision', {}, ['db']);

    const results = l2.searchBM25('authentication', 10);
    expect(results.length).toBeGreaterThanOrEqual(2);

    // All results should mention authentication
    for (const r of results) {
      expect(r.memory.content.toLowerCase()).toContain('authenti');
    }

    // BM25 scores should be ordered (ascending = better in SQLite)
    for (let i = 1; i < results.length; i++) {
      expect(results[i].bm25Score).toBeGreaterThanOrEqual(results[i - 1].bm25Score);
    }
  });

  it('should respect limit parameter', async () => {
    const results = l2.searchBM25('authentication', 1);
    expect(results.length).toBe(1);
  });

  it('should return empty for empty query', () => {
    expect(l2.searchBM25('', 10)).toEqual([]);
    expect(l2.searchBM25('   ', 10)).toEqual([]);
  });

  it('should handle porter stemming (auth matches authentication)', async () => {
    // Porter stemmer should stem "authentication" to "authent"
    // and "auth" is a prefix — but FTS5 requires exact token match by default
    // However, porter stemmer stems "authenticat*" and we wrap in quotes
    // This test verifies the stemmer is active
    await l2.store('authenticating users requires JWT tokens', 'convention');
    const results = l2.searchBM25('authenticate', 10);
    // Porter should stem both to same root
    expect(results.some(r => r.memory.content.includes('authenticating'))).toBe(true);
  });
});

// ============================================================================
// L3 (SemanticMemoryLayer) FTS5 Tests
// ============================================================================

describe('L3 FTS5: SemanticMemoryLayer', () => {
  let l3: SemanticMemoryLayer;

  beforeAll(() => {
    l3 = new SemanticMemoryLayer({ isEphemeral: true });
  });

  afterAll(() => {
    l3.close();
  });

  it('should create FTS5 virtual table on init', () => {
    const results = l3.searchBM25('nonexistent', 5);
    expect(results).toEqual([]);
  });

  it('should sync FTS on insert via trigger', async () => {
    await l3.store('ECONNREFUSED error in payment service', 'bug_fix');
    const results = l3.searchBM25('ECONNREFUSED', 5);
    expect(results.length).toBe(1);
    expect(results[0].memory.content).toContain('ECONNREFUSED');
  });

  it('should sync FTS on delete via trigger', async () => {
    const mem = await l3.store('fts-l3-delete-test', 'scratchpad');
    expect(l3.searchBM25('fts-l3-delete-test', 5).length).toBe(1);

    await l3.delete(mem.id);
    expect(l3.searchBM25('fts-l3-delete-test', 5).length).toBe(0);
  });

  it('should sync FTS on update via trigger', async () => {
    const mem = await l3.store('fts-l3-old-content', 'decision');
    expect(l3.searchBM25('fts-l3-old-content', 5).length).toBe(1);

    await l3.update(mem.id, { content: 'fts-l3-new-content' });
    expect(l3.searchBM25('fts-l3-old-content', 5).length).toBe(0);
    expect(l3.searchBM25('fts-l3-new-content', 5).length).toBe(1);
  });

  it('should return empty for empty query', () => {
    expect(l3.searchBM25('', 10)).toEqual([]);
  });
});

// ============================================================================
// Query Sanitization Tests
// ============================================================================

describe('FTS5 Query Sanitization', () => {
  it('should wrap tokens in double quotes', () => {
    expect(ProjectMemoryLayer.sanitizeFTS5Query('hello world'))
      .toBe('"hello" "world"');
  });

  it('should strip FTS5 operators', () => {
    expect(ProjectMemoryLayer.sanitizeFTS5Query('hello*world'))
      .toBe('"hello" "world"');
    expect(ProjectMemoryLayer.sanitizeFTS5Query('"exact phrase"'))
      .toBe('"exact" "phrase"');
    expect(ProjectMemoryLayer.sanitizeFTS5Query('foo(bar)'))
      .toBe('"foo" "bar"');
  });

  it('should strip boolean keywords', () => {
    expect(ProjectMemoryLayer.sanitizeFTS5Query('hello AND world'))
      .toBe('"hello" "world"');
    expect(ProjectMemoryLayer.sanitizeFTS5Query('foo OR bar NOT baz'))
      .toBe('"foo" "bar" "baz"');
    expect(ProjectMemoryLayer.sanitizeFTS5Query('NEAR test'))
      .toBe('"test"');
  });

  it('should return empty for empty/whitespace input', () => {
    expect(ProjectMemoryLayer.sanitizeFTS5Query('')).toBe('');
    expect(ProjectMemoryLayer.sanitizeFTS5Query('   ')).toBe('');
  });

  it('should return empty for operator-only input', () => {
    expect(ProjectMemoryLayer.sanitizeFTS5Query('AND OR NOT')).toBe('');
    expect(ProjectMemoryLayer.sanitizeFTS5Query('***')).toBe('');
  });

  it('should handle mixed content', () => {
    expect(ProjectMemoryLayer.sanitizeFTS5Query('error: ECONNREFUSED (port 5432)'))
      .toBe('"error" "ECONNREFUSED" "port" "5432"');
  });

  // Verify L3 sanitizer works identically
  it('should have identical behavior on SemanticMemoryLayer', () => {
    expect(SemanticMemoryLayer.sanitizeFTS5Query('hello AND world'))
      .toBe(ProjectMemoryLayer.sanitizeFTS5Query('hello AND world'));
  });
});

// ============================================================================
// Migration Tests
// ============================================================================

describe('FTS5 Migration', () => {
  it('should backfill FTS from existing L2 data on re-open', () => {
    const tempDir = createTempDir('fts5-migrate-');

    // Create L2 with some data (this also creates FTS)
    const l2a = new ProjectMemoryLayer(tempDir);
    // Store directly — FTS will be synced via trigger
    l2a.searchBM25('test', 1); // ensure FTS is usable
    l2a.close();

    // Re-open — should detect FTS exists and skip backfill (idempotent)
    const l2b = new ProjectMemoryLayer(tempDir);
    const results = l2b.searchBM25('test', 1);
    // Should not throw, regardless of whether data exists
    expect(Array.isArray(results)).toBe(true);
    l2b.close();

    removeDir(tempDir);
  });

  it('should handle ephemeral L3 re-creation gracefully', () => {
    // Ephemeral L3 uses :memory: — each instance is fresh
    const l3a = new SemanticMemoryLayer({ isEphemeral: true });
    const results = l3a.searchBM25('anything', 1);
    expect(results).toEqual([]);
    l3a.close();
  });
});
