/**
 * v0.8: Optional sqlite-vec acceleration for L3 semantic recall.
 *
 * sqlite-vec (https://github.com/asg017/sqlite-vec) is a SQLite extension that
 * provides a `vec0` virtual table with efficient MATCH / KNN distance queries.
 * When available, it lets us replace O(N) JSON-parse-and-cosine with a
 * SQL-level nearest-neighbour search.
 *
 * Integration policy:
 *  - **Purely optional.** sqlite-vec is NOT listed in package.json; users opt
 *    in by running `npm install sqlite-vec` themselves. We detect its
 *    presence via a guarded require() and silently fall back to the
 *    FTS5-prefiltered cosine path on any failure.
 *  - **No schema drift when disabled.** If the extension isn't loaded we never
 *    create the `vec_items` virtual table, so disabled->enabled->disabled
 *    transitions leave the main `semantic_memories` table untouched.
 *  - **Dimension is fixed at construction time** (bge-small-en = 384) so the
 *    vec0 column type matches the embeddings we produce.
 */

import type { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';

export interface SqliteVecHandle {
  readonly loaded: true;
  readonly dim: number;
  /** Insert or replace an embedding row in vec_items. */
  upsert(rowid: number, embedding: number[]): void;
  /** Remove a row by rowid. */
  remove(rowid: number): void;
  /** Top-k nearest rowids by cosine distance. Returns [rowid, distance] pairs. */
  knn(queryEmbedding: number[], k: number): Array<{ rowid: number; distance: number }>;
}

export interface SqliteVecDisabled {
  readonly loaded: false;
  readonly reason: string;
}

export type SqliteVecStatus = SqliteVecHandle | SqliteVecDisabled;

/**
 * Try to load sqlite-vec into the supplied DatabaseSync. Returns a handle with
 * prepared upsert/remove/knn helpers when everything succeeds, or a disabled
 * sentinel with a reason string. Never throws.
 *
 * Requires the DB to have been constructed with `allowExtension: true`.
 */
export function tryLoadSqliteVec(db: DatabaseSync, dim: number): SqliteVecStatus {
  // Honor an explicit opt-out for users who want to pin to the cosine path.
  if (process.env['CF_DISABLE_SQLITE_VEC'] === '1') {
    return { loaded: false, reason: 'CF_DISABLE_SQLITE_VEC=1' };
  }

  let sqliteVec: { load: (db: DatabaseSync) => void } | undefined;
  try {
    const req = createRequire(import.meta.url);
    sqliteVec = req('sqlite-vec') as { load: (db: DatabaseSync) => void };
  } catch (err) {
    return {
      loaded: false,
      reason: `sqlite-vec package not installed (${err instanceof Error ? err.message : String(err)})`,
    };
  }

  try {
    sqliteVec.load(db);
  } catch (err) {
    return {
      loaded: false,
      reason: `sqlite-vec failed to load into DB (${err instanceof Error ? err.message : String(err)})`,
    };
  }

  try {
    db.exec(
      `CREATE VIRTUAL TABLE IF NOT EXISTS vec_items USING vec0(embedding float[${dim}] distance_metric=cosine)`,
    );
  } catch (err) {
    return {
      loaded: false,
      reason: `CREATE VIRTUAL TABLE vec_items failed (${err instanceof Error ? err.message : String(err)})`,
    };
  }

  const stmtUpsert = db.prepare(
    'INSERT OR REPLACE INTO vec_items(rowid, embedding) VALUES (?, ?)',
  );
  const stmtRemove = db.prepare('DELETE FROM vec_items WHERE rowid = ?');
  const stmtKnn = db.prepare(
    'SELECT rowid, distance FROM vec_items WHERE embedding MATCH ? ORDER BY distance LIMIT ?',
  );

  const toBuffer = (embedding: number[]): Uint8Array => {
    const buf = new Float32Array(embedding);
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  };

  // sqlite-vec's vec0 virtual table rejects non-integer primary keys, and
  // the node:sqlite binding coerces plain JS numbers to REAL (doubles). So
  // rowids must be passed as BigInt for vec0 to accept them. See
  // https://github.com/asg017/sqlite-vec/issues / "Only integers are
  // allowed for primary key values on vec_items".
  const toRowidBig = (rowid: number | bigint): bigint =>
    typeof rowid === 'bigint' ? rowid : BigInt(Math.trunc(rowid));

  return {
    loaded: true,
    dim,
    upsert(rowid, embedding) {
      stmtUpsert.run(toRowidBig(rowid), toBuffer(embedding));
    },
    remove(rowid) {
      stmtRemove.run(toRowidBig(rowid));
    },
    knn(queryEmbedding, k) {
      const rows = stmtKnn.all(toBuffer(queryEmbedding), k) as Array<{
        rowid: number;
        distance: number;
      }>;
      return rows;
    },
  };
}
