import { describe, expect, it } from 'vitest';
import { StoreBatchSchema } from '../../src/server.js';

describe('context.storeBatch schema (v0.9)', () => {
  it('accepts a valid array of items', () => {
    const result = StoreBatchSchema.safeParse({
      items: [
        { type: 'decision', content: 'a', metadata: {} },
        { type: 'bug_fix', content: 'b', metadata: { tags: ['x'] } },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty items array', () => {
    expect(StoreBatchSchema.safeParse({ items: [] }).success).toBe(false);
  });

  it('rejects more than 500 items', () => {
    const items = Array.from({ length: 501 }, () => ({
      type: 'decision' as const,
      content: 'x',
      metadata: {},
    }));
    expect(StoreBatchSchema.safeParse({ items }).success).toBe(false);
  });

  it('rejects unknown top-level fields (strict)', () => {
    expect(
      StoreBatchSchema.safeParse({
        items: [{ type: 'decision', content: 'x', metadata: {} }],
        bogus: true,
      }).success,
    ).toBe(false);
  });
});
