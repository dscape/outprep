/**
 * Player aggregation: deduplicates players across games and computes
 * per-player opening stats, win/draw/loss rates, and recent events.
 */

import type {
  TWICGameHeader,
  FIDEPlayer,
  PlayerAccumulator,
  OpeningStats,
  PlayerIndex,
  PlayerIndexEntry,
} from "./types";

// Well-known ECO opening names (first letter gives category)
const ECO_CATEGORIES: Record<string, string> = {
  A: "Flank Openings",
  B: "Semi-Open Games",
  C: "Open Games",
  D: "Closed Games",
  E: "Indian Defences",
};

/**
 * Normalize a player name for deduplication.
 * TWIC uses "LastName, FirstName" format consistently.
 * Strips accents, lowercases, removes extra spaces.
 */
export function normalizePlayerName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Strip accents
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Slugify a string: lowercase, strip accents, replace non-alphanumeric with hyphens.
 */
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

/**
 * Parse TWIC name "LastName,FirstName" into parts.
 */
function parseNameParts(name: string): { lastName: string; firstName: string } {
  const commaIdx = name.indexOf(",");
  if (commaIdx === -1) {
    return { lastName: name.trim(), firstName: "" };
  }
  return {
    lastName: name.slice(0, commaIdx).trim(),
    firstName: name.slice(commaIdx + 1).trim(),
  };
}

/**
 * Generate the canonical URL slug: firstname-lastname-fideId.
 * This matches how people search (e.g., "Fabiano Caruana").
 *
 * "Caruana,F" + "2020009"  → "f-caruana-2020009"
 * "Carlsen,M" + "1503014" → "m-carlsen-1503014"
 * "Goncalves,Beatriz Frazao Sousa" + "1980688" → "beatriz-frazao-sousa-goncalves-1980688"
 */
export function generateSlug(name: string, fideId: string): string {
  const { lastName, firstName } = parseNameParts(name);
  if (firstName) {
    return slugify(`${firstName} ${lastName} ${fideId}`);
  }
  return slugify(`${lastName} ${fideId}`);
}

/**
 * Generate alias slugs that 301-redirect to the canonical.
 * Returns an array of alternative slugs (does NOT include the canonical).
 *
 * Aliases generated:
 * 1. lastname-firstname-fideId  (PGN order + ID)
 * 2. lastname-firstname         (PGN order, no ID — short form)
 * 3. For multi-part first names: first-part-only-lastname-fideId
 */
export function generateAliases(
  name: string,
  fideId: string,
  canonicalSlug: string
): string[] {
  const { lastName, firstName } = parseNameParts(name);
  const aliases = new Set<string>();

  if (firstName) {
    // 1. lastname-firstname-fideId (PGN order + ID)
    aliases.add(slugify(`${lastName} ${firstName} ${fideId}`));

    // 2. lastname-firstname (PGN order, no ID)
    aliases.add(slugify(`${lastName} ${firstName}`));

    // 3. For multi-part first names, add short alias: first-part-lastname-fideId
    const firstParts = firstName.split(/\s+/);
    if (firstParts.length > 1) {
      aliases.add(slugify(`${firstParts[0]} ${lastName} ${fideId}`));
    }
  } else {
    // No first name — add lastname-only without ID
    aliases.add(slugify(lastName));
  }

  // Remove canonical from aliases (it's not an alias of itself)
  aliases.delete(canonicalSlug);

  return Array.from(aliases);
}

/**
 * Format a display name from TWIC format.
 * "Carlsen, Magnus" stays as "Carlsen, Magnus" (FIDE convention).
 */
function bestDisplayName(existing: string, candidate: string): string {
  // Prefer the longer/more complete version
  return candidate.length > existing.length ? candidate : existing;
}

/**
 * Aggregate games into per-player profiles.
 *
 * @param games All parsed game headers
 * @param minGames Minimum games to include a player (default: 3)
 * @returns Array of FIDEPlayer profiles, sorted by rating descending
 */
export function aggregatePlayers(
  games: TWICGameHeader[],
  minGames: number = 3
): FIDEPlayer[] {
  const players = new Map<string, PlayerAccumulator>();

  for (const game of games) {
    // Process white player
    if (game.whiteElo !== null) {
      processPlayer(players, {
        name: game.white,
        elo: game.whiteElo,
        title: game.whiteTitle,
        fideId: game.whiteFideId,
        color: "white",
        eco: game.eco,
        event: game.event,
        date: game.date,
        result: game.result,
        rawPgn: game.rawPgn,
      });
    }

    // Process black player
    if (game.blackElo !== null) {
      processPlayer(players, {
        name: game.black,
        elo: game.blackElo,
        title: game.blackTitle,
        fideId: game.blackFideId,
        color: "black",
        eco: game.eco,
        event: game.event,
        date: game.date,
        result: game.result,
        rawPgn: game.rawPgn,
      });
    }
  }

  // Convert accumulators to FIDEPlayer profiles
  // Only include players WITH a FIDE ID and enough games
  const result: FIDEPlayer[] = [];

  const accumulators = Array.from(players.values()).filter(
    (p) => p.games >= minGames && p.fideId !== null
  );

  for (const acc of accumulators) {
    const fideId = acc.fideId!; // guaranteed non-null by filter above
    const slug = generateSlug(acc.name, fideId);
    const aliases = generateAliases(acc.name, fideId, slug);
    const totalResults = acc.wins + acc.draws + acc.losses;

    result.push({
      name: acc.name,
      slug,
      fideId,
      aliases,
      fideRating: acc.latestElo,
      title: acc.title,
      gameCount: acc.games,
      recentEvents: getRecentEvents(acc.events, 5),
      lastSeen: acc.latestEloDate,
      openings: {
        white: buildOpeningStats(acc.whiteEcos),
        black: buildOpeningStats(acc.blackEcos),
      },
      winRate:
        totalResults > 0 ? Math.round((acc.wins / totalResults) * 100) : 0,
      drawRate:
        totalResults > 0 ? Math.round((acc.draws / totalResults) * 100) : 0,
      lossRate:
        totalResults > 0 ? Math.round((acc.losses / totalResults) * 100) : 0,
    });
  }

  // Sort by rating descending
  result.sort((a, b) => b.fideRating - a.fideRating);

  return result;
}

interface GameInput {
  name: string;
  elo: number;
  title: string | null;
  fideId: string | null;
  color: "white" | "black";
  eco: string | null;
  event: string | null;
  date: string | null;
  result: string;
  rawPgn: string;
}

function processPlayer(
  players: Map<string, PlayerAccumulator>,
  input: GameInput
): void {
  // Use FIDE ID as primary dedup key when available, fall back to normalized name
  const key = input.fideId
    ? `fide:${input.fideId}`
    : `name:${normalizePlayerName(input.name)}`;
  let acc = players.get(key);

  if (!acc) {
    acc = {
      name: input.name,
      normalizedKey: key,
      fideId: input.fideId,
      latestElo: input.elo,
      latestEloDate: input.date || "0000.00.00",
      title: input.title,
      games: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      events: new Map(),
      whiteEcos: new Map(),
      blackEcos: new Map(),
      rawPgns: [],
    };
    players.set(key, acc);
  }

  // If we now have a FIDE ID that was missing before, store it
  if (input.fideId && !acc.fideId) {
    acc.fideId = input.fideId;
  }

  // Update display name to the most complete version
  acc.name = bestDisplayName(acc.name, input.name);

  // Update rating if this game is more recent
  const gameDate = input.date || "0000.00.00";
  if (gameDate >= acc.latestEloDate) {
    acc.latestElo = input.elo;
    acc.latestEloDate = gameDate;
  }

  // Update title (prefer non-null, prefer higher title)
  if (input.title && (!acc.title || titleRank(input.title) > titleRank(acc.title))) {
    acc.title = input.title;
  }

  // Count result
  acc.games++;
  const isWin =
    (input.color === "white" && input.result === "1-0") ||
    (input.color === "black" && input.result === "0-1");
  const isDraw = input.result === "1/2-1/2";

  if (isWin) acc.wins++;
  else if (isDraw) acc.draws++;
  else acc.losses++;

  // Track event
  if (input.event && input.event !== "?" && input.date) {
    acc.events.set(input.event, input.date);
  }

  // Track ECO opening
  if (input.eco) {
    const ecoMap = input.color === "white" ? acc.whiteEcos : acc.blackEcos;
    const ecoName = getEcoName(input.eco);
    let entry = ecoMap.get(input.eco);
    if (!entry) {
      entry = { eco: input.eco, name: ecoName, games: 0, wins: 0, draws: 0, losses: 0 };
      ecoMap.set(input.eco, entry);
    }
    entry.games++;
    if (isWin) entry.wins++;
    else if (isDraw) entry.draws++;
    else entry.losses++;
  }

  // Store raw PGN for practice
  acc.rawPgns.push(input.rawPgn);
}

/** Get a human-readable ECO name from code. */
function getEcoName(eco: string): string {
  const letter = eco.charAt(0).toUpperCase();
  return ECO_CATEGORIES[letter] || eco;
}

/** Rank titles for comparison (higher = better). */
function titleRank(title: string): number {
  const ranks: Record<string, number> = {
    GM: 10,
    WGM: 9,
    IM: 8,
    WIM: 7,
    FM: 6,
    WFM: 5,
    CM: 4,
    WCM: 3,
    NM: 2,
  };
  return ranks[title] || 0;
}

/** Get the N most recent events sorted by date. */
function getRecentEvents(
  events: Map<string, string>,
  limit: number
): string[] {
  return Array.from(events.entries())
    .sort((a, b) => b[1].localeCompare(a[1]))
    .slice(0, limit)
    .map(([name]) => name);
}

/** Build OpeningStats[] from ECO accumulator map. */
function buildOpeningStats(
  ecoMap: Map<string, { eco: string; name: string; games: number; wins: number; draws: number; losses: number }>
): OpeningStats[] {
  const total = Array.from(ecoMap.values()).reduce(
    (sum, e) => sum + e.games,
    0
  );

  return Array.from(ecoMap.values())
    .filter((e) => e.games >= 2)
    .sort((a, b) => b.games - a.games)
    .slice(0, 15)
    .map((e) => ({
      eco: e.eco,
      name: e.name,
      games: e.games,
      pct: total > 0 ? Math.round((e.games / total) * 100) : 0,
      winRate: e.games > 0 ? Math.round((e.wins / e.games) * 100) : 0,
      drawRate: e.games > 0 ? Math.round((e.draws / e.games) * 100) : 0,
      lossRate: e.games > 0 ? Math.round((e.losses / e.games) * 100) : 0,
    }));
}

/** Build a PlayerIndex from FIDEPlayer array. */
export function buildPlayerIndex(players: FIDEPlayer[]): PlayerIndex {
  return {
    generatedAt: new Date().toISOString(),
    totalPlayers: players.length,
    players: players.map(
      (p): PlayerIndexEntry => ({
        slug: p.slug,
        name: p.name,
        fideId: p.fideId,
        aliases: p.aliases,
        fideRating: p.fideRating,
        title: p.title,
        gameCount: p.gameCount,
      })
    ),
  };
}

/** Extract raw PGN games for a specific player from the accumulators. */
export function extractPlayerGames(
  games: TWICGameHeader[],
  playerName: string
): string[] {
  const key = normalizePlayerName(playerName);
  const result: string[] = [];

  for (const game of games) {
    if (
      normalizePlayerName(game.white) === key ||
      normalizePlayerName(game.black) === key
    ) {
      result.push(game.rawPgn);
    }
  }

  return result;
}
