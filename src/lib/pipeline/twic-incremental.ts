/**
 * Lightweight incremental TWIC processing for serverless execution.
 *
 * Downloads one new TWIC issue, parses it in memory, then updates games,
 * player stats, and events directly in Postgres. No disk I/O required.
 *
 * This does NOT replace the full CLI pipeline — it supplements it with
 * daily, retryable updates via Vercel cron.
 */

import { sql, sqlTransaction } from "@/lib/db/connection";
import { assignEventSlugs } from "@/lib/event-slug";
import { downloadAndExtractPgn } from "./pgn-extract";
import { hasExcludedFideId } from "@/lib/player-exclusions";

// We inline minimal game logic to avoid importing packages with heavy dependencies.

export interface ParsedGame {
  white: string;
  black: string;
  whiteElo: number | null;
  blackElo: number | null;
  whiteTitle: string | null;
  blackTitle: string | null;
  whiteFideId: string | null;
  blackFideId: string | null;
  eco: string | null;
  opening: string | null;
  variation: string | null;
  event: string | null;
  site: string | null;
  date: string | null;
  round: string | null;
  result: string;
  pgn: string;
}

function extractHeaders(pgn: string): Record<string, string> {
  const headers: Record<string, string> = {};
  const regex = /\[(\w+)\s+"([^"]*)"\]/g;
  let match;
  while ((match = regex.exec(pgn)) !== null) {
    headers[match[1]] = match[2];
  }
  return headers;
}

export function splitPGN(pgnText: string): string[] {
  const games: string[] = [];
  const parts = pgnText.split(/\n\n(?=\[Event )/);
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed) games.push(trimmed);
  }
  return games.length > 0 ? games : [pgnText.trim()].filter(Boolean);
}

export function parseElo(elo: string | undefined): number | null {
  if (!elo || elo === "-" || elo === "0" || elo === "") return null;
  const n = parseInt(elo, 10);
  return isNaN(n) || n < 100 ? null : n;
}

export function parseFideId(id: string | undefined): string | null {
  if (!id || id === "0" || id === "" || id === "-") return null;
  const trimmed = id.trim();
  return /^\d+$/.test(trimmed) ? trimmed : null;
}

export function parseTitle(title: string | undefined): string | null {
  if (!title || title === "-" || title === "") return null;
  const valid = ["GM", "IM", "FM", "CM", "NM", "WGM", "WIM", "WFM", "WCM"];
  const upper = title.toUpperCase().trim();
  return valid.includes(upper) ? upper : null;
}

export function parseGames(pgnText: string): ParsedGame[] {
  const rawGames = splitPGN(pgnText);
  const results: ParsedGame[] = [];

  for (const rawPgn of rawGames) {
    const h = extractHeaders(rawPgn);

    const white = h["White"] || "";
    const black = h["Black"] || "";
    const result = h["Result"] || "*";

    if (!white || !black || white === "?" || black === "?") continue;
    if (result === "*") continue;

    const whiteElo = parseElo(h["WhiteElo"]);
    const blackElo = parseElo(h["BlackElo"]);
    if (whiteElo === null && blackElo === null) continue;

    const whiteFideId = parseFideId(h["WhiteFideId"]);
    const blackFideId = parseFideId(h["BlackFideId"]);
    if (hasExcludedFideId(whiteFideId, blackFideId)) continue;

    results.push({
      white,
      black,
      whiteElo,
      blackElo,
      whiteTitle: parseTitle(h["WhiteTitle"]),
      blackTitle: parseTitle(h["BlackTitle"]),
      whiteFideId,
      blackFideId,
      eco: h["ECO"] || null,
      opening: h["Opening"] || null,
      variation: h["Variation"] || null,
      event: h["Event"] || null,
      site: h["Site"] || null,
      date: h["Date"] || null,
      round:
        h["Round"] && h["Round"] !== "?" && h["Round"] !== "-"
          ? h["Round"]
          : null,
      result,
      pgn: rawPgn,
    });
  }

  return results;
}

function slugify(str: string): string {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function parseNameParts(name: string): { lastName: string; firstName: string } {
  const commaIdx = name.indexOf(",");
  if (commaIdx === -1) return { lastName: name.trim(), firstName: "" };
  return {
    lastName: name.slice(0, commaIdx).trim(),
    firstName: name.slice(commaIdx + 1).trim(),
  };
}

export function generateGameSlug(game: ParsedGame): string {
  const { lastName: wLast } = parseNameParts(game.white);
  const { lastName: bLast } = parseNameParts(game.black);
  const matchup = slugify(
    `${wLast} ${game.whiteFideId} vs ${bLast} ${game.blackFideId}`,
  );

  if (game.event && game.date) {
    const year = game.date.split(".")[0] || "";
    const eventWords = game.event.split(/\s+/).slice(0, 6).join(" ");
    const eventParts = [eventWords];
    if (game.round) {
      eventParts.push("r" + game.round.replace(/\./g, "-"));
    }
    if (year) eventParts.push(year);
    return `${slugify(eventParts.join(" "))}/${matchup}`;
  }

  return matchup;
}

export function generatePlayerSlug(name: string, fideId: string): string {
  const { lastName, firstName } = parseNameParts(name);
  if (firstName) return slugify(`${firstName} ${lastName} ${fideId}`);
  return slugify(`${lastName} ${fideId}`);
}

/**
 * Get the last successfully processed TWIC issue number.
 */
export async function getLastProcessedIssue(): Promise<number | null> {
  const { rows } = await sql`
    SELECT identifier FROM pipeline_runs
    WHERE run_type = 'twic' AND status = 'completed'
    ORDER BY identifier::int DESC
    LIMIT 1
  `;
  return rows.length > 0 ? parseInt(rows[0].identifier as string) : null;
}

/**
 * Check if a TWIC issue exists by trying a HEAD request.
 */
async function twicIssueExists(issue: number): Promise<boolean> {
  const response = await fetch(
    `https://theweekinchess.com/zips/twic${issue}g.zip`,
    { method: "HEAD" },
  );

  if (response.status === 404) return false;
  if (!response.ok) {
    throw new Error(`TWIC returned HTTP ${response.status}`);
  }
  return true;
}

/**
 * Process new TWIC issues incrementally.
 * Each issue is only marked complete after games, player stats, and events sync.
 */
export async function processIncrementalTwic(
  maxIssues: number = 1,
): Promise<IncrementalTwicResult> {
  const lastIssue = await getLastProcessedIssue();
  if (lastIssue === null) {
    return {
      issuesProcessed: 0,
      gamesUpserted: 0,
      playersUpdated: 0,
      eventsUpserted: 0,
      gamesLinked: 0,
      errors: [
        "No previous TWIC issues found. Run the full pipeline first: npm run fide-pipeline -- full",
      ],
    };
  }

  const result: IncrementalTwicResult = {
    issuesProcessed: 0,
    gamesUpserted: 0,
    playersUpdated: 0,
    eventsUpserted: 0,
    gamesLinked: 0,
    errors: [],
  };
  let issuesAttempted = 0;

  for (let offset = 1; offset <= Math.max(0, Math.floor(maxIssues)); offset++) {
    const issue = lastIssue + offset;
    console.log(`[twic] Checking TWIC ${issue}...`);

    let exists: boolean;
    try {
      exists = await twicIssueExists(issue);
    } catch (error) {
      result.errors.push(`Failed to check TWIC ${issue}: ${errorMessage(error)}`);
      break;
    }

    if (!exists) {
      console.log(`[twic] TWIC ${issue} not found — stopping.`);
      break;
    }

    issuesAttempted++;
    const startedAt = Date.now();

    try {
      await startTwicRun(issue);
      const issueResult = await processTwicIssue(issue);
      const eventResult = await syncUnlinkedEvents();
      const durationMs = Date.now() - startedAt;

      await completeTwicRun(issue, {
        ...issueResult,
        ...eventResult,
        durationMs,
      });

      result.issuesProcessed++;
      result.gamesUpserted += issueResult.gamesUpserted;
      result.playersUpdated += issueResult.playersUpdated;
      result.eventsUpserted += eventResult.eventsUpserted;
      result.gamesLinked += eventResult.gamesLinked;

      console.log(
        `[twic] TWIC ${issue} complete in ${durationMs}ms — ` +
          `${issueResult.gamesUpserted} games inserted, ${eventResult.gamesLinked} games linked`,
      );
    } catch (error) {
      const message = errorMessage(error);
      await failTwicRun(issue, message, Date.now() - startedAt);
      result.errors.push(`TWIC ${issue} failed: ${message}`);
      console.error(`[twic] TWIC ${issue} failed: ${message}`);
      break;
    }
  }

  // Keep event linkage self-healing even when no new TWIC issue is available.
  if (issuesAttempted === 0 && result.errors.length === 0) {
    try {
      const eventResult = await syncUnlinkedEvents();
      result.eventsUpserted += eventResult.eventsUpserted;
      result.gamesLinked += eventResult.gamesLinked;
    } catch (error) {
      result.errors.push(`Event sync failed: ${errorMessage(error)}`);
    }
  }

  return result;
}

export interface IncrementalTwicResult {
  issuesProcessed: number;
  gamesUpserted: number;
  playersUpdated: number;
  eventsUpserted: number;
  gamesLinked: number;
  errors: string[];
}

export interface EventSyncResult {
  eventsUpserted: number;
  gamesLinked: number;
}

interface TwicIssueResult {
  gamesUpserted: number;
  playersUpdated: number;
}

interface GameRow {
  slug: string;
  white_name: string;
  black_name: string;
  white_slug: string;
  black_slug: string;
  white_fide_id: string;
  black_fide_id: string;
  white_elo: number;
  black_elo: number;
  white_title: string | null;
  black_title: string | null;
  event: string;
  site: string | null;
  date: string;
  round: string | null;
  eco: string | null;
  opening: string | null;
  variation: string | null;
  result: string;
  pgn: string;
}

interface EventAggregate {
  name: string;
  slug: string;
  site: string | null;
  dateStart: string;
  dateEnd: string;
  gameCount: number;
  avgElo: number | null;
}

async function processTwicIssue(issue: number): Promise<TwicIssueResult> {
  console.log(`[twic] Downloading TWIC ${issue}...`);
  const downloadStartedAt = Date.now();
  const pgnText = await downloadAndExtractPgn(issue);
  if (!pgnText) {
    throw new Error(`Failed to download or extract TWIC ${issue}`);
  }
  console.log(
    `[twic] Downloaded TWIC ${issue} in ${Date.now() - downloadStartedAt}ms`,
  );

  const games = parseGames(pgnText);
  if (games.length === 0) {
    throw new Error(`TWIC ${issue} contained no usable games`);
  }
  console.log(`[twic] Parsed ${games.length} games from TWIC ${issue}`);

  const fideIds = collectFideIds(games);
  const playerSlugs = await getPlayerSlugs(fideIds);
  const rows = buildGameRows(games, playerSlugs);
  const gamesUpserted = await insertGames(rows);
  const playersUpdated = await updatePlayerStats([...fideIds]);

  return { gamesUpserted, playersUpdated };
}

function collectFideIds(games: ParsedGame[]): Set<string> {
  const fideIds = new Set<string>();

  for (const game of games) {
    if (
      !game.whiteFideId ||
      !game.blackFideId ||
      !game.event ||
      !game.date ||
      hasExcludedFideId(game.whiteFideId, game.blackFideId)
    ) {
      continue;
    }

    fideIds.add(game.whiteFideId);
    fideIds.add(game.blackFideId);
  }

  return fideIds;
}

async function getPlayerSlugs(fideIds: Set<string>): Promise<Map<string, string>> {
  if (fideIds.size === 0) return new Map();

  console.log(`[twic] Looking up ${fideIds.size} unique FIDE IDs...`);
  const { rows } = await sql`
    SELECT fide_id, slug
    FROM players
    WHERE fide_id = ANY(${[...fideIds]})
  `;

  return new Map(
    rows.map((row) => [row.fide_id as string, row.slug as string]),
  );
}

function buildGameRows(
  games: ParsedGame[],
  playerSlugs: Map<string, string>,
): GameRow[] {
  const rows: GameRow[] = [];
  const seenSlugs = new Map<string, number>();

  for (const game of games) {
    if (
      !game.whiteFideId ||
      !game.blackFideId ||
      !game.event ||
      !game.date ||
      hasExcludedFideId(game.whiteFideId, game.blackFideId)
    ) {
      continue;
    }

    let slug = generateGameSlug(game);
    const slugCount = (seenSlugs.get(slug) ?? 0) + 1;
    seenSlugs.set(slug, slugCount);
    if (slugCount > 1) slug = `${slug}-${slugCount}`;

    rows.push({
      slug,
      white_name: game.white,
      black_name: game.black,
      white_slug:
        playerSlugs.get(game.whiteFideId) ??
        generatePlayerSlug(game.white, game.whiteFideId),
      black_slug:
        playerSlugs.get(game.blackFideId) ??
        generatePlayerSlug(game.black, game.blackFideId),
      white_fide_id: game.whiteFideId,
      black_fide_id: game.blackFideId,
      white_elo: game.whiteElo ?? 0,
      black_elo: game.blackElo ?? 0,
      white_title: game.whiteTitle,
      black_title: game.blackTitle,
      event: game.event,
      site: game.site,
      date: game.date.replace(/\./g, "-"),
      round: game.round,
      eco: game.eco,
      opening: game.opening,
      variation: game.variation,
      result: game.result,
      pgn: game.pgn,
    });
  }

  return rows;
}

async function insertGames(rows: GameRow[]): Promise<number> {
  const batchSize = 500;
  let gamesInserted = 0;

  console.log(`[twic] Inserting ${rows.length} games...`);
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    const batchNumber = Math.floor(offset / batchSize) + 1;
    const totalBatches = Math.ceil(rows.length / batchSize);
    const batchStartedAt = Date.now();

    const { rows: countRows } = await sql`
      WITH inserted AS (
        INSERT INTO games (
          slug, white_name, black_name, white_slug, black_slug,
          white_fide_id, black_fide_id, white_elo, black_elo,
          white_title, black_title,
          event, site, date, round, eco, opening, variation, result, pgn
        )
        SELECT
          slug, white_name, black_name, white_slug, black_slug,
          white_fide_id, black_fide_id, white_elo, black_elo,
          white_title, black_title,
          event, site, date::date, round, eco, opening, variation, result, pgn
        FROM unnest(
          ${batch.map((row) => row.slug)}::text[],
          ${batch.map((row) => row.white_name)}::text[],
          ${batch.map((row) => row.black_name)}::text[],
          ${batch.map((row) => row.white_slug)}::text[],
          ${batch.map((row) => row.black_slug)}::text[],
          ${batch.map((row) => row.white_fide_id)}::text[],
          ${batch.map((row) => row.black_fide_id)}::text[],
          ${batch.map((row) => row.white_elo)}::int[],
          ${batch.map((row) => row.black_elo)}::int[],
          ${batch.map((row) => row.white_title)}::text[],
          ${batch.map((row) => row.black_title)}::text[],
          ${batch.map((row) => row.event)}::text[],
          ${batch.map((row) => row.site)}::text[],
          ${batch.map((row) => row.date)}::text[],
          ${batch.map((row) => row.round)}::text[],
          ${batch.map((row) => row.eco)}::text[],
          ${batch.map((row) => row.opening)}::text[],
          ${batch.map((row) => row.variation)}::text[],
          ${batch.map((row) => row.result)}::text[],
          ${batch.map((row) => row.pgn)}::text[]
        ) AS source(
          slug, white_name, black_name, white_slug, black_slug,
          white_fide_id, black_fide_id, white_elo, black_elo,
          white_title, black_title,
          event, site, date, round, eco, opening, variation, result, pgn
        )
        ON CONFLICT (slug) DO NOTHING
        RETURNING 1
      )
      SELECT COUNT(*)::int AS count FROM inserted
    `;

    gamesInserted += Number(countRows[0]?.count ?? 0);
    console.log(
      `[twic]   batch ${batchNumber}/${totalBatches} completed in ` +
        `${Date.now() - batchStartedAt}ms`,
    );
  }

  return gamesInserted;
}

async function updatePlayerStats(fideIds: string[]): Promise<number> {
  if (fideIds.length === 0) return 0;

  console.log(`[twic] Updating stats for ${fideIds.length} players...`);
  const { rows } = await sql`
    WITH stats AS (
      SELECT fide_id, COUNT(*)::int AS game_count, MAX(date) AS last_seen
      FROM (
        SELECT white_fide_id AS fide_id, date
        FROM games
        WHERE white_fide_id = ANY(${fideIds})
        UNION ALL
        SELECT black_fide_id AS fide_id, date
        FROM games
        WHERE black_fide_id = ANY(${fideIds})
      ) player_games
      GROUP BY fide_id
    ), updated AS (
      UPDATE players p
      SET game_count = stats.game_count,
          last_seen = GREATEST(p.last_seen, stats.last_seen),
          updated_at = NOW()
      FROM stats
      WHERE p.fide_id = stats.fide_id
      RETURNING 1
    )
    SELECT COUNT(*)::int AS count FROM updated
  `;

  return Number(rows[0]?.count ?? 0);
}

/** Aggregate and link every currently-unlinked event in two bulk writes. */
export async function syncUnlinkedEvents(): Promise<EventSyncResult> {
  console.log("[twic] Syncing unlinked events...");
  const { rows: pendingRows } = await sql`
    SELECT DISTINCT event
    FROM games
    WHERE event_slug IS NULL AND event != ''
  `;

  if (pendingRows.length === 0) {
    console.log("[twic] Event linkage is already current");
    return { eventsUpserted: 0, gamesLinked: 0 };
  }

  // Keep this separate from the pending-events query so Postgres uses
  // idx_games_event instead of scanning the entire games table for a join.
  const pendingNames = pendingRows.map((row) => row.event as string);
  const { rows: aggregateRows } = await sql`
    SELECT
      event AS name,
      MIN(site) AS site,
      MIN(date) AS date_start,
      MAX(date) AS date_end,
      COUNT(*)::int AS game_count,
      (AVG(avg_elo))::smallint AS avg_elo
    FROM games
    WHERE event = ANY(${pendingNames})
    GROUP BY event
  `;
  const { rows: existingEvents } = await sql`SELECT name, slug FROM events`;
  const slugs = assignEventSlugs(
    aggregateRows.map((row) => row.name as string),
    existingEvents.map((row) => ({
      name: row.name as string,
      slug: row.slug as string,
    })),
  );
  const events = aggregateRows.map((row): EventAggregate => {
    const name = row.name as string;
    return {
      name,
      slug: slugs.get(name)!,
      site: (row.site as string) ?? null,
      dateStart: toSqlDate(row.date_start),
      dateEnd: toSqlDate(row.date_end),
      gameCount: Number(row.game_count),
      avgElo: row.avg_elo == null ? null : Number(row.avg_elo),
    };
  });

  const result = await sqlTransaction(async (tx) => {
    const [upsertCount] = await tx`
      WITH upserted AS (
        INSERT INTO events (
          slug, name, site, date_start, date_end, game_count, avg_elo, updated_at
        )
        SELECT
          slug, name, site, date_start, date_end, game_count, avg_elo, NOW()
        FROM unnest(
          ${events.map((event) => event.slug)}::text[],
          ${events.map((event) => event.name)}::text[],
          ${events.map((event) => event.site)}::text[],
          ${events.map((event) => event.dateStart)}::date[],
          ${events.map((event) => event.dateEnd)}::date[],
          ${events.map((event) => event.gameCount)}::int[],
          ${events.map((event) => event.avgElo)}::smallint[]
        ) AS source(
          slug, name, site, date_start, date_end, game_count, avg_elo
        )
        ON CONFLICT (slug) DO UPDATE SET
          name = EXCLUDED.name,
          site = EXCLUDED.site,
          date_start = EXCLUDED.date_start,
          date_end = EXCLUDED.date_end,
          game_count = EXCLUDED.game_count,
          avg_elo = EXCLUDED.avg_elo,
          updated_at = NOW()
        RETURNING 1
      )
      SELECT COUNT(*)::int AS count FROM upserted
    `;

    const [linkCount] = await tx`
      WITH linked AS (
        UPDATE games
        SET event_slug = source.slug
        FROM unnest(
          ${events.map((event) => event.name)}::text[],
          ${events.map((event) => event.slug)}::text[]
        ) AS source(name, slug)
        WHERE games.event = source.name
          AND games.event_slug IS DISTINCT FROM source.slug
        RETURNING 1
      )
      SELECT COUNT(*)::int AS count FROM linked
    `;

    return {
      eventsUpserted: Number(upsertCount?.count ?? 0),
      gamesLinked: Number(linkCount?.count ?? 0),
    };
  });

  console.log(
    `[twic] Synced ${result.eventsUpserted} events and linked ${result.gamesLinked} games`,
  );
  return result;
}

async function startTwicRun(issue: number): Promise<void> {
  await sql`
    INSERT INTO pipeline_runs (
      run_type, identifier, status, started_at, completed_at, metadata
    )
    VALUES ('twic', ${String(issue)}, 'running', NOW(), NULL, '{}'::jsonb)
    ON CONFLICT (run_type, identifier) DO UPDATE SET
      status = 'running',
      started_at = NOW(),
      completed_at = NULL,
      metadata = '{}'::jsonb
  `;
}

async function completeTwicRun(
  issue: number,
  metadata: Record<string, number>,
): Promise<void> {
  await sql`
    UPDATE pipeline_runs
    SET status = 'completed',
        completed_at = NOW(),
        metadata = ${JSON.stringify(metadata)}::jsonb
    WHERE run_type = 'twic' AND identifier = ${String(issue)}
  `;
}

async function failTwicRun(
  issue: number,
  error: string,
  durationMs: number,
): Promise<void> {
  try {
    await sql`
      INSERT INTO pipeline_runs (
        run_type, identifier, status, started_at, completed_at, metadata
      )
      VALUES (
        'twic', ${String(issue)}, 'failed', NOW(), NOW(),
        ${JSON.stringify({ error, durationMs })}::jsonb
      )
      ON CONFLICT (run_type, identifier) DO UPDATE SET
        status = 'failed',
        completed_at = NOW(),
        metadata = ${JSON.stringify({ error, durationMs })}::jsonb
    `;
  } catch (recordError) {
    console.error(
      `[twic] Failed to record TWIC ${issue} failure: ${errorMessage(recordError)}`,
    );
  }
}

function toSqlDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string" && value.length >= 10) return value.slice(0, 10);
  throw new Error(`Invalid event date: ${String(value)}`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
