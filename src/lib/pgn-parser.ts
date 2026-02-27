import { Chess } from "chess.js";
import { OTBGame } from "./types";

/**
 * Parse a multi-game PGN file and extract games for the target player.
 * Filters by player name using case-insensitive substring match on White/Black fields.
 */
export function parsePGNFile(pgnText: string, playerName: string): OTBGame[] {
  const rawGames = splitPGN(pgnText);
  const result: OTBGame[] = [];
  const playerLower = playerName.toLowerCase();

  for (const rawPgn of rawGames) {
    try {
      const headers = extractHeaders(rawPgn);
      const white = headers["White"] || "?";
      const black = headers["Black"] || "?";

      // Only include games where the target player participated
      if (
        !white.toLowerCase().includes(playerLower) &&
        !black.toLowerCase().includes(playerLower)
      ) {
        continue;
      }

      // Use chess.js to validate and replay moves
      const chess = new Chess();
      chess.loadPgn(rawPgn);
      const moves = chess.history().join(" ");

      // Skip games with no moves
      if (!moves) continue;

      result.push({
        white,
        black,
        result: headers["Result"] || "*",
        date: headers["Date"],
        event: headers["Event"],
        eco: headers["ECO"],
        opening: headers["Opening"],
        moves,
        pgn: rawPgn,
      });
    } catch {
      // Skip malformed games silently
    }
  }

  return result;
}

/**
 * Parse all games from a PGN string without filtering by player name.
 */
export function parseAllPGNGames(pgnText: string): OTBGame[] {
  const rawGames = splitPGN(pgnText);
  const result: OTBGame[] = [];

  for (const rawPgn of rawGames) {
    try {
      const headers = extractHeaders(rawPgn);
      const white = headers["White"] || "?";
      const black = headers["Black"] || "?";

      const chess = new Chess();
      chess.loadPgn(rawPgn);
      const moves = chess.history().join(" ");

      if (!moves) continue;

      result.push({
        white,
        black,
        result: headers["Result"] || "*",
        date: headers["Date"],
        event: headers["Event"],
        eco: headers["ECO"],
        opening: headers["Opening"],
        moves,
        pgn: rawPgn,
      });
    } catch {
      // Skip malformed games silently
    }
  }

  return result;
}

export interface InferResult {
  /** Auto-selected player name, or null if ambiguous */
  player: string | null;
  /** All candidates sorted by game count descending */
  candidates: { name: string; games: number }[];
}

/**
 * Infer which player the PGN belongs to by finding the person
 * who participates in all (or most) games.
 */
export function inferPlayer(games: OTBGame[]): InferResult {
  const counts = new Map<string, { display: string; count: number }>();

  for (const g of games) {
    for (const name of [g.white, g.black]) {
      const trimmed = name.trim();
      if (!trimmed || trimmed === "?") continue;
      const key = trimmed.toLowerCase();
      const existing = counts.get(key);
      if (existing) {
        existing.count++;
      } else {
        counts.set(key, { display: trimmed, count: 1 });
      }
    }
  }

  const totalGames = games.length;
  const candidates = Array.from(counts.values())
    .map((c) => ({ name: c.display, games: c.count }))
    .sort((a, b) => b.games - a.games);

  if (candidates.length === 0) {
    return { player: null, candidates };
  }

  // Find players who appear in ALL games
  const inAll = candidates.filter((c) => c.games === totalGames);

  if (inAll.length === 1) {
    return { player: inAll[0].name, candidates };
  }

  return { player: null, candidates };
}

/**
 * Split a multi-game PGN string into individual game strings.
 * Games are separated by double newlines followed by an [Event header.
 */
export function splitPGN(pgnText: string): string[] {
  const games: string[] = [];
  // Normalize Windows (\r\n) line endings before splitting
  const normalized = pgnText.replace(/\r/g, "");
  // Split on double newlines followed by [Event tag
  const parts = normalized.split(/\n\n(?=\[Event )/);
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed) games.push(trimmed);
  }
  return games.length > 0 ? games : [pgnText.trim()].filter(Boolean);
}

/**
 * Extract PGN headers from a single game PGN string.
 */
export function extractHeaders(pgn: string): Record<string, string> {
  const headers: Record<string, string> = {};
  const regex = /\[(\w+)\s+"([^"]*)"\]/g;
  let match;
  while ((match = regex.exec(pgn)) !== null) {
    headers[match[1]] = match[2];
  }
  return headers;
}
