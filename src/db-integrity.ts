// SQLite integrity check helper (v0.8).
//
// Runs PRAGMA quick_check on open to detect obvious corruption (free-list
// damage, page-level errors) without the deep UNIQUE / FK scans that full
// integrity_check performs. Fast enough to run on every startup (<10ms on
// a ~100MB database).
//
// Returns the list of reported issues. An empty array means "ok". Callers
// typically console.warn when the list is non-empty and continue — the
// database may still be usable even if quick_check reports issues.

import type { DatabaseSync } from 'node:sqlite';

/**
 * Run PRAGMA quick_check and return any reported issues.
 *
 * @param db       An open DatabaseSync handle
 * @param maxRows  Cap on rows returned from quick_check (default 100);
 *                 quick_check emits one row per issue, so this bounds
 *                 pathological cases.
 * @returns        Array of issue strings. Empty array means no issues.
 */
export function checkDatabaseIntegrity(db: DatabaseSync, maxRows = 100): string[] {
  try {
    const rows = db.prepare(`PRAGMA quick_check(${maxRows})`).all() as Array<{ quick_check?: string; integrity_check?: string } | Record<string, string>>;
    const messages: string[] = [];
    for (const row of rows) {
      // SQLite returns a single column; the key name is driver-dependent.
      const value = Object.values(row)[0];
      if (typeof value === 'string' && value !== 'ok') {
        messages.push(value);
      }
    }
    return messages;
  } catch (err) {
    // If the PRAGMA itself fails, surface that as the single issue.
    return [`quick_check failed: ${err instanceof Error ? err.message : String(err)}`];
  }
}

/**
 * Run the integrity check and emit a console.warn with a labelled prefix
 * if any issues are reported. Used at layer open() sites.
 */
export function warnIfCorrupted(db: DatabaseSync, label: string): string[] {
  const issues = checkDatabaseIntegrity(db);
  if (issues.length > 0) {
    console.warn(
      `[context-fabric] ${label}: SQLite quick_check reported ${issues.length} issue(s). ` +
      `First: ${issues[0]}. The database may be corrupted; consider restoring from backup.`,
    );
  }
  return issues;
}
