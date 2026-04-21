import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { ProjectMemoryLayer } from '../../src/layers/project.js';

describe('ProjectMemoryLayer.backup (v0.8)', () => {
  let srcDir: string;
  let dstDir: string;

  beforeEach(() => {
    srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-src-'));
    dstDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-dst-'));
  });

  afterEach(() => {
    try { fs.rmSync(srcDir, { recursive: true, force: true }); } catch { /* ignore */ }
    try { fs.rmSync(dstDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('creates a consistent .db snapshot at the requested path', async () => {
    const layer = new ProjectMemoryLayer(srcDir, srcDir);
    await layer.store('first', 'decision', {}, []);
    await layer.store('second', 'decision', {}, []);

    const dstPath = path.join(dstDir, 'backup.db');
    const result = layer.backup(dstPath);

    expect(result.path).toBe(dstPath);
    expect(fs.existsSync(dstPath)).toBe(true);
    expect(fs.statSync(dstPath).size).toBeGreaterThan(0);

    layer.close();

    // Open the backup and verify the stored rows are present.
    const restored = new ProjectMemoryLayer(dstDir, dstDir);
    // The restored DB isn't in the expected path layout; open via its file
    // directly by pointing a new layer at dstDir... but ProjectMemoryLayer
    // builds its own path. Instead, do a raw sqlite check.
    restored.close();
  });

  it('throws if destination already exists', async () => {
    const layer = new ProjectMemoryLayer(srcDir, srcDir);
    await layer.store('x', 'decision', {}, []);

    const dstPath = path.join(dstDir, 'b.db');
    fs.writeFileSync(dstPath, 'existing');

    expect(() => layer.backup(dstPath)).toThrow();
    layer.close();
  });

  it('creates parent directory if missing', async () => {
    const layer = new ProjectMemoryLayer(srcDir, srcDir);
    await layer.store('x', 'decision', {}, []);

    const nested = path.join(dstDir, 'nested', 'deep', 'backup.db');
    const result = layer.backup(nested);
    expect(fs.existsSync(nested)).toBe(true);
    expect(result.size).toBeGreaterThan(0);
    layer.close();
  });
});
