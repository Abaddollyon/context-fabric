// Tests for data-integrity safety nets added in v0.8:
//   - WAL checkpoint on close() (PRAGMA wal_checkpoint(TRUNCATE))
//   - PRAGMA integrity_check on open (warn on corruption)
//
// The WAL-checkpoint-on-close contract: after close(), the -wal sidecar
// file must be zero-length, so that an unclean process exit (kill -9)
// later cannot lose committed data.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { ProjectMemoryLayer } from '../../src/layers/project.js';

function mktmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('WAL checkpoint on close (v0.8 robustness)', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = mktmp('cf-wal-'); });
  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('L2: -wal file is truncated to 0 bytes after close()', async () => {
    const layer = new ProjectMemoryLayer(tmpDir, tmpDir);

    // Force WAL frames by writing enough content that auto-checkpoint
    // (default ~1000 pages) won't run.
    for (let i = 0; i < 50; i++) {
      await layer.store(`decision ${i} ${'x'.repeat(200)}`, 'decision', {}, ['t']);
    }

    const walPath = path.join(tmpDir, 'memory.db-wal');
    // Baseline: WAL must exist and be non-empty before close, otherwise
    // the test is not actually exercising the code path.
    expect(fs.existsSync(walPath)).toBe(true);
    expect(fs.statSync(walPath).size).toBeGreaterThan(0);

    layer.close();

    if (fs.existsSync(walPath)) {
      expect(fs.statSync(walPath).size).toBe(0);
    }
  });

  it('L2: close() explicitly calls PRAGMA wal_checkpoint(TRUNCATE)', async () => {
    const layer = new ProjectMemoryLayer(tmpDir, tmpDir);
    await layer.store('x', 'decision', {}, []);

    // Spy on the internal db.exec via the instance's db handle.
    const db: any = (layer as any).db;
    const execSpy = vi.spyOn(db, 'exec');

    layer.close();

    const called = execSpy.mock.calls.some(
      (args) => typeof args[0] === 'string' && /wal_checkpoint\s*\(\s*TRUNCATE\s*\)/i.test(args[0] as string),
    );
    expect(called).toBe(true);
  });

  it('L3 (via DatabaseSync directly): PRAGMA wal_checkpoint(TRUNCATE) truncates WAL', () => {
    // Direct sanity check: the SQLite primitive we rely on actually truncates.
    const dbPath = path.join(tmpDir, 'sanity.db');
    const db = new DatabaseSync(dbPath);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
    const ins = db.prepare('INSERT INTO t (v) VALUES (?)');
    for (let i = 0; i < 100; i++) ins.run('x'.repeat(500));

    const walPath = dbPath + '-wal';
    expect(fs.existsSync(walPath)).toBe(true);
    expect(fs.statSync(walPath).size).toBeGreaterThan(0);

    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    expect(fs.statSync(walPath).size).toBe(0);

    db.close();
  });
});
