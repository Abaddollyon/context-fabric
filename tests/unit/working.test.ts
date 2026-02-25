/**
 * Unit tests for WorkingMemoryLayer (L1)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WorkingMemoryLayer } from '../../src/layers/working.js';
import { MemoryLayer } from '../../src/types.js';

describe('WorkingMemoryLayer', () => {
  let layer: WorkingMemoryLayer;

  beforeEach(() => {
    layer = new WorkingMemoryLayer({ maxSize: 5, defaultTTL: 60 });
  });

  afterEach(() => {
    layer.stopCleanupInterval();
  });

  // ==========================================================================
  // store
  // ==========================================================================

  describe('store', () => {
    it('should store a memory and return it with correct fields', () => {
      const mem = layer.store('hello world', 'scratchpad');

      expect(mem.id).toMatch(/^wm_/);
      expect(mem.content).toBe('hello world');
      expect(mem.type).toBe('scratchpad');
      expect(mem.layer).toBe(MemoryLayer.L1_WORKING);
      expect(mem.createdAt).toBeInstanceOf(Date);
      expect(mem.updatedAt).toBeInstanceOf(Date);
      expect(mem.accessCount).toBe(0);
      expect(mem.ttl).toBe(60);
    });

    it('should use custom TTL when provided', () => {
      const mem = layer.store('note', 'scratchpad', {}, 120);
      expect(mem.ttl).toBe(120);
    });

    it('should use default TTL when not provided', () => {
      const mem = layer.store('note', 'scratchpad');
      expect(mem.ttl).toBe(60);
    });

    it('should preserve metadata tags', () => {
      const mem = layer.store('note', 'scratchpad', {
        tags: ['a', 'b'],
        confidence: 0.95,
        source: 'user_explicit',
      });

      expect(mem.metadata?.tags).toEqual(['a', 'b']);
      expect(mem.metadata?.confidence).toBe(0.95);
      expect(mem.metadata?.source).toBe('user_explicit');
    });

    it('should set default metadata values', () => {
      const mem = layer.store('note', 'scratchpad');

      expect(mem.metadata?.tags).toEqual([]);
      expect(mem.metadata?.confidence).toBe(0.8);
      expect(mem.metadata?.source).toBe('ai_inferred');
      expect(mem.metadata?.cliType).toBe('generic');
    });

    it('should generate unique IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 20; i++) {
        ids.add(layer.store(`item ${i}`, 'scratchpad').id);
      }
      // Note: maxSize is 5, so LRU eviction will fire, but IDs should still be unique
      expect(ids.size).toBe(20);
    });
  });

  // ==========================================================================
  // get
  // ==========================================================================

  describe('get', () => {
    it('should return a stored memory by ID', () => {
      const mem = layer.store('test', 'scratchpad');
      const retrieved = layer.get(mem.id);

      expect(retrieved).toBeDefined();
      expect(retrieved!.content).toBe('test');
    });

    it('should return undefined for non-existent ID', () => {
      expect(layer.get('non_existent')).toBeUndefined();
    });

    it('should increment accessCount on get', () => {
      const mem = layer.store('test', 'scratchpad');
      expect(mem.accessCount).toBe(0);

      const first = layer.get(mem.id);
      expect(first!.accessCount).toBe(1);

      const second = layer.get(mem.id);
      expect(second!.accessCount).toBe(2);
    });

    it('should update lastAccessedAt on get', () => {
      const mem = layer.store('test', 'scratchpad');
      const originalAccess = mem.lastAccessedAt;

      // Small delay to ensure time difference
      const retrieved = layer.get(mem.id);
      expect(retrieved!.lastAccessedAt!.getTime()).toBeGreaterThanOrEqual(
        originalAccess!.getTime()
      );
    });

    it('should return undefined for expired memories', () => {
      // Store with 0-second TTL (already expired)
      vi.useFakeTimers();
      const mem = layer.store('ephemeral', 'scratchpad', {}, 1);

      // Advance time past TTL
      vi.advanceTimersByTime(2000);

      expect(layer.get(mem.id)).toBeUndefined();
      vi.useRealTimers();
    });
  });

  // ==========================================================================
  // getAll
  // ==========================================================================

  describe('getAll', () => {
    it('should return all non-expired memories', () => {
      layer.store('a', 'scratchpad');
      layer.store('b', 'scratchpad');
      layer.store('c', 'scratchpad');

      expect(layer.getAll()).toHaveLength(3);
    });

    it('should return empty array when no memories stored', () => {
      expect(layer.getAll()).toEqual([]);
    });

    it('should filter out expired memories', () => {
      vi.useFakeTimers();
      layer.store('short', 'scratchpad', {}, 1);
      layer.store('long', 'scratchpad', {}, 9999);

      vi.advanceTimersByTime(2000);

      const all = layer.getAll();
      expect(all).toHaveLength(1);
      expect(all[0].content).toBe('long');
      vi.useRealTimers();
    });
  });

  // ==========================================================================
  // delete
  // ==========================================================================

  describe('delete', () => {
    it('should delete a memory and return true', () => {
      const mem = layer.store('test', 'scratchpad');
      expect(layer.delete(mem.id)).toBe(true);
      expect(layer.get(mem.id)).toBeUndefined();
    });

    it('should return false for non-existent ID', () => {
      expect(layer.delete('non_existent')).toBe(false);
    });

    it('should reduce size after deletion', () => {
      const mem = layer.store('test', 'scratchpad');
      expect(layer.size()).toBe(1);
      layer.delete(mem.id);
      expect(layer.size()).toBe(0);
    });
  });

  // ==========================================================================
  // touch
  // ==========================================================================

  describe('touch', () => {
    it('should update access time and count', () => {
      const mem = layer.store('test', 'scratchpad');
      const originalAccess = mem.lastAccessedAt;

      layer.touch(mem.id);

      const entry = layer.get(mem.id);
      // accessCount: touch sets +1, then get sets +1 = 2
      expect(entry!.accessCount).toBe(2);
    });

    it('should not throw for non-existent ID', () => {
      expect(() => layer.touch('non_existent')).not.toThrow();
    });

    it('should not touch expired memories', () => {
      vi.useFakeTimers();
      const mem = layer.store('test', 'scratchpad', {}, 1);
      vi.advanceTimersByTime(2000);

      layer.touch(mem.id);
      // Memory is expired, so get should return undefined
      expect(layer.get(mem.id)).toBeUndefined();
      vi.useRealTimers();
    });
  });

  // ==========================================================================
  // cleanup
  // ==========================================================================

  describe('cleanup', () => {
    it('should remove expired entries and return count', () => {
      vi.useFakeTimers();
      layer.store('a', 'scratchpad', {}, 1);
      layer.store('b', 'scratchpad', {}, 1);
      layer.store('c', 'scratchpad', {}, 9999);

      vi.advanceTimersByTime(2000);

      const deleted = layer.cleanup();
      expect(deleted).toBe(2);
      expect(layer.size()).toBe(1);
      vi.useRealTimers();
    });

    it('should return 0 when no expired entries', () => {
      layer.store('a', 'scratchpad', {}, 9999);
      expect(layer.cleanup()).toBe(0);
    });

    it('should return 0 when empty', () => {
      expect(layer.cleanup()).toBe(0);
    });
  });

  // ==========================================================================
  // clear
  // ==========================================================================

  describe('clear', () => {
    it('should remove all memories', () => {
      layer.store('a', 'scratchpad');
      layer.store('b', 'scratchpad');
      expect(layer.size()).toBe(2);

      layer.clear();
      expect(layer.size()).toBe(0);
      expect(layer.getAll()).toEqual([]);
    });
  });

  // ==========================================================================
  // size
  // ==========================================================================

  describe('size', () => {
    it('should return 0 for empty layer', () => {
      expect(layer.size()).toBe(0);
    });

    it('should reflect number of stored memories', () => {
      layer.store('a', 'scratchpad');
      expect(layer.size()).toBe(1);
      layer.store('b', 'scratchpad');
      expect(layer.size()).toBe(2);
    });
  });

  // ==========================================================================
  // LRU Eviction
  // ==========================================================================

  describe('LRU eviction', () => {
    it('should evict the least recently accessed memory when at capacity', () => {
      // maxSize is 5
      const first = layer.store('first', 'scratchpad');
      layer.store('second', 'scratchpad');
      layer.store('third', 'scratchpad');
      layer.store('fourth', 'scratchpad');
      layer.store('fifth', 'scratchpad');

      // At capacity — next store should evict "first" (oldest access)
      layer.store('sixth', 'scratchpad');

      expect(layer.size()).toBe(5);
      expect(layer.get(first.id)).toBeUndefined();
    });

    it('should keep recently accessed memories during eviction', async () => {
      // Use fake timers for deterministic LRU ordering
      vi.useFakeTimers();

      const first = layer.store('first', 'scratchpad');
      vi.advanceTimersByTime(10);
      layer.store('second', 'scratchpad');
      vi.advanceTimersByTime(10);
      layer.store('third', 'scratchpad');
      vi.advanceTimersByTime(10);
      layer.store('fourth', 'scratchpad');
      vi.advanceTimersByTime(10);
      layer.store('fifth', 'scratchpad');
      vi.advanceTimersByTime(10);

      // Access "first" so it becomes the most recently used
      layer.get(first.id);
      vi.advanceTimersByTime(10);

      // Now "second" has the oldest lastAccessedAt
      layer.store('sixth', 'scratchpad');

      // "first" should still be there because we accessed it recently
      expect(layer.get(first.id)).toBeDefined();
      expect(layer.size()).toBe(5);

      vi.useRealTimers();
    });
  });

  // ==========================================================================
  // Cleanup Interval
  // ==========================================================================

  describe('cleanup interval', () => {
    it('should start and stop without error', () => {
      expect(() => layer.startCleanupInterval(1000)).not.toThrow();
      expect(() => layer.stopCleanupInterval()).not.toThrow();
    });

    it('should stop existing interval when starting a new one', () => {
      layer.startCleanupInterval(1000);
      expect(() => layer.startCleanupInterval(2000)).not.toThrow();
      layer.stopCleanupInterval();
    });

    it('should be safe to stop when no interval is running', () => {
      expect(() => layer.stopCleanupInterval()).not.toThrow();
    });
  });

  // ==========================================================================
  // Constructor Options
  // ==========================================================================

  describe('constructor options', () => {
    it('should use defaults when no options provided', () => {
      const defaultLayer = new WorkingMemoryLayer();
      const mem = defaultLayer.store('test', 'scratchpad');
      expect(mem.ttl).toBe(3600); // default TTL
      defaultLayer.stopCleanupInterval();
    });

    it('should respect custom maxSize', () => {
      const small = new WorkingMemoryLayer({ maxSize: 2 });
      small.store('a', 'scratchpad');
      small.store('b', 'scratchpad');
      small.store('c', 'scratchpad');
      expect(small.size()).toBe(2);
      small.stopCleanupInterval();
    });

    it('should respect custom defaultTTL', () => {
      const custom = new WorkingMemoryLayer({ defaultTTL: 300 });
      const mem = custom.store('test', 'scratchpad');
      expect(mem.ttl).toBe(300);
      custom.stopCleanupInterval();
    });
  });
});
