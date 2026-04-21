/**
 * context.export / context.import round-trip — v0.9 API Polish.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContextEngine } from '../../src/engine.js';
import { ExportSchema, ImportSchema } from '../../src/server.js';
import { MemoryLayer } from '../../src/types.js';

describe('Export/Import JSONL (v0.9)', () => {
  let tmpDir: string;
  let engine: ContextEngine;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cf-export-'));
    engine = new ContextEngine({ projectPath: tmpDir, isEphemeral: true });
  });

  afterEach(async () => {
    await engine.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('ExportSchema requires destPath', () => {
    expect(ExportSchema.safeParse({}).success).toBe(false);
    expect(ExportSchema.safeParse({ destPath: '/tmp/x.jsonl' }).success).toBe(true);
  });

  it('ImportSchema requires srcPath', () => {
    expect(ImportSchema.safeParse({}).success).toBe(false);
    expect(ImportSchema.safeParse({ srcPath: '/tmp/x.jsonl' }).success).toBe(true);
  });

  it('export writes one JSON object per line', async () => {
    await engine.store('alpha', 'decision', { layer: 2 });
    await engine.store('beta', 'bug_fix', { layer: 2 });
    const dest = join(tmpDir, 'out.jsonl');
    const result = await engine.exportMemories(dest, { layers: [MemoryLayer.L2_PROJECT] });
    expect(result.count).toBe(2);
    const raw = readFileSync(dest, 'utf8');
    const lines = raw.trim().split('\n');
    expect(lines.length).toBe(2);
    for (const line of lines) {
      const obj = JSON.parse(line) as { content: string; layer: number };
      expect(typeof obj.content).toBe('string');
      expect(obj.layer).toBe(2);
    }
  });

  it('import round-trips exported memories', async () => {
    await engine.store('round-trip-one', 'decision', { layer: 2 });
    await engine.store('round-trip-two', 'bug_fix', { layer: 2, tags: ['imported'] });
    const dest = join(tmpDir, 'rt.jsonl');
    await engine.exportMemories(dest, { layers: [MemoryLayer.L2_PROJECT] });

    // Fresh engine in a new project path.
    const tmpDir2 = mkdtempSync(join(tmpdir(), 'cf-import-'));
    const engine2 = new ContextEngine({ projectPath: tmpDir2, isEphemeral: true });
    try {
      const result = await engine2.importMemories(dest);
      expect(result.imported).toBe(2);
      expect(result.errors.length).toBe(0);
      const listed = await engine2.listMemories({ layer: MemoryLayer.L2_PROJECT });
      expect(listed.total).toBe(2);
      const contents = listed.memories.map(m => m.content).sort();
      expect(contents).toEqual(['round-trip-one', 'round-trip-two']);
    } finally {
      await engine2.close();
      rmSync(tmpDir2, { recursive: true, force: true });
    }
  });

  it('import collects errors for malformed lines and skips incomplete ones', async () => {
    const dest = join(tmpDir, 'mixed.jsonl');
    writeFileSync(
      dest,
      [
        JSON.stringify({ content: 'valid', type: 'decision', metadata: {}, layer: 2 }),
        '{not json',
        JSON.stringify({ type: 'decision' }), // missing content — skipped
      ].join('\n') + '\n',
    );
    const result = await engine.importMemories(dest);
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]?.line).toBe(2);
  });
});
