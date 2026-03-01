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
  GameDetail,
  GameIndex,
  GameIndexEntry,
} from "../../packages/fide-pipeline/src/types";

import type {
  FIDEPlayer,
  PlayerIndex,
  GameDetail,
  GameIndex,
} from "../../packages/fide-pipeline/src/types";

const PREFIX = "fide";
const IS_DEV = process.env.NODE_ENV === "development";

// In-memory cache for the player index (expensive to fetch, rarely changes)
let cachedIndex: { data: PlayerIndex; fetchedAt: number } | null = null;
// In-memory cache for the alias map (alias slug → canonical slug)
let cachedAliases: { data: Record<string, string>; fetchedAt: number } | null = null;
// In-memory cache for the game index
let cachedGameIndex: { data: GameIndex; fetchedAt: number } | null = null;
// In-memory cache for game aliases (legacy slug → new slug)
let cachedGameAliases: { data: Record<string, string>; fetchedAt: number } | null = null;
const INDEX_CACHE_TTL = 60 * 60 * 1000; // 1 hour

// In-memory LRU cache for individual game details looked up from JSONL
const gameDetailCache = new Map<string, GameDetail>();
const GAME_DETAIL_CACHE_MAX = 100;

// ─── Local file fallback for development ──────────────────────────────────────

let localData: {
  index: PlayerIndex | null;
  players: Map<string, FIDEPlayer>;
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

    localData = { index: null, players: new Map() };

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

    return localData;
  } catch {
    localData = { index: null, players: new Map() };
    return localData;
  }
}

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

/**
 * Search game-details.jsonl for a specific game by slug.
 * Streams line-by-line to avoid loading the entire 4.5GB file into memory.
 * Caches results for subsequent lookups.
 */
async function loadGameFromJsonl(slug: string): Promise<GameDetail | null> {
  if (gameDetailCache.has(slug)) {
    return gameDetailCache.get(slug)!;
  }

  try {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { execSync } = await import("node:child_process");

    const jsonlPath = path.join(
      process.cwd(),
      "packages/fide-pipeline/data/processed/game-details.jsonl"
    );

    if (!fs.existsSync(jsonlPath)) return null;

    // Use native grep for fast search through 4.8GB JSONL
    // grep -m 1 returns the first match and exits immediately
    const needle = `"slug":"${slug}"`;
    const line = execSync(
      `grep -m 1 -F ${JSON.stringify(needle)} ${JSON.stringify(jsonlPath)}`,
      { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 }
    ).trim();

    if (!line) return null;

    const detail = JSON.parse(line) as GameDetail;
    if (detail.slug === slug) {
      // Evict oldest entry if cache is full
      if (gameDetailCache.size >= GAME_DETAIL_CACHE_MAX) {
        const firstKey = gameDetailCache.keys().next().value;
        if (firstKey) gameDetailCache.delete(firstKey);
      }
      gameDetailCache.set(slug, detail);
      return detail;
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

/**
 * Look up an alias slug and return the canonical slug it redirects to.
 * Returns null if the slug is not an alias.
 */
export async function getAliasTarget(slug: string): Promise<string | null> {
  // Check cache first
  if (cachedAliases && Date.now() - cachedAliases.fetchedAt < INDEX_CACHE_TTL) {
    return cachedAliases.data[slug] ?? null;
  }

  // Dev fallback: load local aliases.json
  if (IS_DEV) {
    try {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const aliasesPath = path.join(
        process.cwd(),
        "packages/fide-pipeline/data/processed/aliases.json"
      );
      if (fs.existsSync(aliasesPath)) {
        const data = JSON.parse(fs.readFileSync(aliasesPath, "utf-8"));
        cachedAliases = { data, fetchedAt: Date.now() };
        return data[slug] ?? null;
      }
    } catch {
      // fall through to Blob
    }
  }

  // Production: fetch from Blob
  const aliases = await fetchBlobJson<Record<string, string>>(`${PREFIX}/aliases.json`);
  if (aliases) {
    cachedAliases = { data: aliases, fetchedAt: Date.now() };
    return aliases[slug] ?? null;
  }

  return null;
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

// ─── Game API ────────────────────────────────────────────────────────────────

/**
 * Get the game index (all games for sitemap + listing).
 * Cached in memory for 1 hour.
 */
export async function getGameIndex(): Promise<GameIndex | null> {
  if (cachedGameIndex && Date.now() - cachedGameIndex.fetchedAt < INDEX_CACHE_TTL) {
    return cachedGameIndex.data;
  }

  // Dev fallback
  if (IS_DEV) {
    try {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const gameIndexPath = path.join(
        process.cwd(),
        "packages/fide-pipeline/data/processed/game-index.json"
      );
      if (fs.existsSync(gameIndexPath)) {
        const stat = fs.statSync(gameIndexPath);
        // V8 cannot hold strings > ~512MB; skip files that would crash the process
        if (stat.size > 256 * 1024 * 1024) {
          console.warn(
            `[fide-blob] game-index.json is too large (${(stat.size / 1024 / 1024).toFixed(0)}MB), skipping local load`
          );
        } else {
          const data = JSON.parse(fs.readFileSync(gameIndexPath, "utf-8"));
          cachedGameIndex = { data, fetchedAt: Date.now() };
          return data;
        }
      }
    } catch {
      // fall through to Blob
    }
  }

  const index = await fetchBlobJson<GameIndex>(`${PREFIX}/game-index.json`);
  if (index) {
    cachedGameIndex = { data: index, fetchedAt: Date.now() };
  }
  return index;
}

/**
 * Get a single game detail by slug.
 * Slugs may contain / (nested format), which maps to __ in disk filenames.
 */
export async function getGame(slug: string): Promise<GameDetail | null> {
  // Dev fallback: read per-game JSON file from disk
  // Slug's "/" maps to subdirectories (e.g. game-details/event-slug/matchup.json)
  if (IS_DEV) {
    try {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const gameFile = path.join(
        process.cwd(),
        "packages/fide-pipeline/data/processed/game-details",
        `${slug}.json`
      );
      if (fs.existsSync(gameFile)) {
        return JSON.parse(fs.readFileSync(gameFile, "utf-8"));
      }
    } catch {
      // fall through
    }

    // JSONL fallback: grep for the game in the 4.8GB file
    const fromJsonl = await loadGameFromJsonl(slug);
    if (fromJsonl) return fromJsonl;
  }

  return fetchBlobJson<GameDetail>(`${PREFIX}/game-details/${slug}.json`);
}

/**
 * Look up a legacy game slug and return the new canonical slug.
 * Returns null if the slug is not a legacy alias.
 */
export async function getGameAliasTarget(slug: string): Promise<string | null> {
  // Check cache first
  if (cachedGameAliases && Date.now() - cachedGameAliases.fetchedAt < INDEX_CACHE_TTL) {
    return cachedGameAliases.data[slug] ?? null;
  }

  // Dev fallback: load local game-aliases.json
  if (IS_DEV) {
    try {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const aliasesPath = path.join(
        process.cwd(),
        "packages/fide-pipeline/data/processed/game-aliases.json"
      );
      if (fs.existsSync(aliasesPath)) {
        const stat = fs.statSync(aliasesPath);
        if (stat.size > 256 * 1024 * 1024) {
          console.warn(
            `[fide-blob] game-aliases.json is too large (${(stat.size / 1024 / 1024).toFixed(0)}MB), skipping local load`
          );
        } else {
          const data = JSON.parse(fs.readFileSync(aliasesPath, "utf-8"));
          cachedGameAliases = { data, fetchedAt: Date.now() };
          return data[slug] ?? null;
        }
      }
    } catch {
      // fall through to Blob
    }
  }

  // Production: fetch from Blob
  const aliases = await fetchBlobJson<Record<string, string>>(`${PREFIX}/game-aliases.json`);
  if (aliases) {
    cachedGameAliases = { data: aliases, fetchedAt: Date.now() };
    return aliases[slug] ?? null;
  }

  return null;
}
