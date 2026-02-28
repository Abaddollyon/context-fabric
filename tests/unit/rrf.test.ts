/**
 * RRF (Reciprocal Rank Fusion) Unit Tests
 * Tests the pure algorithm: fuseRRF() static method on ContextEngine.
 */

import { describe, it, expect } from 'vitest';
import { ContextEngine, RankedMemory } from '../../src/engine.js';
import { MemoryLayer } from '../../src/types.js';

/** Helper to create a minimal RankedMemory for testing. */
function mem(id: string, similarity: number, layer = MemoryLayer.L2_PROJECT, weight?: number): RankedMemory {
  return {
    id,
    type: 'decision',
    content: `Memory ${id}`,
    metadata: {
      tags: [],
      relationships: [],
      confidence: 0.8,
      source: 'ai_inferred' as const,
      cliType: 'generic',
      ...(weight !== undefined ? { weight } : {}),
    },
    tags: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    layer,
    similarity,
  };
}

describe('fuseRRF', () => {
  it('should rank items appearing in both lists higher than items in one list', () => {
    const listA = [mem('a', 0.9), mem('b', 0.8), mem('c', 0.7)];
    const listB = [mem('b', 0.85), mem('d', 0.6), mem('a', 0.5)];

    const fused = ContextEngine.fuseRRF(listA, listB, 10);

    // 'a' and 'b' appear in both lists, so they should have higher RRF scores
    const ids = fused.map(m => m.id);
    // 'a' is rank 1 in listA and rank 3 in listB → total = 1/61 + 1/63
    // 'b' is rank 2 in listA and rank 1 in listB → total = 1/62 + 1/61
    // 'b' should have the highest score
    expect(ids[0]).toBe('b');
    expect(ids[1]).toBe('a');
  });

  it('should handle disjoint lists', () => {
    const listA = [mem('a', 0.9), mem('b', 0.8)];
    const listB = [mem('c', 0.7), mem('d', 0.6)];

    const fused = ContextEngine.fuseRRF(listA, listB, 10);
    expect(fused).toHaveLength(4);

    // All items should appear
    const ids = new Set(fused.map(m => m.id));
    expect(ids).toEqual(new Set(['a', 'b', 'c', 'd']));

    // a and c both at rank 1 in their respective lists → same RRF score → same normalized score
    // After normalization, the top items should be 1.0
    expect(fused[0].similarity).toBeCloseTo(1.0);
    expect(fused[1].similarity).toBeCloseTo(1.0);
  });

  it('should handle empty list A', () => {
    const listB = [mem('x', 0.5), mem('y', 0.4)];
    const fused = ContextEngine.fuseRRF([], listB, 10);
    expect(fused).toHaveLength(2);
    expect(fused[0].id).toBe('x');
  });

  it('should handle empty list B', () => {
    const listA = [mem('x', 0.5)];
    const fused = ContextEngine.fuseRRF(listA, [], 10);
    expect(fused).toHaveLength(1);
    expect(fused[0].id).toBe('x');
  });

  it('should handle both lists empty', () => {
    const fused = ContextEngine.fuseRRF([], [], 10);
    expect(fused).toHaveLength(0);
  });

  it('should respect the limit parameter', () => {
    const listA = [mem('a', 0.9), mem('b', 0.8), mem('c', 0.7)];
    const listB = [mem('d', 0.6), mem('e', 0.5)];

    const fused = ContextEngine.fuseRRF(listA, listB, 2);
    expect(fused).toHaveLength(2);
  });

  it('should deduplicate by ID and keep higher similarity version', () => {
    const listA = [mem('dup', 0.3, MemoryLayer.L2_PROJECT)];
    const listB = [mem('dup', 0.9, MemoryLayer.L3_SEMANTIC)];

    const fused = ContextEngine.fuseRRF(listA, listB, 10);
    expect(fused).toHaveLength(1);
    // Should keep the version from listB (higher similarity)
    expect(fused[0].layer).toBe(MemoryLayer.L3_SEMANTIC);
  });

  it('should normalize top result to 1.0', () => {
    const listA = [mem('x', 0.9)];
    const listB = [mem('x', 0.8)];

    const fused = ContextEngine.fuseRRF(listA, listB, 10);
    expect(fused).toHaveLength(1);
    // Single item is the top result → normalized to 1.0
    expect(fused[0].similarity).toBeCloseTo(1.0);
  });

  it('should normalize relative scores preserving order', () => {
    const listA = [mem('a', 0.9), mem('b', 0.8)];
    const listB = [mem('a', 0.7)];

    const fused = ContextEngine.fuseRRF(listA, listB, 10);
    // 'a' is in both lists (higher score), 'b' in one list (lower score)
    expect(fused[0].id).toBe('a');
    expect(fused[0].similarity).toBeCloseTo(1.0); // top result normalized to 1
    expect(fused[1].similarity).toBeLessThan(1.0);
    expect(fused[1].similarity).toBeGreaterThan(0);
  });

  it('should use custom k parameter', () => {
    // With different k values, relative ordering of items in both lists vs single list changes
    const listA = [mem('both', 0.9), mem('only-a', 0.8)];
    const listB = [mem('both', 0.7), mem('only-b', 0.6)];

    const result = ContextEngine.fuseRRF(listA, listB, 10, 60);
    // 'both' should always be first (appears in both lists)
    expect(result[0].id).toBe('both');
    expect(result[0].similarity).toBeCloseTo(1.0); // top result normalized
  });
});
