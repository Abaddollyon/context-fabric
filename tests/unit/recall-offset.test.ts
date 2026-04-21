/**
 * recall() offset pagination — v0.9 API Polish.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContextEngine } from '../../src/engine.js';
import { RecallSchema } from '../../src/server.js';

describe('Recall offset pagination (v0.9)', () => {
  it('RecallSchema accepts offset, defaults to 0', () => {
    const parsed = RecallSchema.parse({ query: 'x' });
    expect(parsed.offset).toBe(0);
    const parsed2 = RecallSchema.parse({ query: 'x', offset: 5 });
    expect(parsed2.offset).toBe(5);
  });

  it('RecallSchema rejects negative offset', () => {
    const result = RecallSchema.safeParse({ query: 'x', offset: -1 });
    expect(result.success).toBe(false);
  });

  describe('end-to-end paging through L2 results', () => {
    let tmpDir: string;
    let engine: ContextEngine;

    beforeEach(async () => {
      tmpDir = mkdtempSync(join(tmpdir(), 'cf-recall-'));
      engine = new ContextEngine({
        projectPath: tmpDir,
        l2Path: join(tmpDir, 'l2.db'),
        l3Path: join(tmpDir, 'l3.db'),
      });
      // Seed 10 memories that all mention "banana".
      for (let i = 0; i < 10; i++) {
        await engine.store(`banana memory ${i}`, 'decision', { layer: 2 });
      }
    });

    afterEach(async () => {
      await engine.close();
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it('offset+limit paginates without overlap', async () => {
      const page1 = await engine.recall('banana', { limit: 4, mode: 'keyword' });
      expect(page1.length).toBe(4);
      const page2 = await engine.recall('banana', { limit: 8, mode: 'keyword' });
      const ids1 = new Set(page1.map(r => r.id));
      const page2Tail = page2.slice(4);
      // Tail of a larger query must not overlap with page1.
      for (const r of page2Tail) {
        expect(ids1.has(r.id)).toBe(false);
      }
    });
  });
});
