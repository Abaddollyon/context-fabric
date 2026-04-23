// Tests for v0.8 L3 recall prefilter (FTS5 candidate pool → cosine).

import { describe, it, expect, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { SemanticMemoryLayer } from '../../src/layers/semantic.js';

// Match the existing pattern in tests/integration/engine.test.ts.
const hasEmbeddingModel = existsSync(
  resolve('local_cache', 'fast-bge-small-en-v1.5', 'tokenizer.json'),
);

describe('SemanticMemoryLayer.recallPrefiltered (v0.8)', () => {
  let layer: SemanticMemoryLayer;

  afterEach(() => { try { layer?.close(); } catch { /* ignore */ } });

  it.skipIf(!hasEmbeddingModel)('returns Zod-related hit when keyword matches exist', async () => {
    layer = new SemanticMemoryLayer({ isEphemeral: true });
    await layer.store('use Zod for API validation', 'decision', {});
    await layer.store('React component for user profile', 'code', {});
    await layer.store('SQL query optimization tips', 'documentation', {});
    await layer.store('validate inputs with Zod schemas', 'code', {});

    const res = await layer.recallPrefiltered('Zod validation', 3, 10);
    expect(res.length).toBeGreaterThan(0);
    expect(res[0].content.toLowerCase()).toContain('zod');
  });

  it.skipIf(!hasEmbeddingModel)('falls back to full recall() when sanitized query is empty', async () => {
    layer = new SemanticMemoryLayer({ isEphemeral: true });
    await layer.store('alpha beta gamma', 'observation', {});
    const res = await layer.recallPrefiltered('(* "', 5);
    expect(Array.isArray(res)).toBe(true);
  });

  it.skipIf(!hasEmbeddingModel)('falls back to full recall() when FTS5 returns zero candidates', async () => {
    layer = new SemanticMemoryLayer({ isEphemeral: true });
    await layer.store('alpha beta gamma', 'observation', {});
    const res = await layer.recallPrefiltered('xyz123nonexistentquerytoken', 5, 50);
    // Fallback still returns cosine-matched rows (at minimum the stored one if similar enough).
    expect(Array.isArray(res)).toBe(true);
  });

  it.skipIf(!hasEmbeddingModel)('poolSize caps candidate scan to top-N by BM25', async () => {
    layer = new SemanticMemoryLayer({ isEphemeral: true });
    for (let i = 0; i < 20; i++) {
      await layer.store(`keyword entry number ${i}`, 'observation', {});
    }
    const res = await layer.recallPrefiltered('keyword', 3, 5);
    expect(res.length).toBeLessThanOrEqual(3);
  });

  it('empty query returns []', async () => {
    layer = new SemanticMemoryLayer({ isEphemeral: true });
    const res = await layer.recallPrefiltered('   ', 5);
    expect(res).toEqual([]);
  });
});
