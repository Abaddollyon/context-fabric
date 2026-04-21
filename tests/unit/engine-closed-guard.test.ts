/**
 * v0.8: ContextEngine closed-state guard — every public async method must
 * reject cleanly after close() rather than touching a disposed DB handle.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContextEngine } from '../../src/engine.js';
import { MemoryLayer } from '../../src/types.js';

describe('ContextEngine closed-state guard (v0.8)', () => {
  let tmpDir: string;
  let engine: ContextEngine;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cf-closed-'));
    engine = new ContextEngine({
      projectPath: tmpDir,
      l2Path: join(tmpDir, 'l2.db'),
      l3Path: join(tmpDir, 'l3.db'),
      autoCleanup: false,
    });
    engine.close();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('store() rejects after close()', async () => {
    await expect(engine.store('x', 'decision')).rejects.toThrow(/closed/);
  });

  it('recall() rejects after close()', async () => {
    await expect(engine.recall('x')).rejects.toThrow(/closed/);
  });

  it('promote/demote/summarize reject after close()', async () => {
    await expect(engine.promote('id', MemoryLayer.L2_PROJECT)).rejects.toThrow(/closed/);
    await expect(engine.demote('id', MemoryLayer.L2_PROJECT)).rejects.toThrow(/closed/);
    await expect(engine.summarize(MemoryLayer.L2_PROJECT, 30)).rejects.toThrow(/closed/);
  });

  it('get/update/delete/list reject after close()', async () => {
    await expect(engine.getMemory('id')).rejects.toThrow(/closed/);
    await expect(engine.updateMemory('id', { content: 'x' })).rejects.toThrow(/closed/);
    await expect(engine.deleteMemory('id')).rejects.toThrow(/closed/);
    await expect(engine.listMemories()).rejects.toThrow(/closed/);
  });

  it('getCodeIndex throws synchronously after close()', () => {
    expect(() => engine.getCodeIndex()).toThrow(/closed/);
  });
});
