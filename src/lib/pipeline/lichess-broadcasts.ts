/**
 * Lichess broadcast game ingestion pipeline.
 *
 * Discovers broadcasts via the Lichess API, fetches round PGNs,
 * and upserts games into Postgres with 4-layer deduplication.
 *
 * TWIC is the preferred source: when a Lichess game matches an
 * existing TWIC game, only Lichess-specific metadata is added —
 * the TWIC PGN, player names, event name, and result are preserved.
 */

import { createHash } from "node:crypto";
import { sql } from "@/lib/db/connection";
import {
  splitPGN,
  extractHeaders,
  parseElo,
  parseFideId,
  parseTitle,
  generateGameSlug,
  generatePlayerSlug,
  type ParsedGame,
} from "./twic-incremental";
import {
  LichessBroadcastApi,
  type BroadcastListingEntry,
} from "@/lib/lichess-broadcast-api";

// ─── Move normalization & fingerprinting ────────────────────────────────────

/**
 * Extract move text from a raw PGN string (strips headers).
 */
export function extractMoveText(pgn: string): string {
  // Find the first blank line after headers — moves start after that
  const headerEnd = pgn.search(/\n\n(?!\[)/);
  if (headerEnd === -1) {
    // No blank line found — try splitting on first non-header line
    const lines = pgn.split("\n");
    const firstNonHeader = lines.findIndex(
      (l) => l.trim() !== "" && !l.startsWith("["),
    );
    if (firstNonHeader === -1) return "";
    return lines.slice(firstNonHeader).join(" ");
  }
  return pgn.slice(headerEnd + 2);
}

/**
 * Aggressively normalize move text so the same game from any source
 * produces identical output.
 *
 * 1. Strip comments: {[%clk ...]} {[%eval ...]} {text}
 * 2. Strip NAGs: $1, $2, etc.
 * 3. Strip move numbers: 1. 1... 42.
 * 4. Strip result token: 1-0 0-1 1/2-1/2 *
 * 5. Collapse whitespace
 */
export function normalizeMoves(moveText: string): string {
  return moveText
    .replace(/\{[^}]*\}/g, "") // strip comments
    .replace(/\$\d+/g, "") // strip NAGs
    .replace(/\d+\.+\s*/g, "") // strip move numbers (1. 1... 42.)
    .replace(/\s*(1-0|0-1|1\/2-1\/2|\*)\s*$/, "") // strip result
    .replace(/\s+/g, " ") // collapse whitespace
    .trim();
}

/**
 * Compute content fingerprint: SHA-256 of date|whiteFideId|blackFideId|normalizedMoves.
 * Result is EXCLUDED so partial games match their completed versions.
 */
export function computeFingerprint(
  utcDate: string,
  whiteFideId: string,
  blackFideId: string,
  normalizedMoves: string,
): string {
  const input = `${utcDate}|${whiteFideId}|${blackFideId}|${normalizedMoves}`;
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Count the number of SAN moves in normalized move text.
 */
export function countMoves(normalizedMoves: string): number {
  if (!normalizedMoves) return 0;
  return normalizedMoves.split(/\s+/).filter(Boolean).length;
}

/**
 * Extract Lichess chapter ID (source key) from GameURL header.
 * e.g. "https://lichess.org/broadcast/.../round-2/FRTlzP2X/q1PvC2Uo" → "q1PvC2Uo"
 */
export function extractSourceKey(gameUrl: string | null): string | null {
  if (!gameUrl) return null;
  const parts = gameUrl.split("/");
  const last = parts[parts.length - 1];
  // Chapter IDs are 8-char alphanumeric
  return last && /^[A-Za-z0-9]{8}$/.test(last) ? last : null;
}

/**
 * Extract broadcast round ID from BroadcastURL header.
 * e.g. "https://lichess.org/broadcast/.../round-2/FRTlzP2X" → "FRTlzP2X"
 */
function extractRoundId(broadcastUrl: string | null): string | null {
  if (!broadcastUrl) return null;
  const parts = broadcastUrl.split("/");
  const last = parts[parts.length - 1];
  return last && /^[A-Za-z0-9]{8}$/.test(last) ? last : null;
}

/**
 * Extract broadcast tournament ID from BroadcastURL or GameURL.
 * The tournament ID is typically the segment before the round slug.
 * e.g. "https://lichess.org/broadcast/fide-candidates-2026-open/round-2/FRTlzP2X" → extracted from API
 *
 * We don't parse it from URLs — it's set from the discovery phase.
 */

// ─── Broadcast PGN parsing ──────────────────────────────────────────────────

export interface ParsedBroadcastGame extends ParsedGame {
  timeControl: string | null;
  board: string | null;
  utcDate: string | null;
  utcTime: string | null;
  broadcastName: string | null;
  broadcastUrl: string | null;
  gameUrl: string | null;
  studyName: string | null;
  chapterName: string | null;
  normalizedMoves: string;
  moveCount: number;
  sourceKey: string | null;
  fingerprint: string | null;
  broadcastId: string | null; // set from context, not PGN
  roundId: string | null; // set from context or parsed from BroadcastURL
}

/**
 * Parse broadcast PGN text into structured games.
 * Rejects games where both players lack FIDE IDs.
 */
export function parseBroadcastGames(
  pgnText: string,
  broadcastId: string | null = null,
): ParsedBroadcastGame[] {
  const rawGames = splitPGN(pgnText);
  const results: ParsedBroadcastGame[] = [];

  for (const rawPgn of rawGames) {
    const h = extractHeaders(rawPgn);

    const white = h["White"] || "";
    const black = h["Black"] || "";
    const result = h["Result"] || "*";

    if (!white || !black || white === "?" || black === "?") continue;

    const whiteElo = parseElo(h["WhiteElo"]);
    const blackElo = parseElo(h["BlackElo"]);

    const whiteFideId = parseFideId(h["WhiteFideId"]);
    const blackFideId = parseFideId(h["BlackFideId"]);

    // Reject games where both players lack FIDE IDs
    if (!whiteFideId && !blackFideId) continue;

    // Extract and normalize moves
    const moveText = extractMoveText(rawPgn);
    const normalizedMoves = normalizeMoves(moveText);
    const moveCount = countMoves(normalizedMoves);

    // Compute dedup keys
    const gameUrl = h["GameURL"] || null;
    const sourceKey = extractSourceKey(gameUrl);
    const broadcastUrl = h["BroadcastURL"] || null;
    const roundId = extractRoundId(broadcastUrl);

    const utcDate = h["UTCDate"] || h["Date"] || null;
    const fingerprint =
      utcDate && (whiteFideId || blackFideId) && normalizedMoves
        ? computeFingerprint(
            utcDate,
            whiteFideId || "0",
            blackFideId || "0",
            normalizedMoves,
          )
        : null;

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
      timeControl: h["TimeControl"] || null,
      board: h["Board"] || null,
      utcDate,
      utcTime: h["UTCTime"] || null,
      broadcastName: h["BroadcastName"] || null,
      broadcastUrl,
      gameUrl,
      studyName: h["StudyName"] || null,
      chapterName: h["ChapterName"] || null,
      normalizedMoves,
      moveCount,
      sourceKey,
      fingerprint,
      broadcastId,
      roundId,
    });
  }

  return results;
}

// ─── 4-layer dedup upsert ───────────────────────────────────────────────────

type UpsertResult = "inserted" | "updated" | "skipped";

/**
 * Enrich an existing game with Lichess metadata.
 * If the existing game is from TWIC (or legacy NULL source), only add
 * Lichess-specific fields — never overwrite TWIC core data.
 */
async function enrichExisting(
  existingId: number,
  existingSource: string | null,
  game: ParsedBroadcastGame,
  source: "api" | "bulk",
): Promise<void> {
  if (existingSource === "twic" || existingSource === null) {
    // TWIC is authoritative — only add Lichess-specific metadata
    await sql`
      UPDATE games SET
        source_key = COALESCE(source_key, ${game.sourceKey}),
        broadcast_id = COALESCE(broadcast_id, ${game.broadcastId}),
        round_id = COALESCE(round_id, ${game.roundId}),
        game_url = COALESCE(game_url, ${game.gameUrl}),
        time_control = COALESCE(time_control, ${game.timeControl}),
        board = COALESCE(board, ${game.board}),
        utc_time = COALESCE(utc_time, ${game.utcTime}),
        content_fingerprint = COALESCE(content_fingerprint, ${game.fingerprint}),
        move_count = COALESCE(move_count, ${game.moveCount}::smallint)
      WHERE id = ${existingId}
    `;
  } else {
    // Existing is also from Lichess — update mutable fields
    await sql`
      UPDATE games SET
        result = ${game.result},
        pgn = ${game.pgn},
        move_count = ${game.moveCount}::smallint,
        source_key = COALESCE(source_key, ${game.sourceKey}),
        broadcast_id = COALESCE(broadcast_id, ${game.broadcastId}),
        round_id = COALESCE(round_id, ${game.roundId}),
        game_url = COALESCE(game_url, ${game.gameUrl}),
        time_control = COALESCE(time_control, ${game.timeControl}),
        board = COALESCE(board, ${game.board}),
        utc_time = COALESCE(utc_time, ${game.utcTime}),
        content_fingerprint = COALESCE(content_fingerprint, ${game.fingerprint}),
        source = COALESCE(source, ${source})
      WHERE id = ${existingId}
    `;
  }
}

/**
 * Upsert a single broadcast game using 4-layer deduplication.
 */
export async function upsertBroadcastGame(
  game: ParsedBroadcastGame,
  source: "api" | "bulk",
  playerSlugs: Map<string, string>,
  seenSlugs: Map<string, number>,
): Promise<UpsertResult> {
  // Layer 1: source_key match (same Lichess game, re-fetched)
  if (game.sourceKey) {
    const { rows } = await sql`
      SELECT id, source FROM games WHERE source_key = ${game.sourceKey}
    `;
    if (rows.length > 0) {
      await enrichExisting(
        rows[0].id as number,
        rows[0].source as string | null,
        game,
        source,
      );
      return "updated";
    }
  }

  // Layer 2: content fingerprint match (same game from TWIC or another source)
  if (game.fingerprint && (game.whiteFideId || game.blackFideId)) {
    const { rows } = await sql`
      SELECT id, source FROM games
      WHERE content_fingerprint = ${game.fingerprint}
      LIMIT 1
    `;
    if (rows.length > 0) {
      await enrichExisting(
        rows[0].id as number,
        rows[0].source as string | null,
        game,
        source,
      );
      return "updated";
    }
  }

  // Layer 3: structural match — date + FIDE IDs + similar move count
  if (game.whiteFideId && game.blackFideId && game.date) {
    const sqlDate = game.date.replace(/\./g, "-");
    const { rows } = await sql`
      SELECT id, source, move_count FROM games
      WHERE date = ${sqlDate}::date
        AND (
          (white_fide_id = ${game.whiteFideId} AND black_fide_id = ${game.blackFideId})
          OR (white_fide_id = ${game.blackFideId} AND black_fide_id = ${game.whiteFideId})
        )
      LIMIT 5
    `;
    for (const existing of rows) {
      const existingMoves = (existing.move_count as number) || 0;
      if (
        existingMoves > 0 &&
        game.moveCount > 0 &&
        Math.abs(game.moveCount - existingMoves) /
          Math.max(game.moveCount, existingMoves) <
          0.1
      ) {
        console.warn(
          `[lichess] Structural dedup: Lichess game (${game.whiteFideId} vs ${game.blackFideId} ${game.date}) matches existing id=${existing.id} (source=${existing.source})`,
        );
        await enrichExisting(
          existing.id as number,
          existing.source as string | null,
          game,
          source,
        );
        return "updated";
      }
    }
  }

  // No match — insert new game
  if (!game.event || !game.date) return "skipped";

  let slug = generateGameSlug(game);
  const count = (seenSlugs.get(slug) ?? 0) + 1;
  seenSlugs.set(slug, count);
  if (count > 1) slug = `${slug}-${count}`;

  const whiteSlug =
    (game.whiteFideId && playerSlugs.get(game.whiteFideId)) ||
    (game.whiteFideId
      ? generatePlayerSlug(game.white, game.whiteFideId)
      : null);
  const blackSlug =
    (game.blackFideId && playerSlugs.get(game.blackFideId)) ||
    (game.blackFideId
      ? generatePlayerSlug(game.black, game.blackFideId)
      : null);

  const sqlDate = game.date.replace(/\./g, "-");

  try {
    await sql`
      INSERT INTO games (
        slug, white_name, black_name, white_slug, black_slug,
        white_fide_id, black_fide_id, white_elo, black_elo,
        white_title, black_title,
        event, site, date, round, eco, opening, variation, result, pgn,
        source, source_key, content_fingerprint, move_count,
        broadcast_id, round_id, time_control, board, utc_time, game_url
      ) VALUES (
        ${slug}, ${game.white}, ${game.black}, ${whiteSlug}, ${blackSlug},
        ${game.whiteFideId || "0"}, ${game.blackFideId || "0"},
        ${game.whiteElo ?? 0}, ${game.blackElo ?? 0},
        ${game.whiteTitle}, ${game.blackTitle},
        ${game.event}, ${game.site}, ${sqlDate}::date, ${game.round},
        ${game.eco}, ${game.opening}, ${game.variation},
        ${game.result}, ${game.pgn},
        ${source}, ${game.sourceKey}, ${game.fingerprint}, ${game.moveCount}::smallint,
        ${game.broadcastId}, ${game.roundId}, ${game.timeControl},
        ${game.board}, ${game.utcTime}, ${game.gameUrl}
      )
      ON CONFLICT (slug) DO NOTHING
    `;
    return "inserted";
  } catch {
    return "skipped";
  }
}

// ─── Broadcast discovery ────────────────────────────────────────────────────

interface DiscoveryResult {
  broadcastsDiscovered: number;
  roundsDiscovered: number;
  pagesScanned: number;
}

/**
 * Discover new broadcasts by paginating the Lichess broadcast listing.
 * Inserts new broadcasts and their rounds into tracking tables.
 */
async function discoverBroadcasts(
  api: LichessBroadcastApi,
  deadline: number,
): Promise<DiscoveryResult> {
  let broadcastsDiscovered = 0;
  let roundsDiscovered = 0;
  let pagesScanned = 0;
  let consecutiveAllKnown = 0;

  for (let page = 1; page <= 20; page++) {
    if (Date.now() >= deadline) break;

    let listing;
    try {
      listing = await api.fetchBroadcastListing(page);
    } catch (e) {
      console.warn(`[lichess] Failed to fetch listing page ${page}: ${e}`);
      break;
    }
    pagesScanned++;

    // Collect all broadcast entries from active, upcoming, and past
    const entries: BroadcastListingEntry[] = [
      ...(listing.active || []),
      ...(listing.upcoming || []),
      ...(listing.past || []),
    ];

    if (entries.length === 0) break; // no more pages

    let allKnown = true;

    for (const entry of entries) {
      if (Date.now() >= deadline) break;

      const tourId = entry.tour.id;

      // Check if already tracked
      const { rows: existing } = await sql`
        SELECT status FROM lichess_broadcasts
        WHERE broadcast_id = ${tourId}
      `;

      if (existing.length > 0) {
        if (existing[0].status === "complete") continue;
        // Already tracking — update last_polled
        await sql`
          UPDATE lichess_broadcasts
          SET last_polled_at = NOW()
          WHERE broadcast_id = ${tourId}
        `;
        continue;
      }

      allKnown = false;

      // New broadcast — fetch tournament detail for round list
      let tournament;
      try {
        tournament = await api.fetchBroadcastTournament(tourId);
      } catch (e) {
        console.warn(
          `[lichess] Failed to fetch tournament ${tourId}: ${e}`,
        );
        continue;
      }

      // Insert broadcast
      await sql`
        INSERT INTO lichess_broadcasts (broadcast_id, name, status, last_polled_at)
        VALUES (${tourId}, ${tournament.tour.name}, 'tracking', NOW())
        ON CONFLICT (broadcast_id) DO UPDATE SET
          last_polled_at = NOW()
      `;
      broadcastsDiscovered++;

      // Insert rounds
      for (const round of tournament.rounds) {
        const roundStatus = round.finished ? "finished" : "new";
        await sql`
          INSERT INTO lichess_broadcast_rounds (round_id, broadcast_id, name, status)
          VALUES (${round.id}, ${tourId}, ${round.name}, ${roundStatus})
          ON CONFLICT (round_id) DO UPDATE SET
            status = CASE
              WHEN lichess_broadcast_rounds.status = 'finished' THEN 'finished'
              ELSE ${roundStatus}
            END
        `;
        roundsDiscovered++;
      }
    }

    if (allKnown) {
      consecutiveAllKnown++;
      // Safety net: go at least 5 pages deep even if all known
      if (consecutiveAllKnown >= 5) break;
    } else {
      consecutiveAllKnown = 0;
    }
  }

  return { broadcastsDiscovered, roundsDiscovered, pagesScanned };
}

// ─── Round ingestion ────────────────────────────────────────────────────────

interface IngestionResult {
  roundsProcessed: number;
  gamesInserted: number;
  gamesUpdated: number;
  gamesSkipped: number;
}

/**
 * Ingest games from tracked broadcast rounds.
 * Processes least-recently-fetched rounds first (checkpoint/resume).
 */
async function ingestRounds(
  api: LichessBroadcastApi,
  deadline: number,
): Promise<IngestionResult> {
  let roundsProcessed = 0;
  let gamesInserted = 0;
  let gamesUpdated = 0;
  let gamesSkipped = 0;

  // Get rounds to process: tracking broadcasts, ordered by least recently fetched
  const { rows: rounds } = await sql`
    SELECT r.round_id, r.broadcast_id, r.pgn_hash, r.status AS round_status,
           b.name AS broadcast_name
    FROM lichess_broadcast_rounds r
    JOIN lichess_broadcasts b ON r.broadcast_id = b.broadcast_id
    WHERE b.status = 'tracking'
    ORDER BY r.last_fetched_at ASC NULLS FIRST
    LIMIT 100
  `;

  const seenSlugs = new Map<string, number>();

  for (const round of rounds) {
    if (Date.now() >= deadline) {
      console.log(
        `[lichess] Time budget reached after ${roundsProcessed} rounds`,
      );
      break;
    }

    const roundId = round.round_id as string;
    const broadcastId = round.broadcast_id as string;

    // Fetch round PGN
    let pgnText: string;
    try {
      pgnText = await api.fetchRoundPgn(roundId);
    } catch (e) {
      console.warn(`[lichess] Failed to fetch PGN for round ${roundId}: ${e}`);
      continue;
    }

    // Check PGN hash — skip if unchanged
    const pgnHash = createHash("sha256").update(pgnText).digest("hex");
    if (pgnHash === (round.pgn_hash as string)) {
      // Update last_fetched timestamp even if unchanged
      await sql`
        UPDATE lichess_broadcast_rounds
        SET last_fetched_at = NOW()
        WHERE round_id = ${roundId}
      `;
      roundsProcessed++;
      continue;
    }

    // Parse games
    const games = parseBroadcastGames(pgnText, broadcastId);
    console.log(
      `[lichess] Round ${roundId} (${round.broadcast_name}): ${games.length} games`,
    );

    // Lookup existing player slugs
    const fideIds = new Set<string>();
    for (const g of games) {
      if (g.whiteFideId) fideIds.add(g.whiteFideId);
      if (g.blackFideId) fideIds.add(g.blackFideId);
    }

    const playerSlugs = new Map<string, string>();
    if (fideIds.size > 0) {
      const fideIdArray = Array.from(fideIds);
      for (let j = 0; j < fideIdArray.length; j += 500) {
        const batch = fideIdArray.slice(j, j + 500);
        const { rows } = await sql`
          SELECT fide_id, slug FROM players WHERE fide_id = ANY(${batch})
        `;
        for (const row of rows) {
          playerSlugs.set(row.fide_id as string, row.slug as string);
        }
      }
    }

    // Upsert each game with 4-layer dedup
    const updatedFideIds = new Set<string>();
    for (const game of games) {
      const result = await upsertBroadcastGame(
        game,
        "api",
        playerSlugs,
        seenSlugs,
      );
      if (result === "inserted") {
        gamesInserted++;
        if (game.whiteFideId) updatedFideIds.add(game.whiteFideId);
        if (game.blackFideId) updatedFideIds.add(game.blackFideId);
      } else if (result === "updated") {
        gamesUpdated++;
      } else {
        gamesSkipped++;
      }
    }

    // Update player stats for newly inserted games
    if (updatedFideIds.size > 0) {
      const fideIdArray = Array.from(updatedFideIds);
      for (let j = 0; j < fideIdArray.length; j += 200) {
        const batch = fideIdArray.slice(j, j + 200);
        try {
          await sql`
            UPDATE players p SET
              game_count = sub.cnt,
              last_seen  = GREATEST(p.last_seen, sub.max_date),
              updated_at = NOW()
            FROM (
              SELECT fide_id, COUNT(*)::int AS cnt, MAX(date) AS max_date
              FROM (
                SELECT white_fide_id AS fide_id, date FROM games
                  WHERE white_fide_id = ANY(${batch})
                UNION ALL
                SELECT black_fide_id AS fide_id, date FROM games
                  WHERE black_fide_id = ANY(${batch})
              ) g
              GROUP BY fide_id
            ) sub
            WHERE p.fide_id = sub.fide_id
          `;
        } catch {
          // Non-critical — skip
        }
      }
    }

    // Update round metadata
    // Determine if the round is finished by checking if all games have results
    const allFinished = games.every(
      (g) => g.result !== "*" && g.result !== "",
    );
    const newStatus =
      allFinished && (round.round_status as string) !== "new"
        ? "finished"
        : (round.round_status as string) === "new" && games.length > 0
          ? "started"
          : (round.round_status as string);

    await sql`
      UPDATE lichess_broadcast_rounds
      SET last_fetched_at = NOW(),
          pgn_hash = ${pgnHash},
          status = ${newStatus}
      WHERE round_id = ${roundId}
    `;

    roundsProcessed++;
  }

  // Mark broadcasts as complete where all rounds are finished
  await sql`
    UPDATE lichess_broadcasts b
    SET status = 'complete'
    WHERE b.status = 'tracking'
      AND NOT EXISTS (
        SELECT 1 FROM lichess_broadcast_rounds r
        WHERE r.broadcast_id = b.broadcast_id
          AND r.status != 'finished'
      )
      AND EXISTS (
        SELECT 1 FROM lichess_broadcast_rounds r
        WHERE r.broadcast_id = b.broadcast_id
      )
  `;

  return { roundsProcessed, gamesInserted, gamesUpdated, gamesSkipped };
}

// ─── Duplicate audit ────────────────────────────────────────────────────────

export interface AuditWarning {
  date: string;
  whiteFideId: string;
  blackFideId: string;
  count: number;
}

/**
 * Post-ingestion audit: detect suspicious duplicates.
 * Same players on the same day with >2 games is suspicious
 * (rapid/blitz can produce 2, but >2 is unusual).
 */
export async function runDuplicateAudit(): Promise<AuditWarning[]> {
  const { rows } = await sql`
    SELECT date::text, white_fide_id, black_fide_id, COUNT(*)::int AS count
    FROM games
    WHERE white_fide_id != '' AND white_fide_id != '0'
      AND black_fide_id != '' AND black_fide_id != '0'
    GROUP BY date, white_fide_id, black_fide_id
    HAVING COUNT(*) > 2
    ORDER BY COUNT(*) DESC
    LIMIT 50
  `;
  return rows.map((r) => ({
    date: r.date as string,
    whiteFideId: r.white_fide_id as string,
    blackFideId: r.black_fide_id as string,
    count: r.count as number,
  }));
}

// ─── Events update ──────────────────────────────────────────────────────────

function generateEventSlug(eventName: string): string {
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

async function updateEvents(): Promise<void> {
  try {
    const { rows: eventAggs } = await sql`
      SELECT
        event AS name,
        MIN(site) AS site,
        MIN(date) AS date_start,
        MAX(date) AS date_end,
        COUNT(*)::int AS game_count,
        (AVG(avg_elo))::smallint AS avg_elo
      FROM games
      WHERE event IS NOT NULL AND event != '' AND event_slug IS NULL
      GROUP BY event
    `;

    for (const e of eventAggs) {
      const slug = generateEventSlug(e.name as string);
      await sql`
        INSERT INTO events (slug, name, site, date_start, date_end, game_count, avg_elo)
        VALUES (${slug}, ${e.name}, ${e.site}, ${e.date_start}, ${e.date_end}, ${e.game_count}, ${e.avg_elo})
        ON CONFLICT (slug) DO UPDATE SET
          date_start = LEAST(events.date_start, EXCLUDED.date_start),
          date_end = GREATEST(events.date_end, EXCLUDED.date_end),
          game_count = (SELECT COUNT(*) FROM games WHERE event = events.name),
          avg_elo = (SELECT (AVG(avg_elo))::smallint FROM games WHERE event = events.name),
          updated_at = NOW()
      `;
    }

    // Link unlinked games to events
    await sql`
      UPDATE games g
      SET event_slug = e.slug
      FROM events e
      WHERE g.event = e.name AND g.event_slug IS NULL
    `;
  } catch (e) {
    console.warn(`[lichess] Events update failed: ${e}`);
  }
}

// ─── Main entry point ───────────────────────────────────────────────────────

export interface ProcessResult {
  discovery: DiscoveryResult;
  ingestion: IngestionResult;
  auditWarnings: AuditWarning[];
  durationMs: number;
}

/**
 * Main entry point for the Lichess broadcast pipeline.
 * Time-budgeted to 4.5 minutes for Vercel cron (5-min limit).
 */
export async function processLichessBroadcasts(): Promise<ProcessResult> {
  const startTime = Date.now();
  const deadline = startTime + 270_000; // 4.5 minutes

  const api = new LichessBroadcastApi();

  console.log("[lichess] Starting broadcast discovery...");
  const discovery = await discoverBroadcasts(api, deadline);
  console.log(
    `[lichess] Discovery: ${discovery.broadcastsDiscovered} broadcasts, ${discovery.roundsDiscovered} rounds across ${discovery.pagesScanned} pages`,
  );

  console.log("[lichess] Starting round ingestion...");
  const ingestion = await ingestRounds(api, deadline);
  console.log(
    `[lichess] Ingestion: ${ingestion.roundsProcessed} rounds → ${ingestion.gamesInserted} inserted, ${ingestion.gamesUpdated} updated, ${ingestion.gamesSkipped} skipped`,
  );

  // Update events table
  if (ingestion.gamesInserted > 0) {
    console.log("[lichess] Updating events table...");
    await updateEvents();
  }

  // Post-ingestion audit
  console.log("[lichess] Running duplicate audit...");
  const auditWarnings = await runDuplicateAudit();
  if (auditWarnings.length > 0) {
    console.warn(
      `[lichess] AUDIT WARNING: ${auditWarnings.length} suspicious duplicate groups found`,
    );
    for (const w of auditWarnings.slice(0, 5)) {
      console.warn(
        `  ${w.date}: ${w.whiteFideId} vs ${w.blackFideId} → ${w.count} games`,
      );
    }
  }

  const durationMs = Date.now() - startTime;
  console.log(
    `[lichess] Done in ${(durationMs / 1000).toFixed(1)}s (${api.requestCount} API requests)`,
  );

  return { discovery, ingestion, auditWarnings, durationMs };
}
