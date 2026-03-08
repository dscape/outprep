/**
 * Download-once persistent game storage.
 *
 * Games are stored as JSON at `packages/forge/data/games/<username>.json`
 * with metadata in `<username>.meta.json`. Once fetched, games are served
 * from disk without hitting the Lichess API again.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { fetchLichessGames, fetchLichessUser } from "@outprep/harness";
import type { LichessGame, LichessUser } from "@outprep/harness";
import type { PlayerData } from "../state/types.js";

/* ── Paths ────────────────────────────────────────────────── */

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAMES_DIR = join(__dirname, "..", "..", "data", "games");

function ensureGamesDir(): void {
  if (!existsSync(GAMES_DIR)) {
    mkdirSync(GAMES_DIR, { recursive: true });
  }
}

function gamesPath(username: string): string {
  return join(GAMES_DIR, `${username.toLowerCase()}.json`);
}

function metaPath(username: string): string {
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
  // Prefer rapid > blitz > classical > bullet
  const candidates = [
    perfs.rapid,
    perfs.blitz,
    perfs.classical,
    perfs.bullet,
  ].filter(Boolean);

  if (candidates.length === 0) return 1500;

  // Weight by number of games played in each time control
  let totalGames = 0;
  let weightedSum = 0;
  for (const perf of candidates) {
    if (!perf) continue;
    totalGames += perf.games;
    weightedSum += perf.rating * perf.games;
  }

  return totalGames > 0 ? Math.round(weightedSum / totalGames) : 1500;
}

/* ── Public API ───────────────────────────────────────────── */

/**
 * Load cached player metadata from disk.
 * Returns null if the player has not been fetched yet.
 */
export function loadPlayer(username: string): PlayerData | null {
  const meta = metaPath(username);
  if (!existsSync(meta)) return null;

  try {
    const raw = readFileSync(meta, "utf-8");
    return JSON.parse(raw) as PlayerData;
  } catch {
    return null;
  }
}

/**
 * Fetch a player's games from Lichess and persist to disk.
 * If already cached, returns the existing metadata without re-fetching.
 * Pass `force: true` to re-download even if cached.
 */
export async function fetchPlayer(
  username: string,
  opts: { max?: number; speeds?: string[]; force?: boolean } = {}
): Promise<PlayerData> {
  const existing = loadPlayer(username);
  if (existing && !opts.force) return existing;

  ensureGamesDir();

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

  // Write games and metadata atomically-ish (meta written last)
  writeFileSync(gamesPath(username), JSON.stringify(games, null, 2));
  writeFileSync(metaPath(username), JSON.stringify(playerData, null, 2));

  return playerData;
}

/**
 * Get cached games for a player. Returns the game array from disk.
 * Throws if the player has not been fetched yet.
 */
export function getGames(username: string): LichessGame[] {
  const path = gamesPath(username);
  if (!existsSync(path)) {
    throw new Error(
      `No cached games for "${username}". Call fetchPlayer() first.`
    );
  }

  const raw = readFileSync(path, "utf-8");
  return JSON.parse(raw) as LichessGame[];
}

/**
 * List all players whose games are cached locally.
 * Returns PlayerData for each cached player.
 */
export function listPlayers(): PlayerData[] {
  ensureGamesDir();

  const files = readdirSync(GAMES_DIR).filter((f) => f.endsWith(".meta.json"));
  const players: PlayerData[] = [];

  for (const file of files) {
    try {
      const raw = readFileSync(join(GAMES_DIR, file), "utf-8");
      players.push(JSON.parse(raw) as PlayerData);
    } catch {
      // Skip corrupt metadata files
    }
  }

  return players.sort((a, b) => a.username.localeCompare(b.username));
}
