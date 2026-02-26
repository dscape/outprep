/**
 * Vercel Blob read utilities for FIDE player data.
 *
 * Blob layout:
 *   fide/index.json          — PlayerIndex (sitemap + listing)
 *   fide/players/{slug}.json — FIDEPlayer profile
 *   fide/games/{slug}.json   — Raw PGN strings for practice
 *
 * In development (no BLOB_READ_WRITE_TOKEN), falls back to local files
 * from the pipeline's processed data directory.
 */

import { list } from "@vercel/blob";

// Re-export types needed by consumers
export type {
  FIDEPlayer,
  PlayerIndex,
  PlayerIndexEntry,
  OpeningStats,
} from "../../packages/fide-pipeline/src/types";

import type {
  FIDEPlayer,
  PlayerIndex,
} from "../../packages/fide-pipeline/src/types";

const PREFIX = "fide";
const IS_DEV = process.env.NODE_ENV === "development";

// In-memory cache for the player index (expensive to fetch, rarely changes)
let cachedIndex: { data: PlayerIndex; fetchedAt: number } | null = null;
const INDEX_CACHE_TTL = 60 * 60 * 1000; // 1 hour

// ─── Local file fallback for development ──────────────────────────────────────

let localData: {
  index: PlayerIndex | null;
  players: Map<string, FIDEPlayer>;
  games: Map<string, string[]>;
} | null = null;

async function loadLocalData(): Promise<typeof localData> {
  if (localData) return localData;

  try {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const processedDir = path.join(
      process.cwd(),
      "packages/fide-pipeline/data/processed"
    );

    localData = { index: null, players: new Map(), games: new Map() };

    if (!fs.existsSync(processedDir)) {
      console.warn(`[fide-blob] Local data dir not found: ${processedDir}`);
      return localData;
    }

    // Load index
    const indexPath = path.join(processedDir, "smoke-index.json");
    const fullIndexPath = path.join(processedDir, "index.json");
    const idxFile = fs.existsSync(fullIndexPath)
      ? fullIndexPath
      : fs.existsSync(indexPath)
        ? indexPath
        : null;

    if (idxFile) {
      localData.index = JSON.parse(fs.readFileSync(idxFile, "utf-8"));
      console.log(`[fide-blob] Loaded index: ${localData.index?.totalPlayers} players`);
    }

    // Load players
    const playersPath = path.join(processedDir, "players.json");
    const smokePath = path.join(processedDir, "smoke-players.json");
    const pFile = fs.existsSync(playersPath)
      ? playersPath
      : fs.existsSync(smokePath)
        ? smokePath
        : null;

    if (pFile) {
      const players: FIDEPlayer[] = JSON.parse(fs.readFileSync(pFile, "utf-8"));
      for (const p of players) {
        localData.players.set(p.slug, p);
      }
    }

    // Load games
    const gamesPath = path.join(processedDir, "games.json");
    if (fs.existsSync(gamesPath)) {
      const gamesObj: Record<string, string[]> = JSON.parse(
        fs.readFileSync(gamesPath, "utf-8")
      );
      for (const [slug, pgns] of Object.entries(gamesObj)) {
        localData.games.set(slug, pgns);
      }
    }

    return localData;
  } catch {
    localData = { index: null, players: new Map(), games: new Map() };
    return localData;
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
 * Get the player index (all players for sitemap + listing).
 * Cached in memory for 1 hour to reduce Blob reads.
 */
export async function getPlayerIndex(): Promise<PlayerIndex | null> {
  if (cachedIndex && Date.now() - cachedIndex.fetchedAt < INDEX_CACHE_TTL) {
    return cachedIndex.data;
  }

  // Dev fallback: use local processed data
  if (IS_DEV) {
    const local = await loadLocalData();
    if (local?.index) {
      cachedIndex = { data: local.index, fetchedAt: Date.now() };
      return local.index;
    }
  }

  const index = await fetchBlobJson<PlayerIndex>(`${PREFIX}/index.json`);
  if (index) {
    cachedIndex = { data: index, fetchedAt: Date.now() };
  }
  return index;
}

/**
 * Get a single player profile by slug.
 */
export async function getPlayer(slug: string): Promise<FIDEPlayer | null> {
  // Dev fallback
  if (IS_DEV) {
    const local = await loadLocalData();
    const player = local?.players.get(slug);
    if (player) return player;
  }

  return fetchBlobJson<FIDEPlayer>(`${PREFIX}/players/${slug}.json`);
}

/**
 * Get raw PGN games for a player (for practice mode).
 */
export async function getPlayerGames(slug: string): Promise<string[] | null> {
  // Dev fallback
  if (IS_DEV) {
    const local = await loadLocalData();
    const games = local?.games.get(slug);
    if (games) return games;
  }

  return fetchBlobJson<string[]>(`${PREFIX}/games/${slug}.json`);
}

/**
 * Format a FIDE player's display name.
 * "Carlsen,M" → "Carlsen, M"
 * "Carlsen,Magnus" → "Carlsen, Magnus"
 */
export function formatPlayerName(name: string): string {
  if (name.includes(",") && !name.includes(", ")) {
    return name.replace(",", ", ");
  }
  return name;
}
