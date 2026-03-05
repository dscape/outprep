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

// Re-export types needed by consumers
export type {
  FIDEPlayer,
  GameDetail,
} from "../../../packages/fide-pipeline/src/types";

import type {
  FIDEPlayer,
  GameDetail,
} from "../../../packages/fide-pipeline/src/types";

/**
 * Whether Postgres is configured. When false (e.g. local dev without Docker,
 * or during build without DATABASE_URL), all queries return empty/null gracefully.
 */
const HAS_POSTGRES = !!(
  process.env.DATABASE_URL || process.env.OUTPREP_SQL_DATABASE_URL
);

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

/**
 * Get a player profile by FIDE ID.
 * Uses the idx_players_fide_id index for efficient lookup.
 */
export async function getPlayerByFideId(fideId: string): Promise<FIDEPlayer | null> {
  if (!HAS_POSTGRES) return null;
  try {
    const { rows } = await sql`SELECT * FROM players WHERE fide_id = ${fideId}`;
    if (rows.length === 0) return null;
    return mapRowToPlayer(rows[0]);
  } catch {
    return null;
  }
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

// ─── Homepage queries ────────────────────────────────────────────────────────

/**
 * Get top-rated players for the homepage featured section.
 */
export async function getTopPlayers(
  limit: number,
): Promise<
  Array<{
    slug: string;
    name: string;
    title: string | null;
    fideRating: number;
    federation: string | null;
    gameCount: number;
  }>
> {
  if (!HAS_POSTGRES) return [];
  try {
    const { rows } = await sql`
      SELECT slug, name, title, fide_rating, federation, game_count
      FROM players
      ORDER BY fide_rating DESC
      LIMIT ${limit}
    `;
    return rows.map((r) => ({
      slug: r.slug as string,
      name: r.name as string,
      title: (r.title as string) ?? null,
      fideRating: r.fide_rating as number,
      federation: (r.federation as string) ?? null,
      gameCount: r.game_count as number,
    }));
  } catch {
    return [];
  }
}

// ─── Search queries ─────────────────────────────────────────────────────────

/**
 * Search FIDE players by name for autocomplete.
 * Uses the trigram GIN index (idx_players_name_trgm) for fast ILIKE matching.
 * Results sorted by rating so famous players surface first.
 */
export async function searchPlayers(
  query: string,
  limit: number = 8,
): Promise<
  Array<{
    slug: string;
    name: string;
    title: string | null;
    fideRating: number;
    federation: string | null;
  }>
> {
  if (!HAS_POSTGRES) return [];
  try {
    const trimmed = query.trim();
    if (trimmed.length < 2) return [];

    const isNumeric = /^\d+$/.test(trimmed);
    const { rows } = isNumeric
      ? await sql`
          SELECT slug, name, title, fide_rating, federation
          FROM players
          WHERE fide_id = ${trimmed}
          LIMIT ${limit}
        `
      : await sql`
          SELECT slug, name, title, fide_rating, federation
          FROM players
          WHERE name ILIKE ${`%${trimmed}%`}
          ORDER BY fide_rating DESC
          LIMIT ${limit}
        `;
    return rows.map((r) => ({
      slug: r.slug as string,
      name: r.name as string,
      title: (r.title as string) ?? null,
      fideRating: r.fide_rating as number,
      federation: (r.federation as string) ?? null,
    }));
  } catch {
    return [];
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

/** Parse a JSONB value that may come back as a string or already-parsed object. */
function jsonb<T>(val: unknown, fallback: T): T {
  if (val == null) return fallback;
  if (typeof val === "string") {
    try { return JSON.parse(val) as T; } catch { return fallback; }
  }
  return val as T;
}

function mapRowToPlayer(row: Record<string, unknown>): FIDEPlayer {
  return {
    name: row.name as string,
    slug: row.slug as string,
    fideId: row.fide_id as string,
    aliases: [], // Aliases live in player_aliases table, not needed at runtime
    fideRating: row.fide_rating as number,
    title: (row.title as string) ?? null,
    gameCount: row.game_count as number,
    recentEvents: jsonb<string[]>(row.recent_events, []),
    lastSeen: row.last_seen
      ? formatDateForPlayer(row.last_seen as Date)
      : "",
    openings: jsonb<FIDEPlayer["openings"]>(row.openings, { white: [], black: [] }),
    winRate: row.win_rate as number,
    drawRate: row.draw_rate as number,
    lossRate: row.loss_rate as number,
    federation: (row.federation as string) ?? undefined,
    birthYear: (row.birth_year as number) ?? undefined,
    standardRating: (row.standard_rating as number) ?? undefined,
    rapidRating: (row.rapid_rating as number) ?? undefined,
    blitzRating: (row.blitz_rating as number) ?? undefined,
    recentGames: jsonb<FIDEPlayer["recentGames"]>(row.recent_games, []),
    notableGames: jsonb<FIDEPlayer["notableGames"]>(row.notable_games, []),
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
    pgn: (row.pgn as string) ?? "",
  };
}

// ─── Game PGN ────────────────────────────────────────────────────────────────

/**
 * Fetch a game's PGN text from the games table.
 */
export async function getGamePgn(slug: string): Promise<string | null> {
  if (!HAS_POSTGRES) return null;
  try {
    const { rows } = await sql`SELECT pgn FROM games WHERE slug = ${slug}`;
    if (rows.length === 0) return null;
    return (rows[0].pgn as string) ?? null;
  } catch {
    return null;
  }
}

/**
 * Get all PGN strings for a player's games (for practice mode).
 * Uses UNION ALL for optimal index usage on white_slug / black_slug.
 */
export async function getPlayerGamePgns(slug: string): Promise<string[] | null> {
  if (!HAS_POSTGRES) return null;
  try {
    const { rows } = await sql`
      SELECT pgn FROM games WHERE white_slug = ${slug} AND pgn IS NOT NULL
      UNION ALL
      SELECT pgn FROM games WHERE black_slug = ${slug} AND pgn IS NOT NULL
    `;
    if (rows.length === 0) return null;
    return rows.map((r) => r.pgn as string);
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

// ─── Online player cache queries ────────────────────────────────────────────

export interface CachedOnlinePlayer {
  id: number;
  platform: string;
  platformId: string;
  username: string;
  slug: string;
  bulletRating: number | null;
  blitzRating: number | null;
  rapidRating: number | null;
  classicalRating: number | null;
  title: string | null;
  lastFetchedAt: Date;
}

/**
 * Get a cached online player. Returns null if not found or DB not available.
 */
export async function getCachedOnlinePlayer(
  platform: string,
  platformId: string,
): Promise<CachedOnlinePlayer | null> {
  if (!HAS_POSTGRES) return null;
  try {
    const { rows } = await sql`
      SELECT id, platform, platform_id, username, slug,
             bullet_rating, blitz_rating, rapid_rating, classical_rating,
             title, last_fetched_at
      FROM online_players
      WHERE platform = ${platform} AND platform_id = ${platformId}
    `;
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      id: r.id as number,
      platform: r.platform as string,
      platformId: r.platform_id as string,
      username: r.username as string,
      slug: r.slug as string,
      bulletRating: (r.bullet_rating as number) ?? null,
      blitzRating: (r.blitz_rating as number) ?? null,
      rapidRating: (r.rapid_rating as number) ?? null,
      classicalRating: (r.classical_rating as number) ?? null,
      title: (r.title as string) ?? null,
      lastFetchedAt: new Date(r.last_fetched_at as string),
    };
  } catch {
    return null;
  }
}

/**
 * Upsert an online player record. Returns the ID.
 */
export async function upsertCachedOnlinePlayer(data: {
  platform: string;
  platformId: string;
  username: string;
  slug: string;
  bulletRating?: number | null;
  blitzRating?: number | null;
  rapidRating?: number | null;
  classicalRating?: number | null;
  title?: string | null;
}): Promise<number | null> {
  if (!HAS_POSTGRES) return null;
  try {
    const { rows } = await sql`
      INSERT INTO online_players (platform, platform_id, username, slug,
        bullet_rating, blitz_rating, rapid_rating, classical_rating, title,
        last_fetched_at)
      VALUES (
        ${data.platform}, ${data.platformId}, ${data.username}, ${data.slug},
        ${data.bulletRating ?? null}, ${data.blitzRating ?? null},
        ${data.rapidRating ?? null}, ${data.classicalRating ?? null},
        ${data.title ?? null}, NOW()
      )
      ON CONFLICT (platform, platform_id) DO UPDATE SET
        username = EXCLUDED.username,
        bullet_rating = EXCLUDED.bullet_rating,
        blitz_rating = EXCLUDED.blitz_rating,
        rapid_rating = EXCLUDED.rapid_rating,
        classical_rating = EXCLUDED.classical_rating,
        title = EXCLUDED.title,
        last_fetched_at = NOW(),
        updated_at = NOW()
      RETURNING id
    `;
    return rows[0]?.id as number;
  } catch {
    return null;
  }
}

/**
 * Get the most recent game timestamp for an online player.
 * Used to fetch only newer games incrementally.
 */
export async function getLatestOnlineGameTime(
  onlinePlayerId: number,
): Promise<Date | null> {
  if (!HAS_POSTGRES) return null;
  try {
    const { rows } = await sql`
      SELECT MAX(played_at) AS latest
      FROM online_games
      WHERE online_player_id = ${onlinePlayerId}
    `;
    return rows[0]?.latest ? new Date(rows[0].latest as string) : null;
  } catch {
    return null;
  }
}

/**
 * Insert online games in batch. Uses ON CONFLICT to skip duplicates.
 */
export async function insertOnlineGames(
  games: Array<{
    platform: string;
    platformGameId: string;
    onlinePlayerId: number;
    playerColor: string;
    opponentName: string | null;
    opponentRating: number | null;
    playerRating: number | null;
    speed: string | null;
    variant: string;
    rated: boolean;
    result: string | null;
    eco: string | null;
    opening: string | null;
    playedAt: Date | null;
    moves: string | null;
    pgn: string | null;
    clockInitial: number | null;
    clockIncrement: number | null;
  }>,
): Promise<number> {
  if (!HAS_POSTGRES || games.length === 0) return 0;
  let inserted = 0;
  // Insert in batches to avoid query size limits
  const BATCH = 100;
  for (let i = 0; i < games.length; i += BATCH) {
    const batch = games.slice(i, i + BATCH);
    for (const g of batch) {
      try {
        const { rows } = await sql`
          INSERT INTO online_games (
            platform, platform_game_id, online_player_id, player_color,
            opponent_name, opponent_rating, player_rating, speed, variant, rated,
            result, eco, opening, played_at, moves, pgn, clock_initial, clock_increment
          ) VALUES (
            ${g.platform}, ${g.platformGameId}, ${g.onlinePlayerId}, ${g.playerColor},
            ${g.opponentName}, ${g.opponentRating}, ${g.playerRating},
            ${g.speed}, ${g.variant}, ${g.rated}, ${g.result},
            ${g.eco}, ${g.opening}, ${g.playedAt?.toISOString() ?? null},
            ${g.moves}, ${g.pgn}, ${g.clockInitial}, ${g.clockIncrement}
          )
          ON CONFLICT (platform, platform_game_id, online_player_id) DO NOTHING
          RETURNING id
        `;
        if (rows.length > 0) inserted++;
      } catch {
        // Skip individual failures
      }
    }
  }
  return inserted;
}

/**
 * Get cached online games for a player, newest first.
 */
export async function getCachedOnlineGames(
  onlinePlayerId: number,
  limit = 500,
): Promise<Array<{
  platformGameId: string;
  playerColor: string;
  opponentName: string | null;
  opponentRating: number | null;
  playerRating: number | null;
  speed: string | null;
  result: string | null;
  eco: string | null;
  opening: string | null;
  playedAt: Date | null;
  moves: string | null;
  pgn: string | null;
}>> {
  if (!HAS_POSTGRES) return [];
  try {
    const { rows } = await sql`
      SELECT platform_game_id, player_color, opponent_name, opponent_rating,
             player_rating, speed, result, eco, opening, played_at, moves, pgn
      FROM online_games
      WHERE online_player_id = ${onlinePlayerId}
      ORDER BY played_at DESC
      LIMIT ${limit}
    `;
    return rows.map((r) => ({
      platformGameId: r.platform_game_id as string,
      playerColor: r.player_color as string,
      opponentName: (r.opponent_name as string) ?? null,
      opponentRating: (r.opponent_rating as number) ?? null,
      playerRating: (r.player_rating as number) ?? null,
      speed: (r.speed as string) ?? null,
      result: (r.result as string) ?? null,
      eco: (r.eco as string) ?? null,
      opening: (r.opening as string) ?? null,
      playedAt: r.played_at ? new Date(r.played_at as string) : null,
      moves: (r.moves as string) ?? null,
      pgn: (r.pgn as string) ?? null,
    }));
  } catch {
    return [];
  }
}
