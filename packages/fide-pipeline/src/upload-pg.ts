/**
 * Upload processed player/game data to Postgres.
 *
 * Replaces the Blob-based upload (millions of HTTP PUTs, ~24 hours) with
 * batched SQL inserts (~30-60 minutes for 80K players + 3M games).
 *
 * Game PGN text is stored in Vercel Blob (not Postgres) to keep the
 * database under ~1.7 GB. Each game's PGN is uploaded to:
 *   fide/game-pgn/{slug}.txt
 *
 * Supports:
 * - Batch UPSERT for players and aliases
 * - Streaming JSONL → Postgres for game details (3M rows)
 * - PGN upload to Vercel Blob in parallel batches
 * - Resume via pipeline_runs table
 */

import { sql, sqlTransaction } from "./db";
import { put } from "@vercel/blob";
import { createReadStream, existsSync, readdirSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";

import type { FIDEPlayer, GameDetail } from "./types";

// ─── Player uploads ──────────────────────────────────────────────────────────

/**
 * Upsert a batch of players into Postgres.
 * Uses individual upserts within transactions for reliability.
 */
export async function upsertPlayers(
  players: FIDEPlayer[],
  onProgress?: (count: number, total: number, inserted: number, updated: number) => void,
): Promise<{ total: number; inserted: number; updated: number }> {
  const BATCH = 100;
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
  const BATCH = 200;
  const totalBatches = Math.ceil(players.length / BATCH);
  const overallStart = Date.now();

  console.log(`  [aliases] ${players.length} players, ${totalBatches} batches of ${BATCH}`);

  // Quick stats: how many players actually have aliases?
  const withAliases = players.filter(p => p.aliases && p.aliases.length > 0).length;
  const withoutAliases = players.length - withAliases;
  console.log(`  [aliases] ${withAliases} players with aliases, ${withoutAliases} without`);

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

    const elapsed = Date.now() - batchStart;
    count += allAliases.length;

    // Log every batch (verbose) — include timing to spot slow queries
    if (batchNum % 10 === 0 || batchNum === 1 || batchNum === totalBatches || elapsed > 2000) {
      const totalElapsed = ((Date.now() - overallStart) / 1000).toFixed(1);
      console.log(`  [aliases] Batch ${batchNum}/${totalBatches}: ${allAliases.length} aliases, ${elapsed}ms (${totalElapsed}s total, ${count} aliases so far)`);
    }

    onProgress?.(count, batchNum, totalBatches, allAliases.length);
  }

  const totalElapsed = ((Date.now() - overallStart) / 1000).toFixed(1);
  console.log(`  [aliases] Done: ${count} aliases upserted in ${totalElapsed}s`);
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
  onProgress?: (count: number) => void,
): Promise<number> {
  if (!existsSync(jsonlPath)) return 0;

  const rl = createInterface({
    input: createReadStream(jsonlPath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });

  let count = 0;
  let batch: GameDetail[] = [];
  const BATCH = 50;

  for await (const line of rl) {
    if (!line.trim()) continue;
    batch.push(JSON.parse(line) as GameDetail);

    if (batch.length >= BATCH) {
      await insertGameBatch(batch);
      count += batch.length;
      batch = [];
      onProgress?.(count);
    }
  }

  // Flush remaining
  if (batch.length > 0) {
    await insertGameBatch(batch);
    count += batch.length;
    onProgress?.(count);
  }

  return count;
}

const MAX_ELO = 10_000;

async function insertGameBatch(games: GameDetail[]): Promise<void> {
  // 1. Upload PGNs to Vercel Blob in parallel batches
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const BLOB_BATCH = 50;
    for (let i = 0; i < games.length; i += BLOB_BATCH) {
      await Promise.all(
        games.slice(i, i + BLOB_BATCH)
          .filter((g) => g.pgn)
          .map((g) =>
            put(`fide/game-pgn/${g.slug}.txt`, g.pgn, {
              access: "public",
              addRandomSuffix: false,
            }),
          ),
      );
    }
  }

  // 2. Sanitise ELO values — warn and zero out anything suspicious
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

  // 3. Insert game metadata (no pgn) into Postgres
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
  }));

  await sqlTransaction(async (tx) => {
    await tx`
      INSERT INTO games ${tx(rows,
        'slug', 'white_name', 'black_name', 'white_slug', 'black_slug',
        'white_fide_id', 'black_fide_id', 'white_elo', 'black_elo',
        'white_title', 'black_title', 'white_federation', 'black_federation',
        'event', 'site', 'date', 'round', 'eco', 'opening', 'variation', 'result',
      )}
      ON CONFLICT (slug) DO NOTHING
    `;
  });
}

/**
 * Upsert game aliases from a JSON file on disk.
 * Streams the JSON to avoid loading 394MB into memory.
 */
export async function upsertGameAliases(
  aliasesPath: string,
  onProgress?: (count: number) => void,
): Promise<number> {
  if (!existsSync(aliasesPath)) return 0;

  // For game aliases we need to parse the JSON object
  // Since it can be 394MB, read and parse in one go (it's a flat object)
  const { readFileSync } = await import("node:fs");
  const raw = readFileSync(aliasesPath, "utf-8");
  const aliases: Record<string, string> = JSON.parse(raw);

  let count = 0;
  const entries = Object.entries(aliases);
  const BATCH = 500;

  for (let i = 0; i < entries.length; i += BATCH) {
    const batch = entries.slice(i, i + BATCH);

    const rows = batch.map(([legacy, canonical]) => ({
      legacy_slug: legacy,
      canonical_slug: canonical,
    }));

    await sqlTransaction(async (tx) => {
      await tx`
        INSERT INTO game_aliases ${tx(rows, 'legacy_slug', 'canonical_slug')}
        ON CONFLICT (legacy_slug) DO UPDATE SET canonical_slug = EXCLUDED.canonical_slug
      `;
    });

    count += batch.length;
    onProgress?.(count);
  }

  return count;
}

// ─── Player game files (practice mode) ──────────────────────────────────────

/**
 * Upload per-player game files (fide/games/{slug}.json) to Vercel Blob.
 * These are arrays of raw PGN strings used by practice mode.
 * Only runs if BLOB_READ_WRITE_TOKEN is set.
 */
export async function uploadPlayerGameFiles(
  gamesDir: string,
  onProgress?: (count: number, total: number) => void,
): Promise<number> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return 0;
  if (!existsSync(gamesDir)) return 0;

  const files = readdirSync(gamesDir).filter((f) => f.endsWith(".json"));
  let count = 0;
  const BATCH = 10;

  for (let i = 0; i < files.length; i += BATCH) {
    const batch = files.slice(i, i + BATCH);
    await Promise.all(
      batch.map(async (fileName) => {
        const slug = fileName.replace(/\.json$/, "");
        const filePath = join(gamesDir, fileName);
        const content = readFileSync(filePath, "utf-8");
        await put(`fide/games/${slug}.json`, content, {
          access: "public",
          contentType: "application/json",
          addRandomSuffix: false,
        });
      }),
    );
    count += batch.length;
    onProgress?.(count, files.length);
  }

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
 *
 * Note: pgn column is NOT in the games table — PGN text is stored in
 * Vercel Blob at fide/game-pgn/{slug}.txt to keep the DB small (~1.7 GB).
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
