/**
 * Postgres-backed data access layer for FIDE player and game data.
 *
 * Replaces the Blob-based lookups with efficient SQL queries:
 * - getPlayer(): SELECT by slug instead of blob list + fetch
 * - getAliasTarget(): O(1) lookup instead of loading 21MB JSON
 * - getGame(): SELECT by slug instead of blob list + fetch
 * - getGameAliasTarget(): O(1) lookup instead of loading 394MB JSON
 * - Paginated queries for sitemaps instead of loading 1.4GB indexes
 *
 * When DATABASE_URL is not set (e.g. during build without DB, or local dev
 * without Docker), all queries return null/0/[] gracefully.
 */

import { sql } from "./connection";
import { list } from "@vercel/blob";

// Re-export types needed by consumers
export type {
  FIDEPlayer,
  GameDetail,
} from "../../../packages/fide-pipeline/src/types";

import type {
  FIDEPlayer,
  GameDetail,
} from "../../../packages/fide-pipeline/src/types";

const IS_DEV = process.env.NODE_ENV === "development";

/**
 * Whether Postgres is configured. When false (e.g. local dev without Docker,
 * or during build without DATABASE_URL), all queries return empty/null gracefully.
 */
const HAS_POSTGRES = !!process.env.DATABASE_URL;

// ─── Player queries ──────────────────────────────────────────────────────────

/**
 * Get a single player profile by slug.
 * Single SELECT vs blob list() + fetch().
 */
export async function getPlayer(slug: string): Promise<FIDEPlayer | null> {
  if (!HAS_POSTGRES) return null;
  const { rows } = await sql`SELECT * FROM players WHERE slug = ${slug}`;
  if (rows.length === 0) return null;
  return mapRowToPlayer(rows[0]);
}

/**
 * Look up an alias slug and return the canonical slug it redirects to.
 * Single SELECT vs loading 21MB aliases.json.
 */
export async function getAliasTarget(slug: string): Promise<string | null> {
  if (!HAS_POSTGRES) return null;
  const { rows } = await sql`
    SELECT canonical_slug FROM player_aliases WHERE alias_slug = ${slug}
  `;
  return (rows[0]?.canonical_slug as string) ?? null;
}

// ─── Game queries ────────────────────────────────────────────────────────────

/**
 * Get a single game detail by slug.
 * Single SELECT vs blob list() + fetch().
 */
export async function getGame(slug: string): Promise<GameDetail | null> {
  if (!HAS_POSTGRES) return null;
  const { rows } = await sql`SELECT * FROM games WHERE slug = ${slug}`;
  if (rows.length === 0) return null;
  return mapRowToGameDetail(rows[0]);
}

/**
 * Look up a legacy game slug and return the new canonical slug.
 * Single SELECT vs loading 394MB game-aliases.json.
 */
export async function getGameAliasTarget(slug: string): Promise<string | null> {
  if (!HAS_POSTGRES) return null;
  const { rows } = await sql`
    SELECT canonical_slug FROM game_aliases WHERE legacy_slug = ${slug}
  `;
  return (rows[0]?.canonical_slug as string) ?? null;
}

// ─── Sitemap queries ─────────────────────────────────────────────────────────

/**
 * Get total player count for sitemap generation.
 */
export async function getPlayerCount(): Promise<number> {
  if (!HAS_POSTGRES) return 0;
  try {
    const { rows } = await sql`SELECT COUNT(*)::int AS count FROM players`;
    return rows[0].count as number;
  } catch {
    return 0; // Table may not exist yet
  }
}

/**
 * Get total game count for sitemap generation.
 */
export async function getGameCount(): Promise<number> {
  if (!HAS_POSTGRES) return 0;
  try {
    const { rows } = await sql`SELECT COUNT(*)::int AS count FROM games`;
    return rows[0].count as number;
  } catch {
    return 0; // Table may not exist yet
  }
}

/**
 * Get player slugs for a sitemap chunk.
 * Paginated SELECT instead of loading 23MB index.json.
 */
export async function getPlayerSlugsForSitemap(
  offset: number,
  limit: number,
): Promise<{ slug: string; fideRating: number; updatedAt: Date }[]> {
  if (!HAS_POSTGRES) return [];
  try {
    const { rows } = await sql`
      SELECT slug, fide_rating, updated_at
      FROM players
      ORDER BY id
      LIMIT ${limit} OFFSET ${offset}
    `;
    return rows.map((r) => ({
      slug: r.slug as string,
      fideRating: r.fide_rating as number,
      updatedAt: new Date(r.updated_at as string),
    }));
  } catch {
    return []; // Table may not exist yet
  }
}

/**
 * Get game slugs for a sitemap chunk.
 * Paginated SELECT instead of loading 1.4GB game-index.json.
 */
export async function getGameSlugsForSitemap(
  offset: number,
  limit: number,
): Promise<{ slug: string; avgElo: number; date: Date }[]> {
  if (!HAS_POSTGRES) return [];
  try {
    const { rows } = await sql`
      SELECT slug, avg_elo, date
      FROM games
      ORDER BY id
      LIMIT ${limit} OFFSET ${offset}
    `;
    return rows.map((r) => ({
      slug: r.slug as string,
      avgElo: r.avg_elo as number,
      date: new Date(r.date as string),
    }));
  } catch {
    return []; // Table may not exist yet
  }
}

// ─── Utilities ───────────────────────────────────────────────────────────────

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

// ─── Row mappers ─────────────────────────────────────────────────────────────

function mapRowToPlayer(row: Record<string, unknown>): FIDEPlayer {
  return {
    name: row.name as string,
    slug: row.slug as string,
    fideId: row.fide_id as string,
    aliases: [], // Aliases live in player_aliases table, not needed at runtime
    fideRating: row.fide_rating as number,
    title: (row.title as string) ?? null,
    gameCount: row.game_count as number,
    recentEvents: (row.recent_events as string[]) ?? [],
    lastSeen: row.last_seen
      ? formatDateForPlayer(row.last_seen as Date)
      : "",
    openings: (row.openings as FIDEPlayer["openings"]) ?? {
      white: [],
      black: [],
    },
    winRate: row.win_rate as number,
    drawRate: row.draw_rate as number,
    lossRate: row.loss_rate as number,
    federation: (row.federation as string) ?? undefined,
    birthYear: (row.birth_year as number) ?? undefined,
    standardRating: (row.standard_rating as number) ?? undefined,
    rapidRating: (row.rapid_rating as number) ?? undefined,
    blitzRating: (row.blitz_rating as number) ?? undefined,
    recentGames: (row.recent_games as FIDEPlayer["recentGames"]) ?? [],
    notableGames: (row.notable_games as FIDEPlayer["notableGames"]) ?? [],
  };
}

function mapRowToGameDetail(row: Record<string, unknown>): GameDetail {
  return {
    slug: row.slug as string,
    whiteName: row.white_name as string,
    blackName: row.black_name as string,
    whiteSlug: row.white_slug as string,
    blackSlug: row.black_slug as string,
    whiteFideId: row.white_fide_id as string,
    blackFideId: row.black_fide_id as string,
    whiteElo: row.white_elo as number,
    blackElo: row.black_elo as number,
    whiteTitle: (row.white_title as string) ?? null,
    blackTitle: (row.black_title as string) ?? null,
    whiteFederation: (row.white_federation as string) ?? null,
    blackFederation: (row.black_federation as string) ?? null,
    event: row.event as string,
    site: (row.site as string) ?? null,
    date: formatDateForGame(row.date as Date),
    round: (row.round as string) ?? null,
    eco: (row.eco as string) ?? null,
    opening: (row.opening as string) ?? null,
    variation: (row.variation as string) ?? null,
    result: row.result as string,
    pgn: "", // PGN stored in Blob, not in DB — use getGamePgn()
  };
}

// ─── Game PGN (Blob) ────────────────────────────────────────────────────────

/**
 * Fetch a game's PGN text from Vercel Blob.
 * PGN is stored at fide/game-pgn/{slug}.txt to keep the DB small.
 * In dev, falls back to reading from local game-details JSONL.
 */
export async function getGamePgn(slug: string): Promise<string | null> {
  // Dev fallback: read PGN from local game-details file
  if (IS_DEV) {
    const localPgn = await loadLocalGamePgn(slug);
    if (localPgn) return localPgn;
  }

  try {
    const result = await list({ prefix: `fide/game-pgn/${slug}.txt`, limit: 1 });
    if (result.blobs.length === 0) return null;
    const res = await fetch(result.blobs[0].url, { next: { revalidate: 604800 } });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

/**
 * Dev fallback: load PGN from the local game-details JSONL or per-game JSON files.
 */
async function loadLocalGamePgn(slug: string): Promise<string | null> {
  try {
    const fs = await import("node:fs");
    const path = await import("node:path");

    // Try per-game JSON file first
    const gameFile = path.join(
      process.cwd(),
      "packages/fide-pipeline/data/processed/game-details",
      `${slug}.json`,
    );
    if (fs.existsSync(gameFile)) {
      const detail = JSON.parse(fs.readFileSync(gameFile, "utf-8"));
      return detail.pgn ?? null;
    }

    return null;
  } catch {
    return null;
  }
}

/** Convert a Date to "YYYY.MM.DD" format used by the app. */
function formatDateForPlayer(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}.${m}.${day}`;
}

function formatDateForGame(d: Date): string {
  return formatDateForPlayer(d);
}
