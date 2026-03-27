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
export async function getGame(slug: string): Promise<(GameDetail & { eventSlug: string | null }) | null> {
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
 * Safe to use OFFSET here — route handler generates one sitemap at a time (no
 * build-time stampede). ISR caches the result for 24h.
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
 * Safe to use OFFSET here — route handler generates one sitemap at a time (no
 * build-time stampede). ISR caches the result for 24h.
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

// ─── Event queries ──────────────────────────────────────────────────────────

export interface EventSummary {
  slug: string;
  name: string;
  site: string | null;
  dateStart: string | null;
  dateEnd: string | null;
  gameCount: number;
  avgElo: number | null;
}

export interface EventDetail extends EventSummary {
  games: Array<{
    slug: string;
    whiteName: string;
    blackName: string;
    whiteSlug: string | null;
    blackSlug: string | null;
    whiteElo: number;
    blackElo: number;
    whiteTitle: string | null;
    blackTitle: string | null;
    whiteFederation: string | null;
    blackFederation: string | null;
    round: string | null;
    date: string;
    eco: string | null;
    opening: string | null;
    result: string;
  }>;
  players: Array<{
    slug: string;
    name: string;
    title: string | null;
    federation: string | null;
    fideRating: number;
    gamesInEvent: number;
  }>;
}

/**
 * Get an event by its slug with all games and participating players.
 */
export async function getEvent(slug: string): Promise<EventDetail | null> {
  if (!HAS_POSTGRES) return null;
  try {
    const { rows: eventRows } = await sql`
      SELECT slug, name, site, date_start, date_end, game_count, avg_elo
      FROM events WHERE slug = ${slug}
    `;
    if (eventRows.length === 0) return null;
    const e = eventRows[0];

    const { rows: gameRows } = await sql`
      SELECT slug, white_name, black_name, white_slug, black_slug,
             white_elo, black_elo, white_title, black_title,
             white_federation, black_federation,
             round, date, eco, opening, result
      FROM games
      WHERE event_slug = ${slug}
      ORDER BY date ASC, round ASC NULLS LAST
    `;

    // Build unique player list from games
    const playerMap = new Map<string, {
      slug: string; name: string; title: string | null;
      federation: string | null; fideRating: number; gamesInEvent: number;
    }>();

    for (const g of gameRows) {
      const ws = g.white_slug as string | null;
      const bs = g.black_slug as string | null;
      if (ws) {
        const existing = playerMap.get(ws);
        if (existing) {
          existing.gamesInEvent++;
        } else {
          playerMap.set(ws, {
            slug: ws,
            name: g.white_name as string,
            title: (g.white_title as string) ?? null,
            federation: (g.white_federation as string) ?? null,
            fideRating: g.white_elo as number,
            gamesInEvent: 1,
          });
        }
      }
      if (bs) {
        const existing = playerMap.get(bs);
        if (existing) {
          existing.gamesInEvent++;
        } else {
          playerMap.set(bs, {
            slug: bs,
            name: g.black_name as string,
            title: (g.black_title as string) ?? null,
            federation: (g.black_federation as string) ?? null,
            fideRating: g.black_elo as number,
            gamesInEvent: 1,
          });
        }
      }
    }

    const players = Array.from(playerMap.values())
      .sort((a, b) => b.fideRating - a.fideRating);

    return {
      slug: e.slug as string,
      name: e.name as string,
      site: (e.site as string) ?? null,
      dateStart: e.date_start ? formatDateForGame(e.date_start as Date) : null,
      dateEnd: e.date_end ? formatDateForGame(e.date_end as Date) : null,
      gameCount: e.game_count as number,
      avgElo: (e.avg_elo as number) ?? null,
      games: gameRows.map((g) => ({
        slug: g.slug as string,
        whiteName: g.white_name as string,
        blackName: g.black_name as string,
        whiteSlug: (g.white_slug as string) ?? null,
        blackSlug: (g.black_slug as string) ?? null,
        whiteElo: g.white_elo as number,
        blackElo: g.black_elo as number,
        whiteTitle: (g.white_title as string) ?? null,
        blackTitle: (g.black_title as string) ?? null,
        whiteFederation: (g.white_federation as string) ?? null,
        blackFederation: (g.black_federation as string) ?? null,
        round: (g.round as string) ?? null,
        date: formatDateForGame(g.date as Date),
        eco: (g.eco as string) ?? null,
        opening: (g.opening as string) ?? null,
        result: g.result as string,
      })),
      players,
    };
  } catch {
    return null;
  }
}

// ─── Online profile cache ────────────────────────────────────────────────

interface OnlineProfileRow {
  profileJson: unknown;
  gameCount: number;
  newestGameTs: number | null;
}

/**
 * Get a cached online profile (Lichess/Chess.com).
 * Returns null if no cached profile exists or Postgres is unavailable.
 */
export async function getOnlineProfile(
  platform: string,
  username: string,
): Promise<OnlineProfileRow | null> {
  if (!HAS_POSTGRES) return null;
  try {
    const u = username.toLowerCase();
    const { rows } = await sql`
      SELECT profile_json, game_count, newest_game_ts
      FROM online_profiles
      WHERE platform = ${platform} AND username = ${u}
    `;
    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      profileJson: jsonb(row.profile_json, null),
      gameCount: row.game_count as number,
      newestGameTs: row.newest_game_ts ? Number(row.newest_game_ts) : null,
    };
  } catch {
    return null;
  }
}

/**
 * Get recent events for the homepage.
 */
export async function getRecentEvents(
  limit: number,
): Promise<EventSummary[]> {
  if (!HAS_POSTGRES) return [];
  try {
    const { rows } = await sql`
      SELECT slug, name, site, date_start, date_end, game_count, avg_elo
      FROM events
      WHERE game_count >= 5
      ORDER BY date_end DESC NULLS LAST
      LIMIT ${limit}
    `;
    return rows.map((e) => ({
      slug: e.slug as string,
      name: e.name as string,
      site: (e.site as string) ?? null,
      dateStart: e.date_start ? formatDateForGame(e.date_start as Date) : null,
      dateEnd: e.date_end ? formatDateForGame(e.date_end as Date) : null,
      gameCount: e.game_count as number,
      avgElo: (e.avg_elo as number) ?? null,
    }));
  } catch {
    return [];
  }
}

/**
 * Get event count for sitemap generation.
 */
export async function getEventCount(): Promise<number> {
  if (!HAS_POSTGRES) return 0;
  try {
    const { rows } = await sql`SELECT COUNT(*)::int AS count FROM events`;
    return rows[0].count as number;
  } catch {
    return 0;
  }
}

/**
 * Get event slugs for a sitemap chunk.
 */
export async function getEventSlugsForSitemap(
  offset: number,
  limit: number,
): Promise<{ slug: string; gameCount: number; updatedAt: Date }[]> {
  if (!HAS_POSTGRES) return [];
  try {
    const { rows } = await sql`
      SELECT slug, game_count, updated_at
      FROM events
      ORDER BY id
      LIMIT ${limit} OFFSET ${offset}
    `;
    return rows.map((r) => ({
      slug: r.slug as string,
      gameCount: r.game_count as number,
      updatedAt: new Date(r.updated_at as string),
    }));
  } catch {
    return [];
  }
}

/**
 * Generate a URL-safe slug from an event name.
 */
export function generateEventSlug(eventName: string): string {
  return eventName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
}

/**
 * Upsert a cached online profile.
 */
export async function upsertOnlineProfile(
  platform: string,
  username: string,
  profile: unknown,
  gameCount: number,
  newestGameTs: number | null,
): Promise<void> {
  if (!HAS_POSTGRES) return;
  try {
    const u = username.toLowerCase();
    const profileStr = JSON.stringify(profile);
    await sql`
      INSERT INTO online_profiles (platform, username, profile_json, game_count, newest_game_ts, updated_at)
      VALUES (${platform}, ${u}, ${profileStr}::jsonb, ${gameCount}, ${newestGameTs}, NOW())
      ON CONFLICT (platform, username)
      DO UPDATE SET
        profile_json = ${profileStr}::jsonb,
        game_count = ${gameCount},
        newest_game_ts = ${newestGameTs},
        updated_at = NOW()
    `;
  } catch {
    // Non-fatal: cache write failure shouldn't break the app
  }
}

// ─── FIDE profile cache ─────────────────────────────────────────────────────

interface FideProfileRow {
  profileJson: unknown;
  gameCount: number;
  month: string;
}

export async function getFideProfile(
  slug: string,
  month: string,
): Promise<FideProfileRow | null> {
  if (!HAS_POSTGRES) return null;
  try {
    const { rows } = await sql`
      SELECT profile_json, game_count, month
      FROM fide_profiles
      WHERE slug = ${slug} AND month = ${month}
    `;
    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      profileJson: jsonb(row.profile_json, null),
      gameCount: row.game_count as number,
      month: row.month as string,
    };
  } catch {
    return null;
  }
}

export async function getLatestFideProfile(
  slug: string,
): Promise<FideProfileRow | null> {
  if (!HAS_POSTGRES) return null;
  try {
    const { rows } = await sql`
      SELECT profile_json, game_count, month
      FROM fide_profiles
      WHERE slug = ${slug}
      ORDER BY month DESC
      LIMIT 1
    `;
    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      profileJson: jsonb(row.profile_json, null),
      gameCount: row.game_count as number,
      month: row.month as string,
    };
  } catch {
    return null;
  }
}

export async function upsertFideProfile(
  slug: string,
  month: string,
  profile: unknown,
  gameCount: number,
): Promise<void> {
  if (!HAS_POSTGRES) return;
  try {
    const profileStr = JSON.stringify(profile);
    await sql`
      INSERT INTO fide_profiles (slug, month, profile_json, game_count, updated_at)
      VALUES (${slug}, ${month}, ${profileStr}::jsonb, ${gameCount}, NOW())
      ON CONFLICT (slug, month)
      DO UPDATE SET
        profile_json = ${profileStr}::jsonb,
        game_count = ${gameCount},
        updated_at = NOW()
    `;
  } catch {
    // Non-fatal: cache write failure shouldn't break the app
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

function mapRowToGameDetail(row: Record<string, unknown>): GameDetail & { eventSlug: string | null } {
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
    eventSlug: (row.event_slug as string) ?? null,
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
