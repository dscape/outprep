/**
 * Game indexer — builds individual game detail objects for SEO pages.
 *
 * Deduplicates games by (whiteFideId, blackFideId, event, date, round),
 * filters by Elo threshold, and generates human-readable slugs.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { extractHeaders } from "./fast-parser";
import { slugify, parseNameParts, resolveOpeningName } from "./aggregate";
import type {
  TWICGameHeader,
  FIDEPlayer,
  GameDetail,
  GameIndex,
  GameIndexEntry,
} from "./types";

/**
 * Generate a game slug in nested format:
 *   {event-slug}[-r{round}]-{year}/{white-lastname}-{whiteFideId}-vs-{black-lastname}-{blackFideId}
 *
 * Fallback (no event/date):
 *   {white-lastname}-{whiteFideId}-vs-{black-lastname}-{blackFideId}
 */
export function generateGameSlug(
  whiteName: string,
  blackName: string,
  event: string,
  date: string,
  round: string | null,
  whiteFideId: string,
  blackFideId: string
): string {
  const { lastName: wLast } = parseNameParts(whiteName);
  const { lastName: bLast } = parseNameParts(blackName);

  // Build matchup segment: {white-lastname}-{whiteFideId}-vs-{black-lastname}-{blackFideId}
  const matchup = slugify(`${wLast} ${whiteFideId} vs ${bLast} ${blackFideId}`);

  // Build event segment if event and date are available
  if (event && date) {
    const year = date.split(".")[0] || "";

    // Truncate event to first 6 words to keep URLs reasonable
    const eventWords = event.split(/\s+/).slice(0, 6).join(" ");

    const eventParts = [eventWords];

    // Append round if present and meaningful
    if (round && round !== "?" && round !== "-") {
      const roundSlug = "r" + round.replace(/\./g, "-");
      eventParts.push(roundSlug);
    }

    // Append year
    if (year) eventParts.push(year);

    return `${slugify(eventParts.join(" "))}/${matchup}`;
  }

  return matchup;
}

/**
 * Generate a legacy game slug (pre-URL-restructuring format) for alias mapping.
 * Format: {white-lastname}-vs-{black-lastname}-{event}-{date}[-r{round}]
 */
export function generateLegacyGameSlug(
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
    const whiteFederation = whitePlayer?.federation ?? null;
    const blackFederation = blackPlayer?.federation ?? null;

    // Generate slug with collision handling
    let slug = generateGameSlug(whiteName, blackName, game.event, game.date, round, game.whiteFideId, game.blackFideId);
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
      whiteFederation,
      blackFederation,
      event: game.event,
      site: game.site ?? null,
      date: game.date,
      round,
      eco: game.eco ?? null,
      opening: resolveOpeningName(game.eco ?? null, headers["Opening"] ?? null),
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
    whiteFideId: g.whiteFideId,
    blackFideId: g.blackFideId,
    whiteElo: g.whiteElo,
    blackElo: g.blackElo,
    whiteFederation: g.whiteFederation,
    blackFederation: g.blackFederation,
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

/**
 * Build a game alias map from legacy slugs → new slugs.
 * Used by the non-incremental smoke test path.
 */
export function buildGameAliasMap(
  allGames: TWICGameHeader[],
  players: FIDEPlayer[],
  options: { minElo?: number } = {}
): Record<string, string> {
  const minElo = options.minElo ?? 2000;
  const playerByFideId = new Map<string, FIDEPlayer>();
  for (const p of players) playerByFideId.set(p.fideId, p);

  const seenKeys = new Set<string>();
  const newSlugCounts = new Map<string, number>();
  const legacySlugCounts = new Map<string, number>();
  const aliases: Record<string, string> = {};

  for (const game of allGames) {
    if (!game.whiteFideId || !game.blackFideId) continue;
    const wElo = game.whiteElo ?? 0;
    const bElo = game.blackElo ?? 0;
    if (wElo < minElo && bElo < minElo) continue;
    if (!game.event || !game.date) continue;

    const headers = extractHeaders(game.rawPgn);
    const round = headers["Round"] && headers["Round"] !== "?" ? headers["Round"] : null;
    const dedupKey = `${game.whiteFideId}:${game.blackFideId}:${game.event}:${game.date}:${round ?? ""}`;
    if (seenKeys.has(dedupKey)) continue;
    seenKeys.add(dedupKey);

    const whitePlayer = playerByFideId.get(game.whiteFideId);
    const blackPlayer = playerByFideId.get(game.blackFideId);
    const whiteName = whitePlayer?.name ?? game.white;
    const blackName = blackPlayer?.name ?? game.black;

    let newSlug = generateGameSlug(whiteName, blackName, game.event, game.date, round, game.whiteFideId, game.blackFideId);
    const newCount = (newSlugCounts.get(newSlug) ?? 0) + 1;
    newSlugCounts.set(newSlug, newCount);
    if (newCount > 1) newSlug = `${newSlug}-${newCount}`;

    let legacySlug = generateLegacyGameSlug(whiteName, blackName, game.event, game.date, round);
    const legacyCount = (legacySlugCounts.get(legacySlug) ?? 0) + 1;
    legacySlugCounts.set(legacySlug, legacyCount);
    if (legacyCount > 1) legacySlug = `${legacySlug}-${legacyCount}`;

    aliases[legacySlug] = newSlug;
  }

  return aliases;
}

/** Inline display data for a recent game on a player page. */
type RecentGame = NonNullable<FIDEPlayer["recentGames"]>[number];

/**
 * Build a map of playerSlug → recent games with full display data.
 * Inlined on FIDEPlayer so player pages don't need to fetch the game index.
 */
export function buildPlayerRecentGames(
  games: GameDetail[],
  maxPerPlayer: number = 10
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
 * Build notable games per player: highest-rated opponents, deduplicated against recent.
 * Score: opponentElo + (win ? 100 : loss ? 50 : 0) + (opponentHasPage ? 50 : 0)
 */
export function buildPlayerNotableGames(
  games: GameDetail[],
  recentGames: Map<string, RecentGame[]>,
  maxPerPlayer: number = 10
): Map<string, RecentGame[]> {
  const candidates = new Map<string, NotableGameCandidate[]>();

  for (const g of games) {
    if (g.whiteSlug) {
      const result: "Won" | "Lost" | "Draw" =
        g.result === "1-0" ? "Won" : g.result === "0-1" ? "Lost" : "Draw";
      const score = g.blackElo + (result === "Won" ? 100 : result === "Lost" ? 50 : 0) + (g.blackSlug ? 50 : 0);
      if (!candidates.has(g.whiteSlug)) candidates.set(g.whiteSlug, []);
      candidates.get(g.whiteSlug)!.push({
        game: { slug: g.slug, opponentName: g.blackName, opponentElo: g.blackElo, result, event: g.event, date: g.date, opening: g.opening, isWhite: true },
        score,
      });
    }
    if (g.blackSlug) {
      const result: "Won" | "Lost" | "Draw" =
        g.result === "0-1" ? "Won" : g.result === "1-0" ? "Lost" : "Draw";
      const score = g.whiteElo + (result === "Won" ? 100 : result === "Lost" ? 50 : 0) + (g.whiteSlug ? 50 : 0);
      if (!candidates.has(g.blackSlug)) candidates.set(g.blackSlug, []);
      candidates.get(g.blackSlug)!.push({
        game: { slug: g.slug, opponentName: g.whiteName, opponentElo: g.whiteElo, result, event: g.event, date: g.date, opening: g.opening, isWhite: false },
        score,
      });
    }
  }

  const result = new Map<string, RecentGame[]>();
  for (const [playerSlug, cands] of candidates) {
    cands.sort((a, b) => b.score - a.score);
    const recentSlugs = new Set((recentGames.get(playerSlug) ?? []).map((g) => g.slug));
    const notable: RecentGame[] = [];
    for (const c of cands) {
      if (notable.length >= maxPerPlayer) break;
      if (!recentSlugs.has(c.game.slug)) notable.push(c.game);
    }
    if (notable.length > 0) result.set(playerSlug, notable);
  }

  return result;
}

/**
 * Write individual game detail JSON files to disk.
 * Cleans the directory first to avoid stale files.
 * Uses __ separator in filenames since slugs now contain /.
 */
export function writeGameFiles(games: GameDetail[], dir: string): number {
  // Clean old files
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true });
  }
  mkdirSync(dir, { recursive: true });

  for (const game of games) {
    const diskFilename = game.slug.replace(/\//g, "__");
    writeFileSync(join(dir, `${diskFilename}.json`), JSON.stringify(game));
  }

  return games.length;
}

// ─── Incremental processing (for memory-efficient two-pass pipeline) ─────────

/** Notable game candidate with score for ranking. */
interface NotableGameCandidate {
  game: RecentGame;
  score: number;
}

/** Max notable game candidates to keep per player during incremental processing. */
const MAX_NOTABLE_CANDIDATES = 50;

/**
 * Insert a notable game candidate, keeping only the top MAX_NOTABLE_CANDIDATES
 * per player to bound memory. If the list is full and the new candidate scores
 * lower than the current minimum, it is discarded.
 */
function insertNotableCandidate(
  map: Map<string, NotableGameCandidate[]>,
  slug: string,
  candidate: NotableGameCandidate
): void {
  const candidates = map.get(slug);
  if (!candidates) {
    map.set(slug, [candidate]);
    return;
  }

  if (candidates.length < MAX_NOTABLE_CANDIDATES) {
    candidates.push(candidate);
    return;
  }

  // Find the minimum-scored candidate and replace if new one is better
  let minIdx = 0;
  let minScore = candidates[0].score;
  for (let i = 1; i < candidates.length; i++) {
    if (candidates[i].score < minScore) {
      minScore = candidates[i].score;
      minIdx = i;
    }
  }

  if (candidate.score > minScore) {
    candidates[minIdx] = candidate;
  }
}

/** Mutable state carried across PGN file chunks during incremental game processing. */
export interface GameProcessingState {
  seenKeys: Set<string>;
  slugCounts: Map<string, number>;
  legacySlugCounts: Map<string, number>;
  indexEntries: GameIndexEntry[];
  recentGamesMap: Map<string, { date: string; game: RecentGame }[]>;
  notableGamesMap: Map<string, NotableGameCandidate[]>;
  gameAliases: Map<string, string>; // legacy slug → new slug (for 301 redirects)
  playerByFideId: Map<string, FIDEPlayer>;
  minElo: number;
  filesWritten: number;
}

/** Create initial state for incremental game processing. */
export function createGameProcessingState(
  players: FIDEPlayer[],
  options: { minElo?: number } = {}
): GameProcessingState {
  const playerByFideId = new Map<string, FIDEPlayer>();
  for (const p of players) {
    playerByFideId.set(p.fideId, p);
  }
  return {
    seenKeys: new Set(),
    slugCounts: new Map(),
    legacySlugCounts: new Map(),
    indexEntries: [],
    recentGamesMap: new Map(),
    notableGamesMap: new Map(),
    gameAliases: new Map(),
    playerByFideId,
    minElo: options.minElo ?? 2000,
    filesWritten: 0,
  };
}

/**
 * Process one PGN file's worth of games incrementally.
 *
 * For each qualifying game: deduplicates, writes a GameDetail JSON file to disk
 * immediately (no accumulation of PGN strings), and appends lightweight
 * GameIndexEntry + recent game data to state.
 */
export function processGameDetailsChunk(
  games: TWICGameHeader[],
  state: GameProcessingState,
  gameDetailsDir: string
): void {
  for (const game of games) {
    if (!game.whiteFideId || !game.blackFideId) continue;

    const wElo = game.whiteElo ?? 0;
    const bElo = game.blackElo ?? 0;
    if (wElo < state.minElo && bElo < state.minElo) continue;

    if (!game.event || !game.date) continue;

    const headers = extractHeaders(game.rawPgn);
    const round = headers["Round"] && headers["Round"] !== "?" ? headers["Round"] : null;

    const dedupKey = `${game.whiteFideId}:${game.blackFideId}:${game.event}:${game.date}:${round ?? ""}`;
    if (state.seenKeys.has(dedupKey)) continue;
    state.seenKeys.add(dedupKey);

    const whitePlayer = state.playerByFideId.get(game.whiteFideId);
    const blackPlayer = state.playerByFideId.get(game.blackFideId);
    const whiteName = whitePlayer?.name ?? game.white;
    const blackName = blackPlayer?.name ?? game.black;
    const whiteSlug = whitePlayer?.slug ?? "";
    const blackSlug = blackPlayer?.slug ?? "";
    const whiteFederation = whitePlayer?.federation ?? null;
    const blackFederation = blackPlayer?.federation ?? null;

    let slug = generateGameSlug(whiteName, blackName, game.event, game.date, round, game.whiteFideId, game.blackFideId);
    const count = (state.slugCounts.get(slug) ?? 0) + 1;
    state.slugCounts.set(slug, count);
    if (count > 1) slug = `${slug}-${count}`;

    // Compute legacy slug for alias mapping (old URL → new URL redirect)
    let legacySlug = generateLegacyGameSlug(whiteName, blackName, game.event, game.date, round);
    const legacyCount = (state.legacySlugCounts.get(legacySlug) ?? 0) + 1;
    state.legacySlugCounts.set(legacySlug, legacyCount);
    if (legacyCount > 1) legacySlug = `${legacySlug}-${legacyCount}`;
    state.gameAliases.set(legacySlug, slug);

    const opening = resolveOpeningName(game.eco ?? null, headers["Opening"] ?? null);

    // Write game detail file to disk immediately — no accumulation of PGN strings
    // Use __ separator in filenames since slugs now contain /
    const detail: GameDetail = {
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
      whiteFederation,
      blackFederation,
      event: game.event,
      site: game.site ?? null,
      date: game.date,
      round,
      eco: game.eco ?? null,
      opening,
      variation: headers["Variation"] ?? null,
      result: game.result,
      pgn: game.rawPgn,
    };
    const diskFilename = slug.replace(/\//g, "__");
    writeFileSync(join(gameDetailsDir, `${diskFilename}.json`), JSON.stringify(detail));
    state.filesWritten++;

    // Accumulate lightweight index entry (no pgn)
    state.indexEntries.push({
      slug,
      whiteName,
      blackName,
      whiteSlug,
      blackSlug,
      whiteFideId: game.whiteFideId,
      blackFideId: game.blackFideId,
      whiteElo: wElo,
      blackElo: bElo,
      whiteFederation,
      blackFederation,
      event: game.event,
      date: game.date,
      result: game.result,
      eco: game.eco ?? null,
      opening,
    });

    // Accumulate recent games + notable games per player
    const whiteResult: "Won" | "Lost" | "Draw" =
      game.result === "1-0" ? "Won" : game.result === "0-1" ? "Lost" : "Draw";
    const blackResult: "Won" | "Lost" | "Draw" =
      game.result === "0-1" ? "Won" : game.result === "1-0" ? "Lost" : "Draw";

    if (whiteSlug) {
      const whiteGame: RecentGame = {
        slug,
        opponentName: blackName,
        opponentElo: bElo,
        result: whiteResult,
        event: game.event,
        date: game.date,
        opening,
        isWhite: true,
      };

      if (!state.recentGamesMap.has(whiteSlug)) state.recentGamesMap.set(whiteSlug, []);
      state.recentGamesMap.get(whiteSlug)!.push({ date: game.date, game: whiteGame });

      // Notable game scoring: opponent elo + win bonus + opponent-has-page bonus
      const whiteScore = bElo
        + (whiteResult === "Won" ? 100 : whiteResult === "Lost" ? 50 : 0)
        + (blackSlug ? 50 : 0);
      insertNotableCandidate(state.notableGamesMap, whiteSlug, { game: whiteGame, score: whiteScore });
    }

    if (blackSlug) {
      const blackGame: RecentGame = {
        slug,
        opponentName: whiteName,
        opponentElo: wElo,
        result: blackResult,
        event: game.event,
        date: game.date,
        opening,
        isWhite: false,
      };

      if (!state.recentGamesMap.has(blackSlug)) state.recentGamesMap.set(blackSlug, []);
      state.recentGamesMap.get(blackSlug)!.push({ date: game.date, game: blackGame });

      // Notable game scoring
      const blackScore = wElo
        + (blackResult === "Won" ? 100 : blackResult === "Lost" ? 50 : 0)
        + (whiteSlug ? 50 : 0);
      insertNotableCandidate(state.notableGamesMap, blackSlug, { game: blackGame, score: blackScore });
    }
  }
}

/**
 * Finalize incremental game processing: build GameIndex and per-player recent games.
 */
export function finalizeGameProcessing(
  state: GameProcessingState,
  maxRecentPerPlayer: number = 10,
  maxNotablePerPlayer: number = 10
): {
  gameIndex: GameIndex;
  playerRecentGames: Map<string, RecentGame[]>;
  playerNotableGames: Map<string, RecentGame[]>;
  gameAliases: Record<string, string>;
} {
  const gameIndex: GameIndex = {
    generatedAt: new Date().toISOString(),
    totalGames: state.indexEntries.length,
    games: state.indexEntries,
  };

  const playerRecentGames = new Map<string, RecentGame[]>();
  for (const [playerSlug, entries] of state.recentGamesMap) {
    entries.sort((a, b) => b.date.localeCompare(a.date));
    playerRecentGames.set(
      playerSlug,
      entries.slice(0, maxRecentPerPlayer).map((e) => e.game)
    );
  }

  // Build notable games: top-scored, deduplicated against recent games
  const playerNotableGames = new Map<string, RecentGame[]>();
  for (const [playerSlug, candidates] of state.notableGamesMap) {
    candidates.sort((a, b) => b.score - a.score);
    const recentSlugs = new Set(
      (playerRecentGames.get(playerSlug) ?? []).map((g) => g.slug)
    );
    const notable: RecentGame[] = [];
    for (const c of candidates) {
      if (notable.length >= maxNotablePerPlayer) break;
      if (!recentSlugs.has(c.game.slug)) {
        notable.push(c.game);
      }
    }
    if (notable.length > 0) {
      playerNotableGames.set(playerSlug, notable);
    }
  }

  // Build game aliases as a plain record
  const gameAliases: Record<string, string> = {};
  for (const [legacySlug, newSlug] of state.gameAliases) {
    gameAliases[legacySlug] = newSlug;
  }

  return { gameIndex, playerRecentGames, playerNotableGames, gameAliases };
}
