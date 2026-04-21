import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { checkDatabaseIntegrity, warnIfCorrupted } from '../../src/db-integrity.js';

describe('checkDatabaseIntegrity', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-integrity-'));
  });
  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('returns empty array on a healthy database', () => {
    const db = new DatabaseSync(path.join(tmpDir, 't.db'));
    db.exec('CREATE TABLE foo (x INT); INSERT INTO foo VALUES (1), (2), (3);');
    expect(checkDatabaseIntegrity(db)).toEqual([]);
    db.close();
  });

  it('returns issues when the PRAGMA itself throws (closed DB)', () => {
    const db = new DatabaseSync(path.join(tmpDir, 't2.db'));
    db.close();
    const issues = checkDatabaseIntegrity(db);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]).toMatch(/quick_check failed/);
  });

  it('warnIfCorrupted emits console.warn when issues exist', () => {
    const db = new DatabaseSync(path.join(tmpDir, 't3.db'));
    db.close();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { /* silence */ });
    const issues = warnIfCorrupted(db, 'L2:test');
    expect(issues.length).toBeGreaterThan(0);
    expect(warnSpy).toHaveBeenCalled();
    expect(warnSpy.mock.calls[0][0]).toContain('L2:test');
    warnSpy.mockRestore();
  });

  it('warnIfCorrupted stays silent on healthy DB', () => {
    const db = new DatabaseSync(path.join(tmpDir, 't4.db'));
    db.exec('CREATE TABLE t(x);');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { /* silence */ });
    const issues = warnIfCorrupted(db, 'L2:test');
    expect(issues).toEqual([]);
    expect(warnSpy).not.toHaveBeenCalled();
    db.close();
    warnSpy.mockRestore();
  });
});
