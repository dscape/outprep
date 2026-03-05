/**
 * Upload processed player/game data to Postgres.
 *
 * Batched SQL inserts (~30-60 minutes for 80K players + 3M games).
 * Game PGN text is stored directly in the games table (TOAST-compressed).
 *
 * Supports:
 * - Batch UPSERT for players and aliases
 * - Streaming JSONL → Postgres for game details + PGN (3M rows)
 * - Resume via pipeline_runs table
 */

import { sql, sqlTransaction } from "./db";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import pLimit from "p-limit";

import type { FIDEPlayer, GameDetail } from "./types";

/** Concurrency limit for batch DB operations (must stay within Neon pooler limits). */
const DB_CONCURRENCY = 5;

/** Retry a database operation with exponential backoff for transient Neon errors. */
async function retryDb<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? "";
      const isTransient = code === "CONNECTION_CLOSED" || code === "CONNECTION_ENDED"
        || code === "CONNECT_TIMEOUT" || code === "57P01" /* admin shutdown */;
      if (!isTransient || attempt >= retries) throw err;
      const delay = Math.min(1000 * 2 ** attempt, 10_000);
      console.warn(`  ⚠ ${code} — retrying in ${delay}ms (attempt ${attempt + 1}/${retries})`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

// ─── Player uploads ──────────────────────────────────────────────────────────

/**
 * Upsert a batch of players into Postgres.
 * Uses individual upserts within transactions for reliability.
 */
export async function upsertPlayers(
  players: FIDEPlayer[],
  onProgress?: (count: number, total: number, inserted: number, updated: number) => void,
): Promise<{ total: number; inserted: number; updated: number }> {
  const BATCH = 500;
  let count = 0;
  let inserted = 0;
  let updated = 0;

  for (let i = 0; i < players.length; i += BATCH) {
    const batch = players.slice(i, i + BATCH);

    const rows = batch.map((p) => ({
      slug: p.slug,
      fide_id: p.fideId,
      name: p.name,
      title: p.title ?? null,
      federation: p.federation ?? null,
      birth_year: p.birthYear ?? null,
      fide_rating: p.fideRating,
      standard_rating: p.standardRating ?? null,
      rapid_rating: p.rapidRating ?? null,
      blitz_rating: p.blitzRating ?? null,
      game_count: p.gameCount,
      win_rate: p.winRate,
      draw_rate: p.drawRate,
      loss_rate: p.lossRate,
      last_seen: p.lastSeen ? parseFideDate(p.lastSeen) : null,
      recent_events: JSON.stringify(p.recentEvents),
      openings: JSON.stringify(p.openings),
      recent_games: JSON.stringify(p.recentGames ?? []),
      notable_games: JSON.stringify(p.notableGames ?? []),
      updated_at: new Date(),
    }));

    const result = await sqlTransaction(async (tx) => tx`
      INSERT INTO players ${tx(rows,
        'slug', 'fide_id', 'name', 'title', 'federation', 'birth_year',
        'fide_rating', 'standard_rating', 'rapid_rating', 'blitz_rating',
        'game_count', 'win_rate', 'draw_rate', 'loss_rate', 'last_seen',
        'recent_events', 'openings', 'recent_games', 'notable_games', 'updated_at',
      )}
      ON CONFLICT (fide_id) DO UPDATE SET
        slug = EXCLUDED.slug,
        name = EXCLUDED.name,
        title = EXCLUDED.title,
        federation = EXCLUDED.federation,
        birth_year = EXCLUDED.birth_year,
        fide_rating = EXCLUDED.fide_rating,
        standard_rating = EXCLUDED.standard_rating,
        rapid_rating = EXCLUDED.rapid_rating,
        blitz_rating = EXCLUDED.blitz_rating,
        game_count = EXCLUDED.game_count,
        win_rate = EXCLUDED.win_rate,
        draw_rate = EXCLUDED.draw_rate,
        loss_rate = EXCLUDED.loss_rate,
        last_seen = EXCLUDED.last_seen,
        recent_events = EXCLUDED.recent_events,
        openings = EXCLUDED.openings,
        recent_games = EXCLUDED.recent_games,
        notable_games = EXCLUDED.notable_games,
        updated_at = EXCLUDED.updated_at
      RETURNING xmax::text::bigint AS xmax
    `);

    for (const row of result) {
      count++;
      if (Number(row.xmax) === 0) inserted++;
      else updated++;
    }

    onProgress?.(count, players.length, inserted, updated);
  }

  return { total: count, inserted, updated };
}

/**
 * Upsert player aliases (old slug → canonical slug redirects).
 * Clears existing aliases for the given players and inserts fresh ones.
 */
export async function upsertPlayerAliases(
  players: FIDEPlayer[],
  onProgress?: (count: number, batchNum: number, totalBatches: number, batchAliases: number) => void,
): Promise<number> {
  let count = 0;
  const BATCH = 500;
  const totalBatches = Math.ceil(players.length / BATCH);

  for (let i = 0; i < players.length; i += BATCH) {
    const batchNum = Math.floor(i / BATCH) + 1;
    const batch = players.slice(i, i + BATCH);
    const batchStart = Date.now();

    // Collect all aliases for this batch
    const allAliases: { alias_slug: string; canonical_slug: string }[] = [];
    const slugsToDelete: string[] = [];
    for (const p of batch) {
      slugsToDelete.push(p.slug);
      for (const alias of p.aliases) {
        allAliases.push({ alias_slug: alias, canonical_slug: p.slug });
      }
    }

    try {
      await sqlTransaction(async (tx) => {
        // Bulk delete existing aliases for all players in this batch
        await tx`DELETE FROM player_aliases WHERE canonical_slug = ANY(${slugsToDelete})`;

        // Bulk insert all aliases in one statement
        if (allAliases.length > 0) {
          await tx`
            INSERT INTO player_aliases ${tx(allAliases, 'alias_slug', 'canonical_slug')}
            ON CONFLICT (alias_slug) DO UPDATE SET canonical_slug = EXCLUDED.canonical_slug
          `;
        }
      });
    } catch (err) {
      const elapsed = Date.now() - batchStart;
      console.error(`  [aliases] ERROR on batch ${batchNum}/${totalBatches} after ${elapsed}ms`);
      console.error(`  [aliases]   Players in batch: ${batch.length}, aliases: ${allAliases.length}, slugs to delete: ${slugsToDelete.length}`);
      if (allAliases.length > 0) {
        console.error(`  [aliases]   First alias: ${JSON.stringify(allAliases[0])}`);
        console.error(`  [aliases]   Last alias:  ${JSON.stringify(allAliases[allAliases.length - 1])}`);
      }
      console.error(`  [aliases]   Error:`, err);
      throw err;
    }

    count += allAliases.length;
    onProgress?.(count, batchNum, totalBatches, allAliases.length);
  }

  return count;
}

// ─── Game uploads ────────────────────────────────────────────────────────────

/**
 * Stream game details from JSONL file into Postgres.
 * PGN text is uploaded to Vercel Blob; only metadata goes to Postgres.
 * Processes one line at a time to avoid OOM on 4.8GB files.
 */
export async function upsertGamesFromJsonl(
  jsonlPath: string,
  onProgress?: (queued: number, done: number) => void,
): Promise<number> {
  if (!existsSync(jsonlPath)) return 0;

  const rl = createInterface({
    input: createReadStream(jsonlPath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });

  let queued = 0;
  let done = 0;
  let batch: GameDetail[] = [];
  const BATCH = 2000;
  const limit = pLimit(DB_CONCURRENCY);
  const pending: Promise<void>[] = [];

  const report = () => onProgress?.(queued, done);

  for await (const line of rl) {
    if (!line.trim()) continue;
    batch.push(JSON.parse(line) as GameDetail);

    if (batch.length >= BATCH) {
      const b = batch;
      batch = [];
      queued += b.length;
      report();
      pending.push(limit(async () => {
        await insertGameBatch(b);
        done += b.length;
        report();
      }));
    }
  }

  // Flush remaining
  if (batch.length > 0) {
    const b = batch;
    queued += b.length;
    report();
    pending.push(limit(async () => {
      await insertGameBatch(b);
      done += b.length;
      report();
    }));
  }

  // Wait for all in-flight batches to finish
  await Promise.all(pending);

  return done;
}

const MAX_ELO = 10_000;

async function insertGameBatch(games: GameDetail[]): Promise<void> {
  // Sanitise ELO values — warn and zero out anything suspicious
  for (const g of games) {
    if (g.whiteElo > MAX_ELO) {
      console.warn(`  ⚠ whiteElo ${g.whiteElo} out of range, setting to 0 — ${g.slug}`);
      g.whiteElo = 0;
    }
    if (g.blackElo > MAX_ELO) {
      console.warn(`  ⚠ blackElo ${g.blackElo} out of range, setting to 0 — ${g.slug}`);
      g.blackElo = 0;
    }
  }

  // Insert game metadata + PGN into Postgres
  const rows = games.map((g) => ({
    slug: g.slug,
    white_name: g.whiteName,
    black_name: g.blackName,
    white_slug: g.whiteSlug || null,
    black_slug: g.blackSlug || null,
    white_fide_id: g.whiteFideId,
    black_fide_id: g.blackFideId,
    white_elo: g.whiteElo,
    black_elo: g.blackElo,
    white_title: g.whiteTitle ?? null,
    black_title: g.blackTitle ?? null,
    white_federation: g.whiteFederation ?? null,
    black_federation: g.blackFederation ?? null,
    event: g.event,
    site: g.site ?? null,
    date: parseFideDate(g.date) ?? '1900-01-01',
    round: g.round ?? null,
    eco: g.eco ?? null,
    opening: g.opening ?? null,
    variation: g.variation ?? null,
    result: g.result,
    pgn: g.pgn || null,
  }));

  await retryDb(() => sqlTransaction(async (tx) => {
    await tx`
      INSERT INTO games ${tx(rows,
        'slug', 'white_name', 'black_name', 'white_slug', 'black_slug',
        'white_fide_id', 'black_fide_id', 'white_elo', 'black_elo',
        'white_title', 'black_title', 'white_federation', 'black_federation',
        'event', 'site', 'date', 'round', 'eco', 'opening', 'variation', 'result',
        'pgn',
      )}
      ON CONFLICT (slug) DO UPDATE SET pgn = EXCLUDED.pgn WHERE games.pgn IS NULL
    `;
  }));
}

/**
 * Backfill ONLY the pgn column for games that already exist in Postgres.
 * Much faster than a full upsert: sends only slug + pgn, skips rows that
 * already have PGN, and doesn't touch indexes or other columns.
 */
export async function backfillPgnsFromJsonl(
  jsonlPath: string,
  onProgress?: (scanned: number, updated: number, batchesDone?: number, batchesTotal?: number) => void,
): Promise<{ scanned: number; updated: number }> {
  if (!existsSync(jsonlPath)) return { scanned: 0, updated: 0 };

  // Quick check: skip the entire scan if no rows need backfilling
  const { rows } = await sql`SELECT COUNT(*) AS n FROM games WHERE pgn IS NULL`;
  const nullCount = Number(rows[0]?.n ?? 0);
  if (nullCount === 0) {
    return { scanned: 0, updated: 0 };
  }
  console.log(`  ${nullCount.toLocaleString()} games with NULL pgn — backfilling...`);

  const rl = createInterface({
    input: createReadStream(jsonlPath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });

  let scanned = 0;
  let updated = 0;
  let batchesDone = 0;
  let batchesTotal = 0;
  let batch: { slug: string; pgn: string }[] = [];
  // Smaller batch for PGN backfill — each row carries ~3KB of PGN text
  const BATCH = 500;
  const limit = pLimit(DB_CONCURRENCY);
  const pending: Promise<void>[] = [];

  const report = () => onProgress?.(scanned, updated, batchesDone, batchesTotal);

  for await (const line of rl) {
    if (!line.trim()) continue;
    const game = JSON.parse(line) as GameDetail;
    if (game.pgn) {
      batch.push({ slug: game.slug, pgn: game.pgn });
    }
    scanned++;

    // Report scan progress frequently so the user sees movement immediately
    if (scanned % 500 === 0) report();

    if (batch.length >= BATCH) {
      const b = batch;
      batch = [];
      batchesTotal++;
      pending.push(limit(async () => {
        const n = await backfillPgnBatch(b);
        updated += n;
        batchesDone++;
        report();
      }));
    }
  }

  if (batch.length > 0) {
    const b = batch;
    batchesTotal++;
    pending.push(limit(async () => {
      const n = await backfillPgnBatch(b);
      updated += n;
      batchesDone++;
      report();
    }));
  }

  // Wait for remaining batches
  await Promise.all(pending);
  report();

  return { scanned, updated };
}

async function backfillPgnBatch(rows: { slug: string; pgn: string }[]): Promise<number> {
  const result = await sqlTransaction(async (tx) => {
    return tx`
      UPDATE games g
      SET pgn = v.pgn
      FROM (VALUES ${tx(rows.map(r => [r.slug, r.pgn]))}) AS v(slug, pgn)
      WHERE g.slug = v.slug AND g.pgn IS NULL
    `;
  });
  return result?.count ?? 0;
}

/**
 * Upsert game aliases from a JSON file on disk.
 * Streams the JSON to avoid loading 394MB into memory.
 */
export async function upsertGameAliases(
  aliasesPath: string,
  onProgress?: (count: number, total: number) => void,
): Promise<number> {
  if (!existsSync(aliasesPath)) return 0;

  // For game aliases we need to parse the JSON object
  // Since it can be 394MB, read and parse in one go (it's a flat object)
  const { readFileSync } = await import("node:fs");
  const raw = readFileSync(aliasesPath, "utf-8");
  const aliases: Record<string, string> = JSON.parse(raw);

  let count = 0;
  const entries = Object.entries(aliases);
  const total = entries.length;
  const BATCH = 2000;

  const limit = pLimit(DB_CONCURRENCY);
  const pending: Promise<void>[] = [];

  for (let i = 0; i < entries.length; i += BATCH) {
    const batch = entries.slice(i, i + BATCH);

    const rows = batch.map(([legacy, canonical]) => ({
      legacy_slug: legacy,
      canonical_slug: canonical,
    }));

    count += batch.length;
    pending.push(limit(async () => {
      await sqlTransaction(async (tx) => {
        await tx`
          INSERT INTO game_aliases ${tx(rows, 'legacy_slug', 'canonical_slug')}
          ON CONFLICT (legacy_slug) DO UPDATE SET canonical_slug = EXCLUDED.canonical_slug
        `;
      });
    }));
    onProgress?.(count, total);
  }

  await Promise.all(pending);

  return count;
}

// ─── Pipeline tracking ───────────────────────────────────────────────────────

export async function recordPipelineRun(
  runType: string,
  identifier: string,
): Promise<number> {
  const { rows } = await sql`
    INSERT INTO pipeline_runs (run_type, identifier, status)
    VALUES (${runType}, ${identifier}, 'running')
    ON CONFLICT (run_type, identifier) DO UPDATE SET
      status = 'running',
      started_at = NOW(),
      completed_at = NULL
    RETURNING id
  `;
  return rows[0].id as number;
}

export async function completePipelineRun(id: number): Promise<void> {
  await sql`
    UPDATE pipeline_runs SET status = 'completed', completed_at = NOW()
    WHERE id = ${id}
  `;
}

export async function failPipelineRun(id: number, error: string): Promise<void> {
  await sql`
    UPDATE pipeline_runs SET
      status = 'failed',
      completed_at = NOW(),
      metadata = jsonb_build_object('error', ${error}::text)
    WHERE id = ${id}
  `;
}

// ─── Schema setup ────────────────────────────────────────────────────────────

/**
 * Run the schema SQL to create tables if they don't exist.
 * Safe to run multiple times (uses IF NOT EXISTS / ON CONFLICT).
 * Also runs idempotent migrations for existing databases.
 */
export async function ensureSchema(): Promise<void> {
  // Check if tables exist
  const { rows } = await sql`
    SELECT COUNT(*)::int AS count
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'players'
  `;

  if ((rows[0].count as number) === 0) {
    console.log("  Creating database schema...");
    // Create tables one at a time (sql tagged template doesn't support multi-statement)
    await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`;

    await sql`
      CREATE TABLE IF NOT EXISTS players (
        id              SERIAL PRIMARY KEY,
        slug            TEXT NOT NULL UNIQUE,
        fide_id         TEXT NOT NULL UNIQUE,
        name            TEXT NOT NULL,
        title           TEXT,
        federation      TEXT,
        birth_year      SMALLINT,
        fide_rating     SMALLINT NOT NULL,
        standard_rating SMALLINT,
        rapid_rating    SMALLINT,
        blitz_rating    SMALLINT,
        game_count      INTEGER NOT NULL DEFAULT 0,
        win_rate        SMALLINT NOT NULL DEFAULT 0,
        draw_rate       SMALLINT NOT NULL DEFAULT 0,
        loss_rate       SMALLINT NOT NULL DEFAULT 0,
        last_seen       DATE,
        recent_events   JSONB NOT NULL DEFAULT '[]',
        openings        JSONB NOT NULL DEFAULT '{}',
        recent_games    JSONB NOT NULL DEFAULT '[]',
        notable_games   JSONB NOT NULL DEFAULT '[]',
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS player_aliases (
        alias_slug     TEXT PRIMARY KEY,
        canonical_slug TEXT NOT NULL REFERENCES players(slug) ON DELETE CASCADE
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS games (
        id               SERIAL PRIMARY KEY,
        slug             TEXT NOT NULL UNIQUE,
        white_name       TEXT NOT NULL,
        black_name       TEXT NOT NULL,
        white_slug       TEXT,
        black_slug       TEXT,
        white_fide_id    TEXT NOT NULL,
        black_fide_id    TEXT NOT NULL,
        white_elo        SMALLINT NOT NULL,
        black_elo        SMALLINT NOT NULL,
        white_title      TEXT,
        black_title      TEXT,
        white_federation TEXT,
        black_federation TEXT,
        event            TEXT NOT NULL,
        site             TEXT,
        date             DATE NOT NULL,
        round            TEXT,
        eco              TEXT,
        opening          TEXT,
        variation        TEXT,
        result           TEXT NOT NULL,
        pgn              TEXT,
        avg_elo          SMALLINT GENERATED ALWAYS AS ((white_elo + black_elo) / 2) STORED
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS game_aliases (
        legacy_slug    TEXT PRIMARY KEY,
        canonical_slug TEXT NOT NULL
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS pipeline_runs (
        id            SERIAL PRIMARY KEY,
        run_type      TEXT NOT NULL,
        identifier    TEXT NOT NULL,
        status        TEXT NOT NULL DEFAULT 'running',
        started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at  TIMESTAMPTZ,
        metadata      JSONB DEFAULT '{}'
      )
    `;

    // Create indexes
    await sql`CREATE INDEX IF NOT EXISTS idx_players_fide_rating ON players (fide_rating DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_players_fide_id ON players (fide_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_player_aliases_canonical ON player_aliases (canonical_slug)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_games_white_slug ON games (white_slug)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_games_black_slug ON games (black_slug)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_games_date ON games (date DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_games_avg_elo ON games (avg_elo DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_games_white_fide_id ON games (white_fide_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_games_black_fide_id ON games (black_fide_id)`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_pipeline_runs_unique ON pipeline_runs (run_type, identifier)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_players_name_trgm ON players USING GIN (name gin_trgm_ops)`;

    console.log("  Schema created.");
  }

  // Idempotent migration: add pgn column to existing games table
  const { rows: pgnCol } = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'games' AND column_name = 'pgn'
  `;
  if (pgnCol.length === 0) {
    console.log("  Adding pgn column to games table...");
    await sql`ALTER TABLE games ADD COLUMN pgn TEXT`;
    console.log("  pgn column added.");
  }
}

// ─── Index management ────────────────────────────────────────────────────────

/**
 * Drop non-unique indexes on the games table before bulk insert.
 * Keeps the UNIQUE constraint on slug (needed for ON CONFLICT).
 */
export async function dropGameIndexes(): Promise<void> {
  console.log("  Dropping game indexes for bulk insert...");
  await sql`DROP INDEX IF EXISTS idx_games_white_slug`;
  await sql`DROP INDEX IF EXISTS idx_games_black_slug`;
  await sql`DROP INDEX IF EXISTS idx_games_date`;
  await sql`DROP INDEX IF EXISTS idx_games_avg_elo`;
  await sql`DROP INDEX IF EXISTS idx_games_white_fide_id`;
  await sql`DROP INDEX IF EXISTS idx_games_black_fide_id`;
  console.log("  Indexes dropped.");
}

/**
 * Recreate non-unique indexes on the games table after bulk insert.
 */
export async function createGameIndexes(): Promise<void> {
  console.log("  Recreating game indexes...");
  await sql`CREATE INDEX IF NOT EXISTS idx_games_white_slug ON games (white_slug)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_games_black_slug ON games (black_slug)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_games_date ON games (date DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_games_avg_elo ON games (avg_elo DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_games_white_fide_id ON games (white_fide_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_games_black_fide_id ON games (black_fide_id)`;
  console.log("  Indexes created.");
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Parse a FIDE-style date "YYYY.MM.DD" into an ISO date string "YYYY-MM-DD"
 * that Postgres can ingest as a DATE. Returns null for invalid dates
 * (e.g. "????.??.??", partial dates, or unparseable strings).
 */
function parseFideDate(dateStr: string): string | null {
  // "2022.04.20" → "2022-04-20"
  const iso = dateStr.replace(/\./g, "-");
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return iso;
}
