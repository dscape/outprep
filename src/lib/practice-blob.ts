/**
 * Vercel Blob read utilities — only for practice PGN files.
 *
 * Player/game data and aliases have been migrated to Postgres (see @/lib/db).
 * This module only handles the per-player raw PGN arrays stored in Blob,
 * which are fetched on-demand when a user starts practice mode.
 *
 * Blob layout:
 *   fide/games/{slug}.json — Raw PGN strings for practice
 */

import { list } from "@vercel/blob";

const PREFIX = "fide";
const IS_DEV = process.env.NODE_ENV === "development";

// ─── Local file fallback for development ──────────────────────────────────────

/**
 * Load a single player's games from the per-player game file on disk.
 * Reads lazily — only loads the requested player's file, not all games.
 */
async function loadLocalGames(slug: string): Promise<string[] | null> {
  try {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const gameFile = path.join(
      process.cwd(),
      "packages/fide-pipeline/data/processed/games",
      `${slug}.json`
    );
    if (fs.existsSync(gameFile)) {
      return JSON.parse(fs.readFileSync(gameFile, "utf-8"));
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Blob API ─────────────────────────────────────────────────────────────────

/**
 * Find the Blob URL for a given path by listing blobs with that prefix.
 */
async function findBlobUrl(path: string): Promise<string | null> {
  try {
    const result = await list({ prefix: path, limit: 1 });
    if (result.blobs.length > 0) {
      return result.blobs[0].url;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Fetch and parse JSON from a Blob path.
 */
async function fetchBlobJson<T>(path: string): Promise<T | null> {
  const url = await findBlobUrl(path);
  if (!url) return null;

  try {
    const res = await fetch(url, { next: { revalidate: 604800 } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Get raw PGN games for a player (for practice mode).
 * In dev, reads the per-player game file lazily (not all games at once).
 */
export async function getPlayerGames(slug: string): Promise<string[] | null> {
  // Dev fallback: read single per-player game file from disk
  if (IS_DEV) {
    const games = await loadLocalGames(slug);
    if (games) return games;
  }

  return fetchBlobJson<string[]>(`${PREFIX}/games/${slug}.json`);
}
