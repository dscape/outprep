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

// ─── Online player linking queries ──────────────────────────────────────────

export interface OnlinePlayerLink {
  id: number;
  playerId: number;
  onlinePlayerId: number;
  platform: string;
  username: string;
  status: string;
  suggestedBy: string | null;
  suggestedAt: Date;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  notes: string | null;
  fideId: string;
  playerName: string;
}

/**
 * Get or create an online_players record.
 * Returns the id.
 */
export async function upsertOnlinePlayer(data: {
  platform: string;
  platformId: string;
  username: string;
  slug: string;
  title?: string | null;
  bulletRating?: number | null;
  blitzRating?: number | null;
  rapidRating?: number | null;
  classicalRating?: number | null;
  profileData?: Record<string, unknown>;
}): Promise<number | null> {
  if (!HAS_POSTGRES) return null;
  try {
    const { rows } = await sql`
      INSERT INTO online_players (platform, platform_id, username, slug, title,
        bullet_rating, blitz_rating, rapid_rating, classical_rating, profile_data, last_fetched_at)
      VALUES (
        ${data.platform}, ${data.platformId}, ${data.username}, ${data.slug},
        ${data.title ?? null},
        ${data.bulletRating ?? null}, ${data.blitzRating ?? null},
        ${data.rapidRating ?? null}, ${data.classicalRating ?? null},
        ${JSON.stringify(data.profileData ?? {})},
        NOW()
      )
      ON CONFLICT (platform, platform_id) DO UPDATE SET
        username = EXCLUDED.username,
        title = EXCLUDED.title,
        bullet_rating = EXCLUDED.bullet_rating,
        blitz_rating = EXCLUDED.blitz_rating,
        rapid_rating = EXCLUDED.rapid_rating,
        classical_rating = EXCLUDED.classical_rating,
        profile_data = EXCLUDED.profile_data,
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
 * Get an online player by platform and platform ID.
 */
export async function getOnlinePlayer(platform: string, platformId: string): Promise<{
  id: number;
  platform: string;
  platformId: string;
  username: string;
  slug: string;
  lastFetchedAt: Date;
} | null> {
  if (!HAS_POSTGRES) return null;
  try {
    const { rows } = await sql`
      SELECT id, platform, platform_id, username, slug, last_fetched_at
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
      lastFetchedAt: new Date(r.last_fetched_at as string),
    };
  } catch {
    return null;
  }
}

/**
 * Suggest a link between a FIDE player and an online account.
 * Returns the link ID on success, null if the player or online account doesn't exist.
 */
export async function suggestLink(data: {
  fideId: string;
  platform: string;
  platformId: string;
  suggestedBy?: string;
}): Promise<{ id: number; status: string } | null> {
  if (!HAS_POSTGRES) return null;
  try {
    const { rows } = await sql`
      INSERT INTO online_player_links (player_id, online_player_id, suggested_by)
      SELECT p.id, op.id, ${data.suggestedBy ?? null}
      FROM players p, online_players op
      WHERE p.fide_id = ${data.fideId}
        AND op.platform = ${data.platform}
        AND op.platform_id = ${data.platformId}
      ON CONFLICT (player_id, online_player_id) DO NOTHING
      RETURNING id, status
    `;
    if (rows.length === 0) return null;
    return { id: rows[0].id as number, status: rows[0].status as string };
  } catch {
    return null;
  }
}

/**
 * List pending link suggestions for admin review.
 */
export async function getPendingLinks(limit: number = 50): Promise<OnlinePlayerLink[]> {
  if (!HAS_POSTGRES) return [];
  try {
    const { rows } = await sql`
      SELECT l.id, l.player_id, l.online_player_id, l.status,
             l.suggested_by, l.suggested_at, l.reviewed_by, l.reviewed_at, l.notes,
             op.platform, op.username,
             p.fide_id, p.name AS player_name
      FROM online_player_links l
      JOIN online_players op ON op.id = l.online_player_id
      JOIN players p ON p.id = l.player_id
      WHERE l.status = 'pending'
      ORDER BY l.suggested_at DESC
      LIMIT ${limit}
    `;
    return rows.map(mapRowToLink);
  } catch {
    return [];
  }
}

/**
 * Update a link's status (approve, reject, revoke).
 */
export async function updateLinkStatus(
  linkId: number,
  status: "approved" | "rejected" | "revoked",
  reviewedBy?: string,
  notes?: string,
): Promise<boolean> {
  if (!HAS_POSTGRES) return false;
  try {
    const { rows } = await sql`
      UPDATE online_player_links
      SET status = ${status},
          reviewed_by = ${reviewedBy ?? null},
          reviewed_at = NOW(),
          notes = ${notes ?? null}
      WHERE id = ${linkId}
      RETURNING id
    `;
    return rows.length > 0;
  } catch {
    return false;
  }
}

/**
 * Get all links for a FIDE player (by fide_id).
 */
export async function getLinksForPlayer(fideId: string): Promise<OnlinePlayerLink[]> {
  if (!HAS_POSTGRES) return [];
  try {
    const { rows } = await sql`
      SELECT l.id, l.player_id, l.online_player_id, l.status,
             l.suggested_by, l.suggested_at, l.reviewed_by, l.reviewed_at, l.notes,
             op.platform, op.username,
             p.fide_id, p.name AS player_name
      FROM online_player_links l
      JOIN online_players op ON op.id = l.online_player_id
      JOIN players p ON p.id = l.player_id
      WHERE p.fide_id = ${fideId}
      ORDER BY l.suggested_at DESC
    `;
    return rows.map(mapRowToLink);
  } catch {
    return [];
  }
}

/**
 * Get approved online accounts for a FIDE player slug.
 * Used on the player page to show linked accounts.
 */
export async function getApprovedLinksForPlayerSlug(slug: string): Promise<Array<{
  platform: string;
  username: string;
  onlinePlayerSlug: string;
}>> {
  if (!HAS_POSTGRES) return [];
  try {
    const { rows } = await sql`
      SELECT op.platform, op.username, op.slug AS online_player_slug
      FROM online_player_links l
      JOIN online_players op ON op.id = l.online_player_id
      JOIN players p ON p.id = l.player_id
      WHERE p.slug = ${slug} AND l.status = 'approved'
    `;
    return rows.map((r) => ({
      platform: r.platform as string,
      username: r.username as string,
      onlinePlayerSlug: r.online_player_slug as string,
    }));
  } catch {
    return [];
  }
}

function mapRowToLink(r: Record<string, unknown>): OnlinePlayerLink {
  return {
    id: r.id as number,
    playerId: r.player_id as number,
    onlinePlayerId: r.online_player_id as number,
    platform: r.platform as string,
    username: r.username as string,
    status: r.status as string,
    suggestedBy: (r.suggested_by as string) ?? null,
    suggestedAt: new Date(r.suggested_at as string),
    reviewedBy: (r.reviewed_by as string) ?? null,
    reviewedAt: r.reviewed_at ? new Date(r.reviewed_at as string) : null,
    notes: (r.notes as string) ?? null,
    fideId: r.fide_id as string,
    playerName: r.player_name as string,
  };
}
