/**
 * Download-once persistent game storage.
 *
 * Games are stored in the forge SQLite database (`forge.db`).
 * Metadata is stored in `player_meta`, game data in `player_games`.
 * Falls back to JSON files if they exist but haven't been migrated.
 *
 * Once fetched, games are served from the database without
 * hitting the Lichess API again.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { fetchLichessGames, fetchLichessUser } from "@outprep/harness";
import type { LichessGame, LichessUser } from "@outprep/harness";
import type { PlayerData } from "../state/types.js";
import { getForgeDb } from "../state/forge-db";

/* ── Legacy paths (for migration) ────────────────────────── */

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAMES_DIR = join(__dirname, "..", "..", "data", "games");

function legacyGamesPath(username: string): string {
  return join(GAMES_DIR, `${username.toLowerCase()}.json`);
}

function legacyMetaPath(username: string): string {
  return join(GAMES_DIR, `${username.toLowerCase()}.meta.json`);
}

/* ── Content hashing ──────────────────────────────────────── */

function computeContentHash(games: LichessGame[]): string {
  const sorted = [...games].sort((a, b) => a.id.localeCompare(b.id));
  return createHash("sha256").update(JSON.stringify(sorted)).digest("hex");
}

/* ── Estimate Elo from user profile ───────────────────────── */

function estimateElo(user: LichessUser): number {
  const perfs = user.perfs;
  const candidates = [
    perfs.rapid,
    perfs.blitz,
    perfs.classical,
    perfs.bullet,
  ].filter(Boolean);

  if (candidates.length === 0) return 1500;

  let totalGames = 0;
  let weightedSum = 0;
  for (const perf of candidates) {
    if (!perf) continue;
    totalGames += perf.games;
    weightedSum += perf.rating * perf.games;
  }

  return totalGames > 0 ? Math.round(weightedSum / totalGames) : 1500;
}

/* ── Migration from JSON files ────────────────────────────── */

/**
 * Migrate a player's data from legacy JSON files to SQLite.
 * Called automatically when the player exists on disk but not in DB.
 */
function migrateFromJsonIfNeeded(username: string): void {
  const db = getForgeDb();
  const lower = username.toLowerCase();

  const existing = db
    .prepare("SELECT username FROM player_meta WHERE LOWER(username) = ?")
    .get(lower) as { username: string } | undefined;
  if (existing) return;

  const metaFile = legacyMetaPath(username);
  const gamesFile = legacyGamesPath(username);
  if (!existsSync(metaFile) || !existsSync(gamesFile)) return;

  try {
    const meta = JSON.parse(readFileSync(metaFile, "utf-8")) as PlayerData;
    const games = JSON.parse(readFileSync(gamesFile, "utf-8")) as LichessGame[];

    const tx = db.transaction(() => {
      db.prepare(
        `INSERT OR REPLACE INTO player_meta (username, estimated_elo, game_count, content_hash, fetched_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(meta.username, meta.estimatedElo, meta.gameCount, meta.contentHash, meta.fetchedAt);

      const insertGame = db.prepare(
        `INSERT OR IGNORE INTO player_games (username, game_id, game_data, has_eval)
         VALUES (?, ?, ?, ?)`
      );
      for (const game of games) {
        const hasEval = game.analysis && game.analysis.length > 0 ? 1 : 0;
        insertGame.run(meta.username, game.id, JSON.stringify(game), hasEval);
      }
    });

    tx();
  } catch {
    // Migration failed — JSON files may be corrupt
  }
}

/** Migrate all JSON player files to SQLite (called by listPlayers). */
function migrateAllFromJsonIfNeeded(): void {
  try {
    if (!existsSync(GAMES_DIR)) return;
    const files = readdirSync(GAMES_DIR).filter((f: string) => f.endsWith(".meta.json"));
    for (const file of files) {
      const username = file.replace(".meta.json", "");
      migrateFromJsonIfNeeded(username);
    }
  } catch {
    // Directory doesn't exist
  }
}

/* ── Public API ───────────────────────────────────────────── */

/**
 * Load cached player metadata from the database.
 * Returns null if the player has not been fetched yet.
 * Automatically migrates from JSON files if needed.
 */
export function loadPlayer(username: string): PlayerData | null {
  migrateFromJsonIfNeeded(username);

  const db = getForgeDb();
  const lower = username.toLowerCase();
  const row = db
    .prepare("SELECT * FROM player_meta WHERE LOWER(username) = ?")
    .get(lower) as {
      username: string;
      estimated_elo: number;
      game_count: number;
      content_hash: string;
      fetched_at: string;
    } | undefined;

  if (!row) return null;

  return {
    username: row.username,
    estimatedElo: row.estimated_elo,
    gameCount: row.game_count,
    contentHash: row.content_hash,
    fetchedAt: row.fetched_at,
  };
}

/**
 * Fetch a player's games from Lichess and persist to the database.
 * If already cached, returns the existing metadata without re-fetching.
 * Pass `force: true` to re-download even if cached.
 */
export async function fetchPlayer(
  username: string,
  opts: { max?: number; speeds?: string[]; force?: boolean } = {}
): Promise<PlayerData> {
  const existing = loadPlayer(username);
  if (existing && !opts.force) return existing;

  // Fetch user profile for Elo estimation
  const user = await fetchLichessUser(username);

  // Fetch games
  const games = await fetchLichessGames(
    username,
    opts.max ?? 200,
    opts.speeds
  );

  const contentHash = computeContentHash(games);
  const now = new Date().toISOString();

  const playerData: PlayerData = {
    username: user.username, // Use canonical casing from Lichess
    estimatedElo: estimateElo(user),
    gameCount: games.length,
    contentHash,
    fetchedAt: now,
  };

  const db = getForgeDb();
  const tx = db.transaction(() => {
    // Upsert meta
    db.prepare(
      `INSERT OR REPLACE INTO player_meta (username, estimated_elo, game_count, content_hash, fetched_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(playerData.username, playerData.estimatedElo, playerData.gameCount, playerData.contentHash, playerData.fetchedAt);

    // Replace all games for this player
    db.prepare("DELETE FROM player_games WHERE username = ?").run(playerData.username);

    const insertGame = db.prepare(
      `INSERT INTO player_games (username, game_id, game_data, has_eval)
       VALUES (?, ?, ?, ?)`
    );
    for (const game of games) {
      const hasEval = game.analysis && game.analysis.length > 0 ? 1 : 0;
      insertGame.run(playerData.username, game.id, JSON.stringify(game), hasEval);
    }
  });

  tx();
  return playerData;
}

/**
 * Get cached games for a player. Returns the game array from the database.
 * Automatically migrates from JSON files if needed.
 * Throws if the player has not been fetched yet.
 */
export function getGames(username: string): LichessGame[] {
  migrateFromJsonIfNeeded(username);

  const db = getForgeDb();
  const lower = username.toLowerCase();

  // Find the canonical username
  const meta = db
    .prepare("SELECT username FROM player_meta WHERE LOWER(username) = ?")
    .get(lower) as { username: string } | undefined;

  if (!meta) {
    throw new Error(
      `No cached games for "${username}". Call fetchPlayer() first.`
    );
  }

  const rows = db
    .prepare("SELECT game_data FROM player_games WHERE username = ?")
    .all(meta.username) as { game_data: string }[];

  return rows.map((r) => JSON.parse(r.game_data) as LichessGame);
}

/**
 * List all players whose games are cached.
 * Returns PlayerData for each cached player.
 */
export function listPlayers(): PlayerData[] {
  migrateAllFromJsonIfNeeded();

  const db = getForgeDb();
  const rows = db
    .prepare("SELECT * FROM player_meta ORDER BY username ASC")
    .all() as {
      username: string;
      estimated_elo: number;
      game_count: number;
      content_hash: string;
      fetched_at: string;
    }[];

  return rows.map((r) => ({
    username: r.username,
    estimatedElo: r.estimated_elo,
    gameCount: r.game_count,
    contentHash: r.content_hash,
    fetchedAt: r.fetched_at,
  }));
}
