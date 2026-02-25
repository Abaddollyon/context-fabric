// L1: Working Memory
// - In-memory storage only
// - TTL-based expiration
// - LRU eviction when size limit hit
// - Scoped to single session

import { Memory, MemoryType, MemoryLayer } from '../types.js';

interface WorkingMemoryOptions {
  maxSize?: number;
  defaultTTL?: number; // seconds
}

interface WorkingMemoryEntry {
  memory: Memory;
  expiresAt: Date;
}

export class WorkingMemoryLayer {
  private memories: Map<string, WorkingMemoryEntry>;
  private maxSize: number;
  private defaultTTL: number; // seconds
  private cleanupIntervalId: ReturnType<typeof setInterval> | null = null;

  constructor(options: WorkingMemoryOptions = {}) {
    this.memories = new Map();
    this.maxSize = options.maxSize ?? 1000;
    this.defaultTTL = options.defaultTTL ?? 3600; // 1 hour default
  }

  /**
   * Store a new memory with optional TTL
   */
  store(
    content: string,
    type: MemoryType,
    metadata: Record<string, unknown> = {},
    ttl?: number
  ): Memory {
    // Evict oldest if at capacity (LRU)
    if (this.memories.size >= this.maxSize) {
      this.evictLRU();
    }

    const now = new Date();
    const memory: Memory = {
      id: this.generateId(),
      content,
      type,
      layer: MemoryLayer.L1_WORKING,
      metadata: {
        tags: (metadata.tags as string[]) || [],
        relationships: [],
        confidence: (metadata.confidence as number) ?? 0.8,
        source: (metadata.source as 'user_explicit' | 'ai_inferred' | 'system_auto') ?? 'ai_inferred',
        cliType: (metadata.cliType as string) ?? 'generic',
        ...metadata,
      },
      createdAt: now,
      updatedAt: now,
      accessCount: 0,
      lastAccessedAt: now,
      ttl: ttl ?? this.defaultTTL,
    };

    const effectiveTTL = ttl ?? this.defaultTTL;
    const expiresAt = new Date(now.getTime() + effectiveTTL * 1000);

    this.memories.set(memory.id, { memory, expiresAt });

    return memory;
  }

  /**
   * Get a memory by ID
   */
  get(id: string): Memory | undefined {
    const entry = this.memories.get(id);

    if (!entry) {
      return undefined;
    }

    // Check if expired
    if (new Date() > entry.expiresAt) {
      this.memories.delete(id);
      return undefined;
    }

    // Update access time for LRU
    entry.memory.lastAccessedAt = new Date();
    entry.memory.accessCount = (entry.memory.accessCount ?? 0) + 1;

    return entry.memory;
  }

  /**
   * Get all non-expired memories
   */
  getAll(): Memory[] {
    const now = new Date();
    const result: Memory[] = [];

    for (const [id, entry] of this.memories) {
      if (now > entry.expiresAt) {
        this.memories.delete(id);
      } else {
        result.push(entry.memory);
      }
    }

    return result;
  }

  /**
   * Delete a memory by ID
   */
  delete(id: string): boolean {
    return this.memories.delete(id);
  }

  /**
   * Touch (update access time) a memory
   */
  touch(id: string): void {
    const entry = this.memories.get(id);

    if (entry && new Date() <= entry.expiresAt) {
      entry.memory.lastAccessedAt = new Date();
      entry.memory.accessCount = (entry.memory.accessCount ?? 0) + 1;
    }
  }

  /**
   * Delete expired entries
   * @returns count of deleted entries
   */
  cleanup(): number {
    const now = new Date();
    let deletedCount = 0;

    for (const [id, entry] of this.memories) {
      if (now > entry.expiresAt) {
        this.memories.delete(id);
        deletedCount++;
      }
    }

    return deletedCount;
  }

  /**
   * Clear all memories
   */
  clear(): void {
    this.memories.clear();
  }

  /**
   * Get current size
   */
  size(): number {
    return this.memories.size;
  }

  /**
   * Start auto-cleanup interval
   */
  startCleanupInterval(intervalMs: number = 60000): void {
    this.stopCleanupInterval(); // Clear any existing interval
    this.cleanupIntervalId = setInterval(() => {
      this.cleanup();
    }, intervalMs);
  }

  /**
   * Stop auto-cleanup interval
   */
  stopCleanupInterval(): void {
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
    }
  }

  /**
   * Generate a unique ID
   */
  private generateId(): string {
    return `wm_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Evict the least recently used entry
   */
  private evictLRU(): void {
    let oldestId: string | null = null;
    let oldestTime = Infinity;

    for (const [id, entry] of this.memories) {
      const accessTime = entry.memory.lastAccessedAt 
        ? new Date(entry.memory.lastAccessedAt).getTime() 
        : 0;
      if (accessTime < oldestTime) {
        oldestTime = accessTime;
        oldestId = id;
      }
    }

    if (oldestId) {
      this.memories.delete(oldestId);
    }
  }
}

export default WorkingMemoryLayer;
