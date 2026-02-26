/**
 * Upload processed player data to Vercel Blob storage.
 *
 * Blob layout:
 *   fide/index.json          — PlayerIndex (master list for sitemap)
 *   fide/players/{slug}.json — FIDEPlayer per player (profile + stats)
 *   fide/games/{slug}.json   — Raw PGN strings per player (for practice)
 */

import { put } from "@vercel/blob";
import type { FIDEPlayer, PlayerIndex } from "./types";

const DEFAULT_PREFIX = "fide";

interface UploadOptions {
  prefix?: string; // "fide" for production, "fide-smoke" for smoke tests
  onProgress?: (uploaded: number, total: number) => void;
}

/**
 * Upload the player index to Blob.
 */
export async function uploadIndex(
  index: PlayerIndex,
  opts?: UploadOptions
): Promise<string> {
  const prefix = opts?.prefix ?? DEFAULT_PREFIX;
  const path = `${prefix}/index.json`;
  const blob = await put(path, JSON.stringify(index), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
  });
  return blob.url;
}

/**
 * Upload a single player profile to Blob.
 */
export async function uploadPlayer(
  player: FIDEPlayer,
  opts?: UploadOptions
): Promise<string> {
  const prefix = opts?.prefix ?? DEFAULT_PREFIX;
  const path = `${prefix}/players/${player.slug}.json`;
  const blob = await put(path, JSON.stringify(player), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
  });
  return blob.url;
}

/**
 * Upload raw PGN games for a player to Blob.
 */
export async function uploadPlayerGames(
  slug: string,
  pgns: string[],
  opts?: UploadOptions
): Promise<string> {
  const prefix = opts?.prefix ?? DEFAULT_PREFIX;
  const path = `${prefix}/games/${slug}.json`;
  const blob = await put(path, JSON.stringify(pgns), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
  });
  return blob.url;
}

/**
 * Upload all player data in batches.
 *
 * Uploads:
 * 1. Player index
 * 2. Individual player profiles
 * 3. Per-player raw PGN games
 */
export async function uploadAll(
  players: FIDEPlayer[],
  index: PlayerIndex,
  playerGames: Map<string, string[]>,
  opts?: UploadOptions
): Promise<{ indexUrl: string; playersUploaded: number; gamesUploaded: number }> {
  const onProgress = opts?.onProgress;
  const total = 1 + players.length + playerGames.size;
  let uploaded = 0;

  // 1. Upload index
  const indexUrl = await uploadIndex(index, opts);
  uploaded++;
  onProgress?.(uploaded, total);

  // 2. Upload player profiles in batches of 50
  let playersUploaded = 0;
  const BATCH_SIZE = 50;
  for (let i = 0; i < players.length; i += BATCH_SIZE) {
    const batch = players.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (player) => {
        await uploadPlayer(player, opts);
        playersUploaded++;
        uploaded++;
        onProgress?.(uploaded, total);
      })
    );
  }

  // 3. Upload per-player games in batches of 20 (larger files)
  let gamesUploaded = 0;
  const entries = Array.from(playerGames.entries());
  const GAME_BATCH_SIZE = 20;
  for (let i = 0; i < entries.length; i += GAME_BATCH_SIZE) {
    const batch = entries.slice(i, i + GAME_BATCH_SIZE);
    await Promise.all(
      batch.map(async ([slug, pgns]) => {
        await uploadPlayerGames(slug, pgns, opts);
        gamesUploaded++;
        uploaded++;
        onProgress?.(uploaded, total);
      })
    );
  }

  return { indexUrl, playersUploaded, gamesUploaded };
}
