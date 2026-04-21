/**
 * Transaction atomicity — verifies that multi-statement ops (L2.store with tags,
 * L2.summarize) either fully commit or fully roll back.
 *
 * Roadmap v0.8: Transaction wrapping for promote/summarize multi-statement ops.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectMemoryLayer } from '../../src/layers/project.js';

describe('Transaction atomicity (v0.8)', () => {
  let tmpDir: string;
  let layer: ProjectMemoryLayer;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cf-tx-'));
    layer = new ProjectMemoryLayer(join(tmpDir, 'l2.db'));
  });

  afterEach(() => {
    layer.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('store() with failing tag insert rolls back the memory row', async () => {
    // Force tag insert to throw on the second tag.
    const realRun = (layer as unknown as { stmtInsertTag: { run: (...a: unknown[]) => unknown } })
      .stmtInsertTag.run;
    let calls = 0;
    (layer as unknown as { stmtInsertTag: { run: (...a: unknown[]) => unknown } }).stmtInsertTag.run =
      vi.fn().mockImplementation((...args: unknown[]) => {
        calls++;
        if (calls === 2) throw new Error('synthetic tag failure');
        return realRun.apply(
          (layer as unknown as { stmtInsertTag: unknown }).stmtInsertTag,
          args as [],
        );
      });

    await expect(
      layer.store('content', 'decision', {}, ['a', 'b', 'c']),
    ).rejects.toThrow(/synthetic tag failure/);

    // Memory row must NOT exist — rolled back with the tag failure.
    const all = await layer.getAll();
    expect(all.length).toBe(0);
  });

  it('summarize() rolls back when delete-originals fails', async () => {
    // Seed memories with an old timestamp.
    const old = Date.now() - 10 * 24 * 60 * 60 * 1000;
    const db = (layer as unknown as { db: { prepare: (s: string) => { run: (...a: unknown[]) => unknown } } }).db;
    const insert = db.prepare(
      'INSERT INTO memories (id, type, content, metadata, tags, created_at, updated_at, access_count, pinned) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0)',
    );
    for (let i = 0; i < 3; i++) {
      insert.run(`old-${i}`, 'decision', `old content ${i}`, '{}', '[]', old, old);
    }

    // Force stmtDeleteById to throw on the old- ids; allow cleanup deletes
    // of the summary row (uuid) to succeed so rollback can fully restore state.
    const realRun = (layer as unknown as { stmtDeleteById: { run: (...a: unknown[]) => unknown } })
      .stmtDeleteById.run.bind(
        (layer as unknown as { stmtDeleteById: unknown }).stmtDeleteById,
      );
    (layer as unknown as { stmtDeleteById: { run: (...a: unknown[]) => unknown } }).stmtDeleteById.run =
      vi.fn().mockImplementation((id: string) => {
        if (typeof id === 'string' && id.startsWith('old-')) {
          throw new Error('synthetic delete failure');
        }
        return realRun(id);
      });

    await expect(layer.summarize(5)).rejects.toThrow(/synthetic delete failure/);

    // All 3 originals must still be present; no summary row added.
    const all = await layer.getAll();
    expect(all.length).toBe(3);
    expect(all.every(m => m.id.startsWith('old-'))).toBe(true);
  });

  it('summarize() commits atomically on success', async () => {
    const old = Date.now() - 10 * 24 * 60 * 60 * 1000;
    const db = (layer as unknown as { db: { prepare: (s: string) => { run: (...a: unknown[]) => unknown } } }).db;
    const insert = db.prepare(
      'INSERT INTO memories (id, type, content, metadata, tags, created_at, updated_at, access_count, pinned) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0)',
    );
    for (let i = 0; i < 3; i++) {
      insert.run(`old-${i}`, 'decision', `old content ${i}`, '{}', '[]', old, old);
    }

    const result = await layer.summarize(5);
    expect(result.summarizedCount).toBe(3);

    const all = await layer.getAll();
    // Originals gone, summary row present.
    expect(all.length).toBe(1);
    expect(all[0]?.type).toBe('summary');
  });
});
