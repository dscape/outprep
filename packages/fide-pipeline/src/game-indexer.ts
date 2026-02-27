/**
 * Game indexer — builds individual game detail objects for SEO pages.
 *
 * Deduplicates games by (whiteFideId, blackFideId, event, date, round),
 * filters by Elo threshold, and generates human-readable slugs.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { extractHeaders } from "./fast-parser";
import { slugify, parseNameParts } from "./aggregate";
import type {
  TWICGameHeader,
  FIDEPlayer,
  GameDetail,
  GameIndex,
  GameIndexEntry,
} from "./types";

/**
 * Generate a game slug: {white-lastname}-vs-{black-lastname}-{event}-{date}[-r{round}]
 */
export function generateGameSlug(
  whiteName: string,
  blackName: string,
  event: string,
  date: string,
  round: string | null
): string {
  const { lastName: wLast } = parseNameParts(whiteName);
  const { lastName: bLast } = parseNameParts(blackName);

  // Convert date from "2022.04.20" to "2022-04-20"
  const datePart = date.replace(/\./g, "-");

  // Truncate event to first 6 words to keep URLs reasonable
  const eventWords = event.split(/\s+/).slice(0, 6).join(" ");

  const parts = [wLast, "vs", bLast, eventWords, datePart];

  // Append round if present and meaningful
  if (round && round !== "?" && round !== "-") {
    // Normalize "1.1" → "r1-1", "3" → "r3"
    const roundSlug = "r" + round.replace(/\./g, "-");
    parts.push(roundSlug);
  }

  return slugify(parts.join(" "));
}

/**
 * Build game detail objects from raw games + enriched players.
 *
 * Filters: both players must have FIDE IDs, at least one Elo >= minElo.
 * Deduplicates by composite key.
 */
export function buildGameDetails(
  allGames: TWICGameHeader[],
  players: FIDEPlayer[],
  options: { minElo?: number } = {}
): GameDetail[] {
  const minElo = options.minElo ?? 2000;

  // Build FIDE ID → player lookup
  const playerByFideId = new Map<string, FIDEPlayer>();
  for (const p of players) {
    playerByFideId.set(p.fideId, p);
  }

  // Dedup tracking
  const seenKeys = new Set<string>();
  const slugCounts = new Map<string, number>();
  const details: GameDetail[] = [];

  for (const game of allGames) {
    // Both players must have FIDE IDs
    if (!game.whiteFideId || !game.blackFideId) continue;

    // At least one player must meet Elo threshold
    const wElo = game.whiteElo ?? 0;
    const bElo = game.blackElo ?? 0;
    if (wElo < minElo && bElo < minElo) continue;

    // Must have event and date for a meaningful slug
    if (!game.event || !game.date) continue;

    // Extract additional headers from raw PGN (Opening, Variation, Round)
    const headers = extractHeaders(game.rawPgn);
    const round = headers["Round"] && headers["Round"] !== "?" ? headers["Round"] : null;

    // Dedup key
    const dedupKey = `${game.whiteFideId}:${game.blackFideId}:${game.event}:${game.date}:${round ?? ""}`;
    if (seenKeys.has(dedupKey)) continue;
    seenKeys.add(dedupKey);

    // Look up enriched player data
    const whitePlayer = playerByFideId.get(game.whiteFideId);
    const blackPlayer = playerByFideId.get(game.blackFideId);

    // Use enriched names/slugs when available, fall back to raw game data
    const whiteName = whitePlayer?.name ?? game.white;
    const blackName = blackPlayer?.name ?? game.black;
    const whiteSlug = whitePlayer?.slug ?? "";
    const blackSlug = blackPlayer?.slug ?? "";

    // Generate slug with collision handling
    let slug = generateGameSlug(whiteName, blackName, game.event, game.date, round);
    const count = (slugCounts.get(slug) ?? 0) + 1;
    slugCounts.set(slug, count);
    if (count > 1) {
      slug = `${slug}-${count}`;
    }

    details.push({
      slug,
      whiteName,
      blackName,
      whiteSlug,
      blackSlug,
      whiteFideId: game.whiteFideId,
      blackFideId: game.blackFideId,
      whiteElo: wElo,
      blackElo: bElo,
      whiteTitle: game.whiteTitle,
      blackTitle: game.blackTitle,
      event: game.event,
      site: game.site ?? null,
      date: game.date,
      round,
      eco: game.eco ?? null,
      opening: headers["Opening"] ?? null,
      variation: headers["Variation"] ?? null,
      result: game.result,
      pgn: game.rawPgn,
    });
  }

  return details;
}

/**
 * Build compact game index (strips pgn field) for sitemap + listing.
 */
export function buildGameIndex(games: GameDetail[]): GameIndex {
  const entries: GameIndexEntry[] = games.map((g) => ({
    slug: g.slug,
    whiteName: g.whiteName,
    blackName: g.blackName,
    whiteSlug: g.whiteSlug,
    blackSlug: g.blackSlug,
    whiteElo: g.whiteElo,
    blackElo: g.blackElo,
    event: g.event,
    date: g.date,
    result: g.result,
    eco: g.eco,
    opening: g.opening,
  }));

  return {
    generatedAt: new Date().toISOString(),
    totalGames: entries.length,
    games: entries,
  };
}

/** Inline display data for a recent game on a player page. */
type RecentGame = NonNullable<FIDEPlayer["recentGames"]>[number];

/**
 * Build a map of playerSlug → recent games with full display data.
 * Inlined on FIDEPlayer so player pages don't need to fetch the game index.
 */
export function buildPlayerRecentGames(
  games: GameDetail[],
  maxPerPlayer: number = 5
): Map<string, RecentGame[]> {
  const map = new Map<string, { game: RecentGame; date: string }[]>();

  for (const g of games) {
    // White player's perspective
    if (g.whiteSlug) {
      if (!map.has(g.whiteSlug)) map.set(g.whiteSlug, []);
      map.get(g.whiteSlug)!.push({
        date: g.date,
        game: {
          slug: g.slug,
          opponentName: g.blackName,
          opponentElo: g.blackElo,
          result: g.result === "1-0" ? "Won" : g.result === "0-1" ? "Lost" : "Draw",
          event: g.event,
          date: g.date,
          opening: g.opening,
          isWhite: true,
        },
      });
    }

    // Black player's perspective
    if (g.blackSlug) {
      if (!map.has(g.blackSlug)) map.set(g.blackSlug, []);
      map.get(g.blackSlug)!.push({
        date: g.date,
        game: {
          slug: g.slug,
          opponentName: g.whiteName,
          opponentElo: g.whiteElo,
          result: g.result === "0-1" ? "Won" : g.result === "1-0" ? "Lost" : "Draw",
          event: g.event,
          date: g.date,
          opening: g.opening,
          isWhite: false,
        },
      });
    }
  }

  const result = new Map<string, RecentGame[]>();
  for (const [playerSlug, entries] of map) {
    entries.sort((a, b) => b.date.localeCompare(a.date));
    result.set(playerSlug, entries.slice(0, maxPerPlayer).map((e) => e.game));
  }

  return result;
}

/**
 * Write individual game detail JSON files to disk.
 * Cleans the directory first to avoid stale files.
 */
export function writeGameFiles(games: GameDetail[], dir: string): number {
  // Clean old files
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true });
  }
  mkdirSync(dir, { recursive: true });

  for (const game of games) {
    writeFileSync(join(dir, `${game.slug}.json`), JSON.stringify(game));
  }

  return games.length;
}
