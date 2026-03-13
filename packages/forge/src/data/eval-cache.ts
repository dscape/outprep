/**
 * SQLite evaluation cache.
 *
 * Caches Stockfish position evaluations in a local SQLite database
 * at `packages/data/evals/eval-cache.sqlite`. The cache is
 * keyed by SHA-256 of `${fen}:${depth}` for deduplication.
 *
 * Uses better-sqlite3 for synchronous access — evaluations are
 * typically looked up in tight loops where async overhead is unwanted.
 */

import { existsSync, mkdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import type { EvalCacheEntry } from "../state/types.js";

/* ── Paths ────────────────────────────────────────────────── */

const __dirname = dirname(fileURLToPath(import.meta.url));
const EVALS_DIR = join(__dirname, "..", "..", "data", "evals");
const DB_PATH = join(EVALS_DIR, "eval-cache.sqlite");

/* ── Lazy singleton ───────────────────────────────────────── */

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (db) return db;

  if (!existsSync(EVALS_DIR)) {
    mkdirSync(EVALS_DIR, { recursive: true });
  }

  db = new Database(DB_PATH);

  // Enable WAL mode for better concurrent read performance
  db.pragma("journal_mode = WAL");

  // Create table if it does not exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS evals (
      key       TEXT PRIMARY KEY,
      fen       TEXT NOT NULL,
      depth     INTEGER NOT NULL,
      score     INTEGER NOT NULL,
      bestMove  TEXT NOT NULL,
      multiPV   TEXT NOT NULL,
      sfVersion TEXT NOT NULL,
      created   TEXT NOT NULL
    )
  `);

  // Index on fen for batch lookups
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_evals_fen ON evals (fen)
  `);

  return db;
}

/* ── Key generation ───────────────────────────────────────── */

function evalKey(fen: string, depth: number): string {
  return createHash("sha256").update(`${fen}:${depth}`).digest("hex");
}

/* ── Prepared statements (cached per connection) ──────────── */

let stmtGet: Database.Statement | null = null;
let stmtPut: Database.Statement | null = null;
let stmtCount: Database.Statement | null = null;

function prepareStatements(): void {
  const d = getDb();

  if (!stmtGet) {
    stmtGet = d.prepare("SELECT * FROM evals WHERE key = ?");
  }
  if (!stmtPut) {
    stmtPut = d.prepare(`
      INSERT OR REPLACE INTO evals (key, fen, depth, score, bestMove, multiPV, sfVersion, created)
      VALUES (@key, @fen, @depth, @score, @bestMove, @multiPV, @sfVersion, @created)
    `);
  }
  if (!stmtCount) {
    stmtCount = d.prepare("SELECT COUNT(*) as count FROM evals");
  }
}

/* ── Public API ───────────────────────────────────────────── */

/**
 * Look up a cached evaluation by FEN and depth.
 * Returns null if not in cache.
 */
export function getEval(fen: string, depth: number): EvalCacheEntry | null {
  prepareStatements();
  const key = evalKey(fen, depth);
  const row = stmtGet!.get(key) as EvalCacheEntry | undefined;
  return row ?? null;
}

/**
 * Insert or replace a cached evaluation.
 * If `entry.key` is not set, it will be computed from fen + depth.
 */
export function putEval(entry: Omit<EvalCacheEntry, "key"> & { key?: string }): void {
  prepareStatements();
  const key = entry.key ?? evalKey(entry.fen, entry.depth);
  const created = entry.created || new Date().toISOString();

  stmtPut!.run({
    key,
    fen: entry.fen,
    depth: entry.depth,
    score: entry.score,
    bestMove: entry.bestMove,
    multiPV: entry.multiPV,
    sfVersion: entry.sfVersion,
    created,
  });
}

/**
 * Bulk lookup evaluations for multiple FENs at the same depth.
 * Returns a Map from FEN to EvalCacheEntry for those found in cache.
 * FENs not in cache are simply absent from the map.
 */
export function getEvalBatch(
  fens: string[],
  depth: number
): Map<string, EvalCacheEntry> {
  const d = getDb();
  const result = new Map<string, EvalCacheEntry>();

  if (fens.length === 0) return result;

  // For small batches, use individual lookups
  if (fens.length <= 50) {
    prepareStatements();
    for (const fen of fens) {
      const key = evalKey(fen, depth);
      const row = stmtGet!.get(key) as EvalCacheEntry | undefined;
      if (row) {
        result.set(fen, row);
      }
    }
    return result;
  }

  // For larger batches, use a temporary table for efficient JOIN
  d.exec("CREATE TEMP TABLE IF NOT EXISTS batch_keys (key TEXT PRIMARY KEY)");
  d.exec("DELETE FROM temp.batch_keys");

  const insertKey = d.prepare("INSERT OR IGNORE INTO temp.batch_keys (key) VALUES (?)");
  const keyToFen = new Map<string, string>();

  const insertMany = d.transaction((items: Array<{ key: string; fen: string }>) => {
    for (const item of items) {
      insertKey.run(item.key);
    }
  });

  const items = fens.map((fen) => {
    const key = evalKey(fen, depth);
    keyToFen.set(key, fen);
    return { key, fen };
  });

  insertMany(items);

  const rows = d
    .prepare(
      "SELECT e.* FROM evals e INNER JOIN temp.batch_keys b ON e.key = b.key"
    )
    .all() as EvalCacheEntry[];

  for (const row of rows) {
    const fen = keyToFen.get(row.key);
    if (fen) {
      result.set(fen, row);
    }
  }

  d.exec("DELETE FROM temp.batch_keys");

  return result;
}

/**
 * Get cache statistics: total entries and database file size.
 */
export function getCacheStats(): {
  entryCount: number;
  dbSizeBytes: number;
  dbPath: string;
} {
  prepareStatements();

  const row = stmtCount!.get() as { count: number };
  let dbSizeBytes = 0;

  try {
    if (existsSync(DB_PATH)) {
      dbSizeBytes = statSync(DB_PATH).size;
    }
  } catch {
    // If we cannot stat, report 0
  }

  return {
    entryCount: row.count,
    dbSizeBytes,
    dbPath: DB_PATH,
  };
}

/**
 * Close the database connection. Call during graceful shutdown.
 */
export function closeEvalCache(): void {
  if (db) {
    db.close();
    db = null;
    stmtGet = null;
    stmtPut = null;
    stmtCount = null;
  }
}
