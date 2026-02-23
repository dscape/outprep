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
 * Split a multi-game PGN string into individual game strings.
 * Games are separated by double newlines followed by an [Event header.
 */
function splitPGN(pgnText: string): string[] {
  const games: string[] = [];
  // Split on double newlines followed by [Event tag
  const parts = pgnText.split(/\n\n(?=\[Event )/);
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed) games.push(trimmed);
  }
  return games.length > 0 ? games : [pgnText.trim()].filter(Boolean);
}

/**
 * Extract PGN headers from a single game PGN string.
 */
function extractHeaders(pgn: string): Record<string, string> {
  const headers: Record<string, string> = {};
  const regex = /\[(\w+)\s+"([^"]*)"\]/g;
  let match;
  while ((match = regex.exec(pgn)) !== null) {
    headers[match[1]] = match[2];
  }
  return headers;
}
