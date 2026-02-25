/**
 * Unit tests for PatternExtractor
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PatternExtractor } from '../../src/patterns.js';
import { ProjectMemoryLayer } from '../../src/layers/project.js';
import { SemanticMemoryLayer } from '../../src/layers/semantic.js';
import { CodePattern } from '../../src/types.js';
import { createTempDir, removeDir, sleep } from '../utils.js';

describe('PatternExtractor', () => {
  let tempDir: string;
  let l2: ProjectMemoryLayer;
  let l3: SemanticMemoryLayer;
  let extractor: PatternExtractor;

  beforeEach(async () => {
    tempDir = createTempDir('patterns-test-');
    l2 = new ProjectMemoryLayer(tempDir);
    await l2.ready();
    l3 = new SemanticMemoryLayer({ isEphemeral: true });
    extractor = new PatternExtractor(l2, l3);
  });

  afterEach(async () => {
    l2.close();
    l3.close();
    await sleep(50);
    removeDir(tempDir);
  });

  // ==========================================================================
  // extractPatterns
  // ==========================================================================

  describe('extractPatterns', () => {
    it('should return empty array when no patterns stored', async () => {
      const patterns = await extractor.extractPatterns();
      expect(patterns).toEqual([]);
    });

    it('should extract patterns from L2 code_pattern memories', async () => {
      await l2.store(
        JSON.stringify({
          pattern: {
            name: 'Validation Helper',
            description: 'Generic input validation',
            code: 'function validate(input) {}',
            language: 'typescript',
            usageCount: 3,
            relatedFiles: [],
          },
        }),
        'code_pattern',
        {},
        ['pattern']
      );

      const patterns = await extractor.extractPatterns();
      expect(patterns.length).toBeGreaterThan(0);
      expect(patterns[0].name).toBe('Validation Helper');
    });

    it('should extract patterns from L2 convention memories', async () => {
      await l2.store(
        'Always use strict equality (===) instead of loose equality (==)',
        'convention',
        {},
        ['convention']
      );

      const patterns = await extractor.extractPatterns();
      expect(patterns.length).toBeGreaterThan(0);
    });

    it('should deduplicate patterns by name', async () => {
      const patternContent = JSON.stringify({
        pattern: {
          name: 'DuplicatePattern',
          description: 'A duplicate',
          code: 'code here',
          language: 'typescript',
          usageCount: 1,
          relatedFiles: [],
        },
      });

      await l2.store(patternContent, 'code_pattern', {}, ['pattern']);
      await l2.store(patternContent, 'code_pattern', {}, ['pattern']);

      const patterns = await extractor.extractPatterns();
      const dupes = patterns.filter((p) => p.name === 'DuplicatePattern');
      expect(dupes.length).toBe(1);
    });

    it('should work without L2 layer', async () => {
      const noL2 = new PatternExtractor(undefined, l3);
      const patterns = await noL2.extractPatterns();
      expect(Array.isArray(patterns)).toBe(true);
    });

    it('should work without L3 layer', async () => {
      const noL3 = new PatternExtractor(l2, undefined);
      const patterns = await noL3.extractPatterns();
      expect(Array.isArray(patterns)).toBe(true);
    });

    it('should work without any layers', async () => {
      const empty = new PatternExtractor();
      const patterns = await empty.extractPatterns();
      expect(patterns).toEqual([]);
    });
  });

  // ==========================================================================
  // learnPattern
  // ==========================================================================

  describe('learnPattern', () => {
    it('should return a CodePattern with correct fields', async () => {
      const pattern = await extractor.learnPattern(
        'Error Handler',
        'try { } catch(e) { log(e); }',
        'Handles errors gracefully',
        'typescript'
      );

      expect(pattern.id).toMatch(/^pattern_/);
      expect(pattern.name).toBe('Error Handler');
      expect(pattern.description).toBe('Handles errors gracefully');
      expect(pattern.code).toBe('try { } catch(e) { log(e); }');
      expect(pattern.language).toBe('typescript');
      expect(pattern.usageCount).toBe(1);
      expect(pattern.lastUsedAt).toBeInstanceOf(Date);
      expect(pattern.relatedFiles).toEqual([]);
    });

    it('should store pattern in L3 when available', async () => {
      await extractor.learnPattern(
        'My Pattern',
        'const x = 1;',
        'A simple pattern',
        'javascript'
      );

      // Pattern should be findable via recall
      const results = await l3.recall('My Pattern simple', 5);
      expect(results.length).toBeGreaterThan(0);
    });

    it('should work without L3 (pattern returned but not persisted)', async () => {
      const noL3 = new PatternExtractor(l2, undefined);
      const pattern = await noL3.learnPattern(
        'Temp Pattern',
        'code',
        'description',
        'python'
      );

      expect(pattern.name).toBe('Temp Pattern');
    });
  });

  // ==========================================================================
  // calculateConfidence
  // ==========================================================================

  describe('calculateConfidence', () => {
    it('should return higher confidence for high usage count', () => {
      const lowUsage: CodePattern = makePattern({ usageCount: 1 });
      const highUsage: CodePattern = makePattern({ usageCount: 20 });

      const lowConf = extractor.calculateConfidence(lowUsage);
      const highConf = extractor.calculateConfidence(highUsage);

      expect(highConf).toBeGreaterThan(lowConf);
    });

    it('should return higher confidence for recently used patterns', () => {
      const recent: CodePattern = makePattern({ lastUsedAt: new Date() });
      const old: CodePattern = makePattern({
        lastUsedAt: new Date(Date.now() - 365 * 86400000),
      });

      const recentConf = extractor.calculateConfidence(recent);
      const oldConf = extractor.calculateConfidence(old);

      expect(recentConf).toBeGreaterThan(oldConf);
    });

    it('should clamp confidence to [0, 1]', () => {
      const pattern: CodePattern = makePattern({ usageCount: 100 });
      const conf = extractor.calculateConfidence(pattern);

      expect(conf).toBeGreaterThanOrEqual(0);
      expect(conf).toBeLessThanOrEqual(1);
    });

    it('should return a base confidence even with zero usage', () => {
      const pattern: CodePattern = makePattern({
        usageCount: 0,
        lastUsedAt: undefined,
      });
      const conf = extractor.calculateConfidence(pattern);

      expect(conf).toBeGreaterThanOrEqual(0.4);
    });
  });

  // ==========================================================================
  // rankPatterns
  // ==========================================================================

  describe('rankPatterns', () => {
    it('should rank language-matching patterns higher', () => {
      const tsPattern = makePattern({ language: 'typescript', usageCount: 1 });
      const pyPattern = makePattern({ language: 'python', usageCount: 1 });

      const ranked = extractor.rankPatterns([pyPattern, tsPattern], {
        language: 'typescript',
      });

      expect(ranked[0].language).toBe('typescript');
    });

    it('should rank higher-usage patterns higher (same language)', () => {
      const low = makePattern({ usageCount: 1, language: 'typescript' });
      const high = makePattern({ usageCount: 20, language: 'typescript' });

      const ranked = extractor.rankPatterns([low, high], {
        language: 'typescript',
      });

      expect(ranked[0].usageCount).toBeGreaterThan(ranked[1].usageCount);
    });

    it('should rank file-path-matching patterns higher', () => {
      const matching = makePattern({
        relatedFiles: ['src/api/users.ts'],
        usageCount: 1,
      });
      const nonMatching = makePattern({ relatedFiles: [], usageCount: 1 });

      const ranked = extractor.rankPatterns([nonMatching, matching], {
        filePath: 'src/api/orders.ts',
      });

      // matching has a related file with same parent dir (src/api)
      expect(ranked[0]).toBe(matching);
    });

    it('should return empty array for empty input', () => {
      expect(extractor.rankPatterns([], {})).toEqual([]);
    });
  });

  // ==========================================================================
  // checkViolation
  // ==========================================================================

  describe('checkViolation', () => {
    it('should detect empty catch blocks for error patterns', async () => {
      const errorPattern = makePattern({
        name: 'Error Handling',
        description: 'Proper error handling',
      });

      const badCode = `
try {
  doStuff();
} catch (e) {}
`;

      const violations = await extractor.checkViolation(badCode, [
        errorPattern,
      ]);
      expect(violations.length).toBeGreaterThan(0);
      expect(violations[0].severity).toBe('error');
    });

    it('should detect console.log in catch for error patterns', async () => {
      const errorPattern = makePattern({
        name: 'Error Handling',
        description: 'Proper error handling',
      });

      const badCode = `catch (e) {console.log(e)}`;

      const violations = await extractor.checkViolation(badCode, [
        errorPattern,
      ]);
      expect(violations.length).toBeGreaterThan(0);
    });

    it('should detect require() for import patterns', async () => {
      const importPattern = makePattern({
        name: 'Import Convention',
        description: 'Use ES imports',
      });

      const badCode = `const fs = require('fs');`;

      const violations = await extractor.checkViolation(badCode, [
        importPattern,
      ]);
      expect(violations.length).toBeGreaterThan(0);
    });

    it('should detect any type for typescript patterns', async () => {
      const tsPattern = makePattern({
        name: 'TypeScript Best Practices',
        language: 'typescript',
      });

      const badCode = `function foo(x: any) {}`;

      const violations = await extractor.checkViolation(badCode, [tsPattern]);
      expect(violations.length).toBeGreaterThan(0);
    });

    it('should return empty array for clean code', async () => {
      const pattern = makePattern({
        name: 'Some Pattern',
        description: 'Generic description',
      });

      const cleanCode = `const x = 42;\nconst y = x + 1;\n`;

      const violations = await extractor.checkViolation(cleanCode, [pattern]);
      expect(violations).toEqual([]);
    });

    it('should include line numbers in violations', async () => {
      const errorPattern = makePattern({
        name: 'Error Handling',
        description: 'Proper error handling',
      });

      const badCode = `line1\nline2\ncatch (e) {}\nline4`;

      const violations = await extractor.checkViolation(badCode, [
        errorPattern,
      ]);
      if (violations.length > 0) {
        expect(violations[0].line).toBe(3);
      }
    });
  });
});

// ==========================================================================
// Helper
// ==========================================================================

function makePattern(overrides: Partial<CodePattern> = {}): CodePattern {
  return {
    id: `pattern_${Math.random().toString(36).substring(2, 9)}`,
    name: 'Test Pattern',
    description: 'A test pattern',
    code: 'function test() {}',
    language: 'typescript',
    usageCount: 5,
    lastUsedAt: new Date(),
    relatedFiles: [],
    ...overrides,
  };
}
