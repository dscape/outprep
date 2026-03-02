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
import { createReadStream, existsSync } from "node:fs";
import { createInterface } from "node:readline";
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

    await sqlTransaction(async (tx) => {
      for (const p of batch) {
        const [row] = await tx`
          INSERT INTO players (
            slug, fide_id, name, title, federation, birth_year,
            fide_rating, standard_rating, rapid_rating, blitz_rating,
            game_count, win_rate, draw_rate, loss_rate, last_seen,
            recent_events, openings, recent_games, notable_games, updated_at
          ) VALUES (
            ${p.slug}, ${p.fideId}, ${p.name}, ${p.title ?? null},
            ${p.federation ?? null}, ${p.birthYear ?? null},
            ${p.fideRating}, ${p.standardRating ?? null},
            ${p.rapidRating ?? null}, ${p.blitzRating ?? null},
            ${p.gameCount}, ${p.winRate}, ${p.drawRate}, ${p.lossRate},
            ${p.lastSeen ? parseFideDate(p.lastSeen) : null},
            ${JSON.stringify(p.recentEvents)},
            ${JSON.stringify(p.openings)},
            ${JSON.stringify(p.recentGames ?? [])},
            ${JSON.stringify(p.notableGames ?? [])},
            NOW()
          )
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
            updated_at = NOW()
          RETURNING xmax::text::bigint AS xmax
        `;
        count++;
        if (Number(row.xmax) === 0) inserted++;
        else updated++;
      }
    });

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
  onProgress?: (count: number) => void,
): Promise<number> {
  let count = 0;
  const BATCH = 200;

  for (let i = 0; i < players.length; i += BATCH) {
    const batch = players.slice(i, i + BATCH);

    await sqlTransaction(async (tx) => {
      for (const p of batch) {
        // Delete existing aliases for this player
        await tx`DELETE FROM player_aliases WHERE canonical_slug = ${p.slug}`;

        // Insert new aliases
        for (const alias of p.aliases) {
          await tx`
            INSERT INTO player_aliases (alias_slug, canonical_slug)
            VALUES (${alias}, ${p.slug})
            ON CONFLICT (alias_slug) DO UPDATE SET canonical_slug = ${p.slug}
          `;
          count++;
        }
      }
    });

    onProgress?.(count);
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

  // 2. Insert game metadata (no pgn) into Postgres
  await sqlTransaction(async (tx) => {
    for (const g of games) {
      await tx`
        INSERT INTO games (
          slug, white_name, black_name, white_slug, black_slug,
          white_fide_id, black_fide_id, white_elo, black_elo,
          white_title, black_title, white_federation, black_federation,
          event, site, date, round, eco, opening, variation, result
        ) VALUES (
          ${g.slug}, ${g.whiteName}, ${g.blackName},
          ${g.whiteSlug || null}, ${g.blackSlug || null},
          ${g.whiteFideId}, ${g.blackFideId},
          ${g.whiteElo}, ${g.blackElo},
          ${g.whiteTitle ?? null}, ${g.blackTitle ?? null},
          ${g.whiteFederation ?? null}, ${g.blackFederation ?? null},
          ${g.event}, ${g.site ?? null},
          ${parseFideDate(g.date)},
          ${g.round ?? null}, ${g.eco ?? null},
          ${g.opening ?? null}, ${g.variation ?? null},
          ${g.result}
        )
        ON CONFLICT (slug) DO NOTHING
      `;
    }
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

    await sqlTransaction(async (tx) => {
      for (const [legacy, canonical] of batch) {
        await tx`
          INSERT INTO game_aliases (legacy_slug, canonical_slug)
          VALUES (${legacy}, ${canonical})
          ON CONFLICT (legacy_slug) DO UPDATE SET canonical_slug = ${canonical}
        `;
        count++;
      }
    });

    onProgress?.(count);
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
 * that Postgres can ingest as a DATE.
 */
function parseFideDate(dateStr: string): string {
  // "2022.04.20" → "2022-04-20"
  return dateStr.replace(/\./g, "-");
}
