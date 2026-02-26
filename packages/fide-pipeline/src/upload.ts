/**
 * Upload processed player data to Vercel Blob storage.
 *
 * Blob layout:
 *   fide/index.json          — PlayerIndex (master list for sitemap)
 *   fide/players/{slug}.json — FIDEPlayer per player (profile + stats)
 *   fide/games/{slug}.json   — Raw PGN strings per player (for practice)
 *   fide/aliases.json        — Alias → canonical slug map (for 301 redirects)
 */

import { put } from "@vercel/blob";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
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
 * Reads the game data directly from a file on disk to avoid holding all games in memory.
 */
export async function uploadPlayerGamesFromFile(
  slug: string,
  filePath: string,
  opts?: UploadOptions
): Promise<string> {
  const prefix = opts?.prefix ?? DEFAULT_PREFIX;
  const blobPath = `${prefix}/games/${slug}.json`;
  const content = readFileSync(filePath, "utf-8");
  const blob = await put(blobPath, content, {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
  });
  return blob.url;
}

/**
 * Upload the alias map (alias slug → canonical slug) to Blob.
 */
export async function uploadAliases(
  aliases: Record<string, string>,
  opts?: UploadOptions
): Promise<string> {
  const prefix = opts?.prefix ?? DEFAULT_PREFIX;
  const path = `${prefix}/aliases.json`;
  const blob = await put(path, JSON.stringify(aliases), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
  });
  return blob.url;
}

/**
 * Upload all player data, reading game files from disk one at a time.
 * This avoids loading all game data into memory simultaneously.
 *
 * Uploads:
 * 1. Player index
 * 2. Alias map (for 301 redirects)
 * 3. Individual player profiles (batched)
 * 4. Per-player raw PGN games (read from gamesDir, one at a time)
 */
export async function uploadAllFromDisk(
  players: FIDEPlayer[],
  index: PlayerIndex,
  aliases: Record<string, string>,
  gamesDir: string,
  opts?: UploadOptions
): Promise<{ indexUrl: string; playersUploaded: number; gamesUploaded: number }> {
  const onProgress = opts?.onProgress;

  // Count game files on disk
  const gameFiles = existsSync(gamesDir)
    ? readdirSync(gamesDir).filter(f => f.endsWith(".json"))
    : [];
  const total = 2 + players.length + gameFiles.length; // +2 for index + aliases
  let uploaded = 0;

  // 1. Upload index
  const indexUrl = await uploadIndex(index, opts);
  uploaded++;
  onProgress?.(uploaded, total);

  // 2. Upload aliases
  await uploadAliases(aliases, opts);
  uploaded++;
  onProgress?.(uploaded, total);

  // 3. Upload player profiles in batches of 50
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

  // 4. Upload per-player games from disk (one file at a time to keep memory low)
  let gamesUploaded = 0;
  const GAME_BATCH_SIZE = 20;
  for (let i = 0; i < gameFiles.length; i += GAME_BATCH_SIZE) {
    const batch = gameFiles.slice(i, i + GAME_BATCH_SIZE);
    await Promise.all(
      batch.map(async (fileName) => {
        const slug = fileName.replace(/\.json$/, "");
        const filePath = join(gamesDir, fileName);
        await uploadPlayerGamesFromFile(slug, filePath, opts);
        gamesUploaded++;
        uploaded++;
        onProgress?.(uploaded, total);
      })
    );
  }

  return { indexUrl, playersUploaded, gamesUploaded };
}
