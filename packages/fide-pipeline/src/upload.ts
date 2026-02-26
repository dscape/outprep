/**
 * Upload processed player data to Vercel Blob storage.
 *
 * Features:
 * - Retry with backoff on rate limiting (BlobServiceRateLimited)
 * - Resume support via state file (survives Ctrl+C)
 * - Reads game files from disk one at a time (low memory)
 *
 * Blob layout:
 *   fide/index.json          — PlayerIndex (master list for sitemap)
 *   fide/players/{slug}.json — FIDEPlayer per player (profile + stats)
 *   fide/games/{slug}.json   — Raw PGN strings per player (for practice)
 *   fide/aliases.json        — Alias → canonical slug map (for 301 redirects)
 */

import { put } from "@vercel/blob";
import { readFileSync, readdirSync, existsSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { FIDEPlayer, PlayerIndex } from "./types";

const DEFAULT_PREFIX = "fide";

interface UploadOptions {
  prefix?: string;
  onProgress?: (uploaded: number, total: number) => void;
  stateFile?: string; // Path to upload-state.json for resume
  fresh?: boolean; // Ignore resume state
}

// ─── Retry helper ────────────────────────────────────────────────────────────

/**
 * Retry a function with backoff when rate-limited.
 * Reads `error.retryAfter` (seconds) from BlobServiceRateLimited errors.
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 5
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      const retryAfter = (error as { retryAfter?: number }).retryAfter;
      if (retryAfter && attempt < maxRetries) {
        const waitSec = retryAfter + 1;
        console.log(`  ⏳ Rate limited, retrying in ${waitSec}s... (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise((resolve) => setTimeout(resolve, waitSec * 1000));
        continue;
      }
      throw error;
    }
  }
  throw new Error("retryWithBackoff: unreachable");
}

// ─── Resume state ────────────────────────────────────────────────────────────

interface UploadState {
  prefix: string;
  uploaded: Set<string>;
}

function loadState(stateFile: string, prefix: string): UploadState {
  try {
    if (existsSync(stateFile)) {
      const raw = JSON.parse(readFileSync(stateFile, "utf-8"));
      if (raw.prefix === prefix && Array.isArray(raw.uploaded)) {
        return { prefix, uploaded: new Set(raw.uploaded) };
      }
    }
  } catch {
    // Corrupt state file — start fresh
  }
  return { prefix, uploaded: new Set() };
}

function saveState(stateFile: string, state: UploadState): void {
  writeFileSync(
    stateFile,
    JSON.stringify({ prefix: state.prefix, uploaded: Array.from(state.uploaded) })
  );
}

function clearState(stateFile: string): void {
  try {
    if (existsSync(stateFile)) unlinkSync(stateFile);
  } catch {
    // Non-fatal
  }
}

// ─── Upload functions ────────────────────────────────────────────────────────

export async function uploadIndex(
  index: PlayerIndex,
  opts?: UploadOptions
): Promise<string> {
  const prefix = opts?.prefix ?? DEFAULT_PREFIX;
  const path = `${prefix}/index.json`;
  const blob = await retryWithBackoff(() =>
    put(path, JSON.stringify(index), {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
    })
  );
  return blob.url;
}

export async function uploadPlayer(
  player: FIDEPlayer,
  opts?: UploadOptions
): Promise<string> {
  const prefix = opts?.prefix ?? DEFAULT_PREFIX;
  const path = `${prefix}/players/${player.slug}.json`;
  const blob = await retryWithBackoff(() =>
    put(path, JSON.stringify(player), {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
    })
  );
  return blob.url;
}

export async function uploadPlayerGamesFromFile(
  slug: string,
  filePath: string,
  opts?: UploadOptions
): Promise<string> {
  const prefix = opts?.prefix ?? DEFAULT_PREFIX;
  const blobPath = `${prefix}/games/${slug}.json`;
  const content = readFileSync(filePath, "utf-8");
  const blob = await retryWithBackoff(() =>
    put(blobPath, content, {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
    })
  );
  return blob.url;
}

export async function uploadAliases(
  aliases: Record<string, string>,
  opts?: UploadOptions
): Promise<string> {
  const prefix = opts?.prefix ?? DEFAULT_PREFIX;
  const path = `${prefix}/aliases.json`;
  const blob = await retryWithBackoff(() =>
    put(path, JSON.stringify(aliases), {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
    })
  );
  return blob.url;
}

// ─── Main upload orchestrator ────────────────────────────────────────────────

/**
 * Upload all player data, reading game files from disk one at a time.
 * Supports retry on rate limiting and resume via state file.
 */
export async function uploadAllFromDisk(
  players: FIDEPlayer[],
  index: PlayerIndex,
  aliases: Record<string, string>,
  gamesDir: string,
  opts?: UploadOptions
): Promise<{ indexUrl: string; playersUploaded: number; gamesUploaded: number }> {
  const prefix = opts?.prefix ?? DEFAULT_PREFIX;
  const onProgress = opts?.onProgress;
  const stateFile = opts?.stateFile ?? join(gamesDir, "..", "upload-state.json");

  // Load resume state
  const state = opts?.fresh ? { prefix, uploaded: new Set<string>() } : loadState(stateFile, prefix);
  const skipped = state.uploaded.size;
  if (skipped > 0) {
    console.log(`  Resuming: ${skipped} items already uploaded, skipping.`);
  }

  // Count game files on disk
  const gameFiles = existsSync(gamesDir)
    ? readdirSync(gamesDir).filter(f => f.endsWith(".json"))
    : [];
  const total = 2 + players.length + gameFiles.length;
  let uploaded = skipped; // Start counter from where we left off

  // 1. Upload index
  const indexPath = `${prefix}/index.json`;
  let indexUrl = "";
  if (!state.uploaded.has(indexPath)) {
    indexUrl = await uploadIndex(index, opts);
    state.uploaded.add(indexPath);
    saveState(stateFile, state);
  }
  uploaded++;
  onProgress?.(uploaded, total);

  // 2. Upload aliases
  const aliasesPath = `${prefix}/aliases.json`;
  if (!state.uploaded.has(aliasesPath)) {
    await uploadAliases(aliases, opts);
    state.uploaded.add(aliasesPath);
    saveState(stateFile, state);
  }
  uploaded++;
  onProgress?.(uploaded, total);

  // 3. Upload player profiles in batches of 10
  let playersUploaded = 0;
  const BATCH_SIZE = 10;
  for (let i = 0; i < players.length; i += BATCH_SIZE) {
    const batch = players.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (player) => {
        const path = `${prefix}/players/${player.slug}.json`;
        if (!state.uploaded.has(path)) {
          await uploadPlayer(player, opts);
          state.uploaded.add(path);
        }
        playersUploaded++;
        uploaded++;
        onProgress?.(uploaded, total);
      })
    );
    // Save state after each batch
    saveState(stateFile, state);
  }

  // 4. Upload per-player games from disk in batches of 5
  let gamesUploaded = 0;
  const GAME_BATCH_SIZE = 5;
  for (let i = 0; i < gameFiles.length; i += GAME_BATCH_SIZE) {
    const batch = gameFiles.slice(i, i + GAME_BATCH_SIZE);
    await Promise.all(
      batch.map(async (fileName) => {
        const slug = fileName.replace(/\.json$/, "");
        const path = `${prefix}/games/${slug}.json`;
        if (!state.uploaded.has(path)) {
          const filePath = join(gamesDir, fileName);
          await uploadPlayerGamesFromFile(slug, filePath, opts);
          state.uploaded.add(path);
        }
        gamesUploaded++;
        uploaded++;
        onProgress?.(uploaded, total);
      })
    );
    // Save state after each batch
    saveState(stateFile, state);
  }

  // Clean up state file on successful completion
  clearState(stateFile);

  return { indexUrl, playersUploaded, gamesUploaded };
}
