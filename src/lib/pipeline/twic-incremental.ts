/**
 * Lightweight incremental TWIC processing for serverless execution.
 *
 * Downloads 1-3 new TWIC issues, parses in memory, upserts games and
 * updates player stats directly in Postgres. No disk I/O required.
 *
 * This does NOT replace the full CLI pipeline — it supplements it for
 * weekly automated updates via Vercel cron.
 */

import { sql } from "@/lib/db/connection";
import { downloadAndExtractPgn } from "./pgn-extract";

// We inline the minimal parsing logic from fast-parser to avoid importing
// from the fide-pipeline workspace (which has Node.js-only dependencies).

interface ParsedGame {
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

function splitPGN(pgnText: string): string[] {
  const games: string[] = [];
  const parts = pgnText.split(/\n\n(?=\[Event )/);
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed) games.push(trimmed);
  }
  return games.length > 0 ? games : [pgnText.trim()].filter(Boolean);
}

function parseElo(elo: string | undefined): number | null {
  if (!elo || elo === "-" || elo === "0" || elo === "") return null;
  const n = parseInt(elo, 10);
  return isNaN(n) || n < 100 ? null : n;
}

function parseFideId(id: string | undefined): string | null {
  if (!id || id === "0" || id === "" || id === "-") return null;
  const trimmed = id.trim();
  return /^\d+$/.test(trimmed) ? trimmed : null;
}

function parseTitle(title: string | undefined): string | null {
  if (!title || title === "-" || title === "") return null;
  const valid = ["GM", "IM", "FM", "CM", "NM", "WGM", "WIM", "WFM", "WCM"];
  const upper = title.toUpperCase().trim();
  return valid.includes(upper) ? upper : null;
}

function parseGames(pgnText: string): ParsedGame[] {
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

    results.push({
      white,
      black,
      whiteElo,
      blackElo,
      whiteTitle: parseTitle(h["WhiteTitle"]),
      blackTitle: parseTitle(h["BlackTitle"]),
      whiteFideId: parseFideId(h["WhiteFideId"]),
      blackFideId: parseFideId(h["BlackFideId"]),
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

function generateGameSlug(game: ParsedGame): string {
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

function generatePlayerSlug(name: string, fideId: string): string {
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
  try {
    const res = await fetch(
      `https://theweekinchess.com/zips/twic${issue}g.zip`,
      { method: "HEAD" },
    );
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Process new TWIC issues incrementally.
 * Downloads, parses, and upserts directly to Postgres.
 */
export async function processIncrementalTwic(maxIssues: number = 3): Promise<{
  issuesProcessed: number;
  gamesUpserted: number;
  playersUpdated: number;
  errors: string[];
}> {
  const lastIssue = await getLastProcessedIssue();
  if (lastIssue === null) {
    return {
      issuesProcessed: 0,
      gamesUpserted: 0,
      playersUpdated: 0,
      errors: [
        "No previous TWIC issues found. Run the full pipeline first: npm run fide-pipeline -- full",
      ],
    };
  }

  const errors: string[] = [];
  let totalGamesUpserted = 0;
  const updatedFideIds = new Set<string>();
  let issuesProcessed = 0;

  // Try the next N issues
  for (let i = 1; i <= maxIssues; i++) {
    const issue = lastIssue + i;

    // Check if issue exists before downloading
    const exists = await twicIssueExists(issue);
    if (!exists) break;

    // Download and extract PGN in memory
    const pgnText = await downloadAndExtractPgn(issue);
    if (!pgnText) {
      errors.push(`Failed to extract PGN from TWIC ${issue}`);
      continue;
    }

    // Parse games
    const games = parseGames(pgnText);

    // Build a set of player FIDE IDs to slug mappings from our database
    const fideIds = new Set<string>();
    for (const g of games) {
      if (g.whiteFideId) fideIds.add(g.whiteFideId);
      if (g.blackFideId) fideIds.add(g.blackFideId);
    }

    // Look up existing players by FIDE ID
    const playerSlugs = new Map<string, string>();
    if (fideIds.size > 0) {
      const fideIdArray = Array.from(fideIds);
      // Query in batches to avoid too-large IN clauses
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

    // Upsert games in batches
    const BATCH_SIZE = 200;
    let gamesInIssue = 0;
    const seenSlugs = new Map<string, number>();

    for (let j = 0; j < games.length; j += BATCH_SIZE) {
      const batch = games.slice(j, j + BATCH_SIZE);
      const values: Array<{
        slug: string;
        whiteName: string;
        blackName: string;
        whiteSlug: string | null;
        blackSlug: string | null;
        whiteFideId: string;
        blackFideId: string;
        whiteElo: number;
        blackElo: number;
        whiteTitle: string | null;
        blackTitle: string | null;
        event: string;
        site: string | null;
        date: string;
        round: string | null;
        eco: string | null;
        opening: string | null;
        variation: string | null;
        result: string;
        pgn: string;
      }> = [];

      for (const game of batch) {
        if (!game.whiteFideId || !game.blackFideId) continue;
        if (!game.event || !game.date) continue;

        // Generate slug with collision handling
        let slug = generateGameSlug(game);
        const count = (seenSlugs.get(slug) ?? 0) + 1;
        seenSlugs.set(slug, count);
        if (count > 1) slug = `${slug}-${count}`;

        const whiteSlug =
          playerSlugs.get(game.whiteFideId) ||
          generatePlayerSlug(game.white, game.whiteFideId);
        const blackSlug =
          playerSlugs.get(game.blackFideId) ||
          generatePlayerSlug(game.black, game.blackFideId);

        // Convert date from "2024.01.15" to "2024-01-15" for SQL
        const sqlDate = game.date.replace(/\./g, "-");

        values.push({
          slug,
          whiteName: game.white,
          blackName: game.black,
          whiteSlug,
          blackSlug,
          whiteFideId: game.whiteFideId,
          blackFideId: game.blackFideId,
          whiteElo: game.whiteElo ?? 0,
          blackElo: game.blackElo ?? 0,
          whiteTitle: game.whiteTitle,
          blackTitle: game.blackTitle,
          event: game.event,
          site: game.site,
          date: sqlDate,
          round: game.round,
          eco: game.eco,
          opening: game.opening,
          variation: game.variation,
          result: game.result,
          pgn: game.pgn,
        });

        if (game.whiteFideId) updatedFideIds.add(game.whiteFideId);
        if (game.blackFideId) updatedFideIds.add(game.blackFideId);
      }

      if (values.length === 0) continue;

      // Upsert games
      for (const v of values) {
        try {
          await sql`
            INSERT INTO games (
              slug, white_name, black_name, white_slug, black_slug,
              white_fide_id, black_fide_id, white_elo, black_elo,
              white_title, black_title,
              event, site, date, round, eco, opening, variation, result, pgn
            ) VALUES (
              ${v.slug}, ${v.whiteName}, ${v.blackName}, ${v.whiteSlug}, ${v.blackSlug},
              ${v.whiteFideId}, ${v.blackFideId}, ${v.whiteElo}, ${v.blackElo},
              ${v.whiteTitle}, ${v.blackTitle},
              ${v.event}, ${v.site}, ${v.date}::date, ${v.round}, ${v.eco}, ${v.opening}, ${v.variation}, ${v.result}, ${v.pgn}
            )
            ON CONFLICT (slug) DO NOTHING
          `;
          gamesInIssue++;
        } catch {
          // Slug collision — skip silently
        }
      }
    }

    // Update player stats for players involved in new games
    for (const fideId of updatedFideIds) {
      try {
        await sql`
          UPDATE players SET
            game_count = (
              SELECT COUNT(*) FROM games
              WHERE white_fide_id = ${fideId} OR black_fide_id = ${fideId}
            ),
            last_seen = GREATEST(
              last_seen,
              (SELECT MAX(date) FROM games WHERE white_fide_id = ${fideId} OR black_fide_id = ${fideId})
            ),
            updated_at = NOW()
          WHERE fide_id = ${fideId}
        `;
      } catch {
        // Player may not exist in our database — skip
      }
    }

    // Record pipeline run for this issue
    await sql`
      INSERT INTO pipeline_runs (run_type, identifier, status, completed_at)
      VALUES ('twic', ${String(issue)}, 'completed', NOW())
      ON CONFLICT (run_type, identifier) DO UPDATE SET
        status = 'completed',
        completed_at = NOW()
    `;

    totalGamesUpserted += gamesInIssue;
    issuesProcessed++;
  }

  return {
    issuesProcessed,
    gamesUpserted: totalGamesUpserted,
    playersUpdated: updatedFideIds.size,
    errors,
  };
}
